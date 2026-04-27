/**
 * Zernio OAuth — connect / handle-callback / revoke.
 *
 * Sprint 1 (service product). Convex actions that wrap Zernio's hosted
 * connect flow. The frontend kicks the user out to Zernio's hosted page,
 * Zernio redirects back to our callback URL with a `code` + `state`, and we
 * exchange them for a Zernio account id + per-platform connection list.
 *
 * Flow:
 *   1. Frontend calls `zernioStartConnect({ platforms: ["gbp","facebook"] })`.
 *      - Resolve signed-in Clerk identity → creators row (account-level).
 *      - Resolve `creators.businessId` → businesses row (must be
 *        `accountType: "service-business"`).
 *      - Plan-tier-gate per requested platform — non-GBP requires Pro+.
 *      - POST to Zernio `/api/v1/connect/initiate` with the operator's
 *        per-business secrets and the requested platform set. Zernio
 *        returns a hosted URL + opaque state.
 *   2. Browser opens URL, operator OAuths each platform inside Zernio's UI.
 *   3. Zernio redirects back with `code` + `state`. Frontend forwards both
 *      to `zernioHandleCallback`.
 *      - Exchange code → account id + per-platform connection ids.
 *      - Persist encrypted API key + connectedPlatforms in
 *        `zernioConnections` for THIS business.
 *   4. `zernioRevoke({ platform })` removes a single platform without
 *      tearing down the whole connection.
 *
 * Cross-tenant safety: every step re-resolves business via Clerk identity
 * → creators → businessId. The frontend never asserts "this is business X" —
 * Clerk subject is the only authority.
 *
 * Plan-tier safety:
 *   - All tiers: GBP read + GBP write (review-reply auto-approval-gated).
 *   - Pro+:    FB / IG (write).
 *   - Studio:  TikTok / LinkedIn / X / Pinterest / Threads.
 *
 * The platform-tier mapping mirrors `planFeaturesService(business)` (§ 3
 * pricing matrix): Starter is GBP-only, Pro adds 2 social slots, Studio
 * unlocks all platforms.
 */

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { encrypt } from "../../lib/encryption";
import {
  PlanServiceGateError,
  planFeaturesService,
} from "../../planService";
import { ZernioClient, sha256Hex } from "./client";
import { ZernioApiError, ZernioAuthError, type ZernioPlatform } from "./types";

const ZERNIO_PLATFORM_VALIDATOR = v.union(
  v.literal("gbp"),
  v.literal("facebook"),
  v.literal("instagram"),
  v.literal("tiktok"),
  v.literal("linkedin"),
  v.literal("x"),
  v.literal("pinterest"),
  v.literal("threads")
);

const ZERNIO_STATUS_VALIDATOR = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("expired")
);

/**
 * Plan-tier requirement per platform. Mirrors § 3 pricing matrix.
 *
 *   GBP     → all tiers (Starter is GBP-only).
 *   FB/IG   → Pro+    (Starter `maxSocialPlatforms = 0`).
 *   The rest → Studio (Starter/Pro `maxSocialPlatforms` is bounded; Studio
 *             is `unlimited`).
 *
 * The non-GBP enforcement chains through `planFeaturesService.maxSocialPlatforms`
 * — we count requested non-GBP platforms and enforce the max.
 */
