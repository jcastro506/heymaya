/**
 * Stripe webhook receiver — Sprint 6B.
 *
 * Verifies the Stripe signature on `req.text()` (raw body — JSON parsing
 * before signature check would invalidate the HMAC), then dispatches to one
 * of the internal mutations in `convex/billing/webhook.ts`.
 *
 * Always returns 200 unless the signature fails (400). Any internal error is
 * logged via `recordWebhookEvent({ status: "errored" })` and returned as 200
 * — Stripe retries on 4xx/5xx and we don't want a redelivery storm because
 * an event arrived for an unrecognized customer.
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import Stripe from "stripe";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { priceIdToPlanTuple } from "@/convex/billing/priceIds";
import { STRIPE_API_VERSION } from "@/convex/billing/stripeClient";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * Bridge secret for the internal Stripe webhook handlers exposed via public
 * wrappers. See `convex/lib/webhookSecret.ts` for setup; operator MUST set
 * `WEBHOOK_INTERNAL_SECRET` in BOTH .env.local (used here) and Convex env
 * (`npx convex env set WEBHOOK_INTERNAL_SECRET <hex>`).
 */
function bridgeSecret(): string {
  const s = process.env.WEBHOOK_INTERNAL_SECRET;
  if (!s) {
    throw new Error("WEBHOOK_INTERNAL_SECRET is not configured.");
  }
  return s;
}

type Plan = "starter" | "pro" | "studio";
type Interval = "monthly" | "annual";

function isPlan(s: unknown): s is Plan {
  return s === "starter" || s === "pro" || s === "studio";
}
function isInterval(s: unknown): s is Interval {
  return s === "monthly" || s === "annual";
}

/**
 * Resolve the (tier, interval) tuple for a Stripe Subscription. We prefer
 * `subscription.metadata.{tier,interval}` (set by `createCheckoutSession`)
 * and fall back to the reverse price-id lookup if metadata is missing.
 */
function resolveTierIntervalFromSubscription(
  sub: Stripe.Subscription
): { tier: Plan; interval: Interval } | null {
  const md = sub.metadata ?? {};
  if (isPlan(md.tier) && isInterval(md.interval)) {
    return { tier: md.tier, interval: md.interval };
  }
  const priceId = sub.items.data[0]?.price?.id;
  if (priceId) {
    const tuple = priceIdToPlanTuple(priceId);
    if (tuple) return tuple;
  }
  return null;
}

function metadataCreatorId(
  sub: Stripe.Subscription | Stripe.Checkout.Session
): Id<"creators"> | undefined {
  const md = sub.metadata ?? {};
  const v = md.creatorId;
  if (typeof v === "string" && v.length > 0) {
    return v as Id<"creators">;
  }
  return undefined;
}

/** Extract the unix-seconds period end from a subscription, in ms. */
function subscriptionPeriodEndMs(sub: Stripe.Subscription): number | undefined {
  // `current_period_end` is unix seconds. Some SDK versions ship it on the
  // subscription, others on the items array — guard both.
  const onSub = (sub as unknown as { current_period_end?: number })
    .current_period_end;
  if (typeof onSub === "number" && Number.isFinite(onSub)) {
    return onSub * 1000;
  }
  const onItem = sub.items?.data?.[0]?.current_period_end;
  if (typeof onItem === "number" && Number.isFinite(onItem)) {
    return onItem * 1000;
  }
  return undefined;
}

