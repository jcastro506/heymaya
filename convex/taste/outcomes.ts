/**
 * Learning from what actually happened (plan Sprint 4c).
 *
 * ⚠️ THE GAP THIS FILLS. Every learning path she had depended on the creator DOING
 * something: tapping a heart, saving an idea, saying something worth remembering. The live
 * pilot showed what that costs — nine ideas sent, one taste event, `notes` empty after three
 * days of real conversation — because a creator who mostly asks questions and rarely taps
 * teaches her nothing. Outcomes need no tap. A post either beat their normal or it did not,
 * and that fact is already in a row two days later.
 *
 * So: when a posted idea's numbers land, fold the RESULT back into taste, and let the
 * hook that beat their normal rise in the lines she quotes. Nothing here asks the creator
 * anything, and nothing here is a model's opinion.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { applyEvent, featureKeys, WEIGHTS, type Affinity } from "./affinities";

export const OUTCOME = {
  /** Two days of numbers before a post is evidence of anything (§13.7). */
  minAgeHours: 48,
  /** At or above their normal by this much is a win worth learning from. */
  winMultiple: 1.5,
  /** At or below this is a flop worth learning from. Between the two teaches nothing. */
  flopMultiple: 0.6,
  /** How hard the result pushes, relative to the tap that preceded it. A result outranks a tap. */
  winWeight: WEIGHTS.posted,
  flopWeight: -WEIGHTS.posted / 2,
} as const;

export interface Judged { ideaId: Id<"ideas">; ownPostId: Id<"ownPosts">; multiple: number; verdict: "win" | "flop" }

/** Pure: which posted ideas now have a verdict we have not learned from yet. */
export function judgeOutcomes(
  rows: Array<{ ideaId: Id<"ideas">; ownPostId: Id<"ownPosts">; multiple: number | null; postedAt: number; learnedAt?: number | null }>,
  now: number,
): Judged[] {
  const out: Judged[] = [];
  for (const r of rows) {
    if (r.learnedAt) continue;
    if (r.multiple === null || !Number.isFinite(r.multiple)) continue;
    if (now - r.postedAt < OUTCOME.minAgeHours * 3_600_000) continue;
    if (r.multiple >= OUTCOME.winMultiple) out.push({ ideaId: r.ideaId, ownPostId: r.ownPostId, multiple: r.multiple, verdict: "win" });
    else if (r.multiple <= OUTCOME.flopMultiple) out.push({ ideaId: r.ideaId, ownPostId: r.ownPostId, multiple: r.multiple, verdict: "flop" });
    // Between the two the post is simply normal, and normal teaches nothing.
  }
  return out;
}

export const pending = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<Judged[]> => {
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator_status", (q) => q.eq("creatorId", a.creatorId).eq("status", "posted")).order("desc").take(60)) as Doc<"ideas">[];
    const rows = [] as Array<{ ideaId: Id<"ideas">; ownPostId: Id<"ownPosts">; multiple: number | null; postedAt: number; learnedAt?: number | null }>;
    for (const i of ideas) {
      if (!i.matchedPostId || !i.postedAt) continue;
      const post = (await ctx.db.get(i.matchedPostId)) as Doc<"ownPosts"> | null;
      if (!post) continue;
      rows.push({ ideaId: i._id, ownPostId: post._id, multiple: post.multiple ?? null, postedAt: i.postedAt, learnedAt: i.outcomeLearnedAt ?? null });
    }
    return judgeOutcomes(rows, a.now);
  },
});

/**
 * Fold one verdict in. A result outranks the tap that preceded it: a format they hearted
 * and then flopped with moves DOWN, which a tap-only system could never learn.
 */
export const learn = internalMutation({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas"), verdict: v.union(v.literal("win"), v.literal("flop")), multiple: v.number(), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ learned: boolean; keys: string[] }> => {
    const now = a.now ?? Date.now();
    const idea = (await ctx.db.get(a.ideaId)) as Doc<"ideas"> | null;
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!idea || !creator || idea.creatorId !== a.creatorId) return { learned: false, keys: [] };
    if (idea.outcomeLearnedAt) return { learned: false, keys: [] }; // once per idea, ever
    const keys = featureKeys(idea.features);
    // Scaled by how far it went: a 4× win teaches more than a 1.6× one, capped so one
    // freak post cannot rewrite their taste.
    const scale = a.verdict === "win" ? Math.min(2, a.multiple / OUTCOME.winMultiple) : Math.min(2, OUTCOME.flopMultiple / Math.max(0.05, a.multiple));
    const weight = (a.verdict === "win" ? OUTCOME.winWeight : OUTCOME.flopWeight) * scale;
    await ctx.db.insert("tasteEvents", { creatorId: a.creatorId, ideaId: a.ideaId, kind: a.verdict === "win" ? "outcome_win" : "outcome_flop", weight, features: keys, at: now });
    if (keys.length) await ctx.db.patch(a.creatorId, { affinities: applyEvent((creator.affinities ?? []) as Affinity[], keys, weight, now), updatedAt: now });
    await ctx.db.patch(a.ideaId, { outcomeLearnedAt: now, outcomeMultiple: a.multiple });
    return { learned: true, keys };
  },
});

/** The nightly sweep: every creator, every posted idea whose numbers have landed. */
export const runAll = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ creators: number; learned: number }> => {
    const now = a.now ?? Date.now();
    const ids = await ctx.runQuery(internal.taste.outcomes.creatorsWithPosted, {});
    let learned = 0;
    for (const creatorId of ids) {
      const rows = await ctx.runQuery(internal.taste.outcomes.pending, { creatorId, now });
      for (const r of rows) {
        const done = await ctx.runMutation(internal.taste.outcomes.learn, { creatorId, ideaId: r.ideaId, verdict: r.verdict, multiple: r.multiple, now });
        if (done.learned) learned++;
      }
    }
    return { creators: ids.length, learned };
  },
});

export const creatorsWithPosted = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"creators">[]> =>
    ((await ctx.db.query("creators").take(500)) as Doc<"creators">[]).filter((c) => c.dossier).map((c) => c._id),
});
