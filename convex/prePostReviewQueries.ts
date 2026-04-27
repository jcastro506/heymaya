/**
 * Sprint 3.5c — internal query helpers for `prePostReview.ts`.
 *
 * Split from the action so the action stays action-pure (actions can't
 * read the DB directly; they `runQuery` into one of these).
 *
 * Cross-tenant isolation: `loadScorerInputs` resolves the creator from
 * the caller-provided `clerkUserId` (the action passes the verified
 * Clerk identity subject) and filters every downstream read by that
 * `creatorId`. No `creatorId` argument is exposed to the public API.
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const PlatformValidator = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("youtube"),
  v.literal("linkedin"),
  v.literal("x")
);

export interface ScorerInputsResult {
  creatorId: string;
  timezone: string;
  creatorPicture: {
    topHooks: ReadonlyArray<{
      pattern: string;
      examplePostId: string;
      platform: string;
      avgPerformanceLift: number;
    }>;
    bottomHooks: ReadonlyArray<{
      pattern: string;
      examplePostId: string;
      platform: string;
    }>;
    postingCadence: {
      perPlatform: ReadonlyArray<{
        platform: string;
        bestDays: ReadonlyArray<string>;
        bestHoursLocal: ReadonlyArray<number>;
      }>;
    };
    audience: {
      interestTags: ReadonlyArray<string>;
      topGeos: ReadonlyArray<string>;
    };
    voiceFingerprint: string;
  };
  recentPosts: ReadonlyArray<{
    id: string;
    platform: string;
    caption: string;
    mediaType: string;
    postedAt: number;
    medianEngagementRate?: number;
    medianViews?: number;
  }>;
  hookLibrary: ReadonlyArray<{
    pattern: string;
    firstSeconds: string;
    whyItWorked: string;
    examplePostIds: ReadonlyArray<string>;
  }>;
}

const RECENT_POSTS_WINDOW_DAYS = 30;
const RECENT_POSTS_LIMIT = 30;
const HOOK_LIBRARY_LIMIT = 12;

/**
 * Load the inputs needed by `maya-pre-post-scorer` for the signed-in
 * creator. Returns null when no creator row exists (webhook lag or
 * unauth — the action returns the appropriate error).
 *
 * `creatorPicture` may be missing for very-new creators (pre-creator-
 * picture-synthesis); we return an empty-shape stub so the skill can
 * still produce a low-confidence score with the "data gap" note.
 */
export const loadScorerInputs = internalQuery({
  args: {
    clerkUserId: v.string(),
    platform: PlatformValidator,
  },
  handler: async (ctx, args): Promise<ScorerInputsResult | null> => {
    const creator: Doc<"creators"> | null = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!creator) return null;

    const picture: Doc<"creatorPicture"> | null = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .first();

    // Recent posts on the same platform — last 30 days, capped at 30.
    const since = Date.now() - RECENT_POSTS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const allRecent: Doc<"posts">[] = await ctx.db
      .query("posts")
      .withIndex("by_creator_and_postedAt", (q) =>
        q.eq("creatorId", creator._id).gte("postedAt", since)
      )
      .order("desc")
      .take(RECENT_POSTS_LIMIT);

    // Hydrate each post with a representative metric. We pull the latest
    // metric row per post (cheap — `by_post_and_ts` index, single .first()).
    const recentPosts = await Promise.all(
      allRecent.map(async (p) => {
        const latestMetric = await ctx.db
          .query("postMetrics")
          .withIndex("by_post_and_ts", (q) => q.eq("postId", p._id))
          .order("desc")
          .first();
        return {
          id: p._id as string,
          platform: p.platform as string,
          caption: p.caption,
          mediaType: p.mediaType as string,
          postedAt: p.postedAt,
          medianViews: latestMetric?.viewCount,
          medianEngagementRate: latestMetric?.engagementRate,
        };
      })
    );

    const library: Doc<"hookLibrary">[] = await ctx.db
      .query("hookLibrary")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .take(HOOK_LIBRARY_LIMIT);

    const hookLibrary = library.map((h) => ({
      pattern: h.pattern,
      firstSeconds: h.firstSeconds,
      whyItWorked: h.whyItWorked,
      examplePostIds: h.examplePostIds.map((id) => id as string),
    }));

    return {
      creatorId: creator._id as string,
      timezone: creator.timezone,
      creatorPicture: picture
        ? {
            topHooks: picture.topHooks,
            bottomHooks: picture.bottomHooks,
            postingCadence: picture.postingCadence,
            audience: {
              interestTags: picture.audience.interestTags,
              topGeos: picture.audience.topGeos,
            },
            voiceFingerprint: picture.voiceFingerprint,
          }
        : {
            topHooks: [],
            bottomHooks: [],
            postingCadence: { perPlatform: [] },
            audience: { interestTags: [], topGeos: [] },
            voiceFingerprint: "",
          },
      recentPosts,
      hookLibrary,
    };
  },
});
