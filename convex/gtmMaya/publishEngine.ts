/**
 * Maya v2 (S3) — the auto-post publish engine.
 *
 * publishQueuedEvent renders a 'queued' gtmCalendarEvent into a Zernio post,
 * but ONLY after every gate passes:
 *   - ban-safety (reddit/tiktok are always manual-confirm — decidePublishMode)
 *   - plan (planFeaturesGtm.canAutoPost)
 *   - the S2.7 three-verdict gate (voice + slop + safety)
 *   - the S3 dedup ledger (never reply twice)
 * Any miss => the row is downgraded to 'needs_confirm' (a one-tap founder
 * card), NEVER auto-published and NEVER silently dropped.
 *
 * confirmEventLanded is the 24h re-poll: it flips 'posting' -> 'published'
 * only after Zernio analytics confirm the post exists. We NEVER mark
 * 'published' off the optimistic POST 200 (Zernio can report success while a
 * platform strips the post).
 *
 * The Zernio publish-response handling is [shape-unverified-live] until the
 * end-of-sprint live deploy; the call path + gates are unit-covered.
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
import {
  decidePublishMode,
  composeAutoPostAction,
} from "./calendarWrite";
import { evaluateDedupGate } from "./engagementLedger";

const CONFIRM_LANDED_DELAY_MS = 24 * 60 * 60 * 1000;

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
  } | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    return {
      accountId: agent.accountId,
      gtmPlanJson: agent.gtmPlanJson ?? null,
      voiceProfileJson: agent.voiceProfileJson ?? null,
      zernioProfileId: agent.zernioProfileId ?? null,
    };
  },
});

export const publishQueuedEvent = internalAction({
  args: { eventId: v.id("gtmCalendarEvents") },
  handler: async (
    ctx,
    args
  ): Promise<{ outcome: "auto" | "needs_confirm" | "skipped" | "failed"; reasons?: string[] }> => {
    const event = await ctx.runQuery(
      internal.gtmMaya.calendarWrite.getCalendarEventForAgent,
      { eventId: args.eventId }
    );
    if (!event || event.status !== "queued") {
      return { outcome: "skipped" };
    }
    const ap = parseAutoPost(event.autoPostJson);
    if (!ap || !ap.zernioAccountId) {
      await markNeedsConfirm(ctx, args.eventId, ap, ["missing channel/account in autoPostJson"]);
      return { outcome: "needs_confirm", reasons: ["missing channel/account"] };
    }
    const channel = ap.channel;
    const content = (event.draftText ?? event.title ?? "").trim();

    const agentCtx = await ctx.runQuery(
      internal.gtmMaya.publishEngine.getAgentPublishContext,
      { agentId: event.agentId }
    );
    if (!agentCtx) {
      await markNeedsConfirm(ctx, args.eventId, ap, ["agent context missing"]);
      return { outcome: "needs_confirm", reasons: ["agent context missing"] };
    }

    // ── Gate 1: ban-safety ──────────────────────────────────────────────
    const mode = decidePublishMode(channel);

    // ── Gate 2: plan allows auto-post ───────────────────────────────────
    const plan = planFeaturesGtm({ gtmPlanJson: agentCtx.gtmPlanJson });
    const planAllowsAutoPost = plan.canAutoPost;

    // ── Gate 3: the S2.7 three-verdict gate (voice + slop + safety) ──────
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

    // ── Gate 4: dedup ledger (only when this is a reply to a thread) ─────
    let dedupAllowed = true;
    if (ap.targetExternalId) {
      const prior = await ctx.runQuery(
        internal.gtmMaya.engagementLedger.checkAlreadyEngaged,
        {
          agentId: event.agentId,
          platform: channel,
          externalId: ap.targetExternalId,
          commentId: ap.targetCommentId,
        }
      );
      dedupAllowed = evaluateDedupGate(prior, false).allow;
    }

    // Live health is the S5 reconnect-guardian's job; here we trust the
    // connected account and let a failed publish surface the error. [S5]
    const healthCanPost = true;

    const decision = composeAutoPostAction({
      mode,
      planAllowsAutoPost,
      autoPublishAllowed: autoPub.allowAutoPublish,
      dedupAllowed,
      healthCanPost,
    });

    if (decision.action === "needs_confirm") {
      await markNeedsConfirm(ctx, args.eventId, ap, decision.reasons);
      return { outcome: "needs_confirm", reasons: decision.reasons };
    }

    // ── Publish via Zernio ──────────────────────────────────────────────
    try {
      const zctx = makeZernioContext(zernioClient(), ap.zernioAccountId);
      const scheduleAt =
        event.startsAtMs && event.startsAtMs > Date.now() + 60_000
          ? event.startsAtMs
          : undefined; // else publishNow
      const result = await multiPlatformPost(
        zctx,
        [
          {
            platform: channel as ZernioPostPlatform,
            accountId: ap.zernioAccountId,
          },
        ],
        {
          text: content,
          scheduleAt,
          timezone: event.timezone,
        }
      );
      const row = result.perPlatform[0];
      const zernioPostId = row?.postId ?? null;
      if (!zernioPostId || row?.state === "failed") {
        await markFailed(ctx, args.eventId, ap, row?.error ?? "no postId returned");
        return { outcome: "failed", reasons: [row?.error ?? "no postId"] };
      }
      const nextAp: AutoPostJson = {
        ...ap,
        mode: "auto",
        zernioPostId,
        scheduledForIso: scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
        lastError: undefined,
      };
      await ctx.runMutation(internal.gtmMaya.calendarWrite.markCalendarEventAutoPost, {
        eventId: args.eventId,
        status: "posting",
        autoPostJson: JSON.stringify(nextAp),
      });

      // Stamp the dedup ledger if this was a reply.
      if (ap.targetExternalId && ap.draftId) {
        await ctx.runMutation(internal.gtmMaya.engagementLedger.recordEngagement, {
          accountId: agentCtx.accountId,
          agentId: event.agentId,
          draftId: ap.draftId as Id<"gtmDraftedContent">,
          platform: channel as
            | "reddit" | "x" | "hn" | "linkedin" | "instagram" | "tiktok" | "youtube",
          providerPostId: zernioPostId,
          targetExternalId: ap.targetExternalId,
          targetCommentId: ap.targetCommentId,
        });
      }

      // Schedule the 24h confirm-it-landed re-poll (the only thing that flips
      // to 'published' — never the optimistic POST 200).
      await ctx.scheduler.runAfter(
        CONFIRM_LANDED_DELAY_MS,
        internal.gtmMaya.publishEngine.confirmEventLanded,
        { eventId: args.eventId }
      );
      return { outcome: "auto" };
    } catch (err) {
      await markFailed(ctx, args.eventId, ap, (err as Error).message);
      return { outcome: "failed", reasons: [(err as Error).message] };
    }
  },
});

export const confirmEventLanded = internalAction({
  args: { eventId: v.id("gtmCalendarEvents") },
  handler: async (
    ctx,
    args
  ): Promise<{ confirmed: boolean }> => {
    const event = await ctx.runQuery(
      internal.gtmMaya.calendarWrite.getCalendarEventForAgent,
      { eventId: args.eventId }
    );
    if (!event || event.status !== "posting") return { confirmed: false };
    const ap = parseAutoPost(event.autoPostJson);
    if (!ap?.zernioPostId) {
      await markFailed(ctx, args.eventId, ap, "no zernioPostId at confirm time");
      return { confirmed: false };
    }
    try {
      const analytics = await getPostAnalytics(zernioClient(), {
        postId: ap.zernioPostId,
      });
      // If analytics returns for this post id, it landed. [shape-unverified-live]
      const landed = analytics !== null && analytics !== undefined;
      if (landed) {
        await ctx.runMutation(internal.gtmMaya.calendarWrite.markCalendarEventAutoPost, {
          eventId: args.eventId,
          status: "published",
          autoPostJson: JSON.stringify({ ...ap, publishConfirmedAt: Date.now() }),
        });
        return { confirmed: true };
      }
      await markFailed(ctx, args.eventId, ap, "analytics did not confirm the post landed");
      return { confirmed: false };
    } catch (err) {
      await markFailed(ctx, args.eventId, ap, `confirm re-poll failed: ${(err as Error).message}`);
      return { confirmed: false };
    }
  },
});

async function markNeedsConfirm(
  ctx: { runMutation: (ref: any, args: any) => Promise<unknown> },
  eventId: Id<"gtmCalendarEvents">,
  ap: AutoPostJson | null,
  reasons: string[]
): Promise<void> {
  const next: AutoPostJson = { ...(ap ?? { channel: "unknown" }), lastError: reasons.join("; ") };
  await ctx.runMutation(internal.gtmMaya.calendarWrite.markCalendarEventAutoPost, {
    eventId,
    status: "needs_confirm",
    autoPostJson: JSON.stringify(next),
  });
}

async function markFailed(
  ctx: { runMutation: (ref: any, args: any) => Promise<unknown> },
  eventId: Id<"gtmCalendarEvents">,
  ap: AutoPostJson | null,
  error: string
): Promise<void> {
  const next: AutoPostJson = { ...(ap ?? { channel: "unknown" }), lastError: error };
  await ctx.runMutation(internal.gtmMaya.calendarWrite.markCalendarEventAutoPost, {
    eventId,
    status: "failed",
    autoPostJson: JSON.stringify(next),
  });
}
