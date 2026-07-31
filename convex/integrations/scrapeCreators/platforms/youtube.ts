/**
 * ScrapeCreators — YouTube: upstream parsers, normalizers, wrappers.
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
} from "../schemas";
import { num, str } from "../normalize";
import { clientOf, type EndpointDeps } from "../deps";

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
    // `/v1/youtube/channel-videos` (current path) returns these *Int/Date variants.
    publishDate: z.string().optional(),
    viewCount: NumberLike.optional(),
    viewCountInt: NumberLike.optional(),
    likeCount: NumberLike.optional(),
    likeCountInt: NumberLike.optional(),
    commentCount: NumberLike.optional(),
    commentCountInt: NumberLike.optional(),
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
    const publishedRaw = v.publishedAt ?? v.publishDate;
    const publishedAt =
      typeof publishedRaw === "string"
        ? Math.floor(Date.parse(publishedRaw) / 1000) || null
        : typeof publishedRaw === "number"
          ? publishedRaw
          : null;
    return NormalizedPostSchema.parse({
      platform: "youtube",
      postId: v.id ?? v.videoId ?? "",
      url: v.url ?? (v.id || v.videoId ? `https://www.youtube.com/watch?v=${v.id ?? v.videoId}` : null),
      caption: str(v.title),
      postedAt: publishedAt,
      metrics: {
        likeCount: num(v.likeCountInt) ?? num(v.likeCount),
        commentCount: num(v.commentCountInt) ?? num(v.commentCount),
        viewCount: num(v.viewCountInt) ?? num(v.viewCount),
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
    // Current path is `/v1/youtube/channel-videos` (hyphenated); the old
    // `/v1/youtube/channel/videos` 404s. No `limit` param upstream — it returns
    // one cursor page; we truncate to the caller's limit.
    const raw = await clientOf(deps).request<unknown>("/v1/youtube/channel-videos", {
      query: { handle },
    });
    return normalizeYtVideos(raw).slice(0, limit);
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

