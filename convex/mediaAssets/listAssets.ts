/**
 * mediaAssets read API — listAssets / getAsset / archiveAsset / recordPostUsage.
 *
 * Channel-agnostic. Used by:
 *   - `agents/skills/maya-service-content-rejuvenator/script.ts` (parallel
 *     agent owns the skill body) — `listAssets` is the data feed for
 *     "what's good in the library that hasn't been posted yet?"
 *   - Library tab UI (Sprint 5) — same query, different filter set.
 *
 * Cross-tenant: every entry point requires `businessId` and reads via
 * `by_business` index. There is no path that can return another business's
 * assets — the index is the gate.
 *
 * Lifecycle:
 *   - `archiveAsset` is a soft-delete; sets `archivedAt` on the row. The
 *     `archived: false` filter in `listAssets` excludes archived rows by
 *     default. Operator-archive is sacred — re-cataloging an archived
 *     asset must be operator-confirmed (handled at the rejuvenator skill
 *     layer; not here).
 *   - `recordPostUsage` appends a `usageHistory` entry. Idempotent on
 *     `(platform, postId)` — the rejuvenator may call this on a Zernio
 *     webhook that re-fires after a transient error; we never duplicate.
 */

import { v } from "convex/values";
import { internalQuery, mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* listAssets                                                                  */
/* -------------------------------------------------------------------------- */

const PLATFORM = v.union(
  v.literal("gbp"),
  v.literal("facebook"),
  v.literal("instagram"),
  v.literal("tiktok")
);

export interface ListAssetsArgs {
  businessId: Id<"businesses">;
  /** Filter by `catalog.serviceCategory`. */
  serviceCategory?: string;
  /**
   * Return only assets that have NOT been posted to the given platform.
   * Used by the rejuvenator: "give me good HVAC photos that haven't hit
   * GBP yet."
   */
  hasNotPostedTo?: "gbp" | "facebook" | "instagram" | "tiktok";
  /** When true, INCLUDE archived rows; default false. */
  includeArchived?: boolean;
  /** When true, only return rows whose catalog is fully populated. */
  catalogedOnly?: boolean;
  limit?: number;
  /** `_creationTime` cursor for pagination — pass back the last row's value. */
  cursorMs?: number;
}

export type AssetSummary = {
  _id: Id<"mediaAssets">;
  storageUrl: string;
  storageBytes: number;
  mimeType: string;
  source: Doc<"mediaAssets">["source"];
  receivedAt: number;
  serviceJobId: Id<"serviceJobs"> | undefined;
  serviceCustomerId: Id<"serviceCustomers"> | undefined;
  catalog: Doc<"mediaAssets">["catalog"];
  usageHistory: Doc<"mediaAssets">["usageHistory"];
  archivedAt: number | undefined;
  contentHash: string | undefined;
};

/**
 * List assets for a business with optional filters. Public query — UI
 * consumes via Convex subscription.
 */
export const listAssets = query({
  args: {
    businessId: v.id("businesses"),
    serviceCategory: v.optional(v.string()),
    hasNotPostedTo: v.optional(PLATFORM),
    includeArchived: v.optional(v.boolean()),
    catalogedOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursorMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ rows: AssetSummary[]; nextCursorMs: number | null }> => {
    const limit = clampLimit(args.limit);
    const rows = await ctx.db
      .query("mediaAssets")
      .withIndex("by_business_and_received_at", (q) =>
        q.eq("businessId", args.businessId)
      )
      .order("desc")
      .collect();

    const filtered = rows.filter((r) => {
      if (!args.includeArchived && r.archivedAt !== undefined) return false;
      if (
        args.serviceCategory &&
        r.catalog.serviceCategory !== args.serviceCategory
      )
        return false;
      if (
        args.catalogedOnly &&
        r.catalog.primarySubject === "[uncataloged]"
      )
        return false;
      if (args.hasNotPostedTo) {
        const platform = args.hasNotPostedTo;
        if (r.usageHistory.some((u) => u.platform === platform)) return false;
      }
      if (args.cursorMs !== undefined && r._creationTime >= args.cursorMs) {
        return false;
      }
      return true;
    });

    const sliced = filtered.slice(0, limit);
    const nextCursorMs =
      sliced.length === limit
        ? sliced[sliced.length - 1]._creationTime
        : null;

    return {
      rows: sliced.map((r) => ({
        _id: r._id,
        storageUrl: r.storageUrl,
        storageBytes: r.storageBytes,
        mimeType: r.mimeType,
        source: r.source,
        receivedAt: r.receivedAt,
        serviceJobId: r.serviceJobId,
        serviceCustomerId: r.serviceCustomerId,
        catalog: r.catalog,
        usageHistory: r.usageHistory,
        archivedAt: r.archivedAt,
        contentHash: r.contentHash,
      })),
      nextCursorMs,
    };
  },
});

/**
 * Internal twin — used by the rejuvenator skill via internal API.
 * Identical surface, returns the same row type.
 */
export const listAssetsInternal = internalQuery({
  args: {
    businessId: v.id("businesses"),
    serviceCategory: v.optional(v.string()),
    hasNotPostedTo: v.optional(PLATFORM),
    includeArchived: v.optional(v.boolean()),
    catalogedOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursorMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ rows: AssetSummary[]; nextCursorMs: number | null }> => {
    const limit = clampLimit(args.limit);
    const rows = await ctx.db
      .query("mediaAssets")
      .withIndex("by_business_and_received_at", (q) =>
        q.eq("businessId", args.businessId)
      )
      .order("desc")
      .collect();

    const filtered = rows.filter((r) => {
      if (!args.includeArchived && r.archivedAt !== undefined) return false;
      if (
        args.serviceCategory &&
        r.catalog.serviceCategory !== args.serviceCategory
      )
        return false;
      if (
        args.catalogedOnly &&
        r.catalog.primarySubject === "[uncataloged]"
      )
        return false;
      if (args.hasNotPostedTo) {
        const platform = args.hasNotPostedTo;
        if (r.usageHistory.some((u) => u.platform === platform)) return false;
      }
      if (args.cursorMs !== undefined && r._creationTime >= args.cursorMs) {
        return false;
      }
      return true;
    });

    const sliced = filtered.slice(0, limit);
    const nextCursorMs =
      sliced.length === limit
        ? sliced[sliced.length - 1]._creationTime
        : null;

    return {
      rows: sliced.map((r) => ({
        _id: r._id,
        storageUrl: r.storageUrl,
        storageBytes: r.storageBytes,
        mimeType: r.mimeType,
        source: r.source,
        receivedAt: r.receivedAt,
        serviceJobId: r.serviceJobId,
        serviceCustomerId: r.serviceCustomerId,
        catalog: r.catalog,
        usageHistory: r.usageHistory,
        archivedAt: r.archivedAt,
        contentHash: r.contentHash,
      })),
      nextCursorMs,
    };
  },
});

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (limit < 1) return 1;
  if (limit > 200) return 200;
  return Math.floor(limit);
}

