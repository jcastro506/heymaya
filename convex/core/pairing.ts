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
import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { pairingSmsLink } from "./imessage";

/**
 * Fifteen minutes. Long enough to walk to your phone, short enough that a link
 * left open in a browser tab overnight is dead.
 */
export const PAIRING_TTL_MS = 15 * 60_000;

/** What she says the moment they pair, before the read is done. */
export const HELLO = "hey! i'm maya, your content person now. every day i'll scroll for you: what's actually working in your lane, what's blowing up in general, who's doing something worth stealing. i keep your content calendar, i bring you ideas, and you can throw anything at me (a draft, a link, a half-thought) for a straight opinion.\n---\ni'm going through your posts and the accounts you picked right now. give me about ten minutes and i'll tell you what i see. what should i call you, by the way?";

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
  /** §23: which app the link opens; a phone channel carries the line's number for the page to show. */
  kind?: "telegram" | "imessage";
  lineNumber?: string;
  token?: string;
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


    const minted = await mintPairing(ctx, creator);
    if (!minted.ok) return { ok: false, error: minted.error };
    return { ok: true, deepLink: minted.deepLink, botUsername: minted.botUsername, expiresAt: minted.expiresAt, kind: minted.kind, lineNumber: minted.lineNumber, token: minted.token };
  },
});

/** The token the done screen mints, as one function the form and a rehearsal both call. */
export async function mintPairing(ctx: MutationCtx, creator: Doc<"creators">): Promise<{ ok: true; token: string; deepLink: string; botUsername: string; expiresAt: number; kind: "telegram" | "imessage"; lineNumber?: string } | { ok: false; error: string }> {
  const now0 = Date.now();
  // §23: a creator who gave a phone number pairs by texting the line; the token rides in the first text.
  if (creator.channel.kind === "imessage") {
    const lineNumber = process.env.CLAW_LINE_NUMBER;
    if (!lineNumber) return { ok: false, error: "the phone channel isn't configured on this deployment" };
    const live = creator.pairingToken && creator.pairingExpiresAt && creator.pairingExpiresAt > now0;
    const token = live ? creator.pairingToken! : mintToken();
    const expiresAt = live ? creator.pairingExpiresAt! : now0 + PAIRING_TTL_MS;
    if (!live) await ctx.db.patch(creator._id, { pairingToken: token, pairingExpiresAt: expiresAt, updatedAt: now0 });
    return { ok: true, token, deepLink: pairingSmsLink(lineNumber, token), botUsername: "", expiresAt, kind: "imessage", lineNumber };
  }
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (!botUsername) {
    // Named, not silent. A pairing screen that renders a broken link is worse
    // than one that says the bot isn't configured.
    return { ok: false, error: "the Telegram bot isn't configured on this deployment" };
  }
  const now = Date.now();
  const live = creator.pairingToken && creator.pairingExpiresAt && creator.pairingExpiresAt > now;
  const token = live ? creator.pairingToken! : mintToken();
  const expiresAt = live ? creator.pairingExpiresAt! : now + PAIRING_TTL_MS;
  if (!live) await ctx.db.patch(creator._id, { pairingToken: token, pairingExpiresAt: expiresAt, updatedAt: now });
  return { ok: true, token, deepLink: `https://t.me/${botUsername}?start=pair_${encodeURIComponent(token)}`, botUsername, expiresAt, kind: "telegram" };
}

/**
 * §23: pair a phone. By token when the START text carried one (the pairing screen), by the
 * number they typed at onboarding otherwise (they texted "hey" instead). A phone belongs to
 * exactly one creator, same rule as a chat: re-pairing moves it, never shares it.
 */
