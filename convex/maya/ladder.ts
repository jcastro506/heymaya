/**
 * ⭐ The diagnostic ladder (§14.2) — which rung is broken.
 *
 * §14.2 calls this *"the most differentiated thing in the product"* and asks
 * for it *"deliberately as a subsystem, not as a fallback"*. Her 19:00 Sunday
 * cron already says *"which of the five rungs is working and which isn't"*.
 *
 * **She had no way to answer.** `history` returned URL, channel, kind, text and
 * date — and no numbers at all. So the weekly review asked for a diagnosis the
 * tools could not support, which leaves exactly two outcomes: she says she
 * can't, or she guesses. Neither is a manager.
 *
 * ## Why the rung is computed here and not by the model
 *
 * §2.3 — deterministic code watches, the model judges. Which rung is broken is
 * arithmetic on rows: did anything go live, did it get seen, did anyone engage.
 * What it MEANS, and what to do about it, is judgment, and that stays hers.
 *
 * Computing it also stops the failure §14.2 is really guarding against: a
 * confident diagnosis with nothing under it. If the numbers aren't there, this
 * returns `unknown` and says why, rather than picking a rung that sounds right.
 *
 * ## What we can and cannot see
 *
 * L0–L2 are answerable from `placements` today. **L3 and L4 are not** — link
 * clicks and signups need the attribution ladder (§14.45), which is a separate
 * subsystem. Reporting L3 as "fine" because we can't see it would be the exact
 * dishonesty §14.2's example is built to avoid, so they come back `unknown`.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
// ⚠️ Static. Convex queries and mutations cannot do dynamic imports — it
// typechecks and dies at runtime with `dynamic module import unsupported`.
import { compareToNiche } from "./benchmarks";
import type { Doc } from "../_generated/dataModel";

/** "1 post" / "2 posts" — she writes like a person, including the counting. */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export type Rung = "L0" | "L1" | "L2" | "L3" | "L4" | "healthy" | "unknown";

/**
 * Views below this and nobody saw it — that's a format problem, not a topic
 * problem. Deliberately low: §14.3's small-n warning means we are answering
 * "did this get distribution at all", not "was this optimal".
 */
export const SEEN_FLOOR = 100;

/**
 * Engagements per hundred views. Below this they saw it and scrolled.
 * A coarse question, which is the only kind own-data can answer (§14.3).
 */
export const ENGAGED_FLOOR = 1;

export interface LadderVerdict {
  rung: Rung;
  detail: string;
  placements: number;
  views: number;
  engagements: number;
  /** Placements whose numbers we never got — the honesty check on the rest. */
  unmeasured: number;
}

/**
 * ⭐ Exported so the experiment verdict reads the SAME numbers the ladder does.
 *
 * "Every channel names these differently; sum what's present" is real knowledge
 * about six vendors, and a second copy of it would eventually disagree with
 * this one — which would show up as an experiment and a rung telling the
 * founder two different stories about the same week.
 */
export function metricsOf(p: Doc<"placements">): {
  views: number;
  engagements: number;
} | null {
  if (!p.metricsJson) return null;
  try {
    const m = JSON.parse(p.metricsJson) as Record<string, unknown>;
    const n = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : 0);
    return {
      views: n("views"),
      // Every channel names these differently; sum what's present rather than
      // insisting on one vocabulary.
      engagements:
        n("likes") +
        n("comments") +
        n("replies") +
        n("shares") +
        n("reposts") +
        n("saves"),
    };
  } catch {
    return null;
  }
}

/**
 * ⭐ Where the week broke.
 *
 * Returns the LOWEST broken rung, because that's the one worth fixing — a
 * topic problem on a post nobody saw is not a topic problem.
 */
