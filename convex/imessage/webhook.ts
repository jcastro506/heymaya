/**
 * The phone-channel webhook (plan §23). Mounted at `/imessage/webhook`. Fed by our relay
 * (`services/claw-relay`), which holds Claw Messenger's WebSocket and POSTs each event here,
 * signed. The same handler accepts a vendor-native webhook once one is approved, as long as
 * it carries the same signature.
 *
 * Verify the signature over the raw body, then dispatch by event type. Always 200 once the
 * signature is good: application errors are recorded on rows, never bounced, because a
 * retry storm from a relay is worse than one lost ack.
 */

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { parseClawEvent, SIGNATURE_HEADER, verifySignature } from "../integrations/claw/client";

export const imessageWebhookHttp = httpAction(async (ctx, request) => {
  const secret = process.env.CLAW_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[imessage-webhook] CLAW_WEBHOOK_SECRET not configured; refusing inbound");
    return new Response("server not configured", { status: 503 });
  }
  const raw = await request.text();
  const verdict = await verifySignature(secret, raw, request.headers.get(SIGNATURE_HEADER), Math.floor(Date.now() / 1000));
  if (!verdict.ok) return new Response(verdict.reason, { status: 401 });

  let json: unknown;
  try { json = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const ok = () => new Response("ok", { status: 200 });
  const event = parseClawEvent(json);

  if (event.type === "message") {
    if (event.isGroup) return ok(); // She talks to one person at a time.
    for (const [i, att] of event.attachments.entries()) {
      await ctx.scheduler.runAfter(0, internal.core.imessage.handleAttachment, { from: event.from, url: att.url, mimeType: att.mimeType, caption: i === 0 ? event.text || undefined : undefined, channelMessageId: `${event.messageId}:att${i}`, ts: event.sentAt });
    }
    if (event.text.trim() && !event.attachments.length) {
      await ctx.scheduler.runAfter(0, internal.core.imessage.handleText, { from: event.from, text: event.text, channelMessageId: event.messageId, service: event.service ?? undefined, ts: event.sentAt });
    }
    return ok();
  }
  if (event.type === "reaction") {
    await ctx.scheduler.runAfter(0, internal.core.imessage.handleReaction, { from: event.from, aboutChannelMessageId: event.messageId, reactionType: event.reactionType, emoji: event.emoji ?? undefined, added: event.added });
    return ok();
  }
  if (event.type === "ignored" && /^unknown event type|^no event type/.test(event.why)) console.warn(`[imessage-webhook] ${event.why}`);
  return ok();
});
