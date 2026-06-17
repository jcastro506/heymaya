/**
 * Shared-bot inbound router.
 *
 * THE MODEL: every founder runs their OWN dedicated OpenClaw agent on their
 * OWN Fly machine (clawlaunch-<agentId>). The Telegram bot is shared — ONE
 * @HeyMaya bot is the front door for everyone. Telegram delivers every
 * inbound update to Convex (the shared bot's single webhook); Convex is the
 * switchboard that maps the chat to the right tenant's machine and forwards
 * the message there. A founder's message only ever reaches their own Maya; an
 * unpaired chat reaches no one.
 *
 *   @HeyMaya → Telegram → Convex /telegram/webhook
 *      → getInboundRoute(chat_id)            (by_telegram_chat → agent)
 *      → forward update to clawlaunch-<agentId>.fly.dev/telegram-webhook
 *      → that machine's OpenClaw replies via the shared bot token
 *
 * The chat_id → agent binding is written by the pairing handshake
 * (telegramPairing.claimPairingToken) when the founder taps/scans their
 * tokenized deep link in the dashboard.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { flyAppNameForGtmAgent } from "../onboarding/gtm/deployMayaGtm";

/** The per-tenant machine's Telegram inbound webhook (OpenClaw handles it). */
export function machineWebhookUrl(flyAppName: string): string {
  return `https://${flyAppName}.fly.dev/telegram-webhook`;
}

export interface InboundRoute {
  agentId: Id<"gtmAgents">;
  flyAppName: string;
  webhookUrl: string;
  /** Active agents only route; a still-deploying agent isn't reachable yet. */
  reachable: boolean;
}

/**
 * Resolve which tenant machine a Telegram chat belongs to. Returns null when
 * the chat isn't paired to any agent (cold/unknown sender) — the webhook then
 * replies with a "connect in your dashboard" nudge instead of routing.
 */
export const getInboundRoute = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, args): Promise<InboundRoute | null> => {
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_telegram_chat", (q) =>
        q.eq("telegramChatId", args.chatId)
      )
      .first();
    if (!agent) return null;
    // The deployed Fly app name is stored as openClawFlyAppId; fall back to the
    // deterministic name (they're identical — deploy creates the app with it).
    const flyAppName =
      agent.openClawFlyAppId ?? flyAppNameForGtmAgent(agent._id);
    return {
      agentId: agent._id,
      flyAppName,
      webhookUrl: machineWebhookUrl(flyAppName),
      // A machine exists to route to only once a deploy has set openClawFlyAppId.
      reachable: Boolean(agent.openClawFlyAppId),
    };
  },
});

/**
 * One-time (idempotent) setup: point the SHARED bot's single Telegram webhook
 * at THIS Convex deployment's /telegram/webhook. Telegram then delivers every
 * inbound update here, where the switchboard routes it. Run via
 * `convex run gtmMaya/telegramRouter:setSharedBotWebhook`. Re-run any time the
 * webhook drifts (e.g. an old per-machine deploy hijacked it).
 *
 * Uses CONVEX_SITE_URL (the deployment's HTTP-actions origin) so it targets
 * whatever deployment it's run against — dev/staging vs prod stay isolated.
 */
export const setSharedBotWebhook = internalAction({
  // siteUrl: this deployment's HTTP-actions origin (e.g.
  // https://precise-canary-781.convex.site). Pass explicitly — CONVEX_SITE_URL
  // isn't reliably exposed to actions on this Convex version. Falls back to
  // CONVEX_SITE_URL, then derives from CONVEX_CLOUD_URL (.cloud → .site).
  args: { siteUrl: v.optional(v.string()) },
  handler: async (
    _ctx,
    args
  ): Promise<{
    ok: boolean;
    url: string;
    detail?: string;
  }> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const cloud = process.env.CONVEX_CLOUD_URL;
    const site =
      args.siteUrl ??
      process.env.CONVEX_SITE_URL ??
      (cloud ? cloud.replace(".convex.cloud", ".convex.site") : undefined);
    if (!token || !secret || !site) {
      return {
        ok: false,
        url: "",
        detail: `missing ${[
          !token && "TELEGRAM_BOT_TOKEN",
          !secret && "TELEGRAM_WEBHOOK_SECRET",
          !site && "siteUrl (pass it explicitly)",
        ]
          .filter(Boolean)
          .join(" / ")}`,
      };
    }
    const url = `${site}/telegram/webhook`;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/setWebhook`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url,
            secret_token: secret,
            // Pairing /start + regular messages + one-tap confirm buttons.
            allowed_updates: ["message", "callback_query"],
            drop_pending_updates: true,
          }),
        }
      );
      const body = (await res.json()) as {
        ok?: boolean;
        description?: string;
      };
      return { ok: Boolean(body.ok), url, detail: body.description };
    } catch (err) {
      return { ok: false, url, detail: (err as Error).message };
    }
  },
});
