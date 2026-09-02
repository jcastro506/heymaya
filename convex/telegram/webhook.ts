/**
 * The Telegram webhook (plan §12.6). Mounted at `/telegram/webhook` in `http.ts`.
 *
 * Verify the secret with a constant-time compare, dedupe by `update_id` (Telegram
 * replays on any non-200), then dispatch: pairing, button taps, reactions, files,
 * text. Always 200 once the secret is verified; application errors are recorded,
 * never bounced, because a retry storm is worse than a lost ack.
 *
 * Adapted from the legacy switchboard; the machine hand-off and the v1 fork are gone.
 */

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  TELEGRAM_WEBHOOK_SECRET_HEADER,
  parsePairingPayload,
  parseStartCommand,
  type TelegramInboundUpdate,
} from "../integrations/telegram/client";
import { extractFile } from "../core/telegramFiles";

export const telegramWebhookHttp = httpAction(async (ctx, request) => {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!configuredSecret) {
    console.error("[telegram-webhook] TELEGRAM_WEBHOOK_SECRET not configured; refusing inbound");
    return new Response("server not configured", { status: 503 });
  }
  const presentedSecret = request.headers.get(TELEGRAM_WEBHOOK_SECRET_HEADER);
  if (!presentedSecret || !constantTimeEqual(presentedSecret, configuredSecret)) {
    return new Response("bad secret", { status: 401 });
  }

  let update: TelegramInboundUpdate;
  try {
    update = (await request.json()) as TelegramInboundUpdate;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const ok = () => new Response("ok", { status: 200 });

  // Replayed update → already handled. Checked once here; the recording mutations check again.
  if (typeof update.update_id === "number" && (await ctx.runQuery(internal.core.telegram.seenUpdate, { updateId: update.update_id }))) {
    return ok();
  }

  // ── button taps ──────────────────────────────────────────────────────────
  const cb = update.callback_query;
  if (cb?.data && cb.message) {
    const chatId = String(cb.message.chat.id);
    const { resolveTelegramBotIdentity, answerCallbackQuery } = await import("../integrations/telegram/client");
    const identity = resolveTelegramBotIdentity();
    if (identity) await answerCallbackQuery(identity, cb.id); // stops the spinner; the work is a job
    await ctx.scheduler.runAfter(0, internal.core.telegram.handleInbound, {
      chatId,
      text: cb.data,
      kind: "button",
      updateId: update.update_id,
      telegramMessageId: String(cb.message.message_id),
    });
    return ok();
  }

  // ── reactions ────────────────────────────────────────────────────────────
  const rx = update.message_reaction;
  if (rx) {
    const emoji = rx.new_reaction.find((r) => r.type === "emoji")?.emoji ?? (rx.new_reaction.length ? "other" : "removed");
    await ctx.scheduler.runAfter(0, internal.core.telegram.handleInbound, {
      chatId: String(rx.chat.id),
      text: emoji,
      kind: "reaction",
      updateId: update.update_id,
      telegramMessageId: String(rx.message_id),
      ts: rx.date * 1000,
    });
    return ok();
  }

  const message = update.message;
  if (!message) return ok();
  const chatId = String(message.chat.id);

  // ── pairing: /start pair_<token> ─────────────────────────────────────────
  const startPayload = parseStartCommand(message);
  const pairingToken = parsePairingPayload(startPayload);
  if (pairingToken) {
    // Awaited: the creator is looking at Telegram right now, and a pairing that
    // confirms three seconds later reads as broken.
    const claimed = await ctx.runMutation(internal.core.pairing.claimPairing, { token: pairingToken, chatId });
    const { resolveTelegramBotIdentity, sendTelegramMessage } = await import("../integrations/telegram/client");
    const identity = resolveTelegramBotIdentity();
    if (claimed.paired) {
      // A receipt, not an introduction. Says what is about to happen; the first read makes it true.
      if (identity) await sendTelegramMessage(identity, { chatId, text: "hi, I'm Maya. I'm reading your posts now, give me a few minutes." });
      if (claimed.creatorId) {
        await ctx.runMutation(internal.core.jobs.enqueue, {
          kind: "first_read",
          idempotencyKey: `first_read:${claimed.creatorId}`,
          creatorId: claimed.creatorId,
          payloadJson: JSON.stringify({ chatId }),
        });
      }
    } else if (identity) {
      // A failed claim must talk back; a silent chat after tapping Start is the worst outcome.
      await sendTelegramMessage(identity, { chatId, text: `${claimed.reason ?? "that link didn't work"}. head back to the app and tap Open Maya in Telegram again.` });
    }
    return ok();
  }
  if (startPayload !== null) {
    // A bare /start from someone who found the bot: point them at signup, nothing else.
    const { resolveTelegramBotIdentity, sendTelegramMessage } = await import("../integrations/telegram/client");
    const identity = resolveTelegramBotIdentity();
    const appUrl = process.env.APP_URL ?? "https://hey-maya.ai";
    if (identity) await sendTelegramMessage(identity, { chatId, text: `hi. I work with creators who sign up at ${appUrl}. start there and I'll meet you back here.` });
    return ok();
  }

  // ── files, before the text fork (on a media message `text` is undefined) ─
  const extracted = extractFile(message);
  if (extracted) {
    const creatorId = await ctx.runQuery(internal.core.telegram.creatorByChatId, { chatId });
    if (!creatorId) return ok();
    await ctx.runAction(internal.core.telegram.showTyping, { chatId });
    await ctx.scheduler.runAfter(0, internal.core.telegramFiles.ingestInboundFile, {
      creatorId,
      chatId,
      fileId: extracted.fileId,
      fileUniqueId: extracted.fileUniqueId,
      kindHint: extracted.kindHint,
      mime: extracted.mime,
      sizeBytes: extracted.sizeBytes,
      caption: message.caption,
      updateId: update.update_id,
      telegramMessageId: String(message.message_id),
    });
    return ok();
  }

  // ── text ─────────────────────────────────────────────────────────────────
  if (message.text) {
    const creatorId = await ctx.runQuery(internal.core.telegram.creatorByChatId, { chatId });
    if (!creatorId) {
      const { resolveTelegramBotIdentity, sendTelegramMessage } = await import("../integrations/telegram/client");
      const identity = resolveTelegramBotIdentity();
      const appUrl = process.env.APP_URL ?? "https://hey-maya.ai";
      if (identity) await sendTelegramMessage(identity, { chatId, text: `I don't think we've met. sign up at ${appUrl} and I'll meet you back here.` });
      return ok();
    }
    // Typing first, inline, awaited: it swallows its own errors and never fails the webhook.
    await ctx.runAction(internal.core.telegram.showTyping, { chatId });
    await ctx.scheduler.runAfter(0, internal.core.telegram.holdTyping, { chatId });
    await ctx.scheduler.runAfter(0, internal.core.telegram.handleInbound, {
      chatId,
      text: message.text,
      kind: "inbound",
      updateId: update.update_id,
      telegramMessageId: String(message.message_id),
      ts: message.date * 1000,
    });
  }

  return ok();
});

/** Constant-time string compare so the secret's length and prefix don't leak through timing. */
function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let acc = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) acc |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return acc === 0;
}
