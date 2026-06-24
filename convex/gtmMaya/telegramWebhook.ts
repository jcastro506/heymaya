import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  TELEGRAM_WEBHOOK_SECRET_HEADER,
  parsePairingPayload,
  parseStartCommand,
  type TelegramInboundUpdate,
} from "../integrations/telegram/client";
import { sendDirectTelegramMessage } from "../integrations/telegram/sendDirectMessage";
import type { ActionCtx } from "../_generated/server";

/**
 * Sprint 15 — Telegram bot webhook.
 *
 * Mounted at `/telegram/webhook` (see convex/http.ts). Telegram POSTs every
 * inbound update here. We verify the `X-Telegram-Bot-Api-Secret-Token`
 * header against `TELEGRAM_WEBHOOK_SECRET` and then dispatch:
 *
 *   - `/start pair_<token>` → claim the pairing token (binds this chat to the
 *     founder's agent) and reply with a "you're connected" confirmation.
 *   - A confirm-button tap (callback_query) → the one-tap post handler.
 *   - Any other message → the SHARED-BOT SWITCHBOARD: look up which tenant's
 *     machine owns this chat (by_telegram_chat) and forward the raw update to
 *     that machine's /telegram-webhook, where its OpenClaw handles it natively
 *     and replies via the shared bot token. An unpaired chat gets a nudge to
 *     connect in the dashboard — it reaches no one's agent.
 *
 * Failure modes:
 *   - Bad / missing secret header → 401. Telegram will retry; we'd rather
 *     drop spoofed updates than process them.
 *   - Token expired / already claimed → reply with a polite "your link is
 *     stale, head back to the app and tap Open Maya in Telegram again."
 *   - JSON parse error → 400.
 *
 * We always return 200 to Telegram once we've verified the secret, even on
 * application errors. Telegram's retry policy is aggressive and stuck
 * updates can poison the queue.
 */

export const telegramWebhookHttp = httpAction(async (ctx, request) => {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!configuredSecret) {
    console.error(
      "[telegram-webhook] TELEGRAM_WEBHOOK_SECRET not configured; refusing inbound"
    );
    return new Response("server not configured", { status: 503 });
  }

  const presentedSecret = request.headers.get(TELEGRAM_WEBHOOK_SECRET_HEADER);
  if (!presentedSecret) {
    return new Response("missing secret header", { status: 401 });
  }
  if (!constantTimeEqual(presentedSecret, configuredSecret)) {
    return new Response("bad secret", { status: 401 });
  }

  let update: TelegramInboundUpdate;
  try {
    update = (await request.json()) as TelegramInboundUpdate;
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // One-tap confirm-to-post: the founder tapped a button on a Reddit/TikTok
  // card. Dispatch to the confirm handler (it publishes via Zernio + edits the
  // card). Always 200 so Telegram doesn't retry-poison the queue.
  const cb = update.callback_query;
  if (cb && cb.data && cb.message) {
    try {
      await ctx.runAction(internal.gtmMaya.telegramConfirm.handleConfirmCallback, {
        chatId: String(cb.message.chat.id),
        data: cb.data,
        callbackQueryId: cb.id,
        messageId: cb.message.message_id,
      });
    } catch (err) {
      console.warn(
        `[telegram-webhook] confirm callback failed: ${(err as Error).message}`
      );
    }
    return new Response("ok", { status: 200 });
  }

  const startPayload = parseStartCommand(update.message);
  const pairingToken = parsePairingPayload(startPayload);

  if (pairingToken && update.message) {
    const chatId = String(update.message.chat.id);
    const username =
      update.message.chat.username ?? update.message.from?.username;
    try {
      await ctx.runMutation(
        internal.gtmMaya.telegramPairing.claimPairingToken,
        { token: pairingToken, chatId, username }
      );
      // Confirm on the shared bot so the founder knows the link landed. Their
      // Maya sends its real first message on its own (synthesis / hello).
      await sendDirectTelegramMessage({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId,
        text: "✓ You're connected to your Maya. She's getting set up and will message you here shortly.",
      });
    } catch (err) {
      console.warn(
        `[telegram-webhook] pairing claim failed: ${(err as Error).message}`
      );
      await sendDirectTelegramMessage({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId,
        text: "That link looks stale. Head back to your HeyMaya dashboard and tap “Connect Telegram” again.",
      });
    }
    return new Response("ok", { status: 200 });
  }

  // Shared-bot switchboard — a regular inbound message. Route it to the
  // tenant machine that owns this chat. Best-effort; we always 200 so a
  // forwarding hiccup never makes Telegram retry-poison the queue.
  if (update.message && update.message.chat?.id != null) {
    await routeInboundMessage(ctx, String(update.message.chat.id), update);
  }

  return new Response("ok", { status: 200 });
});

/**
 * Forward one inbound update to the founder's own OpenClaw machine. Looks up
 * the chat→agent binding; if none (cold/unpaired chat) replies with a connect
 * nudge instead of routing. The machine validates the forwarded request
 * against the shared TELEGRAM_MACHINE_FORWARD_SECRET (set as its OpenClaw
 * telegram webhookSecret at deploy), so only Convex can drive it.
 */
async function routeInboundMessage(
  ctx: ActionCtx,
  chatId: string,
  update: TelegramInboundUpdate
): Promise<void> {
  const route = await ctx.runQuery(
    internal.gtmMaya.telegramRouter.getInboundRoute,
    { chatId }
  );

  if (!route || !route.reachable) {
    await sendDirectTelegramMessage({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: "I don't see a Maya linked to this chat yet. Open your HeyMaya dashboard and tap “Connect Telegram” to get set up.",
    });
    return;
  }

  const forwardSecret = process.env.TELEGRAM_MACHINE_FORWARD_SECRET;
  if (!forwardSecret) {
    console.error(
      "[telegram-webhook] TELEGRAM_MACHINE_FORWARD_SECRET unset; cannot forward"
    );
    return;
  }

  try {
    await fetch(route.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [TELEGRAM_WEBHOOK_SECRET_HEADER]: forwardSecret,
      },
      body: JSON.stringify(update),
    });
  } catch (err) {
    console.warn(
      `[telegram-webhook] forward to ${route.flyAppName} failed: ${(err as Error).message}`
    );
  }
}

/**
 * Constant-time string compare. Avoids leaking secret length via early
 * return timing. Used for the webhook secret check on every inbound.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still drain a constant-ish loop so length mismatch isn't observable.
    let acc = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      acc |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
    }
    return false || acc === -1; // always false but compiler-defeating
  }
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return acc === 0;
}
