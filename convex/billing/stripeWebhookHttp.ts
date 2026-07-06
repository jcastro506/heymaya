import type Stripe from "stripe";
import { httpAction } from "../_generated/server";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getStripeClient } from "./stripeClient";

/**
 * Stripe webhook receiver ON CONVEX (`/stripe/webhook` on <deployment>.convex.site).
 *
 * Why this exists: the original receiver is the Next.js route
 * `app/api/billing/stripe-webhook/route.ts`, which lives on the WEB deployment.
 * On staging that domain sits behind Vercel SSO, so Stripe's POST gets a 302 to
 * the SSO login and the event is never delivered — checkout succeeds, the plan
 * never lands, the tier screen loops (root-caused live 2026-07-06: two
 * `checkout.session.completed` events stuck with pending_webhooks). The Convex
 * HTTP router is public by design and signature-verified, exactly like the
 * Telegram switchboard route — so billing delivery can never depend on the web
 * deployment's protection settings again.
 *
 * Scope: the GTM product branch (metadata.product === "gtm") is fully handled —
 * checkout.session.completed + customer.subscription.created/updated/deleted →
 * `applyGtmPlanFromWebhookPublic` (same mutation the Next route calls). Events
 * outside that branch are AUDITED (recordWebhookEventPublic) but not dispatched;
 * the creator-product (coach/manager) path stays on the Next route, which prod
 * still serves publicly. Replay defense + audit log are shared with the Next
 * route via the same `stripeWebhookEvents` mutations, so pointing BOTH a Next
 * and a Convex endpoint at one Stripe account double-processes nothing.
 */

function bridgeSecret(): string {
  const s = process.env.WEBHOOK_INTERNAL_SECRET;
  if (!s) throw new Error("WEBHOOK_INTERNAL_SECRET is not configured.");
  return s;
}

type WithMetadata = { metadata?: Record<string, string> | null };

function isGtmProduct(obj: WithMetadata | null | undefined): boolean {
  return obj?.metadata?.product === "gtm";
}

function metadataCreatorId(
  obj: WithMetadata | null | undefined
): Id<"creators"> | undefined {
  const id = obj?.metadata?.creatorId;
  // Checkout metadata stamps the creator's Convex id as a string; the mutation
  // re-verifies ownership against stripeCustomerId, so the cast is safe.
  return typeof id === "string" && id.length > 0 ? (id as Id<"creators">) : undefined;
}

function gtmTier(
  ...objs: Array<WithMetadata | null | undefined>
): "starter" | "growth" | "studio" | undefined {
  for (const o of objs) {
    const t = o?.metadata?.tier;
    if (t === "starter" || t === "growth" || t === "studio") return t;
  }
  return undefined;
}

function subscriptionPeriodEndMs(sub: Stripe.Subscription): number | undefined {
  const s = sub as unknown as { current_period_end?: number };
  if (typeof s.current_period_end === "number" && Number.isFinite(s.current_period_end)) {
    return s.current_period_end * 1000;
  }
  const onItem = sub.items?.data?.[0]?.current_period_end;
  if (typeof onItem === "number" && Number.isFinite(onItem)) return onItem * 1000;
  return undefined;
}

