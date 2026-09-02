/**
 * Cost recording for model calls (plan §3, §16.4). One row per call, on success and
 * on failure, because a timed-out or empty completion still cost money. Vendor-reported
 * usage when the vendor gives it; the row is never computed from local price math.
 */

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const vendorArg = v.union(
  v.literal("scrapecreators"),
  v.literal("gemini"),
  v.literal("openrouter"),
  v.literal("zernio"),
  v.literal("groq"),
  v.literal("telegram"),
);

export const record = internalMutation({
  args: {
    creatorId: v.optional(v.id("creators")),
    vendor: vendorArg,
    resource: v.string(), // the model id or endpoint
    purpose: v.string(), // the skill or job kind
    costUsd: v.optional(v.number()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    now: v.optional(v.number()),
    costSource: v.optional(v.union(v.literal("vendor_reported"), v.literal("endpoint_table"), v.literal("tier_table"))),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("costEvents", {
      creatorId: a.creatorId,
      vendor: a.vendor,
      kind: `${a.purpose}:${a.resource}`,
      units: (a.promptTokens ?? 0) + (a.completionTokens ?? 0),
      costUsd: a.costUsd ?? 0,
      costSource: a.costSource ?? "vendor_reported",
      environment: process.env.ENVIRONMENT_NAME ?? "local",
      at: a.now ?? Date.now(),
    });
    return null;
  },
});
