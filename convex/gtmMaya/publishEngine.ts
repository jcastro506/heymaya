/**
 * Maya v2 (S3) — the auto-post publish engine.
 *
 * publishContentDirect is the SHARED gate+publish core used by BOTH paths:
 *   - the cron path (publishQueuedEvent, which renders a 'queued'
 *     gtmCalendarEvent then delegates), and
 *   - the agent path (the /lc_gtm/zernio_post route, when Maya posts directly,
 *     e.g. a pulse reply).
 * Both run the exact same gates via the same pure functions, so there is one
 * source of truth for "is it safe to auto-publish":
 *   - ban-safety (reddit/tiktok always manual-confirm — decidePublishMode)
 *   - plan (planFeaturesGtm.canAutoPost)
 *   - the S2.7 three-verdict gate (voice + slop + safety)
 *   - the S3 dedup ledger (never reply twice)
 * Any miss => action 'needs_confirm' (a one-tap founder card), NEVER an
 * auto-publish and NEVER a silent drop.
 *
 * confirmEventLanded is the 24h re-poll: 'posting' -> 'published' ONLY after
 * Zernio analytics confirm the post exists (never off the optimistic POST 200).
 *
 * The Zernio publish-response handling is [shape-unverified-live] until the
 * end-of-sprint live deploy; the gate path is unit-covered.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ZernioClient } from "../integrations/zernio/client";
import {
  makeZernioContext,
  multiPlatformPost,
  getPostAnalytics,
} from "../integrations/zernio/endpoints";
import type { ZernioPostPlatform } from "../integrations/zernio/types";
import { planFeaturesGtm } from "./planGtm";
import { validateOutboundText, evaluateAutoPublishGate } from "./outboundFirewall";
import { decidePublishMode, composeAutoPostAction } from "./calendarWrite";
import { evaluateDedupGate } from "./engagementLedger";

const CONFIRM_LANDED_DELAY_MS = 24 * 60 * 60 * 1000;

type LedgerPlatform =
  | "reddit" | "x" | "hn" | "linkedin" | "instagram" | "tiktok" | "youtube";

interface AutoPostJson {
  channel: string;
  zernioAccountId?: string;
  zernioPostId?: string;
  mode?: "auto" | "manual_confirm";
  scheduledForIso?: string;
  publishConfirmedAt?: number;
  platformPostUrl?: string;
  targetExternalId?: string;
  targetCommentId?: string;
  draftId?: string;
  lastError?: string;
}

function parseAutoPost(json: string | undefined | null): AutoPostJson | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as AutoPostJson;
    if (!o || typeof o.channel !== "string") return null;
    return o;
  } catch {
    return null;
  }
}

function zernioClient(): ZernioClient {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) throw new Error("ZERNIO_API_KEY is not configured");
  return new ZernioClient({ apiKey });
}

/** Per-agent context the publish gates need. */
export const getAgentPublishContext = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{
    accountId: Id<"creators">;
    gtmPlanJson: string | null;
    voiceProfileJson: string | null;
    zernioProfileId: string | null;
    connectedAccountsJson: string | null;
  } | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    return {
      accountId: agent.accountId,
      gtmPlanJson: agent.gtmPlanJson ?? null,
      voiceProfileJson: agent.voiceProfileJson ?? null,
      zernioProfileId: agent.zernioProfileId ?? null,
      connectedAccountsJson: agent.connectedAccountsJson ?? null,
    };
  },
});

export interface PublishDirectResult {
  action: "auto" | "needs_confirm" | "failed";
  reasons: string[];
  zernioPostId?: string;
  scheduledForIso?: string;
}

/**
 * The SHARED gate+publish core. Runs every gate and, if clear, publishes via
 * Zernio + stamps the dedup ledger (for replies). Does NOT touch calendar
 * rows — the caller maps the returned action onto whatever it owns.
 */
