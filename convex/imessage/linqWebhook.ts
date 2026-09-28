/**
 * Linq's webhook (X1). Mounted at `/linq/webhook`; the subscription pins `?version=2026-02-03`
 * (scripts/linq-setup.mjs). Linq's rules, all kept here:
 *  - Standard Webhooks signature over the RAW body, 5-minute replay window, constant-time compare.
 *  - Answer 2xx fast (their timeout is 10 s) and do the work in scheduled functions.
 *  - At-least-once delivery: every handler dedupes (the message id for messages, the event id for
 *    reactions), so a redelivered event is a no-op.
 *  - 4xx is not retried by Linq, 5xx is: a bad signature is 401, our own failure after a good
 *    signature is still 200 (a retry storm is worse than one lost event, and the row names it).
 */

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { parseLinqEvent, verifyWebhook } from "../integrations/linq/client";

export const linqWebhookHttp = httpAction(async (ctx, request) => {
  const secret = process.env.LINQ_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[linq-webhook] LINQ_WEBHOOK_SECRET not configured; refusing inbound");
    return new Response("server not configured", { status: 503 });
  }
  const raw = await request.text();
  const verdict = await verifyWebhook(secret, raw, { id: request.headers.get("webhook-id"), timestamp: request.headers.get("webhook-timestamp"), signature: request.headers.get("webhook-signature") }, Math.floor(Date.now() / 1000));
  if (!verdict.ok) return new Response(verdict.reason, { status: 401 });

  let json: unknown;
  try { json = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const ok = () => new Response("ok", { status: 200 });
  const e = parseLinqEvent(json);

  switch (e.type) {
    case "message": {
      if (e.isGroup) return ok(); // She talks to one person at a time.
      const chat = { chatId: e.chatId || undefined, health: e.health ?? undefined };
      for (const [i, m] of e.media.entries()) {
        await ctx.scheduler.runAfter(0, internal.core.imessage.handleAttachment, { from: e.from, url: m.url, mimeType: m.mimeType, caption: i === 0 ? e.text || undefined : undefined, channelMessageId: `${e.messageId}:att${i}`, ts: e.sentAt, ...chat });
      }
      if (e.text.trim() && !e.media.length) {
        await ctx.scheduler.runAfter(0, internal.core.imessage.handleText, { from: e.from, text: e.text, channelMessageId: e.messageId, service: e.service ?? undefined, ts: e.sentAt, ...chat });
      }
      return ok();
    }
    case "reaction":
      await ctx.scheduler.runAfter(0, internal.core.imessage.handleReaction, { from: e.from, aboutChannelMessageId: e.messageId, reactionType: e.reactionType, emoji: e.emoji ?? undefined, added: e.added, eventId: e.eventId });
      return ok();
    case "sent":
      // The chat's health rides on every chat event: kept fresh for the rail.
      if (e.health) await ctx.scheduler.runAfter(0, internal.imessage.linqEvents.healthByChat, { chatId: e.chatId, health: e.health });
      return ok();
    case "failed":
      await ctx.scheduler.runAfter(0, internal.imessage.linqEvents.failed, { channelMessageId: e.messageId, reason: `${e.reason}${e.code ? ` (${e.code})` : ""}`, code: e.code ?? undefined, chatId: e.chatId });
      return ok();
    case "line":
      await ctx.scheduler.runAfter(0, internal.imessage.linqEvents.line, { phoneNumber: e.phoneNumber, status: e.status ?? undefined, reputation: e.reputation ?? undefined, previousStatus: e.previousStatus ?? undefined, previousReputation: e.previousReputation ?? undefined });
      return ok();
    case "typing":
      return ok(); // Noted, not acted on: she doesn't wait on them typing.
    default:
      if (/^no event/.test(e.why)) console.warn(`[linq-webhook] ${e.why}`);
      return ok();
  }
});
