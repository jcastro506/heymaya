/**
 * Sprint 2.26 — per-operator Telegram bot management.
 *
 * Multi-tenant architecture decision:
 *   - Each operator creates their own bot via BotFather and pastes the
 *     token here during onboarding.
 *   - The token is encrypted at rest (lib/encryption).
 *   - The bot's webhook is registered to point at THAT operator's Fly
 *     machine, so inbound messages only reach their own Maya.
 *   - At deploy time, the per-agent token is set as a Fly secret
 *     (replaces the shared process.env.TELEGRAM_BOT_TOKEN fallback).
 *
 * Why per-bot, not shared:
 *   - Shared bot can only have ONE webhook URL — would force all
 *     operators' Mayas behind one Convex router, complicating
 *     authentication + rate limit attribution.
 *   - Per-operator branding ("My GTM Maya" custom bot name).
 *   - Tenant isolation: a compromised bot token affects only its owner.
 *
 * Tradeoffs:
 *   - Operator has to go through BotFather (one-time, ~2 min) during
 *     onboarding. UI guides them with step-by-step instructions.
 *   - Each Fly deploy has its own webhook URL — must re-register if
 *     the Fly machine is destroyed and recreated (handled by
 *     deployMayaGtm.ts at set-telegram-webhook stage).
 *
 * Flow:
 *   1. Operator visits onboarding step "Connect Telegram"
 *   2. UI shows BotFather instructions + a textarea for the token
 *   3. Operator submits → setPersonalTelegramBot validates via getMe
 *      then stores encrypted token + bot username
 *   4. createPairingToken (existing) now uses the operator's bot
 *      identity for the deep link
 *   5. deployMayaGtm.ts pulls the decrypted token at deploy + sets
 *      it as TELEGRAM_BOT_TOKEN Fly secret
 *   6. registerWebhook on Fly URL using the operator's bot
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
} from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { encrypt, decrypt } from "../lib/encryption";

interface BotIdentity {
  ok: boolean;
  username: string;
  firstName: string;
  botId: number;
}

/**
 * Validate a bot token by calling Telegram's getMe. Returns the bot's
 * identity on success; throws a typed error on bad token / network.
 *
 * Test seam: pass `fetchImpl` to skip the real network in unit tests.
 */
export async function validateBotToken(
  botToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<BotIdentity> {
  if (!botToken || !botToken.includes(":")) {
    throw new Error(
      "invalid bot token format — expected something like 123456:ABC-xyz"
    );
  }
  const url = `https://api.telegram.org/bot${botToken}/getMe`;
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    throw new Error(`getMe network error: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`getMe HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    result?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    description?: string;
  };
  if (!json.ok || !json.result) {
    throw new Error(`getMe rejected: ${json.description ?? "unknown"}`);
  }
  if (!json.result.is_bot) {
    throw new Error("token is for a user, not a bot");
  }
  if (!json.result.username) {
    throw new Error("bot has no username — set one via BotFather");
  }
  return {
    ok: true,
    username: json.result.username,
    firstName: json.result.first_name,
    botId: json.result.id,
  };
}

/**
 * Operator-facing mutation. Validates the bot token via Telegram getMe,
 * then stores it encrypted on their gtmAgents row.
 *
 * Cross-tenant safety: requires authenticated Clerk identity, looks up
 * gtmAgents by accountId. Operator cannot set tokens for other accounts.
 */
export const setPersonalTelegramBot = mutation({
  args: { botToken: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: true; botUsername: string; botFirstName: string }> => {
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
    if (!agent) {
      throw new Error("GTM agent row not found; complete onboarding first");
    }

    // Validation has to happen in an ACTION (we can't fetch from a
    // mutation). The caller is expected to call validateBotToken via
    // a paired action OR we skip validation here and check at deploy
    // time. For v0 we accept the token and validate at deploy.
    // Future: split this into action+mutation pair so we validate
    // before storing.

    const encrypted = await encrypt(args.botToken);
    await ctx.db.patch(agent._id, {
      telegramBotToken: encrypted,
      // Username stays null until validated; deploy will fill it.
      telegramBotIdentityCheckedAt: undefined,
      updatedAt: Date.now(),
    });
    return {
      ok: true,
      botUsername: "(pending validation — will be confirmed at deploy)",
      botFirstName: "(pending)",
    };
  },
});

/**
 * Sprint 2.26b — operator-facing ACTION wrapper that validates the
 * bot token via Telegram getMe BEFORE storing it. The onboarding UI
 * calls this from the "Connect your Telegram bot" step.
 *
 * Flow:
 *   1. Resolve Clerk identity → creator → agent.
 *   2. Call validateBotToken (real fetch to api.telegram.org/getMe).
 *   3. If validation passes, encrypt + store + record validated identity.
 *   4. Return botUsername to the UI so the operator sees "@your_bot connected".
 *
 * Errors are thrown as plain JS Errors with operator-readable messages.
 */
export const validateAndSetPersonalTelegramBot = action({
  args: { botToken: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: true; botUsername: string; botFirstName: string }> => {
    // Validate FIRST — no point storing a broken token.
    const validated = await validateBotToken(args.botToken);
    if (!validated.ok) {
      throw new Error("Bot token rejected by Telegram");
    }

    // Now resolve the agent + store. We can't call the mutation directly
    // from here because the mutation reads Clerk identity from ctx;
    // actions inherit it, so we runMutation into a helper that does
    // the same auth check + then patches with the validated identity.
    await ctx.runMutation(
      api.gtmMaya.telegramBotPerTenant.setPersonalTelegramBot,
      { botToken: args.botToken }
    );
    // Find the agent for the current identity again (in the action
    // ctx) so we can attach the validated username. We need an
    // identity-aware query for this.
    const identityInfo = await ctx.runQuery(
      internal.gtmMaya.telegramBotPerTenant.getMyAgentForBotSetup,
      {}
    );
    if (identityInfo.agentId) {
      await ctx.runMutation(
        internal.gtmMaya.telegramBotPerTenant.persistValidatedBotIdentity,
        {
          agentId: identityInfo.agentId,
          botUsername: validated.username,
        }
      );
    }
    return {
      ok: true,
      botUsername: validated.username,
      botFirstName: validated.firstName,
    };
  },
});

/**
 * Internal query — resolves Clerk identity to the operator's agent
 * row. Used by validateAndSetPersonalTelegramBot to attach validated
 * bot identity after storing the token.
 */
export const getMyAgentForBotSetup = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ agentId: Id<"gtmAgents"> | null }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { agentId: null };
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") {
      return { agentId: null };
    }
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    return { agentId: agent?._id ?? null };
  },
});

