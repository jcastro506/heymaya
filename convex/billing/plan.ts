/**
 * The plan state machine (plan §19.3), as rows. This file is the ONLY writer of
 * `creators.plan` status from billing: webhooks land here, idempotent by event id,
 * and out-of-order events resolve by the subscription's own timestamps, never by
 * arrival order. Maya sends exactly one message per state change, in her voice, and
 * never nags; the gate reads the plan row, nothing is checked on the client.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { FOUNDING_SEATS } from "./stripe";

export type PlanStatus = Doc<"creators">["plan"]["status"];

/** What Stripe's subscription status means for us (§19.3). */
export function statusFromStripe(sub: { status: string; cancel_at_period_end?: boolean }): PlanStatus | null {
  switch (sub.status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null; // incomplete: nothing to say yet
  }
}

/** One line, once, per state change. Never for a state that did not change. */
export function messageFor(prev: PlanStatus, next: PlanStatus, appUrl: string): string | null {
  if (prev === next) return null;
  switch (next) {
    case "active":
      return prev === "trialing" ? "we're official. same me, same cadence; you'll get the sunday review as usual." : prev === "past_due" ? "payment went through, all good. carrying on." : null;
    case "past_due":
      return `your card didn't go through. stripe will retry on its own; update it here when you get a minute: ${appUrl}/app/settings — i'll keep going for a few days either way.`;
    case "paused":
      return "paused, no charge. say resume when you want me back; i'll still answer if you write.";
    case "canceled":
      return `understood, we're done for now. your export is here if you want it: ${appUrl}/api/account/export — the door's open.`;
    default:
      return null;
  }
}

export const byStripeCustomer = internalQuery({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, a): Promise<Doc<"creators"> | null> =>
    (await ctx.db.query("creators").withIndex("by_stripe_customer", (q) => q.eq("plan.stripeCustomerId", a.stripeCustomerId)).first()) as Doc<"creators"> | null,
});

/** Founding seats: the first hundred paying creators, locked while they stay (§19.1). Counted at checkout time. */
export const foundingSeatsTaken = internalQuery({
  args: {},
  handler: async (ctx): Promise<number> => {
    const rows = (await ctx.db.query("creators").filter((q) => q.eq(q.field("plan.founding"), true)).collect()) as Doc<"creators">[];
    return rows.filter((c) => c.plan.stripeSubscriptionId).length;
  },
});

export const setStripeCustomer = internalMutation({
  args: { creatorId: v.id("creators"), stripeCustomerId: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    await ctx.db.patch(a.creatorId, { plan: { ...c.plan, stripeCustomerId: a.stripeCustomerId }, updatedAt: Date.now() });
    return null;
  },
});

/** Every event lands here once. Returns what changed, so the caller can say one line. */
export const applyEvent = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    livemode: v.boolean(),
    createdAt: v.number(), // Stripe's event.created, seconds
    customerId: v.optional(v.string()),
    creatorIdFromMetadata: v.optional(v.string()),
    subscription: v.optional(v.object({ id: v.string(), status: v.string(), cancel_at_period_end: v.optional(v.boolean()), trial_end: v.union(v.number(), v.null()), current_period_end: v.union(v.number(), v.null()), founding: v.optional(v.boolean()) })),
  },
  handler: async (ctx, a): Promise<{ handled: boolean; detail: string; change: null | { creatorId: Id<"creators">; prev: PlanStatus; next: PlanStatus } }> => {
    const seen = await ctx.db.query("stripeWebhookEvents").withIndex("by_event_id", (q) => q.eq("eventId", a.eventId)).first();
    if (seen) {
      await ctx.db.insert("stripeWebhookEvents", { eventId: a.eventId, type: a.type, livemode: a.livemode, status: "replay_dropped", detail: `replay of ${seen._id}`, receivedAt: Date.now() });
      return { handled: false, detail: "replay", change: null };
    }
    const record = async (status: "processed" | "skipped" | "errored", detail: string) => {
      await ctx.db.insert("stripeWebhookEvents", { eventId: a.eventId, type: a.type, livemode: a.livemode, status, detail, customerId: a.customerId, receivedAt: Date.now() });
    };

    if (!a.customerId) {
      await record("skipped", "no customer on event");
      return { handled: false, detail: "no customer", change: null };
    }
    const creator = (await ctx.db.query("creators").withIndex("by_stripe_customer", (q) => q.eq("plan.stripeCustomerId", a.customerId!)).first()) as Doc<"creators"> | null;
    if (!creator) {
      await record("skipped", "no creator for customer");
      return { handled: false, detail: "no creator", change: null };
    }
    // Cross-tenant: metadata must agree with the customer lookup, or nothing is patched.
    if (a.creatorIdFromMetadata && a.creatorIdFromMetadata !== creator._id) {
      await record("errored", `metadata creator ${a.creatorIdFromMetadata} ≠ customer's creator ${creator._id}`);
      return { handled: false, detail: "tenant mismatch", change: null };
    }
    if (!a.subscription) {
      await record("processed", "no subscription payload; audited only");
      return { handled: true, detail: "audited", change: null };
    }

    // Out of order: an event older than the last one applied to this subscription changes nothing.
    const eventMs = a.createdAt * 1000;
    if (creator.plan.lastEventAt && creator.plan.stripeSubscriptionId === a.subscription.id && eventMs < creator.plan.lastEventAt) {
      await record("skipped", `older than last applied (${new Date(creator.plan.lastEventAt).toISOString()})`);
      return { handled: false, detail: "stale", change: null };
    }
    const next = statusFromStripe(a.subscription);
    if (!next) {
      await record("skipped", `subscription status ${a.subscription.status} has no plan meaning`);
      return { handled: false, detail: "no meaning", change: null };
    }
    const prev = creator.plan.status;
    const now = Date.now();
    await ctx.db.patch(creator._id, {
      plan: {
        ...creator.plan,
        stripeSubscriptionId: a.subscription.id,
        status: prev === "deleting" ? "deleting" : next, // deletion wins over anything Stripe says
        founding: creator.plan.founding || Boolean(a.subscription.founding),
        trialEndsAt: a.subscription.trial_end ? a.subscription.trial_end * 1000 : creator.plan.trialEndsAt,
        currentPeriodEnd: a.subscription.current_period_end ? a.subscription.current_period_end * 1000 : creator.plan.currentPeriodEnd,
        pastDueSince: next === "past_due" ? (creator.plan.pastDueSince ?? now) : undefined,
        lastEventAt: eventMs,
      },
      updatedAt: now,
    });
    await record("processed", `${prev} → ${next}`);
    return { handled: true, detail: `${prev} → ${next}`, change: prev !== next && prev !== "deleting" ? { creatorId: creator._id, prev, next } : null };
  },
});

export const seatsLeft = internalQuery({
  args: {},
  handler: async (ctx): Promise<number> => {
    const rows = (await ctx.db.query("creators").filter((q) => q.eq(q.field("plan.founding"), true)).collect()) as Doc<"creators">[];
    return Math.max(0, FOUNDING_SEATS - rows.filter((c) => c.plan.stripeSubscriptionId).length);
  },
});
