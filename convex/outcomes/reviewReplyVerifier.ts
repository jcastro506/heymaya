/**
 * 24h passive review-reply verifier — silent-rejection guard.
 *
 * Why this exists:
 * Zernio's API surface does NOT pass through Google's `ReviewReplyState`
 * rejection signal. Confirmed via the Zernio capability audit at
 * `docs/spikes/zernio-capability-audit.md` (and the OpenAPI spec
 * inspection done in the same session): the `POST /v1/inbox/reviews/{reviewId}/reply`
 * 200 response contains `{ status, reply, platform }` with NO field for
 * moderation state. The `review.updated` webhook payload (`ReviewWebhookReview`
 * schema) carries `hasReply: boolean` and `reply: { text, createdAt }` — also
 * no rejection field.
 *
 * What this means in practice:
 *   1. Operator approves a reply draft in HQ.
 *   2. We call Zernio's reply endpoint. 200 OK. We flip
 *      `reviews.replyStatus = "posted"`.
 *   3. Google's moderation may then silently strip the reply (AI-flavored
 *      language, promotional content, policy violation). The reply never
 *      appears on the actual GBP listing.
 *   4. Without a verifier, our HQ Reviews screen continues to show the
 *      reply as "posted" indefinitely while it's actually invisible.
 *
 * The verifier:
 * Scheduled 24h after `replyStatus` flips to "posted". Re-fetches the
 * review via Zernio (or a `ZernioReviewFetcher` test seam) and inspects
 * `hasReply`. If false, mutates `replyStatus = "rejected-by-google"` and
 * emits a `review-reply-moderation` telemetry signal with
 * `outcome: "silent-rejection"`.
 *
 * 24h is a deliberate choice — not a hardcoded threshold trigger on
 * qualitative properties (which the trust-LLM-judgment rule prohibits),
 * but a mechanical correctness window. Google's moderation typically
 * settles within minutes-to-hours; 24h gives ample buffer plus crosses
 * the GBP local-post visibility window where the reply would be
 * surfaced. This is contract-shaped work, not judgment work.
 *
 * Cross-tenant: every verifier run takes a single reviewId; the verifier
 * action re-resolves businessId from the review row before any external
 * call or telemetry write. No fan-out across businesses.
 *
 * Plan-tier: runs at every tier. Operator-issued moderation rejection
 * matters universally and is part of operator-trust upkeep.
 *
 * Idempotency: re-running the verifier on the same reviewId is a no-op
 * if `replyStatus` is no longer "posted" (already rejected, or operator
 * deleted, or whatever). The 24h schedule fires exactly once per
 * `posted` transition; idempotency comes from the status-equality guard.
 *
 * Wire-in (TODO when production review-reply mutation lands): the
 * mutation that flips `replyStatus` from "approved" to "posted" calls
 * `scheduleVerification(ctx, { reviewId })` immediately after the
 * Zernio API call returns 200. The verifier's wire-in is currently a
 * scaffold; the production mutation that triggers it doesn't exist yet
 * (no Zernio API key in env, no production reply pipeline). When that
 * lands, this verifier is ready to attach.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  type ActionCtx,
  type MutationCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { emitTelemetryRow } from "../serviceTelemetry";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Verification window — 24 hours after `replyStatus` flips to "posted".
 * Mechanical correctness window, NOT a qualitative threshold.
 */
export const VERIFICATION_DELAY_MS = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Test seam — ZernioReviewFetcher                                             */
/* -------------------------------------------------------------------------- */

/**
 * Pluggable Zernio review fetcher. Tests inject a deterministic stub via
 * `__setZernioReviewFetcher`; production wires to a real Zernio HTTP
 * client in a future wave (not in scope for this scaffold — no Zernio
 * key in env yet).
 *
 * Returns either:
 *   - { ok: true, hasReply: boolean }  — review fetch succeeded
 *   - { ok: false, reason: string }   — fetch failed (network, 4xx, etc.)
 *
 * On fetch failure, the verifier does NOT flip status. We retry on the
 * next nightly outcome-poll cycle rather than treating fetch failure as
 * a rejection signal — false positives here would frustrate operators.
 *
 * Module-level injection (vs Convex-args injection) because Convex
 * action args must be JSON-serializable — functions can't cross that
 * boundary. Same pattern used by `__setServiceFlyClient` in
 * `convex/onboarding/business/deployServiceMaya.ts`.
 */
export interface ZernioReviewFetcher {
  (args: {
    accountId: string;
    externalReviewId: string;
  }): Promise<
    | { ok: true; hasReply: boolean }
    | { ok: false; reason: string }
  >;
}

