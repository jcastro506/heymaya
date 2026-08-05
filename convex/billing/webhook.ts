/**
 * Stripe webhook handlers — Sprint 6B.
 *
 * Internal mutations called by `app/api/billing/stripe-webhook/route.ts`
 * after the route verifies the Stripe signature. The split between the route
 * (signature verification + Stripe SDK calls) and these handlers (Convex DB
 * patches) keeps the webhook idempotent + testable without HTTP traffic.
 *
 * Plan-tier source of truth: these handlers are the ONLY writers to
 * `creators.plan`. The frontend never patches `plan` directly. If you find
 * yourself writing a `ctx.db.patch(creator, { plan })` outside this file, you
 * are likely violating the architecture rule (see CLAUDE.md § Architecture).
 *
 * Cross-tenant safety: we always resolve creator by `stripeCustomerId` (or
 * by the `creatorId` carried in `metadata` AND require it to match the row
 * we look up by customer). A webhook for Customer A can never patch Creator
 * B because the customer→creator lookup is single-row + indexed.
 *
 * Idempotency: every event is recorded in `stripeWebhookEvents`. Replays
 * (same `eventId`) produce a `replay_dropped` audit row and exit without
 * patching the creator.
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertWebhookSecret } from "../lib/webhookSecret";

const TIER_VALIDATOR = v.union(
  v.literal("coach"),
  v.literal("manager")
);
const INTERVAL_VALIDATOR = v.union(
  v.literal("monthly"),
  v.literal("annual")
);

/* -------------------------------------------------------------------------- */
/* Audit log writer                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Write to `stripeWebhookEvents` with replay defense. Returns
 * `{ alreadySeen: true }` if the event id was previously processed — caller
 * should short-circuit and skip any further state changes.
 *
 * The replay row is preserved (one extra row per redelivery) so the operator
 * can audit Stripe's redelivery cadence. Only the FIRST row drives any DB
 * patch — second/third/Nth land as `replay_dropped`.
 */
export const recordWebhookEvent = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    livemode: v.boolean(),
    status: v.union(
      v.literal("processed"),
      v.literal("replay_dropped"),
      v.literal("errored"),
      v.literal("skipped")
    ),
    detail: v.optional(v.string()),
    customerId: v.optional(v.string()),
    rawPayload: v.any(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ alreadySeen: boolean; rowId: Id<"stripeWebhookEvents"> }> => {
    const existing = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existing) {
      const replayRow = await ctx.db.insert("stripeWebhookEvents", {
        eventId: args.eventId,
        type: args.type,
        livemode: args.livemode,
        status: "replay_dropped",
        detail: `replay of ${existing._id}`,
        customerId: args.customerId,
        receivedAt: Date.now(),
        rawPayload: args.rawPayload,
      });
      return { alreadySeen: true, rowId: replayRow };
    }
    const rowId = await ctx.db.insert("stripeWebhookEvents", {
      eventId: args.eventId,
      type: args.type,
      livemode: args.livemode,
      status: args.status,
      detail: args.detail,
      customerId: args.customerId,
      receivedAt: Date.now(),
      rawPayload: args.rawPayload,
    });
    return { alreadySeen: false, rowId };
  },
});

/* -------------------------------------------------------------------------- */
/* Creator resolver                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a creators row by stripeCustomerId. Linear scan via filter on a
 * tiny table (1 row per creator); webhook arrival is bounded by Stripe's
 * per-account caps. If this ever becomes hot, add a
 * `.index("by_stripe_customer", ["stripeCustomerId"])` and rebuild here.
 */
async function findCreatorByStripeCustomerId(
  ctx: MutationCtx,
  stripeCustomerId: string
): Promise<Doc<"creators"> | null> {
  return await ctx.db
    .query("creators")
    .filter((q) => q.eq(q.field("stripeCustomerId"), stripeCustomerId))
    .first();
}

