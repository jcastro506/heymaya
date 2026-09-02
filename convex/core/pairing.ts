/**
 * Telegram pairing for `convex/maya` (§18.9.25 screen ③).
 *
 * The founder taps a deep link, Telegram opens the bot with
 * `/start pair_<token>`, and the webhook exchanges that token for their chat id.
 * From that moment the product is a conversation and the web is just receipts.
 *
 * ## Why not reuse v1's pairing
 *
 * `gtmTelegramPairingTokens` requires an `agentId: v.id("gtmAgents")` — a row
 * type v2 creators don't have and shouldn't. Rather than mint a fake agent row
 * to satisfy a foreign key, the token lives on the creator, which is the thing
 * being paired.
 *
 * ## The token is one-shot
 *
 * Cleared the instant it's claimed. A pairing token that stays valid after use
 * is a token that can bind somebody else's chat to this account — and the chat
 * id is where every future message goes.
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, mutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Fifteen minutes. Long enough to walk to your phone, short enough that a link
 * left open in a browser tab overnight is dead.
 */
export const PAIRING_TTL_MS = 15 * 60_000;

function mintToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface PairingLink {
  ok: boolean;
  deepLink?: string;
  botUsername?: string;
  expiresAt?: number;
  error?: string;
}

/**
 * Mint (or reuse) a pairing link for the signed-in founder.
 *
 * Reuses a live token rather than minting on every render — otherwise a page
 * refresh invalidates the QR code someone is mid-scan of.
 */
export const createPairingLink = mutation({
  args: {},
  handler: async (ctx): Promise<PairingLink> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { ok: false, error: "tell me about your product first" };


    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    if (!botUsername) {
      // Named, not silent. A pairing screen that renders a broken link is worse
      // than one that says the bot isn't configured.
      return { ok: false, error: "the Telegram bot isn't configured on this deployment" };
    }

    const now = Date.now();
    const live =
      creator.pairingToken &&
      creator.pairingExpiresAt &&
      creator.pairingExpiresAt > now;

    const token = live ? creator.pairingToken! : mintToken();
    const expiresAt = live ? creator.pairingExpiresAt! : now + PAIRING_TTL_MS;

    if (!live) {
      await ctx.db.patch(creator._id, {
        pairingToken: token,
        pairingExpiresAt: expiresAt,
        updatedAt: now,
      });
    }

    return {
      ok: true,
      deepLink: `https://t.me/${botUsername}?start=pair_${encodeURIComponent(token)}`,
      botUsername,
      expiresAt,
    };
  },
});

/**
 * Claim a pairing token. Called from the Telegram webhook.
 *
 * Returns a `reason` on every refusal rather than a bare false — the webhook
 * replies to the founder with it, and "nothing happened" is the failure this
 * product exists to eliminate.
 */
export const claimPairing = internalMutation({
  args: { token: v.string(), chatId: v.string(), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    paired: boolean;
    reason?: string;
    /** So the caller can start her first run without a second lookup. */
    creatorId?: Id<"creators">;
  }> => {
    const now = args.now ?? Date.now();
    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_pairing_token", (q) => q.eq("pairingToken", args.token))
      .first()) as Doc<"creators"> | null;

    if (!creator) return { paired: false, reason: "that link isn't valid" };
    if (!creator.pairingExpiresAt || creator.pairingExpiresAt <= now) {
      // Clear the dead token so a stale link can't linger as a live row.
      await ctx.db.patch(creator._id, {
        pairingToken: undefined,
        pairingExpiresAt: undefined,
        updatedAt: now,
      });
      return { paired: false, reason: "that link expired — generate a new one" };
    }

    await ctx.db.patch(creator._id, {
      telegramChatId: args.chatId,
      channel: { paired: true, pairedAt: now },
      // One-shot. Cleared on claim, not on expiry.
      pairingToken: undefined,
      pairingExpiresAt: undefined,
      updatedAt: now,
    });
    // Everything written while unpaired (the first read, at least) goes out now.
    await ctx.runMutation(internal.core.jobs.wakeDeliveries, { creatorId: creator._id });
    return { paired: true, creatorId: creator._id };
  },
});
