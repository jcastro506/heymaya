import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const PLATFORM = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("linkedin"),
  v.literal("tiktok")
);

export function parseApprovalMessage(message: string): {
  approved: boolean;
  edit?: string;
} {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "approve" || lower === "approved" || lower === "yes") {
    return { approved: true };
  }
  if (lower.startsWith("approve:") || lower.startsWith("approved:")) {
    return {
      approved: true,
      edit: trimmed.slice(trimmed.indexOf(":") + 1).trim(),
    };
  }
  return { approved: false };
}

export const createDraft = mutation({
  args: {
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    platform: PLATFORM,
    body: v.string(),
    evidenceCardIds: v.array(v.id("gtmEvidenceCards")),
  },
  handler: async (ctx, args): Promise<Id<"gtmContentDrafts">> => {
    const creator = await requireGtmCreator(ctx);
    await assertEvidence(ctx, creator._id, args.evidenceCardIds);
    const now = Date.now();
    return await ctx.db.insert("gtmContentDrafts", {
      accountId: creator._id,
      researchJobId: args.researchJobId,
      platform: args.platform,
      status: "drafted",
      body: args.body,
      evidenceCardIds: args.evidenceCardIds,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const approveDraft = mutation({
  args: {
    draftId: v.id("gtmContentDrafts"),
    message: v.string(),
    approvalMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ approved: boolean; finalBody?: string }> => {
    const creator = await requireGtmCreator(ctx);
    const draft = await requireDraft(ctx, creator._id, args.draftId);
    const parsed = parseApprovalMessage(args.message);
    if (!parsed.approved) return { approved: false };
    const now = Date.now();
    const finalBody = parsed.edit || draft.body;
    await ctx.db.patch(draft._id, {
      status: "approved",
      finalBody,
      approvalMessageId: args.approvalMessageId,
      approvedAt: now,
      updatedAt: now,
    });
    return { approved: true, finalBody };
  },
});

export const markPublished = mutation({
  args: {
    draftId: v.id("gtmContentDrafts"),
    externalPostId: v.string(),
    publishedUrl: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const creator = await requireGtmCreator(ctx);
    const draft = await requireDraft(ctx, creator._id, args.draftId);
    if (draft.status !== "approved") {
      throw new Error("cannot publish without approval");
    }
    const now = Date.now();
    await ctx.db.patch(draft._id, {
      status: "published",
      externalPostId: args.externalPostId,
      publishedUrl: args.publishedUrl,
      publishedAt: now,
      updatedAt: now,
    });
  },
});

export const markPublishFailed = mutation({
  args: {
    draftId: v.id("gtmContentDrafts"),
    failureReason: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const creator = await requireGtmCreator(ctx);
    const draft = await requireDraft(ctx, creator._id, args.draftId);
    const now = Date.now();
    await ctx.db.patch(draft._id, {
      status: "failed",
      failureReason: args.failureReason,
      updatedAt: now,
    });
  },
});

async function requireGtmCreator(ctx: MutationCtx): Promise<Doc<"creators">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("signed-in user required");
  const creator = await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (!creator || creator.accountType !== "gtm-agent") {
    throw new Error("GTM account not found");
  }
  return creator;
}

async function requireDraft(
  ctx: MutationCtx,
  accountId: Id<"creators">,
  draftId: Id<"gtmContentDrafts">
): Promise<Doc<"gtmContentDrafts">> {
  const draft = await ctx.db.get(draftId);
  if (!draft || draft.accountId !== accountId) {
    throw new Error("draft does not belong to this account");
  }
  return draft;
}

async function assertEvidence(
  ctx: MutationCtx,
  accountId: Id<"creators">,
  evidenceCardIds: Id<"gtmEvidenceCards">[]
): Promise<void> {
  for (const id of evidenceCardIds) {
    const card = await ctx.db.get(id);
    if (!card || card.accountId !== accountId) {
      throw new Error("draft evidence does not belong to this account");
    }
  }
}