/* -------------------------------------------------------------------------- */
/* checkout.session.completed handler                                          */
/* -------------------------------------------------------------------------- */

/**
 * Patch the creator with the new subscription details after Checkout
 * completes. Source of truth for first-time conversion.
 *
 * Cross-tenant: we look up the creator BY stripeCustomerId, then assert that
 * the metadata's creatorId matches the row we resolved. If they disagree we
 * refuse to patch (anti-tenant-bleed) and return `errored`.
 */
export const handleCheckoutCompleted = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    subscriptionId: v.string(),
    creatorId: v.optional(v.id("creators")),
    tier: TIER_VALIDATOR,
    interval: INTERVAL_VALIDATOR,
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    patched: boolean;
    reason?: "no_creator" | "creator_mismatch";
  }> => {
    const creator = await findCreatorByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!creator) {
      return { patched: false, reason: "no_creator" };
    }
    // Defense in depth: if metadata carried a creatorId, it must match.
    // Disagreement here implies a forged webhook (signature would have
    // already been verified upstream) OR a Stripe-side data corruption
    // — either way, refuse the patch.
    if (args.creatorId && args.creatorId !== creator._id) {
      return { patched: false, reason: "creator_mismatch" };
    }

    await ctx.db.patch(creator._id, {
      plan: args.tier,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.subscriptionId,
      currentPlanPeriodEnd: args.currentPeriodEnd,
      trialEndsAt: args.trialEnd,
      billingInterval: args.interval,
    });
    return { patched: true };
  },
});

/* -------------------------------------------------------------------------- */
/* customer.subscription.updated handler                                       */
/* -------------------------------------------------------------------------- */

/**
 * Patch the creator on every Stripe subscription update — handles plan
 * changes, trial → active transitions, and renewal-cycle period rollovers.
 *
 * Same cross-tenant guard as `handleCheckoutCompleted`.
 *
 * If the incoming `tier` differs from the creator's current `plan`, that's a
 * legitimate plan change (upgrade or downgrade via portal). We patch and
 * trust the upstream caller — the route resolves `tier` from
 * `metadata.tier` first and falls back to `priceIdToPlanTuple()` only if
 * metadata is missing.
 */
export const handleSubscriptionUpdated = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    subscriptionId: v.string(),
    creatorId: v.optional(v.id("creators")),
    tier: TIER_VALIDATOR,
    interval: INTERVAL_VALIDATOR,
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    patched: boolean;
    reason?: "no_creator" | "creator_mismatch";
  }> => {
    const creator = await findCreatorByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!creator) {
      return { patched: false, reason: "no_creator" };
    }
    if (args.creatorId && args.creatorId !== creator._id) {
      return { patched: false, reason: "creator_mismatch" };
    }
    await ctx.db.patch(creator._id, {
      plan: args.tier,
      stripeSubscriptionId: args.subscriptionId,
      currentPlanPeriodEnd: args.currentPeriodEnd,
      trialEndsAt: args.trialEnd,
      billingInterval: args.interval,
    });
    return { patched: true };
  },
});

/* -------------------------------------------------------------------------- */
/* customer.subscription.deleted handler                                       */
/* -------------------------------------------------------------------------- */

/**
 * Subscription cancelled (creator-initiated via portal OR Stripe-initiated
 * after dunning failure). Coach + Manager 2-tier model has NO free tier —
 * Coach is the $19.99 floor. On cancel:
 *   - Set `plan` to `"coach"` (downgrade-by-default). Cleaner UX than
 *     fail-closed undefined: creator keeps a usable Maya at the lowest
 *     paid floor and Profile surfaces the "reactivate Manager" CTA.
 *     Plan-tier gates upstream still keep Manager-only features locked.
 *   - Clear billing-related fields so Profile doesn't show stale
 *     "renews on YYYY-MM-DD" text after cancellation.
 *   - We do NOT touch `connectedAccounts` — the creator can resubscribe
 *     and keep their Gmail / Calendar / Stripe / Apollo / Hunter
 *     connections intact. Plan-tier gates upstream silently no-op the
 *     Manager-only rows while plan is `"coach"`.
 *   - `stripeCustomerId` stays — same customer, just unsubscribed. A
 *     resubscribe via Checkout reuses the existing customer (and skips
 *     the 7-day trial; trial is first-sub-only).
 */