export const claimPairingByPhone = internalMutation({
  args: { token: v.optional(v.string()), phone: v.string(), service: v.optional(v.string()), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ paired: boolean; reason?: string; creatorId?: Id<"creators"> }> => {
    const now = args.now ?? Date.now();
    let creator: Doc<"creators"> | null = null;
    if (args.token) {
      creator = (await ctx.db.query("creators").withIndex("by_pairing_token", (q) => q.eq("pairingToken", args.token)).first()) as Doc<"creators"> | null;
      if (!creator) return { paired: false, reason: "that link isn't valid" };
      if (!creator.pairingExpiresAt || creator.pairingExpiresAt <= now) {
        await ctx.db.patch(creator._id, { pairingToken: undefined, pairingExpiresAt: undefined, updatedAt: now });
        return { paired: false, reason: "that link expired — generate a new one" };
      }
    } else {
      creator = (await ctx.db.query("creators").withIndex("by_phone", (q) => q.eq("phone", args.phone)).first()) as Doc<"creators"> | null;
      if (!creator) return { paired: false, reason: "I don't know that number" };
      if (creator.channel.kind !== "imessage") return { paired: false, reason: "this account is on Telegram" };
    }
    const others = (await ctx.db.query("creators").withIndex("by_phone", (q) => q.eq("phone", args.phone)).collect()) as Doc<"creators">[];
    for (const other of others) {
      if (other._id === creator._id) continue;
      console.warn(`[pairing] phone moved from creator ${other._id} to ${creator._id}`);
      await ctx.db.patch(other._id, { phone: undefined, channel: { ...other.channel, paired: false, broken: true }, updatedAt: now });
    }
    await ctx.db.patch(creator._id, { phone: args.phone, phoneVerifiedAt: now, channel: { paired: true, pairedAt: now, kind: "imessage" }, pairingToken: undefined, pairingExpiresAt: undefined, updatedAt: now });
    const firstRead = await ctx.db.query("messages").withIndex("by_creator_and_dedupe", (q) => q.eq("creatorId", creator._id).eq("dedupeKey", `first_read:${creator._id}`)).first();
    if (!firstRead) {
      await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "imessage", body: HELLO, dedupeKey: `hello:${creator._id}`, proactive: true, kind: "status" });
    }
    await ctx.runMutation(internal.core.jobs.enqueue, { kind: "first_read", idempotencyKey: `first_read:${creator._id}`, creatorId: creator._id, payloadJson: JSON.stringify({ phone: args.phone, service: args.service ?? null }) });
    await ctx.runMutation(internal.core.jobs.wakeDeliveries, { creatorId: creator._id });
    await ctx.scheduler.runAfter(0, internal.core.scheduler.drainJobs, { kinds: ["deliver_message"] });
    return { paired: true, creatorId: creator._id };
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

    /**
     * ⚠️ A Telegram chat belongs to exactly ONE creator. Inbound routing resolves a chat
     * with `.first()`, so a second creator on the same chat means their replies land on
     * whichever row the index happens to return, and BOTH send proactive messages to the
     * same person. Found on the dev deployment with two creators sharing one chat and the
     * operator getting a jumble of both. Re-pairing moves the chat; it never shares it.
     */
    const others = (await ctx.db
      .query("creators")
      .withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", args.chatId))
      .collect()) as Doc<"creators">[];
    for (const other of others) {
      if (other._id === creator._id) continue;
      console.warn(`[pairing] chat ${args.chatId} moved from creator ${other._id} to ${creator._id}`);
      await ctx.db.patch(other._id, { telegramChatId: undefined, channel: { paired: false }, updatedAt: now });
    }

    await ctx.db.patch(creator._id, {
      telegramChatId: args.chatId,
      channel: { paired: true, pairedAt: now },
      // One-shot. Cleared on claim, not on expiry.
      pairingToken: undefined,
      pairingExpiresAt: undefined,
      updatedAt: now,
    });
    // First contact. If her first read has not been written yet, she says hello now and
    // what she is doing, so pairing is never followed by silence. Once, ever.
    const firstRead = await ctx.db.query("messages").withIndex("by_creator_and_dedupe", (q) => q.eq("creatorId", creator._id).eq("dedupeKey", `first_read:${creator._id}`)).first();
    if (!firstRead) {
      await ctx.runMutation(internal.core.messages.send, {
        creatorId: creator._id,
        surface: "telegram",
        body: HELLO,
        dedupeKey: `hello:${creator._id}`,
        proactive: true,
        kind: "status",
      });
    }
    // Everything written while unpaired (the first read, at least) goes out now, not at the
    // next minute tick, and not behind whatever long job the drain is on.
    await ctx.runMutation(internal.core.jobs.wakeDeliveries, { creatorId: creator._id });
    await ctx.scheduler.runAfter(0, internal.core.scheduler.drainJobs, { kinds: ["deliver_message"] });
    return { paired: true, creatorId: creator._id };
  },
});
