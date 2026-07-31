/**
 * ScrapeCreators — shared primitives + canonical output shapes.
 *
 * These are the shapes Maya consumes. Every platform normalizes INTO them, so
 * a caller never has to know which vendor endpoint produced a post.
 *
 * Split out of the former 1,746-line `endpoints.ts` (Sprint 1). The public
 * surface is unchanged — `endpoints.ts` re-exports everything — so every
 * existing import keeps working.
 */

import { z } from "zod";

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

export const NumberLike = z.union([z.number(), z.string().transform((s) => Number(s))]);

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

export const TikTokResearchResultSchema = z.object({
  source: z.string(),
  query: z.record(z.string(), z.unknown()),
  posts: z.array(NormalizedPostSchema),
  raw: z.unknown(),
});
export type TikTokResearchResult = z.infer<typeof TikTokResearchResultSchema>;

export const RawScrapeCreatorsResultSchema = z.object({
  source: z.string(),
  query: z.record(z.string(), z.unknown()),
  raw: z.unknown(),
});
export type RawScrapeCreatorsResult = z.infer<
  typeof RawScrapeCreatorsResultSchema
>;

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

