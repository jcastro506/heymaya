/**
 * Sensitive-op enforcement helper for voice-originated Convex actions.
 *
 * Wave D — service plan § 13 Sprint 6 PIN-challenge flow. Every Convex
 * action that performs a SENSITIVE operation when invoked from voice MUST
 * call `requireVoicePin(ctx, { businessId, callId, providedPin })` before
 * executing the underlying mutation. Fail-closed: any path that doesn't
 * verify rejects via `VoicePinRequiredError`.
 *
 * Sensitive op contract (locked list, per § 13 Sprint 6):
 *   - createJob
 *   - modifyCustomer
 *   - sendReviewRequest
 *   - sendInvoice
 *   - modifyPricing
 *   - postToSocial
 *   - modifyGbpProfile
 *
 * Read-only ops (NOT in this list — explicitly DO NOT require PIN):
 *   - getStatus / getJobStatus / getScheduleToday
 *   - briefRecap / morningBriefRead
 *   - "what's Maya up to" / "what did you do today"
 *
 * The list lives in `SENSITIVE_VOICE_OPS` below as the single source of
 * truth so tests can assert the matrix end-to-end. New sensitive ops MUST
 * be added here AND wired through `requireVoicePin` in their action.
 *
 * Provenance trail: when PIN passes (or fails), we record the result on the
 * call's `voiceCallTranscripts.pinChallengePassed` field via
 * `markPinChallengeResult` so audit-log queries surface PIN denials.
 */

import { v } from "convex/values";
import {
  internalMutation,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { verifyPinHash } from "./pinChallenge";

/**
 * Locked sensitive-op identifier list. Tests assert the entire matrix; new
 * ops MUST be added here AND must call `requireVoicePin`.
 */
export const SENSITIVE_VOICE_OPS = [
  "createJob",
  "modifyCustomer",
  "sendReviewRequest",
  "sendInvoice",
  "modifyPricing",
  "postToSocial",
  "modifyGbpProfile",
] as const;
export type SensitiveVoiceOp = (typeof SENSITIVE_VOICE_OPS)[number];

/**
 * Read-only ops surfaced for tests. Documentary — the gating helper does
 * not enforce this list; absence from `SENSITIVE_VOICE_OPS` is what makes
 * an op read-only. Listed here so a regression test can assert these stay
 * out of the sensitive set.
 */
export const READONLY_VOICE_OPS = [
  "getJobStatus",
  "getScheduleToday",
  "briefRecap",
  "morningBriefRead",
  "listCustomers",
] as const;
export type ReadonlyVoiceOp = (typeof READONLY_VOICE_OPS)[number];

export class VoicePinRequiredError extends Error {
  constructor(
    public op: SensitiveVoiceOp,
    public reason:
      | "no-pin-set"
      | "pin-not-provided"
      | "pin-mismatch"
      | "voice-channel-missing"
  ) {
    super(`Voice PIN required for '${op}': ${reason}.`);
    this.name = "VoicePinRequiredError";
  }
}

export interface RequireVoicePinArgs {
  businessId: Id<"businesses">;
  /** Twilio CallSid the operation originated from. Required for audit. */
  callId: string;
  /** Operation identifier — must be in `SENSITIVE_VOICE_OPS`. */
  op: SensitiveVoiceOp;
  /** PIN entered by caller via voice (DTMF or spoken digits). */
  providedPin: string | null | undefined;
}

/**
 * Verify the caller's PIN against the business's stored hash. Fail-closed
 * on every error path. On success, marks `pinChallengePassed: true` on the
 * transcript row; on failure, marks `false` and throws.
 *
 * Action-side helper — wrap around any sensitive-op action's body BEFORE
 * the underlying mutation runs.
 */
export async function requireVoicePin(
  ctx: ActionCtx,
  args: RequireVoicePinArgs
): Promise<void> {
  if (!isSensitiveOp(args.op)) {
    throw new Error(
      `requireVoicePin: '${args.op}' is not in SENSITIVE_VOICE_OPS. Add to the list or use a read-only path.`
    );
  }

  if (typeof args.providedPin !== "string" || args.providedPin.length === 0) {
    await markFailure(ctx, args.businessId, args.callId);
    throw new VoicePinRequiredError(args.op, "pin-not-provided");
  }

  const stored = await ctx.runQuery(
    internal.voice.pinChallenge.getVoicePinHashForBusiness,
    { businessId: args.businessId }
  );
  if (!stored.channelId) {
    await markFailure(ctx, args.businessId, args.callId);
    throw new VoicePinRequiredError(args.op, "voice-channel-missing");
  }
  if (!stored.hash) {
    await markFailure(ctx, args.businessId, args.callId);
    throw new VoicePinRequiredError(args.op, "no-pin-set");
  }

  const ok = await verifyPinHash(args.providedPin, stored.hash);
  if (!ok) {
    await markFailure(ctx, args.businessId, args.callId);
    throw new VoicePinRequiredError(args.op, "pin-mismatch");
  }

  await ctx.runMutation(
    internal.voice.sensitiveOps.markPinChallengeResult,
    {
      businessId: args.businessId,
      callId: args.callId,
      passed: true,
    }
  );
}

export function isSensitiveOp(op: string): op is SensitiveVoiceOp {
  return (SENSITIVE_VOICE_OPS as ReadonlyArray<string>).includes(op);
}

export function isReadonlyVoiceOp(op: string): op is ReadonlyVoiceOp {
  return (READONLY_VOICE_OPS as ReadonlyArray<string>).includes(op);
}

async function markFailure(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
  callId: string
): Promise<void> {
  // Best-effort audit write — never block the throw on this.
  try {
    await ctx.runMutation(
      internal.voice.sensitiveOps.markPinChallengeResult,
      { businessId, callId, passed: false }
    );
  } catch {
    // Swallow — primary failure path is the throw above.
  }
}

/**
 * Audit-trail mutation. Updates the in-progress transcript's
 * `pinChallengePassed` field. Idempotent: latest write wins per call. If no
 * transcript row exists yet (PIN challenge before first chunk), this is a
 * no-op so we don't accidentally create a row out-of-band — the transcripts
 * hook owns row creation via `recordTranscriptChunk`.
 */
export const markPinChallengeResult = internalMutation({
  args: {
    businessId: v.id("businesses"),
    callId: v.string(),
    passed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("voiceCallTranscripts")
      .withIndex("by_callId", (q) => q.eq("callId", args.callId))
      .first();
    if (!row) return;
    // Cross-tenant guard: refuse if caller-supplied businessId doesn't
    // match the row's. Defensive — should never fire in production.
    if (row.businessId !== args.businessId) return;
    await ctx.db.patch(row._id, { pinChallengePassed: args.passed });
  },
});