export const publishContentDirect = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    channel: v.string(),
    zernioAccountId: v.string(),
    content: v.string(),
    scheduleAtMs: v.optional(v.number()),
    timezone: v.optional(v.string()),
    targetExternalId: v.optional(v.string()),
    targetCommentId: v.optional(v.string()),
    intentionalFollowUp: v.optional(v.boolean()),
    draftId: v.optional(v.id("gtmDraftedContent")),
  },
  handler: async (ctx, args): Promise<PublishDirectResult> => {
    const content = args.content.trim();
    const channel = args.channel;

    const agentCtx = await ctx.runQuery(
      internal.gtmMaya.publishEngine.getAgentPublishContext,
      { agentId: args.agentId }
    );
    if (!agentCtx) return { action: "needs_confirm", reasons: ["agent context missing"] };

    // Gate 1: ban-safety.
    const mode = decidePublishMode(channel);
    // Gate 2: plan allows auto-post.
    const plan = planFeaturesGtm({ gtmPlanJson: agentCtx.gtmPlanJson });
    // Gate 3: the S2.7 three-verdict gate.
    const slopResult = validateOutboundText(content);
    const safetyResult = await ctx.runAction(
      internal.gtmMaya.outboundFirewall.critiqueOutboundSafety,
      { text: content }
    );
    const autoPub = evaluateAutoPublishGate({
      voiceProfileJson: agentCtx.voiceProfileJson,
      slopResult,
      safetyResult,
    });
    // Gate 4: dedup ledger (replies only).
    let dedupAllowed = true;
    if (args.targetExternalId) {
      const prior = await ctx.runQuery(
        internal.gtmMaya.engagementLedger.checkAlreadyEngaged,
        {
          agentId: args.agentId,
          platform: channel,
          externalId: args.targetExternalId,
          commentId: args.targetCommentId,
        }
      );
      dedupAllowed = evaluateDedupGate(prior, args.intentionalFollowUp === true).allow;
    }

    const decision = composeAutoPostAction({
      mode,
      planAllowsAutoPost: plan.canAutoPost,
      autoPublishAllowed: autoPub.allowAutoPublish,
      dedupAllowed,
      healthCanPost: true, // live health is the S5 reconnect-guardian's job
    });
    if (decision.action === "needs_confirm") {
      return { action: "needs_confirm", reasons: decision.reasons };
    }

    // Publish via Zernio.
    try {
      const zctx = makeZernioContext(zernioClient(), args.zernioAccountId);
      const scheduleAt =
        args.scheduleAtMs && args.scheduleAtMs > Date.now() + 60_000
          ? args.scheduleAtMs
          : undefined;
      const result = await multiPlatformPost(
        zctx,
        [{ platform: channel as ZernioPostPlatform, accountId: args.zernioAccountId }],
        { text: content, scheduleAt, timezone: args.timezone }
      );
      const row = result.perPlatform[0];
      const zernioPostId = row?.postId ?? null;
      if (!zernioPostId || row?.state === "failed") {
        return { action: "failed", reasons: [row?.error ?? "no postId returned"] };
      }
      // Stamp the dedup ledger on reply publishes.
      if (args.targetExternalId && args.draftId) {
        await ctx.runMutation(internal.gtmMaya.engagementLedger.recordEngagement, {
          accountId: agentCtx.accountId,
          agentId: args.agentId,
          draftId: args.draftId,
          platform: channel as LedgerPlatform,
          providerPostId: zernioPostId,
          targetExternalId: args.targetExternalId,
          targetCommentId: args.targetCommentId,
          intentionalFollowUp: args.intentionalFollowUp,
        });
      }
      return {
        action: "auto",
        reasons: [],
        zernioPostId,
        scheduledForIso: scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
      };
    } catch (err) {
      return { action: "failed", reasons: [(err as Error).message] };
    }
  },
});

/**
 * Cron path: render a 'queued' calendar event, run it through the shared gate,
 * and map the result onto the event's auto-post status.
 */
