/**
 * Service-product Stripe voice metered billing — Wave D.
 *
 * Pipeline contract (Wave D voice ↔ Wave D Stripe coordination):
 *   - Wave D voice agent's `finalizeTranscript` flow calls
 *     `internal.integrations.stripe.voiceMetering.recordVoiceMinutes`
 *     after a call ends, passing `{ businessId, callId, durationSec }`.
 *   - This file owns:
 *       1. The `voiceUsage` per-business per-period counter table
 *       2. The hard-cap enforcement (Studio 500 min/mo)
 *       3. The Stripe meter-event reporter (in $5 increments)
 *
 * Pricing math (per `docs/SPRINT_PLAN_SERVICE_V0.md` § 1):
 *   - Pro ($149) — 30 min/mo INCLUSION + $0.20/min overage
 *   - Studio ($199) — 100 min/mo INCLUSION + $0.15/min overage,
 *                     hard cap 500 min/mo
 *   - Starter ($99) — voice forbidden upstream by `planFeaturesService`
 *
 * $5-INCREMENT BATCHING: rather than reporting every minute as a separate
 * meter event (which would generate 100s of tiny line items per period for
 * a heavy user), we batch overage minutes into $5-equivalent chunks before
 * reporting. Math: at $0.20/min Pro, $5 ≈ 25 minutes; at $0.15/min Studio,
 * $5 ≈ 33 minutes. The `voiceUsage.minutesReportedToStripe` counter tracks
 * what's already been reported to Stripe so we never double-report.
 *
 * HARD CAP enforcement: when post-increment minutesUsed >= the plan's
 * voiceHardCap (Studio 500), set `cappedAt` on the row. A separate query
 * `isVoiceCapped(businessId)` is consulted by Wave D voice's outbound-call
 * gate before placing any new outbound voice call.
 *
 * Cross-tenant: the action authorizes via the `businessId` lookup; never
 * accepts a `stripeCustomerId` directly. The voice agent's call site MUST
 * pass `businessId` resolved from voice transcript context.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { getStripeClient } from "../../billing/stripeClient";
import { planFeaturesService } from "../../planService";
import {
  SERVICE_VOICE_METER_EVENT_NAMES,
} from "./priceIds";

/**
 * 30-day default period span in milliseconds. Used as the fallback period
 * length when a business has no Stripe subscription on file (i.e. mid-trial
 * or pre-Stripe). Real subscriptions use `currentPlanPeriodEnd` for the
 * upper bound.
 */
const DEFAULT_PERIOD_SPAN_MS = 30 * 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Period resolver                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the active voice-usage period for a business. If no row exists for
 * the current period, create one. If a row exists for a PRIOR period, leave
 * it (period rollover is bound to subscription cycle), and create a new row
 * for the current period.
 *
 * `now` is parameterized so test fixtures can drive deterministic timestamps.
 */
async function resolveCurrentPeriod(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  now: number
): Promise<Doc<"voiceUsage">> {
  // 1. Look up the latest period row for this business.
  const latest = await ctx.db
    .query("voiceUsage")
    .withIndex("by_business_and_period", (q) =>
      q.eq("businessId", businessId)
    )
    .order("desc")
    .first();

  if (latest && latest.periodStartMs <= now && now <= latest.periodEndMs) {
    return latest;
  }

  // 2. Need a fresh row. Compute the period boundary from the business's
  //    Stripe subscription period if available; otherwise default to 30 days.
  const business = await ctx.db.get(businessId);
  const periodEndMs =
    business?.currentPlanPeriodEnd ?? now + DEFAULT_PERIOD_SPAN_MS;
  const periodStartMs =
    latest && latest.periodEndMs <= now
      ? latest.periodEndMs
      : now;

  const newRowId = await ctx.db.insert("voiceUsage", {
    businessId,
    periodStartMs,
    periodEndMs,
    minutesUsed: 0,
    minutesReportedToStripe: 0,
    lastUpdatedAt: now,
  });
  const newRow = await ctx.db.get(newRowId);
  if (!newRow) {
    throw new Error(
      "voiceMetering.resolveCurrentPeriod: failed to read freshly-inserted row"
    );
  }
  return newRow;
}

/* -------------------------------------------------------------------------- */
/* Internal mutation — increment counter + capture hard-cap                    */
/* -------------------------------------------------------------------------- */

/**
 * Internal mutation called by `recordVoiceMinutes` (the public action entry
 * point). Splits responsibilities so the action handles Stripe HTTP and the
 * mutation handles the atomic Convex DB update.
 *
 * Returns the post-increment usage state so the action can decide whether to
 * fire a Stripe meter event.
 */
