/**
 * mediaAssets ingest — channel-agnostic write surface.
 *
 * Why this exists separately from the channel-specific bridges:
 *   - The four contracts in § 10.5 (persistent storage, one-time catalog,
 *     retrievable, Maya-knows-what-it-is) are channel-agnostic. They have
 *     to hold whether the photo arrives via web upload, OpenClaw native
 *     iMessage, future BlueBubbles bridge, CRM photo import, or an
 *     operator paste-into-chat. This module is the single write surface
 *     all channels funnel through after they've stored bytes.
 *   - Hash-dedupe scoped per-businessId lives here. Channel-specific
 *     bridges call `ingestAsset` AFTER storing bytes (or after computing
 *     the hash and finding nothing in `findByContentHash`, in which case
 *     they can short-circuit the storage write entirely).
 *
 * The flow:
 *   1. Channel layer receives bytes + sniffs mime.
 *   2. Channel layer calls `findByContentHash({ businessId, contentHash })`
 *      to dedupe-check.
 *   3. If found: channel layer reuses the existing row + still optionally
 *      enqueues cataloger (no-op if cataloged).
 *   4. If not found: channel layer stores bytes via `ctx.storage.store(blob)`
 *      and calls `ingestAsset` with the returned `storageId` to insert the
 *      row + enqueue cataloger.
 *
 * Storage backend (v0): Convex built-in storage (`ctx.storage.*`). R2 was
 * the original target — its integration code stays parked at
 * `convex/integrations/r2/` for the post-beta migration when egress
 * overage on Convex Pro exceeds ~$50/mo (around 200-300 ops scale).
 *
 * Cross-tenant: `businessId` flows from authenticated context only. The
 * dedupe index is `by_business_and_content_hash` — same hash from a
 * different business does NOT collide.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { UNCATALOGED_PLACEHOLDER } from "./enqueueCatalog";

const SOURCE = v.union(
  v.literal("imessage"),
  v.literal("whatsapp"),
  v.literal("sms"),
  v.literal("web"),
  v.literal("crm-import")
);

/**
 * Check whether this business already has an asset with the given content
 * hash. Returns the existing row's id + whether its catalog is still the
 * placeholder (so the caller can decide whether to re-enqueue cataloger
 * work). Cross-tenant safe: indexed on `(businessId, contentHash)`.
 */
export const findByContentHash = internalQuery({
  args: {
    businessId: v.id("businesses"),
    contentHash: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    existingId: Id<"mediaAssets"> | null;
    catalogIsPlaceholder: boolean;
  }> => {
    const row = await ctx.db
      .query("mediaAssets")
      .withIndex("by_business_and_content_hash", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("contentHash", args.contentHash)
      )
      .first();
    if (!row) return { existingId: null, catalogIsPlaceholder: false };
    return {
      existingId: row._id,
      catalogIsPlaceholder: row.catalog.primarySubject === "[uncataloged]",
    };
  },
});

/**
 * Insert a fresh mediaAssets row + enqueue cataloger work in one mutation.
 * The placeholder catalog is set so the row is queryable immediately
 * (Library tab renders an "Uncataloged (queued)" badge while the
 * processor catches up).
 *
 * The byte-store happens BEFORE this mutation runs — Convex mutations are
 * deterministic + cannot make HTTP calls or call `ctx.storage.store()`,
 * so the channel layer (an action) is responsible for the storage write
 * and passes us the resulting storageId (v0 Convex backend) and/or
 * storageUrl (legacy/test or future R2) + storageBytes + mimeType +
 * contentHash. At least one of `storageId` or `storageUrl` must be
 * provided; v0 production paths pass `storageId`.
 */
