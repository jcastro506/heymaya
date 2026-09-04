/**
 * How long she has known them, and what she can reach for (plan Sprint 4c).
 *
 * A friend who has known you six months talks differently from one who met you last week.
 * Until now she talked the same on day 180 as on day 2: the dossier said "thin read" or it
 * did not, and nothing else changed. Three things change here, all computed from rows:
 *
 *  1. `standing` — how much she has actually seen, in words, so her claims can get bolder
 *     only as the evidence does. This is honesty, not flattery: week one SHOULD hedge.
 *  2. `patterns` — the third time an object-open beat their normal is worth saying, and it
 *     is a fact about their rows, not a model's impression.
 *  3. `milestone` — first post over 100k, a month together, fifty ideas. Said once, ever,
 *     in one line. Never confetti.
 *
 * ⚠️ The prompt must not grow as history grows. Everything here is a fixed handful of
 * lines however long they stay, which is the whole reason it is computed rather than
 * accumulated. A test asserts that at simulated month six.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export const HISTORY = {
  /** Below this many read posts she says so and hedges. */
  thinPosts: 12,
  /** At or above this she has seen enough to be plain about patterns. */
  solidPosts: 30,
  /** A pattern needs this many wins on the same feature before it is worth saying. */
  minPatternWins: 3,
  /** Milestones, each said once. */
  viewsMilestones: [100_000, 1_000_000] as const,
  ideaMilestones: [50, 200] as const,
  monthsMilestones: [1, 6, 12] as const,
} as const;

export interface Standing {
  postsRead: number;
  daysTogether: number;
  ideasSent: number;
  postedFromHer: number;
  confidence: "new" | "thin" | "solid";
}

export interface Pattern { key: string; wins: number; medianMultiple: number }

/** Pure. What she has seen, said the way she would say it. */
export function standingLine(s: Standing): string {
  const weeks = Math.floor(s.daysTogether / 7);
  const together = s.daysTogether < 10 ? "you have just started working together" : weeks < 8 ? `you have been working together about ${weeks} weeks` : `you have been working together about ${Math.round(s.daysTogether / 30)} months`;
  const seen = s.confidence === "new" ? "you have barely seen their work yet, so say so and do not generalise" : s.confidence === "thin" ? `you have read ${s.postsRead} of their posts, which is a thin read: hedge a claim about what "always" works` : `you have read ${s.postsRead} of their posts, enough to be plain about what works for them without hedging`;
  const track = s.postedFromHer > 0 ? ` They have posted ${s.postedFromHer} of your ideas.` : s.ideasSent > 3 ? " They have not posted one of your ideas yet; do not mention that." : "";
  return `${together}. ${seen}.${track}`;
}

/** Pure. Patterns worth a callback, best first. */
export function patternLines(patterns: Pattern[]): string[] {
  return patterns
    .filter((p) => p.wins >= HISTORY.minPatternWins)
    .slice(0, 3)
    .map((p) => `- ${p.key.replace(":", " ")}: ${p.wins} of their posts beat their normal with it (median ${p.medianMultiple}×). You may say "that's the third time…" when it is true.`);
}

export async function historyFor(ctx: QueryCtx, creator: Doc<"creators">): Promise<{ standing: Standing; patterns: Pattern[] }> {
  const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).take(200)) as Doc<"ownPosts">[];
  const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).take(300)) as Doc<"ideas">[];
  const postedFromHer = ideas.filter((i) => i.status === "posted").length;
  const daysTogether = Math.max(0, Math.floor((Date.now() - creator.createdAt) / 86_400_000));
  const postsRead = posts.length;
  const confidence: Standing["confidence"] = postsRead >= HISTORY.solidPosts ? "solid" : postsRead >= HISTORY.thinPosts ? "thin" : "new";

  // Patterns from OUTCOMES, not from taps: which features their winning posts share.
  const winning = ideas.filter((i) => i.outcomeMultiple !== undefined && (i.outcomeMultiple ?? 0) >= 1.5);
  const byKey = new Map<string, number[]>();
  for (const i of winning) {
    const f = i.features as { format?: string; tone?: string; lengthBucket?: string } | undefined;
    for (const key of [f?.format ? `format:${f.format}` : null, f?.tone ? `tone:${f.tone}` : null, f?.lengthBucket ? `length:${f.lengthBucket}` : null]) {
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), i.outcomeMultiple as number]);
    }
  }
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return Math.round((s[Math.floor(s.length / 2)] ?? 0) * 100) / 100; };
  const patterns = [...byKey.entries()].map(([key, ms]) => ({ key, wins: ms.length, medianMultiple: med(ms) })).sort((a, b) => b.wins - a.wins || b.medianMultiple - a.medianMultiple);
  return { standing: { postsRead, daysTogether, ideasSent: ideas.length, postedFromHer, confidence }, patterns };
}

/** The prefix block. Bounded: one standing line plus at most three patterns, forever. */
export function historySection(h: { standing: Standing; patterns: Pattern[] }): string {
  const lines = patternLines(h.patterns);
  return `# How well you know them (your claims may be only as bold as this)\n${standingLine(h.standing)}\n${lines.length ? `\nWhat their own results say, so far:\n${lines.join("\n")}` : ""}`.trim();
}

export const forCreator = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ standing: Standing; patterns: Pattern[] } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return c ? await historyFor(ctx, c) : null;
  },
});

// ------------------------------------------------------------------ milestones

export interface Milestone { key: string; line: string }

/** Pure. The one milestone worth saying now, or null. Ordered so the biggest wins. */
export function pickMilestone(input: { topViews: number; ideasSent: number; monthsTogether: number; said: string[] }): Milestone | null {
  const said = new Set(input.said);
  for (const v of [...HISTORY.viewsMilestones].reverse()) {
    const key = `views:${v}`;
    if (input.topViews >= v && !said.has(key)) return { key, line: `that one crossed ${v >= 1_000_000 ? "a million" : `${Math.round(v / 1000)}k`}. your biggest yet.` };
  }
  for (const m of [...HISTORY.monthsMilestones].reverse()) {
    const key = `months:${m}`;
    if (input.monthsTogether >= m && !said.has(key)) return { key, line: m === 1 ? "a month of this today. your best format so far is the one you almost didn't post." : `${m} months of this today.` };
  }
  for (const n of [...HISTORY.ideaMilestones].reverse()) {
    const key = `ideas:${n}`;
    if (input.ideasSent >= n && !said.has(key)) return { key, line: `that was idea number ${n} from me. thanks for reading them.` };
  }
  return null;
}

export const milestoneInputs = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ topViews: number; ideasSent: number; monthsTogether: number; said: string[] } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(200)) as Doc<"ownPosts">[];
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(300)) as Doc<"ideas">[];
    return {
      topViews: posts.reduce((m, p) => Math.max(m, p.metrics.views), 0),
      ideasSent: ideas.length,
      monthsTogether: Math.floor((Date.now() - c.createdAt) / (30 * 86_400_000)),
      said: c.milestonesSaid ?? [],
    };
  },
});

export const markSaid = internalMutation({
  args: { creatorId: v.id("creators"), key: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    await ctx.db.patch(a.creatorId, { milestonesSaid: Array.from(new Set([...(c.milestonesSaid ?? []), a.key])), updatedAt: Date.now() });
    return null;
  },
});

export type HistoryCreatorId = Id<"creators">;