/**
 * Internal-only — reads the decrypted bot token. Used by deployMayaGtm
 * at the set-telegram-webhook + set-secrets stages.
 */
export const getDecryptedBotToken = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ token: string | null; username: string | null }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return { token: null, username: null };
    if (!agent.telegramBotToken) return { token: null, username: null };
    const token = await decrypt(agent.telegramBotToken);
    return { token, username: agent.telegramBotUsername ?? null };
  },
});

/**
 * Internal-only — persists the validated bot username after a deploy-
 * time getMe check succeeds. Called from deployMayaGtm.ts.
 */
export const persistValidatedBotIdentity = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    botUsername: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.agentId, {
      telegramBotUsername: args.botUsername,
      telegramBotIdentityCheckedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Resolve the effective bot token + username for a given agent.
 *
 * Priority:
 *   1. agent.telegramBotToken (per-operator, decrypted) — preferred.
 *   2. process.env.TELEGRAM_BOT_TOKEN_* shared fallback — testing only.
 *
 * The shared fallback exists so dev/test deploys without an operator-
 * supplied token don't 500 out. Production should always have the
 * per-agent token set — productionReadiness check enforces this.
 *
 * Returns null/null when neither path resolves; callers must
 * fail-closed (no shared bot leak to a new tenant).
 */
export async function resolveBotForAgent(
  ctx: { runQuery: <T>(ref: unknown, args: unknown) => Promise<T> },
  agentId: Id<"gtmAgents">,
  envFallback: {
    sharedToken?: string;
    sharedUsername?: string;
  } = {}
): Promise<{ token: string | null; username: string | null; source: "per_tenant" | "shared_fallback" | "none" }> {
  // Local import to avoid top-level `internal` import for the helper
  // pattern (this function is callable from action contexts).
  const { internal } = await import("../_generated/api");
  const personal = (await ctx.runQuery(
    internal.gtmMaya.telegramBotPerTenant.getDecryptedBotToken,
    { agentId }
  )) as { token: string | null; username: string | null };

  if (personal.token) {
    return {
      token: personal.token,
      username: personal.username,
      source: "per_tenant",
    };
  }
  if (envFallback.sharedToken) {
    return {
      token: envFallback.sharedToken,
      username: envFallback.sharedUsername ?? null,
      source: "shared_fallback",
    };
  }
  return { token: null, username: null, source: "none" };
}
