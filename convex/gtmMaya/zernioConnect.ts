import { v } from "convex/values";
import {
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ZernioClient } from "../integrations/zernio/client";
import {
  createProfile,
  getConnectUrl,
  listAccounts,
  getAccountsHealth,
  deleteAccount,
} from "../integrations/zernio/endpoints";
import type { ZernioPostPlatform } from "../integrations/zernio/types";
import { authenticate } from "./openclaw/inboundCallback";

/**
 * Maya v2 — Zernio social-connect flow (S2).
 *
 * Mirrors the GTM Google-Calendar OAuth pattern (calendarOAuth.ts) but for
 * Zernio's hosted OAuth across the 6 offered channels. Key shape difference:
 * Zernio runs the platform OAuth itself, so there is NO code-exchange on our
 * side. We only (a) ensure a per-founder Zernio profile exists, (b) mint a
 * connect URL whose `redirect_url` points back at our PUBLIC callback carrying
 * a single-use signed state token, and (c) on callback, authoritatively read
 * the account list from Zernio (scoped to the founder's profileId) and persist
 * it onto the founder's gtmAgents row.
 *
 * CROSS-TENANT ISOLATION (load-bearing): the public callback trusts NOTHING in
 * its query params except our own single-use token, which resolves to exactly
 * one (accountId, agentId). A forged callback cannot bind one founder's social
 * account onto another founder's row. The account list is then re-read from
 * Zernio by profileId, never taken from the redirect.
 *
 * The shared single-use-token table is `gtmOauthStateTokens` (provider
 * 'zernio'); the connected-account list is JSON-on-row in
 * `gtmAgents.connectedAccountsJson` (schema is at the TS DataModel ceiling, so
 * no new table).
 */

const STATE_TTL_MS = 15 * 60 * 1000;

/** The 6 channels Maya offers. Anything else is rejected before any API call. */
const OFFERED_PLATFORMS: ReadonlyArray<string> = [
  "x",
  "reddit",
  "linkedin",
  "instagram",
  "tiktok",
  "youtube",
];

export interface ConnectedAccount {
  accountId: string;
  platform: string;
  username?: string;
  displayName?: string;
  isActive: boolean;
  needsReconnect: boolean;
  connectedAt: number;
}

function mintStateToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function zernioClient(): ZernioClient {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) throw new Error("ZERNIO_API_KEY is not configured");
  return new ZernioClient({ apiKey });
}

/* ────────────────────────────────────────────────────────────────────────
 * Internal helpers — agent resolution + persistence
 * ──────────────────────────────────────────────────────────────────────── */

export const resolveAgentForClerkUser = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    accountId: Id<"creators">;
    agentId: Id<"gtmAgents">;
    zernioProfileId: string | null;
  } | null> => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return null;
    return {
      accountId: creator._id,
      agentId: agent._id,
      zernioProfileId: agent.zernioProfileId ?? null,
    };
  },
});

export const persistZernioProfileId = internalMutation({
  args: { agentId: v.id("gtmAgents"), zernioProfileId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.agentId, {
      zernioProfileId: args.zernioProfileId,
      updatedAt: Date.now(),
    });
  },
});

export const issueZernioStateToken = internalMutation({
  args: { accountId: v.id("creators"), agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const now = Date.now();
    const token = mintStateToken();
    await ctx.db.insert("gtmOauthStateTokens", {
      accountId: args.accountId,
      agentId: args.agentId,
      token,
      provider: "zernio",
      expiresAt: now + STATE_TTL_MS,
      createdAt: now,
    });
    return { token };
  },
});

export const claimZernioStateToken = internalMutation({
  args: { token: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> } | null> => {
    const now = Date.now();
    const row = await ctx.db
      .query("gtmOauthStateTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row || row.provider !== "zernio") return null;
    if (row.expiresAt <= now) return null;
    if (row.claimedAt) return null;
    await ctx.db.patch(row._id, { claimedAt: now });
    return { accountId: row.accountId, agentId: row.agentId };
  },
});

export const getAgentProfileId = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<string | null> => {
    const agent = await ctx.db.get(args.agentId);
    return agent?.zernioProfileId ?? null;
  },
});