export const incrementVoiceUsage = internalMutation({
  args: {
    businessId: v.id("businesses"),
    minutes: v.number(),
    nowMs: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    period: Doc<"voiceUsage">;
    crossedCap: boolean;
    plan: "starter" | "pro" | "studio";
    minutesIncluded: number;
    overageRate: number | null;
    hardCap: number | null;
    overageMinutesUnreported: number;
  }> => {
    const business = await ctx.db.get(args.businessId);
    if (!business) {
      throw new Error(
        `incrementVoiceUsage: business ${args.businessId} not found`
      );
    }
    const features = planFeaturesService(business);

    // Resolve current period (creates fresh row if needed).
    const period = await resolveCurrentPeriod(ctx, args.businessId, args.nowMs);

    const priorUsed = period.minutesUsed;
    const priorReported = period.minutesReportedToStripe ?? 0;
    const newUsed = priorUsed + Math.max(0, Math.ceil(args.minutes));

    // Hard-cap detection — Studio only. The cap field is set here, but
    // refusal of new outbound calls happens upstream in Wave D voice via
    // `isVoiceCapped(businessId)` query.
    const cap = features.voiceHardCap;
    const crossedCap =
      cap !== null && priorUsed < cap && newUsed >= cap;

    // Compute overage minutes that have NOT yet been reported to Stripe.
    // We only report once usage exceeds the inclusion bucket; the "unreported
    // overage" is the delta between (newUsed - inclusion) and priorReported.
    const overageNow = Math.max(0, newUsed - features.voiceMinIncluded);
    const overageMinutesUnreported = Math.max(0, overageNow - priorReported);

    await ctx.db.patch(period._id, {
      minutesUsed: newUsed,
      lastUpdatedAt: args.nowMs,
      ...(crossedCap ? { cappedAt: args.nowMs } : {}),
    });

    const updatedPeriod = await ctx.db.get(period._id);
    if (!updatedPeriod) {
      throw new Error("incrementVoiceUsage: missing post-patch row");
    }

    return {
      period: updatedPeriod,
      crossedCap,
      plan: features.plan,
      minutesIncluded: features.voiceMinIncluded,
      overageRate: features.voiceOverageRate,
      hardCap: features.voiceHardCap,
      overageMinutesUnreported,
    };
  },
});

/**
 * Internal mutation to record that we've reported N overage minutes to
 * Stripe. Called by the action AFTER the meter-event POST succeeds so a
 * failed Stripe call doesn't decrement our local counter (Stripe retries +
 * idempotency keys handle the dedupe).
 */
