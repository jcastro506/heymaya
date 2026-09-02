/**
 * ScrapeCreators — cross-platform and account endpoints (plan §12.1).
 *
 * `findSocialProfiles` turns one handle into every linked profile.
 * `redditSearch` is the "audience pain in their own words" read.
 * `creditBalance` is checked before every sweep (0 credits); `dailyUsage` and
 * `mostUsedRoutes` reconcile our endpoint-table cost rows against the vendor.
 */

import { z } from "zod";
import { clientOf, rawResult, type EndpointDeps } from "../deps";
import type { RawScrapeCreatorsResult } from "../schemas";

export type SocialPlatform = "instagram" | "tiktok" | "youtube" | "x" | "twitter" | "facebook";

const CreditBalanceSchema = z
  .object({
    success: z.boolean().optional(),
    creditCount: z.number().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export const cross = {
  /**
   * Profiles explicitly linked from a source profile, plus expanded link-in-bio
   * pages. Handles only, never URLs; a leading `@` is fine. Vendor-cached at
   * 0 credits within `cache_max_age`.
   */
  async findSocialProfiles(
    platform: SocialPlatform,
    handle: string,
    options?: EndpointDeps & { cacheMaxAge?: "1d" | "3d" | "7d" | "14d" | "30d" }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = {
      platform,
      handle: handle.replace(/^@/, ""),
    };
    query.cache_max_age = options?.cacheMaxAge ?? "30d";
    const raw = await clientOf(options).request<unknown>("/v1/find-social-profiles", { query });
    return rawResult("find_social_profiles", query, raw);
  },

  /** Reddit posts or comments matching a query, by timeframe. */
  async redditSearch(
    queryText: string,
    options?: EndpointDeps & {
      filter?: "posts" | "comments";
      sort?: "relevance" | "new" | "top" | "comment_count";
      timeframe?: "all" | "day" | "week" | "month" | "year";
      after?: string;
      trim?: boolean;
    }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = { query: queryText };
    if (options?.filter !== undefined) query.filter = options.filter;
    if (options?.sort !== undefined) query.sort = options.sort;
    if (options?.timeframe !== undefined) query.timeframe = options.timeframe;
    if (options?.after !== undefined) query.after = options.after;
    query.trim = options?.trim ?? true;
    const raw = await clientOf(options).request<unknown>("/v1/reddit/search", { query });
    return rawResult("reddit_search", query, raw);
  },

  /** Remaining credits. 0 credits to call. The sweep refuses to start below the floor (plan §16.2). */
  async creditBalance(deps?: EndpointDeps): Promise<{ credits: number | null; raw: unknown }> {
    const raw = await clientOf(deps).request<unknown>("/v1/credit-balance");
    const parsed = CreditBalanceSchema.safeParse(raw);
    return { credits: parsed.success ? (parsed.data.creditCount ?? null) : null, raw };
  },

  /** Last 30 days of credits and requests per day, for the daily reconciliation (plan §16.4). */
  async dailyUsage(deps?: EndpointDeps): Promise<RawScrapeCreatorsResult> {
    const raw = await clientOf(deps).request<unknown>("/v1/account/get-daily-usage-count");
    return rawResult("account_daily_usage", {}, raw);
  },

  /** Top 20 endpoints by call count with credits consumed, for a time range. */
  async mostUsedRoutes(
    options?: EndpointDeps & { startTime?: string; endTime?: string }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (options?.startTime !== undefined) query.start_time = options.startTime;
    if (options?.endTime !== undefined) query.end_time = options.endTime;
    const raw = await clientOf(options).request<unknown>("/v1/account/get-most-used-routes", { query });
    return rawResult("account_most_used_routes", query, raw);
  },
};

/**
 * Documented credit cost per endpoint path, written to `costEvents` at call time
 * and reconciled daily against `/v1/credit-balance` deltas (plan §16.4). The
 * vendor does not return a cost per call. Keep this table next to the wrappers
 * so a new endpoint cannot be added without a cost.
 */
export const CREDITS_BY_PATH: Record<string, number> = {
  "/v1/tiktok/profile": 1,
  "/v1/tiktok/profile/region": 1,
  "/v3/tiktok/profile/videos": 1,
  "/v2/tiktok/video": 1,
  "/v1/tiktok/video/transcript": 1, // +10 when use_ai_as_fallback=true and used
  "/v1/tiktok/video/comments": 1,
  "/v1/tiktok/comment/replies": 1,
  "/v1/tiktok/user/following": 1,
  "/v1/tiktok/user/followers": 1,
  "/v1/tiktok/user/audience": 26,
  "/v1/tiktok/search/users": 1,
  "/v1/tiktok/search/hashtag": 1,
  "/v1/tiktok/search/keyword": 1,
  "/v1/tiktok/search/top": 1,
  "/v1/tiktok/search/suggestions": 1,
  "/v1/tiktok/get-trending-feed": 1,
  "/v1/tiktok/creators/popular": 1,
  "/v1/tiktok/song": 1,
  "/v1/tiktok/song/videos": 1,
  "/v1/tiktok/collection/videos": 1,
  "/v1/instagram/profile": 1,
  "/v1/instagram/profile/post-count": 1,
  "/v1/instagram/user/posts": 1,
  "/v2/instagram/user/posts": 1,
  "/v1/instagram/user/reels": 1,
  "/v1/instagram/post": 1,
  "/v2/instagram/post/comments": 15, // per the vendor spec; mine Instagram comments on top posts only
  "/v2/instagram/media/transcript": 1,
  "/v2/instagram/reels/search": 1,
  "/v1/instagram/search": 1,
  "/v1/instagram/search/popular": 1,
  "/v1/instagram/search/profiles": 1,
  "/v1/instagram/search/hashtag": 1,
  "/v1/instagram/reels/trending": 1,
  "/v1/instagram/audio/reels": 1,
  "/v1/instagram/user/highlights": 1,
  "/v1/instagram/user/highlight/detail": 1,
  "/v1/find-social-profiles": 10, // per the vendor spec; 0 on a cache_max_age hit
  "/v1/reddit/search": 1,
  "/v1/credit-balance": 0,
  "/v1/account/get-daily-usage-count": 0,
  "/v1/account/get-most-used-routes": 0,
};
