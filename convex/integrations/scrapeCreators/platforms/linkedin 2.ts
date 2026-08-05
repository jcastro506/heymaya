/**
 * ScrapeCreators — LinkedIn: upstream parsers, normalizers, wrappers.
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