export const handleSubscriptionDeleted = internalMutation({
  args: {
    stripeCustomerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ patched: boolean; reason?: "no_creator" }> => {
    const creator = await findCreatorByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!creator) {
      return { patched: false, reason: "no_creator" };
    }
    await ctx.db.patch(creator._id, {
      // Cancellation downgrades to Coach (the post-trial / post-cancel floor).
      plan: "coach",
      stripeSubscriptionId: undefined,
      currentPlanPeriodEnd: undefined,
      trialEndsAt: undefined,
      billingInterval: undefined,
    });
    return { patched: true };
  },
});

/* -------------------------------------------------------------------------- */
/* customer.subscription.trial_will_end handler                                */
/* -------------------------------------------------------------------------- */

/**
 * Stripe fires this 3 days before the trial ends. We log to `gtmAuditEvents`
 * with eventType="billing.trial-ending" so the nudge wiring can surface a
 * Maya-side message ("trial ends Friday — keep your card to stay on Pro,
 * otherwise I downgrade to Starter").
 *
 * This is the second write for the event: the webhook route has already put a
 * durable row in `stripeWebhookEvents`. That one is the delivery receipt; this
 * one is the account-scoped timeline Maya reads.
 *
 * No DB patch on the creator here — Stripe is going to fire
 * `customer.subscription.updated` (and eventually `.deleted`) when the trial
 * actually ends, and those handlers do the real work.
 */
export const handleTrialWillEnd = internalMutation({
  args: {
    stripeCustomerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ logged: boolean }> => {
    const creator = await findCreatorByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!creator) {
      return { logged: false };
    }
    await ctx.db.insert("gtmAuditEvents", {
      accountId: creator._id,
      actor: "system",
      eventType: "billing.trial-ending",
      severity: "info",
      message: "Stripe says the trial ends in 3 days.",
      metadata: { stripeCustomerId: args.stripeCustomerId },
      createdAt: Date.now(),
    });
    return { logged: true };
  },
});

/* -------------------------------------------------------------------------- */
/* Public webhook bridge wrappers                                              */
/* -------------------------------------------------------------------------- */

/**
 * Public-callable bridges that the Stripe webhook route in Next.js calls.
 * `ConvexHttpClient` cannot reach `internal.*` references (TS2345). Each
 * webhook-facing handler exposes a thin public wrapper that:
 *   1. Validates a shared `WEBHOOK_INTERNAL_SECRET` (constant-time, fail-
 *      closed). Operator must set the secret in BOTH Next.js env and
 *      Convex env.
 *   2. Inlines the underlying handler body. Convex doesn't allow
 *      mutation→mutation invocation, so duplicating the small body here is
 *      the safest path. KEEP IN SYNC with the internal handlers above.
 *
 * Cross-tenant safety is unchanged — these wrappers preserve the
 * `findCreatorByStripeCustomerId` + metadata.creatorId mismatch checks.
 */

const TIER_VALIDATOR_PUB = TIER_VALIDATOR;
const INTERVAL_VALIDATOR_PUB = INTERVAL_VALIDATOR;

const WEBHOOK_STATUS_VALIDATOR = v.union(
  v.literal("processed"),
  v.literal("replay_dropped"),
  v.literal("errored"),
  v.literal("skipped")
);

