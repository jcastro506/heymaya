import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const mediaKindValidator = v.union(
  v.literal("image"),
  v.literal("video"),
  v.literal("audio"),
  v.literal("other")
);

const sourceValidator = v.union(
  v.literal("imessage"),
  v.literal("web_upload"),
  v.literal("openclaw_attachment"),
  v.literal("rendered_variant"),
  v.literal("seedance_reference")
);

const consentUsageValidator = v.union(
  v.literal("unknown"),
  v.literal("approved_for_this_request"),
  v.literal("approved_for_reuse"),
  v.literal("rejected")
);

const platformValidator = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("youtube"),
  v.literal("other")
);

const editStatusValidator = v.union(
  v.literal("drafting"),
  v.literal("queued_for_approval"),
  v.literal("rendering"),
  v.literal("rendered"),
  v.literal("ready_for_creator_draft"),
  v.literal("sent_to_creator"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("failed")
);

const visualQualityValidator = v.union(
  v.literal("unknown"),
  v.literal("poor"),
  v.literal("fair"),
  v.literal("good"),
  v.literal("excellent")
);

const tiktokHandoffStatusValidator = v.union(
  v.literal("not_started"),
  v.literal("sent_to_tiktok_inbox"),
  v.literal("download_sent"),
  v.literal("creator_posted"),
  v.literal("failed")
);

const placeholderCatalog = {
  primarySubject: "[uncataloged]",
  visualQuality: "unknown" as const,
  creatorRelevance: "Pending creator media catalog.",
  suggestedUses: [],
  catalogedAt: 0,
  catalogModel: "pending",
  catalogCostUsd: 0,
};

export const ingestCreatorMediaAsset = mutation({
  args: {
    storageId: v.optional(v.id("_storage")),
    storageUrl: v.optional(v.string()),
    storageBytes: v.number(),
    mimeType: v.string(),
    mediaKind: mediaKindValidator,
    source: sourceValidator,
    sourceMessageId: v.optional(v.string()),
    sourceChannel: v.optional(v.string()),
    sourcePhoneNumber: v.optional(v.string()),
    filename: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    contentHash: v.string(),
    consentText: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    return await ingestForCreator(ctx, {
      creatorId: creator._id,
      ...args,
    });
  },
});

export const ingestCreatorMediaAssetInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    storageId: v.optional(v.id("_storage")),
    storageUrl: v.optional(v.string()),
    storageBytes: v.number(),
    mimeType: v.string(),
    mediaKind: mediaKindValidator,
    source: sourceValidator,
    sourceMessageId: v.optional(v.string()),
    sourceChannel: v.optional(v.string()),
    sourcePhoneNumber: v.optional(v.string()),
    filename: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    contentHash: v.string(),
    consentText: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ingestForCreator(ctx, args);
  },
});

export const listMyMediaAssets = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const rows = await ctx.db
      .query("creatorMayaV0MediaAssets")
      .withIndex("by_creator_and_created", (q) =>
        q.eq("creatorId", creator._id)
      )
      .order("desc")
      .take(clampLimit(args.limit));

    const filtered = rows.filter(
      (row) => args.includeArchived || row.archivedAt === undefined
    );

    return await Promise.all(
      filtered.map(async (row) => ({
        ...row,
        storageUrl: await resolveCreatorAssetUrl(ctx, row),
      }))
    );
  },
});

export const listCreatorMediaAssetsInternal = internalQuery({
  args: {
    creatorId: v.id("creators"),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("creatorMayaV0MediaAssets")
      .withIndex("by_creator_and_created", (q) =>
        q.eq("creatorId", args.creatorId)
      )
      .order("desc")
      .take(clampLimit(args.limit));

    const filtered = rows.filter(
      (row) => args.includeArchived || row.archivedAt === undefined
    );

    return await Promise.all(
      filtered.map(async (row) => ({
        ...row,
        storageUrl: await resolveCreatorAssetUrl(ctx, row),
      }))
    );
  },
});

