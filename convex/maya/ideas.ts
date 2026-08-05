/**
 * The idea bank (§7.4) — a standing inventory, never a blank page.
 *
 * > *"Ideas come from a standing inventory, never a blank page. Generating from
 * > scratch each morning is how you get '5 productivity tips.'"*
 *
 * That failure was **measured** on 2026-08-05. Asked for ten varied posts with
 * no bank to draw on, she returned one idea ten times — `"dashboard"` appeared
 * in 10 of 10 — and the register was *fine*. A different-family judge sorted
 * them from real captions at chance. Good prose, one thought.
 *
 * Asked to scroll first, the same model produced ten genuinely different posts:
 * mean similarity **0.170 → 0.028**, topic coverage **1.00 → 0.50**. The bank is
 * that difference, made durable instead of depending on how the turn was phrased.
 *
 * ## Evidence is the entry requirement
 *
 * The schema says it: *"An idea with no evidence is a guess, and guesses don't
 * get published."* Every row carries what made it worth writing — the complaint,
 * the observation, the thing someone actually said — so a draft can always trace
 * back to a real person.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { toMillis } from "./learnBusiness";
import { similarity } from "./quality";
import type { Doc, Id } from "../_generated/dataModel";

/** Where an idea came from. Kept as strings — new sources shouldn't need a migration. */
export const IDEA_SOURCES = [
  "complaint",      // sweep 4 — what people keep asking. §5.1's highest-signal input.
  "observation",    // the morning scroll — something moving right now
  "own_comment",    // a buyer telling us what to make, on our own post
  "format_card",    // a proven shape looking for content
  "founder",        // they told us directly
  "performance",    // something of ours that worked
] as const;
export type IdeaSource = (typeof IDEA_SOURCES)[number];

export interface Evidence {
  /** What was actually said or seen. Their words, not our summary. */
  quote: string;
  /** Where to check it. An idea whose evidence can't be opened is an opinion. */
  sourceUrls: string[];
  /** How many distinct people said a version of this, when we know. */
  frequency?: number;
  observedAt?: number;
}

