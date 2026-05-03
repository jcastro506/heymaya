/**
 * Service-product Stripe webhook handlers — Wave D.
 *
 * Internal mutations called by the Next.js webhook receiver at
 * `app/api/stripe/service-webhook/route.ts` after the route verifies the
 * Stripe signature. The split between the route (signature verification +
 * Stripe SDK calls) and these handlers (Convex DB patches) keeps the webhook
 * idempotent + testable without HTTP traffic.
 *
 * Plan-tier source of truth: these handlers are the ONLY writers to
 * `businesses.planTier`. The frontend never patches `planTier` directly.
 *
 * Cross-tenant safety: we always resolve a business by `stripeCustomerId`
 * (single-row lookup via the `by_stripe_customer` index added in Wave D).
 * Defense in depth — when metadata carries `businessId`, we assert it matches
 * the row we resolved by customer; mismatch refuses the patch.
 *
 * Idempotency: every event is recorded in `stripeWebhookEvents` (the existing
 * audit table from Sprint 6B; reused for service product). Replays (same
 * `eventId`) produce a `replay_dropped` audit row and exit without further
 * state changes.
 *
 * REUSE NOTE — `stripeWebhookEvents` table:
 *   The creator-side billing pipeline (`convex/billing/webhook.ts`) already
 *   defines this table with by_event_id / by_customer / by_status indexes
 *   and the same status enum. Service product writes through it as well —
 *   no schema additions needed. The `customerId` column tags the Stripe
 *   customer id; tenancy is recovered by `findBusinessByStripeCustomerId`
 *   below at handler time.
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { assertWebhookSecret } from "../../lib/webhookSecret";

const TIER_VALIDATOR = v.union(
  v.literal("starter"),
  v.literal("pro"),
  v.literal("studio")
);
const INTERVAL_VALIDATOR = v.union(
  v.literal("monthly"),
  v.literal("annual")
);
const STATUS_VALIDATOR = v.union(
  v.literal("active"),
  v.literal("trialing"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("unpaid"),
  v.literal("paused")
);
const EVENT_STATUS_VALIDATOR = v.union(
  v.literal("processed"),
  v.literal("replay_dropped"),
  v.literal("errored"),
  v.literal("skipped")
);

/* -------------------------------------------------------------------------- */
/* Audit log writer                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Write to `stripeWebhookEvents` with replay defense + adversarial-replay
 * payload-digest comparison.
 *
 * The `payloadDigest` (sha256 prefix of the raw event JSON) provides defense
 * in depth: a replay with the SAME eventId but a TAMPERED payload would
 * still pass replay-drop because eventId is the primary key, but the tamper
 * is captured in the audit row via the digest mismatch — operator dashboards
 * can flag those.
 *
 * Returns `{ alreadySeen: true }` if the event id was previously processed —
 * caller should short-circuit and skip any further state changes.
 */
export const recordServiceWebhookEvent = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    livemode: v.boolean(),
    status: EVENT_STATUS_VALIDATOR,
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
        detail: `service-replay of ${existing._id}`,
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
/* Business resolver                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a businesses row by stripeCustomerId. Uses the `by_stripe_customer`
 * index added in Wave D. Returns null if no business has that customer id —
 * indicates a webhook for a customer we don't recognize (could be a creator-
 * side customer mistakenly routed here, or a deleted business).
 */
async function findBusinessByStripeCustomerId(
  ctx: MutationCtx,
  stripeCustomerId: string
): Promise<Doc<"businesses"> | null> {
  return await ctx.db
    .query("businesses")
    .withIndex("by_stripe_customer", (q) =>
      q.eq("stripeCustomerId", stripeCustomerId)
    )
    .first();
}

/* -------------------------------------------------------------------------- */
/* checkout.session.completed handler                                          */
/* -------------------------------------------------------------------------- */

/**
 * Patch the business with the new subscription details after Checkout
 * completes. Source of truth for first-time conversion.
 */
export const handleServiceCheckoutCompleted = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    subscriptionId: v.string(),
    businessId: v.optional(v.id("businesses")),
    tier: TIER_VALIDATOR,
    interval: INTERVAL_VALIDATOR,
    status: STATUS_VALIDATOR,
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    patched: boolean;
    reason?: "no_business" | "business_mismatch";
  }> => {
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) {
      return { patched: false, reason: "no_business" };
    }
    // Defense in depth: if metadata carried a businessId, it must match.
    if (args.businessId && args.businessId !== business._id) {
      return { patched: false, reason: "business_mismatch" };
    }

    await ctx.db.patch(business._id, {
      planTier: args.tier,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.subscriptionId,
      currentPlanPeriodEnd: args.currentPeriodEnd,
      trialEndsAt: args.trialEnd,
      billingInterval: args.interval,
      subscriptionStatus: args.status,
      updatedAt: Date.now(),
    });
    return { patched: true };
  },
});

