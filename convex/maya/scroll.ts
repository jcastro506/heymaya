/**
 * The morning scroll (§5.1 sweeps 2 and 3, §13.5's 07:00).
 *
 * What a good social manager does before saying anything: read what's actually
 * moving in this niche today. Not what's big — what's **moving**.
 *
 * ## Why this exists as a tool rather than a job
 *
 * Her 07:00 cron says "scroll". Without a tool behind it she either says she
 * can't — which is correct and useless — or improvises, which is worse. The
 * whole daily loop in §13.5 rests on this returning something real.
 *
 * ## Velocity, not volume
 *
 * §5.1: *"a 6-hour-old post with rising engagement is worth more than a
 * week-old post with more of it. Rank every sweep by engagement ÷ age."* That
 * ranking is the difference between noticing what's happening and reciting
 * what already happened.
 *
 * ## No LLM in collection
 *
 * §5.2. This fetches, ranks and returns structured rows. Deciding which of them
 * is worth a post is her job, on the main model, with product truth in hand —
 * and doing it here would mean paying to judge 200 posts instead of reading a
 * ranked 20.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { velocity, toMillis } from "./learnBusiness";
import type { Doc } from "../_generated/dataModel";

/** One thing she saw. Deliberately close to §5.2's observation shape. */
export interface Observation {
  channel: string;
  sourceUrl: string;
  authorHandle: string | null;
  text: string;
  postedAt: number | null;
  metrics: { likes: number; comments: number; views: number };
  /** engagement ÷ age — what's actually hot. */
  velocity: number;
  /** Which of her watched terms surfaced it. */
  keyword: string;
}

/** How many keywords to sweep per morning. Each is one credit. */
export const KEYWORDS_PER_SCROLL = 4;
/** What she actually reads. More than this is a firehose, not a scroll. */
export const OBSERVATIONS_RETURNED = 20;
/** Older than this isn't news, whatever its engagement. */
export const NEWS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Read the niche.
 *
 * Returns a named failure rather than an empty list when there is nothing to
 * read, because "the niche was quiet today" and "you never told me what to
 * watch" are different answers and only one of them is her problem.
 */
export const scrollNiche = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    error?: string;
    observations?: Observation[];
    keywordsSwept?: string[];
  }> => {
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets || targets.keywords.length === 0) {
      return {
        ok: false,
        error:
          "I don't know what to watch yet — the niche keywords haven't been worked out",
      };
    }

    const now = args.now ?? Date.now();
    const { tiktok } = await import(
      "../integrations/scrapeCreators/platforms/tiktok"
    );

    const observations: Observation[] = [];
    const swept: string[] = [];

    for (const keyword of targets.keywords.slice(0, KEYWORDS_PER_SCROLL)) {
      try {
        const result = await tiktok.searchKeyword(keyword, {
          // This is a *daily* read. A month-old post is not what's moving now.
          datePosted: "this_month",
          sortBy: "relevance",
        });
        swept.push(keyword);
        for (const post of result.posts) {
          const ms = toMillis(post.postedAt);
          if (!ms || now - ms > NEWS_WINDOW_MS) continue;
          observations.push({
            channel: "tiktok",
            sourceUrl:
              post.url ??
              (post.authorHandle
                ? `https://www.tiktok.com/@${post.authorHandle}/video/${post.postId}`
                : ""),
            authorHandle: post.authorHandle ?? null,
            text: post.caption ?? "",
            postedAt: ms,
            metrics: {
              likes: post.metrics.likeCount ?? 0,
              comments: post.metrics.commentCount ?? 0,
              views: post.metrics.viewCount ?? 0,
            },
            velocity: velocity(post.metrics, post.postedAt, now),
            keyword,
          });
        }
      } catch {
        // A dead search loses one keyword, never the morning.
        continue;
      }
    }

    if (observations.length === 0) {
      return {
        ok: true,
        observations: [],
        keywordsSwept: swept,
        error: "nothing new in the niche today",
      };
    }

    const ranked = observations
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, OBSERVATIONS_RETURNED);

    // Written down before they're returned, so a scroll she never acts on
    // still counts toward "this keeps coming up".
    await ctx.runMutation(internal.maya.scroll.recordObservations, {
      customerId: args.customerId,
      observationsJson: JSON.stringify(ranked),
      now,
    });

    return { ok: true, keywordsSwept: swept, observations: ranked };
  },
});


/* -------------------------------------------------------------------------- */
/* Remembering what she saw                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Write observations down, once each.
 *
 * ## Why idempotent matters more than it sounds
 *
 * A climbing post shows up in the sweep for several days running — that's what
 * climbing means. Without dedupe, a week of scrolling turns one post into seven
 * rows, and any "how often does this come up?" question answers itself wrongly.
 *
 * Keyed on `sourceUrl` because it's the one identifier the vendor can't
 * renumber. Velocity is **not** updated on a re-sight: the row records what
 * made it worth noticing *then*, and overwriting that loses the history that
 * makes the second sighting interesting.
 *
 * ## Measured, not assumed
 *
 * Two consecutive scrolls of the same keywords produced **16 new rows out of
 * 20** — TikTok's keyword search rotates its results rather than returning a
 * stable ranking. So dedupe catches genuine repeats but far fewer than the
 * daily-cron intuition suggests, and rows accumulate at roughly a full scroll
 * per run.
 *
 * ⚠️ **The consequence is about meaning, not storage.** "This keeps coming up"
 * cannot be measured by counting URL repeats when the search itself shuffles.
 * Topic frequency has to come from CONTENT similarity — which is what the
 * complaint clustering in `complaints.ts` does, and why it reads comment text
 * rather than counting posts.
 */
export const recordObservations = internalMutation({
  args: {
    customerId: v.id("customers"),
    observationsJson: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ written: number; alreadyKnown: number }> => {
    const incoming = JSON.parse(args.observationsJson) as Observation[];
    const now = args.now ?? Date.now();
    let written = 0;
    let alreadyKnown = 0;

    for (const o of incoming) {
      if (!o.sourceUrl) continue;
      const existing = (await ctx.db
        .query("observations")
        .withIndex("by_customer_and_source", (q) =>
          q.eq("customerId", args.customerId).eq("sourceUrl", o.sourceUrl)
        )
        .first()) as Doc<"observations"> | null;
      if (existing) {
        alreadyKnown += 1;
        continue;
      }
      await ctx.db.insert("observations", {
        customerId: args.customerId,
        channel: o.channel,
        sourceUrl: o.sourceUrl,
        authorHandle: o.authorHandle ?? undefined,
        kind: "post",
        text: o.text,
        postedAt: o.postedAt ?? undefined,
        capturedAt: now,
        metricsJson: JSON.stringify(o.metrics),
        velocity: o.velocity,
        keyword: o.keyword,
      });
      written += 1;
    }

    return { written, alreadyKnown };
  },
});

/** What she's seen lately — the raw material for "this keeps coming up". */
export const recentObservations = internalQuery({
  args: {
    customerId: v.id("customers"),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"observations">[]> => {
    const rows = (await ctx.db
      .query("observations")
      .withIndex("by_customer_and_captured", (q) =>
        q.eq("customerId", args.customerId)
      )
      .order("desc")
      .take(args.limit ?? 100)) as Doc<"observations">[];
    return args.since ? rows.filter((r) => r.capturedAt >= args.since!) : rows;
  },
});
