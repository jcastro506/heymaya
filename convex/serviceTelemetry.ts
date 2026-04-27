/**
 * Service-product Wave D — beta hardening telemetry.
 *
 * One module for every signal the operator wants observability on through
 * beta. Six signal kinds are doc'd in `convex/schema.ts` (table
 * `serviceTelemetry`); this file is the single write surface + the per-call-
 * site emitter helpers.
 *
 * Hard rules (operator-stated, non-negotiable):
 *   1. **No hardcoded "score" / "rating" / "rank" computation.** Counts and
 *      aggregations are fine; weighted-composite synthesis is not. The
 *      judgment-not-rules invariant test greps this file for `compute*Score`
 *      / `rank*` / `rate*` helpers.
 *   2. **Cross-tenant isolation is structural.** Every public mutation
 *      resolves the caller's session via `getCurrentBusinessSession` and
 *      writes only to that session's `businessId`. Internal mutations
 *      called from server-side flows (CRM webhooks, Stripe metering,
 *      voice transcript finalize) take an explicit `businessId` arg and
 *      MUST be invoked with a businessId resolved from server-trusted
 *      context — they are NOT directly callable from clients.
 *   3. **Plan-tier gating server-side.** Insertion is plan-agnostic
 *      (signals emit when they happen). Read aggregation in
 *      `convex/queries/business/growth.ts#getTelemetrySummary` enforces:
 *      Starter → null; Pro/Studio → counts.
 */

import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentBusinessSession } from "./queries/business/_session";

/* -------------------------------------------------------------------------- */
/* Signal contract                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The six locked signal kinds. Adding a new signal requires (a) widening the
 * schema literal-union, (b) extending `OUTCOME_WHITELIST` below, (c) adding
 * a per-call-site emitter so the new signal carries the right metadata.
 *
 * Keep the order in lockstep with `schema.ts` — the cross-tenant test reads
 * this list to assert the `serviceTelemetry.signal` literals are exhaustive.
 */
export type ServiceTelemetrySignal =
  | "review-request-approval"
  | "review-reply-moderation"
  | "lead-response-nudge-open"
  | "voice-satisfaction"
  | "ai-cost"
  | "crm-webhook-idempotency-hit";

/**
 * Whitelist of permitted outcome strings per signal. Adversarial input that
 * doesn't match the whitelist is rejected. The whitelist is enforced at the
 * single `emitTelemetryRow` chokepoint so every emitter benefits.
 */
export const OUTCOME_WHITELIST: Record<
  ServiceTelemetrySignal,
  ReadonlyArray<string>
> = {
  "review-request-approval": ["approved", "rejected", "edited-then-approved"],
  "review-reply-moderation": ["pass", "fail", "edited"],
  "lead-response-nudge-open": ["opened", "dismissed", "acted-on"],
  // Voice-satisfaction outcomes are coarse buckets so the operator can scan
  // a digest without parsing per-row numericValue. The numericValue carries
  // the actual 1-5 rating.
  "voice-satisfaction": ["positive", "neutral", "negative"],
  "ai-cost": ["recorded"],
  "crm-webhook-idempotency-hit": ["jobber", "hcp", "qbo", "nango"],
};

/**
 * The signal-level validator used by every public + internal mutation arg.
 */
const SIGNAL_VALIDATOR = v.union(
  v.literal("review-request-approval"),
  v.literal("review-reply-moderation"),
  v.literal("lead-response-nudge-open"),
  v.literal("voice-satisfaction"),
  v.literal("ai-cost"),
  v.literal("crm-webhook-idempotency-hit")
);

/* -------------------------------------------------------------------------- */
/* Core write helper                                                           */
/* -------------------------------------------------------------------------- */

interface EmitArgs {
  businessId: Id<"businesses">;
  signal: ServiceTelemetrySignal;
  outcome: string;
  numericValue?: number;
  metadata?: unknown;
  /** Override `Date.now()` for deterministic tests. */
  ts?: number;
}

