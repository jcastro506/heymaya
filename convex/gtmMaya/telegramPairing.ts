import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildPairingDeepLink,
  resolveTelegramBotIdentity,
  type TelegramBotIdentity,
} from "../integrations/telegram/client";

/**
 * Sprint 15 (Part II D1 of CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md).
 *
 * Telegram pairing flow:
 *
 *   1. User completes intake → `createPairingToken` mints a random 32-byte
 *      base64url token tied to their gtmAgents row, TTL 15 minutes.
 *   2. UI renders a "Open Maya in Telegram" deep link
 *      (https://t.me/<bot>?start=pair_<token>).
 *   3. User taps; Telegram delivers `/start pair_<token>` to the bot.
 *   4. The webhook route resolves the token, calls `claimPairingToken` with
 *      the chat_id, and atomically binds the chat to the agent.
 *   5. Subsequent attempts to claim the same token throw; expired tokens
 *      throw; cross-agent claims throw.
 *
 * Token lifetime is short on purpose. Anything longer increases the
 * surface for token leaks (e.g. someone copying the URL).
 */

const PAIRING_TTL_MS = 15 * 60 * 1000;

export interface CreatePairingTokenResult {
  token: string;
  deepLink: string;
  expiresAt: number;
  botUsername: string;
}

async function requireMyGtmAgent(
  ctx: MutationCtx
): Promise<{ creator: Doc<"creators">; agent: Doc<"gtmAgents"> }> {
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
  if (!agent) throw new Error("GTM agent row not found; complete onboarding");
  return { creator, agent };
}

