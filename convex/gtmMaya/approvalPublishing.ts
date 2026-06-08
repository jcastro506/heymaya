import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const PLATFORM = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("linkedin"),
  v.literal("tiktok")
);

// ─────────────────────── voice/slop approval gate ───────────────────────
// Fail-closed server guard for gtmDraftedContent. A draft may not transition
// to approvalState 'pending_approval' (and thus reach the operator's approval
// queue / calendar) unless it has cleared BOTH the slop critic AND the voice
// matcher. This is the server-side backstop so a buggy/over-eager runtime can
// never push un-vetted, off-voice, AI-tell-laden content into the queue.
//
// CRITICAL low-signal carve-out: a MISSING voiceMatchScore (null/undefined —
// e.g. the user connected no handles, so voice confidence is "none") is NOT a
// hard block. It is PASS-WITH-WARNING: low-signal founders must still be able
// to publish. Only an explicitly-computed score below the floor blocks.
//
// Deterministic — no randomness, no clock, no I/O — so the same draft always
// yields the same verdict + reason. Exported as the single source of truth for
// the gate; consult it anywhere a draft transitions toward approval.

/** Minimum computed voice-match score (0-1) to clear the gate. */
export const VOICE_MATCH_FLOOR = 0.7;

export type ApprovalGateInput = {
  /** Sprint 2.10 slop-critic verdict; false until the critic has run. */
  slopCriticPassed: boolean;
  /** 0-1 voice-match; null/undefined when no signal (no handles) — PASS-WITH-WARNING. */
  voiceMatchScore?: number | null;
};

export type ApprovalGateResult = {
  /** True iff the draft may transition to pending_approval / reach calendar. */
  allowed: boolean;
  /** True when allowed only because voiceMatchScore was missing (low-signal). */
  warning: boolean;
  /** Deterministic, human-readable reason for the verdict. */
  reason: string;
};

/**
 * The fail-closed approval gate. Pure + deterministic.
 *
 * Rules (in order):
 *  1. slopCriticPassed must be true — else BLOCK (covers the "not yet checked"
 *     default of false, so an un-critiqued draft can never sneak through).
 *  2. voiceMatchScore:
 *       - missing (null/undefined) → ALLOW with warning (low-signal founder).
 *       - present and >= VOICE_MATCH_FLOOR → ALLOW.
 *       - present and < VOICE_MATCH_FLOOR → BLOCK.
 *       - present but non-finite (NaN/±Infinity) → BLOCK (fail closed on garbage).
 */
export function evaluateApprovalGate(
  input: ApprovalGateInput
): ApprovalGateResult {
  if (input.slopCriticPassed !== true) {
    return {
      allowed: false,
      warning: false,
      reason:
        "blocked: slop critic has not passed (slopCriticPassed !== true)",
    };
  }
  const score = input.voiceMatchScore;
  if (score === null || score === undefined) {
    return {
      allowed: true,
      warning: true,
      reason:
        "allowed-with-warning: no voice-match signal (low-signal founder, e.g. no connected handles) — publishing permitted",
    };
  }
  if (!Number.isFinite(score)) {
    return {
      allowed: false,
      warning: false,
      reason: "blocked: voiceMatchScore is not a finite number",
    };
  }
  if (score < VOICE_MATCH_FLOOR) {
    return {
      allowed: false,
      warning: false,
      reason: `blocked: voiceMatchScore ${score} is below the ${VOICE_MATCH_FLOOR} floor`,
    };
  }
  return {
    allowed: true,
    warning: false,
    reason: `allowed: slop critic passed and voiceMatchScore ${score} >= ${VOICE_MATCH_FLOOR}`,
  };
}

/**
 * Convenience wrapper for transition call-sites: returns the gate result for a
 * gtmDraftedContent row. Reads only the two gate-relevant fields so it is
 * decoupled from the rest of the draft shape. Throws nothing — callers decide
 * how to act on a blocked verdict (throw, leave as draft, route to rejected).
 */