/**
 * Single write chokepoint. All emitters route through here so the outcome-
 * whitelist + adversarial-input rejection lives in one place.
 *
 * Returns the inserted row id so callers can chain (e.g. an audit-log row
 * referencing the telemetry row).
 */
export async function emitTelemetryRow(
  ctx: MutationCtx,
  args: EmitArgs
): Promise<Id<"serviceTelemetry">> {
  const allowedOutcomes = OUTCOME_WHITELIST[args.signal];
  if (!allowedOutcomes.includes(args.outcome)) {
    throw new Error(
      `serviceTelemetry: outcome '${args.outcome}' not allowed for signal '${args.signal}'. Allowed: ${allowedOutcomes.join("|")}`
    );
  }
  // Defensive — businessId must reference a real row (Convex enforces by
  // type, but a stale/cross-tenant id would still be a bug). Validate the
  // row exists; throwing here surfaces test-side mistakes without leaking
  // partial data.
  const business = await ctx.db.get(args.businessId);
  if (!business) {
    throw new Error(
      `serviceTelemetry: business ${args.businessId} does not exist.`
    );
  }
  const ts = args.ts ?? Date.now();
  return await ctx.db.insert("serviceTelemetry", {
    businessId: args.businessId,
    signal: args.signal,
    outcome: args.outcome,
    numericValue: args.numericValue,
    metadata: args.metadata,
    ts,
  });
}

/* -------------------------------------------------------------------------- */
/* Internal mutation — server-trusted callers (CRM webhooks, Stripe, voice)    */
/* -------------------------------------------------------------------------- */

/**
 * Server-trusted emitter. NOT directly callable from clients — internal
 * mutations are invocable only from other Convex functions running on the
 * server. Used by:
 *   - `convex/webhooks/crm.ts`               (idempotency hits)
 *   - `convex/integrations/crm/jobber.ts`    (poll dedup hits)
 *   - `convex/integrations/crm/housecallpro.ts` (poll dedup hits)
 *   - `convex/voice/transcripts.ts`          (voice satisfaction on finalize)
 *   - `convex/integrations/stripe/voiceMetering.ts` (ai-cost mirror)
 */
export const emitInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    signal: SIGNAL_VALIDATOR,
    outcome: v.string(),
    numericValue: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"serviceTelemetry">> => {
    return await emitTelemetryRow(ctx, {
      businessId: args.businessId,
      signal: args.signal as ServiceTelemetrySignal,
      outcome: args.outcome,
      numericValue: args.numericValue,
      metadata: args.metadata,
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Public mutation — operator-driven outcome stamps                            */
/* -------------------------------------------------------------------------- */

/**
 * `markReviewRequestOutcome` — operator approves / rejects / edits-and-
 * approves a review-request draft from the HQ approval queue.
 *
 * Cross-tenant: routes through `getCurrentBusinessSession`. The optional
 * `reviewRequestId` argument is validated to belong to the caller's
 * business before any write — adversarial cross-tenant `reviewRequestId`s
 * are dropped with `null` (fail-closed, no throw — UI re-renders empty).
 */
export const markReviewRequestOutcome = mutation({
  args: {
    outcome: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("edited-then-approved")
    ),
    reviewRequestId: v.optional(v.id("reviewRequests")),
  },
  handler: async (ctx, args): Promise<Id<"serviceTelemetry"> | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;
    if (args.reviewRequestId) {
      const rr = await ctx.db.get(args.reviewRequestId);
      if (!rr || rr.businessId !== session.business._id) return null;
    }
    return await emitTelemetryRow(ctx, {
      businessId: session.business._id,
      signal: "review-request-approval",
      outcome: args.outcome,
      metadata: args.reviewRequestId
        ? { reviewRequestId: args.reviewRequestId }
        : undefined,
    });
  },
});

/**
 * `markReviewReplyOutcome` — moderation result on a posted GBP review reply
 * (Google ReviewReplyState round-trip). Outcome is the moderation verdict;
 * `pass` = published; `fail` = Google rejected; `edited` = operator edited
 * the draft before approving.
 */
export const markReviewReplyOutcome = mutation({
  args: {
    outcome: v.union(
      v.literal("pass"),
      v.literal("fail"),
      v.literal("edited")
    ),
    reviewId: v.optional(v.id("reviews")),
  },
  handler: async (ctx, args): Promise<Id<"serviceTelemetry"> | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;
    if (args.reviewId) {
      const review = await ctx.db.get(args.reviewId);
      if (!review || review.businessId !== session.business._id) return null;
    }
    return await emitTelemetryRow(ctx, {
      businessId: session.business._id,
      signal: "review-reply-moderation",
      outcome: args.outcome,
      metadata: args.reviewId ? { reviewId: args.reviewId } : undefined,
    });
  },
});

