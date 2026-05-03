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

export const tiktok = {
  async profile(handle: string, deps?: EndpointDeps): Promise<NormalizedProfile> {
    const raw = await clientOf(deps).request<unknown>("/v1/tiktok/profile", {
      query: { handle },
    });
    return normalizeTikTokProfile(handle, raw);
  },
  async lastPosts(
    handle: string,
    limit: number,
    deps?: EndpointDeps
  ): Promise<NormalizedPost[]> {
    const raw = await clientOf(deps).request<unknown>("/v1/tiktok/user/posts", {
      query: { handle, limit },
    });
    return normalizeTikTokPosts(raw);
  },
  async post(
    postId: string,
    deps?: EndpointDeps
  ): Promise<NormalizedPost | null> {
    const raw = await clientOf(deps).request<unknown>("/v1/tiktok/post", {
      query: { id: postId },
    });
    const list = normalizeTikTokPosts({ aweme_list: [raw] });
    return list[0] ?? null;
  },
  async comments(
    postId: string,
    deps?: EndpointDeps
  ): Promise<NormalizedComment[]> {
    const raw = await clientOf(deps).request<unknown>("/v1/tiktok/comments", {
      query: { id: postId },
    });
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
    postId: string,
    deps?: EndpointDeps
  ): Promise<{ transcript: string | null }> {
    const raw = await clientOf(deps).request<unknown>("/v1/tiktok/transcript", {
      query: { id: postId },
    });
    const parsed = TikTokTranscriptResponseSchema.parse(raw);
    if (parsed.transcript) {
      return { transcript: parsed.transcript };
    }
    if (parsed.segments?.length) {
      return { transcript: parsed.segments.map((s) => s.text).join(" ") };
    }
    return { transcript: null };
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
