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
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
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
/* OAuth-initiate core — shared by the Clerk-gated and webhook-secret-gated   */
/* surfaces. Both surfaces resolve a `creatorId` first (from identity vs.     */
/* request body), then funnel into this single core so the Composio HTTP     */
/* call + plan-tier gate live in exactly one place.                           */
/* -------------------------------------------------------------------------- */

/**
 * Fetch + plan-gate before calling Composio. Internal action because the
 * Composio call is an external HTTP request — actions are the only Convex
 * surface that may make those.
 *
 * Test seam: pass `clientOverride` (only used by tests) to inject a
 * stubbed `ComposioClient`. Production callers omit it and the function
 * falls back to `getDefaultComposioClient()`.
 */
async function initiateOAuthForCreatorCore(
  ctx: ActionCtx,
  args: {
    creatorId: Id<"creators">;
    provider: Provider;
    redirectUri: string;
  },
  clientOverride?: ComposioClient
): Promise<{ redirectUrl: string; state: string }> {
  const me: Pick<Doc<"creators">, "_id" | "plan"> | null = await ctx.runQuery(
    internal.integrations.composio.oauth.getCreatorByIdForOAuth,
    { creatorId: args.creatorId }
  );
  if (!me) {
    throw new Error("OAuth: creator not found.");
  }

  const features = planFeatures(me);
  if (!features.allowedProviders.includes(args.provider)) {
    throw new PlanGateError(
      me.plan,
      `oauth:${args.provider}`,
      args.provider === "gmail" || args.provider === "calendar"
        ? "pro"
        : "studio"
    );
  }

  const authConfigId = authConfigIdForProvider(args.provider);
  const client = clientOverride ?? resolveComposioClient();

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
}

/**
 * Internal-only query that resolves a creators row by id (vs. by Clerk
 * subject). Used by the webhook-secret-gated httpAction surface where the
 * caller is Maya's runtime, not the browser.
 */
export const getCreatorByIdForOAuth = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (
    ctx,
    args
  ): Promise<Pick<Doc<"creators">, "_id" | "plan"> | null> => {
    const c = await ctx.db.get(args.creatorId);
    if (!c) return null;
    return { _id: c._id, plan: c.plan };
  },
});

/**
 * Internal action wrapper around the shared core. Exposed via
 * `internal.integrations.composio.oauth.initiateOAuthForCreator` so the
 * webhook-secret-gated httpAction can call it through `ctx.runAction`
 * (httpActions can't run actions inline, but they can dispatch to internal
 * actions). Both the Clerk surface and Maya's surface end up here.
 */
export const initiateOAuthForCreator = internalAction({
  args: {
    creatorId: v.id("creators"),
    provider: PROVIDER_VALIDATOR,
    redirectUri: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ redirectUrl: string; state: string }> => {
    return await initiateOAuthForCreatorCore(ctx, args);
  },
});

/* -------------------------------------------------------------------------- */
/* startOAuth — public action (Clerk identity → creatorId)                     */
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
    return await initiateOAuthForCreatorCore(ctx, {
      creatorId: me._id,
      provider: args.provider,
      redirectUri: args.redirectUri,
    });
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
        args.provider === "gmail" || args.provider === "calendar" ? "pro" : "studio"
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

let __injectedClient: ComposioClient | null = null;

/**
 * Exported only for tests. Inject a stubbed ComposioClient that the
 * `initiateOAuthForCreator` internal action will use in place of
 * `getDefaultComposioClient()`. ALWAYS reset to `null` in `afterEach`.
 *
 * The override applies to the shared core (which both `startOAuth` and
 * `initiateOAuthForCreator` call) so tests cover both surfaces with one
 * stub.
 */
export function _setComposioClientForTests(
  client: ComposioClient | null
): void {
  __injectedClient = client;
}

function resolveComposioClient(): ComposioClient {
  return __injectedClient ?? getDefaultComposioClient();
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
