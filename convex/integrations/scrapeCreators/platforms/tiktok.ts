/**
 * ScrapeCreators — TikTok: upstream parsers, normalizers, wrappers.
 *
 * Split out of the former 1,746-line `endpoints.ts` (Sprint 1). The public
 * surface is unchanged — `endpoints.ts` re-exports everything — so every
 * existing import keeps working.
 */

import { z } from "zod";
import {
  NormalizedAudienceSchema,
  NormalizedCommentSchema,
  NormalizedFollowingSchema,
  NormalizedPostSchema,
  NormalizedProfileSchema,
  NumberLike,
  TikTokResearchResultSchema,
  type NormalizedAudience,
  type NormalizedComment,
  type NormalizedFollowing,
  type NormalizedPost,
  type NormalizedProfile,
  type RawScrapeCreatorsResult,
  type TikTokResearchResult,
} from "../schemas";
import { num, str, mediaUrl, firstNum, normalizeVideoDurationSec } from "../normalize";
import { clientOf, rawResult, type EndpointDeps } from "../deps";

/* ---- TikTok ---- */

const TikTokUserStatsSchema = z
  .object({
    followerCount: NumberLike.optional(),
    followingCount: NumberLike.optional(),
    videoCount: NumberLike.optional(),
  })
  .passthrough();

const TikTokUserSchema = z
  .object({
    uniqueId: z.string().optional(),
    nickname: z.string().optional(),
    signature: z.string().optional(),
    verified: z.boolean().optional(),
    bioLink: z
      .object({ link: z.string().optional() })
      .partial()
      .optional(),
    avatarLarger: z.string().optional(),
    avatarMedium: z.string().optional(),
  })
  .passthrough();

const TikTokProfileResponseSchema = z
  .object({
    user: TikTokUserSchema.optional(),
    userInfo: z
      .object({
        user: TikTokUserSchema.optional(),
        stats: TikTokUserStatsSchema.optional(),
      })
      .partial()
      .optional(),
    stats: TikTokUserStatsSchema.optional(),
  })
  .passthrough();

const TikTokVideoStatsSchema = z
  .object({
    diggCount: NumberLike.optional(),
    digg_count: NumberLike.optional(),
    commentCount: NumberLike.optional(),
    comment_count: NumberLike.optional(),
    playCount: NumberLike.optional(),
    play_count: NumberLike.optional(),
    shareCount: NumberLike.optional(),
    share_count: NumberLike.optional(),
    collectCount: NumberLike.optional(),
    collect_count: NumberLike.optional(),
    aweme_id: z.string().optional(),
  })
  .passthrough();

const TikTokUrlListSchema = z
  .object({
    url_list: z.array(z.string()).optional(),
    urlList: z.array(z.string()).optional(),
    url: z.string().optional(),
    uri: z.string().optional(),
  })
  .passthrough();

const TikTokMediaUrlSchema = z.union([z.string(), TikTokUrlListSchema]);