/**
 * `markLeadNudgeOutcome` — operator engagement with a lead-response nudge
 * surfaced in the HQ Today screen or via Maya's chat thread.
 *
 * Chat-side hookup is stubbed: the chat producer side will call this from
 * the operator-message webhook once the channel router lands. Until then,
 * the only callers are HQ Today's nudge banner and tests.
 */
export const markLeadNudgeOutcome = mutation({
  args: {
    outcome: v.union(
      v.literal("opened"),
      v.literal("dismissed"),
      v.literal("acted-on")
    ),
    leadId: v.optional(v.id("inboundLeads")),
  },
  handler: async (ctx, args): Promise<Id<"serviceTelemetry"> | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;
    if (args.leadId) {
      const lead = await ctx.db.get(args.leadId);
      if (!lead || lead.businessId !== session.business._id) return null;
    }
    // note: chat-side hookup intentionally pending (channel router lands
    // post-v0); HQ Today nudge banner is the only client caller currently.
    // The mutation surface is in place so the chat side can flip the wire
    // with no shape changes.
    return await emitTelemetryRow(ctx, {
      businessId: session.business._id,
      signal: "lead-response-nudge-open",
      outcome: args.outcome,
      metadata: args.leadId ? { leadId: args.leadId } : undefined,
    });
  },
});

/**
 * `submitVoiceCallRating` — operator (or post-call SMS) rates the call.
 * Studio-only — the voice tier. Pro/Starter calls return null.
 */
export const submitVoiceCallRating = mutation({
  args: {
    rating: v.number(),
    callId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"serviceTelemetry"> | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;
    // Voice signal is Studio-only — no voice channel = no signal.
    if (session.business.planTier !== "studio") return null;
    if (
      typeof args.rating !== "number" ||
      !Number.isFinite(args.rating) ||
      args.rating < 1 ||
      args.rating > 5
    ) {
      throw new Error(
        `submitVoiceCallRating: rating must be a number 1..5; got ${args.rating}`
      );
    }
    const outcome =
      args.rating >= 4 ? "positive" : args.rating <= 2 ? "negative" : "neutral";
    return await emitTelemetryRow(ctx, {
      businessId: session.business._id,
      signal: "voice-satisfaction",
      outcome,
      numericValue: args.rating,
      metadata: args.callId ? { callId: args.callId } : undefined,
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Read helpers                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Internal helper for dashboards / digests. Returns rows scoped to the
 * given businessId in the [startMs, endMs) window. Public read happens
 * via `convex/queries/business/growth.ts#getTelemetrySummary` which gates
 * on plan tier.
 */
export async function listTelemetryForBusiness(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  startMs: number,
  endMs: number
): Promise<Doc<"serviceTelemetry">[]> {
  const all = await ctx.db
    .query("serviceTelemetry")
    .withIndex("by_business_and_ts", (q) =>
      q
        .eq("businessId", businessId)
        .gte("ts", startMs)
        .lte("ts", endMs - 1)
    )
    .collect();
  return all;
}