export interface ScoredIdea {
  angle: string;
  source: IdeaSource;
  evidence: Evidence;
  score: number;
  /** Which term made it score — so a low score can be argued with. */
  why: string;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * §7.4: `today's relevance × format fit × recency decay × past performance`.
 *
 * **Multiplicative, and that is the design.** Any term at zero kills the idea:
 * a perfect angle nobody can act on this week is not a post, and neither is a
 * timely one with no evidence. Summing would let a strong term paper over a
 * fatal one.
 */
export const RECENCY_HALF_LIFE_MS = 10 * 24 * 60 * 60 * 1000;

export function recencyDecay(observedAt: number | undefined, now: number): number {
  const ms = toMillis(observedAt ?? null);
  if (ms === null) return 0.5; // undated: neither fresh nor stale
  const age = Math.max(0, now - ms);
  return Math.pow(0.5, age / RECENCY_HALF_LIFE_MS);
}

/**
 * How much a complaint's frequency is worth.
 *
 * §5.0.0: *"if 11 people in this niche asked about pricing confusion this month,
 * that's next week's post."* One person is an anecdote; the curve flattens fast
 * because the difference between 11 and 30 is not what decides a post.
 */
export function frequencyWeight(frequency: number | undefined): number {
  if (!frequency || frequency < 1) return 0.4;
  return Math.min(1, 0.4 + 0.2 * Math.log2(frequency + 1));
}

/** Sources are not equal. Comment mining is the spec's highest-signal input. */
const SOURCE_WEIGHT: Record<IdeaSource, number> = {
  complaint: 1.0,
  own_comment: 1.0,   // a buyer telling US what to make — as good as it gets
  observation: 0.75,
  format_card: 0.7,
  founder: 0.9,
  performance: 0.8,
};

export function scoreIdea(
  idea: { source: IdeaSource; evidence: Evidence },
  now: number
): { score: number; why: string } {
  // No evidence is not a low score, it is not an idea.
  if (!idea.evidence.quote?.trim() || idea.evidence.sourceUrls.length === 0) {
    return { score: 0, why: "no evidence — a guess, not an idea" };
  }

  const source = SOURCE_WEIGHT[idea.source] ?? 0.5;
  const freq = frequencyWeight(idea.evidence.frequency);
  const recency = recencyDecay(idea.evidence.observedAt, now);
  const score = source * freq * recency;

  const weakest = Math.min(source, freq, recency);
  const why =
    weakest === recency
      ? "losing value with age"
      : weakest === freq
        ? "only one person said it"
        : `${idea.source} is weaker signal than a complaint`;

  return { score, why };
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

/** Two ideas are the same idea if they say the same thing. */
export const SAME_ANGLE_AT = 0.6;

export const bankIdeas = internalMutation({
  args: {
    customerId: v.id("customers"),
    ideasJson: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ banked: number; duplicates: number; rejected: number }> => {
    const incoming = JSON.parse(args.ideasJson) as ScoredIdea[];
    const now = args.now ?? Date.now();

    const existing = (await ctx.db
      .query("ideas")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"ideas">[];
    // Compare against USED ones too — re-banking something we already posted is
    // how an account starts repeating itself a month later.
    const known = existing.map((e) => e.angle);

    let banked = 0;
    let duplicates = 0;
    let rejected = 0;

    for (const idea of incoming) {
      if (idea.score <= 0 || !idea.angle.trim()) {
        rejected += 1;
        continue;
      }
      if (known.some((a) => similarity(a, idea.angle) >= SAME_ANGLE_AT)) {
        duplicates += 1;
        continue;
      }
      await ctx.db.insert("ideas", {
        customerId: args.customerId,
        angle: idea.angle.trim(),
        evidenceJson: JSON.stringify(idea.evidence),
        score: idea.score,
        status: "bank",
        sourceKind: idea.source,
        createdAt: now,
        updatedAt: now,
      });
      known.push(idea.angle);
      banked += 1;
    }

    return { banked, duplicates, rejected };
  },
});

/**
 * ⭐ Bank depth — a health metric, not a stat.
 *
 * §7.4: *"shallow means perception stalled, **visible before the content
 * degrades**."* This is the only early warning in the system that fires while
 * the posts are still good.
 */
export const HEALTHY_BANK_DEPTH = 10;

export const bankDepth = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (
    ctx,
    args
  ): Promise<{ depth: number; healthy: boolean; detail: string }> => {
    const rows = (await ctx.db
      .query("ideas")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"ideas">[];
    const depth = rows.filter((r) => r.status === "bank").length;
    return {
      depth,
      healthy: depth >= HEALTHY_BANK_DEPTH,
      detail:
        depth >= HEALTHY_BANK_DEPTH
          ? `${depth} ideas banked`
          : depth === 0
            ? "the bank is empty — perception has stalled, and the posts will show it before long"
            : `only ${depth} ideas banked — perception is thinning`,
    };
  },
});

/**
 * The best idea to write today.
 *
 * Recency decays continuously, so the ranking is recomputed at read time rather
 * than trusting a score frozen at insert. An idea banked ten days ago should not
 * still be winning on a number it earned when it was new.
 */
export const nextIdea = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ ideaId: Id<"ideas">; angle: string; evidence: Evidence; score: number } | null> => {
    const now = args.now ?? Date.now();
    const rows = (await ctx.db
      .query("ideas")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"ideas">[];

    const live = rows
      .filter((r) => r.status === "bank")
      .map((r) => {
        let evidence: Evidence = { quote: "", sourceUrls: [] };
        try {
          evidence = r.evidenceJson
            ? (JSON.parse(r.evidenceJson) as Evidence)
            : evidence;
        } catch {
          /* a corrupt row scores 0 below rather than throwing */
        }
        const { score } = scoreIdea(
          { source: (r.sourceKind as IdeaSource) ?? "observation", evidence },
          now
        );
        return { r, evidence, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = live[0];
    return best
      ? {
          ideaId: best.r._id,
          angle: best.r.angle,
          evidence: best.evidence,
          score: best.score,
        }
      : null;
  },
});

export const markUsed = internalMutation({
  args: {
    ideaId: v.id("ideas"),
    status: v.union(v.literal("used"), v.literal("discarded")),
  },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.ideaId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/* -------------------------------------------------------------------------- */
/* Filling the bank                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Turn mined complaints into banked ideas.
 *
 * **No model call, deliberately.** A complaint has already been clustered from
 * real comments and carries its receipts — *"nobody explains what it actually
 * costs"* is already the angle. Asking a model to rewrite it into an angle
 * would spend money to move further from what people actually said, which is
 * the one thing making it worth posting.
 *
 * §5.1 calls comment mining the most valuable and cheapest sweep. This is the
 * step that turns it into content rather than a report.
 */
export const bankFromComplaints = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ banked: number; duplicates: number; rejected: number }> => {
    const complaints = await ctx.runQuery(
      internal.maya.complaints.complaintsFor,
      { customerId: args.customerId }
    );
    const now = args.now ?? Date.now();

    const scored: ScoredIdea[] = complaints.map((c) => {
      const evidence: Evidence = {
        quote: c.text,
        sourceUrls: c.sourceUrls,
        frequency: c.frequency,
        observedAt: c.lastSeen,
      };
      const { score, why } = scoreIdea({ source: "complaint", evidence }, now);
      return { angle: c.text, source: "complaint", evidence, score, why };
    });

    return await ctx.runMutation(internal.maya.ideas.bankIdeas, {
      customerId: args.customerId,
      ideasJson: JSON.stringify(scored),
      now,
    });
  },
});
