/**
 * Composio v3 OAuth — initiate + complete.
 *
 * Sprint 5. Public Convex actions (Clerk-auth-gated) that wrap Composio's
 * OAuth flow. We split it into two calls so the browser handles the redirect
 * lifecycle but the SDK shape stays in our backend.
 *
 * Flow:
 *   1. Frontend calls `startOAuth({ provider: "gmail" })`.
 *      - We resolve the signed-in Clerk identity → creators row.
 *      - We plan-tier-gate: `planFeatures(creator).allowedProviders` must
 *        include the requested provider. Starter has only "stripe" — Gmail /
 *        Calendar / Apollo / Hunter rejected here.
 *      - We POST to Composio v3 `/api/v3/connectedAccounts/initiate` with
 *        the creator's entityId and the provider's auth_config_id (the
 *        operator pre-creates one auth_config per provider in the Composio
 *        dashboard and pastes the ids into env). Composio returns a hosted
 *        OAuth URL + a session id.
 *   2. Browser opens the URL. User completes consent on the provider side.
 *   3. Composio redirects back to our callback URL with `code` + `state`.
 *      Frontend forwards both to `completeOAuth`.
 *      - We verify the state matches what `startOAuth` recorded.
 *      - We POST to Composio's callback endpoint to exchange.
 *      - We persist the resulting connectedAccountId (encrypted) on
 *        `connectedAccounts` for THIS creator.
 *
 * Cross-tenant safety: every step re-resolves the creators row from Clerk
 * identity. The frontend never gets to assert "this is creator X" — Clerk
 * subject is the only authority.
 */

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import {
  PlanGateError,
  planFeatures,
  type Provider,
} from "../../lib/planFeatures";
import { encrypt } from "../../lib/encryption";
import {
  ComposioClient,
  ComposioError,
  getDefaultComposioClient,
} from "./client";

const PROVIDER_VALIDATOR = v.union(
  v.literal("gmail"),
  v.literal("stripe"),
  v.literal("calendar"),
  v.literal("apollo"),
  v.literal("hunter")
);

/**
 * Composio's auth_config_id per provider. The operator creates these in the
 * Composio dashboard once per workspace and pastes the ids into the Convex
 * env. We refuse to start the flow if the env var for the requested provider
 * is missing — fail loud, not silently.
 */
function authConfigIdForProvider(provider: Provider): string {
  const envKey = `COMPOSIO_AUTH_CONFIG_${provider.toUpperCase()}`;
  const id = process.env[envKey];
  if (!id) {
    throw new ComposioError(
      `OAuth: ${envKey} is not set. Operator must create an auth_config in the Composio dashboard and paste the id.`
    );
  }
  return id;
}

/* -------------------------------------------------------------------------- */
/* Internal helpers — Clerk → creators row                                     */
/* -------------------------------------------------------------------------- */

export const getMeForOAuth = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<Pick<Doc<"creators">, "_id" | "plan"> | null> => {
    const c = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!c) return null;
    return { _id: c._id, plan: c.plan };
  },
});

