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
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ZernioClient } from "../integrations/zernio/client";
import {
  makeZernioContext,
  multiPlatformPost,
  getPostAnalytics,
} from "../integrations/zernio/endpoints";
import type {
  ZernioPostPlatform,
  ChannelPlatformData,
} from "../integrations/zernio/types";
import { planFeaturesGtm } from "./planGtm";
import { validateOutboundText, evaluateAutoPublishGate } from "./outboundFirewall";
import { decidePublishMode, composeAutoPostAction } from "./calendarWrite";
import { evaluateDedupGate } from "./engagementLedger";
import { autonomyGranted, resolvePublishMode } from "./autonomyPolicy";

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
    autonomousPosting: string | null;
    autonomousSince: number | null;
    confirmedPostCount: number | null;
  } | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    return {
      accountId: agent.accountId,
      gtmPlanJson: agent.gtmPlanJson ?? null,
      voiceProfileJson: agent.voiceProfileJson ?? null,
      zernioProfileId: agent.zernioProfileId ?? null,
      connectedAccountsJson: agent.connectedAccountsJson ?? null,
      autonomousPosting: agent.autonomousPosting ?? null,
      autonomousSince: agent.autonomousSince ?? null,
      confirmedPostCount: agent.confirmedPostCount ?? null,
    };
  },
});

/** W2 — bump the confirm_first_week ramp counter on a landed founder confirm. */
export const incrementConfirmedPostCount = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return;
    await ctx.db.patch(args.agentId, {
      confirmedPostCount: (agent.confirmedPostCount ?? 0) + 1,
    });
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
    // S6 — set true ONLY by the founder's explicit one-tap Telegram confirm.
    // It overrides the Reddit/TikTok manual-confirm FORCE (the human IS the
    // confirm) and skips the LLM safety/slop re-gate (the human approved the
    // exact content they previewed). Dedup + plan caps STILL apply — confirm is
    // not a license to double-post or exceed the plan.
    founderConfirmed: v.optional(v.boolean()),
    // S6.1 — media for the post (TikTok photo-mode slideshow / IG carousel).
    // Convex storage ids; resolved to URLs Zernio fetches + attached as
    // mediaItems. Required for media-gated channels (TikTok/IG/YouTube).
    mediaAssetIds: v.optional(v.array(v.string())),
    // API-depth S1 — the link to drop in the FIRST COMMENT instead of the
    // caption (LinkedIn/IG/YouTube). Keeping the URL out of the caption recovers
    // LinkedIn's ~40-50% link-in-post reach penalty. The caller decides which
    // channels get this; here we just attach it as platformSpecificData.
    firstComment: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PublishDirectResult> => {
    const content = args.content.trim();
    const channel = args.channel;

    // Hacker News is RESEARCH-ONLY — it has no posting API (Zernio can't reach it)
    // and auto-promo there gets makers flagged. judgeChannel already excludes HN
    // from BET/posting channels; this is the hard backstop so an HN post can NEVER
    // be routed to the publish path. A Show HN is prepped for the founder to post
    // themselves, never auto-published. (Enforces the research-only rule in code.)
    if (channel === "hn") {
      return {
        action: "failed",
        reasons: [
          "hn_research_only: Hacker News is research-only — no posting API exists. " +
            "Mine it for buyer language; prep a Show HN for the founder to post manually, never here.",
        ],
      };
    }

    const agentCtx = await ctx.runQuery(
      internal.gtmMaya.publishEngine.getAgentPublishContext,
      { agentId: args.agentId }
    );
    if (!agentCtx) return { action: "needs_confirm", reasons: ["agent context missing"] };

    // Gate 1: ban-safety. A founder one-tap confirm overrides the manual-confirm
    // FORCE on Reddit/TikTok (the human just consented behind a real preview —
    // which is also what satisfies TikTok's content_preview_confirmed flag).
    // Gate 1 + 1b: ban-safety floor, then the founder's autonomy preference
    // layered inside it. resolvePublishMode only ever TIGHTENS an otherwise-auto
    // channel (X/LI/IG/YT) to manual_confirm when autonomy hasn't been granted
    // (confirm_each, or confirm_first_week not yet graduated). Ban-safety
    // channels (reddit/tiktok) stay manual_confirm; a founder one-tap wins.
    const granted = autonomyGranted(
      agentCtx.autonomousPosting,
      agentCtx.autonomousSince,
      agentCtx.confirmedPostCount,
      Date.now()
    );
    const mode = resolvePublishMode(
      decidePublishMode(channel),
      args.founderConfirmed === true,
      granted
    );
    // Gate 2: plan allows auto-post (ALWAYS applies, even on confirm).
    const plan = planFeaturesGtm({ gtmPlanJson: agentCtx.gtmPlanJson });
    // Gate 3: the S2.7 three-verdict gate. Skipped on founderConfirmed — the
    // human approved the exact content they previewed, so re-running the
    // non-deterministic LLM safety check would only risk blocking what they
    // already okayed.
    let autoPub: { allowAutoPublish: boolean };
    if (args.founderConfirmed) {
      autoPub = { allowAutoPublish: true };
    } else {
      const slopResult = validateOutboundText(content);
      const safetyResult = await ctx.runAction(
        internal.gtmMaya.outboundFirewall.critiqueOutboundSafety,
        { text: content }
      );
      autoPub = evaluateAutoPublishGate({
        voiceProfileJson: agentCtx.voiceProfileJson,
        slopResult,
        safetyResult,
      });
    }
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
      // S6.1 — resolve the slideshow/carousel media to URLs Zernio can fetch.
      let mediaItems: Array<{ type: "image"; url: string }> | undefined;
      if (args.mediaAssetIds && args.mediaAssetIds.length > 0) {
        const urls: Array<{ type: "image"; url: string }> = [];
        for (const id of args.mediaAssetIds) {
          const u = await ctx.storage.getUrl(id as Id<"_storage">).catch(() => null);
          if (u) urls.push({ type: "image", url: u });
        }
        if (urls.length > 0) mediaItems = urls;
      }
      const firstComment = args.firstComment?.trim();
      const platformData: Partial<Record<ZernioPostPlatform, ChannelPlatformData>> | undefined =
        firstComment && firstComment.length > 0
          ? { [channel as ZernioPostPlatform]: { firstComment } }
          : undefined;
      const result = await multiPlatformPost(
        zctx,
        [{ platform: channel as ZernioPostPlatform, accountId: args.zernioAccountId }],
        { text: content, mediaItems, scheduleAt, timezone: args.timezone, platformData }
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
      // W2 — a founder one-tap confirm that lands counts toward
      // confirm_first_week graduation (3 confirmed posts OR 7 days).
      if (args.founderConfirmed) {
        await ctx.runMutation(
          internal.gtmMaya.publishEngine.incrementConfirmedPostCount,
          { agentId: args.agentId }
        );
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
