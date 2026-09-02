/**
 * ⭐ Niche benchmarks (§16.3, Sprint 8) — the column no competitor can copy.
 *
 * > *"We scrape other people's metrics, so we can say 'your engagement rate is
 * > 4.1% and the niche median is 2.4%.' Every other tool in this category can
 * > only show you your own numbers in a vacuum, which makes them unreadable —
 * > is 4.1% good? Nobody knows. **Context is the product.**"*
 *
 * A founder cannot act on "you got 400 views". They can act on "400 views, and
 * the median in your niche is 3,100" — that is a format problem, stated. The
 * ladder (§14.2) says which rung broke; this says whether the number under it
 * is actually bad.
 *
 * ## Built from rows we already have
 *
 * `observations` carries other people's posts with their metrics, collected
 * daily by the watchers and now screened for relevance. No new vendor call: the
 * corpus is a by-product of watching the niche, which is the same argument that
 * made hashtag mining free.
 *
 * ## ⚠️ Three ways a benchmark lies, all guarded
 *
 * 1. **Too few posts.** A median of three is noise. `MIN_SAMPLE_SIZE.benchmark`
 *    is 8, and below it the answer is `unusable`, never a number.
 * 2. **One loud creator.** `MIN_AUTHOR_DIVERSITY` — *"a sweep that reads one
 *    account twenty times has not surveyed a niche"*. A median drawn from one
 *    person's posts is a statement about that person.
 * 3. **Stale.** Borrowed metrics carry `computedAt` and the caller must show
 *    it (§16.4, and §18's "freshness stamps on borrowed metrics" test).
 *
 * All three constants are reused from `quality.ts` rather than redefined,
 * because two thresholds for "is this enough data" is how a report and a
 * decision start disagreeing.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { FRESHNESS_WINDOW_MS, MIN_AUTHOR_DIVERSITY, MIN_SAMPLE_SIZE } from "./quality";
import { nicheFingerprint, parseMetrics } from "./formats";

export const CACHE_KIND = "benchmarks";

export interface ChannelBenchmark {
  channel: string;
  /** How many niche posts this is drawn from. Shown, never implied. */
  posts: number;
  /** Distinct authors ÷ posts. Below MIN_AUTHOR_DIVERSITY it isn't a niche. */
  authorDiversity: number;
  medianViews: number;
  /** engagements ÷ views, as a percentage. Null when nothing had views. */
  medianEngagementRate: number | null;
  /** ⚠️ False when there isn't enough behind it to quote. */
  usable: boolean;
  /** Why not, when not — so the caller can say it rather than show a blank. */
  unusableReason?: string;
}

export interface BenchmarkSet {
  channels: ChannelBenchmark[];
  /** ⭐ §16.4's honesty rule: borrowed data carries its age. */
  computedAt: number | null;
  stale: boolean;
}

