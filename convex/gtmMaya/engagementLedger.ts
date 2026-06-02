/**
 * Maya v2 (S3) — the engagement ledger: never reply twice to the same thread
 * or comment.
 *
 * Autonomous posting every few hours is exactly where a double-comment bug
 * bites, so dedup is a HARD server-side guarantee, not prompt discipline.
 * Authority lives in Convex (every cron + pulse shares it and it survives
 * machine restarts); OpenClaw just ASKS Convex before drafting, and the
 * publish path ENFORCES it regardless of what the model did.
 *
 * Granularity is per-COMMENT (operator call 2026-06-02): the key is
 * (agentId, platform, targetExternalId[, targetCommentId]). Replying to two
 * DIFFERENT comments in one thread is allowed; replying to the SAME comment
 * (or the same thread at thread level) twice is refused unless the caller
 * passes intentionalFollowUp:true.
 *
 * No new index: the scan uses gtmPostResults.by_agent + inline filters
 * (mirrors the gtmTargetThreads dedupe-scan pattern). gtmPostResults rows are
 * per-agent low-cardinality, so this is cheap.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export interface AlreadyEngagedResult {
  engaged: boolean;
  /** Thread-level engagement (we replied to this thread before). */
  threadEngaged: boolean;
  /** Comment-level engagement (we replied to this specific comment before). */
  commentEngaged: boolean;
  /** The matching prior post-result id, if any. */
  priorPostResultId: Id<"gtmPostResults"> | null;
  priorProviderPostId: string | null;
}

/**
 * Pure dedup decision over a set of prior post-results for one agent+platform.
 * Exported for direct unit testing without a DB.
 *
 * Rule: if commentId is supplied, "engaged" means a prior row replied to that
 * exact comment. If commentId is omitted, "engaged" means a prior row replied
 * to the thread at thread level (a row with this targetExternalId and NO
 * targetCommentId), OR any prior reply exists for the thread (thread-level
 * caller should not double-post the thread root).
 */
export function decideAlreadyEngaged(
  priors: Array<
    Pick<Doc<"gtmPostResults">, "_id" | "providerPostId" | "targetExternalId" | "targetCommentId">
  >,
  externalId: string,
  commentId: string | undefined
): AlreadyEngagedResult {
  const forThread = priors.filter((p) => p.targetExternalId === externalId);
  let threadEngaged = false;
  let commentEngaged = false;
  let match:
    | Pick<Doc<"gtmPostResults">, "_id" | "providerPostId" | "targetExternalId" | "targetCommentId">
    | null = null;

  for (const p of forThread) {
    if (commentId) {
      if (p.targetCommentId === commentId) {
        commentEngaged = true;
        match = p;
        break;
      }
    } else {
      // Thread-level request: a prior reply to the thread ROOT (no commentId)
      // is the conflict. Replies to specific comments do NOT block a separate
      // thread-root reply, and vice versa.
      if (!p.targetCommentId) {
        threadEngaged = true;
        match = p;
        break;
      }
    }
  }

  return {
    engaged: threadEngaged || commentEngaged,
    threadEngaged,
    commentEngaged,
    priorPostResultId: match?._id ?? null,
    priorProviderPostId: match?.providerPostId ?? null,
  };
}

/**
 * Has this agent already replied to (platform, externalId[, commentId])?
 * The cheap prompt-layer pre-check (the plugin calls this before drafting),
 * AND the read the publish gate uses to enforce. Cross-tenant safe: scoped to
 * the agentId passed by the authenticated caller.
 */
export const checkAlreadyEngaged = internalQuery({
  args: {
    agentId: v.id("gtmAgents"),
    platform: v.string(),
    externalId: v.string(),
    commentId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AlreadyEngagedResult> => {
    const priors = await ctx.db
      .query("gtmPostResults")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .filter((q) => q.eq(q.field("platform"), args.platform))
      .collect();
    return decideAlreadyEngaged(
      priors.map((p) => ({
        _id: p._id,
        providerPostId: p.providerPostId,
        targetExternalId: p.targetExternalId,
        targetCommentId: p.targetCommentId,
      })),
      args.externalId,
      args.commentId
    );
  },
});

/**
 * Stamp the ledger when a reply is published. Records the published post-result
 * keyed to exactly what we replied to. Called by the publish path AFTER a
 * successful Zernio publish.
 */
export const recordEngagement = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    draftId: v.id("gtmDraftedContent"),
    platform: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("hn"),
      v.literal("linkedin"),
      v.literal("instagram"),
      v.literal("tiktok"),
      v.literal("youtube")
    ),
    providerPostId: v.string(),
    targetExternalId: v.string(),
    targetCommentId: v.optional(v.string()),
    intentionalFollowUp: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"gtmPostResults">> => {
    return await ctx.db.insert("gtmPostResults", {
      accountId: args.accountId,
      agentId: args.agentId,
      draftId: args.draftId,
      snapshotAtMs: Date.now(),
      platform: args.platform,
      providerPostId: args.providerPostId,
      metrics: {},
      surfacedToOperator: false,
      targetExternalId: args.targetExternalId,
      targetCommentId: args.targetCommentId,
      intentionalFollowUp: args.intentionalFollowUp,
    });
  },
});

/**
 * The publish-gate decision. Pure + deterministic so the publish path can call
 * it inline and tests are trivial. Returns whether the reply may be published.
 * Fail-closed: an already-engaged target is refused UNLESS the caller passed an
 * explicit intentionalFollowUp override.
 */
export function evaluateDedupGate(
  prior: AlreadyEngagedResult,
  intentionalFollowUp: boolean
): { allow: boolean; reason: string | null } {
  if (!prior.engaged) return { allow: true, reason: null };
  if (intentionalFollowUp) {
    return { allow: true, reason: "intentional-follow-up override" };
  }
  const level = prior.commentEngaged ? "comment" : "thread";
  return {
    allow: false,
    reason: `already engaged at ${level} level (prior post ${prior.priorProviderPostId ?? "?"}); set intentionalFollowUp to override`,
  };
}
