import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { decrypt, encrypt } from "../lib/encryption";

/**
 * Sprint 9 — GTM Google Calendar OAuth + token storage.
 *
 * Mirrors the creator-side pattern (creatorMayaV0/backend.ts) but scoped
 * to gtmAgents.accountId. Token refresh + event-write live separately:
 *   - storage / refresh: this file
 *   - event write: invoked from /lc_gtm/calendar_proposal in
 *     inboundCallback.ts using convex/integrations/google/calendar.ts
 *
 * Scopes match the unified consent the creator product already requests
 * (calendar.readonly + calendar.events + gmail.modify); GTM only uses
 * calendar.events but keeping the bundle simplifies a future single
 * consent screen across products.
 */

export const GTM_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  // gmail.modify carried for product-wide unified consent; GTM doesn't
  // use it directly today.
];

// ──────────────────────────────────────────────────────────────────────
// OAuth state-token issuance + claim
// ──────────────────────────────────────────────────────────────────────

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

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

/**
 * Issue a single-use state token for the GTM Google OAuth flow.
 * Stored in gtmOauthStateTokens with 15-min TTL. The callback route
 * resolves it back to an account in claimGtmOauthStateToken.
 */
export const issueGtmOauthStateToken = mutation({
  args: {},
  handler: async (
    ctx
  ): Promise<{ token: string; expiresAt: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("signed-in user required");
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") {
      throw new Error("GTM account not found");
    }
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) throw new Error("GTM agent not found");

    const now = Date.now();
    const token = mintStateToken();
    await ctx.db.insert("gtmOauthStateTokens", {
      accountId: creator._id,
      agentId: agent._id,
      token,
      provider: "google",
      expiresAt: now + OAUTH_STATE_TTL_MS,
      createdAt: now,
    });
    return { token, expiresAt: now + OAUTH_STATE_TTL_MS };
  },
});

/**
 * Internal — callback resolves the state token back to account + agent.
 * Atomic claim: throws if token missing/expired/already claimed.
 */
export const claimGtmOauthStateToken = internalMutation({
  args: { token: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> }> => {
    const now = Date.now();
    const row = await ctx.db
      .query("gtmOauthStateTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row) throw new Error("oauth state token not found");
    if (row.expiresAt <= now) throw new Error("oauth state token expired");
    if (row.claimedAt) throw new Error("oauth state token already claimed");
    await ctx.db.patch(row._id, { claimedAt: now });
    return { accountId: row.accountId, agentId: row.agentId };
  },
});

// ──────────────────────────────────────────────────────────────────────
// Connection storage (encrypted)
// ──────────────────────────────────────────────────────────────────────

export interface GoogleTokenBundle {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/**
 * Internal — store (or update) a GTM Google Calendar connection.
 * Called by the callback action after exchanging the auth code.
 */
export const storeGtmCalendarConnection = internalMutation({
  args: {
    accountId: v.id("creators"),
    tokens: v.object({
      access_token: v.string(),
      refresh_token: v.optional(v.string()),
      expires_in: v.optional(v.number()),
      token_type: v.optional(v.string()),
      scope: v.optional(v.string()),
    }),
    timezone: v.string(),
    externalAccountId: v.optional(v.string()),
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmCalendarConnections">> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmCalendarConnections")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    const expiresAt = args.tokens.expires_in
      ? now + args.tokens.expires_in * 1000
      : undefined;
    const patch = {
      accountId: args.accountId,
      provider: "google" as const,
      externalAccountId: args.externalAccountId,
      oauthAccessToken: args.encryptedAccessToken,
      // Only persist refresh token if it was returned (offline grant);
      // never overwrite a non-empty stored refresh token with undefined.
      oauthRefreshToken:
        args.encryptedRefreshToken ?? existing?.oauthRefreshToken,
      oauthExpiresAt: expiresAt,
      oauthTokenType: args.tokens.token_type,
      oauthScope: args.tokens.scope,
      timezone: args.timezone,
      scopes: args.tokens.scope?.split(/\s+/).filter(Boolean) ?? GTM_GOOGLE_SCOPES,
      connectedAt: existing?.connectedAt ?? now,
      lastSyncedAt: now,
      status: "active" as const,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("gtmCalendarConnections", patch);
  },
});

export const getGtmCalendarConnection = internalQuery({
  args: { accountId: v.id("creators") },
  handler: async (
    ctx,
    args
  ): Promise<Doc<"gtmCalendarConnections"> | null> => {
    return await ctx.db
      .query("gtmCalendarConnections")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
  },
});

/**
 * Public query — UI uses this to render the "Calendar connected" state.
 * Cross-tenant safe: only returns the signed-in user's connection.
 */
export const getMyCalendarConnection = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{ connected: boolean; connectedAt?: number; timezone?: string } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    const conn = await ctx.db
      .query("gtmCalendarConnections")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!conn) return { connected: false };
    return {
      connected: conn.status === "active",
      connectedAt: conn.connectedAt,
      timezone: conn.timezone,
    };
  },
});

