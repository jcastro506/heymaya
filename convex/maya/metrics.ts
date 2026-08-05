/**
 * ⭐ How her posts actually did — the read-back that never existed.
 *
 * §13.5's evening recap promises *"what went live, with links, **and what came
 * back**"*. `dailyReport` reads `metricsJson` off every placement to build it.
 *
 * **Nothing ever wrote that field.** So the recap's second half has been empty
 * since Sprint 2, and every morning's idea selection has been blind — she could
 * not tell a post that landed from one nobody saw. The whole *"she does the
 * homework"* premise assumes a feedback loop that wasn't closed.
 *
 * Fourteenth instance of the same defect this week: a good module, passing
 * tests, and no caller.
 *
 * ## Why twitterapi.io and not Zernio
 *
 * Zernio wraps `/analytics` and it was the obvious choice. Checked live on
 * 2026-08-05, it is not usable:
 *
 * - `lastSync: null` and `posts: []`, while `overview.totalPosts` claimed 9
 * - `?postId=<real id>` returned nothing at all
 * - ⚠️ `?platform=twitter` — the account's OWN platform string — returned
 *   **zero**, where no filter returned nine
 *
 * twitterapi.io's `/twitter/tweets?tweet_ids=` returned full metrics for both
 * real placements on the first call. §2 already drew this line: **read via
 * twitterapi.io, write via Zernio.** This is a read.
 *
 * ## Only X, and that is stated rather than implied
 *
 * TikTok, Instagram and YouTube placements get no metrics here. Pretending
 * otherwise would put a confident zero next to a post that may have done well —
 * worse than an honest gap, because a zero looks measured.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * How far back to keep refreshing a placement.
 *
 * A tweet's numbers move for a few days and then stop. Refreshing a month of
 * history every night is paying repeatedly for the same answer.
 */
export const REFRESH_WINDOW_MS = 14 * 86_400_000;

/** One request carries this many ids. The endpoint batches; use it. */
export const BATCH_SIZE = 25;

/**
 * ⭐ Pull the tweet id out of a placement URL.
 *
 * Deliberately derived rather than stored in a new column: the id is already
 * inside `url`, and reading it works on the placements that ALREADY EXIST.
 * A new field would only ever be populated going forward, which means the
 * first thing this feature does is fail to explain the posts the founder can
 * actually see.
 *
 * Both hosts appear in the wild — Zernio returns `twitter.com/i/web/status/…`,
 * while the app and twitterapi.io both use `x.com/<handle>/status/…`.
 */
export function tweetIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = /(?:twitter\.com|x\.com)\/(?:i\/web\/)?(?:[^/]+\/)?status\/(\d+)/.exec(
    url
  );
  return match?.[1] ?? null;
}

export const dueForRefresh = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"placements">[]> => {
    const now = args.now ?? Date.now();
    const rows = (await ctx.db
      .query("placements")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"placements">[];

    return rows.filter(
      (p) =>
        p.channel === "x" &&
        p.linkStatus === "live" &&
        now - p.publishedAt <= REFRESH_WINDOW_MS &&
        tweetIdFromUrl(p.url) !== null
    );
  },
});

export const recordMetrics = internalMutation({
  args: {
    placementId: v.id("placements"),
    metricsJson: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.placementId, {
      metricsJson: args.metricsJson,
      /**
       * ⭐ Always stamped alongside the numbers.
       *
       * The schema comment says why: *"metrics without one are a number with no
       * date, which is how dashboards start lying."* A three-day-old view count
       * presented as today's is worse than no view count.
       */
      metricsAsOf: args.now ?? Date.now(),
    });
  },
});

export interface RefreshResult {
  ok: boolean;
  checked: number;
  updated: number;
  detail: string;
}

/**
 * Refresh what her recent posts have done.
 *
 * Reports a real zero rather than staying quiet about it. A post with one view
 * is a finding — arguably the most useful one there is — and the recap must be
 * able to say so plainly.
 */
export const refresh = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<RefreshResult> => {
    const now = args.now ?? Date.now();

    const due = await ctx.runQuery(internal.maya.metrics.dueForRefresh, {
      customerId: args.customerId,
      now,
    });
    if (due.length === 0) {
      return { ok: true, checked: 0, updated: 0, detail: "nothing recent to check" };
    }
    if (!process.env.TWITTERAPI_IO_KEY) {
      return {
        ok: false,
        checked: 0,
        updated: 0,
        detail: "I can't read the numbers back right now",
      };
    }

    const { getTweetsByIds } = await import(
      "../integrations/twitterApiIo/endpoints"
    );

    // id → placement, so a response in any order still lands on the right row.
    const byTweetId = new Map<string, Id<"placements">>();
    for (const placement of due) {
      const id = tweetIdFromUrl(placement.url);
      if (id) byTweetId.set(id, placement._id);
    }

    const ids = [...byTweetId.keys()];
    let updated = 0;

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      try {
        const page = await getTweetsByIds(batch);
        for (const raw of page.items) {
          const tweet = raw as Record<string, unknown>;
          const id = typeof tweet.id === "string" ? tweet.id : null;
          const placementId = id ? byTweetId.get(id) : undefined;
          if (!placementId) continue;

          const metrics = {
            likes: numberOf(tweet.likeCount),
            replies: numberOf(tweet.replyCount),
            reposts: numberOf(tweet.retweetCount),
            quotes: numberOf(tweet.quoteCount),
            views: numberOf(tweet.viewCount),
            bookmarks: numberOf(tweet.bookmarkCount),
          };
          await ctx.runMutation(internal.maya.metrics.recordMetrics, {
            placementId,
            metricsJson: JSON.stringify(metrics),
            now,
          });
          updated += 1;
        }
      } catch (error) {
        // Plain language out, diagnosis to the log.
        console.error(
          `[metrics] refresh failed for ${args.customerId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          ok: false,
          checked: ids.length,
          updated,
          detail: "I couldn't read the numbers back just now",
        };
      }
    }

    return {
      ok: true,
      checked: ids.length,
      updated,
      detail:
        updated === 0
          ? "checked, but the numbers haven't come back yet"
          : `${updated} of ${ids.length} updated`,
    };
  },
});

/** A missing count is `0`, not `null` — but see the note in `refresh`. */
function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Every active customer's recent posts.
 *
 * Sequential on purpose. This is a background read whose numbers barely move
 * hour to hour, so there is nothing to gain from hammering the vendor in
 * parallel — and a fleet-wide burst is how a cheap read turns into a 429.
 */
export const refreshAll = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ customers: number; updated: number }> => {
    const customers = await ctx.runQuery(internal.maya.metrics.activeCustomers, {});
    let updated = 0;
    for (const customerId of customers) {
      const result = await ctx.runAction(internal.maya.metrics.refresh, {
        customerId,
        now: args.now,
      });
      updated += result.updated;
    }
    return { customers: customers.length, updated };
  },
});

export const activeCustomers = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"customers">[]> => {
    const rows = (await ctx.db.query("customers").collect()) as Doc<"customers">[];
    return rows.filter((c) => c.state === "active").map((c) => c._id);
  },
});
