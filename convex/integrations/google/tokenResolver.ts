/**
 * Google access token resolver (Sprint 9.8 Workstream A).
 *
 * Single source of truth for "give me a fresh access token for this
 * creator's Google connection." Wraps:
 *   1. Connection-row lookup (`latestCalendarConnectionForCreator`)
 *   2. Token decrypt
 *   3. Expiry check + refresh round-trip if needed
 *   4. Optional scope assertion (e.g. "gmail.modify must be in the
 *      granted scope set")
 *
 * Used by every Gmail HTTP endpoint (gmail_list_inbox / get_message /
 * draft / send). Calendar code in `creatorMayaV0/backend.ts` continues to
 * use its inline refresh path for now; a future refactor can route both
 * through this resolver.
 *
 * The connection row is named `creatorMayaV0CalendarConnections` for
 * historical reasons — it now stores tokens that cover BOTH Calendar AND
 * Gmail (per the unified `GOOGLE_OAUTH_SCOPES` set in `lcMayaHttp.ts`).
 * The `scope` field on the row is the source of truth for what APIs the
 * token can hit.
 */

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { Id } from "../../_generated/dataModel";
import { decrypt, encrypt } from "../../lib/encryption";

/** Refresh 5 min before nominal expiry to avoid races near the boundary. */
const EXPIRY_SAFETY_BUFFER_MS = 5 * 60 * 1000;

/** Distinguish between recoverable and operator-blocked errors so the
 *  HTTP layer can return the right status. */
export type TokenResolveError =
  | "no-connection"
  | "no-refresh-token"
  | "scope-missing"
  | "refresh-failed"
  | "missing-google-creds";

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

/**
 * Returns a fresh access token + the granted scope string. If
 * `requiredScope` is provided and isn't in the granted scope set, throws
 * `scope-missing` so the caller can surface a clear error to Maya (which
 * then surfaces a clear error to the creator: "you connected Calendar but
 * not Gmail — re-consent to enable brand-deal triage").
 */
export const resolveGoogleAccessTokenForCreator = internalAction({
  args: {
    creatorId: v.id("creators"),
    /** e.g. "https://www.googleapis.com/auth/gmail.modify" — full URI form. */
    requiredScope: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    accessToken: string;
    grantedScopes: string[];
    externalAccountId?: string;
  }> => {
    const connection = await ctx.runQuery(
      internal.creatorMayaV0.backend.latestCalendarConnectionForCreator,
      { creatorId: args.creatorId }
    );
    if (!connection) {
      throw new Error("no-connection");
    }

    const grantedScopes = (connection.oauthScope ?? "")
      .split(/\s+/)
      .filter((s) => s.length > 0);

    if (
      args.requiredScope &&
      !grantedScopes.includes(args.requiredScope)
    ) {
      throw new Error("scope-missing");
    }

    const now = Date.now();
    const needsRefresh =
      typeof connection.oauthExpiresAt === "number" &&
      connection.oauthExpiresAt - EXPIRY_SAFETY_BUFFER_MS <= now;

    if (!needsRefresh) {
      if (!connection.oauthAccessToken) {
        throw new Error("no-connection");
      }
      const accessToken = await decrypt(connection.oauthAccessToken);
      return {
        accessToken,
        grantedScopes,
        externalAccountId: connection.externalAccountId,
      };
    }

    // Refresh path.
    if (!connection.oauthRefreshToken) {
      throw new Error("no-refresh-token");
    }
    const refreshToken = await decrypt(connection.oauthRefreshToken);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("missing-google-creds");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!tokenResponse.ok) {
      const text = await tokenResponse.text().catch(() => "");
      throw new Error(
        `refresh-failed: ${tokenResponse.status} ${text.slice(0, 200)}`
      );
    }
    const token = (await tokenResponse.json()) as GoogleTokenResponse;
    const expiresAt =
      typeof token.expires_in === "number"
        ? Date.now() + token.expires_in * 1000
        : undefined;

    await ctx.runMutation(
      internal.creatorMayaV0.backend.refreshGoogleCalendarAccessTokenForCreator,
      {
        connectionId: connection._id,
        encryptedAccessToken: await encrypt(token.access_token),
        expiresAt,
        tokenType: token.token_type,
        scope: token.scope,
      }
    );

    // The refresh response may include UPDATED scopes (Google returns the
    // current consent state). Use whatever Google says we have now.
    const refreshedScopes = (token.scope ?? connection.oauthScope ?? "")
      .split(/\s+/)
      .filter((s) => s.length > 0);

    if (
      args.requiredScope &&
      !refreshedScopes.includes(args.requiredScope)
    ) {
      throw new Error("scope-missing");
    }

    return {
      accessToken: token.access_token,
      grantedScopes: refreshedScopes,
      externalAccountId: connection.externalAccountId,
    };
  },
});
