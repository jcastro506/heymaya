/**
 * Sprint 2.5 — Approval-gated publish workflow.
 *
 * Flow:
 *   1. Subagent posts draft → gtmDraftedContent (approvalState: "draft")
 *   2. Voice-matcher pass (Sprint 2.4) flips to "pending_approval"
 *   3. Maya surfaces the draft to operator via Telegram with a question
 *      ("ship it? edit?")
 *   4. Operator replies via Telegram → telegramWebhookHttp routes the
 *      reply (Sprint 2.5 follow-up wiring; out of scope for this file)
 *   5. Maya POSTs /lc_gtm/publish_draft with the approved draftId
 *   6. publishApprovedDraft (this module) calls Composio to publish + updates
 *      the draft with providerPostId + publishedAt + approvalState
 *      ("published")
 *
 * Reddit/HN drafts skip this lane — they're tap-and-post per PLAYBOOK
 * § 3.5 (Reddit hostility to bots + voice authenticity requirement).
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  publishContent,
  type PublishPlatform,
} from "../integrations/composio/publishContent";
import { decrypt } from "../lib/encryption";

const SUPPORTED_PLATFORMS: PublishPlatform[] = ["x", "linkedin"];

/** Map gtmDraftedContent.platform → connectedAccounts.provider enum. */
function platformToProvider(
  platform: PublishPlatform
): "twitter" | "linkedin" {
  return platform === "x" ? "twitter" : "linkedin";
}

interface PublishOutcome {
  ok: boolean;
  providerPostId?: string;
  providerUrl?: string;
  statusDetail: string;
}

export const loadDraftAndConnection = internalQuery({
  args: { draftId: v.id("gtmDraftedContent") },
  handler: async (
    ctx,
    args
  ): Promise<{
    draft: Doc<"gtmDraftedContent">;
    accountId: Id<"creators">;
    agentId: Id<"gtmAgents">;
    encryptedComposioAccountId: string | null;
  } | null> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) return null;
    const creator = await ctx.db.get(draft.accountId);
    if (!creator) return null;

    // Per Sprint 5 + connectedAccounts schema, the per-provider Composio
    // account ID lives on connectedAccounts (encrypted). Lookup by
    // (creatorId, provider) where provider is mapped from the platform.
    const provider = platformToProvider(draft.platform as PublishPlatform);
    const conn = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_creator_and_provider", (q) =>
        q.eq("creatorId", creator._id).eq("provider", provider)
      )
      .first();
    return {
      draft,
      accountId: creator._id,
      agentId: draft.agentId,
      encryptedComposioAccountId:
        conn && conn.scopeStatus === "active" ? conn.composioAccountId : null,
    };
  },
});

export const markDraftPublished = internalMutation({
  args: {
    draftId: v.id("gtmDraftedContent"),
    providerPostId: v.string(),
    providerUrl: v.optional(v.string()),
    publishedAt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.draftId, {
      approvalState: "published",
      providerPostId: args.providerPostId,
      publishedAt: args.publishedAt,
      updatedAt: Date.now(),
    });
  },
});

export const markDraftPublishFailed = internalMutation({
  args: {
    draftId: v.id("gtmDraftedContent"),
    statusDetail: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    // Don't flip approvalState — leave at pending_approval so operator
    // can retry or rewrite. Record the failure in userFeedback so the
    // mission board can surface it.
    await ctx.db.patch(args.draftId, {
      userFeedback: `auto-publish failed: ${args.statusDetail}`,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Internal action invoked by /lc_gtm/publish_draft. Loads the draft,
 * routes by platform, calls Composio, persists results. Soft-fails so
 * the caller can decide retry / surface.
 */
export const publishApprovedDraft = internalAction({
  args: { draftId: v.id("gtmDraftedContent") },
  handler: async (ctx, args): Promise<PublishOutcome> => {
    const loaded = await ctx.runQuery(
      internal.gtmMaya.publishWorkflow.loadDraftAndConnection,
      { draftId: args.draftId }
    );
    if (!loaded) {
      return { ok: false, statusDetail: "draft_not_found" };
    }
    const { draft, encryptedComposioAccountId } = loaded;

    if (
      draft.approvalState !== "pending_approval" &&
      draft.approvalState !== "approved"
    ) {
      return {
        ok: false,
        statusDetail: `draft_not_approvable:${draft.approvalState}`,
      };
    }

    if (!SUPPORTED_PLATFORMS.includes(draft.platform as PublishPlatform)) {
      return {
        ok: false,
        statusDetail: `platform_not_auto_publishable:${draft.platform}`,
      };
    }

    if (!encryptedComposioAccountId) {
      return {
        ok: false,
        statusDetail: "composio_account_not_connected",
      };
    }

    let composioAccountId: string;
    try {
      composioAccountId = await decrypt(encryptedComposioAccountId);
    } catch (err) {
      return {
        ok: false,
        statusDetail: `composio_account_decrypt_failed:${(err as Error).message.slice(0, 200)}`,
      };
    }

    const result = await publishContent(draft.platform as PublishPlatform, {
      composioAccountId,
      text: draft.draftText,
      segments: draft.draftSegments,
    });

    if (!result.ok || !result.providerPostId) {
      await ctx.runMutation(
        internal.gtmMaya.publishWorkflow.markDraftPublishFailed,
        { draftId: args.draftId, statusDetail: result.statusDetail }
      );
      return result;
    }

    await ctx.runMutation(
      internal.gtmMaya.publishWorkflow.markDraftPublished,
      {
        draftId: args.draftId,
        providerPostId: result.providerPostId,
        providerUrl: result.providerUrl,
        publishedAt: Date.now(),
      }
    );
    return result;
  },
});