export const publishQueuedEvent = internalAction({
  args: { eventId: v.id("gtmCalendarEvents") },
  handler: async (
    ctx,
    args
  ): Promise<{ outcome: "auto" | "needs_confirm" | "skipped" | "failed" }> => {
    const event = await ctx.runQuery(
      internal.gtmMaya.calendarWrite.getCalendarEventForAgent,
      { eventId: args.eventId }
    );
    if (!event || event.status !== "queued") return { outcome: "skipped" };
    const ap = parseAutoPost(event.autoPostJson);
    if (!ap || !ap.zernioAccountId) {
      await mark(ctx, args.eventId, "needs_confirm", ap, ["missing channel/account in autoPostJson"]);
      return { outcome: "needs_confirm" };
    }
    const content = (event.draftText ?? event.title ?? "").trim();

    const result: PublishDirectResult = await ctx.runAction(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: event.agentId,
        channel: ap.channel,
        zernioAccountId: ap.zernioAccountId,
        content,
        scheduleAtMs: event.startsAtMs,
        timezone: event.timezone,
        targetExternalId: ap.targetExternalId,
        targetCommentId: ap.targetCommentId,
        draftId: ap.draftId ? (ap.draftId as Id<"gtmDraftedContent">) : undefined,
      }
    );

    if (result.action === "needs_confirm") {
      await mark(ctx, args.eventId, "needs_confirm", ap, result.reasons);
      return { outcome: "needs_confirm" };
    }
    if (result.action === "failed") {
      await mark(ctx, args.eventId, "failed", ap, result.reasons);
      return { outcome: "failed" };
    }
    await ctx.runMutation(internal.gtmMaya.calendarWrite.markCalendarEventAutoPost, {
      eventId: args.eventId,
      status: "posting",
      autoPostJson: JSON.stringify({
        ...ap,
        mode: "auto",
        zernioPostId: result.zernioPostId,
        scheduledForIso: result.scheduledForIso,
        lastError: undefined,
      }),
    });
    await ctx.scheduler.runAfter(
      CONFIRM_LANDED_DELAY_MS,
      internal.gtmMaya.publishEngine.confirmEventLanded,
      { eventId: args.eventId }
    );
    return { outcome: "auto" };
  },
});

export const confirmEventLanded = internalAction({
  args: { eventId: v.id("gtmCalendarEvents") },
  handler: async (ctx, args): Promise<{ confirmed: boolean }> => {
    const event = await ctx.runQuery(
      internal.gtmMaya.calendarWrite.getCalendarEventForAgent,
      { eventId: args.eventId }
    );
    if (!event || event.status !== "posting") return { confirmed: false };
    const ap = parseAutoPost(event.autoPostJson);
    if (!ap?.zernioPostId) {
      await mark(ctx, args.eventId, "failed", ap, ["no zernioPostId at confirm time"]);
      return { confirmed: false };
    }
    try {
      const analytics = await getPostAnalytics(zernioClient(), { postId: ap.zernioPostId });
      const landed = analytics !== null && analytics !== undefined; // [shape-unverified-live]
      if (landed) {
        await ctx.runMutation(internal.gtmMaya.calendarWrite.markCalendarEventAutoPost, {
          eventId: args.eventId,
          status: "published",
          autoPostJson: JSON.stringify({ ...ap, publishConfirmedAt: Date.now() }),
        });
        return { confirmed: true };
      }
      await mark(ctx, args.eventId, "failed", ap, ["analytics did not confirm the post landed"]);
      return { confirmed: false };
    } catch (err) {
      await mark(ctx, args.eventId, "failed", ap, [`confirm re-poll failed: ${(err as Error).message}`]);
      return { confirmed: false };
    }
  },
});

async function mark(
  ctx: { runMutation: (ref: any, args: any) => Promise<unknown> },
  eventId: Id<"gtmCalendarEvents">,
  status: "needs_confirm" | "failed",
  ap: AutoPostJson | null,
  reasons: string[]
): Promise<void> {
  await ctx.runMutation(internal.gtmMaya.calendarWrite.markCalendarEventAutoPost, {
    eventId,
    status,
    autoPostJson: JSON.stringify({ ...(ap ?? { channel: "unknown" }), lastError: reasons.join("; ") }),
  });
}