export interface NichePost {
  channel: string;
  views: number;
  engagements: number;
  authorHandle?: string;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * ⭐ Median, never mean.
 *
 * One post at 6.5M views — which the real corpus contains — drags a mean so far
 * that every creator looks like they are failing. The median describes the
 * post in the middle, which is the thing a founder is actually competing with.
 */
export function computeBenchmarks(posts: NichePost[]): ChannelBenchmark[] {
  const byChannel = new Map<string, NichePost[]>();
  for (const post of posts) {
    if (!post.channel) continue;
    byChannel.set(post.channel, [...(byChannel.get(post.channel) ?? []), post]);
  }

  const out: ChannelBenchmark[] = [];
  for (const [channel, rows] of byChannel) {
    const authors = new Set(rows.map((r) => r.authorHandle).filter(Boolean));
    const authorDiversity = rows.length > 0 ? authors.size / rows.length : 0;

    const withViews = rows.filter((r) => r.views > 0);
    const rates = withViews.map((r) => (r.engagements / r.views) * 100);

    const benchmark: ChannelBenchmark = {
      channel,
      posts: rows.length,
      authorDiversity: Math.round(authorDiversity * 100) / 100,
      medianViews: median(rows.map((r) => r.views)),
      medianEngagementRate:
        rates.length > 0 ? Math.round(median(rates) * 10) / 10 : null,
      usable: true,
    };

    if (rows.length < MIN_SAMPLE_SIZE.benchmark) {
      benchmark.usable = false;
      benchmark.unusableReason = `only ${rows.length} posts to compare against`;
    } else if (authorDiversity < MIN_AUTHOR_DIVERSITY) {
      // ⚠️ Enough posts, too few people. A median here describes one creator.
      benchmark.usable = false;
      benchmark.unusableReason = `${authors.size} accounts across ${rows.length} posts — too few people to call it a niche`;
    }

    out.push(benchmark);
  }
  return out.sort((a, b) => b.posts - a.posts);
}

/**
 * ⭐ Is this number good?
 *
 * Pure, and the only place that decision is made — so the Results screen, the
 * weekly report and her plain-language read cannot reach different verdicts
 * about the same figure.
 */
export function compareToNiche(
  own: number,
  nicheMedian: number
): { verdict: "above" | "at" | "below"; multiple: number; detail: string } {
  if (nicheMedian <= 0) {
    return { verdict: "at", multiple: 1, detail: "no niche number to compare against" };
  }
  const multiple = own / nicheMedian;
  /**
   * ⚠️ A ±20% band around the median counts as "at".
   *
   * Without it, a post 3% under the median reads as underperforming — which is
   * noise presented as a finding, and the fastest way to make a founder stop
   * trusting the column.
   */
  if (multiple >= 1.2) {
    return {
      verdict: "above",
      multiple,
      detail: `${multiple.toFixed(1)}× the niche median`,
    };
  }
  if (multiple <= 0.8) {
    return {
      verdict: "below",
      multiple,
      detail: `${Math.round((1 - multiple) * 100)}% under the niche median`,
    };
  }
  return { verdict: "at", multiple, detail: "about the niche median" };
}

/* -------------------------------------------------------------------------- */

export const storeBenchmarks = internalMutation({
  args: {
    fingerprint: v.string(),
    payloadJson: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<null> => {
    const now = args.now ?? Date.now();
    const existing = (await ctx.db
      .query("nicheCache")
      .withIndex("by_fingerprint_and_kind", (q) =>
        q.eq("nicheFingerprint", args.fingerprint).eq("kind", CACHE_KIND)
      )
      .unique()
      .catch(() => null)) as Doc<"nicheCache"> | null;

    const row = {
      nicheFingerprint: args.fingerprint,
      kind: CACHE_KIND,
      payloadJson: args.payloadJson,
      fetchedAt: now,
      ttlSec: Math.floor(FRESHNESS_WINDOW_MS.benchmark / 1000),
      sourceKind: "computed_from_observations",
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("nicheCache", row);
    return null;
  },
});

/**
 * The benchmark set for this creator's niche.
 *
 * ⚠️ Returns stale sets rather than hiding them, flagged. A month-old median is
 * still far better than no context, and §16.4's rule is that the caller shows
 * the age — withholding it would leave the Results screen with a blank column
 * and no explanation, which reads as broken.
 */
export const benchmarksFor = internalQuery({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<BenchmarkSet> => {
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      creatorId: args.creatorId,
    });
    if (!targets || targets.keywords.length === 0) {
      return { channels: [], computedAt: null, stale: false };
    }

    const row = (await ctx.db
      .query("nicheCache")
      .withIndex("by_fingerprint_and_kind", (q) =>
        q
          .eq("nicheFingerprint", nicheFingerprint(targets.keywords))
          .eq("kind", CACHE_KIND)
      )
      .unique()
      .catch(() => null)) as Doc<"nicheCache"> | null;
    if (!row) return { channels: [], computedAt: null, stale: false };

    const now = args.now ?? Date.now();
    let channels: ChannelBenchmark[] = [];
    try {
      channels = JSON.parse(row.payloadJson) as ChannelBenchmark[];
    } catch {
      channels = [];
    }
    return {
      channels,
      computedAt: row.fetchedAt,
      stale: now - row.fetchedAt > FRESHNESS_WINDOW_MS.benchmark,
    };
  },
});

/**
 * Recompute from the niche corpus.
 *
 * Weekly work: the medians move slowly, and recomputing them daily would spend
 * reads to watch a number that barely changes.
 */
export const refreshBenchmarks = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; channels: number; usable: number; detail: string }> => {
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      creatorId: args.creatorId,
    });
    if (!targets || targets.keywords.length === 0) {
      return { ok: false, channels: 0, usable: 0, detail: "no niche keywords yet" };
    }

    const observations = await ctx.runQuery(
      internal.maya.scroll.recentObservations,
      { creatorId: args.creatorId, limit: 400 }
    );

    const posts: NichePost[] = observations.map((row: Doc<"observations">) => {
      const metrics = parseMetrics(row.metricsJson);
      return {
        channel: row.channel,
        views: metrics.views,
        engagements: metrics.likes + metrics.comments,
        authorHandle: row.authorHandle ?? undefined,
      };
    });

    const channels = computeBenchmarks(posts);
    await ctx.runMutation(internal.maya.benchmarks.storeBenchmarks, {
      fingerprint: nicheFingerprint(targets.keywords),
      payloadJson: JSON.stringify(channels),
      now: args.now,
    });

    const usable = channels.filter((c) => c.usable).length;
    return {
      ok: usable > 0,
      channels: channels.length,
      usable,
      detail:
        usable > 0
          ? channels
              .filter((c) => c.usable)
              .map((c) => `${c.channel}: ${c.medianViews} views median (n=${c.posts})`)
              .join(" · ")
          : "not enough of the niche watched yet to say what normal looks like",
    };
  },
});
