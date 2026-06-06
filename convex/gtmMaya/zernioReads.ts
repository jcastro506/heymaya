/**
 * Maya v2 (S5) — Zernio READ + engagement tools, wired through to the agent.
 *
 * The Zernio CLIENT layer (convex/integrations/zernio/endpoints.ts) already
 * implements analytics / follower-stats / health / inbox / reply / DM. This file
 * is the last-mile: thin internalActions that call those client functions for a
 * specific agent (resolving the agent's own zernioProfileId + connected accounts,
 * so cross-tenant isolation holds), plus the /lc_gtm/* httpActions that expose
 * them to Maya as typed tools.
 *
 * Two design rules:
 *  1. **Graceful add-on degradation.** Analytics + Inbox require Zernio add-ons
 *     on the operator's account (a 403 today: hasAnalyticsAccess:false). When the
 *     add-on isn't enabled, these return { ok:false, addonRequired } with a plain
 *     message instead of throwing — so Maya says "analytics isn't on yet" rather
 *     than erroring.
 *  2. **Ban-safety on writes.** reply_to_comment + send_dm run the SAME
 *     fail-closed outbound firewall (critiqueOutboundSafety) as post_to_channel
 *     before anything leaves — a reply IS a post, so it gets the same gate.
 *
 * Auth: every httpAction authenticates via the per-agent Bearer hookToken; the
 * agentId comes from the token, never the body.
 */

import { httpAction, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { authenticate } from "./openclaw/inboundCallback";
import { ZernioClient } from "../integrations/zernio/client";
import { ZernioApiError } from "../integrations/zernio/types";
import {
  getPostAnalytics,
  getPostTimeline,
  getBestTime,
  getFollowerStats,
  getAccountsHealth,
  listInboxComments,
  replyToComment,
} from "../integrations/zernio/endpoints";

function zernioClient(): ZernioClient {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) throw new Error("ZERNIO_API_KEY is not configured");
  return new ZernioClient({ apiKey });
}

interface ConnectedAccount {
  accountId: string;
  platform: string;
  isActive?: boolean;
}

function parseAccounts(json: string | null): ConnectedAccount[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? (arr as ConnectedAccount[]) : [];
  } catch {
    return [];
  }
}

function resolveAccountId(
  accounts: ConnectedAccount[],
  channel: string
): string | null {
  return accounts.find((a) => a.platform === channel && a.accountId)?.accountId ?? null;
}

/** Map a Zernio add-on 403/401 into a clean, model-facing result instead of
 *  throwing. The client throws ZernioAuthError on 401/403 (no `status` field) and
 *  ZernioApiError (with `status`) on other 4xx, so we detect BOTH — and duck-type
 *  rather than rely on `instanceof`, which breaks across convex-test's module
 *  boundary. */
function addonError(err: unknown, addon: "analytics" | "inbox"):
  | { ok: false; addonRequired: "analytics" | "inbox"; message: string }
  | null {
  const e = err as { status?: number; name?: string; message?: string };
  const status = err instanceof ZernioApiError ? err.status : (e?.status ?? 0);
  const isAuth =
    status === 403 ||
    status === 401 ||
    e?.name === "ZernioAuthError" ||
    /HTTP 40[13]|auth failed/i.test(e?.message ?? "");
  if (isAuth) {
    return {
      ok: false,
      addonRequired: addon,
      message:
        addon === "analytics"
          ? "Zernio Analytics add-on isn't enabled on this account yet — I can't pull platform analytics until the operator turns it on. (Wrapped-link clicks still work for attribution.)"
          : "Zernio Inbox add-on isn't enabled on this account yet — I can't read comments/DMs until the operator turns it on.",
    };
  }
  return null;
}

// ───────────────────── internalActions (the Zernio calls) ─────────────────────

export const fetchConnectionHealth = internalAction({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<unknown> => {
    const agentCtx = await ctx.runQuery(
      internal.gtmMaya.publishEngine.getAgentPublishContext,
      { agentId: args.agentId }
    );
    if (!agentCtx) return { ok: false, message: "agent not found" };
    try {
      const health = await getAccountsHealth(zernioClient(), {
        profileId: agentCtx.zernioProfileId ?? undefined,
      });
      return { ok: true, health };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
});

export const fetchAccountAnalytics = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    postId: v.optional(v.string()),
    platform: v.optional(v.string()),
    accountId: v.optional(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const agentCtx = await ctx.runQuery(
      internal.gtmMaya.publishEngine.getAgentPublishContext,
      { agentId: args.agentId }
    );
    if (!agentCtx) return { ok: false, message: "agent not found" };
    try {
      const analytics = await getPostAnalytics(zernioClient(), {
        profileId: agentCtx.zernioProfileId ?? undefined,
        postId: args.postId,
        platform: args.platform,
        accountId: args.accountId,
        fromDate: args.fromDate,
        toDate: args.toDate,
        limit: args.limit,
      });
      return { ok: true, analytics };
    } catch (err) {
      const addon = addonError(err, "analytics");
      if (addon) return addon;
      return { ok: false, message: (err as Error).message };
    }
  },
});