/* -------------------------------------------------------------------------- */
/* getAsset                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Single-row read with cross-tenant guard. Returns null if the asset
 * doesn't exist OR if the requested businessId does not own it. The null
 * vs error distinction matters: tests for cross-tenant violations assert
 * null (not throw) so a UI accidentally querying the wrong businessId
 * doesn't blow up — it just sees "no asset."
 */
export const getAsset = query({
  args: {
    businessId: v.id("businesses"),
    assetId: v.id("mediaAssets"),
  },
  handler: async (ctx, args): Promise<AssetSummary | null> => {
    const row = await ctx.db.get(args.assetId);
    if (!row) return null;
    if (row.businessId !== args.businessId) return null;
    return {
      _id: row._id,
      storageUrl: row.storageUrl,
      storageBytes: row.storageBytes,
      mimeType: row.mimeType,
      source: row.source,
      receivedAt: row.receivedAt,
      serviceJobId: row.serviceJobId,
      serviceCustomerId: row.serviceCustomerId,
      catalog: row.catalog,
      usageHistory: row.usageHistory,
      archivedAt: row.archivedAt,
      contentHash: row.contentHash,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* archiveAsset                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Soft-delete. Cross-tenant guard: throws if the asset's businessId doesn't
 * match the caller's. Idempotent: calling on an already-archived row
 * leaves `archivedAt` at its first-set value (so audit trail is stable).
 */
export const archiveAsset = mutation({
  args: {
    businessId: v.id("businesses"),
    assetId: v.id("mediaAssets"),
  },
  handler: async (ctx, args): Promise<{ archived: true }> => {
    const row = await ctx.db.get(args.assetId);
    if (!row) {
      throw new Error("archiveAsset: asset not found");
    }
    if (row.businessId !== args.businessId) {
      throw new Error("archiveAsset: cross-tenant violation");
    }
    if (row.archivedAt === undefined) {
      await ctx.db.patch(args.assetId, { archivedAt: Date.now() });
    }
    return { archived: true };
  },
});

/* -------------------------------------------------------------------------- */
/* recordPostUsage                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Append a usage record. Idempotent on (platform, postId): if a record
 * with the same (platform, postId) already exists, no-op. If postId is
 * undefined we cannot dedupe, so the record is appended as-is — callers
 * SHOULD pass a postId whenever the platform returns one.
 */
export const recordPostUsage = mutation({
  args: {
    businessId: v.id("businesses"),
    assetId: v.id("mediaAssets"),
    platform: PLATFORM,
    postId: v.optional(v.string()),
    postedAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ appended: boolean }> => {
    const row = await ctx.db.get(args.assetId);
    if (!row) throw new Error("recordPostUsage: asset not found");
    if (row.businessId !== args.businessId) {
      throw new Error("recordPostUsage: cross-tenant violation");
    }
    if (args.postId !== undefined) {
      const dup = row.usageHistory.find(
        (u) => u.platform === args.platform && u.postId === args.postId
      );
      if (dup) return { appended: false };
    }
    const next = [
      ...row.usageHistory,
      {
        platform: args.platform,
        postId: args.postId,
        postedAt: args.postedAt ?? Date.now(),
      },
    ];
    await ctx.db.patch(args.assetId, { usageHistory: next });
    return { appended: true };
  },
});
