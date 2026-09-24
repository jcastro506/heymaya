/**
 * Cost recording for model calls (plan §3, §16.4). One row per call, on success and
 * on failure, because a timed-out or empty completion still cost money. Vendor-reported
 * usage when the vendor gives it; the row is never computed from local price math.
 */

import { internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
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
  v.literal("claw"),
  v.literal("tavily"),
);

export function summarizeLatency(rows: Array<{ kind: string; latencyMs?: number; succeeded?: boolean; failureKind?: string }>): Array<{ purpose: string; calls: number; p50Ms: number; p95Ms: number; failures: number; failureKinds: Record<string, number> }> {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (typeof row.latencyMs !== "number") continue;
    const purpose = row.kind.split(":", 1)[0];
    groups.set(purpose, [...(groups.get(purpose) ?? []), row]);
  }
  return [...groups.entries()].map(([purpose, values]) => {
    const times = values.map((row) => row.latencyMs!).sort((a, b) => a - b);
    const at = (p: number) => times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)];
    const failureKinds: Record<string, number> = {};
    for (const row of values.filter((value) => value.succeeded === false)) failureKinds[row.failureKind ?? "unknown"] = (failureKinds[row.failureKind ?? "unknown"] ?? 0) + 1;
    return { purpose, calls: values.length, p50Ms: at(0.5), p95Ms: at(0.95), failures: values.filter((value) => value.succeeded === false).length, failureKinds };
  }).sort((a, b) => b.p95Ms - a.p95Ms);
}

export const latencyReport = internalQuery({
  args: { since: v.number(), creatorIds: v.optional(v.array(v.id("creators"))) },
  handler: async (ctx, a) => {
    const allowed = a.creatorIds ? new Set(a.creatorIds.map(String)) : null;
    const rows = await ctx.db.query("costEvents").withIndex("by_at", (q) => q.gte("at", a.since)).collect();
    return summarizeLatency(rows.filter((row) => !allowed || (row.creatorId && allowed.has(String(row.creatorId)))));
  },
});

export const record = internalMutation({
  args: {
    creatorId: v.optional(v.id("creators")),
    vendor: vendorArg,
    resource: v.string(), // the model id or endpoint
    purpose: v.string(), // the skill or job kind
    costUsd: v.optional(v.number()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    succeeded: v.optional(v.boolean()),
    failureKind: v.optional(v.string()),
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
      latencyMs: a.latencyMs,
      succeeded: a.succeeded,
      failureKind: a.failureKind,
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