export const fetchPostTimeline = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    postId: v.string(),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const agentCtx = await ctx.runQuery(
      internal.gtmMaya.publishEngine.getAgentPublishContext,
      { agentId: args.agentId }
    );
    if (!agentCtx) return { ok: false, message: "agent not found" };
    try {
      const timeline = await getPostTimeline(zernioClient(), {
        postId: args.postId,
        fromDate: args.fromDate,
        toDate: args.toDate,
      });
      return { ok: true, timeline };
    } catch (err) {
      const addon = addonError(err, "analytics");
      if (addon) return addon;
      return { ok: false, message: (err as Error).message };
    }
  },
});

export const fetchBestTime = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    platform: v.optional(v.string()),
    accountId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const agentCtx = await ctx.runQuery(
      internal.gtmMaya.publishEngine.getAgentPublishContext,
      { agentId: args.agentId }
    );
    if (!agentCtx) return { ok: false, message: "agent not found" };
    try {
      const bestTime = await getBestTime(zernioClient(), {
        platform: args.platform,
        accountId: args.accountId,
        profileId: agentCtx.zernioProfileId ?? undefined,
      });
      return { ok: true, bestTime };
    } catch (err) {
      const addon = addonError(err, "analytics");
      if (addon) return addon;
      return { ok: false, message: (err as Error).message };
    }
  },
});

export const fetchFollowerStats = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    platform: v.optional(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    granularity: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const agentCtx = await ctx.runQuery(
      internal.gtmMaya.publishEngine.getAgentPublishContext,
      { agentId: args.agentId }
    );
    if (!agentCtx) return { ok: false, message: "agent not found" };
    const accounts = parseAccounts(agentCtx.connectedAccountsJson);
    const accountIds = accounts
      .filter((a) => !args.platform || a.platform === args.platform)
      .map((a) => a.accountId)
      .filter(Boolean);
    if (accountIds.length === 0) {
      return { ok: false, message: "no connected accounts to read follower stats for" };
    }
    try {
      const stats = await getFollowerStats(zernioClient(), {
        accountIds,
        profileId: agentCtx.zernioProfileId ?? undefined,
        fromDate: args.fromDate,
        toDate: args.toDate,
        granularity: args.granularity,
      });
      return { ok: true, stats };
    } catch (err) {
      const addon = addonError(err, "analytics");
      if (addon) return addon;
      return { ok: false, message: (err as Error).message };
    }
  },
});

export const fetchInbox = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    platform: v.optional(v.string()),
    since: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    // Inbox = COMMENTS on the founder's posts only. DMs are deliberately not
    // handled (operator decision) — we never read or send direct messages.
    const agentCtx = await ctx.runQuery(
      internal.gtmMaya.publishEngine.getAgentPublishContext,
      { agentId: args.agentId }
    );
    if (!agentCtx) return { ok: false, message: "agent not found" };
    try {
      const comments = await listInboxComments(zernioClient(), {
        profileId: agentCtx.zernioProfileId ?? undefined,
        platform: args.platform,
        since: args.since,
        limit: args.limit,
      });
      return { ok: true, comments };
    } catch (err) {
      const addon = addonError(err, "inbox");
      if (addon) return addon;
      return { ok: false, message: (err as Error).message };
    }
  },
});

export const sendCommentReply = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    channel: v.string(),
    text: v.string(),
    postId: v.string(),
    commentId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    // Ban-safety FORCE: a reply IS outbound — run the same fail-closed gate as
    // post_to_channel before anything leaves.
    const safety = await ctx.runAction(
      internal.gtmMaya.outboundFirewall.critiqueOutboundSafety,
      { text: args.text }
    );
    if (!safety.ok) {
      return { ok: false, blocked: true, reasons: safety.failures };
    }

    const agentCtx = await ctx.runQuery(
      internal.gtmMaya.publishEngine.getAgentPublishContext,
      { agentId: args.agentId }
    );
    if (!agentCtx) return { ok: false, message: "agent not found" };
    const accounts = parseAccounts(agentCtx.connectedAccountsJson);
    const accountId = resolveAccountId(accounts, args.channel);
    if (!accountId) {
      return { ok: false, message: `channel ${args.channel} not connected` };
    }
    try {
      const r = await replyToComment(zernioClient(), {
        postId: args.postId,
        accountId,
        message: args.text,
        commentId: args.commentId,
      });
      return { ok: r.success, id: r.id };
    } catch (err) {
      const addon = addonError(err, "inbox");
      if (addon) return addon;
      return { ok: false, message: (err as Error).message };
    }
  },
});