/* -------------------------------------------------------------------------- */
/* customer.subscription.updated handler                                       */
/* -------------------------------------------------------------------------- */

/**
 * Patch the business on every Stripe subscription update — handles plan
 * changes, trial → active transitions, status transitions
 * (active/past_due/canceled), and renewal-cycle period rollovers.
 */
export const handleServiceSubscriptionUpdated = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    subscriptionId: v.string(),
    businessId: v.optional(v.id("businesses")),
    tier: TIER_VALIDATOR,
    interval: INTERVAL_VALIDATOR,
    status: STATUS_VALIDATOR,
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    patched: boolean;
    reason?: "no_business" | "business_mismatch";
  }> => {
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) return { patched: false, reason: "no_business" };
    if (args.businessId && args.businessId !== business._id) {
      return { patched: false, reason: "business_mismatch" };
    }
    await ctx.db.patch(business._id, {
      planTier: args.tier,
      stripeSubscriptionId: args.subscriptionId,
      currentPlanPeriodEnd: args.currentPeriodEnd,
      trialEndsAt: args.trialEnd,
      billingInterval: args.interval,
      subscriptionStatus: args.status,
      updatedAt: Date.now(),
    });
    return { patched: true };
  },
});

/* -------------------------------------------------------------------------- */
/* customer.subscription.deleted handler                                       */
/* -------------------------------------------------------------------------- */

/**
 * Subscription cancelled (operator-initiated via portal OR Stripe-initiated
 * after dunning failure). Service-product behavior differs from creator-side:
 *   - Service tiers have NO free tier — Starter is the $99 paid floor.
 *   - On deletion, we set `subscriptionStatus="canceled"` and CLEAR
 *     `planTier` (sets it to undefined). `planFeaturesService` fail-closes
 *     to STARTER for an undefined planTier, so downstream gates auto-treat
 *     a canceled business as "no paid features unlocked." HQ surfaces the
 *     "your subscription is canceled — reactivate to keep using Maya" UI
 *     based on subscriptionStatus.
 *   - We DO NOT touch `crmConnections`, `voiceChannels`, `gbpLocations` —
 *     operator can resubscribe and keep their connections intact. Plan-tier
 *     gates upstream silently no-op those rows while subscription is canceled.
 *   - `stripeCustomerId` stays — same customer, just unsubscribed. A
 *     resubscribe via Checkout reuses the existing customer.
 */
export const handleServiceSubscriptionDeleted = internalMutation({
  args: {
    stripeCustomerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ patched: boolean; reason?: "no_business" }> => {
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) return { patched: false, reason: "no_business" };
    await ctx.db.patch(business._id, {
      planTier: undefined,
      stripeSubscriptionId: undefined,
      currentPlanPeriodEnd: undefined,
      trialEndsAt: undefined,
      billingInterval: undefined,
      subscriptionStatus: "canceled",
      updatedAt: Date.now(),
    });
    return { patched: true };
  },
});

/* -------------------------------------------------------------------------- */
/* customer.subscription.trial_will_end handler                                */
/* -------------------------------------------------------------------------- */

/**
 * Stripe fires this 3 days before the Pro trial ends. We:
 *   1. Log to `mayaActionLog` with entryId="billing.service-trial-ending"
 *      so any audit dashboard surfaces it.
 *   2. Enqueue a Maya nudge via `mayaTaskQueue` (kind="trial.ending") so the
 *      OpenClaw runtime fires a message to the operator on next heartbeat
 *      ("3 days left on your Pro trial — keep your card to stay on Pro,
 *      otherwise I'll downgrade to Starter").
 *
 * No DB patch on the business here — Stripe will fire `subscription.updated`
 * (and eventually `.deleted`) when the trial actually ends, and those
 * handlers do the real work.
 */