/** Upsert the connected-account list onto the agent (dedupe by accountId). */
export const replaceConnectedAccounts = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    accounts: v.array(
      v.object({
        accountId: v.string(),
        platform: v.string(),
        username: v.optional(v.string()),
        displayName: v.optional(v.string()),
        isActive: v.boolean(),
        needsReconnect: v.boolean(),
        connectedAt: v.number(),
      })
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.agentId, {
      connectedAccountsJson: JSON.stringify(args.accounts),
      updatedAt: Date.now(),
    });
  },
});

export const readConnectedAccounts = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<ConnectedAccount[]> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent?.connectedAccountsJson) return [];
    return parseConnectedAccounts(agent.connectedAccountsJson);
  },
});

function parseConnectedAccounts(json: string | null | undefined): ConnectedAccount[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (a): a is ConnectedAccount =>
        a && typeof a.accountId === "string" && typeof a.platform === "string"
    );
  } catch {
    return [];
  }
}

/** Map a raw Zernio account row to our ConnectedAccount shape. */
function toConnectedAccount(raw: Record<string, unknown>, now: number): ConnectedAccount | null {
  const accountId =
    (typeof raw._id === "string" && raw._id) ||
    (typeof raw.id === "string" && raw.id) ||
    null;
  const platform = typeof raw.platform === "string" ? raw.platform : null;
  if (!accountId || !platform) return null;
  return {
    accountId,
    platform,
    username: typeof raw.username === "string" ? raw.username : undefined,
    displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
    isActive: raw.isActive !== false,
    needsReconnect: false,
    connectedAt: now,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Public action — mint a connect URL for a channel
 * ──────────────────────────────────────────────────────────────────────── */

export const getZernioConnectUrl = action({
  args: { platform: v.string() },
  handler: async (ctx, args): Promise<{ authUrl: string }> => {
    if (!OFFERED_PLATFORMS.includes(args.platform)) {
      throw new Error(`Platform not offered: ${args.platform}`);
    }
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("signed-in user required");

    const resolved = await ctx.runQuery(
      internal.gtmMaya.zernioConnect.resolveAgentForClerkUser,
      { clerkUserId: identity.subject }
    );
    if (!resolved) throw new Error("GTM agent not found");

    const client = zernioClient();

    // Ensure the founder has a Zernio profile (created once, then reused).
    let profileId = resolved.zernioProfileId;
    if (!profileId) {
      const profile = await createProfile(client, {
        name: `maya-agent-${resolved.agentId}`,
        description: "HeyMaya managed profile",
      });
      profileId = profile._id;
      await ctx.runMutation(
        internal.gtmMaya.zernioConnect.persistZernioProfileId,
        { agentId: resolved.agentId, zernioProfileId: profileId }
      );
    }

    const { token } = await ctx.runMutation(
      internal.gtmMaya.zernioConnect.issueZernioStateToken,
      { accountId: resolved.accountId, agentId: resolved.agentId }
    );

    const site = (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
    const redirectUrl = `${site}/lc_gtm/zernio_callback?token=${encodeURIComponent(token)}`;

    const { authUrl } = await getConnectUrl(
      client,
      args.platform as ZernioPostPlatform,
      profileId,
      redirectUrl
    );
    return { authUrl };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Internal action — finalize a connect (called by the public callback route)
 * ──────────────────────────────────────────────────────────────────────── */

export const finalizeZernioConnect = internalAction({
  args: { token: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; connectedCount?: number; reason?: string }> => {
    const claim = await ctx.runMutation(
      internal.gtmMaya.zernioConnect.claimZernioStateToken,
      { token: args.token }
    );
    if (!claim) return { ok: false, reason: "invalid-or-expired-token" };

    const profileId = await ctx.runQuery(
      internal.gtmMaya.zernioConnect.getAgentProfileId,
      { agentId: claim.agentId }
    );
    if (!profileId) return { ok: false, reason: "no-profile" };

    // Authoritatively read the account list from Zernio scoped to THIS
    // founder's profile — never trust the redirect query params for binding.
    const client = zernioClient();
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await listAccounts(client, { profileId });
    } catch (err) {
      return { ok: false, reason: `list-accounts-failed: ${(err as Error).message}` };
    }
    const now = Date.now();
    const accounts = rows
      .map((r) => toConnectedAccount(r, now))
      .filter((a): a is ConnectedAccount => a !== null);

    await ctx.runMutation(
      internal.gtmMaya.zernioConnect.replaceConnectedAccounts,
      { agentId: claim.agentId, accounts }
    );
    return { ok: true, connectedCount: accounts.length };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Public reads/writes for the Settings "Connected accounts" panel
 * ──────────────────────────────────────────────────────────────────────── */

export const getMyConnectedAccounts = query({
  args: {},
  handler: async (ctx): Promise<ConnectedAccount[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return [];
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return [];
    return parseConnectedAccounts(agent.connectedAccountsJson);
  },
});

export const refreshMyZernioHealth = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{ ok: boolean; reason?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("signed-in user required");
    const resolved = await ctx.runQuery(
      internal.gtmMaya.zernioConnect.resolveAgentForClerkUser,
      { clerkUserId: identity.subject }
    );
    if (!resolved || !resolved.zernioProfileId) {
      return { ok: false, reason: "not-connected" };
    }
    const client = zernioClient();
    const health = await getAccountsHealth(client, {
      profileId: resolved.zernioProfileId,
    });
    // Re-read accounts and stamp needsReconnect from health (best-effort).
    const rows = await listAccounts(client, {
      profileId: resolved.zernioProfileId,
    });
    const now = Date.now();
    const unhealthy = new Set<string>();
    for (const a of health.accounts ?? []) {
      const id =
        (typeof a._id === "string" && a._id) ||
        (typeof a.accountId === "string" && a.accountId) ||
        null;
      if (!id) continue;
      if (a.needsReconnect === true || a.canPost === false) unhealthy.add(id);
    }
    const accounts = rows
      .map((r) => toConnectedAccount(r, now))
      .filter((a): a is ConnectedAccount => a !== null)
      .map((a) => ({ ...a, needsReconnect: unhealthy.has(a.accountId) }));
    await ctx.runMutation(
      internal.gtmMaya.zernioConnect.replaceConnectedAccounts,
      { agentId: resolved.agentId, accounts }
    );
    return { ok: true };
  },
});

export const disconnectZernioAccount = action({
  args: { accountId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; reason?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("signed-in user required");
    const resolved = await ctx.runQuery(
      internal.gtmMaya.zernioConnect.resolveAgentForClerkUser,
      { clerkUserId: identity.subject }
    );
    if (!resolved) throw new Error("GTM agent not found");

    // Cross-tenant guard: the account must be one of THIS founder's connected
    // accounts before we call Zernio's delete with the shared key.
    const mine = await ctx.runQuery(
      internal.gtmMaya.zernioConnect.readConnectedAccounts,
      { agentId: resolved.agentId }
    );
    if (!mine.some((a) => a.accountId === args.accountId)) {
      return { ok: false, reason: "not-your-account" };
    }
    const client = zernioClient();
    await deleteAccount(client, args.accountId);
    const remaining = mine.filter((a) => a.accountId !== args.accountId);
    await ctx.runMutation(
      internal.gtmMaya.zernioConnect.replaceConnectedAccounts,
      { agentId: resolved.agentId, accounts: remaining }
    );
    return { ok: true };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * PUBLIC callback route — Zernio redirects the founder's browser here after
 * hosted OAuth. Registered at /lc_gtm/zernio_callback (GET) in http.ts.
 *
 * Security: the ONLY trusted input is our single-use `token`. It resolves to
 * exactly one agent; the account list is re-read from Zernio by that agent's
 * profileId. We then 302 the browser back to the app.
 * ──────────────────────────────────────────────────────────────────────── */
/* ────────────────────────────────────────────────────────────────────────
 * Agent-facing — mint prioritized one-tap connect links (hookToken auth).
 *
 * The Clerk-authed `getZernioConnectUrl` action above is for the WEB dashboard;
 * Maya can't call it (she's hookToken, not a signed-in user). This route lets
 * her generate per-channel connect URLs to send straight into Telegram at
 * synthesis — one-tap, in BET-CHANNEL ORDER — instead of a "go to the
 * dashboard" nudge. Accepts the channels she wants links for (her bet channels);
 * skips any already connected; preserves the order she passed (her priority).
 * ──────────────────────────────────────────────────────────────────────── */
export const getConnectLinksHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: { channels?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const agentCtx = await ctx.runQuery(
    internal.gtmMaya.publishEngine.getAgentPublishContext,
    { agentId: auth.agentId }
  );
  if (!agentCtx) return new Response("agent not found", { status: 404 });

  // Which channels are already connected (skip those).
  let connected: Set<string> = new Set();
  try {
    const arr = JSON.parse(agentCtx.connectedAccountsJson ?? "[]") as Array<{
      platform?: string;
    }>;
    if (Array.isArray(arr)) connected = new Set(arr.map((a) => a.platform ?? ""));
  } catch {
    /* no connections yet */
  }

  // Preserve the caller's order (her bet priority); default to all offered.
  const requested =
    Array.isArray(body.channels) && body.channels.length > 0
      ? body.channels
      : OFFERED_PLATFORMS;
  const channels = requested.filter(
    (c) => OFFERED_PLATFORMS.includes(c) && !connected.has(c)
  );

  const client = zernioClient();

  // Ensure the founder has a Zernio profile (created once, reused).
  let profileId = agentCtx.zernioProfileId ?? undefined;
  if (!profileId) {
    const profile = await createProfile(client, {
      name: `maya-agent-${auth.agentId}`,
      description: "HeyMaya managed profile",
    });
    profileId = profile._id;
    await ctx.runMutation(internal.gtmMaya.zernioConnect.persistZernioProfileId, {
      agentId: auth.agentId,
      zernioProfileId: profileId,
    });
  }

  const site = (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
  const links: Array<{ channel: string; url: string }> = [];
  for (const platform of channels) {
    try {
      const { token } = await ctx.runMutation(
        internal.gtmMaya.zernioConnect.issueZernioStateToken,
        { accountId: agentCtx.accountId, agentId: auth.agentId }
      );
      const redirectUrl = `${site}/lc_gtm/zernio_callback?token=${encodeURIComponent(token)}`;
      const { authUrl } = await getConnectUrl(
        client,
        platform as ZernioPostPlatform,
        profileId,
        redirectUrl
      );
      links.push({ channel: platform, url: authUrl });
    } catch {
      // Skip a channel that errors rather than failing the whole batch.
    }
  }

  return new Response(
    JSON.stringify({ ok: true, links, alreadyConnected: [...connected] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});

export const zernioCallbackHttp = httpAction(async (ctx, request) => {
  const appBase = (
    process.env.APP_URL ??
    process.env.CONVEX_SITE_URL ??
    ""
  ).replace(/\/+$/, "");
  const ok = (path: string): Response =>
    new Response(null, { status: 302, headers: { Location: `${appBase}${path}` } });

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return ok("/clawlaunch/mission/account?connect_error=missing-token");

  try {
    const result = await ctx.runAction(
      internal.gtmMaya.zernioConnect.finalizeZernioConnect,
      { token }
    );
    if (!result.ok) {
      return ok(`/clawlaunch/mission/account?connect_error=${encodeURIComponent(result.reason ?? "failed")}`);
    }
    return ok(`/clawlaunch/mission/account?connected=${result.connectedCount ?? 0}`);
  } catch {
    return ok("/clawlaunch/mission/account?connect_error=server-error");
  }
});