export const stripeWebhookHttp = httpAction(async (ctx, request) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    return new Response("stripe webhook env not configured", { status: 503 });
  }
  const sig = request.headers.get("stripe-signature");
  if (!sig) return new Response("missing stripe-signature header", { status: 400 });

  // CRITICAL: raw body before any parsing — the HMAC is over the exact bytes.
  const rawBody = await request.text();

  const stripe = getStripeClient();
  let event: Stripe.Event;
  try {
    // constructEventAsync — the V8-isolate (WebCrypto) verification path.
    const webhooks = stripe.webhooks as unknown as {
      constructEventAsync(
        payload: string,
        header: string,
        secret: string
      ): Promise<Stripe.Event>;
    };
    event = await webhooks.constructEventAsync(rawBody, sig, secret);
  } catch (err) {
    return new Response(
      `signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 400 }
    );
  }

  const bridge = bridgeSecret();
  const eventId = event.id;
  const livemode = event.livemode;
  const obj = event.data.object as unknown as Record<string, unknown>;
  const customerId = typeof obj.customer === "string" ? obj.customer : undefined;

  const audit = async (
    status: "processed" | "errored" | "skipped",
    detail?: string,
    idSuffix = ""
  ): Promise<{ alreadySeen: boolean }> =>
    (await ctx.runMutation(api.billing.webhook.recordWebhookEventPublic, {
      secret: bridge,
      eventId: `${eventId}${idSuffix}`,
      type: event.type,
      livemode,
      status,
      detail,
      customerId,
      rawPayload: event as unknown,
    })) as { alreadySeen: boolean };

  const dispatchGtm = async (
    stripeCustomerId: string,
    sub: Stripe.Subscription,
    session?: Stripe.Checkout.Session
  ): Promise<Response> => {
    const result = (await ctx.runMutation(
      api.billing.gtmBilling.applyGtmPlanFromWebhookPublic,
      {
        secret: bridge,
        stripeCustomerId,
        creatorId: metadataCreatorId(session) ?? metadataCreatorId(sub),
        stripeStatus: sub.status,
        tier: gtmTier(session, sub),
        periodEndMs: subscriptionPeriodEndMs(sub),
      }
    )) as { patched: boolean; reason?: string };
    if (!result.patched) {
      await audit(
        "errored",
        `applyGtmPlanFromWebhook returned ${result.reason ?? "no_patch"}`,
        ".dispatch-failed"
      );
    }
    return Response.json({ ok: true, product: "gtm" });
  };

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const stripeCustomerId =
          typeof session.customer === "string" ? session.customer : null;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : null;
        if (!stripeCustomerId || !subscriptionId) {
          await audit("errored", "checkout.session.completed missing customer or subscription");
          return Response.json({ ok: true, error: "missing-fields" });
        }
        const seen = await audit("processed");
        if (seen.alreadySeen) return Response.json({ ok: true, skipped: "replay" });

        // Authoritative status/period/trial live on the subscription.
        const sub = (await stripe.subscriptions.retrieve(subscriptionId)) as unknown as
          Stripe.Subscription;
        if (isGtmProduct(session) || isGtmProduct(sub)) {
          return await dispatchGtm(stripeCustomerId, sub, session);
        }
        // Non-GTM (creator coach/manager) — audited above; dispatch stays with
        // the Next route on the public prod domain.
        await audit("skipped", "non-gtm product — handled by the Next route", ".convex-skipped");
        return Response.json({ ok: true, skipped: "non-gtm" });
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const stripeCustomerId =
          typeof sub.customer === "string" ? sub.customer : null;
        if (!stripeCustomerId) {
          await audit("errored", `${event.type} missing customer`);
          return Response.json({ ok: true, error: "missing-fields" });
        }
        const seen = await audit("processed");
        if (seen.alreadySeen) return Response.json({ ok: true, skipped: "replay" });
        if (!isGtmProduct(sub)) {
          await audit("skipped", "non-gtm product — handled by the Next route", ".convex-skipped");
          return Response.json({ ok: true, skipped: "non-gtm" });
        }
        // deleted → Stripe reports status "canceled" on the object itself, so
        // the same dispatch maps it to the fail-closed plan state.
        return await dispatchGtm(stripeCustomerId, sub);
      }

      default: {
        await audit("skipped", "event type not handled by the Convex route");
        return Response.json({ ok: true, skipped: "unhandled-type" });
      }
    }
  } catch (err) {
    await audit(
      "errored",
      `convex webhook dispatch threw: ${err instanceof Error ? err.message : String(err)}`,
      ".convex-threw"
    ).catch(() => {});
    // 500 → Stripe retries with backoff; the audit replay-defense dedupes.
    return new Response("dispatch failed", { status: 500 });
  }
});
