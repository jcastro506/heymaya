/**
 * Posts screen queries — `/biz/posts` (Calendar tab + Library tab).
 *
 * Per Service Sprint Plan § 12.4:
 *
 * Calendar tab data:
 *   - GBP posts (drafted, pending, posted, rejected)
 *   - Drafted-pending-approval queue
 *   - Posted history with engagement metrics
 *   - "Generate post from job" — surfaced on the Jobs screen detail panel
 *     via a separate mutation; the Calendar shows the resulting drafts.
 *
 * Library tab data:
 *   - mediaAssets (delegates to existing `convex/mediaAssets/listAssets`)
 *
 * Plan-tier:
 *   - Starter: GBP-only + library read-only
 *   - Pro+:    multi-platform + rejuvenator suggestions
 *
 * Why we re-export `mediaAssets/listAssets` shape rather than calling
 * directly: the spec calls for cross-tenant safety on EVERY query in this
 * folder. The mediaAssets query takes a `businessId` arg from the client;
 * the wrapper here resolves the session-bound businessId server-side so
 * the UI never needs to know its own businessId.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { getCurrentBusinessSession } from "./_session";
import { planFeaturesService } from "../../planService";

const POST_STATUS = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("posted"),
  v.literal("rejected")
);

const ASSET_PLATFORM = v.union(
  v.literal("gbp"),
  v.literal("facebook"),
  v.literal("instagram"),
  v.literal("tiktok")
);

/**
 * List GBP posts for the Calendar tab. Filters: status, gbpLocationId,
 * scheduled-window. Returns most-recent first (by `_creationTime`).
 */
export const listPosts = query({
  args: {
    status: v.optional(POST_STATUS),
    gbpLocationId: v.optional(v.id("gbpLocations")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"gbpPosts">[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];

    const limit = clampLimit(args.limit);

    let q;
    if (args.status !== undefined) {
      const status = args.status;
      q = ctx.db
        .query("gbpPosts")
        .withIndex("by_business_and_status", (b) =>
          b.eq("businessId", session.business._id).eq("status", status)
        );
    } else {
      q = ctx.db
        .query("gbpPosts")
        .withIndex("by_business", (b) =>
          b.eq("businessId", session.business._id)
        );
    }

    const all = await q.order("desc").collect();

    return all
      .filter((p) =>
        args.gbpLocationId ? p.gbpLocationId === args.gbpLocationId : true
      )
      .slice(0, limit);
  },
});

/**
 * Pending-approval queue for the Calendar drafts strip. The Today screen
 * also reads this via `today.getPendingApprovals`; this surface is
 * Calendar-specific and includes recent drafts for the operator to review.
 */
export const getPendingPosts = query({
  args: {},
  handler: async (ctx): Promise<Doc<"gbpPosts">[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];
    return await ctx.db
      .query("gbpPosts")
      .withIndex("by_business_and_status", (q) =>
        q.eq("businessId", session.business._id).eq("status", "pending")
      )
      .order("desc")
      .take(50);
  },
});

/**
 * Recent posted-history with engagement metrics. The UI renders a small
 * grid of "what got published last 30d" so the operator can see what's
 * working.
 */
export const getPostedHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"gbpPosts">[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];
    return await ctx.db
      .query("gbpPosts")
      .withIndex("by_business_and_status", (q) =>
        q.eq("businessId", session.business._id).eq("status", "posted")
      )
      .order("desc")
      .take(clampLimit(args.limit));
  },
});

/**
 * Library-tab asset list. Wraps `mediaAssets.listAssets` with a
 * session-bound businessId so the client never supplies it. Returns the
 * same `AssetSummary` shape exported from `convex/mediaAssets/listAssets.ts`
 * (we re-fetch + re-shape rather than cross-call to keep the read path
 * trivially testable via convex-test).
 *
 * Plan-tier UX:
 *   - Starter: read-only library (the cataloger-write side gates at write
 *     layer; reads are universal so the operator can see what they have).
 *   - Pro+:    rejuvenator suggestions surfaced via `getRejuvenatorPicks`.
 */
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

export const listAssets = query({
  args: {
    serviceCategory: v.optional(v.string()),
    hasNotPostedTo: v.optional(ASSET_PLATFORM),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ rows: AssetSummary[]; canSeeRejuvenator: boolean }> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return { rows: [], canSeeRejuvenator: false };

    const features = planFeaturesService(session.business);
    const limit = clampLimit(args.limit);

    const rows = await ctx.db
      .query("mediaAssets")
      .withIndex("by_business_and_received_at", (q) =>
        q.eq("businessId", session.business._id)
      )
      .order("desc")
      .collect();

    const filtered = rows.filter((r) => {
      if (!args.includeArchived && r.archivedAt !== undefined) return false;
      if (
        args.serviceCategory &&
        r.catalog.serviceCategory !== args.serviceCategory
      ) {
        return false;
      }
      if (args.hasNotPostedTo) {
        const platform = args.hasNotPostedTo;
        if (r.usageHistory.some((u) => u.platform === platform)) return false;
      }
      return true;
    });

    return {
      rows: filtered.slice(0, limit).map((r) => ({
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
      canSeeRejuvenator: features.contentRejuvenation,
    };
  },
});

/**
 * Maya's "recommended for next post" picks — the rejuvenator output.
 * Returns a small set of unposted, fair-or-better quality assets. Pro+ only;
 * Starter callers get an empty array (the UI shows an upgrade pitch).
 */
export const getRejuvenatorPicks = query({
  args: {
    platform: v.optional(ASSET_PLATFORM),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<AssetSummary[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];
    const features = planFeaturesService(session.business);
    if (!features.contentRejuvenation) return [];

    const limit = clampLimit(args.limit ?? 6);
    const platform = args.platform ?? "gbp";

    const rows = await ctx.db
      .query("mediaAssets")
      .withIndex("by_business_and_received_at", (q) =>
        q.eq("businessId", session.business._id)
      )
      .order("desc")
      .collect();

    const picks = rows.filter((r) => {
      if (r.archivedAt !== undefined) return false;
      if (r.catalog.visualQuality === "poor") return false;
      if (r.usageHistory.some((u) => u.platform === platform)) return false;
      return true;
    });

    return picks.slice(0, limit).map((r) => ({
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
    }));
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (limit < 1) return 1;
  if (limit > 200) return 200;
  return Math.floor(limit);
}