export const ingestAsset = internalMutation({
  args: {
    businessId: v.id("businesses"),
    storageId: v.optional(v.id("_storage")),
    storageUrl: v.optional(v.string()),
    storageBytes: v.number(),
    mimeType: v.string(),
    contentHash: v.string(),
    source: SOURCE,
    receivedAt: v.number(),
    serviceJobId: v.optional(v.id("serviceJobs")),
    serviceCustomerId: v.optional(v.id("serviceCustomers")),
    /** Optional batch correlation id — same id for all photos in a debounce window. */
    batchId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    mediaAssetId: Id<"mediaAssets">;
    queueRowId: Id<"mayaTaskQueue">;
    deduped: boolean;
  }> => {
    // Defense-in-depth dedupe: even though channel layers are expected to
    // call findByContentHash first, the unique-on-(business, hash) check
    // is the second line of defense. If a row already exists, return its
    // id + whether the cataloger queue needs a re-enqueue.
    const existing = await ctx.db
      .query("mediaAssets")
      .withIndex("by_business_and_content_hash", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("contentHash", args.contentHash)
      )
      .first();

    if (existing) {
      // If catalog is still placeholder, re-enqueue (idempotent) so a
      // failed prior cataloger run gets another shot.
      const enqueueResult = await enqueueOnce(ctx, {
        businessId: args.businessId,
        mediaAssetId: existing._id,
        batchId: args.batchId,
        catalogIsPlaceholder:
          existing.catalog.primarySubject === "[uncataloged]",
      });
      return {
        mediaAssetId: existing._id,
        queueRowId: enqueueResult.queueRowId,
        deduped: true,
      };
    }

    if (!args.storageId && !args.storageUrl) {
      throw new Error(
        "ingestAsset requires at least one of storageId or storageUrl"
      );
    }

    const mediaAssetId: Id<"mediaAssets"> = await ctx.db.insert(
      "mediaAssets",
      {
        businessId: args.businessId,
        storageId: args.storageId,
        storageUrl: args.storageUrl,
        storageBytes: args.storageBytes,
        mimeType: args.mimeType,
        source: args.source,
        receivedAt: args.receivedAt,
        serviceJobId: args.serviceJobId,
        serviceCustomerId: args.serviceCustomerId,
        contentHash: args.contentHash,
        catalog: { ...UNCATALOGED_PLACEHOLDER, suggestedUses: [] },
        usageHistory: [],
      }
    );

    const enqueueResult = await enqueueOnce(ctx, {
      businessId: args.businessId,
      mediaAssetId,
      batchId: args.batchId,
      catalogIsPlaceholder: true,
    });

    return {
      mediaAssetId,
      queueRowId: enqueueResult.queueRowId,
      deduped: false,
    };
  },
});

/**
 * Insert a queue row iff:
 *   - the asset's catalog is still the placeholder (catalog needed)
 *   - AND no unprocessed cataloger row already references this asset
 * Otherwise return the existing queue row id.
 *
 * Cannot use `internal.mediaAssets.enqueueCatalog.enqueueCatalogerWork`
 * directly from another mutation in the same module path because Convex
 * doesn't allow mutation→mutation calls. Instead this is a thin local
 * helper that does the same check inline.
 */
async function enqueueOnce(
  ctx: { db: import("../_generated/server").MutationCtx["db"] },
  args: {
    businessId: Id<"businesses">;
    mediaAssetId: Id<"mediaAssets">;
    batchId?: string;
    catalogIsPlaceholder: boolean;
  }
): Promise<{ queueRowId: Id<"mayaTaskQueue"> }> {
  if (!args.catalogIsPlaceholder) {
    // Catalog is already populated — no need to enqueue. We still need to
    // return SOME queue row id for telemetry; insert an "already-processed"
    // audit row so the operator can see the deduped ingest.
    const auditRowId: Id<"mayaTaskQueue"> = await ctx.db.insert(
      "mayaTaskQueue",
      {
        businessId: args.businessId,
        kind: "asset-cataloger",
        payload: {
          mediaAssetId: args.mediaAssetId,
          batchId: args.batchId,
          deduped: true,
        },
        source: "manual",
        enqueuedAt: Date.now(),
        processedAt: Date.now(),
        attemptCount: 0,
      }
    );
    return { queueRowId: auditRowId };
  }

  const existingUnprocessed = await ctx.db
    .query("mayaTaskQueue")
    .withIndex("by_business_and_kind", (q) =>
      q.eq("businessId", args.businessId).eq("kind", "asset-cataloger")
    )
    .filter((q) => q.eq(q.field("processedAt"), undefined))
    .collect();

  for (const row of existingUnprocessed) {
    const payload = row.payload as { mediaAssetId?: string };
    if (payload?.mediaAssetId === args.mediaAssetId) {
      return { queueRowId: row._id };
    }
  }

  const queueRowId: Id<"mayaTaskQueue"> = await ctx.db.insert(
    "mayaTaskQueue",
    {
      businessId: args.businessId,
      kind: "asset-cataloger",
      payload: {
        mediaAssetId: args.mediaAssetId,
        batchId: args.batchId,
      },
      source: "manual",
      enqueuedAt: Date.now(),
      attemptCount: 0,
    }
  );
  return { queueRowId };
}

// Suppress unused-import warnings on `internal` — kept for consistency with
// the rest of the codebase + future direct-API calls.
void internal;