function requireTierForPlatform(
  business: Doc<"businesses">,
  platform: ZernioPlatform
): void {
  const features = planFeaturesService(business);
  if (platform === "gbp") return; // all tiers
  // Non-GBP — Pro+ minimum (Starter has maxSocialPlatforms === 0).
  if (features.maxSocialPlatforms === 0) {
    throw new PlanServiceGateError(
      features.plan,
      `zernio:connect:${platform}`,
      "pro"
    );
  }
  // Studio-only platforms — TikTok, LinkedIn, X, Pinterest, Threads. Pro
  // gets up to 2 non-GBP slots; Studio is `"unlimited"` for ALL platforms.
  // Per § 3 headline copy, the Pro tier surfaces "all 4 channels" (text +
  // multi-platform) but with a 2-platform budget; Studio takes "all
  // channels" off the leash. The tightest reading is that the *unbounded*
  // platforms (everything beyond GBP/FB/IG) are Studio-only, since Pro's
  // 2-social-slot allowance is most naturally spent on the FB+IG pair
  // (where the operator already has reach) rather than long-tail X/Pin/etc.
  // Live operators on Pro can still spend a slot on, say, LinkedIn; this
  // gate enforces the hard ceiling.
  const STUDIO_ONLY_PLATFORMS: ReadonlyArray<ZernioPlatform> = [
    "tiktok",
    "linkedin",
    "x",
    "pinterest",
    "threads",
  ];
  if (
    STUDIO_ONLY_PLATFORMS.includes(platform) &&
    features.maxSocialPlatforms !== "unlimited"
  ) {
    throw new PlanServiceGateError(
      features.plan,
      `zernio:connect:${platform}`,
      "studio"
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Internal helpers — Clerk identity → business resolution                     */
/* -------------------------------------------------------------------------- */

export const getMyBusinessForOAuth = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    business: Doc<"businesses">;
    accountId: Id<"creators">;
  } | null> => {
    const account = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!account) return null;
    if (account.accountType !== "service-business" || !account.businessId) {
      return null;
    }
    const business = await ctx.db.get(account.businessId);
    if (!business) return null;
    return { business, accountId: account._id };
  },
});

/**
 * Internal mutation — upsert the per-business `zernioConnections` row at
 * OAuth-callback time. Cross-tenant safe because the caller pre-resolved
 * `businessId` from Clerk identity.
 */
