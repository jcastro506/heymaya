/**
 * mediaAssets cataloger queue — enqueue side.
 *
 * Channel-agnostic: any inbound-media surface (web upload, OpenClaw native
 * iMessage / WhatsApp attachment, future BlueBubbles bridge if we end up
 * needing one) calls `enqueueCatalogerWork` after writing the mediaAssets
 * row with the placeholder catalog. The queue is read-drain-side only;
 * idempotency is enforced at the producer (the mediaAssets row's
 * `contentHash` is unique per business, so the queue never doubles up).
 *
 * Cross-tenant safety: every queue row is tagged with `businessId`. The
 * processor reads `by_business_and_kind` so a 50-photo flood from Business
 * A can never cause Business B's work to wait behind it.
 *
 * Plan-tier gating: NOT enforced here. The cataloger is "integrity
 * infrastructure" per § 10.5 — every operator gets it because losing track
 * of a photo is worse than the per-business cost. Per-tier rate-limits
 * live in the consumer (processCatalogerQueue.ts).
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Catalog-placeholder values that signal "this asset has been ingested but
 * the cataloger has not run yet." The processor swaps these out with the
 * Gemini multimodal output when it succeeds. The Library tab reads these
 * and renders an "Uncataloged (queued)" badge so operators see no gap.
 */
export const UNCATALOGED_PLACEHOLDER = {
  primarySubject: "[uncataloged]",
  serviceCategory: "[uncataloged]",
  visualQuality: "fair" as const,
  framingNotes: "",
  suggestedUses: [] as string[],
  catalogedAt: 0,
  catalogModel: "[pending]",
  catalogCostUsd: 0,
};

/**
 * Internal mutation: enqueue cataloger work for a specific mediaAssets row.
 * Idempotent on (businessId, mediaAssetId) — if a queue row already exists
 * for this asset that hasn't been processed yet, no-op. This protects
 * against race conditions where the asset write + enqueue happen twice
 * (e.g. a debounced batch resolves twice in tests).
 *
 * Returns the queue row id (existing or newly inserted) for telemetry.
 */
export const enqueueCatalogerWork = internalMutation({
  args: {
    businessId: v.id("businesses"),
    mediaAssetId: v.id("mediaAssets"),
    /** Optional batch correlation id — same id for all photos in a 1s debounce window. */
    batchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mayaTaskQueue")
      .withIndex("by_business_and_kind", (q) =>
        q.eq("businessId", args.businessId).eq("kind", "asset-cataloger")
      )
      .filter((q) => q.eq(q.field("processedAt"), undefined))
      .collect();

    for (const row of existing) {
      const payload = row.payload as { mediaAssetId?: string };
      if (payload?.mediaAssetId === args.mediaAssetId) {
        return { queueRowId: row._id, alreadyEnqueued: true };
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
    return { queueRowId, alreadyEnqueued: false };
  },
});
