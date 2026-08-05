/**
 * ScrapeCreators — X / Twitter: upstream parsers, normalizers, wrappers.
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

// `/v1/twitter/user-tweets` (current path) returns the raw Twitter GraphQL
// shape: text + engagement live under `legacy`, id under `rest_id`, views
// under `views.count`. The old flat fields are kept for back-compat.
const XLegacySchema = z
  .object({
    full_text: z.string().optional(),
    created_at: z.string().optional(),
    favorite_count: NumberLike.optional(),
    reply_count: NumberLike.optional(),
    retweet_count: NumberLike.optional(),
    quote_count: NumberLike.optional(),
  })
  .passthrough();

const XTweetSchema = z
  .object({
    id_str: z.string().optional(),
    id: z.string().optional(),
    rest_id: z.string().optional(),
    full_text: z.string().optional(),
    text: z.string().optional(),
    created_at: z.string().optional(),
    favorite_count: NumberLike.optional(),
    reply_count: NumberLike.optional(),
    retweet_count: NumberLike.optional(),
    quote_count: NumberLike.optional(),
    view_count: NumberLike.optional(),
    media_url_https: z.string().optional(),
    legacy: XLegacySchema.optional(),
    views: z.object({ count: NumberLike.optional() }).passthrough().optional(),
    url: z.string().optional(),
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
    const lg = t.legacy;
    const id = t.rest_id ?? t.id_str ?? t.id ?? "";
    const createdAt = lg?.created_at ?? t.created_at;
    const postedAt = createdAt ? Math.floor(Date.parse(createdAt) / 1000) || null : null;
    return NormalizedPostSchema.parse({
      platform: "x",
      postId: id,
      url: t.url ?? (id ? `https://x.com/i/status/${id}` : null),
      caption: str(lg?.full_text ?? t.full_text ?? t.text),
      postedAt,
      metrics: {
        likeCount: num(lg?.favorite_count) ?? num(t.favorite_count),
        commentCount: num(lg?.reply_count) ?? num(t.reply_count),
        viewCount: num(t.views?.count) ?? num(t.view_count),
        shareCount: num(lg?.retweet_count) ?? num(t.retweet_count),
        saveCount: null,
      },
      mediaType: t.media_url_https ? "image" : "text",
      thumbnailUrl: str(t.media_url_https),
      videoUrl: null,
      raw: t,
    });
  });
}


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
    // Current path is `/v1/twitter/user-tweets` (hyphenated); the old
    // `/v1/twitter/user/tweets` 404s. Returns ~100 most-popular tweets (not
    // chronological), no `limit` param — we truncate to the caller's limit.
    const raw = await clientOf(deps).request<unknown>("/v1/twitter/user-tweets", {
      query: { handle },
    });
    return normalizeXTweets(raw).slice(0, limit);
  },
};

/* -------------------------------------------------------------------------- */
