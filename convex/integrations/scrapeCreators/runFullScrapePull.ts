/**
 * `runFullScrapePull` — bulk read of a creator's social graph across all requested platforms.
 *
 * Inputs: creatorId + a list of (platform, handle) pairs.
 * Behavior: in parallel, per platform, fetch profile + last-30 posts. For TikTok we also pull
 *   the comments + transcript of the top 3 posts (used by Sprint 2's multimodal synthesis).
 * Persistence:
 *   - upsert each `creatorHandles` row (verified=true, scrapedAt=now, followerCount=...)
 *   - cache each upstream payload via `setCached`
 * Returns: a structured payload the Sprint 2 creator-picture synthesizer consumes.
 *
 * Acceptance gate (per sprint plan): single TT/IG/YT handle full pull <30s.
 *
 * The action is `internalAction` — it's only invoked from the onboarding pipeline (also
 * internal) and from cron sweeps. There is no client-callable entry point.
 *
 * Caller is responsible for plan-tier gating (handle count). See `convex/lib/planFeatures.ts`.
 *
 * Runtime: Convex JS (the platform's bundled fetch + AbortController are sufficient — no
 * Node-only dependencies).
 *
 * Video duration capture (added 2026-04-26 for multimodal batching):
 *   The per-platform normalizers in `endpoints.ts` extract `videoDurationSec`
 *   when the upstream payload exposes it (TikTok statsV2 `video.duration` /
 *   `duration_ms`, Instagram `video_duration`, YouTube `lengthSeconds`).
 *   Duration flows through to `posts[i].videoDurationSec` on the
 *   NormalizedPost shape and is included in the cached raw payload via
 *   `posts.map((p) => p.raw)`. The synthesis pipeline reads it via
 *   `readPosts` in synthesizeCreatorPicture.ts.
 *   TODO(s7): when ScrapeCreators doesn't return duration (e.g. older IG
 *   reels endpoint), derive it via Composio media-info or HEAD-request
 *   inspection of videoUrl. For v0 the batching module treats null/missing
 *   as 0/unknown and still picks the post for full-video synthesis.
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  PLATFORM_READERS,
  type NormalizedPost,
  type NormalizedProfile,
  type Platform,
  tiktok,
  tiktokVideoUrl,
} from "./endpoints";
import {
  cacheKey,
  TTL_PROFILE_SEC,
  TTL_POSTS_SEC,
  TTL_COMMENTS_SEC,
  TTL_TRANSCRIPT_SEC,
} from "./cache";
import { ScrapeCreatorsClient } from "./client";

const POSTS_LIMIT = 30;
const TIKTOK_DEEP_DIVE_TOP_N = 3;

export interface PerPlatformResult {
  platform: Platform;
  handle: string;
  ok: boolean;
  profile: NormalizedProfile | null;
  posts: NormalizedPost[];
  // TT-specific deep dive — empty for other platforms.
  topPostExtras: Array<{
    postId: string;
    transcript: string | null;
    topComments: Array<{ text: string; likeCount: number | null }>;
  }>;
  errors: string[];
}

export interface FullScrapePullResult {
  creatorId: Id<"creators">;
  startedAt: number;
  finishedAt: number;
  platforms: PerPlatformResult[];
}

const PlatformValidator = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("youtube"),
  v.literal("linkedin"),
  v.literal("x")
);

export const runFullScrapePull = internalAction({
  args: {
    creatorId: v.id("creators"),
    handles: v.array(
      v.object({
        platform: PlatformValidator,
        handle: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<FullScrapePullResult> => {
    const startedAt = Date.now();
    const client = new ScrapeCreatorsClient();
    const deps = { client };

    const platformResults = await Promise.all(
      args.handles.map(async (h): Promise<PerPlatformResult> => {
        const errors: string[] = [];
        let profile: NormalizedProfile | null = null;
        let posts: NormalizedPost[] = [];
        const topPostExtras: PerPlatformResult["topPostExtras"] = [];

        const reader = PLATFORM_READERS[h.platform];

        // Profile + posts in parallel — both reads are independent.
        const [profileSettled, postsSettled] = await Promise.allSettled([
          reader.profile(h.handle, deps),
          reader.lastPosts(h.handle, POSTS_LIMIT, deps),
        ]);

        if (profileSettled.status === "fulfilled") {
          profile = profileSettled.value;
          await ctx.runMutation(
            internal.integrations.scrapeCreators.cache.setCachedRow,
            {
              creatorId: args.creatorId,
              key: cacheKey(h.platform, "profile", h.handle),
              payload: profile.raw,
              ttlSec: TTL_PROFILE_SEC,
            }
          );
        } else {
          errors.push(`profile: ${stringifyErr(profileSettled.reason)}`);
        }

        if (postsSettled.status === "fulfilled") {
          posts = postsSettled.value;
          await ctx.runMutation(
            internal.integrations.scrapeCreators.cache.setCachedRow,
            {
              creatorId: args.creatorId,
              key: cacheKey(h.platform, "posts", h.handle),
              payload: posts.map((p) => p.raw),
              ttlSec: TTL_POSTS_SEC,
            }
          );
          await ctx.runMutation(
            internal.integrations.scrapeCreators.runFullScrapePull
              .upsertPostsAndMetricSnapshots,
            {
              creatorId: args.creatorId,
              platform: h.platform,
              handle: h.handle,
              posts,
              ts: startedAt,
            }
          );
        } else {
          errors.push(`posts: ${stringifyErr(postsSettled.reason)}`);
        }

        // TikTok-only deep dive on top N posts (Sprint 2 multimodal synth needs transcript +
        // comments). Other platforms expose this richness directly via their `posts` payload.
        if (h.platform === "tiktok" && posts.length > 0) {
          const topPosts = [...posts]
            .sort(
              (a, b) =>
                (b.metrics.viewCount ?? 0) - (a.metrics.viewCount ?? 0)
            )
            .slice(0, TIKTOK_DEEP_DIVE_TOP_N);
          const extrasSettled = await Promise.allSettled(
            topPosts.map(async (p) => {
              // The v1/v2 single-video endpoints key on the public share URL,
              // not the bare aweme id (production-bug fix landed alongside the
              // official scrapecreators-api skill install). Build the URL from
              // the loop's handle + the aweme id from `posts[i].postId`.
              const [tx, cm] = await Promise.allSettled([
                tiktok.transcript(h.handle, p.postId, deps),
                tiktok.comments(h.handle, p.postId, deps),
              ]);
              const transcript =
                tx.status === "fulfilled" ? tx.value.transcript : null;
              const topComments =
                cm.status === "fulfilled"
                  ? cm.value
                      .slice()
                      .sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0))
                      .slice(0, 10)
                      .map((c) => ({ text: c.text, likeCount: c.likeCount }))
                  : [];

              if (tx.status === "fulfilled" && transcript) {
                await ctx.runMutation(
                  internal.integrations.scrapeCreators.cache.setCachedRow,
                  {
                    creatorId: args.creatorId,
                    key: cacheKey("tiktok", "transcript", p.postId),
                    payload: { transcript },
                    ttlSec: TTL_TRANSCRIPT_SEC,
                  }
                );
              }
              if (cm.status === "fulfilled" && cm.value.length > 0) {
                await ctx.runMutation(
                  internal.integrations.scrapeCreators.cache.setCachedRow,
                  {
                    creatorId: args.creatorId,
                    key: cacheKey("tiktok", "comments", p.postId),
                    payload: cm.value,
                    ttlSec: TTL_COMMENTS_SEC,
                  }
                );
              }

              return {
                postId: p.postId,
                transcript,
                topComments,
              };
            })
          );
          for (const e of extrasSettled) {
            if (e.status === "fulfilled") {
              topPostExtras.push(e.value);
            } else {
              errors.push(`tiktok-deep-dive: ${stringifyErr(e.reason)}`);
            }
          }
        }

        // Persist `creatorHandles` row only when we got *something* useful (profile minimum).
        if (profile) {
          await ctx.runMutation(
            internal.integrations.scrapeCreators.runFullScrapePull.upsertHandle,
            {
              creatorId: args.creatorId,
              platform: h.platform,
              handle: h.handle,
              followerCount: profile.followerCount,
            }
          );
        }

        return {
          platform: h.platform,
          handle: h.handle,
          ok: profile !== null && errors.length === 0,
          profile,
          posts,
          topPostExtras,
          errors,
        };
      })
    );

    return {
      creatorId: args.creatorId,
      startedAt,
      finishedAt: Date.now(),
      platforms: platformResults,
    };
  },
});

/**
 * Idempotent upsert into `creatorHandles`. We key on (creatorId, platform) — a creator can
 * have at most one handle per platform per Maya. Re-pull replaces the prior row's metadata.
 */
