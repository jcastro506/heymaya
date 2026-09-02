/**
 * Cost recording for model calls (plan §3, §16.4). One row per call, on success and
 * on failure, because a timed-out or empty completion still cost money. Vendor-reported
 * usage when the vendor gives it; the row is never computed from local price math.
 */

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { applyBump, emptyDay, kindForCost } from "./budgets";
import type { Doc } from "../_generated/dataModel";
import { dayKeyInZone } from "./cadence";

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
    // §3: budgets, never booleans. Every priced event lands on the creator's day.
    if (a.creatorId) {
      const kind = kindForCost(a.vendor, a.purpose, a.resource);
      if (kind) {
        const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
        const day = dayKeyInZone(a.now ?? Date.now(), creator?.timezone ?? "UTC");
        const existing = (await ctx.db.query("budgets").withIndex("by_creator_day", (q) => q.eq("creatorId", a.creatorId!).eq("day", day)).first()) as Doc<"budgets"> | null;
        const next = applyBump(existing ?? emptyDay(a.creatorId, day), kind, (a.promptTokens ?? 0) + (a.completionTokens ?? 0), a.costUsd ?? 0);
        if (existing) await ctx.db.patch(existing._id, { screenerTokens: next.screenerTokens, writerTokens: next.writerTokens, watches: next.watches, marginalCredits: next.marginalCredits, messages: next.messages, spentUsd: next.spentUsd });
        else await ctx.db.insert("budgets", next);
      }
    }
    return null;
  },
});
