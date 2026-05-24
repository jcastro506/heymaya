/**
 * Sprint 2.6 — daily heartbeat results scan persistence.
 *
 * The published-post-results-scan heartbeat task (HEARTBEAT.md, interval
 * 6h) refreshes metrics for each published draft + posts a snapshot
 * here. Compare against prior snapshots to detect significant changes.
 *
 * Mutations:
 *   - recordPostResultSnapshot — heartbeat writes one row per scan
 *   - markResultSnapshotSurfaced — heartbeat flags when it surfaced a
 *     Telegram nudge (used by mission board to avoid double-surfacing)
 *
 * Queries:
 *   - getLatestSnapshotForDraft — internal helper: heartbeat reads
 *     before deciding "is this snapshot a significant delta?"
 *   - getMyRecentPostResults — public, mission-board surface
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const PLATFORM = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("hn"),
  v.literal("linkedin"),
  v.literal("instagram"),
  v.literal("tiktok")
);

const METRICS = v.object({
  likes: v.optional(v.number()),
  comments: v.optional(v.number()),
  shares: v.optional(v.number()),
  views: v.optional(v.number()),
  upvotes: v.optional(v.number()),
  downvotes: v.optional(v.number()),
});

export const recordPostResultSnapshot = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    draftId: v.id("gtmDraftedContent"),
    platform: PLATFORM,
    providerPostId: v.string(),
    metrics: METRICS,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmPostResults">> => {
    // Defense-in-depth — confirm the draft really belongs to this
    // agent before persisting. HTTP-layer auth already resolved the
    // agentId from the hookToken; this guards against a subagent
    // writing to a different agent's draft.
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      throw new Error("recordPostResultSnapshot: draft not found.");
    }
    if (draft.agentId !== args.agentId || draft.accountId !== args.accountId) {
      throw new Error(
        "recordPostResultSnapshot: agent/account mismatch on draft."
      );
    }
    return await ctx.db.insert("gtmPostResults", {
      accountId: args.accountId,
      agentId: args.agentId,
      draftId: args.draftId,
      snapshotAtMs: Date.now(),
      platform: args.platform,
      providerPostId: args.providerPostId,
      metrics: args.metrics,
      surfacedToOperator: false,
      notes: args.notes,
    });
  },
});

export const markResultSnapshotSurfaced = internalMutation({
  args: { id: v.id("gtmPostResults") },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.id, { surfacedToOperator: true });
  },
});

export const getLatestSnapshotForDraft = internalQuery({
  args: { draftId: v.id("gtmDraftedContent") },
  handler: async (
    ctx,
    args
  ): Promise<Doc<"gtmPostResults"> | null> => {
    const rows = await ctx.db
      .query("gtmPostResults")
      .withIndex("by_draft", (q) => q.eq("draftId", args.draftId))
      .order("desc")
      .take(2);
    // Index ordering on by_draft is creation-time desc, so rows[0] is
    // the snapshot being written and rows[1] is the prior baseline.
    return rows[1] ?? null;
  },
});

export const getMyRecentPostResults = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"gtmPostResults">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return [];
    const limit = Math.min(Math.max(1, args.limit ?? 30), 200);
    return await ctx.db
      .query("gtmPostResults")
      .withIndex("by_account_and_snapshot", (q) =>
        q.eq("accountId", creator._id)
      )
      .order("desc")
      .take(limit);
  },
});

/**
 * Sprint 2.7 — internal read for Maya's runtime (hookToken-auth via
 * the HTTP wrapper). Returns the agent's recent snapshots ordered by
 * snapshotAtMs desc.
 */
export const listAgentRecentPostResults = internalQuery({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"gtmPostResults">[]> => {
    const limit = Math.min(Math.max(1, args.limit ?? 30), 200);
    const rows = await ctx.db
      .query("gtmPostResults")
      .withIndex("by_account_and_snapshot", (q) =>
        q.eq("accountId", args.accountId)
      )
      .order("desc")
      .take(limit);
    // Defense-in-depth: filter to this agent only (HTTP auth already
    // resolved both IDs but the index is account-scoped, not agent-scoped).
    return rows.filter((r) => r.agentId === args.agentId);
  },
});
