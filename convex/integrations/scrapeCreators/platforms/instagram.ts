/**
 * ScrapeCreators — Instagram: upstream parsers, normalizers, wrappers.
 *
 * Split out of the former 1,746-line `endpoints.ts` (Sprint 1). The public
 * surface is unchanged — `endpoints.ts` re-exports everything — so every
 * existing import keeps working.
 */

import { z } from "zod";
import {
  NormalizedPostSchema,
  NormalizedProfileSchema,
  NumberLike,
  type NormalizedPost,
  type NormalizedProfile,
  type RawScrapeCreatorsResult,
} from "../schemas";
import { num, str } from "../normalize";
import { clientOf, rawResult, type EndpointDeps } from "../deps";

/* ---- Instagram ---- */

const IgProfileSchema = z
  .object({
    username: z.string().optional(),
    full_name: z.string().optional(),
    biography: z.string().optional(),
    is_verified: z.boolean().optional(),
    edge_followed_by: z.object({ count: NumberLike }).partial().optional(),
    edge_follow: z.object({ count: NumberLike }).partial().optional(),
    edge_owner_to_timeline_media: z
      .object({ count: NumberLike })
      .partial()
      .optional(),
    external_url: z.string().optional(),
    profile_pic_url_hd: z.string().optional(),
    profile_pic_url: z.string().optional(),
  })
  .passthrough();

const IgProfileResponseSchema = z
  .object({
    user: IgProfileSchema.optional(),
    data: z.object({ user: IgProfileSchema.optional() }).partial().optional(),
  })
  .passthrough();

const IgPostSchema = z
  .object({
    id: z.string().optional(),
    pk: z.string().optional(),
    code: z.string().optional(),
    shortcode: z.string().optional(),
    caption: z
      .union([
        z.object({ text: z.string().optional() }).partial(),
        z.string(),
        z.null(),
      ])
      .optional(),
    taken_at: NumberLike.optional(),
    like_count: NumberLike.optional(),
    comment_count: NumberLike.optional(),
    play_count: NumberLike.optional(),
    view_count: NumberLike.optional(),
    media_type: NumberLike.optional(),
    image_versions2: z.unknown().optional(),
    video_versions: z
      .array(z.object({ url: z.string() }).passthrough())
      .optional(),
    thumbnail_url: z.string().optional(),
    video_duration: NumberLike.optional(),
  })
  .passthrough();

const IgPostsResponseSchema = z
  .object({
    items: z.array(IgPostSchema).optional(),
    posts: z.array(IgPostSchema).optional(),
    data: z
      .object({ items: z.array(IgPostSchema).optional() })
      .partial()
      .optional(),
    next_max_id: z.string().optional(),
  })
  .passthrough();


function normalizeIgProfile(handle: string, raw: unknown): NormalizedProfile {
  const parsed = IgProfileResponseSchema.parse(raw);
  const u = parsed.user ?? parsed.data?.user;
  return NormalizedProfileSchema.parse({
    platform: "instagram",
    handle: u?.username ?? handle,
    displayName: str(u?.full_name),
    bio: str(u?.biography),
    followerCount: num(u?.edge_followed_by?.count) ?? 0,
    followingCount: num(u?.edge_follow?.count),
    postCount: num(u?.edge_owner_to_timeline_media?.count),
    verified: u?.is_verified ?? false,
    externalUrl: str(u?.external_url),
    avatarUrl: str(u?.profile_pic_url_hd ?? u?.profile_pic_url),
    raw,
  });
}

function normalizeIgPosts(raw: unknown): NormalizedPost[] {
  const parsed = IgPostsResponseSchema.parse(raw);
  const list = parsed.items ?? parsed.posts ?? parsed.data?.items ?? [];
  return list.map((p) => {
    const captionText =
      typeof p.caption === "string"
        ? p.caption
        : p.caption && typeof p.caption === "object"
          ? str((p.caption as { text?: string }).text)
          : null;
    const mediaTypeNum = num(p.media_type);
    const mediaType: NormalizedPost["mediaType"] =
      mediaTypeNum === 2
        ? "video"
        : mediaTypeNum === 8
          ? "carousel"
          : mediaTypeNum === 1
            ? "image"
            : "unknown";
    const videoUrl = p.video_versions?.[0]?.url ?? null;
    return NormalizedPostSchema.parse({
      platform: "instagram",
      postId: p.id ?? p.pk ?? p.shortcode ?? p.code ?? "",
      url: p.code || p.shortcode ? `https://www.instagram.com/p/${p.code ?? p.shortcode}/` : null,
      caption: captionText,
      postedAt: num(p.taken_at),
      metrics: {
        likeCount: num(p.like_count),
        commentCount: num(p.comment_count),
        viewCount: num(p.play_count ?? p.view_count),
        shareCount: null,
        saveCount: null,
      },
      mediaType,
      thumbnailUrl: str(p.thumbnail_url),
      videoUrl,
      videoDurationSec: num(p.video_duration),
      raw: p,
    });
  });
}