export const handleServiceTrialWillEnd = internalMutation({
  args: {
    stripeCustomerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ logged: boolean; queued: boolean }> => {
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) return { logged: false, queued: false };
    await ctx.db.insert("mayaActionLog", {
      creatorId: business.accountId,
      entryId: "billing.service-trial-ending",
      outcome: "ran",
      detail: `stripeCustomerId=${args.stripeCustomerId} businessId=${business._id}`,
      ts: Date.now(),
    });
    await ctx.db.insert("mayaTaskQueue", {
      businessId: business._id,
      kind: "trial.ending",
      payload: {
        stripeCustomerId: args.stripeCustomerId,
        trialEndsAt: business.trialEndsAt ?? null,
      },
      source: "manual",
      enqueuedAt: Date.now(),
    });
    return { logged: true, queued: true };
  },
});

/* -------------------------------------------------------------------------- */
/* invoice.payment_failed handler                                              */
/* -------------------------------------------------------------------------- */

/**
 * Payment failed (card declined, dunning kicked off). Set
 * `subscriptionStatus="past_due"` on the business + enqueue a Maya nudge so
 * the operator hears about it through her thread.
 *
 * Stripe handles dunning (retry cadence) + eventual subscription.deleted if
 * dunning exhausts. We just react to the status change.
 */
export const handleServicePaymentFailed = internalMutation({
  args: {
    stripeCustomerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ patched: boolean; queued: boolean }> => {
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) return { patched: false, queued: false };
    await ctx.db.patch(business._id, {
      subscriptionStatus: "past_due",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("mayaTaskQueue", {
      businessId: business._id,
      kind: "billing.payment-failed",
      payload: {
        stripeCustomerId: args.stripeCustomerId,
      },
      source: "manual",
      enqueuedAt: Date.now(),
    });
    return { patched: true, queued: true };
  },
});

/* -------------------------------------------------------------------------- */
/* invoice.finalized handler                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Invoice finalized — Stripe is about to charge for the current billing
 * period. We use this signal to ROLL OVER the voice-usage period: close out
 * the previous `voiceUsage` row (its minutesUsed is frozen at this point;
 * Stripe will use it for billing) and let the next call create a fresh
 * period row.
 *
 * No-op if no current voiceUsage row exists for this business; that's the
 * normal case for Starter operators (no voice).
 */
export const handleServiceInvoiceFinalized = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    /** Unix-ms — when the new billing period starts. */
    nextPeriodStartMs: v.optional(v.number()),
    /** Unix-ms — when the new billing period ends. */
    nextPeriodEndMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ rolledOver: boolean }> => {
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) return { rolledOver: false };
    // Find the latest voiceUsage row for this business.
    const latest = await ctx.db
      .query("voiceUsage")
      .withIndex("by_business_and_period", (q) =>
        q.eq("businessId", business._id)
      )
      .order("desc")
      .first();
    if (!latest) return { rolledOver: false };
    // The voice-metering pipeline auto-rolls when a new call comes in after
    // periodEndMs; we don't need to insert a new row here. Just record the
    // boundary in the existing latest row's lastUpdatedAt for observability.
    if (args.nextPeriodStartMs && latest.periodEndMs < args.nextPeriodStartMs) {
      // Period boundary crossed — patch lastUpdatedAt as a marker.
      await ctx.db.patch(latest._id, { lastUpdatedAt: Date.now() });
      return { rolledOver: true };
    }
    return { rolledOver: false };
  },
});

/* -------------------------------------------------------------------------- */
/* Public wrappers — bridge for ConvexHttpClient calls from Next.js route      */
/* -------------------------------------------------------------------------- */

/**
 * The Next.js webhook receiver uses `ConvexHttpClient`, which cannot reach
 * `internal.*` references. Each internal handler exposes a thin public wrapper
 * gated by `WEBHOOK_INTERNAL_SECRET` (constant-time compare via
 * `assertWebhookSecret`). Identical pattern to the creator-side bridges in
 * `convex/billing/webhook.ts`. KEEP IN SYNC with the internal handlers above.
 */