// ──────────────────────────────────────────────────────────────────────
// Token exchange + refresh
// ──────────────────────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Exchange an OAuth code for tokens. Called by the GTM callback route
 * after the user grants consent.
 */
export const exchangeGtmOauthCode = internalAction({
  args: {
    code: v.string(),
    redirectUri: v.string(),
    accountId: v.id("creators"),
    timezone: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return {
        ok: false,
        reason: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured",
      };
    }
    const body = new URLSearchParams({
      code: args.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: args.redirectUri,
      grant_type: "authorization_code",
    });
    let tokens: GoogleTokenBundle;
    try {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          ok: false,
          reason: `google token exchange HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      tokens = (await res.json()) as GoogleTokenBundle;
    } catch (err) {
      return {
        ok: false,
        reason: `google token exchange threw: ${(err as Error).message}`,
      };
    }
    if (!tokens.access_token) {
      return { ok: false, reason: "google token exchange returned no access_token" };
    }
    const encryptedAccessToken = await encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? await encrypt(tokens.refresh_token)
      : undefined;
    await ctx.runMutation(internal.gtmMaya.calendarOAuth.storeGtmCalendarConnection, {
      accountId: args.accountId,
      tokens,
      timezone: args.timezone,
      encryptedAccessToken,
      encryptedRefreshToken,
    });
    return { ok: true };
  },
});

/**
 * Decrypt + (if needed) refresh + return a usable access token.
 * Used by the calendar write path. Throws if the connection is missing,
 * revoked, or the refresh fails terminally.
 */
export async function ensureFreshAccessToken(
  ctx: ActionCtx,
  accountId: Id<"creators">
): Promise<string> {
  const conn = await ctx.runQuery(
    internal.gtmMaya.calendarOAuth.getGtmCalendarConnection,
    { accountId }
  );
  if (!conn) throw new Error("GTM calendar not connected");
  if (conn.status !== "active") {
    throw new Error(`GTM calendar connection is ${conn.status}`);
  }
  if (!conn.oauthAccessToken) {
    throw new Error("GTM calendar connection has no access token");
  }
  const skewMs = 60_000; // refresh if <60s remaining
  const needsRefresh =
    !conn.oauthExpiresAt || conn.oauthExpiresAt - Date.now() < skewMs;
  if (!needsRefresh) {
    return await decrypt(conn.oauthAccessToken);
  }
  if (!conn.oauthRefreshToken) {
    throw new Error(
      "access token expired AND no refresh token stored — user must re-connect"
    );
  }
  const refreshToken = await decrypt(conn.oauthRefreshToken);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`google refresh HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const refreshed = (await res.json()) as GoogleTokenBundle;
  if (!refreshed.access_token) {
    throw new Error("google refresh returned no access_token");
  }
  const newEncrypted = await encrypt(refreshed.access_token);
  await ctx.runMutation(internal.gtmMaya.calendarOAuth.persistRefreshedAccessToken, {
    accountId,
    encryptedAccessToken: newEncrypted,
    expiresInSec: refreshed.expires_in ?? 3600,
  });
  return refreshed.access_token;
}

export const persistRefreshedAccessToken = internalMutation({
  args: {
    accountId: v.id("creators"),
    encryptedAccessToken: v.string(),
    expiresInSec: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const conn = await ctx.db
      .query("gtmCalendarConnections")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    if (!conn) return;
    await ctx.db.patch(conn._id, {
      oauthAccessToken: args.encryptedAccessToken,
      oauthExpiresAt: Date.now() + args.expiresInSec * 1000,
      lastSyncedAt: Date.now(),
    });
  },
});

// ──────────────────────────────────────────────────────────────────────
// OAuth URL builder — used by the start route
// ──────────────────────────────────────────────────────────────────────

export function buildGtmGoogleAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    access_type: "offline", // get refresh token
    prompt: "consent", // always re-prompt so we get the refresh token even on re-connect
    scope: GTM_GOOGLE_SCOPES.join(" "),
    state: args.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