export function evaluateDraftedContentApprovalGate(
  draft: Pick<Doc<"gtmDraftedContent">, "slopCriticPassed" | "voiceMatchScore">
): ApprovalGateResult {
  return evaluateApprovalGate({
    slopCriticPassed: draft.slopCriticPassed,
    voiceMatchScore: draft.voiceMatchScore ?? null,
  });
}

export function parseApprovalMessage(message: string): {
  approved: boolean;
  edit?: string;
} {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "approve" || lower === "approved" || lower === "yes") {
    return { approved: true };
  }
  if (lower.startsWith("approve:") || lower.startsWith("approved:")) {
    return {
      approved: true,
      edit: trimmed.slice(trimmed.indexOf(":") + 1).trim(),
    };
  }
  return { approved: false };
}

export const createDraft = mutation({
  args: {
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    platform: PLATFORM,
    body: v.string(),
    evidenceCardIds: v.array(v.id("gtmEvidenceCards")),
  },
  handler: async (ctx, args): Promise<Id<"gtmContentDrafts">> => {
    const creator = await requireGtmCreator(ctx);
    await assertEvidence(ctx, creator._id, args.evidenceCardIds);
    const now = Date.now();
    return await ctx.db.insert("gtmContentDrafts", {
      accountId: creator._id,
      researchJobId: args.researchJobId,
      platform: args.platform,
      status: "drafted",
      body: args.body,
      evidenceCardIds: args.evidenceCardIds,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const approveDraft = mutation({
  args: {
    draftId: v.id("gtmContentDrafts"),
    message: v.string(),
    approvalMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ approved: boolean; finalBody?: string }> => {
    const creator = await requireGtmCreator(ctx);
    const draft = await requireDraft(ctx, creator._id, args.draftId);
    const parsed = parseApprovalMessage(args.message);
    if (!parsed.approved) return { approved: false };
    const now = Date.now();
    const finalBody = parsed.edit || draft.body;
    await ctx.db.patch(draft._id, {
      status: "approved",
      finalBody,
      approvalMessageId: args.approvalMessageId,
      approvedAt: now,
      updatedAt: now,
    });
    return { approved: true, finalBody };
  },
});

export const markPublished = mutation({
  args: {
    draftId: v.id("gtmContentDrafts"),
    externalPostId: v.string(),
    publishedUrl: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const creator = await requireGtmCreator(ctx);
    const draft = await requireDraft(ctx, creator._id, args.draftId);
    if (draft.status !== "approved") {
      throw new Error("cannot publish without approval");
    }
    const now = Date.now();
    await ctx.db.patch(draft._id, {
      status: "published",
      externalPostId: args.externalPostId,
      publishedUrl: args.publishedUrl,
      publishedAt: now,
      updatedAt: now,
    });
  },
});

export const markPublishFailed = mutation({
  args: {
    draftId: v.id("gtmContentDrafts"),
    failureReason: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const creator = await requireGtmCreator(ctx);
    const draft = await requireDraft(ctx, creator._id, args.draftId);
    const now = Date.now();
    await ctx.db.patch(draft._id, {
      status: "failed",
      failureReason: args.failureReason,
      updatedAt: now,
    });
  },
});

async function requireGtmCreator(ctx: MutationCtx): Promise<Doc<"creators">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("signed-in user required");
  const creator = await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (!creator || creator.accountType !== "gtm-agent") {
    throw new Error("GTM account not found");
  }
  return creator;
}

async function requireDraft(
  ctx: MutationCtx,
  accountId: Id<"creators">,
  draftId: Id<"gtmContentDrafts">
): Promise<Doc<"gtmContentDrafts">> {
  const draft = await ctx.db.get(draftId);
  if (!draft || draft.accountId !== accountId) {
    throw new Error("draft does not belong to this account");
  }
  return draft;
}

async function assertEvidence(
  ctx: MutationCtx,
  accountId: Id<"creators">,
  evidenceCardIds: Id<"gtmEvidenceCards">[]
): Promise<void> {
  for (const id of evidenceCardIds) {
    const card = await ctx.db.get(id);
    if (!card || card.accountId !== accountId) {
      throw new Error("draft evidence does not belong to this account");
    }
  }
}
