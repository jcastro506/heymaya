/**
 * Sprint 2.27 — record published posts + schedule metric polling.
 *
 * Flow:
 *   1. Operator posts (e.g., replies on a calendar event "I posted!")
 *   2. Maya POSTs to /lc_gtm/record_published with the draftId +
 *      providerPostId + platform + permalink.
 *   3. recordDraftPublished patches gtmDraftedContent status →
 *      "published", fills providerPostId + publishedAt.
 *   4. Schedules pollAndRecordPostMetrics three times: T+2h, T+24h,
 *      T+7d (per maya-results-reviewer's review windows).
 *   5. Each poll fetches engagement metrics + writes a gtmPostResults
 *      row. The actual fetch goes through Composio (when OAuth is
 *      connected) or returns 0s with a "no_oauth" note (this v1
 *      stubs the fetch — Sprint 2.27b wires real Composio calls).
 *
 * Cross-tenant safety: the HTTP endpoint authenticates via hookToken
 * (auth.agentId + auth.accountId). The internal mutation re-verifies
 * draft.agentId === auth.agentId.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const PLATFORM = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("hn"),
  v.literal("linkedin"),
  v.literal("instagram"),
  v.literal("tiktok")
);

const POLL_WINDOWS_MS = {
  T_PLUS_2H: 2 * 60 * 60 * 1000,
  T_PLUS_24H: 24 * 60 * 60 * 1000,
  T_PLUS_7D: 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Internal mutation called from the HTTP handler. Patches the draft
 * to "published", then schedules the three polling windows.
 */
export const recordDraftPublished = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    draftId: v.id("gtmDraftedContent"),
    providerPostId: v.string(),
    platform: PLATFORM,
    permalink: v.optional(v.string()),
    postedAtMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    draftId: Id<"gtmDraftedContent">;
    polledAt: { tPlus2h: number; tPlus24h: number; tPlus7d: number };
  }> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      throw new Error("recordDraftPublished: draft not found");
    }
    if (
      draft.agentId !== args.agentId ||
      draft.accountId !== args.accountId
    ) {
      throw new Error(
        "recordDraftPublished: agent/account mismatch on draft"
      );
    }
    if (draft.platform !== args.platform) {
      throw new Error(
        `recordDraftPublished: platform mismatch — draft is ${draft.platform}, payload says ${args.platform}`
      );
    }

    const postedAtMs = args.postedAtMs ?? Date.now();
    await ctx.db.patch(args.draftId, {
      approvalState: "published",
      providerPostId: args.providerPostId,
      publishedAt: postedAtMs,
      updatedAt: Date.now(),
    });

    // Schedule the three polling windows. We use Convex's scheduler
    // (ctx.scheduler) so each window fires even if the gateway is
    // restarted. Each schedule call returns a job id we could store
    // for cancellation, but for v1 we let them fire-and-forget.
    const tPlus2h = postedAtMs + POLL_WINDOWS_MS.T_PLUS_2H;
    const tPlus24h = postedAtMs + POLL_WINDOWS_MS.T_PLUS_24H;
    const tPlus7d = postedAtMs + POLL_WINDOWS_MS.T_PLUS_7D;

    await ctx.scheduler.runAt(
      tPlus2h,
      internal.gtmMaya.recordPublished.pollAndRecordPostMetrics,
      {
        agentId: args.agentId,
        accountId: args.accountId,
        draftId: args.draftId,
        providerPostId: args.providerPostId,
        platform: args.platform,
        window: "t_plus_2h",
      }
    );
    await ctx.scheduler.runAt(
      tPlus24h,
      internal.gtmMaya.recordPublished.pollAndRecordPostMetrics,
      {
        agentId: args.agentId,
        accountId: args.accountId,
        draftId: args.draftId,
        providerPostId: args.providerPostId,
        platform: args.platform,
        window: "t_plus_24h",
      }
    );
    await ctx.scheduler.runAt(
      tPlus7d,
      internal.gtmMaya.recordPublished.pollAndRecordPostMetrics,
      {
        agentId: args.agentId,
        accountId: args.accountId,
        draftId: args.draftId,
        providerPostId: args.providerPostId,
        platform: args.platform,
        window: "t_plus_7d",
      }
    );

    return {
      draftId: args.draftId,
      polledAt: { tPlus2h, tPlus24h, tPlus7d },
    };
  },
});

/**
 * Internal action — invoked at each poll window by the scheduler.
 * Fetches metrics from Composio (when OAuth connected) or stubs
 * zeros for v1. Persists a gtmPostResults snapshot.
 *
 * Soft-fail per call: if fetch errors, persist a snapshot with empty
 * metrics + note so the review window isn't completely lost.
 */
export const pollAndRecordPostMetrics = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    draftId: v.id("gtmDraftedContent"),
    providerPostId: v.string(),
    platform: PLATFORM,
    window: v.union(
      v.literal("t_plus_2h"),
      v.literal("t_plus_24h"),
      v.literal("t_plus_7d")
    ),
  },
  handler: async (ctx, args): Promise<{ snapshotId: Id<"gtmPostResults"> }> => {
    // Sprint 2.27 v1 — STUB: fetch is not wired yet (needs Composio
    // OAuth per-operator in 2.27b). Persist zeros + a note so we have
    // a row to compare deltas against once the real fetcher lands.
    const metrics = {
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
    };
    const notes = `auto_poll:${args.window} — metric fetch not yet wired (Sprint 2.27b pending Composio OAuth)`;

    const snapshotId = await ctx.runMutation(
      internal.gtmMaya.postResults.recordPostResultSnapshot,
      {
        agentId: args.agentId,
        accountId: args.accountId,
        draftId: args.draftId,
        platform: args.platform,
        providerPostId: args.providerPostId,
        metrics,
        notes,
      }
    );
    return { snapshotId };
  },
});

/**
 * Internal query — read recent published drafts for an agent.
 * Used by maya-results-reviewer + tests.
 */
export const listMyPublishedDrafts = internalQuery({
  args: {
    agentId: v.id("gtmAgents"),
    sinceMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("gtmDraftedContent")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    const since = args.sinceMs ?? 0;
    return all
      .filter(
        (d) =>
          d.approvalState === "published" && (d.publishedAt ?? 0) >= since
      )
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  },
});
