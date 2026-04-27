/**
 * Performance screen queries.
 *
 * The Performance screen at `app/(creator)/performance/page.tsx` renders a
 * filterable grid of every post Maya has pulled, with click-through to a
 * detail panel. Filters land server-side so we never return more than the
 * grid actually needs (mobile bandwidth is the constraint).
 *
 * Cross-tenant: every query resolves the signed-in creator first and filters
 * by `creatorId` on the by_creator(_and_*) indexes. No client-supplied
 * creatorId — always the Clerk identity → creators row → creatorId chain.
 *
 * Plan-tier: hookLibrary entries are produced by the post-publish hook
 * extractor (Pro+), but the *read* is unrestricted — a Starter creator who
 * later upgrades and downgrades would still see their historical hooks.
 * We don't generate new ones on Starter; we don't hide the old ones.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Same identity gate Today uses. Centralized here so a future audit can
 * grep `getCurrentCreator(` across the convex/ tree and find every
 * cross-tenant boundary in one shot.
 */
async function getCurrentCreator(
  ctx: QueryCtx
): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
}

const PLATFORM_LITERALS = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("youtube"),
  v.literal("linkedin"),
  v.literal("x")
);

const MEDIA_TYPE_LITERALS = v.union(
  v.literal("video"),
  v.literal("image"),
  v.literal("carousel"),
  v.literal("text")
);

/**
 * Paginated posts list. Filterable by platform / mediaType / day-of-week /
 * length (video-only short=<60s, long=>=60s — derived client-side from
 * thumbnailUrl/videoUrl + a heuristic, not stored on the row).
 *
 * NOTE: hookType is a client-side filter that matches against
 * `mayaAnnotation.hookPattern` — server-side we'd need a denormalized field
 * to index on it. For v0 the post volume per creator is bounded (~30 per
 * platform * 5 platforms = 150 max in the active window) so filtering in
 * the client is acceptable. Sprint 5 may revisit when we fold competitor
 * posts into the same surface.
 *
 * Pagination uses the standard Convex paginator with cursor opaque to the
 * client. Default page size 30 — covers a 2x desktop grid in one fetch.
 */
export const postsList = query({
  args: {
    platform: v.optional(PLATFORM_LITERALS),
    mediaType: v.optional(MEDIA_TYPE_LITERALS),
    /** Day-of-week filter, 0=Sunday … 6=Saturday in the creator's tz. */
    dayOfWeek: v.optional(v.number()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    // Sort by postedAt desc (most-recent first). Use the by_creator_and_postedAt
    // index so the order falls out for free + we don't fetch-then-sort.
    let q = ctx.db
      .query("posts")
      .withIndex("by_creator_and_postedAt", (qb) =>
        qb.eq("creatorId", creator._id)
      )
      .order("desc");

    // Filters that *can't* be applied at the index layer get filtered in
    // memory. Convex pagination keeps the page bounded so this is fine.
    if (args.platform || args.mediaType || args.dayOfWeek !== undefined) {
      q = q.filter((row) => {
        const conditions = [];
        if (args.platform) {
          conditions.push(row.eq(row.field("platform"), args.platform));
        }
        if (args.mediaType) {
          conditions.push(row.eq(row.field("mediaType"), args.mediaType));
        }
        // dayOfWeek requires post-fetch JS — Convex `.filter()` can't compute
        // a Date from a number. We post-filter below if specified.
        if (conditions.length === 0) return row.eq(true, true);
        if (conditions.length === 1) return conditions[0];
        return row.and(...conditions);
      });
    }

    const result = await q.paginate(args.paginationOpts);

    if (args.dayOfWeek !== undefined) {
      const target = args.dayOfWeek;
      const tz = creator.timezone;
      result.page = result.page.filter((p) => {
        const dow = dayOfWeekInTz(p.postedAt, tz);
        return dow === target;
      });
    }

    return result;
  },
});

/**
 * Detail panel for a single post. Returns:
 *   - the post row itself
 *   - all postMetrics rows for it, sorted ascending by ts (chart-ready)
 *   - a placeholder comments array (Sprint 5 wires up the real comment pull)
 *   - comparable posts (other posts on the same platform with the same
 *     `mayaAnnotation.hookPattern`, capped at 5)
 *
 * Cross-tenant: validates the post belongs to the signed-in creator before
 * returning — even though postId is supplied by the client, we never trust
 * it. A bad postId returns null cleanly.
 */
export const postDetail = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return null;

    const post = await ctx.db.get(args.postId);
    if (!post) return null;
    if (post.creatorId !== creator._id) return null;

    const metrics = await ctx.db
      .query("postMetrics")
      .withIndex("by_post_and_ts", (qb) => qb.eq("postId", post._id))
      .order("asc")
      .collect();

    // Comparable posts — same platform, same hookPattern (if Maya annotated
    // both). Cap at 5; the UI shows them as "you have N other posts with
    // the [HOOK] hook" with thumbnails. Skip if no annotation.
    let comparable: Doc<"posts">[] = [];
    if (post.mayaAnnotation) {
      const hookPattern = post.mayaAnnotation.hookPattern;
      const samePlatform = await ctx.db
        .query("posts")
        .withIndex("by_creator", (qb) => qb.eq("creatorId", creator._id))
        .filter((row) => row.eq(row.field("platform"), post.platform))
        .collect();
      comparable = samePlatform
        .filter(
          (p) =>
            p._id !== post._id &&
            p.mayaAnnotation?.hookPattern === hookPattern
        )
        .slice(0, 5);
    }

    return {
      post,
      metrics,
      comments: [] as Array<{
        author: string;
        text: string;
        likes: number;
        ts: number;
      }>,
      comparable,
    };
  },
});

/**
 * Hook library — paginated, sorted by `extractedAt` desc so the most recent
 * patterns surface first. Performance screen surfaces these as a chip-row
 * filter ("Try the POV hook," "Try the listicle hook," etc.).
 *
 * Empty list is the expected state for a brand-new creator before the first
 * post-publish reaction has fired (Pro+ behavior). UI handles empty state.
 */
export const hookLibrary = query({
  args: {
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    return await ctx.db
      .query("hookLibrary")
      .withIndex("by_creator", (qb) => qb.eq("creatorId", creator._id))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Day-of-week in a given IANA timezone, 0=Sunday … 6=Saturday.
 *
 * Why Intl.DateTimeFormat: it's the only JS-native way to compute a calendar
 * day in an arbitrary tz without a date library. The `weekday: 'short'`
 * outputs "Sun","Mon",… which we map back to 0..6.
 *
 * Falls back to UTC dayOfWeek if the timezone string is invalid (defensive
 * — Convex doesn't validate creators.timezone at write time).
 */
function dayOfWeekInTz(ts: number, tz: string): number {
  const SHORT_TO_NUM: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    });
    const part = fmt.format(new Date(ts));
    return SHORT_TO_NUM[part] ?? new Date(ts).getUTCDay();
  } catch {
    return new Date(ts).getUTCDay();
  }
}