const TikTokVideoSchema = z
  .object({
    id: z.string().optional(),
    aweme_id: z.string().optional(),
    group_id: z.string().optional(),
    video_id: z.string().optional(),
    desc: z.string().optional(),
    title: z.string().optional(),
    share_url: z.string().optional(),
    shareUrl: z.string().optional(),
    shareInfo: z
      .object({
        shareUrl: z.string().optional(),
        share_url: z.string().optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    createTime: NumberLike.optional(),
    create_time: NumberLike.optional(),
    /**
     * The poster. `unique_id` is the @handle and is stable; `nickname` is the
     * display name and changes, so only the handle is surfaced.
     *
     * Undeclared until Sprint 4, which meant search results normalized without
     * an author — and a search result nobody can be tracked from defeats the
     * point of a keyword sweep.
     */
    author: z
      .object({
        unique_id: z.string().optional(),
        uniqueId: z.string().optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    stats: TikTokVideoStatsSchema.optional(),
    statsV2: TikTokVideoStatsSchema.optional(),
    statistics: TikTokVideoStatsSchema.optional(),
    video: z
      .object({
        cover: TikTokMediaUrlSchema.optional(),
        originCover: TikTokMediaUrlSchema.optional(),
        origin_cover: TikTokMediaUrlSchema.optional(),
        dynamicCover: TikTokMediaUrlSchema.optional(),
        dynamic_cover: TikTokMediaUrlSchema.optional(),
        playAddr: TikTokMediaUrlSchema.optional(),
        play_addr: TikTokMediaUrlSchema.optional(),
        downloadAddr: TikTokMediaUrlSchema.optional(),
        download_addr: TikTokMediaUrlSchema.optional(),
        downloadNoWatermarkAddr: TikTokMediaUrlSchema.optional(),
        download_no_watermark_addr: TikTokMediaUrlSchema.optional(),
        // Duration in seconds (some endpoints) or duration_ms in ms.
        duration: NumberLike.optional(),
        durationSec: NumberLike.optional(),
        duration_ms: NumberLike.optional(),
      })
      .partial()
      .passthrough()
      .optional(),
  })
  .passthrough();

const TikTokPostsResponseSchema = z
  .object({
    aweme_list: z.array(TikTokVideoSchema).optional(),
    itemList: z.array(TikTokVideoSchema).optional(),
    items: z.array(TikTokVideoSchema).optional(),
    cursor: NumberLike.optional(),
    hasMore: z.boolean().optional(),
  })
  .passthrough();

const TikTokCommentSchema = z
  .object({
    cid: z.string(),
    text: z.string().optional(),
    digg_count: NumberLike.optional(),
    create_time: NumberLike.optional(),
    user: z
      .object({ unique_id: z.string().optional() })
      .partial()
      .optional(),
  })
  .passthrough();

const TikTokCommentsResponseSchema = z
  .object({
    comments: z.array(TikTokCommentSchema).optional(),
    cursor: NumberLike.optional(),
    has_more: NumberLike.optional(),
  })
  .passthrough();

/**
 * ⚠️ `nullish`, not `optional`.
 *
 * The endpoint answers `{"transcript": null}` for a video with no captions —
 * which is common, and is a legitimate empty result rather than an error. With
 * `.optional()` (undefined only) that response fails validation and the caller
 * sees a thrown ZodError.
 *
 * Which made `transcript()`'s own `return { transcript: null }` branch
 * **unreachable**: the function is written to handle the empty case and never
 * could, because `parse` threw first. Measured 2026-08-09 against live TikTok
 * URLs — 3 of 8 came back null and every one surfaced as a vendor failure.
 *
 * The cost of the wrong validator here is that "no transcript" and "the vendor
 * is broken" are indistinguishable in the logs, which is exactly the pair you
 * need to tell apart when deciding whether to retry.
 */
const TikTokTranscriptResponseSchema = z
  .object({
    transcript: z.string().nullish(),
    segments: z
      .array(
        z
          .object({
            text: z.string(),
            startSec: NumberLike.optional(),
            endSec: NumberLike.optional(),
          })
          .passthrough()
      )
      .nullish(),
  })
  .passthrough();

/**
 * Sprint 4 — TikTok audience demographics (`/v1/tiktok/user/audience`).
 *
 * 26 credits/call, so callers must gate aggressively (Sprint 4 policy: skip
 * for handles with ≤5K followers — the demographic signal at that size is
 * thin and the credit cost is the same as a 1M-follower call).
 *
 * The upstream payload's exact shape is undocumented in our installed SKILL.md,
 * so we keep the Zod parser lenient with `.passthrough()` everywhere and let
 * the synthesizer's defensive field extraction do the heavy lifting. We
 * normalize a small surface (ageRanges / topGeos / genderSplit) so callers
 * don't all replicate the upstream-shape walking.
 *
 * Common response shapes observed in the wild include `audience.ageRanges`,
 * `audience.topGeos`, `audience.gender_distribution` keyed by male/female
 * proportions; we tolerate both `audience: { ... }` and a flat top-level
 * shape and the generic `data: { audience }` envelope.
 */
const AudienceAgeBucketSchema = z
  .object({
    range: z.string().optional(),
    label: z.string().optional(),
    bucket: z.string().optional(),
    name: z.string().optional(),
    percent: NumberLike.optional(),
    percentage: NumberLike.optional(),
    share: NumberLike.optional(),
    weight: NumberLike.optional(),
    value: NumberLike.optional(),
  })
  .passthrough();

const AudienceGeoBucketSchema = z
  .object({
    country: z.string().optional(),
    countryCode: z.string().optional(),
    code: z.string().optional(),
    name: z.string().optional(),
    label: z.string().optional(),
    region: z.string().optional(),
    city: z.string().optional(),
    percent: NumberLike.optional(),
    percentage: NumberLike.optional(),
    share: NumberLike.optional(),
    weight: NumberLike.optional(),
    value: NumberLike.optional(),
  })
  .passthrough();

const AudienceCoreSchema = z
  .object({
    ageRanges: z.array(AudienceAgeBucketSchema).optional(),
    age_ranges: z.array(AudienceAgeBucketSchema).optional(),
    age: z.array(AudienceAgeBucketSchema).optional(),
    ageGroups: z.array(AudienceAgeBucketSchema).optional(),
    age_groups: z.array(AudienceAgeBucketSchema).optional(),
    topGeos: z.array(AudienceGeoBucketSchema).optional(),
    top_geos: z.array(AudienceGeoBucketSchema).optional(),
    countries: z.array(AudienceGeoBucketSchema).optional(),
    geo: z.array(AudienceGeoBucketSchema).optional(),
    geos: z.array(AudienceGeoBucketSchema).optional(),
    gender: z
      .object({
        male: NumberLike.optional(),
        female: NumberLike.optional(),
        other: NumberLike.optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    genderSplit: z
      .object({
        male: NumberLike.optional(),
        female: NumberLike.optional(),
        other: NumberLike.optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    gender_distribution: z
      .object({
        male: NumberLike.optional(),
        female: NumberLike.optional(),
        other: NumberLike.optional(),
      })
      .partial()
      .passthrough()
      .optional(),
  })
  .passthrough();

const TikTokAudienceResponseSchema = z
  .object({
    audience: AudienceCoreSchema.optional(),
    data: z
      .object({ audience: AudienceCoreSchema.optional() })
      .partial()
      .passthrough()
      .optional(),
  })
  .passthrough();

/**
 * Sprint 4 — TikTok following list (`/v1/tiktok/user/following`).
 * 1 credit. Used as the cheap probe alongside the bulk pull's profile call —
 * gives Maya a peer signal (named-peers list) for `competitor_watch` and
 * cross-validates the `followingCount` from the profile call. The upstream
 * is paginated with `min_time`; for v0 we take the first page only and
 * surface `count` (length of the returned page) plus `total` if upstream
 * provides it.
 */
const TikTokFollowingUserSchema = z
  .object({
    uniqueId: z.string().optional(),
    unique_id: z.string().optional(),
    nickname: z.string().optional(),
    secUid: z.string().optional(),
    sec_uid: z.string().optional(),
  })
  .passthrough();

/**
 * Serves BOTH `/user/following` and `/user/followers` — the two halves of the
 * buyer map's audience-overlap discovery (§5.0.0). Upstream returns the same
 * envelope for each, keyed by whichever direction you asked for, so the list
 * is read from any of the variants rather than one fixed field.
 */
const TikTokFollowListResponseSchema = z
  .object({
    users: z.array(TikTokFollowingUserSchema).optional(),
    following: z.array(TikTokFollowingUserSchema).optional(),
    followers: z.array(TikTokFollowingUserSchema).optional(),
    userList: z.array(TikTokFollowingUserSchema).optional(),
    data: z
      .object({
        users: z.array(TikTokFollowingUserSchema).optional(),
        following: z.array(TikTokFollowingUserSchema).optional(),
        followers: z.array(TikTokFollowingUserSchema).optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    total: NumberLike.optional(),
    totalCount: NumberLike.optional(),
    cursor: NumberLike.optional(),
    min_time: NumberLike.optional(),
    hasMore: z.boolean().optional(),
    has_more: z.union([z.boolean(), NumberLike]).optional(),
  })
  .passthrough();


function normalizeTikTokProfile(handle: string, raw: unknown): NormalizedProfile {
  const parsed = TikTokProfileResponseSchema.parse(raw);
  const user = parsed.userInfo?.user ?? parsed.user;
  const stats = parsed.userInfo?.stats ?? parsed.stats;
  return NormalizedProfileSchema.parse({
    platform: "tiktok",
    handle: user?.uniqueId ?? handle,
    displayName: str(user?.nickname),
    bio: str(user?.signature),
    followerCount: num(stats?.followerCount) ?? 0,
    followingCount: num(stats?.followingCount),
    postCount: num(stats?.videoCount),
    verified: user?.verified ?? false,
    externalUrl: str(user?.bioLink?.link),
    avatarUrl: str(user?.avatarLarger ?? user?.avatarMedium),
    raw,
  });
}

function normalizeTikTokPosts(raw: unknown): NormalizedPost[] {
  const parsed = TikTokPostsResponseSchema.parse(raw);
  const list = parsed.aweme_list ?? parsed.itemList ?? parsed.items ?? [];
  return list.map((v) => {
    const stats = v.statsV2 ?? v.stats ?? v.statistics;
    const postId =
      str(v.id) ??
      str(v.aweme_id) ??
      str(v.group_id) ??
      str(v.video_id) ??
      str(stats?.aweme_id) ??
      "";
    const durationSec = normalizeVideoDurationSec(
      v.video?.durationSec,
      v.video?.duration,
      v.video?.duration_ms
    );
    return NormalizedPostSchema.parse({
      platform: "tiktok",
      postId,
      url:
        str(v.share_url) ??
        str(v.shareUrl) ??
        str(v.shareInfo?.shareUrl) ??
        str(v.shareInfo?.share_url),
      caption: str(v.desc ?? v.title),
      // `unique_id` is the @handle; `nickname` is the display name and changes.
      authorHandle: str(v.author?.unique_id) ?? str(v.author?.uniqueId),
      postedAt: firstNum(v.createTime, v.create_time),
      metrics: {
        likeCount: firstNum(stats?.diggCount, stats?.digg_count),
        commentCount: firstNum(stats?.commentCount, stats?.comment_count),
        viewCount: firstNum(stats?.playCount, stats?.play_count),
        shareCount: firstNum(stats?.shareCount, stats?.share_count),
        saveCount: firstNum(stats?.collectCount, stats?.collect_count),
      },
      mediaType: "video",
      thumbnailUrl:
        mediaUrl(v.video?.cover) ??
        mediaUrl(v.video?.originCover) ??
        mediaUrl(v.video?.origin_cover) ??
        mediaUrl(v.video?.dynamicCover) ??
        mediaUrl(v.video?.dynamic_cover),
      videoUrl:
        mediaUrl(v.video?.playAddr) ??
        mediaUrl(v.video?.play_addr) ??
        mediaUrl(v.video?.downloadNoWatermarkAddr) ??
        mediaUrl(v.video?.download_no_watermark_addr) ??
        mediaUrl(v.video?.downloadAddr) ??
        mediaUrl(v.video?.download_addr),
      videoDurationSec: durationSec,
      raw: v,
    });
  });
}

function normalizeTikTokResearchPosts(raw: unknown): NormalizedPost[] {
  if (Array.isArray(raw)) return normalizeTikTokPosts({ aweme_list: raw });
  const parsed = z
    .object({
      aweme_list: z.array(TikTokVideoSchema).optional(),
      itemList: z.array(TikTokVideoSchema).optional(),
      items: z.array(TikTokVideoSchema).optional(),
      videos: z.array(TikTokVideoSchema).optional(),
      // `/v1/tiktok/search/keyword` wraps each post in `{ aweme_info: {...} }`
      // under `search_item_list`. Unwrap to the flat shape the other endpoints use.
      search_item_list: z
        .array(z.object({ aweme_info: TikTokVideoSchema }).passthrough())
        .optional(),
      data: z
        .union([
          z.array(TikTokVideoSchema),
          z
            .object({
              aweme_list: z.array(TikTokVideoSchema).optional(),
              itemList: z.array(TikTokVideoSchema).optional(),
              items: z.array(TikTokVideoSchema).optional(),
              videos: z.array(TikTokVideoSchema).optional(),
            })
            .passthrough(),
        ])
        .optional(),
    })
    .passthrough()
    .parse(raw);
  const dataList = Array.isArray(parsed.data)
    ? parsed.data
    : parsed.data?.aweme_list ??
      parsed.data?.itemList ??
      parsed.data?.items ??
      parsed.data?.videos;
  return normalizeTikTokPosts({
    aweme_list:
      parsed.aweme_list ??
      parsed.itemList ??
      parsed.items ??
      parsed.videos ??
      parsed.search_item_list?.map((entry) => entry.aweme_info) ??
      dataList ??
      [],
  });
}

/**
 * Sprint 4 — TikTok audience normalizer.
 *
 * The upstream payload is loosely shaped (different keyings across regions /
 * accounts), so we walk a handful of common spellings and pick the first
 * non-empty result for each axis. Any axis that has no signal returns an
 * empty array (ageRanges / topGeos) or null (genderSplit).
 *
 * Age-range labels are emitted verbatim — "18-24" / "25-34" / etc — as the
 * upstream provides them. If the upstream returns ranks instead of labels
 * (rare), we fall back to the bucket index ("0" / "1") to avoid losing the
 * signal entirely; the synthesizer ignores numeric-only labels.
 */
function normalizeTikTokAudience(
  handle: string,
  raw: unknown
): NormalizedAudience {
  const parsed = TikTokAudienceResponseSchema.parse(raw);
  const a = parsed.audience ?? parsed.data?.audience ?? null;

  const pickAgeArray = (): string[] => {
    if (!a) return [];
    const candidates = [
      a.ageRanges,
      a.age_ranges,
      a.age,
      a.ageGroups,
      a.age_groups,
    ];
    for (const arr of candidates) {
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const labels = arr
        .map(
          (entry, i) =>
            entry.range ??
            entry.label ??
            entry.bucket ??
            entry.name ??
            String(i)
        )
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      if (labels.length > 0) return labels;
    }
    return [];
  };

  const pickGeoArray = (): string[] => {
    if (!a) return [];
    const candidates = [a.topGeos, a.top_geos, a.countries, a.geos, a.geo];
    for (const arr of candidates) {
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const labels = arr
        .map(
          (entry) =>
            entry.country ??
            entry.countryCode ??
            entry.code ??
            entry.region ??
            entry.city ??
            entry.name ??
            entry.label
        )
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      if (labels.length > 0) return labels;
    }
    return [];
  };

  const pickGender = (): NormalizedAudience["genderSplit"] => {
    const g = a?.gender ?? a?.genderSplit ?? a?.gender_distribution;
    if (!g) return null;
    const male = num(g.male) ?? 0;
    const female = num(g.female) ?? 0;
    const other = num(g.other) ?? 0;
    if (male === 0 && female === 0 && other === 0) return null;
    // Normalize percent (0-100) → 0-1 if upstream sent percent.
    const total = male + female + other;
    if (total > 1.5) {
      return {
        male: male / total,
        female: female / total,
        other: other / total,
      };
    }
    return { male, female, other };
  };

  return NormalizedAudienceSchema.parse({
    platform: "tiktok",
    handle,
    ageRanges: pickAgeArray(),
    topGeos: pickGeoArray(),
    genderSplit: pickGender(),
    raw,
  });
}

/**
 * Sprint 4 — TikTok following normalizer. Defensive: tolerates `users` /
 * `following` / `userList` keys at top level OR under `data`.
 */
function normalizeTikTokFollowList(
  handle: string,
  raw: unknown
): NormalizedFollowing {
  const parsed = TikTokFollowListResponseSchema.parse(raw);
  const list =
    parsed.users ??
    parsed.following ??
    parsed.followers ??
    parsed.userList ??
    parsed.data?.users ??
    parsed.data?.following ??
    parsed.data?.followers ??
    [];
  const total = num(parsed.total) ?? num(parsed.totalCount);
  const users = list.map((u) => ({
    handle: str(u.uniqueId ?? u.unique_id),
    nickname: str(u.nickname),
  }));
  return NormalizedFollowingSchema.parse({
    platform: "tiktok",
    handle,
    count: list.length,
    total,
    users,
    raw,
  });
}


// TikTok keyword-search bias params per ScrapeCreators OpenAPI
// (/v1/tiktok/search/keyword). Snake_case mapping happens at the wrapper.
export type TikTokDatePosted =
  | "this_day"
  | "this_week"
  | "this_month"
  | "last_3_months"
  | "last_6_months";
export type TikTokSortBy = "relevance" | "likes" | "comments" | "recent";

export interface TikTokSearchKeywordOptions {
  datePosted?: TikTokDatePosted;
  sortBy?: TikTokSortBy;
  region?: string;
  cursor?: string;
  trim?: boolean;
}

export interface TikTokSearchHashtagOptions {
  region?: string;
  cursor?: string;
  trim?: boolean;
}

function tiktokResearchResult(
  source: string,
  query: Record<string, unknown>,
  raw: unknown
): TikTokResearchResult {
  return TikTokResearchResultSchema.parse({
    source,
    query,
    posts: normalizeTikTokResearchPosts(raw),
    raw,
  });
}


/* ---- TikTok ---- */

/**
 * Build the canonical TikTok video URL from `(handle, awemeId)`. The v2/v1
 * single-video endpoints (`/v2/tiktok/video`, `/v1/tiktok/video/comments`,
 * `/v1/tiktok/video/transcript`) all key on the URL rather than the bare id.
 *
 * We strip a leading `@` so callers can pass either form. The URL pattern is
 * the public-share form ScrapeCreators documents in their SKILL.md routing
 * tables.
 */
export function tiktokVideoUrl(handle: string, awemeId: string): string {
  const cleanHandle = handle.replace(/^@/, "");
  return `https://www.tiktok.com/@${cleanHandle}/video/${awemeId}`;
}

export const tiktok = {
  async profile(handle: string, deps?: EndpointDeps): Promise<NormalizedProfile> {
    // Endpoint unchanged: `/v1/tiktok/profile?handle=H` is still current per
    // the official ScrapeCreators agent skill.
    const raw = await clientOf(deps).request<unknown>("/v1/tiktok/profile", {
      query: { handle },
    });
    return normalizeTikTokProfile(handle, raw);
  },
  async lastPosts(
    handle: string,
    _limit: number,
    deps?: EndpointDeps
  ): Promise<NormalizedPost[]> {
    // Bug fix (production): the v1 path `/v1/tiktok/user/posts` 404s today.
    // The current path is `/v3/tiktok/profile/videos?handle=H` (no `limit`
    // param — the upstream returns one cursor-paginated page; the caller
    // truncates if it needs fewer than the page size).
    const raw = await clientOf(deps).request<unknown>(
      "/v3/tiktok/profile/videos",
      {
        query: { handle },
      }
    );
    return normalizeTikTokPosts(raw);
  },
  async post(
    handle: string,
    awemeId: string,
    deps?: EndpointDeps
  ): Promise<NormalizedPost | null> {
    // Bug fix: `/v1/tiktok/post?id=I` → `/v2/tiktok/video?url=U`.
    const raw = await clientOf(deps).request<unknown>("/v2/tiktok/video", {
      query: { url: tiktokVideoUrl(handle, awemeId) },
    });
    /**
     * ⚠️ Unwrap `aweme_detail` before normalising.
     *
     * `/v2/tiktok/video` answers `{ aweme_detail: {...} }` — the aweme is
     * nested, not the top-level object. Passing the wrapper straight in meant
     * the normaliser looked for `desc`, `statistics` and `video` on an object
     * that only had `aweme_detail`, so EVERY field came back null: no caption,
     * no metrics, and no `videoUrl`.
     *
     * Measured 2026-08-10 while wiring the watch tier. Nothing failed loudly —
     * a post object with null fields is a valid post object, and §5.3.1 records
     * this path as "SOLVED AND VERIFIED END TO END" on the strength of a raw
     * probe rather than a call through this wrapper.
     */
    const detail = (raw as { aweme_detail?: unknown })?.aweme_detail ?? raw;
    const list = normalizeTikTokPosts({ aweme_list: [detail] });
    return list[0] ?? null;
  },
  async comments(
    handle: string,
    awemeId: string,
    deps?: EndpointDeps
  ): Promise<NormalizedComment[]> {
    // Bug fix: `/v1/tiktok/comments?id=I` → `/v1/tiktok/video/comments?url=U`.
    const raw = await clientOf(deps).request<unknown>(
      "/v1/tiktok/video/comments",
      {
        query: { url: tiktokVideoUrl(handle, awemeId) },
      }
    );
    const parsed = TikTokCommentsResponseSchema.parse(raw);
    return (parsed.comments ?? []).map((c) =>
      NormalizedCommentSchema.parse({
        commentId: c.cid,
        authorHandle: str(c.user?.unique_id),
        text: c.text ?? "",
        likeCount: num(c.digg_count),
        postedAt: num(c.create_time),
      })
    );
  },
  async transcript(
    handle: string,
    awemeId: string,
    deps?: EndpointDeps
  ): Promise<{ transcript: string | null }> {
    // Bug fix: `/v1/tiktok/transcript?id=I` → `/v1/tiktok/video/transcript?url=U`.
    const raw = await clientOf(deps).request<unknown>(
      "/v1/tiktok/video/transcript",
      {
        query: { url: tiktokVideoUrl(handle, awemeId) },
      }
    );
    const parsed = TikTokTranscriptResponseSchema.parse(raw);
    if (parsed.transcript) {
      return { transcript: parsed.transcript };
    }
    if (parsed.segments?.length) {
      return { transcript: parsed.segments.map((s) => s.text).join(" ") };
    }
    return { transcript: null };
  },
  /**
   * Sprint 4 — audience demographics for a TikTok handle.
   *
   * COSTS 26 CREDITS PER CALL. Callers MUST gate on follower count
   * (`runFullScrapePull` skips for handles ≤5K followers) and
   * MUST log a `scrapeCreatorsCreditAudit` row so the operator can monitor
   * burn. The endpoint returns a normalized projection
   * (NormalizedAudience) so the synthesizer doesn't have to walk the raw
   * upstream shape; the raw payload is preserved on the normalized result
   * for forensics.
   *
   * Endpoint: `/v1/tiktok/user/audience?handle=H` (per skill SKILL.md
   * § Followers / Following / Live).
   */
  async audience(
    handle: string,
    deps?: EndpointDeps
  ): Promise<NormalizedAudience> {
    const raw = await clientOf(deps).request<unknown>(
      "/v1/tiktok/user/audience",
      { query: { handle } }
    );
    return normalizeTikTokAudience(handle, raw);
  },
  /**
   * Sprint 4 — following list for a TikTok handle. 1 credit. Used as a
   * cheap peer-signal probe; in v0 we read page 1 only (the upstream is
   * `min_time` paginated). Returns the page count + total when surfaced.
   *
   * Endpoint: `/v1/tiktok/user/following?handle=H`.
   */
  async following(
    handle: string,
    deps?: EndpointDeps
  ): Promise<NormalizedFollowing> {
    const raw = await clientOf(deps).request<unknown>(
      "/v1/tiktok/user/following",
      { query: { handle } }
    );
    return normalizeTikTokFollowList(handle, raw);
  },
  /**
   * The other half of the buyer map (§5.0.0). `following` tells you who a
   * founder's audience listens to; `followers` tells you who is listening to
   * an account you've identified — which is how audience overlap gets
   * computed. The manifest has advertised this endpoint to the agent all
   * along; until now there was no typed wrapper behind it.
   */
  async followers(
    handle: string,
    deps?: EndpointDeps
  ): Promise<NormalizedFollowing> {
    const raw = await clientOf(deps).request<unknown>(
      "/v1/tiktok/user/followers",
      { query: { handle } }
    );
    return normalizeTikTokFollowList(handle, raw);
  },
  /**
   * Replies under a single comment. Comment mining reads the top-level
   * comments; the replies are where the disagreement and the follow-up
   * questions live, which is the part worth turning into content.
   */
  async commentReplies(
    postUrl: string,
    commentId: string,
    options?: EndpointDeps & { cursor?: string }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = {
      url: postUrl,
      comment_id: commentId,
    };
    if (options?.cursor !== undefined) query.cursor = options.cursor;
    const raw = await clientOf(options).request<unknown>(
      "/v1/tiktok/comment/replies",
      { query }
    );
    return rawResult("tiktok_comment_replies", query, raw);
  },
  async searchUsers(
    queryText: string,
    deps?: EndpointDeps
  ): Promise<RawScrapeCreatorsResult> {
    const query = { query: queryText };
    const raw = await clientOf(deps).request<unknown>(
      "/v1/tiktok/search/users",
      { query }
    );
    return rawResult("tiktok_search_users", query, raw);
  },
  async searchHashtag(
    hashtag: string,
    options?: EndpointDeps & TikTokSearchHashtagOptions
  ): Promise<TikTokResearchResult> {
    const query: Record<string, string | number | boolean | undefined> = {
      hashtag: hashtag.replace(/^#/, ""),
    };
    if (options?.region !== undefined) query.region = options.region;
    if (options?.cursor !== undefined) query.cursor = options.cursor;
    if (options?.trim !== undefined) query.trim = options.trim;
    const raw = await clientOf(options).request<unknown>(
      "/v1/tiktok/search/hashtag",
      { query }
    );
    return tiktokResearchResult("tiktok_search_hashtag", query, raw);
  },
  async searchKeyword(
    queryText: string,
    options?: EndpointDeps & TikTokSearchKeywordOptions
  ): Promise<TikTokResearchResult> {
    const query: Record<string, string | number | boolean | undefined> = {
      query: queryText,
    };
    // TS camelCase → API snake_case at the wrapper boundary.
    if (options?.datePosted !== undefined) query.date_posted = options.datePosted;
    if (options?.sortBy !== undefined) query.sort_by = options.sortBy;
    if (options?.region !== undefined) query.region = options.region;
    if (options?.cursor !== undefined) query.cursor = options.cursor;
    if (options?.trim !== undefined) query.trim = options.trim;
    const raw = await clientOf(options).request<unknown>(
      "/v1/tiktok/search/keyword",
      { query }
    );
    return tiktokResearchResult("tiktok_search_keyword", query, raw);
  },
  /**
   * TikTok's "Top" tab: the only search that returns photo carousels alongside
   * videos (`content_type`). Same time-frame and sort vocabulary as keyword
   * search, but the parameter is `publish_time`, not `date_posted`.
   */
  async searchTop(
    queryText: string,
    options?: EndpointDeps & TikTokSearchKeywordOptions
  ): Promise<TikTokResearchResult> {
    const query: Record<string, string | number | boolean | undefined> = {
      query: queryText,
    };
    if (options?.datePosted !== undefined) query.publish_time = options.datePosted;
    if (options?.sortBy !== undefined) query.sort_by = options.sortBy;
    if (options?.region !== undefined) query.region = options.region;
    if (options?.cursor !== undefined) query.cursor = options.cursor;
    const raw = await clientOf(options).request<unknown>(
      "/v1/tiktok/search/top",
      { query }
    );
    return tiktokResearchResult("tiktok_search_top", query, raw);
  },
  /**
   * The For You feed as seen from `region`. No pagination: each call is a fresh
   * batch with overlap, so the sweep calls it a few times a day fleet-wide and
   * dedupes by `aweme_id` (plan §3.2, `trending.tiktok`).
   */
  async trendingFeed(
    region: string,
    options?: EndpointDeps & { trim?: boolean }
  ): Promise<TikTokResearchResult> {
    const query: Record<string, string | number | boolean | undefined> = { region };
    if (options?.trim !== undefined) query.trim = options.trim;
    const raw = await clientOf(options).request<unknown>(
      "/v1/tiktok/get-trending-feed",
      { query }
    );
    return tiktokResearchResult("tiktok_trending_feed", query, raw);
  },
  /**
   * Discovery for the admired list (plan §13.9): creators in a follower band and
   * country, sortable by engagement. NOT the Creative Center; the vendor
   * sources this from the Creator Marketplace.
   *
   * Retired and deliberately absent: `/v1/tiktok/videos/popular`,
   * `/v1/tiktok/songs/popular` (gone from the OpenAPI spec, doc pages render
   * the intro page) and `/v1/tiktok/hashtags/popular` (retired 2026-07-16).
   */
  async popularCreators(
    options?: EndpointDeps & TikTokPopularCreatorsOptions
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (options?.followerCount !== undefined) query.followerCount = options.followerCount;
    if (options?.creatorCountry !== undefined) query.creatorCountry = options.creatorCountry;
    if (options?.audienceCountry !== undefined) query.audienceCountry = options.audienceCountry;
    if (options?.sortBy !== undefined) query.sortBy = options.sortBy;
    if (options?.page !== undefined) query.page = options.page;
    const raw = await clientOf(options).request<unknown>(
      "/v1/tiktok/creators/popular",
      { query }
    );
    return rawResult("tiktok_popular_creators", query, raw);
  },
  /**
   * Sound details. `clipId` is the id in a sound URL
   * (`tiktok.com/music/Name-7370375686554782506`), NOT the song id, and it is
   * a string end to end: TikTok ids exceed `Number.MAX_SAFE_INTEGER`, so
   * anything that goes through a JS number is silently corrupted. Use
   * `extractClipId` on raw post objects; never `Number(...)` an id.
   */
  async song(
    clipId: string,
    deps?: EndpointDeps
  ): Promise<RawScrapeCreatorsResult> {
    const query = { clipId };
    const raw = await clientOf(deps).request<unknown>("/v1/tiktok/song", {
      query,
    });
    return rawResult("tiktok_song", query, raw);
  },
  async songVideos(
    clipId: string,
    options?: EndpointDeps & { cursor?: string }
  ): Promise<TikTokResearchResult> {
    const query: Record<string, string | number | boolean | undefined> = { clipId };
    if (options?.cursor !== undefined) query.cursor = options.cursor;
    const raw = await clientOf(options).request<unknown>("/v1/tiktok/song/videos", {
      query,
    });
    return tiktokResearchResult("tiktok_song_videos", query, raw);
  },
  /** Autocomplete as a demand signal (plan §12.1). 1 credit, daily per lane keyword. */
  async searchSuggestions(
    queryText: string,
    options?: EndpointDeps & { region?: string }
  ): Promise<RawScrapeCreatorsResult> {
    const query: Record<string, string | number | boolean | undefined> = { query: queryText };
    if (options?.region !== undefined) query.region = options.region;
    const raw = await clientOf(options).request<unknown>(
      "/v1/tiktok/search/suggestions",
      { query }
    );
    return rawResult("tiktok_search_suggestions", query, raw);
  },
  /** The account's region code (`US`, `MX`, …); drives which trending feed a creator sees. */
  async profileRegion(
    handle: string,
    deps?: EndpointDeps
  ): Promise<{ region: string | null; raw: unknown }> {
    const raw = await clientOf(deps).request<unknown>("/v1/tiktok/profile/region", {
      query: { handle: handle.replace(/^@/, "") },
    });
    const region = str((raw as { region?: unknown })?.region);
    return { region, raw };
  },
  /**
   * A creator's public collection ("playlist"): the videos they saved, which is
   * their own swipe file. Onboarding only (plan §13.1), feeds dossier interests.
   */
  async collectionVideos(
    collectionUrl: string,
    options?: EndpointDeps & { cursor?: string }
  ): Promise<TikTokResearchResult> {
    const query: Record<string, string | number | boolean | undefined> = { url: collectionUrl };
    if (options?.cursor !== undefined) query.cursor = options.cursor;
    const raw = await clientOf(options).request<unknown>(
      "/v1/tiktok/collection/videos",
      { query }
    );
    // Collection responses use TikTok's web shape (`videos[]` with `stats`),
    // not `aweme_list`; the research normalizer accepts both.
    return tiktokResearchResult("tiktok_collection_videos", query, raw);
  },
};

export interface TikTokPopularCreatorsOptions {
  followerCount?: "10K-100K" | "100K-1M" | "1M-10M" | "10M+";
  creatorCountry?: string;
  audienceCountry?: string;
  sortBy?: "engagement" | "follower" | "avg_views";
  page?: number;
}

/**
 * Read a sound's clip id off a raw post object as a STRING. Prefers `id_str`;
 * falls back to a string-typed `id`; refuses a numeric `id` above
 * MAX_SAFE_INTEGER rather than returning a corrupted value.
 */
export function extractClipId(rawPost: unknown): string | null {
  const music = (rawPost as { music?: { id_str?: unknown; id?: unknown } } | null)?.music;
  if (!music) return null;
  if (typeof music.id_str === "string" && music.id_str) return music.id_str;
  if (typeof music.id === "string" && music.id) return music.id;
  if (typeof music.id === "number" && Number.isSafeInteger(music.id)) return String(music.id);
  return null;
}