export const searchCreatorMediaAssetsInternal = internalQuery({
  args: {
    creatorId: v.id("creators"),
    queryText: v.optional(v.string()),
    mediaKind: v.optional(mediaKindValidator),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("creatorMayaV0MediaAssets")
      .withIndex("by_creator_and_created", (q) =>
        q.eq("creatorId", args.creatorId)
      )
      .order("desc")
      .take(250);

    const terms = (args.queryText ?? "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const filtered = rows.filter((row) => {
      if (!args.includeArchived && row.archivedAt !== undefined) return false;
      if (args.mediaKind && row.mediaKind !== args.mediaKind) return false;
      if (terms.length === 0) return true;
      const haystack = searchableAssetText(row);
      return terms.every((term) => haystack.includes(term));
    });

    return await Promise.all(
      filtered.slice(0, clampLimit(args.limit)).map(async (row) => ({
        ...row,
        storageUrl: await resolveCreatorAssetUrl(ctx, row),
      }))
    );
  },
});

export const getCreatorMediaAssetInternal = internalQuery({
  args: {
    creatorId: v.id("creators"),
    assetId: v.id("creatorMayaV0MediaAssets"),
  },
  handler: async (ctx, args) => {
    const row = await requireOwnedAsset(ctx, args.creatorId, args.assetId);
    return {
      ...row,
      storageUrl: await resolveCreatorAssetUrl(ctx, row),
    };
  },
});

export const validateRuntimeMediaIngestInternal = internalQuery({
  args: {
    creatorId: v.id("creators"),
    sourcePhoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("Creator not found.");
    }
    if (!args.sourcePhoneNumber) {
      return { ok: true, creatorId: creator._id };
    }
    const sourcePhoneNumber = args.sourcePhoneNumber;

    const activePairs = await ctx.db
      .query("pairedChannels")
      .withIndex("by_channel_and_phone", (q) =>
        q.eq("channel", "imessage").eq("phoneNumber", sourcePhoneNumber)
      )
      .collect();
    const activeForCreator = activePairs.some(
      (row) => row.creatorId === creator._id && row.status === "active"
    );
    if (!activeForCreator && creator.phoneNumber !== sourcePhoneNumber) {
      throw new Error("Creator phone number is not paired for iMessage.");
    }

    return { ok: true, creatorId: creator._id };
  },
});

export const catalogCreatorMediaAssetInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    assetId: v.id("creatorMayaV0MediaAssets"),
    catalog: v.object({
      primarySubject: v.string(),
      visualQuality: visualQualityValidator,
      creatorRelevance: v.string(),
      sceneSummary: v.optional(v.string()),
      styleNotes: v.optional(v.string()),
      safetyNotes: v.optional(v.string()),
      detectedText: v.optional(v.array(v.string())),
      transcript: v.optional(v.string()),
      retrievalTags: v.optional(v.array(v.string())),
      musicCue: v.optional(v.string()),
      suggestedUses: v.array(v.string()),
      captionDraft: v.optional(v.string()),
      catalogModel: v.string(),
      catalogCostUsd: v.number(),
      analysisVersion: v.optional(v.string()),
    }),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const asset = await requireOwnedAsset(ctx, args.creatorId, args.assetId);
    const now = args.nowMs ?? Date.now();
    await ctx.db.patch(asset._id, {
      catalog: {
        ...args.catalog,
        catalogedAt: now,
      },
      updatedAt: now,
    });
    return await ctx.db.get(asset._id);
  },
});

export const recordCreatorMediaConsent = mutation({
  args: {
    assetId: v.id("creatorMayaV0MediaAssets"),
    usage: consentUsageValidator,
    text: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const asset = await requireOwnedAsset(ctx, creator._id, args.assetId);
    const now = args.nowMs ?? Date.now();

    await ctx.db.patch(asset._id, {
      consent: {
        usage: args.usage,
        requestedAt: asset.consent.requestedAt,
        approvedAt:
          args.usage === "approved_for_reuse" ||
          args.usage === "approved_for_this_request"
            ? now
            : undefined,
        text: args.text,
      },
      updatedAt: now,
    });

    return await ctx.db.get(asset._id);
  },
});