function mintToken(): string {
  // 32 bytes -> 43 base64url chars. Crypto-strong; no padding.
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
 * Resolve the bot identity for the current deployment, or throw if env is
 * misconfigured. Surfaced so callers (HTTP routes, smoke scripts) can
 * fail-fast rather than silently send to nowhere.
 */
export function requireTelegramBot(
  env: Partial<Record<string, string | undefined>> = process.env
): TelegramBotIdentity {
  const identity = resolveTelegramBotIdentity(env);
  if (!identity) {
    throw new Error(
      "Telegram bot identity not configured. Set TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_USERNAME (or env-specific *_STAGING/_PRODUCTION variants) on the Convex deployment."
    );
  }
  return identity;
}

/**
 * User-facing mutation. Mints a fresh single-use pairing token and returns
 * the deep link the UI should render. Idempotent within a small window —
 * if there's an unclaimed unexpired token for the agent, return it instead
 * of minting a new one, so a refresh doesn't blow away the user's tap.
 */
export const createPairingToken = mutation({
  args: {},
  handler: async (ctx): Promise<CreatePairingTokenResult> => {
    const { creator, agent } = await requireMyGtmAgent(ctx);
    const now = Date.now();
    const bot = requireTelegramBot();

    // Reuse an unclaimed, unexpired token if one exists. Telegram pairing
    // is rarely contested per-user so this is the common path.
    const existing = await ctx.db
      .query("gtmTelegramPairingTokens")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect();
    const live = existing.find(
      (row) => !row.claimedAt && row.expiresAt > now
    );
    if (live) {
      return {
        token: live.token,
        deepLink: buildPairingDeepLink(bot, live.token),
        expiresAt: live.expiresAt,
        botUsername: bot.username,
      };
    }

    const token = mintToken();
    const expiresAt = now + PAIRING_TTL_MS;
    await ctx.db.insert("gtmTelegramPairingTokens", {
      accountId: creator._id,
      agentId: agent._id,
      token,
      expiresAt,
      createdAt: now,
    });
    return {
      token,
      deepLink: buildPairingDeepLink(bot, token),
      expiresAt,
      botUsername: bot.username,
    };
  },
});

export interface ClaimPairingTokenInput {
  token: string;
  chatId: string;
  username?: string;
}

export interface ClaimPairingTokenResult {
  ok: true;
  accountId: Id<"creators">;
  agentId: Id<"gtmAgents">;
  chatId: string;
}

/**
 * Internal-only. Called by the Telegram webhook HTTP route after it
 * receives `/start pair_<token>` from the user. Auth is the webhook
 * secret (verified at the HTTP boundary, not here).
 *
 * Idempotency / safety guarantees:
 *   - Expired token → throws.
 *   - Already-claimed token → throws unless the claim is by the SAME
 *     chatId (replay protection that doesn't break legitimate retries).
 *   - Chat ID already bound to a DIFFERENT agent → throws. One-to-one
 *     mapping.
 *   - Agent already paired to a DIFFERENT chat ID → throws unless the
 *     agent's existing chat matches (re-pair attempt).
 */
export const claimPairingToken = internalMutation({
  args: {
    token: v.string(),
    chatId: v.string(),
    username: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ClaimPairingTokenResult> => {
    const now = Date.now();
    const row = await ctx.db
      .query("gtmTelegramPairingTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row) throw new Error("pairing token not found");
    if (row.expiresAt <= now) throw new Error("pairing token expired");

    // Replay-safe double claim by the same chat is a no-op.
    if (row.claimedAt) {
      if (row.claimedChatId !== args.chatId) {
        throw new Error("pairing token already claimed by a different chat");
      }
      return {
        ok: true,
        accountId: row.accountId,
        agentId: row.agentId,
        chatId: args.chatId,
      };
    }

    // Cross-agent collision: another agent already owns this chat.
    const existingForChat = await ctx.db
      .query("gtmAgents")
      .withIndex("by_telegram_chat", (q) =>
        q.eq("telegramChatId", args.chatId)
      )
      .first();
    if (existingForChat && existingForChat._id !== row.agentId) {
      throw new Error("Telegram chat already paired to a different ClawLaunch account");
    }

    // Cross-chat collision: this agent already paired elsewhere.
    const agent = await ctx.db.get(row.agentId);
    if (!agent) throw new Error("paired agent row no longer exists");
    if (agent.accountId !== row.accountId) {
      // Defensive: token + agent must agree on account.
      throw new Error("pairing token account mismatch");
    }
    if (agent.telegramChatId && agent.telegramChatId !== args.chatId) {
      throw new Error(
        "ClawLaunch account already paired to a different Telegram chat"
      );
    }

    // Atomic claim: stamp token, patch agent.
    await ctx.db.patch(row._id, {
      claimedAt: now,
      claimedChatId: args.chatId,
      claimedUsername: args.username,
    });
    await ctx.db.patch(agent._id, {
      telegramChatId: args.chatId,
      telegramUsername: args.username,
      telegramPairedAt: now,
      channelPreference: "telegram",
      updatedAt: now,
    });

    // ENUM REFACTOR — deliver-on-connect. If the agent already generated its plan
    // but couldn't deliver it (no channel was paired at synthesis time), re-push
    // the CACHED plan now that a channel exists. pushCachedPlan is a cheap no-op
    // when there's nothing to deliver / it already landed.
    await ctx.scheduler.runAfter(
      0,
      internal.gtmMaya.synthesisDelivery.pushCachedPlan,
      { agentId: agent._id }
    );

    return {
      ok: true,
      accountId: row.accountId,
      agentId: row.agentId,
      chatId: args.chatId,
    };
  },
});

/**
 * 2026-07-15 — claim wrapper that TALKS BACK. The raw claim used to be
 * fire-and-forget from the webhook: a failed claim died in a server log while
 * the founder stared at a silent Telegram chat (live repro: chat still bound
 * to a torn-down agent's leftover row → "already paired" throw → nothing).
 * Every /start now gets a plain-language reply, success or failure. Failure
 * copy never leaks internals; success is one line — the plan/hello arrives
 * through its own pipes (pushCachedPlan is scheduled inside the claim).
 */
export const claimPairingTokenWithAck = internalAction({
  args: {
    token: v.string(),
    chatId: v.string(),
    username: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    let reply: string;
    let agentIdForBot: Id<"gtmAgents"> | undefined;
    try {
      const res: ClaimPairingTokenResult = await ctx.runMutation(
        internal.gtmMaya.telegramPairing.claimPairingToken,
        { token: args.token, chatId: args.chatId, username: args.username }
      );
      agentIdForBot = res.agentId;
      reply =
        "Linked. Maya has your number now — she'll text you here from this point on.";
    } catch (err) {
      const msg = (err as Error).message ?? "";
      console.warn(`[telegram-webhook] pairing claim failed: ${msg}`);
      if (msg.includes("expired")) {
        reply =
          "That link expired — they only live 15 minutes. Grab a fresh QR from your dashboard and scan again.";
      } else if (msg.includes("already paired to a different")) {
        reply =
          "This Telegram is already linked to a different account. Unlink it there first, or scan from the account that owns this phone.";
      } else if (msg.includes("already claimed by a different")) {
        reply =
          "That QR was already used from another phone. Grab a fresh one from your dashboard.";
      } else {
        reply =
          "That link didn't work. Open your dashboard and scan the QR again — a fresh one is waiting there.";
      }
    }
    try {
      const { resolveBotForAgent } = await import("./telegramBotPerTenant");
      const shared = {
        sharedToken: process.env.TELEGRAM_BOT_TOKEN,
        sharedUsername: process.env.TELEGRAM_BOT_USERNAME,
      };
      const bot = agentIdForBot
        ? await resolveBotForAgent(
            ctx as { runQuery: <T>(ref: unknown, a: unknown) => Promise<T> },
            agentIdForBot,
            shared
          )
        : { token: shared.sharedToken };
      const { sendDirectTelegramMessage } = await import(
        "../integrations/telegram/sendDirectMessage"
      );
      await sendDirectTelegramMessage({
        botToken: bot.token ?? undefined,
        chatId: args.chatId,
        text: reply,
      });
    } catch (sendErr) {
      console.warn(
        `[telegram-webhook] pairing ack send failed: ${(sendErr as Error).message}`
      );
    }
  },
});

/**
 * Status query for the onboarding UI. Lets the page poll for pairing
 * completion without exposing the token itself.
 */
export const getMyPairingStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return null;
    return {
      paired: Boolean(agent.telegramChatId),
      chatId: agent.telegramChatId ?? null,
      username: agent.telegramUsername ?? null,
      pairedAt: agent.telegramPairedAt ?? null,
      channelPreference: agent.channelPreference,
    };
  },
});