function subscriptionTrialEndMs(sub: Stripe.Subscription): number | undefined {
  if (typeof sub.trial_end === "number" && Number.isFinite(sub.trial_end)) {
    return sub.trial_end * 1000;
  }
  return undefined;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!secret || !apiKey) {
    return NextResponse.json(
      { error: "Stripe webhook env not configured" },
      { status: 500 }
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "missing stripe-signature header" }, { status: 400 });
  }

  // CRITICAL: read raw body BEFORE any JSON parsing — Stripe HMAC is over
  // the exact bytes Stripe sent.
  const rawBody = await req.text();

  const stripe = new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    return NextResponse.json(
      { error: `signature verification failed: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const eventId = event.id;
  const livemode = event.livemode;

  // Resolve customerId for the audit log up front so even errored events
  // get attributed where possible. Different event objects expose customer
  // differently; cast through `unknown` first to satisfy TS — the Stripe SDK
  // unions are too wide for a direct Record<string, unknown> cast.
  const obj = event.data.object as unknown as Record<string, unknown>;
  const customerId =
    typeof obj.customer === "string" ? obj.customer : undefined;

  const bridge = bridgeSecret();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const stripeCustomerId =
          typeof session.customer === "string" ? session.customer : null;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : null;
        if (!stripeCustomerId || !subscriptionId) {
          await convex.mutation(api.billing.webhook.recordWebhookEventPublic, {
            secret: bridge,
            eventId,
            type: event.type,
            livemode,
            status: "errored",
            detail: "checkout.session.completed missing customer or subscription",
            customerId: stripeCustomerId ?? undefined,
            rawPayload: event as unknown,
          });
          return NextResponse.json({ ok: true, error: "missing-fields" });
        }

        // Audit log first — replay defense returns alreadySeen=true on
        // redelivery and we short-circuit.
        const audit = await convex.mutation(
          api.billing.webhook.recordWebhookEventPublic,
          {
            secret: bridge,
            eventId,
            type: event.type,
            livemode,
            status: "processed",
            customerId: stripeCustomerId,
            rawPayload: event as unknown,
          }
        );
        if (audit.alreadySeen) {
          return NextResponse.json({ ok: true, skipped: "replay" });
        }

        // Pull the live subscription so we have an authoritative
        // current_period_end + trial_end + price id (the Checkout session
        // doesn't carry those reliably until the subscription is created).
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const tuple = resolveTierIntervalFromSubscription(sub);
        if (!tuple) {
          await convex.mutation(api.billing.webhook.recordWebhookEventPublic, {
            secret: bridge,
            eventId: `${eventId}.dispatch-failed`,
            type: event.type,
            livemode,
            status: "errored",
            detail: "could not resolve (tier, interval) from subscription",
            customerId: stripeCustomerId,
            rawPayload: event as unknown,
          });
          return NextResponse.json({ ok: true, error: "unknown-price" });
        }

        // metadata.creatorId can come from either the session or the
        // subscription — we set it on both at Checkout-create time.
        const creatorId =
          metadataCreatorId(session) ?? metadataCreatorId(sub);

        const result = await convex.mutation(
          api.billing.webhook.handleCheckoutCompletedPublic,
          {
            secret: bridge,
            stripeCustomerId,
            subscriptionId,
            creatorId,
            tier: tuple.tier,
            interval: tuple.interval,
            currentPeriodEnd: subscriptionPeriodEndMs(sub),
            trialEnd: subscriptionTrialEndMs(sub),
          }
        );
        if (!result.patched) {
          await convex.mutation(api.billing.webhook.recordWebhookEventPublic, {
            secret: bridge,
            eventId: `${eventId}.dispatch-failed`,
            type: event.type,
            livemode,
            status: "errored",
            detail: `handleCheckoutCompleted returned ${result.reason ?? "no_patch"}`,
            customerId: stripeCustomerId,
            rawPayload: event as unknown,
          });
        }
        return NextResponse.json({ ok: true });
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const stripeCustomerId =
          typeof sub.customer === "string" ? sub.customer : null;
        if (!stripeCustomerId) {
          await convex.mutation(api.billing.webhook.recordWebhookEventPublic, {
            secret: bridge,
            eventId,
            type: event.type,
            livemode,
            status: "errored",
            detail: "subscription.updated missing customer",
            rawPayload: event as unknown,
          });
          return NextResponse.json({ ok: true, error: "missing-customer" });
        }

        const audit = await convex.mutation(
          api.billing.webhook.recordWebhookEventPublic,
          {
            secret: bridge,
            eventId,
            type: event.type,
            livemode,
            status: "processed",
            customerId: stripeCustomerId,
            rawPayload: event as unknown,
          }
        );
        if (audit.alreadySeen) {
          return NextResponse.json({ ok: true, skipped: "replay" });
        }

        const tuple = resolveTierIntervalFromSubscription(sub);
        if (!tuple) {
          await convex.mutation(api.billing.webhook.recordWebhookEventPublic, {
            secret: bridge,
            eventId: `${eventId}.dispatch-failed`,
            type: event.type,
            livemode,
            status: "errored",
            detail: "could not resolve (tier, interval) from subscription",
            customerId: stripeCustomerId,
            rawPayload: event as unknown,
          });
          return NextResponse.json({ ok: true, error: "unknown-price" });
        }

        const result = await convex.mutation(
          api.billing.webhook.handleSubscriptionUpdatedPublic,
          {
            secret: bridge,
            stripeCustomerId,
            subscriptionId: sub.id,
            creatorId: metadataCreatorId(sub),
            tier: tuple.tier,
            interval: tuple.interval,
            currentPeriodEnd: subscriptionPeriodEndMs(sub),
            trialEnd: subscriptionTrialEndMs(sub),
          }
        );
        if (!result.patched) {
          await convex.mutation(api.billing.webhook.recordWebhookEventPublic, {
            secret: bridge,
            eventId: `${eventId}.dispatch-failed`,
            type: event.type,
            livemode,
            status: "errored",
            detail: `handleSubscriptionUpdated returned ${result.reason ?? "no_patch"}`,
            customerId: stripeCustomerId,
            rawPayload: event as unknown,
          });
        }
        return NextResponse.json({ ok: true });
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const stripeCustomerId =
          typeof sub.customer === "string" ? sub.customer : null;
        if (!stripeCustomerId) {
          await convex.mutation(api.billing.webhook.recordWebhookEventPublic, {
            secret: bridge,
            eventId,
            type: event.type,
            livemode,
            status: "errored",
            detail: "subscription.deleted missing customer",
            rawPayload: event as unknown,
          });
          return NextResponse.json({ ok: true, error: "missing-customer" });
        }

        const audit = await convex.mutation(
          api.billing.webhook.recordWebhookEventPublic,
          {
            secret: bridge,
            eventId,
            type: event.type,
            livemode,
            status: "processed",
            customerId: stripeCustomerId,
            rawPayload: event as unknown,
          }
        );
        if (audit.alreadySeen) {
          return NextResponse.json({ ok: true, skipped: "replay" });
        }

        const result = await convex.mutation(
          api.billing.webhook.handleSubscriptionDeletedPublic,
          { secret: bridge, stripeCustomerId }
        );
        if (!result.patched) {
          await convex.mutation(api.billing.webhook.recordWebhookEventPublic, {
            secret: bridge,
            eventId: `${eventId}.dispatch-failed`,
            type: event.type,
            livemode,
            status: "errored",
            detail: `handleSubscriptionDeleted returned ${result.reason ?? "no_patch"}`,
            customerId: stripeCustomerId,
            rawPayload: event as unknown,
          });
        }
        return NextResponse.json({ ok: true });
      }

      case "customer.subscription.trial_will_end": {
        const sub = event.data.object as Stripe.Subscription;
        const stripeCustomerId =
          typeof sub.customer === "string" ? sub.customer : null;
        if (!stripeCustomerId) {
          await convex.mutation(api.billing.webhook.recordWebhookEventPublic, {
            secret: bridge,
            eventId,
            type: event.type,
            livemode,
            status: "errored",
            detail: "trial_will_end missing customer",
            rawPayload: event as unknown,
          });
          return NextResponse.json({ ok: true, error: "missing-customer" });
        }

        const audit = await convex.mutation(
          api.billing.webhook.recordWebhookEventPublic,
          {
            secret: bridge,
            eventId,
            type: event.type,
            livemode,
            status: "processed",
            customerId: stripeCustomerId,
            rawPayload: event as unknown,
          }
        );
        if (audit.alreadySeen) {
          return NextResponse.json({ ok: true, skipped: "replay" });
        }

        await convex.mutation(api.billing.webhook.handleTrialWillEndPublic, {
          secret: bridge,
          stripeCustomerId,
        });
        return NextResponse.json({ ok: true });
      }

      default: {
        // Audit-only for events we don't currently route (e.g. invoice.paid).
        // Keep a row so the operator can see what's flowing in; status=skipped
        // makes them filterable in the dashboard.
        await convex.mutation(api.billing.webhook.recordWebhookEventPublic, {
          secret: bridge,
          eventId,
          type: event.type,
          livemode,
          status: "skipped",
          detail: "no handler wired for this event type",
          customerId,
          rawPayload: event as unknown,
        });
        return NextResponse.json({ ok: true, skipped: "unhandled-type" });
      }
    }
  } catch (err) {
    // Catch-all so internal errors never bubble to a 5xx — Stripe would
    // retry and we'd compound the problem. Log + return 200.
    await convex.mutation(api.billing.webhook.recordWebhookEventPublic, {
      secret: bridge,
      eventId: `${eventId}.handler-threw`,
      type: event.type,
      livemode,
      status: "errored",
      detail: (err as Error).message?.slice(0, 500) ?? "unknown",
      customerId,
      rawPayload: event as unknown,
    });
    return NextResponse.json({ ok: true, error: "handler-threw" });
  }
}