export const markMinutesReported = internalMutation({
  args: {
    voiceUsageId: v.id("voiceUsage"),
    minutesReported: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.voiceUsageId);
    if (!row) return;
    await ctx.db.patch(args.voiceUsageId, {
      minutesReportedToStripe:
        (row.minutesReportedToStripe ?? 0) + args.minutesReported,
      lastUpdatedAt: Date.now(),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Public query — isVoiceCapped                                                */
/* -------------------------------------------------------------------------- */

/**
 * Wave D voice's outbound-call gate calls this before placing a call. Returns
 * `true` if the business has hit its hard cap in the current period.
 *
 * Cross-tenant: callers must already have authorized to act on `businessId`
 * (the voice agent resolves businessId from its session context). This query
 * does not re-authorize.
 */
export const isVoiceCapped = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<{ capped: boolean; minutesUsed: number; hardCap: number | null }> => {
    const business = await ctx.db.get(args.businessId);
    if (!business) return { capped: false, minutesUsed: 0, hardCap: null };
    const features = planFeaturesService(business);
    if (features.voiceHardCap === null) {
      return { capped: false, minutesUsed: 0, hardCap: null };
    }
    const latest = await ctx.db
      .query("voiceUsage")
      .withIndex("by_business_and_period", (q) =>
        q.eq("businessId", args.businessId)
      )
      .order("desc")
      .first();
    const minutesUsed = latest?.minutesUsed ?? 0;
    return {
      capped: minutesUsed >= features.voiceHardCap,
      minutesUsed,
      hardCap: features.voiceHardCap,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Public action — recordVoiceMinutes (Wave D voice integration point)         */
/* -------------------------------------------------------------------------- */

/**
 * COORDINATION CONTRACT — Wave D voice agent reads this signature.
 *
 * The voice agent's `finalizeTranscript` mutation hands off to this action
 * after computing `durationSec` from the call's first/last transcript chunk
 * timestamps. The hand-off is one-way: voice fires the call and continues
 * (no return-value dependency).
 *
 * Idempotency: Stripe meter-event create accepts an `identifier` field that
 * Stripe dedups within a 24h rolling window. We compose the identifier as
 * `voice-{businessId}-{voiceUsageId}-{minutesReportedToStripe}` so a replay
 * lands on the same identifier and Stripe drops the duplicate.
 *
 * Failure modes:
 *   - No metered price configured for tier → silent no-op (warned in logs).
 *     Operator's bill won't include voice overage until they run
 *     `createServiceProducts.ts` and update the subscription via portal.
 *   - Hard cap crossed → record the cap (mutation already did) and FIRE a
 *     `mayaTaskQueue` task so the operator hears about it.
 *   - Stripe API error → throw; the voice agent's call site logs but does
 *     NOT roll back local minute counting (Stripe will eventually receive
 *     the next meter event and reconcile).
 */
export const recordVoiceMinutes = internalAction({
  args: {
    businessId: v.id("businesses"),
    /** Twilio CallSid — used to compose the dedup identifier. */
    callId: v.string(),
    /** Call duration in seconds. Round-up to the next minute happens here. */
    durationSec: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    reported: boolean;
    minutesAdded: number;
    capCrossed: boolean;
  }> => {
    // Round up partial minutes — a 75-second call counts as 2 minutes for
    // billing purposes (industry-standard voice-minute rounding).
    const minutesAdded = Math.max(0, Math.ceil(args.durationSec / 60));
    if (minutesAdded === 0) {
      return { reported: false, minutesAdded: 0, capCrossed: false };
    }

    const result = await ctx.runMutation(
      internal.integrations.stripe.voiceMetering.incrementVoiceUsage,
      {
        businessId: args.businessId,
        minutes: minutesAdded,
        nowMs: Date.now(),
      }
    );

    if (result.crossedCap) {
      await ctx.runMutation(
        internal.integrations.stripe.voiceMetering.enqueueCapNudge,
        { businessId: args.businessId }
      );
    }

    // Starter has no overage path. Pro/Studio do — but only when usage
    // exceeds the inclusion bucket.
    if (result.plan === "starter") {
      return { reported: false, minutesAdded, capCrossed: result.crossedCap };
    }
    if (result.overageMinutesUnreported === 0) {
      return { reported: false, minutesAdded, capCrossed: result.crossedCap };
    }

    // $5-increment batching: only report when the unreported overage
    // accumulates to at least one $5 chunk.
    if (result.overageRate === null || result.overageRate <= 0) {
      return { reported: false, minutesAdded, capCrossed: result.crossedCap };
    }
    const minutesPer5Dollars = Math.floor(5 / result.overageRate);
    if (minutesPer5Dollars <= 0) {
      // Defensive — should never happen for the locked $0.20/$0.15 rates.
      return { reported: false, minutesAdded, capCrossed: result.crossedCap };
    }
    if (result.overageMinutesUnreported < minutesPer5Dollars) {
      return { reported: false, minutesAdded, capCrossed: result.crossedCap };
    }

    // Round DOWN to a multiple of `minutesPer5Dollars` so we report only
    // full $5 chunks. Remaining unreported minutes carry over to next call.
    const chunksToReport = Math.floor(
      result.overageMinutesUnreported / minutesPer5Dollars
    );
    const minutesToReport = chunksToReport * minutesPer5Dollars;
    if (minutesToReport === 0) {
      return { reported: false, minutesAdded, capCrossed: result.crossedCap };
    }

    // Resolve the Stripe customer id for the meter-event payload.
    const businessForCustomer = await ctx.runQuery(
      internal.integrations.stripe.voiceMetering.getBusinessStripeCustomer,
      { businessId: args.businessId }
    );
    if (!businessForCustomer || !businessForCustomer.stripeCustomerId) {
      // No Stripe customer attached — most likely mid-onboarding. Skip
      // metering; operator will see no overage until subscribed.
      return { reported: false, minutesAdded, capCrossed: result.crossedCap };
    }

    const stripe = getStripeClient();
    const eventName =
      result.plan === "pro"
        ? SERVICE_VOICE_METER_EVENT_NAMES.pro
        : SERVICE_VOICE_METER_EVENT_NAMES.studio;
    const identifier = `voice-${args.businessId}-${result.period._id}-${result.period.minutesReportedToStripe ?? 0}`;

    await stripe.billing.meterEvents.create({
      event_name: eventName,
      payload: {
        stripe_customer_id: businessForCustomer.stripeCustomerId,
        value: String(minutesToReport),
      },
      identifier,
      timestamp: Math.floor(Date.now() / 1000),
    });

    await ctx.runMutation(
      internal.integrations.stripe.voiceMetering.markMinutesReported,
      {
        voiceUsageId: result.period._id,
        minutesReported: minutesToReport,
      }
    );

    return {
      reported: true,
      minutesAdded,
      capCrossed: result.crossedCap,
    };
  },
});

/**
 * Internal helper for the action above — read just the businesses row's
 * stripeCustomerId without surfacing other fields.
 */
export const getBusinessStripeCustomer = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (
    ctx,
    args
  ): Promise<{ stripeCustomerId: string | null } | null> => {
    const b = await ctx.db.get(args.businessId);
    if (!b) return null;
    return { stripeCustomerId: b.stripeCustomerId ?? null };
  },
});

/**
 * Internal mutation to enqueue the hard-cap nudge so the operator hears
 * about it through her Maya thread.
 */
export const enqueueCapNudge = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await ctx.db.insert("mayaTaskQueue", {
      businessId: args.businessId,
      kind: "voice.hard-cap-reached",
      payload: { source: "voice-metering" },
      source: "manual",
      enqueuedAt: Date.now(),
    });
  },
});
