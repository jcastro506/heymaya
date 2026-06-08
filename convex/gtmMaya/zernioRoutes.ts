/**
 * Maya v2 (S3) — agent-facing Zernio HTTP routes.
 *
 *   POST /lc_gtm/zernio_post        — Maya publishes content directly (e.g. a
 *                                     pulse reply). Runs the SAME shared gate
 *                                     as the cron path (publishContentDirect).
 *   GET  /lc_gtm/check_already_engaged — the cheap pre-draft dedup check.
 *
 * Both authenticate via the per-agent Bearer hookToken (authenticate()), so the
 * agentId comes from the token, never the body — cross-tenant safe. zernio_post
 * resolves the channel's connected account from the agent's own
 * connectedAccountsJson, so one founder can never post through another's
 * account even with the shared app key.
 */

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { authenticate } from "./openclaw/inboundCallback";
import type { Id } from "../_generated/dataModel";

interface ConnectedAccount {
  accountId: string;
  platform: string;
  isActive?: boolean;
}

function resolveAccountId(
  connectedAccountsJson: string | null,
  channel: string
): string | null {
  if (!connectedAccountsJson) return null;
  try {
    const arr = JSON.parse(connectedAccountsJson) as ConnectedAccount[];
    if (!Array.isArray(arr)) return null;
    const match = arr.find((a) => a.platform === channel && a.accountId);
    return match?.accountId ?? null;
  } catch {
    return null;
  }
}

export const zernioPostHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: {
    channel?: string;
    content?: string;
    url?: string;
    targetExternalId?: string;
    targetCommentId?: string;
    intentionalFollowUp?: boolean;
    scheduleAtMs?: number;
    draftId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.channel || !body.content) {
    return new Response("missing channel or content", { status: 400 });
  }

  // Resolve the channel's connected account from THIS agent's own list.
  const agentCtx = await ctx.runQuery(
    internal.gtmMaya.publishEngine.getAgentPublishContext,
    { agentId: auth.agentId }
  );
  if (!agentCtx) return new Response("agent not found", { status: 404 });
  const zernioAccountId = resolveAccountId(agentCtx.connectedAccountsJson, body.channel);
  if (!zernioAccountId) {
    // Fail-closed: not connected => no auto-post. The agent should fall back to
    // a deep-link draft for the founder to post by hand.
    return new Response(
      JSON.stringify({ outcome: "needs_confirm", reasons: ["channel not connected"] }),
      { status: 409, headers: { "content-type": "application/json" } }
    );
  }

  // Link placement: on LinkedIn/IG/YouTube a URL in the caption costs ~40-50%
  // organic reach, so drop it in the FIRST COMMENT instead and keep the caption
  // clean. Other channels keep the link inline (X cost is handled separately via
  // quoteTweet; Reddit/TikTok carry it in the one-tap draft).
  const FIRST_COMMENT_CHANNELS = new Set(["linkedin", "instagram", "youtube"]);
  const hasUrl = !!body.url && body.url.length > 0;
  const useFirstComment = hasUrl && FIRST_COMMENT_CHANNELS.has(body.channel);
  const content =
    hasUrl && !useFirstComment ? `${body.content} ${body.url}` : body.content;
  const firstComment = useFirstComment ? body.url : undefined;

  const result = await ctx.runAction(
    internal.gtmMaya.publishEngine.publishContentDirect,
    {
      agentId: auth.agentId,
      channel: body.channel,
      zernioAccountId,
      content,
      firstComment,
      scheduleAtMs: body.scheduleAtMs,
      targetExternalId: body.targetExternalId,
      targetCommentId: body.targetCommentId,
      intentionalFollowUp: body.intentionalFollowUp,
      draftId: body.draftId ? (body.draftId as Id<"gtmDraftedContent">) : undefined,
    }
  );

  // Reddit/TikTok come back needs_confirm (ban-safety). publishContentDirect
  // doesn't touch calendar rows, so CREATE the needs_confirm event here and hand
  // Maya its eventId — that's exactly what she passes to `send_confirm_card` to
  // fire the founder's one-tap Telegram card. Without this she'd know a card is
  // needed but have no eventId to reference. Deduped so re-posting the same
  // reply/target doesn't pile up confirm cards.
  if (result.action === "needs_confirm") {
    const dedupeKey =
      `confirm:${body.channel}:` +
      (body.targetCommentId ?? body.targetExternalId ?? content.slice(0, 40));
    const now = Date.now();
    const eventId = await ctx.runMutation(
      internal.gtmMaya.calendarWrite.persistGtmCalendarEventDraft,
      {
        accountId: agentCtx.accountId,
        agentId: auth.agentId,
        title: `${body.channel} post (needs your tap)`,
        draftText: content,
        startsAtMs: now,
        endsAtMs: now + 3_600_000,
        timezone: "UTC",
        status: "needs_confirm",
        autoPostJson: JSON.stringify({
          channel: body.channel,
          zernioAccountId,
          mode: "manual_confirm",
          targetExternalId: body.targetExternalId,
          targetCommentId: body.targetCommentId,
        }),
        dedupeKey,
      }
    );
    return new Response(
      JSON.stringify({ ...result, outcome: "needs_confirm", eventId }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const checkAlreadyEngagedHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const url = new URL(request.url);
  const platform = url.searchParams.get("platform");
  const externalId = url.searchParams.get("externalId");
  const commentId = url.searchParams.get("commentId") ?? undefined;
  if (!platform || !externalId) {
    return new Response("missing platform or externalId", { status: 400 });
  }
  const result = await ctx.runQuery(
    internal.gtmMaya.engagementLedger.checkAlreadyEngaged,
    { agentId: auth.agentId, platform, externalId, commentId }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
