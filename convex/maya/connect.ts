/**
 * ⭐ Connect a channel — §18.9.25 ⑥, the make-or-break step.
 *
 * > §6.0.1 step 7: *"**Connect.** OAuth. The make-or-break step. Say the
 * > account requirements BEFORE the OAuth redirect (§6.0.15)."*
 *
 * ## What was missing
 *
 * `getConnectUrl` has existed and been verified live since 2026-06-02, but it
 * requires a `profileId` — and the live module had nowhere to put one.
 * `zernioProfileId` lived on the gtm-era row only, so the new product could
 * read channels and never connect one.
 *
 * ## ⚠️ The profile is the tenant boundary, not a detail
 *
 * One Zernio API key covers the entire fleet. A profile is what separates one
 * customer's connected accounts from another's at the vendor. Get it wrong and
 * `GET /api/v1/accounts` hands you everyone's accounts — which is exactly the
 * bug `channels.syncChannels` carried until today.
 *
 * So it is created once, never reassigned, and every read that touches vendor
 * accounts passes it.
 */

import { v } from "convex/values";
import { action, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  CHANNEL_REQUIREMENTS,
  noticesFor,
  type Channel,
} from "./channelRequirements";

/** Our channel names → Zernio's wire slugs. X is `twitter` on the wire. */
const CHANNEL = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("youtube"),
  v.literal("x"),
);

/**
 * ⭐ Begin an OAuth connect, and say what the account must be first.
 *
 * Returns the notices alongside the URL rather than assuming the caller
 * remembered to show them. §6.0.15's whole point is that the requirement is
 * stated **before** the redirect — a surface that could get the URL without the
 * sentences is a surface that will eventually ship without them.
 */
export const startConnect = action({
  args: { channel: CHANNEL },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    authUrl?: string;
    notices?: string[];
    error?: string;
  }> => {
    const scope = await ctx.runQuery(internal.maya.connect.myConnectScope, {});
    if (!scope.ok || !scope.customerId) {
      return { ok: false, error: scope.error ?? "no account yet" };
    }

    const apiKey = process.env.ZERNIO_API_KEY;
    if (!apiKey) {
      // Plain language. The founder did not configure our vendor keys (§11).
      return { ok: false, error: "connecting isn't available right now" };
    }

    /**
     * ⚠️ `APP_URL` is the established variable and it must be ABSOLUTE — the
     * vendor redirects the founder's browser to it after OAuth. My first draft
     * read a `SITE_URL` that does not exist, which would have sent a relative
     * path as `redirect_url`: the connect succeeds and the founder lands
     * nowhere, which is the least debuggable possible outcome.
     */
    const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(appUrl)) {
      console.error("startConnect: APP_URL is unset or not absolute");
      return { ok: false, error: "connecting isn't available right now" };
    }

    const { ZernioClient } = await import("../integrations/zernio/client");
    const { createProfile, getConnectUrl } =
      await import("../integrations/zernio/endpoints");
    const client = new ZernioClient({ apiKey });

    let profileId = scope.zernioProfileId;
    try {
      if (!profileId) {
        /**
         * Created on first connect, not at signup: a customer who never
         * connects anything should not leave a profile behind at the vendor.
         *
         * ⚠️ Named by customer id. Two customers with the same product name
         * must not collide into one profile — that would merge two founders'
         * accounts, which is the failure this whole field exists to prevent.
         */
        const profile = await createProfile(client, {
          name: `maya-${scope.customerId}`,
          description: "HeyMaya managed profile",
        });
        profileId = profile._id;
        await ctx.runMutation(internal.maya.channels.setProfileId, {
          customerId: scope.customerId,
          zernioProfileId: profileId,
        });
      }

      const { authUrl } = await getConnectUrl(
        client,
        // Zernio's own slug mapping handles `x` → `twitter`.
        args.channel as never,
        profileId,
        /**
         * Back to the connect screen. No state token and no bespoke callback:
         * `syncChannels` re-reads the account list scoped to this profile and
         * is already the single source of truth, so the return trip only has
         * to trigger a sync rather than carry the result.
         */
        `${appUrl}/connect?returned=${args.channel}`,
      );

      return {
        ok: true,
        authUrl,
        notices: noticesFor(args.channel as Channel),
      };
    } catch (error) {
      /**
       * ⚠️ Never the vendor's error text. §11 — "Zernio returned 402" is our
       * problem described in our vocabulary, and the founder can do nothing
       * with it.
       */
      console.error("startConnect failed", error);
      return {
        ok: false,
        error: "I couldn't start that connection — try again?",
      };
    }
  },
});

/**
 * Resolve the signed-in customer and its profile in one query.
 *
 * ⚠️ The action takes no `customerId`. Same rule as the export and the agent
 * tool surface: an id in the request body is an id somebody can change.
 */
export const myConnectScope = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    ok: boolean;
    customerId?: Id<"customers">;
    zernioProfileId?: string;
    error?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };

    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator) return { ok: false, error: "no account yet" };

    const customer = await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!customer) return { ok: false, error: "no account yet" };

    return {
      ok: true,
      customerId: customer._id,
      zernioProfileId: customer.zernioProfileId,
    };
  },
});

/** Re-read this customer's accounts after they come back from OAuth. */
export const refreshMyChannels = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; error?: string }> => {
    const scope = await ctx.runQuery(internal.maya.connect.myConnectScope, {});
    if (!scope.ok || !scope.customerId) {
      return { ok: false, error: scope.error ?? "no account yet" };
    }
    await ctx.runAction(internal.maya.channels.syncChannels, {
      customerId: scope.customerId,
    });
    return { ok: true };
  },
});

/** Everything a connect card needs to render, without a network call. */
export function cardFor(channel: Channel) {
  return {
    channel,
    notices: noticesFor(channel),
    permanentLimit: CHANNEL_REQUIREMENTS[channel].permanentLimit,
  };
}
