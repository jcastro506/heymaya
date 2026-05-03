/**
 * Internal mutation: write one row to aiCallLog.
 * Kept separate from maya.ts so the router action stays composable and the
 * write path is trivially testable / mockable.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

export const recordAiCall = internalMutation({
  args: {
    creatorId: v.id("creators"),
    taskTag: v.string(),
    model: v.string(),
    thinkingBudget: v.union(
      v.literal("none"),
      v.literal("low"),
      v.literal("medium"),
      v.literal("high")
    ),
    inputTokens: v.number(),
    outputTokens: v.number(),
    thinkingTokens: v.optional(v.number()),
    costUsd: v.number(),
    latencyMs: v.number(),
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("aiCallLog", args);
  },
});
