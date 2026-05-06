/**
 * Convex-backed cache for ScrapeCreators responses.
 *
 * Cross-tenant safety: every read & write is scoped by `creatorId`. Two creators that happen
 * to lookup the same handle (e.g. both watch the same competitor) get separate cache rows —
 * we accept the storage overhead in exchange for a guarantee that creator A can never read
 * creator B's payloads.
 *
 * Cache key format: `sc:${platform}:${kind}:${handleOrId}` — kind = "profile" | "posts" |
 * "post" | "comments" | "transcript" | etc.
 *
 * TTL convention (seconds):
 *   - profile data → 6h (21_600)
 *   - post-list / post-metrics → 30min (1_800)
 *   - transcripts → 7d (604_800) — rarely change
 *
 * The cache is purely additive: stale rows are ignored on read, but only a sweeper
 * (future Sprint 7 work) will delete them. v0 accepts the bloat.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

export const TTL_PROFILE_SEC = 6 * 60 * 60;
export const TTL_POSTS_SEC = 30 * 60;
export const TTL_POST_DETAIL_SEC = 30 * 60;
export const TTL_COMMENTS_SEC = 30 * 60;
export const TTL_TRANSCRIPT_SEC = 7 * 24 * 60 * 60;
// Audience demographics drift slowly — 24h cache protects the 26-credit budget
// against duplicate same-day calls (e.g. cron + onboarding race). Following
// list is cheaper but larger payload; same TTL keeps the bulk pull idempotent.
export const TTL_AUDIENCE_SEC = 24 * 60 * 60;
export const TTL_FOLLOWING_SEC = 24 * 60 * 60;

export type CacheKind =
  | "profile"
  | "posts"
  | "post"
  | "comments"
  | "transcript"
  | "audience"
  | "following";

export function cacheKey(
  platform: string,
  kind: CacheKind,
  handleOrId: string
): string {
  return `sc:${platform}:${kind}:${handleOrId}`;
}

interface CacheRow {
  cacheKey: string;
  creatorId: Id<"creators">;
  payload: unknown;
  fetchedAt: number;
  ttlSec: number;
}

/**
 * Internal helper — read a cache row and return its payload only if not expired.
 * `now` is injectable for testability.
 */
export async function getCached<T = unknown>(
  ctx: Pick<QueryCtx, "db">,
  creatorId: Id<"creators">,
  key: string,
  now: number = Date.now()
): Promise<T | null> {
  const row = await ctx.db
    .query("scrapeCreatorsCache")
    .withIndex("by_creator_and_key", (q) =>
      q.eq("creatorId", creatorId).eq("cacheKey", key)
    )
    .unique();
  if (!row) return null;
  const ageMs = now - row.fetchedAt;
  if (ageMs > row.ttlSec * 1000) return null;
  return row.payload as T;
}

/**
 * Internal helper — upsert a cache row for (creatorId, key).
 */
export async function setCached(
  ctx: Pick<MutationCtx, "db">,
  creatorId: Id<"creators">,
  key: string,
  payload: unknown,
  ttlSec: number,
  now: number = Date.now()
): Promise<void> {
  const existing = await ctx.db
    .query("scrapeCreatorsCache")
    .withIndex("by_creator_and_key", (q) =>
      q.eq("creatorId", creatorId).eq("cacheKey", key)
    )
    .unique();

  const row: Omit<CacheRow, never> = {
    cacheKey: key,
    creatorId,
    payload,
    fetchedAt: now,
    ttlSec,
  };

  if (existing) {
    await ctx.db.patch(existing._id, row);
  } else {
    await ctx.db.insert("scrapeCreatorsCache", row);
  }
}

/* -------------------------------------------------------------------------- */
/* Convex internalQuery / internalMutation wrappers                            */
/* -------------------------------------------------------------------------- */

export const getCachedRow = internalQuery({
  args: {
    creatorId: v.id("creators"),
    key: v.string(),
  },
  handler: async (ctx, args) => {
    const payload = await getCached(ctx, args.creatorId, args.key);
    return payload === null ? null : { payload };
  },
});

export const setCachedRow = internalMutation({
  args: {
    creatorId: v.id("creators"),
    key: v.string(),
    payload: v.any(),
    ttlSec: v.number(),
  },
  handler: async (ctx, args) => {
    await setCached(ctx, args.creatorId, args.key, args.payload, args.ttlSec);
  },
});

/**
 * Delete every cache row for a creator. Used on creator-deletion / GDPR export.
 */
export const purgeCreator = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("scrapeCreatorsCache")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    for (const r of rows) {
      await ctx.db.delete(r._id);
    }
    return { deleted: rows.length };
  },
});
