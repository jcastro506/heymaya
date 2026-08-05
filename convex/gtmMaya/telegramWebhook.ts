import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  TELEGRAM_WEBHOOK_SECRET_HEADER,
  parsePairingPayload,
  parseStartCommand,
  type TelegramInboundUpdate,
} from "../integrations/telegram/client";
import { extractFile, ALBUM_SETTLE_MS } from "../maya/telegramFiles";

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

    // ── v2 pairing first (§18 Sprint 2.9) ─────────────────────────────────
    // A v2 token simply won't match a v1 row and vice versa, so trying v2 first
    // costs one indexed lookup and keeps the two flows from having to know
    // about each other. Awaited rather than scheduled: the founder is staring
    // at Telegram right now, and a pairing that confirms three seconds later
    // reads as broken.
    const claimed = await ctx.runMutation(internal.maya.pairing.claimPairing, {
      token: pairingToken,
      chatId,
    });
    if (claimed.paired) {
      const { resolveTelegramBotIdentity, sendTelegramMessage } = await import(
        "../integrations/telegram/client"
      );
      const identity = resolveTelegramBotIdentity();
      if (identity) {
        // The first thing she ever says. Deliberately short — the machine may
        // not be up yet, and promising more than that would be a lie.
        await sendTelegramMessage(identity, {
          chatId,
          text: "Paired. I'll take it from here.",
        });
      }
      return new Response("ok", { status: 200 });
    }
    // 2026-07-15 — the claim must TALK BACK. A failed claim used to die in a
    // server log while the founder stared at a silent chat (live repro: chat
    // still bound to a torn-down agent's row → "already paired" throw →
    // nothing). Every /start now gets a human reply, success or failure, via
    // the ack action (which owns the Telegram send).
    await ctx.scheduler.runAfter(
      0,
      internal.gtmMaya.telegramPairing.claimPairingTokenWithAck,
      { token: pairingToken, chatId, username }
    );
    return new Response("ok", { status: 200 });
  }

  /**
   * ⭐ FILES, BEFORE THE TEXT FORK.
   *
   * On a media message `text` is ALWAYS undefined — the founder's words live in
   * `caption`. So the text fork below can never see an upload, and until this
   * block existed a founder who answered her ask for a screen recording got
   * **silence**. Sprint 4.75 built the ask and the library and left no way in.
   *
   * Ingest is deterministic and does NOT wake the machine: dropping four
   * screenshots shouldn't cost a 10–30s boot and a turn of tokens to be told
   * "got them". A caption is the exception — see below.
   */
  if (update.message && !startPayload) {
    const extracted = extractFile(update.message);
    if (extracted) {
      const chatId = String(update.message.chat.id);
      const v2Customer = await ctx.runQuery(
        internal.maya.telegram.customerByChatId,
        { chatId }
      );
      // v1 is frozen and has no library, so its founders fall through
      // untouched — same per-customer migration as the text path.
      if (v2Customer) {
        const caption = update.message.caption;
        /**
         * One ack per ACT, not per file. An album arrives as N updates sharing
         * `media_group_id`; without it, five screenshots earn five receipts.
         * A lone file keys on `file_unique_id`, which also makes a Telegram
         * retry of the same update idempotent.
         */
        const ackKey = update.message.media_group_id ?? extracted.fileUniqueId;

        await ctx.scheduler.runAfter(
          0,
          internal.maya.telegramFiles.ingestInboundFile,
          {
            customerId: v2Customer,
            chatId,
            fileId: extracted.fileId,
            fileUniqueId: extracted.fileUniqueId,
            kindHint: extracted.kindHint,
            sizeBytes: extracted.sizeBytes,
            caption,
            ackKey,
          }
        );

        if (caption) {
          /**
           * They typed words with the upload, so they're talking to her, not
           * filing something. Worth a wake — and her reply IS the receipt, so
           * `acknowledgeUpload` is skipped to avoid answering twice.
           */
          await ctx.runAction(internal.maya.telegram.showTyping, { chatId });
          await ctx.scheduler.runAfter(0, internal.maya.telegram.holdTyping, {
            chatId,
          });
          await ctx.scheduler.runAfter(
            ALBUM_SETTLE_MS,
            internal.maya.telegram.handleInbound,
            { chatId, text: caption }
          );
        } else {
          await ctx.scheduler.runAfter(
            ALBUM_SETTLE_MS,
            internal.maya.telegramFiles.acknowledgeUpload,
            { customerId: v2Customer, ackKey, since: Date.now() }
          );
        }
        return new Response("ok", { status: 200 });
      }
    }
  }

  // SWITCHBOARD: a normal text message (NOT a /start command) → forward to the
  // agent that owns this chat. The shared bot's webhook points HERE, so Convex
  // is the single router for every tenant. Scheduled (fire-and-forget) so we
  // return 200 fast and Telegram never retry-poisons the queue. Maya replies
  // via her send_update tool (→ Convex → Telegram).
  if (update.message?.text && !startPayload) {
    const chatId = String(update.message.chat.id);
    const username =
      update.message.chat.username ?? update.message.from?.username;

    // ── agentVersion routing (§18 Sprint 2) ────────────────────────────────
    // The shared bot has ONE webhook, so this is the fork between the frozen v1
    // agent and `convex/maya`. A v1 chat has no `customers` row at all, so it
    // falls through untouched — migration is per-customer, not a flag day.
    const v2Customer = await ctx.runQuery(
      internal.maya.telegram.customerByChatId,
      { chatId }
    );
    if (v2Customer) {
      // TYPING FIRST, INLINE, AND AWAITED (§17.36.2).
      //
      // Not scheduled. The machine auto-stops when idle, so this text may be
      // waiting on a 10–30s boot, and the indicator is the only thing that
      // makes that read as thinking rather than broken. Scheduling it would
      // race the wake and could show the indicator *after* the reply, which is
      // worse than not showing it.
      //
      // Safe to await: the call swallows its own errors, so it can add latency
      // but can never fail the webhook.
      await ctx.runAction(internal.maya.telegram.showTyping, { chatId });
      // Telegram clears the indicator after ~5s and a cold boot is 10–30s, so
      // one send leaves the founder staring at nothing for most of the wait.
      // Scheduled, never awaited: a webhook that sat here re-painting for 24s
      // would blow Telegram's delivery ACK and earn a retry.
      await ctx.scheduler.runAfter(0, internal.maya.telegram.holdTyping, {
        chatId,
      });
      await ctx.scheduler.runAfter(0, internal.maya.telegram.handleInbound, {
        chatId,
        text: update.message.text,
      });
      return new Response("ok", { status: 200 });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.gtmMaya.telegramHandoff.routeInboundToMachine,
      { chatId, text: update.message.text, username }
    );
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
