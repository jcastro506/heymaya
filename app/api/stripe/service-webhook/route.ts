/**
 * Service-product Stripe webhook receiver — Wave D.
 *
 * Mirror of `app/api/billing/stripe-webhook/route.ts` (creator-side) but
 * dispatches to the SERVICE handlers in
 * `convex/integrations/stripe/webhooks.ts`. Keeping the routes separate
 * means a creator-side billing change can never accidentally collide with
 * a service-side webhook.
 *
 * The same `STRIPE_WEBHOOK_SECRET` env var is reused — operator can either
 * use one webhook endpoint that BOTH routes process or create a separate
 * Stripe webhook endpoint per route. The payload object's metadata
 * (`heymaya_product: "service"` set at checkout) lets each route filter to
 * its own events; events lacking the marker land as "skipped" in the audit
 * log without a handler patch.
 *
 * SAFETY: events without `metadata.heymaya_product === "service"` AND no
 * resolvable business-side `stripeCustomerId` are silently audited as
 * "skipped" so the creator side keeps owning its own customers without
 * cross-talk.
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import Stripe from "stripe";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { servicePriceIdToPlanTuple } from "@/convex/integrations/stripe/priceIds";
import { STRIPE_API_VERSION } from "@/convex/billing/stripeClient";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function bridgeSecret(): string {
  const s = process.env.WEBHOOK_INTERNAL_SECRET;
  if (!s) {
    throw new Error("WEBHOOK_INTERNAL_SECRET is not configured.");
  }
  return s;
}

type ServiceTier = "starter" | "pro" | "studio";
type Interval = "monthly" | "annual";
type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

function isServiceTier(s: unknown): s is ServiceTier {
  return s === "starter" || s === "pro" || s === "studio";
}
function isInterval(s: unknown): s is Interval {
  return s === "monthly" || s === "annual";
}
function isSubscriptionStatus(s: unknown): s is SubscriptionStatus {
  return (
    s === "active" ||
    s === "trialing" ||
    s === "past_due" ||
    s === "canceled" ||
    s === "incomplete" ||
    s === "incomplete_expired" ||
    s === "unpaid" ||
    s === "paused"
  );
}

function resolveServiceTierIntervalFromSubscription(
  sub: Stripe.Subscription
): { tier: ServiceTier; interval: Interval } | null {
  const md = sub.metadata ?? {};
  if (isServiceTier(md.tier) && isInterval(md.interval)) {
    return { tier: md.tier, interval: md.interval };
  }
  // Fallback: resolve via price id reverse lookup. The first item that maps
  // to a service tier wins (Studio subscriptions carry both the recurring
  // price + the metered voice price; we ignore the metered one here).
  for (const item of sub.items.data) {
    const priceId = item.price?.id;
    if (!priceId) continue;
    const tuple = servicePriceIdToPlanTuple(priceId);
    if (tuple) return tuple;
  }
  return null;
}

function metadataBusinessId(
  obj: Stripe.Subscription | Stripe.Checkout.Session
): Id<"businesses"> | undefined {
  const md = obj.metadata ?? {};
  const v = md.businessId;
  if (typeof v === "string" && v.length > 0) {
    return v as Id<"businesses">;
  }
  return undefined;
}

/** Defense in depth — only process if metadata flags this as service-side. */
function isServiceProductEvent(
  obj: Stripe.Subscription | Stripe.Checkout.Session
): boolean {
  return (obj.metadata ?? {}).heymaya_product === "service";
}

