/**
 * The Stripe webhook, on Convex's public HTTP router (plan §19.3; scar tissue:
 * the old receiver sat behind auth for months). Signature over the raw bytes,
 * then one idempotent mutation, then at most one message from Maya per state
 * change. `customer.subscription.trial_will_end` (three days out) is her day-5
 * text: what she has done so far, and when the card is charged.
 */

import type Stripe from "stripe";
import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { constructEvent } from "./stripe";
import { messageFor } from "./plan";

function customerIdOf(obj: { customer?: string | { id: string } | null } | null | undefined): string | undefined {
  const c = obj?.customer;
  return typeof c === "string" ? c : c?.id;
}

function subscriptionPayload(sub: Stripe.Subscription): { id: string; status: string; cancel_at_period_end?: boolean; trial_end: number | null; current_period_end: number | null; founding?: boolean } {
  const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  const legacyEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  return { id: sub.id, status: sub.status, cancel_at_period_end: sub.cancel_at_period_end ?? undefined, trial_end: sub.trial_end ?? null, current_period_end: legacyEnd ?? item?.current_period_end ?? null, founding: sub.metadata?.founding === "1" };
}

export const stripeWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return new Response("billing not configured", { status: 503 });
  const sig = request.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });
  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = await constructEvent(raw, sig, secret);
  } catch (e) {
    return new Response(`bad signature: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`, { status: 400 });
  }

  const obj = event.data.object as unknown as Record<string, unknown>;
  let subscription: ReturnType<typeof subscriptionPayload> | undefined;
  let customerId: string | undefined;
  let creatorIdFromMetadata: string | undefined;
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.trial_will_end":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      const sub = event.data.object as Stripe.Subscription;
      subscription = subscriptionPayload(sub);
      customerId = customerIdOf(sub);
      creatorIdFromMetadata = sub.metadata?.creatorId;
      break;
    }
    case "checkout.session.completed":
    case "invoice.paid":
    case "invoice.payment_failed":
      customerId = customerIdOf(obj as { customer?: string | { id: string } | null });
      creatorIdFromMetadata = (obj.metadata as Record<string, string> | undefined)?.creatorId;
      break;
    default:
      return new Response("ignored", { status: 200 });
  }

  const r = await ctx.runMutation(internal.billing.plan.applyEvent, { eventId: event.id, type: event.type, livemode: event.livemode, createdAt: event.created, customerId, creatorIdFromMetadata, subscription });

  // Maya's one line per state change, and the day-5 text.
  const appUrl = process.env.APP_URL ?? "";
  if (r.change) {
    const body = messageFor(r.change.prev, r.change.next, appUrl);
    if (body) await ctx.runMutation(internal.core.messages.send, { creatorId: r.change.creatorId, surface: "telegram", body, dedupeKey: `billing:${r.change.next}:${event.id}`, proactive: false, kind: "status" });
  } else if (event.type === "customer.subscription.trial_will_end" && customerId) {
    const creator = await ctx.runQuery(internal.billing.plan.byStripeCustomer, { stripeCustomerId: customerId });
    if (creator && creator.plan.status === "trialing") {
      const ends = creator.plan.trialEndsAt ? new Date(creator.plan.trialEndsAt).toLocaleDateString("en-US", { weekday: "long", timeZone: creator.timezone }) : "in three days";
      await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body: `your trial ends ${ends}; the card gets charged then, nothing changes on my side. if you want out before that, it's one tap in settings: ${appUrl}/app/settings`, dedupeKey: `billing:trial_will_end:${creator.plan.stripeSubscriptionId ?? event.id}`, proactive: false, kind: "status" });
    }
  }
  return new Response(JSON.stringify({ ok: true, detail: r.detail }), { status: 200, headers: { "content-type": "application/json" } });
});