export const createEditRequest = mutation({
  args: {
    sourceAssetIds: v.array(v.id("creatorMayaV0MediaAssets")),
    requestText: v.string(),
    targetPlatform: platformValidator,
    editPlan: v.optional(v.any()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    return await createEditRequestForCreator(ctx, {
      creatorId: creator._id,
      ...args,
    });
  },
});

export const createEditRequestInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    sourceAssetIds: v.array(v.id("creatorMayaV0MediaAssets")),
    requestText: v.string(),
    targetPlatform: platformValidator,
    editPlan: v.optional(v.any()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await createEditRequestForCreator(ctx, args);
  },
});

export const updateEditRequestStatusInternal = internalMutation({
  args: {
    editRequestId: v.id("creatorMayaV0EditRequests"),
    creatorId: v.id("creators"),
    status: editStatusValidator,
    renderedAssetId: v.optional(v.id("creatorMayaV0MediaAssets")),
    approvalMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.editRequestId);
    if (!row || row.creatorId !== args.creatorId) {
      throw new Error("Creator Maya edit request not found.");
    }
    if (args.renderedAssetId) {
      await requireOwnedAsset(ctx, args.creatorId, args.renderedAssetId);
    }

    await ctx.db.patch(row._id, {
      status: args.status,
      renderedAssetId: args.renderedAssetId,
      approvalMessageId: args.approvalMessageId,
      failureReason: args.failureReason,
      updatedAt: args.nowMs ?? Date.now(),
    });

    return await ctx.db.get(row._id);
  },
});

export const recordTikTokDraftHandoffInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    editRequestId: v.id("creatorMayaV0EditRequests"),
    mode: v.union(
      v.literal("download_link"),
      v.literal("tiktok_inbox_upload")
    ),
    caption: v.string(),
    suggestedMusic: v.array(v.string()),
    instructions: v.string(),
    tiktokPublishId: v.optional(v.string()),
    status: tiktokHandoffStatusValidator,
    failureReason: v.optional(v.string()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.editRequestId);
    if (!row || row.creatorId !== args.creatorId) {
      throw new Error("Creator Maya edit request not found.");
    }
    if (!row.renderedAssetId) {
      throw new Error("TikTok handoff requires a rendered asset.");
    }
    await requireOwnedAsset(ctx, args.creatorId, row.renderedAssetId);
    const now = args.nowMs ?? Date.now();
    const nextStatus =
      args.status === "failed"
        ? "failed"
        : args.status === "sent_to_tiktok_inbox" ||
            args.status === "download_sent"
          ? "sent_to_creator"
          : "ready_for_creator_draft";

    await ctx.db.patch(row._id, {
      status: nextStatus,
      tiktokHandoff: {
        mode: args.mode,
        caption: args.caption,
        suggestedMusic: args.suggestedMusic,
        instructions: args.instructions,
        tiktokPublishId: args.tiktokPublishId,
        status: args.status,
        sentAt:
          args.status === "sent_to_tiktok_inbox" ||
          args.status === "download_sent"
            ? now
            : undefined,
        failureReason: args.failureReason,
      },
      failureReason: args.status === "failed" ? args.failureReason : undefined,
      updatedAt: now,
    });

    return await ctx.db.get(row._id);
  },
});