export const recordWebhookEventPublic = mutation({
  args: {
    secret: v.string(),
    eventId: v.string(),
    type: v.string(),
    livemode: v.boolean(),
    status: WEBHOOK_STATUS_VALIDATOR,
    detail: v.optional(v.string()),
    customerId: v.optional(v.string()),
    rawPayload: v.any(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ alreadySeen: boolean; rowId: Id<"stripeWebhookEvents"> }> => {
    assertWebhookSecret(args.secret);
    const existing = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existing) {
      const replayRow = await ctx.db.insert("stripeWebhookEvents", {
        eventId: args.eventId,
        type: args.type,
        livemode: args.livemode,
        status: "replay_dropped",
        detail: `replay of ${existing._id}`,
        customerId: args.customerId,
        receivedAt: Date.now(),
        rawPayload: args.rawPayload,
      });
      return { alreadySeen: true, rowId: replayRow };
    }
    const rowId = await ctx.db.insert("stripeWebhookEvents", {
      eventId: args.eventId,
      type: args.type,
      livemode: args.livemode,
      status: args.status,
      detail: args.detail,
      customerId: args.customerId,
      receivedAt: Date.now(),
      rawPayload: args.rawPayload,
    });
    return { alreadySeen: false, rowId };
  },
});

export const handleCheckoutCompletedPublic = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
    subscriptionId: v.string(),
    creatorId: v.optional(v.id("creators")),
    tier: TIER_VALIDATOR_PUB,
    interval: INTERVAL_VALIDATOR_PUB,
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    patched: boolean;
    reason?: "no_creator" | "creator_mismatch";
  }> => {
    assertWebhookSecret(args.secret);
    const creator = await findCreatorByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!creator) return { patched: false, reason: "no_creator" };
    if (args.creatorId && args.creatorId !== creator._id) {
      return { patched: false, reason: "creator_mismatch" };
    }
    await ctx.db.patch(creator._id, {
      plan: args.tier,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.subscriptionId,
      currentPlanPeriodEnd: args.currentPeriodEnd,
      trialEndsAt: args.trialEnd,
      billingInterval: args.interval,
    });
    return { patched: true };
  },
});

export const handleSubscriptionUpdatedPublic = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
    subscriptionId: v.string(),
    creatorId: v.optional(v.id("creators")),
    tier: TIER_VALIDATOR_PUB,
    interval: INTERVAL_VALIDATOR_PUB,
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    patched: boolean;
    reason?: "no_creator" | "creator_mismatch";
  }> => {
    assertWebhookSecret(args.secret);
    const creator = await findCreatorByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!creator) return { patched: false, reason: "no_creator" };
    if (args.creatorId && args.creatorId !== creator._id) {
      return { patched: false, reason: "creator_mismatch" };
    }
    await ctx.db.patch(creator._id, {
      plan: args.tier,
      stripeSubscriptionId: args.subscriptionId,
      currentPlanPeriodEnd: args.currentPeriodEnd,
      trialEndsAt: args.trialEnd,
      billingInterval: args.interval,
    });
    return { patched: true };
  },
});

export const handleSubscriptionDeletedPublic = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ patched: boolean; reason?: "no_creator" }> => {
    assertWebhookSecret(args.secret);
    const creator = await findCreatorByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!creator) return { patched: false, reason: "no_creator" };
    await ctx.db.patch(creator._id, {
      // Cancellation downgrades to Coach (the post-trial / post-cancel floor).
      plan: "coach",
      stripeSubscriptionId: undefined,
      currentPlanPeriodEnd: undefined,
      trialEndsAt: undefined,
      billingInterval: undefined,
    });
    return { patched: true };
  },
});

export const handleTrialWillEndPublic = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ logged: boolean }> => {
    assertWebhookSecret(args.secret);
    const creator = await findCreatorByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!creator) return { logged: false };
    await ctx.db.insert("gtmAuditEvents", {
      accountId: creator._id,
      actor: "system",
      eventType: "billing.trial-ending",
      severity: "info",
      message: "Stripe says the trial ends in 3 days.",
      metadata: { stripeCustomerId: args.stripeCustomerId },
      createdAt: Date.now(),
    });
    return { logged: true };
  },
});
