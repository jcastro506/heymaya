import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  TELEGRAM_WEBHOOK_SECRET_HEADER,
  parsePairingPayload,
  parseStartCommand,
  type TelegramInboundUpdate,
} from "../integrations/telegram/client";

/**
 * Sprint 15 — Telegram bot webhook.
 *
 * Mounted at `/telegram/webhook` (see convex/http.ts). Telegram POSTs every
 * inbound update here. We verify the `X-Telegram-Bot-Api-Secret-Token`
 * header against `TELEGRAM_WEBHOOK_SECRET` and then dispatch:
 *
 *   - `/start pair_<token>` → claim the pairing token. Reply with a Maya
 *     "we're paired" message so the user knows it worked.
 *   - Anything else → currently a 200 OK no-op. Inbound user messages are
 *     handled by OpenClaw on the Fly machine, not by Convex; this webhook
 *     exists only for the pairing handshake. Later sprints may add
 *     fallback acks for the brief window before deploy.
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
    } catch (err) {
      console.warn(
        `[telegram-webhook] pairing claim failed: ${(err as Error).message}`
      );
      return new Response("ok", { status: 200 });
    }
  }

  return new Response("ok", { status: 200 });
});

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