export const upsertHandle = internalMutation({
  args: {
    creatorId: v.id("creators"),
    platform: PlatformValidator,
    handle: v.string(),
    followerCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("creatorHandles")
      .withIndex("by_creator_and_platform", (q) =>
        q.eq("creatorId", args.creatorId).eq("platform", args.platform)
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        handle: args.handle,
        verified: true,
        scrapedAt: now,
        followerCount: args.followerCount,
      });
      return existing._id;
    }
    return await ctx.db.insert("creatorHandles", {
      creatorId: args.creatorId,
      platform: args.platform,
      handle: args.handle,
      verified: true,
      scrapedAt: now,
      followerCount: args.followerCount,
    });
  },
});

export const upsertPostsAndMetricSnapshots = internalMutation({
  args: {
    creatorId: v.id("creators"),
    platform: PlatformValidator,
    handle: v.string(),
    posts: v.array(v.any()),
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    const posts = args.posts as NormalizedPost[];
    const ids: Id<"posts">[] = [];

    for (const post of posts) {
      const platformPostId = post.postId;
      if (!platformPostId) continue;

      const existing = (
        await ctx.db
          .query("posts")
          .withIndex("by_platform_and_post_id", (q) =>
            q.eq("platform", args.platform).eq("platformPostId", platformPostId)
          )
          .filter((q) => q.eq(q.field("creatorId"), args.creatorId))
          .collect()
      )[0];
      const mediaType =
        post.mediaType === "unknown" ? "text" : post.mediaType;
      const url =
        post.url ??
        (args.platform === "tiktok"
          ? tiktokVideoUrl(args.handle, platformPostId)
          : "");
      const postedAt = post.postedAt ?? args.ts;
      const postPatch = {
        caption: post.caption ?? "",
        url,
        mediaType,
        thumbnailUrl: post.thumbnailUrl ?? undefined,
        videoUrl: post.videoUrl ?? undefined,
        videoDurationSec: post.videoDurationSec ?? undefined,
        postedAt,
      };

      const postId =
        existing?._id ??
        (await ctx.db.insert("posts", {
          creatorId: args.creatorId,
          platform: args.platform,
          platformPostId,
          ...postPatch,
        }));

      if (existing) {
        await ctx.db.patch(existing._id, postPatch);
      }

      const viewCount = post.metrics.viewCount ?? undefined;
      const likeCount = post.metrics.likeCount ?? undefined;
      const commentCount = post.metrics.commentCount ?? undefined;
      const shareCount = post.metrics.shareCount ?? undefined;
      const saveCount = post.metrics.saveCount ?? undefined;
      const engagementTotal =
        (likeCount ?? 0) +
        (commentCount ?? 0) +
        (shareCount ?? 0) +
        (saveCount ?? 0);

      await ctx.db.insert("postMetrics", {
        creatorId: args.creatorId,
        postId,
        ts: args.ts,
        viewCount,
        likeCount,
        commentCount,
        shareCount,
        saveCount,
        engagementRate:
          typeof viewCount === "number" && viewCount > 0
            ? engagementTotal / viewCount
            : undefined,
      });
      ids.push(postId);
    }

    return { upserted: ids.length, postIds: ids };
  },
});

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