export const upsertConnectedAccount = internalMutation({
  args: {
    creatorId: v.id("creators"),
    provider: PROVIDER_VALIDATOR,
    encryptedComposioAccountId: v.string(),
    composioAccountIdHash: v.string(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_creator_and_provider", (q) =>
        q.eq("creatorId", args.creatorId).eq("provider", args.provider)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        composioAccountId: args.encryptedComposioAccountId,
        composioAccountIdHash: args.composioAccountIdHash,
        scopes: args.scopes,
        scopeStatus: "active",
        connectedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("connectedAccounts", {
      creatorId: args.creatorId,
      provider: args.provider,
      composioAccountId: args.encryptedComposioAccountId,
      composioAccountIdHash: args.composioAccountIdHash,
      scopes: args.scopes,
      scopeStatus: "active",
      connectedAt: Date.now(),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* startOAuth — public action                                                  */
/* -------------------------------------------------------------------------- */

export const startOAuth = action({
  args: {
    provider: PROVIDER_VALIDATOR,
    /**
     * Where Composio redirects the user after consent. The frontend is
     * responsible for setting this to a route on our domain that captures
     * `code` + `state` and calls `completeOAuth`.
     */
    redirectUri: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ redirectUrl: string; state: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("OAuth: not authenticated.");
    }
    const me: Pick<Doc<"creators">, "_id" | "plan"> | null =
      await ctx.runQuery(internal.integrations.composio.oauth.getMeForOAuth, {
        clerkUserId: identity.subject,
      });
    if (!me) {
      throw new Error("OAuth: creator row not found for signed-in user.");
    }

    const features = planFeatures(me);
    if (!features.allowedProviders.includes(args.provider)) {
      throw new PlanGateError(
        me.plan,
        `oauth:${args.provider}`,
        "manager"
      );
    }

    const authConfigId = authConfigIdForProvider(args.provider);
    const client = getDefaultComposioClient();

    // Composio v3 initiate endpoint — returns hosted URL + session id (state).
    const initRes = await client.request<{
      redirectUrl?: string;
      authUrl?: string;
      url?: string;
      state?: string;
      sessionId?: string;
      id?: string;
    }>("/api/v3/connectedAccounts/initiate", {
      method: "POST",
      body: {
        authConfigId,
        entityId: me._id, // per-creator scoping for Composio's entity model
        callbackUrl: args.redirectUri,
      },
    });

    const redirectUrl = initRes.redirectUrl ?? initRes.authUrl ?? initRes.url;
    const state = initRes.state ?? initRes.sessionId ?? initRes.id;
    if (!redirectUrl || !state) {
      throw new ComposioError(
        "startOAuth: Composio did not return a redirect URL + state."
      );
    }

    return { redirectUrl, state };
  },
});

/* -------------------------------------------------------------------------- */
/* completeOAuth — public action                                               */
/* -------------------------------------------------------------------------- */

export const completeOAuth = action({
  args: {
    provider: PROVIDER_VALIDATOR,
    /** Authorization code from the provider's OAuth redirect. */
    code: v.string(),
    /** Opaque state token from `startOAuth`. */
    state: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ connectedAccountIdLocal: Id<"connectedAccounts"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("OAuth: not authenticated.");
    }
    const me: Pick<Doc<"creators">, "_id" | "plan"> | null =
      await ctx.runQuery(internal.integrations.composio.oauth.getMeForOAuth, {
        clerkUserId: identity.subject,
      });
    if (!me) {
      throw new Error("OAuth: creator row not found for signed-in user.");
    }
    const features = planFeatures(me);
    if (!features.allowedProviders.includes(args.provider)) {
      throw new PlanGateError(
        me.plan,
        `oauth:${args.provider}`,
        "manager"
      );
    }

    const client = getDefaultComposioClient();
    const exchangeRes = await client.request<{
      connectedAccountId?: string;
      id?: string;
      scopes?: string[];
      scope?: string;
    }>("/api/v3/connectedAccounts/callback", {
      method: "POST",
      body: {
        code: args.code,
        state: args.state,
      },
    });

    const composioAccountId =
      exchangeRes.connectedAccountId ?? exchangeRes.id;
    if (!composioAccountId) {
      throw new ComposioError(
        "completeOAuth: Composio callback did not return a connectedAccountId."
      );
    }
    const scopes: string[] = Array.isArray(exchangeRes.scopes)
      ? exchangeRes.scopes
      : typeof exchangeRes.scope === "string"
        ? exchangeRes.scope.split(/[,\s]+/).filter(Boolean)
        : [];

    const encrypted = await encrypt(composioAccountId);
    const hash = await sha256Hex(composioAccountId);
    const localId: Id<"connectedAccounts"> = await ctx.runMutation(
      internal.integrations.composio.oauth.upsertConnectedAccount,
      {
        creatorId: me._id as Id<"creators">,
        provider: args.provider,
        encryptedComposioAccountId: encrypted,
        composioAccountIdHash: hash,
        scopes,
      }
    );

    return { connectedAccountIdLocal: localId };
  },
});

/* -------------------------------------------------------------------------- */
/* Test seam — internal helper that lets tests invoke the OAuth flow with     */
/* an injected client (so we don't HTTP-call Composio in tests).              */
/* -------------------------------------------------------------------------- */

/** Exported only for tests. Do not call from production code. */
export function _setComposioClientForTests(_client: ComposioClient | null): void {
  // ComposioClient construction is lazy in the singleton; tests can override
  // by setting COMPOSIO_API_KEY + COMPOSIO_BASE_URL in env via vi.stubEnv,
  // then resetting the singleton via resetDefaultComposioClient(). Kept as a
  // function so future test seams have a parking spot.
}

/**
 * Stable lookup key for the composio account id (used for inbound webhook
 * routing — see schema.ts `connectedAccounts.composioAccountIdHash`). SHA-256
 * via Web Crypto so it works in Convex's V8 runtime.
 */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