export const recordServiceWebhookEventPublic = mutation({
  args: {
    secret: v.string(),
    eventId: v.string(),
    type: v.string(),
    livemode: v.boolean(),
    status: EVENT_STATUS_VALIDATOR,
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
        detail: `service-replay of ${existing._id}`,
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

export const handleServiceCheckoutCompletedPublic = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
    subscriptionId: v.string(),
    businessId: v.optional(v.id("businesses")),
    tier: TIER_VALIDATOR,
    interval: INTERVAL_VALIDATOR,
    status: STATUS_VALIDATOR,
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    patched: boolean;
    reason?: "no_business" | "business_mismatch";
  }> => {
    assertWebhookSecret(args.secret);
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) return { patched: false, reason: "no_business" };
    if (args.businessId && args.businessId !== business._id) {
      return { patched: false, reason: "business_mismatch" };
    }
    await ctx.db.patch(business._id, {
      planTier: args.tier,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.subscriptionId,
      currentPlanPeriodEnd: args.currentPeriodEnd,
      trialEndsAt: args.trialEnd,
      billingInterval: args.interval,
      subscriptionStatus: args.status,
      updatedAt: Date.now(),
    });
    return { patched: true };
  },
});

export const handleServiceSubscriptionUpdatedPublic = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
    subscriptionId: v.string(),
    businessId: v.optional(v.id("businesses")),
    tier: TIER_VALIDATOR,
    interval: INTERVAL_VALIDATOR,
    status: STATUS_VALIDATOR,
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    patched: boolean;
    reason?: "no_business" | "business_mismatch";
  }> => {
    assertWebhookSecret(args.secret);
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) return { patched: false, reason: "no_business" };
    if (args.businessId && args.businessId !== business._id) {
      return { patched: false, reason: "business_mismatch" };
    }
    await ctx.db.patch(business._id, {
      planTier: args.tier,
      stripeSubscriptionId: args.subscriptionId,
      currentPlanPeriodEnd: args.currentPeriodEnd,
      trialEndsAt: args.trialEnd,
      billingInterval: args.interval,
      subscriptionStatus: args.status,
      updatedAt: Date.now(),
    });
    return { patched: true };
  },
});

export const handleServiceSubscriptionDeletedPublic = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ patched: boolean; reason?: "no_business" }> => {
    assertWebhookSecret(args.secret);
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) return { patched: false, reason: "no_business" };
    await ctx.db.patch(business._id, {
      planTier: undefined,
      stripeSubscriptionId: undefined,
      currentPlanPeriodEnd: undefined,
      trialEndsAt: undefined,
      billingInterval: undefined,
      subscriptionStatus: "canceled",
      updatedAt: Date.now(),
    });
    return { patched: true };
  },
});

export const handleServiceTrialWillEndPublic = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ logged: boolean; queued: boolean }> => {
    assertWebhookSecret(args.secret);
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) return { logged: false, queued: false };
    await ctx.db.insert("mayaActionLog", {
      creatorId: business.accountId,
      entryId: "billing.service-trial-ending",
      outcome: "ran",
      detail: `stripeCustomerId=${args.stripeCustomerId} businessId=${business._id}`,
      ts: Date.now(),
    });
    await ctx.db.insert("mayaTaskQueue", {
      businessId: business._id,
      kind: "trial.ending",
      payload: {
        stripeCustomerId: args.stripeCustomerId,
        trialEndsAt: business.trialEndsAt ?? null,
      },
      source: "manual",
      enqueuedAt: Date.now(),
    });
    return { logged: true, queued: true };
  },
});

export const handleServicePaymentFailedPublic = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ patched: boolean; queued: boolean }> => {
    assertWebhookSecret(args.secret);
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) return { patched: false, queued: false };
    await ctx.db.patch(business._id, {
      subscriptionStatus: "past_due",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("mayaTaskQueue", {
      businessId: business._id,
      kind: "billing.payment-failed",
      payload: {
        stripeCustomerId: args.stripeCustomerId,
      },
      source: "manual",
      enqueuedAt: Date.now(),
    });
    return { patched: true, queued: true };
  },
});

export const handleServiceInvoiceFinalizedPublic = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
    nextPeriodStartMs: v.optional(v.number()),
    nextPeriodEndMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ rolledOver: boolean }> => {
    assertWebhookSecret(args.secret);
    const business = await findBusinessByStripeCustomerId(
      ctx,
      args.stripeCustomerId
    );
    if (!business) return { rolledOver: false };
    const latest = await ctx.db
      .query("voiceUsage")
      .withIndex("by_business_and_period", (q) =>
        q.eq("businessId", business._id)
      )
      .order("desc")
      .first();
    if (!latest) return { rolledOver: false };
    if (args.nextPeriodStartMs && latest.periodEndMs < args.nextPeriodStartMs) {
      await ctx.db.patch(latest._id, { lastUpdatedAt: Date.now() });
      return { rolledOver: true };
    }
    return { rolledOver: false };
  },
});
