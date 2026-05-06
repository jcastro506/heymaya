/**
 * Typed wrappers around the ScrapeCreators endpoints we use in v0.
 *
 * We intentionally model ONLY the fields Maya consumes downstream. ScrapeCreators frequently
 * adds upstream platform fields and returns deeply-nested raw payloads — pinning to a narrow,
 * Zod-validated subset means schema drift fails loud (in tests + at runtime) instead of
 * silently corrupting the creator picture.
 *
 * Endpoint paths are based on https://docs.scrapecreators.com (sprint 1 docs read).
 * Where the upstream wraps results in `{ data: ... }` or `{ success, ... }`, we use Zod
 * `passthrough()` + extract the canonical shape.
 *
 * If an endpoint changes shape upstream, the Zod parser throws — caller catches in
 * `runFullScrapePull` and degrades gracefully (Sprint 7 failure-mode work).
 */

import { z } from "zod";
import { getDefaultClient, ScrapeCreatorsClient } from "./client";

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

export const PlatformSchema = z.enum([
  "tiktok",
  "instagram",
  "youtube",
  "linkedin",
  "x",
]);
export type Platform = z.infer<typeof PlatformSchema>;

const NumberLike = z.union([z.number(), z.string().transform((s) => Number(s))]);

/* -------------------------------------------------------------------------- */
/* Common normalized output shapes                                            */
/* -------------------------------------------------------------------------- */

export const NormalizedProfileSchema = z.object({
  platform: PlatformSchema,
  handle: z.string(),
  displayName: z.string().nullable(),
  bio: z.string().nullable(),
  followerCount: z.number(),
  followingCount: z.number().nullable(),
  postCount: z.number().nullable(),
  verified: z.boolean(),
  externalUrl: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  // Raw upstream payload retained for downstream multimodal synth.
  raw: z.unknown(),
});
export type NormalizedProfile = z.infer<typeof NormalizedProfileSchema>;

export const NormalizedPostSchema = z.object({
  platform: PlatformSchema,
  postId: z.string(),
  url: z.string().nullable(),
  caption: z.string().nullable(),
  postedAt: z.number().nullable(),
  metrics: z.object({
    likeCount: z.number().nullable(),
    commentCount: z.number().nullable(),
    viewCount: z.number().nullable(),
    shareCount: z.number().nullable(),
    saveCount: z.number().nullable(),
  }),
  mediaType: z.enum(["video", "image", "carousel", "text", "unknown"]),
  thumbnailUrl: z.string().nullable(),
  videoUrl: z.string().nullable(),
  /**
   * Video duration in seconds. Optional — not every upstream platform exposes
   * it. Used by the synthesis multimodal batching pipeline to enforce the
   * 30-min Gemini cap. TikTok statsV2 sometimes carries `duration` in seconds
   * or `duration_ms` in milliseconds; Instagram exposes `video_duration` (sec);
   * YouTube long-form exposes `lengthSeconds`. When missing the batching
   * module treats it as 0/unknown.
   * TODO(s7): derive from videoUrl HEAD + Composio media-info when missing.
   */
  videoDurationSec: z.number().nullable().optional(),
  raw: z.unknown(),
});
export type NormalizedPost = z.infer<typeof NormalizedPostSchema>;

export const NormalizedCommentSchema = z.object({
  commentId: z.string(),
  authorHandle: z.string().nullable(),
  text: z.string(),
  likeCount: z.number().nullable(),
  postedAt: z.number().nullable(),
});
export type NormalizedComment = z.infer<typeof NormalizedCommentSchema>;

/**
 * Sprint 4 — normalized audience demographics.
 *
 * Optional fields: every bucket can be missing if the upstream didn't surface
 * it. The synthesizer treats missing as "no signal" and falls back to inferred
 * audience signal from comments + caption analysis (the existing v0 path).
 *
 * `raw` is the upstream payload retained for forensics / future re-parsing
 * without re-spending the 26 credits. NEVER show raw to the model — costs
 * tokens for no benefit. Use `ageRanges` / `topGeos` / `genderSplit`.
 */
export const NormalizedAudienceSchema = z.object({
  platform: PlatformSchema,
  handle: z.string(),
  /** Top age buckets, e.g. ["18-24", "25-34"]. Empty when no signal. */
  ageRanges: z.array(z.string()),
  /** Top geographies (country / region / city labels). Empty when no signal. */
  topGeos: z.array(z.string()),
  /**
   * Normalized gender split (sums ≈1.0). Null when the upstream didn't surface
   * any gender signal.
   */
  genderSplit: z
    .object({ male: z.number(), female: z.number(), other: z.number() })
    .nullable(),
  raw: z.unknown(),
});
export type NormalizedAudience = z.infer<typeof NormalizedAudienceSchema>;