// ───────────────────── httpActions (the agent-facing tools) ─────────────────────

/** GET /lc_gtm/list_connected_accounts — no Zernio call; reads the agent's own
 *  connectedAccountsJson so Maya knows who she can post for + in what mode. */
export const listConnectedAccountsHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  // Self-heal: re-read the authoritative account list from Zernio and rewrite
  // connectedAccountsJson before answering. This covers a connection whose OAuth
  // callback never made it back AND whose account.connected webhook was missed —
  // the next time Maya checks "who can I post for", the truth is reconciled.
  // Best-effort: a Zernio hiccup must not block the (still-useful) cached read.
  try {
    await ctx.runAction(
      internal.gtmMaya.zernioConnect.reconcileAccountsForAgent,
      { agentId: auth.agentId }
    );
  } catch {
    /* fall back to the last-known connectedAccountsJson */
  }
  const agentCtx = await ctx.runQuery(
    internal.gtmMaya.publishEngine.getAgentPublishContext,
    { agentId: auth.agentId }
  );
  const accounts = parseAccounts(agentCtx?.connectedAccountsJson ?? null);
  const AUTO = new Set(["x", "linkedin", "instagram", "youtube"]);
  const out = accounts.map((a) => ({
    platform: a.platform,
    mode: AUTO.has(a.platform) ? "auto-post" : "one-tap-confirm",
    isActive: a.isActive !== false,
  }));
  return new Response(JSON.stringify({ ok: true, accounts: out }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const getConnectionHealthHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  const result = await ctx.runAction(
    internal.gtmMaya.zernioReads.fetchConnectionHealth,
    { agentId: auth.agentId }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const getAccountAnalyticsHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const result = await ctx.runAction(
    internal.gtmMaya.zernioReads.fetchAccountAnalytics,
    {
      agentId: auth.agentId,
      postId: url.searchParams.get("postId") ?? undefined,
      platform: url.searchParams.get("platform") ?? undefined,
      accountId: url.searchParams.get("accountId") ?? undefined,
      fromDate: url.searchParams.get("fromDate") ?? undefined,
      toDate: url.searchParams.get("toDate") ?? undefined,
      limit: limitRaw ? Number(limitRaw) : undefined,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const getPostTimelineHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  const url = new URL(request.url);
  const postId = url.searchParams.get("postId");
  if (!postId) return new Response("missing postId", { status: 400 });
  const result = await ctx.runAction(
    internal.gtmMaya.zernioReads.fetchPostTimeline,
    {
      agentId: auth.agentId,
      postId,
      fromDate: url.searchParams.get("fromDate") ?? undefined,
      toDate: url.searchParams.get("toDate") ?? undefined,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const getBestTimeHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  const url = new URL(request.url);
  const result = await ctx.runAction(
    internal.gtmMaya.zernioReads.fetchBestTime,
    {
      agentId: auth.agentId,
      platform: url.searchParams.get("platform") ?? undefined,
      accountId: url.searchParams.get("accountId") ?? undefined,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const getFollowerStatsHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  const url = new URL(request.url);
  const result = await ctx.runAction(
    internal.gtmMaya.zernioReads.fetchFollowerStats,
    {
      agentId: auth.agentId,
      platform: url.searchParams.get("platform") ?? undefined,
      fromDate: url.searchParams.get("fromDate") ?? undefined,
      toDate: url.searchParams.get("toDate") ?? undefined,
      granularity: url.searchParams.get("granularity") ?? undefined,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const listInboxHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const result = await ctx.runAction(internal.gtmMaya.zernioReads.fetchInbox, {
    agentId: auth.agentId,
    platform: url.searchParams.get("platform") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
    limit: limitRaw ? Number(limitRaw) : undefined,
  });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

export const replyToCommentHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: { channel?: string; postId?: string; commentId?: string; text?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.channel || !body.postId || !body.text) {
    return new Response("missing channel, postId, or text", { status: 400 });
  }
  const result = await ctx.runAction(
    internal.gtmMaya.zernioReads.sendCommentReply,
    {
      agentId: auth.agentId,
      channel: body.channel,
      text: body.text,
      postId: body.postId,
      commentId: body.commentId,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
