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

  const content =
    body.url && body.url.length > 0 ? `${body.content} ${body.url}` : body.content;

  const result = await ctx.runAction(
    internal.gtmMaya.publishEngine.publishContentDirect,
    {
      agentId: auth.agentId,
      channel: body.channel,
      zernioAccountId,
      content,
      scheduleAtMs: body.scheduleAtMs,
      targetExternalId: body.targetExternalId,
      targetCommentId: body.targetCommentId,
      intentionalFollowUp: body.intentionalFollowUp,
      draftId: body.draftId ? (body.draftId as Id<"gtmDraftedContent">) : undefined,
    }
  );

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
