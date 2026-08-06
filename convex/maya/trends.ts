/**
 * The trend sweep (§5.2 sweep 3) — what shape is working right now.
 *
 * Feeds the half of the loop §14.2.2 just closed: at **L1** the diagnosis is a
 * *format* problem, and idea scoring then prefers evidence of things that
 * demonstrably travelled. This is where that evidence comes from.
 *
 * ## ⚠️ Trending is not the same as relevant, and that is the whole risk
 *
 * A live pull returned `#AEWDynamite` at rank 1 on X. It is genuinely trending
 * and it means nothing to an indie SaaS founder. Banking it would have her
 * chasing wrestling hashtags — the same failure `learn-business` already hit
 * once, where "engagement" surfaced wedding photographers and "threads"
 * surfaced sewing.
 *
 * So nothing here is banked on popularity alone. A trend has to **intersect
 * the niche's own vocabulary** before it counts as evidence, and the ones that
 * don't are dropped rather than ranked lower.
 *
 * ## What actually exists, checked 2026-08-05
 *
 * | source | state |
 * |---|---|
 * | TikTok `get-trending-feed` | ✅ 16 posts with `statistics` |
 * | YouTube `shorts/trending` | ✅ 77 shorts with view/like/comment counts |
 * | X `trends` | ✅ names + rank, **no engagement** |
 * | TikTok `hashtags/popular` | ⛔ **dead** — *"TikTok took this page down"* |
 * | TikTok `songs/popular` | ⛔ **dead** — *"this endpoint is unavailable"* |
 *
 * §5.2 lists all five. Two are gone upstream, and the vendor says so in plain
 * words rather than failing — recorded here so nobody spends an afternoon
 * re-discovering it.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Observation } from "./scroll";
import { velocity, toMillis } from "./learnBusiness";

/** How many trending items to consider per source before filtering. */
export const TREND_SAMPLE = 40;

/**
 * ⭐ Does this trend belong to our niche at all?
 *
 * A word-boundary match against the niche's own vocabulary. Deliberately
 * strict: the cost of a false positive is her posting about wrestling, and the
 * cost of a false negative is one missed format among dozens.
 */
export function intersectsNiche(text: string, keywords: string[]): boolean {
  const haystack = text.toLowerCase();
  return keywords.some((k) => {
    const term = k.toLowerCase().trim();
    if (term.length < 3) return false;
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(
      haystack
    );
  });
}

/**
 * Read what's trending, keep only what's ours.
 *
 * Returns observations in `scroll`'s shape so the idea bank can consume them
 * with no special case — a trending post IS an observation, it just arrived
 * from a different door.
 */
export const sweepTrends = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    considered: number;
    kept: number;
    observations: Observation[];
    detail: string;
  }> => {
    const now = args.now ?? Date.now();
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets || targets.keywords.length === 0) {
      return {
        ok: false,
        considered: 0,
        kept: 0,
        observations: [],
        detail: "I don't know what to watch yet",
      };
    }

    const keywords = targets.keywords;
    const kept: Observation[] = [];
    let considered = 0;

    const { tiktok } = await import(
      "../integrations/scrapeCreators/platforms/tiktok"
    );
    const { youtube } = await import(
      "../integrations/scrapeCreators/platforms/youtube"
    );

    /**
     * TikTok's trending feed.
     *
     * ⚠️ `trendingFeed` NORMALISES for us — it returns `{ posts:
     * NormalizedPost[] }`, not the raw `aweme_list`. I wrote the raw parse
     * first out of habit; reading the wrapper saved re-deriving `create_time`
     * handling that `toMillis` already gets right.
     *
     * `region` is required, not optional.
     */
    try {
      const result = await tiktok.trendingFeed("US");
      for (const post of result.posts.slice(0, TREND_SAMPLE)) {
        considered += 1;
        const desc = post.caption ?? "";
        if (!intersectsNiche(desc, keywords)) continue;

        const ms = toMillis(post.postedAt);
        const metrics = {
          likes: post.metrics.likeCount ?? 0,
          comments: post.metrics.commentCount ?? 0,
          views: post.metrics.viewCount ?? 0,
        };
        kept.push({
          channel: "tiktok",
          sourceUrl:
            post.url ??
            (post.authorHandle
              ? `https://www.tiktok.com/@${post.authorHandle}/video/${post.postId}`
              : ""),
          authorHandle: post.authorHandle ?? null,
          text: desc,
          postedAt: ms,
          metrics,
          velocity: velocity(post.metrics, post.postedAt, now),
          keyword: "trending",
        });
      }
    } catch (error) {
      console.error(`[trends] tiktok feed failed: ${String(error)}`);
    }

    // YouTube trending shorts — the 9:16 format library, with engagement.
    try {
      const raw = (await youtube.shortsTrending()) as unknown as {
        raw?: { shorts?: unknown[] };
      };
      for (const item of (raw.raw?.shorts ?? []).slice(0, TREND_SAMPLE)) {
        const short = item as Record<string, unknown>;
        considered += 1;
        const text = `${String(short.title ?? "")} ${String(short.description ?? "")}`;
        if (!intersectsNiche(text, keywords)) continue;

        const channel = (short.channel ?? {}) as { handle?: string };
        const metrics = {
          likes: numberOf(short.likeCountInt),
          comments: numberOf(short.commentCountInt),
          views: numberOf(short.viewCountInt),
        };
        /**
         * ⚠️ No usable date — `publishDateText` is prose ("3 days ago"). So
         * velocity cannot be computed, and it is left at 0 rather than
         * invented. Trending is itself the recency signal here; pretending to
         * a number would put junk at the top of what she reads first.
         */
        kept.push({
          channel: "youtube",
          sourceUrl:
            typeof short.url === "string"
              ? short.url
              : `https://www.youtube.com/watch?v=${String(short.id ?? "")}`,
          authorHandle: channel.handle ?? null,
          text: String(short.title ?? ""),
          postedAt: null,
          metrics,
          velocity: 0,
          keyword: "trending",
        });
      }
    } catch (error) {
      console.error(`[trends] youtube shorts failed: ${String(error)}`);
    }

    if (kept.length > 0) {
      await ctx.runMutation(internal.maya.scroll.recordObservations, {
        customerId: args.customerId,
        observationsJson: JSON.stringify(kept),
        now,
      });
    }

    return {
      ok: true,
      considered,
      kept: kept.length,
      observations: kept,
      /**
       * A zero here is a real finding, not a failure: it means nothing
       * trending right now belongs to this niche, which is the normal case and
       * far better than banking wrestling hashtags.
       */
      detail:
        kept.length === 0
          ? `nothing in ${considered} trending posts belongs to this niche`
          : `${kept.length} of ${considered} trending posts are ours`,
    };
  },
});

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