export const upsertZernioConnection = internalMutation({
  args: {
    businessId: v.id("businesses"),
    zernioAccountId: v.string(),
    encryptedApiKey: v.string(),
    apiKeyHash: v.string(),
    encryptedWebhookSecret: v.optional(v.string()),
    connectedPlatforms: v.array(
      v.object({
        platform: ZERNIO_PLATFORM_VALIDATOR,
        platformAccountId: v.string(),
        displayName: v.optional(v.string()),
        status: ZERNIO_STATUS_VALIDATOR,
        connectedAt: v.number(),
        revokedAt: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args): Promise<Id<"zernioConnections">> => {
    const existing = await ctx.db
      .query("zernioConnections")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    const now = Date.now();
    if (existing) {
      // Merge connectedPlatforms — incoming entries overwrite existing ones
      // matched on (platform, platformAccountId). Anything not in the
      // incoming set keeps its prior status (so a partial-platform connect
      // doesn't accidentally revoke a previously connected platform).
      const merged = [...existing.connectedPlatforms];
      for (const incoming of args.connectedPlatforms) {
        const idx = merged.findIndex(
          (p) =>
            p.platform === incoming.platform &&
            p.platformAccountId === incoming.platformAccountId
        );
        if (idx >= 0) {
          merged[idx] = incoming;
        } else {
          merged.push(incoming);
        }
      }
      await ctx.db.patch(existing._id, {
        zernioAccountId: args.zernioAccountId,
        encryptedApiKey: args.encryptedApiKey,
        apiKeyHash: args.apiKeyHash,
        encryptedWebhookSecret: args.encryptedWebhookSecret,
        connectedPlatforms: merged,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("zernioConnections", {
      businessId: args.businessId,
      zernioAccountId: args.zernioAccountId,
      encryptedApiKey: args.encryptedApiKey,
      apiKeyHash: args.apiKeyHash,
      encryptedWebhookSecret: args.encryptedWebhookSecret,
      connectedPlatforms: args.connectedPlatforms,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Mark a single platform `revoked` on the existing connection.
 */
export const revokeZernioPlatform = internalMutation({
  args: {
    businessId: v.id("businesses"),
    platform: ZERNIO_PLATFORM_VALIDATOR,
  },
  handler: async (
    ctx,
    args
  ): Promise<{ revoked: boolean; reason?: string }> => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    if (!row) return { revoked: false, reason: "no_connection" };
    const next = row.connectedPlatforms.map((p) =>
      p.platform === args.platform && p.status !== "revoked"
        ? { ...p, status: "revoked" as const, revokedAt: Date.now() }
        : p
    );
    await ctx.db.patch(row._id, {
      connectedPlatforms: next,
      updatedAt: Date.now(),
    });
    return { revoked: true };
  },
});

/* -------------------------------------------------------------------------- */
/* zernioStartConnect — public action                                          */
/* -------------------------------------------------------------------------- */

const ZERNIO_BUILD_API_KEY_ENV = "ZERNIO_PROVISIONING_API_KEY";
const ZERNIO_REDIRECT_BASE_URL_ENV = "ZERNIO_OAUTH_REDIRECT_BASE_URL";

function readProvisioningApiKey(): string {
  const v = process.env[ZERNIO_BUILD_API_KEY_ENV];
  if (!v) {
    // Distinct error: this is the workspace-level key the operator pastes
    // into Convex env after creating their Zernio Build-tier account; it
    // bootstraps the per-business keys via the connect flow. Without it
    // the entire onboarding pipeline can't start.
    throw new ZernioAuthError(
      `Zernio: ${ZERNIO_BUILD_API_KEY_ENV} is not set. ` +
        "Operator must create a Zernio Build-tier account, copy the workspace " +
        "API key, and set it in the Convex deployment env."
    );
  }
  return v;
}

/**
 * Kick off the Zernio hosted OAuth flow. Returns a URL the frontend should
 * redirect the user's browser to. The operator OAuths each requested
 * platform inside Zernio's UI; Zernio redirects back to `redirectUri` with
 * `code` + `state`.
 */
export const zernioStartConnect = action({
  args: {
    platforms: v.array(ZERNIO_PLATFORM_VALIDATOR),
    /**
     * Where Zernio redirects after consent. Frontend supplies the route
     * that captures `code` + `state` and forwards to `zernioHandleCallback`.
     */
    redirectUri: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ redirectUrl: string; state: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Zernio: not authenticated.");
    }
    const ctxRow: {
      business: Doc<"businesses">;
      accountId: Id<"creators">;
    } | null = await ctx.runQuery(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: identity.subject }
    );
    if (!ctxRow) {
      throw new Error("Zernio: no service-business row for signed-in user.");
    }
    if (args.platforms.length === 0) {
      throw new Error("Zernio: at least one platform must be requested.");
    }
    for (const p of args.platforms) {
      requireTierForPlatform(ctxRow.business, p);
    }

    const apiKey = readProvisioningApiKey();
    const client = new ZernioClient({ apiKey });

    // Zernio hosted-connect initiate.
    // [unverified — exact endpoint shape; live-smoke confirms.]
    const init = await client.request<{
      redirectUrl?: string;
      authUrl?: string;
      url?: string;
      state?: string;
      sessionId?: string;
    }>("/api/v1/connect/initiate", {
      method: "POST",
      body: {
        platforms: args.platforms,
        callbackUrl: args.redirectUri,
        // Tag the session with our business id so the callback can correlate
        // even if state is stripped.
        metadata: {
          businessId: String(ctxRow.business._id),
        },
      },
    });

    const redirectUrl = init.redirectUrl ?? init.authUrl ?? init.url;
    const state = init.state ?? init.sessionId;
    if (!redirectUrl || !state) {
      throw new ZernioApiError(
        200,
        "/api/v1/connect/initiate",
        "Zernio did not return a redirect URL + state."
      );
    }
    return { redirectUrl, state };
  },
});

/* -------------------------------------------------------------------------- */
/* zernioHandleCallback — public action                                        */
/* -------------------------------------------------------------------------- */

export const zernioHandleCallback = action({
  args: {
    code: v.string(),
    state: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    connectionRowId: Id<"zernioConnections">;
    connectedPlatforms: ZernioPlatform[];
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Zernio: not authenticated.");
    }
    const ctxRow: {
      business: Doc<"businesses">;
      accountId: Id<"creators">;
    } | null = await ctx.runQuery(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: identity.subject }
    );
    if (!ctxRow) {
      throw new Error("Zernio: no service-business row for signed-in user.");
    }

    const apiKey = readProvisioningApiKey();
    const client = new ZernioClient({ apiKey });

    const exchange = await client.request<{
      accountId?: string;
      profileId?: string;
      apiKey?: string;
      perAccountApiKey?: string;
      webhookSecret?: string;
      connectedPlatforms?: Array<{
        platform?: string;
        platformAccountId?: string;
        accountId?: string;
        displayName?: string;
        connectedAt?: string | number;
      }>;
    }>("/api/v1/connect/callback", {
      method: "POST",
      body: { code: args.code, state: args.state },
    });

    const zernioAccountId = exchange.accountId ?? exchange.profileId;
    const perBusinessApiKey = exchange.perAccountApiKey ?? exchange.apiKey;
    if (!zernioAccountId || !perBusinessApiKey) {
      throw new ZernioApiError(
        200,
        "/api/v1/connect/callback",
        "Zernio callback did not return accountId + per-business apiKey."
      );
    }
    const platforms = (exchange.connectedPlatforms ?? [])
      .map((row) => {
        if (!row.platform) return null;
        if (
          row.platform !== "gbp" &&
          row.platform !== "facebook" &&
          row.platform !== "instagram" &&
          row.platform !== "tiktok" &&
          row.platform !== "linkedin" &&
          row.platform !== "x" &&
          row.platform !== "pinterest" &&
          row.platform !== "threads"
        ) {
          return null;
        }
        const platformAccountId = row.platformAccountId ?? row.accountId;
        if (!platformAccountId) return null;
        const connectedAt =
          typeof row.connectedAt === "number"
            ? row.connectedAt
            : row.connectedAt
              ? Date.parse(row.connectedAt)
              : Date.now();
        return {
          platform: row.platform as ZernioPlatform,
          platformAccountId,
          displayName: row.displayName,
          status: "active" as const,
          connectedAt: Number.isFinite(connectedAt)
            ? connectedAt
            : Date.now(),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (platforms.length === 0) {
      throw new ZernioApiError(
        200,
        "/api/v1/connect/callback",
        "Zernio callback returned zero connected platforms."
      );
    }

    // Defense-in-depth: re-check tier on each completed platform. A bug in
    // `start` that let an over-tier platform through gets caught here.
    for (const p of platforms) {
      requireTierForPlatform(ctxRow.business, p.platform);
    }

    const encryptedApiKey = await encrypt(perBusinessApiKey);
    const apiKeyHash = await sha256Hex(perBusinessApiKey);
    const encryptedWebhookSecret = exchange.webhookSecret
      ? await encrypt(exchange.webhookSecret)
      : undefined;

    const rowId: Id<"zernioConnections"> = await ctx.runMutation(
      internal.integrations.zernio.oauth.upsertZernioConnection,
      {
        businessId: ctxRow.business._id,
        zernioAccountId,
        encryptedApiKey,
        apiKeyHash,
        encryptedWebhookSecret,
        connectedPlatforms: platforms,
      }
    );
    return {
      connectionRowId: rowId,
      connectedPlatforms: platforms.map((p) => p.platform),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* zernioRevoke — public action                                                */
/* -------------------------------------------------------------------------- */

export const zernioRevoke = action({
  args: {
    platform: ZERNIO_PLATFORM_VALIDATOR,
  },
  handler: async (
    ctx,
    args
  ): Promise<{ revoked: boolean; reason?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Zernio: not authenticated.");
    }
    const ctxRow: {
      business: Doc<"businesses">;
      accountId: Id<"creators">;
    } | null = await ctx.runQuery(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: identity.subject }
    );
    if (!ctxRow) {
      throw new Error("Zernio: no service-business row for signed-in user.");
    }
    return await ctx.runMutation(
      internal.integrations.zernio.oauth.revokeZernioPlatform,
      {
        businessId: ctxRow.business._id,
        platform: args.platform,
      }
    );
  },
});

/* Test seam — internal-only revoke without auth, used by webhook handler  */
/* when Zernio reports `account.disconnected` for a platform.              */
export const onZernioAccountDisconnected = internalMutation({
  args: {
    zernioAccountId: v.string(),
    platform: ZERNIO_PLATFORM_VALIDATOR,
  },
  handler: async (
    ctx,
    args
  ): Promise<{ revoked: boolean }> => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_zernio_account_id", (q) =>
        q.eq("zernioAccountId", args.zernioAccountId)
      )
      .first();
    if (!row) return { revoked: false };
    const next = row.connectedPlatforms.map((p) =>
      p.platform === args.platform && p.status !== "revoked"
        ? { ...p, status: "revoked" as const, revokedAt: Date.now() }
        : p
    );
    await ctx.db.patch(row._id, {
      connectedPlatforms: next,
      updatedAt: Date.now(),
    });
    return { revoked: true };
  },
});
