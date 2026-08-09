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
        const returned = new Set<string>();
        for (const raw of page.items) {
          const tweet = raw as Record<string, unknown>;
          const id = typeof tweet.id === "string" ? tweet.id : null;
          if (id) returned.add(id);
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

        /**
         * ⭐ A POST WE ASKED FOR AND DIDN'T GET BACK IS GONE.
         *
         * The loop above silently skipped these, and `linkStatus: "gone"` was
         * a value **nothing in `convex/maya` ever wrote** — only the frozen v1
         * did. So a deleted post stayed `live` forever.
         *
         * ⚠️ That corrupts the one gate the whole plan hangs on. `cadence.ts`
         * counts only `live` placements and says so in its own doc: a dead
         * link *"counts as having happened and then stopped being true, which
         * the streak should notice rather than paper over."* It couldn't
         * notice. Delete a post and it still counts toward the seven days.
         *
         * Detection is free — the platform answering about four of five tweets
         * IS the statement that the fifth doesn't exist.
         *
         * ⚠️ Guarded on `returned.size > 0`. A batch that comes back entirely
         * empty is far more likely to be the API having a bad minute than five
         * posts vanishing at once, and wrongly marking them `gone` would break
         * the streak in the opposite direction — silently, and in the
         * direction that loses real work.
         */
        if (returned.size > 0) {
          for (const askedFor of batch) {
            if (returned.has(askedFor)) continue;
            const placementId = byTweetId.get(askedFor);
            if (!placementId) continue;
            await ctx.runMutation(internal.maya.metrics.markGone, {
              placementId,
              now,
            });
          }
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

/**
 * ⭐ The same post, spelled two ways.
 *
 * Found by testing against a real placement: TikTok's analytics payload
 * returns the post URL WITH tracking params —
 * `...?utm_campaign=tt4d_open_api&utm_source=aw4smjxfftapkprm` — while
 * `/posts/{id}` returns it bare. Exact-string matching silently found nothing,
 * so a post sitting at 38 views showed no metrics at all.
 *
 * Silent, because "no match" and "no numbers yet" produce the same empty
 * result — the failure shape this file keeps running into.
 */
export function canonicalUrl(url: string): string {
  const withoutQuery = url.split("?")[0].split("#")[0];
  return withoutQuery.replace(/\/+$/, "").toLowerCase();
}

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
      // Links first: a placement without one can't be measured, counted
      // toward the cadence, or shown to the founder.
      await ctx.runAction(internal.maya.metrics.backfillUrls, {
        customerId,
        now: args.now,
      });
      const result = await ctx.runAction(internal.maya.metrics.refresh, {
        customerId,
        now: args.now,
      });
      updated += result.updated;
      // The other three channels, via Zernio — X is not in that payload.
      const viaZernio = await ctx.runAction(
        internal.maya.metrics.refreshFromZernio,
        { customerId, now: args.now }
      );
      updated += viaZernio.updated;
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

/**
 * ⭐ Metrics for the channels twitterapi.io can't see.
 *
 * `refresh` above covers X only. Zernio's `/analytics` covers the rest, and it
 * is RICHER than anything we get for X — verified live 2026-08-05 against real
 * placements:
 *
 *   TikTok  { views: 38, likes, comments, shares, saves, clicks, follows,
 *             impressions, reach, engagementRate, lastUpdated }
 *   YouTube { views: 50, likes: 1, engagementRate: 2, ... }
 *
 * ⚠️ It returns **nothing for X** — `xCapabilities.analytics` is `false` on
 * that account because X is billed pass-through, and §2.15.17 decides to leave
 * it that way at 33× the price of twitterapi.io. So the two paths are
 * complementary by design, not redundant.
 *
 * ⚠️ Instagram returned 0 posts despite three live placements at the time of
 * writing. Recorded rather than explained — the sync may simply lag, and
 * calling it broken before re-checking is what §2.15.1 exists to prevent.
 *
 * Matched on `platformPostUrl`, not on our idempotency key, because that is
 * what the analytics payload actually carries back.
 */
export const refreshFromZernio = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ checked: number; updated: number; detail: string }> => {
    const now = args.now ?? Date.now();
    const apiKey = process.env.ZERNIO_API_KEY;
    if (!apiKey) {
      return { checked: 0, updated: 0, detail: "the accounts aren't connected yet" };
    }

    const all = (await ctx.runQuery(internal.maya.metrics.awaitingMetrics, {
      customerId: args.customerId,
      now,
    })) as Doc<"placements">[];
    if (all.length === 0) {
      return { checked: 0, updated: 0, detail: "nothing recent to check" };
    }

    const byUrl = new Map<string, Id<"placements">>();
    for (const p of all) if (p.url) byUrl.set(canonicalUrl(p.url), p._id);

    const { ZernioClient } = await import("../integrations/zernio/client");
    const client = new ZernioClient({ apiKey });
    let updated = 0;

    // X is deliberately absent — see the note above.
    for (const platform of ["tiktok", "instagram", "youtube"]) {
      try {
        const raw = (await client.request<unknown>("/api/v1/analytics", {
          method: "GET",
          query: { platform, limit: 50 },
        })) as { posts?: Array<Record<string, unknown>> };

        for (const post of raw.posts ?? []) {
          const url = typeof post.platformPostUrl === "string" ? post.platformPostUrl : null;
          const placementId = url ? byUrl.get(canonicalUrl(url)) : undefined;
          if (!placementId) continue;

          const a = (post.analytics ?? {}) as Record<string, unknown>;
          await ctx.runMutation(internal.maya.metrics.recordMetrics, {
            placementId,
            metricsJson: JSON.stringify({
              views: numberOf(a.views),
              likes: numberOf(a.likes),
              comments: numberOf(a.comments),
              shares: numberOf(a.shares),
              saves: numberOf(a.saves),
              impressions: numberOf(a.impressions),
              reach: numberOf(a.reach),
              clicks: numberOf(a.clicks),
              follows: numberOf(a.follows),
              engagementRate: numberOf(a.engagementRate),
            }),
            now,
          });
          updated += 1;
        }
      } catch (error) {
        console.error(
          `[metrics] zernio analytics failed for ${platform}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return {
      checked: all.length,
      updated,
      detail: updated === 0 ? "no numbers back yet" : `${updated} updated`,
    };
  },
});

/** Live placements on the channels Zernio reports on, inside the window. */
export const awaitingMetrics = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"placements">[]> => {
    const now = args.now ?? Date.now();
    const rows = (await ctx.db
      .query("placements")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"placements">[];
    return rows.filter(
      (p) =>
        p.channel !== "x" &&
        p.linkStatus === "live" &&
        Boolean(p.url) &&
        now - p.publishedAt <= REFRESH_WINDOW_MS
    );
  },
});

/**
 * ⭐ Backfill the URL for a placement that published asynchronously.
 *
 * Instagram — and any channel Zernio queues rather than posts inline — returns
 * `ok` with no `platformPostUrl`. Verified live 2026-08-05: our placement
 * recorded `unknown` while `https://www.instagram.com/p/DbrZX_HDLhk/` was
 * already live on the account.
 *
 * `unknown` was the right thing to record — invariant 1 forbids assuming a
 * URL. But without this, it stays `unknown` forever: the placement never
 * counts toward the seven-day cadence, the evening recap has no link, and the
 * founder is told nothing went out when something did.
 *
 * §2.6 puts it plainly — the unit of work is *something live, with a URL*.
 * This is how a queued publish becomes one.
 */
export const backfillUrls = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ checked: number; resolved: number; detail: string }> => {
    const pending = await ctx.runQuery(internal.maya.metrics.awaitingUrl, {
      customerId: args.customerId,
      now: args.now,
    });
    if (pending.length === 0) {
      return { checked: 0, resolved: 0, detail: "nothing waiting on a link" };
    }

    const apiKey = process.env.ZERNIO_API_KEY;
    if (!apiKey) {
      return { checked: 0, resolved: 0, detail: "the accounts aren't connected yet" };
    }

    const { ZernioClient } = await import("../integrations/zernio/client");
    const client = new ZernioClient({ apiKey });
    let resolved = 0;

    for (const placement of pending) {
      if (!placement.zernioPostId) continue;
      try {
        const raw = (await client.request<unknown>(
          `/api/v1/posts/${encodeURIComponent(placement.zernioPostId)}`,
          { method: "GET" }
        )) as {
          post?: { platforms?: Array<{ platformPostUrl?: string | null; status?: string }> };
          platforms?: Array<{ platformPostUrl?: string | null; status?: string }>;
        };
        const platforms = raw.post?.platforms ?? raw.platforms ?? [];
        const url = platforms.find((p) => p.platformPostUrl)?.platformPostUrl;
        if (url) {
          await ctx.runMutation(internal.maya.metrics.setUrl, {
            placementId: placement._id,
            url,
            now: args.now,
          });
          resolved += 1;
        }
      } catch (error) {
        console.error(
          `[metrics] url backfill failed for ${placement._id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return {
      checked: pending.length,
      resolved,
      detail:
        resolved === 0
          ? `${pending.length} still waiting on a link`
          : `${resolved} of ${pending.length} now have one`,
    };
  },
});

/**
 * Placements that published but whose link we never saw.
 *
 * Bounded to the refresh window: a post that never produced a URL in two weeks
 * is not going to, and re-asking forever is a bill with no answer at the end.
 */
export const awaitingUrl = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"placements">[]> => {
    const now = args.now ?? Date.now();
    const rows = (await ctx.db
      .query("placements")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"placements">[];
    return rows.filter(
      (p) =>
        p.linkStatus === "unknown" &&
        Boolean(p.zernioPostId) &&
        now - p.publishedAt <= REFRESH_WINDOW_MS
    );
  },
});

export const setUrl = internalMutation({
  args: {
    placementId: v.id("placements"),
    url: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    // `live` only ever set alongside a real URL — invariant 1.
    await ctx.db.patch(args.placementId, {
      url: args.url,
      linkStatus: "live",
    });
  },
});

/**
 * Mark a placement's link dead.
 *
 * Separate from `recordMetrics` because it is a different KIND of fact: one
 * says how a live post is doing, this says the post is no longer there. Rolled
 * into one mutation they would be easy to confuse at the call site, and the
 * consequence of confusing them is a streak that counts deleted posts.
 *
 * Never resurrects: a placement already `gone` stays gone, so a flapping API
 * cannot toggle the streak back and forth.
 */
export const markGone = internalMutation({
  args: { placementId: v.id("placements"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ marked: boolean }> => {
    const placement = (await ctx.db.get(args.placementId)) as Doc<"placements"> | null;
    if (!placement || placement.linkStatus === "gone") return { marked: false };
    await ctx.db.patch(args.placementId, {
      linkStatus: "gone",
      metricsAsOf: args.now ?? Date.now(),
    });
    console.warn(
      `[metrics] placement ${args.placementId} is gone — the post was removed`
    );
    return { marked: true };
  },
});