/* ---- Instagram ---- */

export const instagram = {
  /** Vendor-cached at 0 credits within `cache_max_age` (plan §3.2); always passed. */
  async profile(
    handle: string,
    options?: EndpointDeps & { cacheMaxAge?: "1d" | "3d" | "7d" | "14d" | "30d"; trim?: boolean }
  ): Promise<NormalizedProfile> {
    const query: Record<string, string | number | boolean | undefined> = {
      handle,
      cache_max_age: options?.cacheMaxAge ?? "1d",
    };
    if (options?.trim !== undefined) query.trim = options.trim;
    const raw = await clientOf(options).request<unknown>("/v1/instagram/profile", { query });
    return normalizeIgProfile(handle, raw);
  },
  async lastPosts(
    handle: string,
    limit: number,
    deps?: EndpointDeps
  ): Promise<NormalizedPost[]> {
    const raw = await clientOf(deps).request<unknown>("/v2/instagram/user/posts", {
      query: { handle, limit },
    });
    return normalizeIgPosts(raw);
  },
  /** Single post or reel by URL (the API is URL-first; `shortcode` is rejected). */
  async post(
    postUrl: string,
    deps?: EndpointDeps
  ): Promise<NormalizedPost | null> {
    const raw = await clientOf(deps).request<unknown>("/v1/instagram/post", {
      query: { url: postUrl },
    });
    const list = normalizeIgPosts({ items: [raw] });
    return list[0] ?? null;
  },
  /* ---- Sprint 1 P0 wrappers. Params VERIFIED LIVE 2026-07-31. -------------
   *
   * Same finding as YouTube: the docs summary named `post_id`, `media_id` and
   * `user_id`; the live API answers `You must provide a url` and rejects
   * `user_id`. ScrapeCreators is URL-first. Raw envelopes — shapes are pinned
   * by tier-2 smoke, not guessed here.
   *
   * Note `/v1/instagram/user/posts` (the existing `lastPosts` wrapper) was
   * SUSPECTED of being a stale v1 path. It is not — it returns 200. A v2 also
   * exists and also takes `handle`, with a different response shape.
   * ---------------------------------------------------------------------- */

  /** Comments on a post. Takes the post URL, NOT a shortcode or post_id. */
  async postComments(
    postUrl: string,
    deps?: EndpointDeps
  ): Promise<RawScrapeCreatorsResult> {
    const query = { url: postUrl };
    const raw = await clientOf(deps).request<unknown>(
      "/v2/instagram/post/comments",
      { query }
    );
    return rawResult("instagram_post_comments", query, raw);
  },

  /**
   * Transcript of a video post.
   *
   * 404s with "post does not have a video" on a photo post — that's the API
   * being correct, not an error to retry, so callers should check the media
   * type before spending the call.
   */
  async mediaTranscript(
    postUrl: string,
    options?: EndpointDeps & { cacheMaxAge?: "1d" | "3d" | "7d" | "14d" | "30d" }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = {
      url: postUrl,
      cache_max_age: options?.cacheMaxAge ?? "30d",
    };
    const deps = options;
    const raw = await clientOf(deps).request<unknown>(
      "/v2/instagram/media/transcript",
      { query }
    );
    return rawResult("instagram_media_transcript", query, raw);
  },

  /**
   * Reels search — the lane sweep on Instagram. Google-indexed and best-effort
   * (not Instagram-native); `date_posted` is `last-week | last-month | last-year`;
   * `page` 1–11 only, 12+ returns 400.
   */
  async reelsSearch(
    queryText: string,
    options?: EndpointDeps & { datePosted?: "last-week" | "last-month" | "last-year"; page?: number }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = { query: queryText };
    if (options?.datePosted !== undefined) query.date_posted = options.datePosted;
    if (options?.page !== undefined) query.page = options.page;
    const raw = await clientOf(options).request<unknown>(
      "/v2/instagram/reels/search",
      { query }
    );
    return rawResult("instagram_reels_search", query, raw);
  },

  /** An account's Reels, paginated with `max_id`. `user_id` is faster than `handle` once known. */
  async userReels(
    handle: string,
    options?: EndpointDeps & { userId?: string; maxId?: string; trim?: boolean }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = options?.userId
      ? { user_id: options.userId }
      : { handle };
    if (options?.maxId !== undefined) query.max_id = options.maxId;
    if (options?.trim !== undefined) query.trim = options.trim;
    const raw = await clientOf(options).request<unknown>(
      "/v1/instagram/user/reels",
      { query }
    );
    return rawResult("instagram_user_reels", query, raw);
  },

  /**
   * Reels using a given audio — the sound engine's input on Instagram.
   * `audio_id` comes from the audio page URL (`instagram.com/reels/audio/{id}/`).
   * The current spec names `/v1/instagram/audio/reels`; `/v1/instagram/song/reels`
   * was the earlier alias with the same shape.
   */
  async audioReels(
    audioId: string,
    options?: EndpointDeps & { cursor?: string }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = { audio_id: audioId };
    if (options?.cursor !== undefined) query.cursor = options.cursor;
    const raw = await clientOf(options).request<unknown>(
      "/v1/instagram/audio/reels",
      { query }
    );
    return rawResult("instagram_audio_reels", query, raw);
  },

  /** Instagram-native ranked users, hashtags, places and keyword suggestions. One page, no posts. */
  async search(
    queryText: string,
    deps?: EndpointDeps
  ): Promise<RawScrapeCreatorsResult> {
    const query = { query: queryText };
    const raw = await clientOf(deps).request<unknown>("/v1/instagram/search", { query });
    return rawResult("instagram_search", query, raw);
  },

  /**
   * Instagram's own curated topic page (`/popular/{query}`): title, media count,
   * generated description, suggested terms, posts, opaque cursor. The best
   * Instagram trend surface the vendor exposes (plan §12.1 `ig.popular`).
   */
  async searchPopular(
    topic: string,
    options?: EndpointDeps & { cursor?: string }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = { query: topic };
    if (options?.cursor !== undefined) query.cursor = options.cursor;
    const raw = await clientOf(options).request<unknown>(
      "/v1/instagram/search/popular",
      { query }
    );
    return rawResult("instagram_search_popular", query, raw);
  },

  /** Creator discovery from Google-indexed bios and captions. Best-effort; cursor ≤ 11. */
  async searchProfiles(
    queryText: string,
    options?: EndpointDeps & { cursor?: string }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = { query: queryText };
    if (options?.cursor !== undefined) query.cursor = options.cursor;
    const raw = await clientOf(options).request<unknown>(
      "/v1/instagram/search/profiles",
      { query }
    );
    return rawResult("instagram_search_profiles", query, raw);
  },

  /** Google-indexed posts under a hashtag; `media_type=reels` to restrict. cursor ≤ 11. */
  async searchHashtag(
    hashtag: string,
    options?: EndpointDeps & {
      datePosted?: "last-hour" | "last-day" | "last-week" | "last-month" | "last-year";
      mediaType?: "all" | "reels";
      cursor?: string;
    }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = {
      hashtag: hashtag.replace(/^#/, ""),
    };
    if (options?.datePosted !== undefined) query.date_posted = options.datePosted;
    if (options?.mediaType !== undefined) query.media_type = options.mediaType;
    if (options?.cursor !== undefined) query.cursor = options.cursor;
    const raw = await clientOf(options).request<unknown>(
      "/v1/instagram/search/hashtag",
      { query }
    );
    return rawResult("instagram_search_hashtag", query, raw);
  },

  /** Instagram's public reels page. Small overlapping batches; call repeatedly and dedupe by shortcode. */
  async reelsTrending(deps?: EndpointDeps): Promise<RawScrapeCreatorsResult> {
    const raw = await clientOf(deps).request<unknown>("/v1/instagram/reels/trending");
    return rawResult("instagram_reels_trending", {}, raw);
  },

  /** Total post count when `profile` returns `media_count: null`. */
  async profilePostCount(
    handle: string,
    deps?: EndpointDeps
  ): Promise<RawScrapeCreatorsResult> {
    const query = { handle };
    const raw = await clientOf(deps).request<unknown>(
      "/v1/instagram/profile/post-count",
      { query }
    );
    return rawResult("instagram_profile_post_count", query, raw);
  },

  /** Story highlights: what a creator chooses to keep on their profile (plan §13.1, dossier interests). */
  async highlights(
    handle: string,
    deps?: EndpointDeps
  ): Promise<RawScrapeCreatorsResult> {
    const query = { handle };
    const raw = await clientOf(deps).request<unknown>(
      "/v1/instagram/user/highlights",
      { query }
    );
    return rawResult("instagram_user_highlights", query, raw);
  },

  async highlightDetail(
    highlightId: string,
    deps?: EndpointDeps
  ): Promise<RawScrapeCreatorsResult> {
    const query = { id: highlightId };
    const raw = await clientOf(deps).request<unknown>(
      "/v1/instagram/user/highlight/detail",
      { query }
    );
    return rawResult("instagram_user_highlight_detail", query, raw);
  },
};