let _zernioReviewFetcher: ZernioReviewFetcher | null = null;

/**
 * Test-only injector. Production omits this entirely — the verifier
 * remains a no-op until a future wave wires the real Zernio HTTP client.
 * Pass `null` to clear the injection between tests.
 */
export function __setZernioReviewFetcher(
  fetcher: ZernioReviewFetcher | null
): void {
  _zernioReviewFetcher = fetcher;
}

/* -------------------------------------------------------------------------- */
/* Schedule helper                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Schedule the 24h verifier for a review whose reply just flipped to
 * "posted". Call from the production reply mutation immediately after
 * the Zernio API call returns 200.
 *
 * Idempotency: each call to scheduleVerification creates a new scheduled
 * action — duplicate scheduling is harmless because the action's status
 * guard short-circuits when `replyStatus !== "posted"` at run time.
 */
export async function scheduleVerification(
  ctx: MutationCtx | ActionCtx,
  args: { reviewId: Id<"reviews"> }
): Promise<void> {
  await ctx.scheduler.runAfter(
    VERIFICATION_DELAY_MS,
    internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
    { reviewId: args.reviewId }
  );
}

/* -------------------------------------------------------------------------- */
/* The verifier action                                                         */
/* -------------------------------------------------------------------------- */

type VerifyResult =
  | { skipped: string }
  | { rejected: true };

export const verifyReviewReplyAfter24h = internalAction({
  args: {
    reviewId: v.id("reviews"),
  },
  handler: async (ctx, args): Promise<VerifyResult> => {
    // Re-fetch the review — must still be in "posted" state. If it's
    // anything else (operator deleted, already rejected, in-flight
    // re-edit), short-circuit. This is the idempotency guard that makes
    // duplicate scheduling harmless.
    const review = await ctx.runQuery(
      internal.outcomes.reviewReplyVerifier.getReviewForVerify,
      { reviewId: args.reviewId }
    );
    if (!review) return { skipped: "review-not-found" };
    if (review.replyStatus !== "posted") {
      return { skipped: `replyStatus=${review.replyStatus ?? "null"}` };
    }

    // Resolve the Zernio account ID from the business's connected
    // accounts. In v0 this lookup is a stub returning a placeholder; the
    // production wire-in resolves from `crmConnections` or a future
    // `socialConnections` table.
    const fetcher = _zernioReviewFetcher;
    if (!fetcher) {
      // Production fetcher not yet wired (no Zernio key in v0). The
      // verifier becomes a no-op until the production reply mutation +
      // Zernio HTTP client land in a follow-up wave. Logged for
      // observability rather than thrown — failing closed here would
      // create false positives for operators.
      return { skipped: "no-zernio-fetcher-wired-yet" };
    }

    // accountId is a placeholder until the production wire-in resolves
    // it from connected accounts. Tests inject a fetcher that ignores it.
    const result = await fetcher({
      accountId: "stub-account-id",
      externalReviewId: review.externalReviewId,
    });
    if (!result.ok) {
      // Network / API failure — do NOT flip status. Operators tolerating
      // a 24h delay before re-verification is acceptable; flipping on
      // network noise would wreck trust.
      return { skipped: `fetcher-failed: ${result.reason}` };
    }

    if (result.hasReply) {
      // Reply still present on Google's side — happy path.
      return { skipped: "reply-still-present" };
    }

    // Silent rejection detected. Flip status + emit telemetry.
    await ctx.runMutation(
      internal.outcomes.reviewReplyVerifier.markRejectedByGoogle,
      { reviewId: args.reviewId }
    );

    return { rejected: true };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

import { internalQuery } from "../_generated/server";

export const getReviewForVerify = internalQuery({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args): Promise<Doc<"reviews"> | null> => {
    return await ctx.db.get(args.reviewId);
  },
});

export const markRejectedByGoogle = internalMutation({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return;

    // Idempotency: only flip when status is currently "posted". Don't
    // overwrite an operator-issued "rejected" or a previous flip.
    if (review.replyStatus !== "posted") return;

    await ctx.db.patch(args.reviewId, {
      replyStatus: "rejected-by-google",
    });

    // Emit serviceTelemetry signal via the central chokepoint so the
    // outcome-whitelist enforcement applies. Cross-tenant safety:
    // businessId comes from the review row itself, never from
    // caller-supplied input.
    await emitTelemetryRow(ctx, {
      businessId: review.businessId,
      signal: "review-reply-moderation",
      outcome: "silent-rejection",
    });
  },
});