/**
 * Sprint 4 — normalized following list (TikTok-only in v0).
 *
 * `count` is the size of the returned page (paginated upstream; we only
 * pull page 1 in v0 — full traversal would burn credits without compounding
 * value at the bulk-pull stage).
 *
 * `total` is the upstream total following count when the response surfaces
 * it, else null (caller falls back to `profile.followingCount`).
 */
export const NormalizedFollowingSchema = z.object({
  platform: PlatformSchema,
  handle: z.string(),
  count: z.number(),
  total: z.number().nullable(),
  /** Subset of the page (handle + nickname) Maya's competitor_watch consumes. */
  users: z.array(
    z.object({
      handle: z.string().nullable(),
      nickname: z.string().nullable(),
    })
  ),
  raw: z.unknown(),
});
export type NormalizedFollowing = z.infer<typeof NormalizedFollowingSchema>;

/* -------------------------------------------------------------------------- */
/* Upstream parsers — narrow Zod schemas per platform                         */
/* -------------------------------------------------------------------------- */

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
    commentCount: NumberLike.optional(),
    playCount: NumberLike.optional(),
    shareCount: NumberLike.optional(),
    collectCount: NumberLike.optional(),
  })
  .passthrough();

const TikTokVideoSchema = z
  .object({
    id: z.string(),
    desc: z.string().optional(),
    createTime: NumberLike.optional(),
    stats: TikTokVideoStatsSchema.optional(),
    statsV2: TikTokVideoStatsSchema.optional(),
    video: z
      .object({
        cover: z.string().optional(),
        playAddr: z.string().optional(),
        downloadAddr: z.string().optional(),
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

const TikTokTranscriptResponseSchema = z
  .object({
    transcript: z.string().optional(),
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
      .optional(),
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

const TikTokFollowingResponseSchema = z
  .object({
    users: z.array(TikTokFollowingUserSchema).optional(),
    following: z.array(TikTokFollowingUserSchema).optional(),
    userList: z.array(TikTokFollowingUserSchema).optional(),
    data: z
      .object({
        users: z.array(TikTokFollowingUserSchema).optional(),
        following: z.array(TikTokFollowingUserSchema).optional(),
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

/* ---- YouTube ---- */

const YtChannelSchema = z
  .object({
    id: z.string().optional(),
    channelId: z.string().optional(),
    handle: z.string().optional(),
    title: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    subscriberCount: NumberLike.optional(),
    videoCount: NumberLike.optional(),
    viewCount: NumberLike.optional(),
    thumbnail: z.string().optional(),
    avatar: z.string().optional(),
    isVerified: z.boolean().optional(),
    externalUrl: z.string().optional(),
  })
  .passthrough();

const YtChannelResponseSchema = z
  .object({
    channel: YtChannelSchema.optional(),
    data: YtChannelSchema.optional(),
  })
  .passthrough()
  .or(YtChannelSchema);

const YtVideoSchema = z
  .object({
    id: z.string().optional(),
    videoId: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    publishedAt: z.union([z.string(), z.number()]).optional(),
    viewCount: NumberLike.optional(),
    likeCount: NumberLike.optional(),
    commentCount: NumberLike.optional(),
    thumbnail: z.string().optional(),
    url: z.string().optional(),
    lengthSeconds: NumberLike.optional(),
    length_seconds: NumberLike.optional(),
    durationSec: NumberLike.optional(),
  })
  .passthrough();

const YtVideosResponseSchema = z
  .object({
    videos: z.array(YtVideoSchema).optional(),
    items: z.array(YtVideoSchema).optional(),
    data: z
      .object({ videos: z.array(YtVideoSchema).optional() })
      .partial()
      .optional(),
  })
  .passthrough();

/* ---- LinkedIn ---- */

const LinkedInProfileSchema = z
  .object({
    publicIdentifier: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    headline: z.string().optional(),
    summary: z.string().optional(),
    followerCount: NumberLike.optional(),
    connectionCount: NumberLike.optional(),
    profilePicture: z.string().optional(),
    isVerified: z.boolean().optional(),
  })
  .passthrough();

const LinkedInProfileResponseSchema = z
  .object({
    profile: LinkedInProfileSchema.optional(),
    data: LinkedInProfileSchema.optional(),
  })
  .passthrough()
  .or(LinkedInProfileSchema);

const LinkedInPostSchema = z
  .object({
    urn: z.string().optional(),
    activityUrn: z.string().optional(),
    text: z.string().optional(),
    publishedAt: z.union([z.string(), z.number()]).optional(),
    likeCount: NumberLike.optional(),
    commentCount: NumberLike.optional(),
    repostCount: NumberLike.optional(),
    url: z.string().optional(),
  })
  .passthrough();

const LinkedInPostsResponseSchema = z
  .object({
    posts: z.array(LinkedInPostSchema).optional(),
    items: z.array(LinkedInPostSchema).optional(),
    data: z
      .object({ posts: z.array(LinkedInPostSchema).optional() })
      .partial()
      .optional(),
  })
  .passthrough();

/* ---- X / Twitter ---- */

const XProfileSchema = z
  .object({
    id: z.string().optional(),
    rest_id: z.string().optional(),
    screen_name: z.string().optional(),
    handle: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    followers_count: NumberLike.optional(),
    friends_count: NumberLike.optional(),
    statuses_count: NumberLike.optional(),
    verified: z.boolean().optional(),
    profile_image_url_https: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

const XProfileResponseSchema = z
  .object({
    user: XProfileSchema.optional(),
    data: XProfileSchema.optional(),
  })
  .passthrough()
  .or(XProfileSchema);

const XTweetSchema = z
  .object({
    id_str: z.string().optional(),
    id: z.string().optional(),
    full_text: z.string().optional(),
    text: z.string().optional(),
    created_at: z.string().optional(),
    favorite_count: NumberLike.optional(),
    reply_count: NumberLike.optional(),
    retweet_count: NumberLike.optional(),
    quote_count: NumberLike.optional(),
    view_count: NumberLike.optional(),
    media_url_https: z.string().optional(),
  })
  .passthrough();

const XTweetsResponseSchema = z
  .object({
    tweets: z.array(XTweetSchema).optional(),
    data: z.array(XTweetSchema).optional(),
    items: z.array(XTweetSchema).optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/* Normalizers — upstream → canonical                                         */
/* -------------------------------------------------------------------------- */

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

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
    const stats = v.statsV2 ?? v.stats;
    const durationSec =
      num(v.video?.duration) ??
      num(v.video?.durationSec) ??
      (typeof v.video?.duration_ms === "number"
        ? Math.round(v.video.duration_ms / 1000)
        : null);
    return NormalizedPostSchema.parse({
      platform: "tiktok",
      postId: v.id,
      url: null,
      caption: str(v.desc),
      postedAt: num(v.createTime),
      metrics: {
        likeCount: num(stats?.diggCount),
        commentCount: num(stats?.commentCount),
        viewCount: num(stats?.playCount),
        shareCount: num(stats?.shareCount),
        saveCount: num(stats?.collectCount),
      },
      mediaType: "video",
      thumbnailUrl: str(v.video?.cover),
      videoUrl: str(v.video?.playAddr ?? v.video?.downloadAddr),
      videoDurationSec: durationSec,
      raw: v,
    });
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
function normalizeTikTokFollowing(
  handle: string,
  raw: unknown
): NormalizedFollowing {
  const parsed = TikTokFollowingResponseSchema.parse(raw);
  const list =
    parsed.users ??
    parsed.following ??
    parsed.userList ??
    parsed.data?.users ??
    parsed.data?.following ??
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

function normalizeYtChannel(handle: string, raw: unknown): NormalizedProfile {
  const parsed = YtChannelResponseSchema.parse(raw);
  const c = ("channel" in parsed && parsed.channel
    ? parsed.channel
    : "data" in parsed && parsed.data
      ? parsed.data
      : parsed) as unknown as z.infer<typeof YtChannelSchema>;
  return NormalizedProfileSchema.parse({
    platform: "youtube",
    handle: c.handle ?? handle,
    displayName: str(c.title ?? c.name),
    bio: str(c.description),
    followerCount: num(c.subscriberCount) ?? 0,
    followingCount: null,
    postCount: num(c.videoCount),
    verified: c.isVerified ?? false,
    externalUrl: str(c.externalUrl),
    avatarUrl: str(c.thumbnail ?? c.avatar),
    raw,
  });
}

function normalizeYtVideos(raw: unknown): NormalizedPost[] {
  const parsed = YtVideosResponseSchema.parse(raw);
  const list = parsed.videos ?? parsed.items ?? parsed.data?.videos ?? [];
  return list.map((v) => {
    const publishedAt =
      typeof v.publishedAt === "string"
        ? Math.floor(Date.parse(v.publishedAt) / 1000) || null
        : typeof v.publishedAt === "number"
          ? v.publishedAt
          : null;
    return NormalizedPostSchema.parse({
      platform: "youtube",
      postId: v.id ?? v.videoId ?? "",
      url: v.url ?? (v.id || v.videoId ? `https://www.youtube.com/watch?v=${v.id ?? v.videoId}` : null),
      caption: str(v.title),
      postedAt: publishedAt,
      metrics: {
        likeCount: num(v.likeCount),
        commentCount: num(v.commentCount),
        viewCount: num(v.viewCount),
        shareCount: null,
        saveCount: null,
      },
      mediaType: "video",
      thumbnailUrl: str(v.thumbnail),
      videoUrl: null,
      videoDurationSec:
        num(v.lengthSeconds) ?? num(v.length_seconds) ?? num(v.durationSec),
      raw: v,
    });
  });
}

function normalizeLinkedInProfile(
  handle: string,
  raw: unknown
): NormalizedProfile {
  const parsed = LinkedInProfileResponseSchema.parse(raw);
  const p = ("profile" in parsed && parsed.profile
    ? parsed.profile
    : "data" in parsed && parsed.data
      ? parsed.data
      : parsed) as unknown as z.infer<typeof LinkedInProfileSchema>;
  const display =
    [p.firstName, p.lastName].filter((s): s is string => !!s).join(" ") ||
    null;
  return NormalizedProfileSchema.parse({
    platform: "linkedin",
    handle: p.publicIdentifier ?? handle,
    displayName: display,
    bio: str(p.headline ?? p.summary),
    followerCount: num(p.followerCount) ?? 0,
    followingCount: num(p.connectionCount),
    postCount: null,
    verified: p.isVerified ?? false,
    externalUrl: null,
    avatarUrl: str(p.profilePicture),
    raw,
  });
}

function normalizeLinkedInPosts(raw: unknown): NormalizedPost[] {
  const parsed = LinkedInPostsResponseSchema.parse(raw);
  const list = parsed.posts ?? parsed.items ?? parsed.data?.posts ?? [];
  return list.map((p) => {
    const postedAt =
      typeof p.publishedAt === "string"
        ? Math.floor(Date.parse(p.publishedAt) / 1000) || null
        : typeof p.publishedAt === "number"
          ? p.publishedAt
          : null;
    return NormalizedPostSchema.parse({
      platform: "linkedin",
      postId: p.urn ?? p.activityUrn ?? "",
      url: p.url ?? null,
      caption: str(p.text),
      postedAt,
      metrics: {
        likeCount: num(p.likeCount),
        commentCount: num(p.commentCount),
        viewCount: null,
        shareCount: num(p.repostCount),
        saveCount: null,
      },
      mediaType: "text",
      thumbnailUrl: null,
      videoUrl: null,
      raw: p,
    });
  });
}

function normalizeXProfile(handle: string, raw: unknown): NormalizedProfile {
  const parsed = XProfileResponseSchema.parse(raw);
  const u = ("user" in parsed && parsed.user
    ? parsed.user
    : "data" in parsed && parsed.data
      ? parsed.data
      : parsed) as unknown as z.infer<typeof XProfileSchema>;
  return NormalizedProfileSchema.parse({
    platform: "x",
    handle: u.screen_name ?? u.handle ?? handle,
    displayName: str(u.name),
    bio: str(u.description),
    followerCount: num(u.followers_count) ?? 0,
    followingCount: num(u.friends_count),
    postCount: num(u.statuses_count),
    verified: u.verified ?? false,
    externalUrl: str(u.url),
    avatarUrl: str(u.profile_image_url_https),
    raw,
  });
}

function normalizeXTweets(raw: unknown): NormalizedPost[] {
  const parsed = XTweetsResponseSchema.parse(raw);
  const list = parsed.tweets ?? parsed.data ?? parsed.items ?? [];
  return list.map((t) => {
    const postedAt = t.created_at ? Math.floor(Date.parse(t.created_at) / 1000) || null : null;
    return NormalizedPostSchema.parse({
      platform: "x",
      postId: t.id_str ?? t.id ?? "",
      url: t.id_str || t.id ? `https://x.com/i/status/${t.id_str ?? t.id}` : null,
      caption: str(t.full_text ?? t.text),
      postedAt,
      metrics: {
        likeCount: num(t.favorite_count),
        commentCount: num(t.reply_count),
        viewCount: num(t.view_count),
        shareCount: num(t.retweet_count),
        saveCount: null,
      },
      mediaType: t.media_url_https ? "image" : "text",
      thumbnailUrl: str(t.media_url_https),
      videoUrl: null,
      raw: t,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Endpoint wrappers — exported per platform                                  */
/* -------------------------------------------------------------------------- */

export interface EndpointDeps {
  client?: ScrapeCreatorsClient;
}

function clientOf(deps?: EndpointDeps): ScrapeCreatorsClient {
  return deps?.client ?? getDefaultClient();
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
    const list = normalizeTikTokPosts({ aweme_list: [raw] });
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
   * burn. The endpoint returns the upstream raw payload alongside the
   * normalized projection so synthesis can inspect anything the normalizer
   * dropped without spending another 26 credits.
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
    return normalizeTikTokFollowing(handle, raw);
  },
};

/* ---- Instagram ---- */

export const instagram = {
  async profile(handle: string, deps?: EndpointDeps): Promise<NormalizedProfile> {
    const raw = await clientOf(deps).request<unknown>("/v1/instagram/profile", {
      query: { handle },
    });
    return normalizeIgProfile(handle, raw);
  },
  async lastPosts(
    handle: string,
    limit: number,
    deps?: EndpointDeps
  ): Promise<NormalizedPost[]> {
    const raw = await clientOf(deps).request<unknown>("/v1/instagram/user/posts", {
      query: { handle, limit },
    });
    return normalizeIgPosts(raw);
  },
  async post(
    shortcode: string,
    deps?: EndpointDeps
  ): Promise<NormalizedPost | null> {
    const raw = await clientOf(deps).request<unknown>("/v1/instagram/post", {
      query: { shortcode },
    });
    const list = normalizeIgPosts({ items: [raw] });
    return list[0] ?? null;
  },
};

/* ---- YouTube ---- */

export const youtube = {
  async channel(handle: string, deps?: EndpointDeps): Promise<NormalizedProfile> {
    const raw = await clientOf(deps).request<unknown>("/v1/youtube/channel", {
      query: { handle },
    });
    return normalizeYtChannel(handle, raw);
  },
  async recentVideos(
    handle: string,
    limit: number,
    deps?: EndpointDeps
  ): Promise<NormalizedPost[]> {
    const raw = await clientOf(deps).request<unknown>("/v1/youtube/channel/videos", {
      query: { handle, limit },
    });
    return normalizeYtVideos(raw);
  },
  async video(
    videoId: string,
    deps?: EndpointDeps
  ): Promise<NormalizedPost | null> {
    const raw = await clientOf(deps).request<unknown>("/v1/youtube/video", {
      query: { id: videoId },
    });
    const list = normalizeYtVideos({ videos: [raw] });
    return list[0] ?? null;
  },
};

/* ---- LinkedIn ---- */

export const linkedin = {
  async profile(handle: string, deps?: EndpointDeps): Promise<NormalizedProfile> {
    const raw = await clientOf(deps).request<unknown>("/v1/linkedin/profile", {
      query: { handle },
    });
    return normalizeLinkedInProfile(handle, raw);
  },
  async recentPosts(
    handle: string,
    limit: number,
    deps?: EndpointDeps
  ): Promise<NormalizedPost[]> {
    const raw = await clientOf(deps).request<unknown>("/v1/linkedin/posts", {
      query: { handle, limit },
    });
    return normalizeLinkedInPosts(raw);
  },
};

/* ---- X / Twitter ---- */

export const x = {
  async profile(handle: string, deps?: EndpointDeps): Promise<NormalizedProfile> {
    const raw = await clientOf(deps).request<unknown>("/v1/twitter/profile", {
      query: { handle },
    });
    return normalizeXProfile(handle, raw);
  },
  async recentPosts(
    handle: string,
    limit: number,
    deps?: EndpointDeps
  ): Promise<NormalizedPost[]> {
    const raw = await clientOf(deps).request<unknown>("/v1/twitter/user/tweets", {
      query: { handle, limit },
    });
    return normalizeXTweets(raw);
  },
};

/* -------------------------------------------------------------------------- */
/* Platform dispatch — used by `runFullScrapePull`                            */
/* -------------------------------------------------------------------------- */

export interface PlatformReader {
  profile(handle: string, deps?: EndpointDeps): Promise<NormalizedProfile>;
  lastPosts(
    handle: string,
    limit: number,
    deps?: EndpointDeps
  ): Promise<NormalizedPost[]>;
}

export const PLATFORM_READERS: Record<Platform, PlatformReader> = {
  tiktok: {
    profile: tiktok.profile,
    lastPosts: tiktok.lastPosts,
  },
  instagram: {
    profile: instagram.profile,
    lastPosts: instagram.lastPosts,
  },
  youtube: {
    profile: youtube.channel,
    lastPosts: youtube.recentVideos,
  },
  linkedin: {
    profile: linkedin.profile,
    lastPosts: linkedin.recentPosts,
  },
  x: {
    profile: x.profile,
    lastPosts: x.recentPosts,
  },
};
