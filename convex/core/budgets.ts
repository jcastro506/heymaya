/**
 * Daily budgets (plan §3, §13.8 "budget exhausted", §19.3 "budgets are derived from
 * the plan row"). Budgets, never booleans: every cost event bumps the creator's row for
 * the day on their clock, and the gate refuses proactive work once the day's spend or
 * watch count is at the cap. Trial and paid have identical budgets; paused, canceled
 * and past-due-beyond-grace zero the proactive budget (the gate reads the plan for
 * those). Nothing here throttles a reply they asked for.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { dayKeyInZone } from "./cadence";
import { THRESHOLDS } from "../config/thresholds";

export type BudgetKind = "screener" | "writer" | "watch" | "credits" | "message";

export function emptyDay(creatorId: Id<"creators">, day: string): Omit<Doc<"budgets">, "_id" | "_creationTime"> {
  return { creatorId, day, screenerTokens: 0, writerTokens: 0, watches: 0, marginalCredits: 0, messages: 0, spentUsd: 0 };
}

/** What a cost event does to the day's row. Pure. */
export function applyBump(row: Omit<Doc<"budgets">, "_id" | "_creationTime">, kind: BudgetKind, units: number, usd: number): Omit<Doc<"budgets">, "_id" | "_creationTime"> {
  const next = { ...row, spentUsd: Math.round((row.spentUsd + usd) * 1_000_000) / 1_000_000 };
  if (kind === "screener") next.screenerTokens += units;
  else if (kind === "writer") next.writerTokens += units;
  else if (kind === "watch") next.watches += 1;
  else if (kind === "credits") next.marginalCredits += units;
  else if (kind === "message") next.messages += 1;
  return next;
}

/** The rail (§13.8): true when the day's proactive budget is spent. Pure. */
export function budgetExhausted(row: Pick<Doc<"budgets">, "spentUsd" | "watches" | "marginalCredits"> | null): string | null {
  if (!row) return null;
  if (row.spentUsd >= THRESHOLDS.dailyUsdCap) return `day's spend at $${row.spentUsd.toFixed(2)} (cap $${THRESHOLDS.dailyUsdCap})`;
  if (row.watches >= THRESHOLDS.dailyWatchCap) return `${row.watches} watches today (cap ${THRESHOLDS.dailyWatchCap})`;
  if (row.marginalCredits >= THRESHOLDS.dailyCreditCap) return `${row.marginalCredits} vendor credits today (cap ${THRESHOLDS.dailyCreditCap})`;
  return null;
}

export const bump = internalMutation({
  args: { creatorId: v.id("creators"), kind: v.union(v.literal("screener"), v.literal("writer"), v.literal("watch"), v.literal("credits"), v.literal("message")), units: v.optional(v.number()), usd: v.optional(v.number()), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ day: string; spentUsd: number }> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const day = dayKeyInZone(a.now ?? Date.now(), creator?.timezone ?? "UTC");
    const existing = (await ctx.db.query("budgets").withIndex("by_creator_day", (q) => q.eq("creatorId", a.creatorId).eq("day", day)).first()) as Doc<"budgets"> | null;
    const base = existing ?? emptyDay(a.creatorId, day);
    const next = applyBump(base, a.kind, a.units ?? 0, a.usd ?? 0);
    if (existing) await ctx.db.patch(existing._id, { screenerTokens: next.screenerTokens, writerTokens: next.writerTokens, watches: next.watches, marginalCredits: next.marginalCredits, messages: next.messages, spentUsd: next.spentUsd });
    else await ctx.db.insert("budgets", next);
    return { day, spentUsd: next.spentUsd };
  },
});

export const today = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<Doc<"budgets"> | null> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const day = dayKeyInZone(a.now, creator.timezone);
    return (await ctx.db.query("budgets").withIndex("by_creator_day", (q) => q.eq("creatorId", a.creatorId).eq("day", day)).first()) as Doc<"budgets"> | null;
  },
});

/** Which budget a cost event belongs to, from its vendor and purpose. Pure. */
export function kindForCost(vendor: string, purpose: string, resource: string): BudgetKind | null {
  if (vendor === "scrapecreators") return "credits";
  if (vendor === "gemini") return /watch|scene|media_kind|read_screenshot|voice/.test(purpose) ? "watch" : "writer";
  if (vendor === "openrouter") return /critic|classify|screen|calendar_classify|match_post|remember|taste_reply|format_watch|eval_judge/.test(purpose) || /glm|deepseek/.test(resource) ? "screener" : "writer";
  return null;
}
