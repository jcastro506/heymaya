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

/**
 * Sprint 0b: the storage half of this module (`getCached`, `setCached`,
 * `getCachedRow`, `setCachedRow`, `purgeCreator`) was backed by the
 * `scrapeCreatorsCache` table, which belonged to the deleted creator product.
 * Only the pure key/TTL helpers survive — `gtmMaya/researchQueryRunner` imports
 * `cacheKey` and `CacheKind` and nothing else.
 */