export const diagnose = internalQuery({
  args: {
    customerId: v.id("customers"),
    sinceDays: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<LadderVerdict> => {
    const rows = (await ctx.db
      .query("placements")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"placements">[];
    return diagnoseFrom(rows, args.now ?? Date.now(), args.sinceDays ?? 7);
  },
});

/**
 * ⭐ Pure, because two different queries need this verdict.
 *
 * A Convex query cannot call another query, and `nextIdea` needs the rung to
 * decide which evidence to trust more (§14.2.2). Duplicating the arithmetic
 * there would give two answers to one question, which is how a report and a
 * decision quietly stop agreeing.
 */
export function diagnoseFrom(
  rows: Doc<"placements">[],
  now: number,
  sinceDays: number,
): LadderVerdict {
  {
    const since = now - sinceDays * 86_400_000;
    const window = rows.filter(
      (p) => p.publishedAt >= since && p.linkStatus === "live",
    );

    /**
     * ⭐ L0 first, and it is OUR failure, not the content's.
     *
     * Nothing went live, so nothing else can be diagnosed. Reaching for a
     * format or topic verdict here would be inventing a problem to explain a
     * week where the real answer is that we didn't do the work.
     */
    if (window.length === 0) {
      return {
        rung: "L0",
        detail:
          "nothing went live in that window — that's on me, not on the content",
        placements: 0,
        views: 0,
        engagements: 0,
        unmeasured: 0,
      };
    }

    const measured = window
      .map((p) => metricsOf(p))
      .filter((m): m is { views: number; engagements: number } => m !== null);
    const unmeasured = window.length - measured.length;

    if (measured.length === 0) {
      return {
        rung: "unknown",
        detail: `${window.length} live, and no numbers back for any of them yet`,
        placements: window.length,
        views: 0,
        engagements: 0,
        unmeasured,
      };
    }

    const views = measured.reduce((sum, m) => sum + m.views, 0);
    const engagements = measured.reduce((sum, m) => sum + m.engagements, 0);

    if (views < SEEN_FLOOR) {
      return {
        rung: "L1",
        /**
         * ⚠️ Pluralised. This sentence is the first thing a founder reads on
         * the home screen, and "1 posts and 1 views" reads as a machine
         * talking — which is the one impression §11 spends the whole product
         * avoiding. Seen live on the dogfood account.
         */
        detail: `${plural(window.length, "post")} and ${plural(views, "view")} — almost nobody saw them, so this is a format problem, not a topic one`,
        placements: window.length,
        views,
        engagements,
        unmeasured,
      };
    }

    const per100 = (engagements / views) * 100;
    if (per100 < ENGAGED_FLOOR) {
      return {
        rung: "L2",
        detail: `${views} views and ${engagements} engagements — they saw it and scrolled, so the angle is wrong rather than the format`,
        placements: window.length,
        views,
        engagements,
        unmeasured,
      };
    }

    /**
     * ⭐ Everything we can see is working, and we say exactly that — not "it's
     * all fine". L3 (clicks) and L4 (signups) need the attribution ladder
     * (§14.45); claiming them healthy from silence is the dishonesty §14.2's
     * worked example exists to prevent.
     */
    return {
      rung: "healthy",
      detail: `${views} views and ${engagements} engagements across ${window.length} posts — distribution and interest are both working. Whether anyone clicked through or signed up isn't something I can see yet`,
      placements: window.length,
      views,
      engagements,
      unmeasured,
    };
  }
}

/**
 * ⭐ The ladder, benchmarked (§16.3) — the Results screen's centerpiece.
 *
 * > *"Is 4.1% good? Nobody knows. **Context is the product.**"*
 *
 * The rung says which step broke. The benchmark says whether the number under
 * it is actually bad — and those are different questions. A customer at 400
 * views has a format problem if the niche median is 3,100 and is doing fine if
 * it is 160.
 *
 * ⚠️ Composed here rather than inside `diagnoseFrom`, which stays pure. The
 * verdict must be computable from placements alone — `nextIdea` needs it and
 * has no niche corpus in hand — so the benchmark is an *overlay* on the rung,
 * never an input to it.
 */
export const diagnoseBenchmarked = internalQuery({
  args: {
    customerId: v.id("customers"),
    channel: v.optional(v.string()),
    sinceDays: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    verdict: LadderVerdict;
    benchmark: {
      channel: string;
      medianViews: number;
      posts: number;
      comparison: string;
    } | null;
    /** ⚠️ §16.4 — borrowed numbers carry their age, always. */
    benchmarkComputedAt: number | null;
    benchmarkStale: boolean;
  }> => {
    const now = args.now ?? Date.now();
    const rows = (await ctx.db
      .query("placements")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"placements">[];

    const scoped = args.channel
      ? rows.filter((r) => r.channel === args.channel)
      : rows;
    const verdict = diagnoseFrom(scoped, now, args.sinceDays ?? 7);

    const set = await ctx.runQuery(internal.maya.benchmarks.benchmarksFor, {
      customerId: args.customerId,
      now,
    });

    const channel = args.channel ?? scoped[0]?.channel;
    const match = channel
      ? set.channels.find(
          (c: { channel: string; usable: boolean }) =>
            c.channel === channel && c.usable,
        )
      : undefined;

    if (!match) {
      /**
       * ⚠️ No benchmark is reported as no benchmark. Falling back to "you're
       * doing fine" from an absent median is the dishonesty §14.2's worked
       * example exists to prevent.
       */
      return {
        verdict,
        benchmark: null,
        benchmarkComputedAt: set.computedAt,
        benchmarkStale: set.stale,
      };
    }

    /**
     * Own views per placement, so the comparison is like-for-like: the niche
     * median is one post's views, not a week's total.
     */
    const perPost =
      verdict.placements > 0 ? verdict.views / verdict.placements : 0;
    const cmp = compareToNiche(perPost, match.medianViews);

    return {
      verdict,
      benchmark: {
        channel: match.channel,
        medianViews: match.medianViews,
        posts: match.posts,
        comparison: `${Math.round(perPost)} views a post — ${cmp.detail} (from ${match.posts} niche posts)`,
      },
      benchmarkComputedAt: set.computedAt,
      benchmarkStale: set.stale,
    };
  },
});