async function ingestForCreator(
  ctx: MutationCtx,
  args: {
    creatorId: Id<"creators">;
    storageId?: Id<"_storage">;
    storageUrl?: string;
    storageBytes: number;
    mimeType: string;
    mediaKind: Doc<"creatorMayaV0MediaAssets">["mediaKind"];
    source: Doc<"creatorMayaV0MediaAssets">["source"];
    sourceMessageId?: string;
    sourceChannel?: string;
    sourcePhoneNumber?: string;
    filename?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    contentHash: string;
    consentText?: string;
    nowMs?: number;
  }
) {
  if (!args.storageId && !args.storageUrl) {
    throw new Error(
      "ingestCreatorMediaAsset requires at least one of storageId or storageUrl"
    );
  }

  const existing = await ctx.db
    .query("creatorMayaV0MediaAssets")
    .withIndex("by_creator_and_content_hash", (q) =>
      q.eq("creatorId", args.creatorId).eq("contentHash", args.contentHash)
    )
    .first();

  if (existing) {
    return { mediaAssetId: existing._id, deduped: true };
  }

  const now = args.nowMs ?? Date.now();
  const mediaAssetId = await ctx.db.insert("creatorMayaV0MediaAssets", {
    creatorId: args.creatorId,
    storageId: args.storageId,
    storageUrl: args.storageUrl,
    storageBytes: args.storageBytes,
    mimeType: args.mimeType,
    mediaKind: args.mediaKind,
    source: args.source,
    sourceMessageId: args.sourceMessageId,
    sourceChannel: args.sourceChannel,
    sourcePhoneNumber: args.sourcePhoneNumber,
    filename: args.filename,
    width: args.width,
    height: args.height,
    durationMs: args.durationMs,
    contentHash: args.contentHash,
    consent: {
      usage: "unknown",
      requestedAt: now,
      text: args.consentText,
    },
    catalog: placeholderCatalog,
    usageHistory: [],
    createdAt: now,
    updatedAt: now,
  });

  return { mediaAssetId, deduped: false };
}

async function createEditRequestForCreator(
  ctx: MutationCtx,
  args: {
    creatorId: Id<"creators">;
    sourceAssetIds: Array<Id<"creatorMayaV0MediaAssets">>;
    requestText: string;
    targetPlatform: Doc<"creatorMayaV0EditRequests">["targetPlatform"];
    editPlan?: unknown;
    nowMs?: number;
  }
) {
  if (args.sourceAssetIds.length === 0) {
    throw new Error("createEditRequest requires at least one source asset.");
  }
  for (const assetId of args.sourceAssetIds) {
    const asset = await requireOwnedAsset(ctx, args.creatorId, assetId);
    if (asset.consent.usage === "rejected") {
      throw new Error("Cannot edit media the creator rejected.");
    }
  }

  const now = args.nowMs ?? Date.now();
  const editRequestId = await ctx.db.insert("creatorMayaV0EditRequests", {
    creatorId: args.creatorId,
    sourceAssetIds: args.sourceAssetIds,
    requestText: args.requestText,
    targetPlatform: args.targetPlatform,
    status: args.editPlan ? "queued_for_approval" : "drafting",
    editPlan: args.editPlan,
    createdAt: now,
    updatedAt: now,
  });

  return { editRequestId };
}

async function requireCurrentCreator(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Creator Maya v0 sign-in required.");

  const creator = await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (!creator) throw new Error("Creator Maya v0 creator not found.");
  return creator;
}

async function requireOwnedAsset(
  ctx: QueryCtx | MutationCtx,
  creatorId: Id<"creators">,
  assetId: Id<"creatorMayaV0MediaAssets">
) {
  const asset = await ctx.db.get(assetId);
  if (!asset || asset.creatorId !== creatorId) {
    throw new Error("Creator Maya media asset not found.");
  }
  return asset;
}

async function resolveCreatorAssetUrl(
  ctx: { storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> } },
  row: Pick<Doc<"creatorMayaV0MediaAssets">, "storageId" | "storageUrl">
): Promise<string> {
  if (row.storageId) {
    const url = await ctx.storage.getUrl(row.storageId);
    if (url) return url;
  }
  return row.storageUrl ?? "";
}

function clampLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 50, 100));
}

function searchableAssetText(row: Doc<"creatorMayaV0MediaAssets">): string {
  return [
    row.filename,
    row.mimeType,
    row.mediaKind,
    row.source,
    row.catalog.primarySubject,
    row.catalog.creatorRelevance,
    row.catalog.sceneSummary,
    row.catalog.styleNotes,
    row.catalog.safetyNotes,
    row.catalog.transcript,
    row.catalog.musicCue,
    row.catalog.captionDraft,
    ...(row.catalog.detectedText ?? []),
    ...(row.catalog.retrievalTags ?? []),
    ...row.catalog.suggestedUses,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