function subscriptionPeriodEndMs(
  sub: Stripe.Subscription
): number | undefined {
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

function subscriptionTrialEndMs(
  sub: Stripe.Subscription
): number | undefined {
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
    return NextResponse.json(
      { error: "missing stripe-signature header" },
      { status: 400 }
    );
  }

  const rawBody = await req.text();
  const stripe = new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    return NextResponse.json(
      {
        error: `signature verification failed: ${(err as Error).message}`,
      },
      { status: 400 }
    );
  }

  const eventId = event.id;
  const livemode = event.livemode;
  const obj = event.data.object as unknown as Record<string, unknown>;
  const customerId =
    typeof obj.customer === "string" ? obj.customer : undefined;
  const bridge = bridgeSecret();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (!isServiceProductEvent(session)) {
          await convex.mutation(
            api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
            {
              secret: bridge,
              eventId,
              type: event.type,
              livemode,
              status: "skipped",
              detail: "checkout.session not flagged as service product",
              customerId: customerId ?? undefined,
              rawPayload: event as unknown,
            }
          );
          return NextResponse.json({ ok: true, skipped: "creator-side" });
        }
        const stripeCustomerId =
          typeof session.customer === "string" ? session.customer : null;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : null;
        if (!stripeCustomerId || !subscriptionId) {
          await convex.mutation(
            api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
            {
              secret: bridge,
              eventId,
              type: event.type,
              livemode,
              status: "errored",
              detail:
                "service checkout.session.completed missing customer or subscription",
              customerId: stripeCustomerId ?? undefined,
              rawPayload: event as unknown,
            }
          );
          return NextResponse.json({ ok: true, error: "missing-fields" });
        }

        const audit = await convex.mutation(
          api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
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

        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const tuple = resolveServiceTierIntervalFromSubscription(sub);
        if (!tuple) {
          await convex.mutation(
            api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
            {
              secret: bridge,
              eventId: `${eventId}.dispatch-failed`,
              type: event.type,
              livemode,
              status: "errored",
              detail:
                "could not resolve (tier, interval) from service subscription",
              customerId: stripeCustomerId,
              rawPayload: event as unknown,
            }
          );
          return NextResponse.json({ ok: true, error: "unknown-price" });
        }
        const subStatus: SubscriptionStatus = isSubscriptionStatus(sub.status)
          ? sub.status
          : "active";

        const businessId =
          metadataBusinessId(session) ?? metadataBusinessId(sub);

        const result = await convex.mutation(
          api.integrations.stripe.webhooks
            .handleServiceCheckoutCompletedPublic,
          {
            secret: bridge,
            stripeCustomerId,
            subscriptionId,
            businessId,
            tier: tuple.tier,
            interval: tuple.interval,
            status: subStatus,
            currentPeriodEnd: subscriptionPeriodEndMs(sub),
            trialEnd: subscriptionTrialEndMs(sub),
          }
        );
        if (!result.patched) {
          await convex.mutation(
            api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
            {
              secret: bridge,
              eventId: `${eventId}.dispatch-failed`,
              type: event.type,
              livemode,
              status: "errored",
              detail: `handleServiceCheckoutCompleted returned ${result.reason ?? "no_patch"}`,
              customerId: stripeCustomerId,
              rawPayload: event as unknown,
            }
          );
        }
        return NextResponse.json({ ok: true });
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        if (!isServiceProductEvent(sub)) {
          await convex.mutation(
            api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
            {
              secret: bridge,
              eventId,
              type: event.type,
              livemode,
              status: "skipped",
              detail: "subscription not flagged as service product",
              customerId: customerId ?? undefined,
              rawPayload: event as unknown,
            }
          );
          return NextResponse.json({ ok: true, skipped: "creator-side" });
        }
        const stripeCustomerId =
          typeof sub.customer === "string" ? sub.customer : null;
        if (!stripeCustomerId) {
          return NextResponse.json({ ok: true, error: "missing-customer" });
        }

        const audit = await convex.mutation(
          api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
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

        const tuple = resolveServiceTierIntervalFromSubscription(sub);
        if (!tuple) {
          await convex.mutation(
            api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
            {
              secret: bridge,
              eventId: `${eventId}.dispatch-failed`,
              type: event.type,
              livemode,
              status: "errored",
              detail:
                "could not resolve (tier, interval) from service subscription",
              customerId: stripeCustomerId,
              rawPayload: event as unknown,
            }
          );
          return NextResponse.json({ ok: true, error: "unknown-price" });
        }
        const subStatus: SubscriptionStatus = isSubscriptionStatus(sub.status)
          ? sub.status
          : "active";

        const result = await convex.mutation(
          api.integrations.stripe.webhooks
            .handleServiceSubscriptionUpdatedPublic,
          {
            secret: bridge,
            stripeCustomerId,
            subscriptionId: sub.id,
            businessId: metadataBusinessId(sub),
            tier: tuple.tier,
            interval: tuple.interval,
            status: subStatus,
            currentPeriodEnd: subscriptionPeriodEndMs(sub),
            trialEnd: subscriptionTrialEndMs(sub),
          }
        );
        if (!result.patched) {
          await convex.mutation(
            api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
            {
              secret: bridge,
              eventId: `${eventId}.dispatch-failed`,
              type: event.type,
              livemode,
              status: "errored",
              detail: `handleServiceSubscriptionUpdated returned ${result.reason ?? "no_patch"}`,
              customerId: stripeCustomerId,
              rawPayload: event as unknown,
            }
          );
        }
        return NextResponse.json({ ok: true });
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        if (!isServiceProductEvent(sub)) {
          await convex.mutation(
            api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
            {
              secret: bridge,
              eventId,
              type: event.type,
              livemode,
              status: "skipped",
              detail: "subscription not flagged as service product",
              customerId: customerId ?? undefined,
              rawPayload: event as unknown,
            }
          );
          return NextResponse.json({ ok: true, skipped: "creator-side" });
        }
        const stripeCustomerId =
          typeof sub.customer === "string" ? sub.customer : null;
        if (!stripeCustomerId) {
          return NextResponse.json({ ok: true, error: "missing-customer" });
        }

        const audit = await convex.mutation(
          api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
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

        await convex.mutation(
          api.integrations.stripe.webhooks
            .handleServiceSubscriptionDeletedPublic,
          { secret: bridge, stripeCustomerId }
        );
        return NextResponse.json({ ok: true });
      }

      case "customer.subscription.trial_will_end": {
        const sub = event.data.object as Stripe.Subscription;
        if (!isServiceProductEvent(sub)) {
          await convex.mutation(
            api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
            {
              secret: bridge,
              eventId,
              type: event.type,
              livemode,
              status: "skipped",
              detail: "trial_will_end not flagged as service product",
              customerId: customerId ?? undefined,
              rawPayload: event as unknown,
            }
          );
          return NextResponse.json({ ok: true, skipped: "creator-side" });
        }
        const stripeCustomerId =
          typeof sub.customer === "string" ? sub.customer : null;
        if (!stripeCustomerId) {
          return NextResponse.json({ ok: true, error: "missing-customer" });
        }
        const audit = await convex.mutation(
          api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
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
        await convex.mutation(
          api.integrations.stripe.webhooks.handleServiceTrialWillEndPublic,
          { secret: bridge, stripeCustomerId }
        );
        return NextResponse.json({ ok: true });
      }

      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const stripeCustomerId =
          typeof inv.customer === "string" ? inv.customer : null;
        if (!stripeCustomerId) {
          return NextResponse.json({ ok: true, error: "missing-customer" });
        }
        // invoice doesn't carry our metadata directly, but the subscription
        // it belongs to does — we trust the customer id and let the handler
        // resolve via `findBusinessByStripeCustomerId`. Cross-talk safety:
        // a creator-side customer id won't resolve to a business, so the
        // handler returns `no_business` and we audit as errored without
        // patching anything.
        const audit = await convex.mutation(
          api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
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
          api.integrations.stripe.webhooks.handleServicePaymentFailedPublic,
          { secret: bridge, stripeCustomerId }
        );
        if (!result.patched) {
          // creator-side customer; not our concern here
          return NextResponse.json({ ok: true, skipped: "no_business" });
        }
        return NextResponse.json({ ok: true });
      }

      case "invoice.finalized": {
        const inv = event.data.object as Stripe.Invoice;
        const stripeCustomerId =
          typeof inv.customer === "string" ? inv.customer : null;
        if (!stripeCustomerId) {
          return NextResponse.json({ ok: true, error: "missing-customer" });
        }
        const audit = await convex.mutation(
          api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
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
        const periodEndMs =
          typeof inv.period_end === "number"
            ? inv.period_end * 1000
            : undefined;
        const periodStartMs =
          typeof inv.period_start === "number"
            ? inv.period_start * 1000
            : undefined;
        await convex.mutation(
          api.integrations.stripe.webhooks
            .handleServiceInvoiceFinalizedPublic,
          {
            secret: bridge,
            stripeCustomerId,
            nextPeriodStartMs: periodStartMs,
            nextPeriodEndMs: periodEndMs,
          }
        );
        return NextResponse.json({ ok: true });
      }

      default: {
        await convex.mutation(
          api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
          {
            secret: bridge,
            eventId,
            type: event.type,
            livemode,
            status: "skipped",
            detail: "no service handler wired for this event type",
            customerId,
            rawPayload: event as unknown,
          }
        );
        return NextResponse.json({ ok: true, skipped: "unhandled-type" });
      }
    }
  } catch (err) {
    await convex.mutation(
      api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
      {
        secret: bridge,
        eventId: `${eventId}.handler-threw`,
        type: event.type,
        livemode,
        status: "errored",
        detail: (err as Error).message?.slice(0, 500) ?? "unknown",
        customerId,
        rawPayload: event as unknown,
      }
    );
    return NextResponse.json({ ok: true, error: "handler-threw" });
  }
}
