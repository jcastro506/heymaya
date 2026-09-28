/**
 * The phone-number channel (plan §23, Sprint 6): iMessage, RCS and SMS through Claw
 * Messenger. Everything on this side of the vendor client: who a phone belongs to, the
 * inbound record, pairing by texting first, the menu line that stands in for buttons, the
 * tapback map, delivery of one row, and the same dispatch to `converse` the Telegram door
 * uses. The gate, the cap, quiet hours and the one open question never learn which app a
 * creator is in.
 */

import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { splitParts } from "./envelope";
import { normalizePhone, type ClawReactionType, type ClawService } from "../integrations/claw/client";
import { isOptOutKeyword } from "../integrations/linq/client";

/**
 * X1: which vendor carries the phone channel on this deployment. Linq direct when its key is set,
 * else Claw (Linq's reseller) as before; null when neither is configured.
 */
export function phoneVendor(): "linq" | "claw" | null {
  if (process.env.LINQ_API_KEY) return "linq";
  if (process.env.CLAW_API_KEY) return "claw";
  return null;
}

/** What she says once after an opt-out keyword: the one send Linq lets through (`override_optout`). */
export const OPT_OUT_REPLY = "got it, you won't hear from me. text me any time and i'll pick right back up.";
/** The contact card is offered at most this often per chat (Linq: once a day after the first outbound). */
export const CARD_SHARE_EVERY_MS = 24 * 60 * 60_000;

/** A menu (the buttons of an outbound) is answerable for this long; after that a "1" is just text. */
export const MENU_TTL_MS = 24 * 60 * 60_000;
/** A photo, a voice note or a draft bigger than this is not fetched; she says so instead. */
export const ATTACHMENT_MAX_BYTES = 150 * 1024 * 1024; // iMessage sends phone videos at full quality; downloaded in Node (core/bigMedia)

/* -------------------------------------------------------------------------- */
/* Pure                                                                         */
/* -------------------------------------------------------------------------- */

/** The one plain line that replaces an inline keyboard. Numbers first, the labels as they were, an out. */
export function menuLine(buttons: Array<{ id: string; label: string }>): string {
  if (!buttons.length) return "";
  const yesNo = buttons.length === 2 && /:yes$/.test(buttons[0].id) && /:no$/.test(buttons[1].id);
  if (yesNo) return `(reply yes or no, or just tell me)`;
  return `(reply ${buttons.map((b, i) => `${i + 1} for ${b.label}`).join(", ")}, or just tell me)`;
}

/**
 * A bare number, a yes/no on a yes/no menu, or the exact label of the most recent menu is a
 * tap; anything else is text for the classifier. A menu, not intent detection.
 */
export function menuPick(text: string, buttons: Array<{ id: string; label: string }> | undefined): string | null {
  if (!buttons?.length) return null;
  const t = text.trim().toLowerCase().replace(/[.!?,;:)\s]+$/g, "").replace(/^[(\s]+/, "");
  const n = /^\d{1,2}$/.test(t) ? Number(t) : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= buttons.length) return buttons[n - 1].id;
  const yesNo = buttons.length === 2 && /:yes$/.test(buttons[0].id) && /:no$/.test(buttons[1].id);
  if (yesNo) {
    if (/^(yes|yeah|yep|yup|sure|ok|okay|do it|book it|block it)$/.test(t)) return buttons[0].id;
    if (/^(no|nope|nah|not now|skip)$/.test(t)) return buttons[1].id;
  }
  const byLabel = buttons.find((b) => b.label.trim().toLowerCase() === t);
  return byLabel ? byLabel.id : null;
}

/**
 * A tapback → the emoji the reaction path already understands, or null when it is nothing
 * (emphasize, question, unknown). A thumbs-down is the one that means "not me".
 */
export function reactionEmoji(reactionType: ClawReactionType | "unknown", emoji: string | null, added: boolean): string | null {
  if (!added) return "removed";
  switch (reactionType) {
    case "love": return "❤";
    case "like": return "👍";
    case "laugh": return "😂";
    case "dislike": return "👎";
    case "custom": return emoji && emoji.length <= 8 ? emoji : null;
    default: return null;
  }
}

/** The `sms:` link that opens Messages with the pairing text prefilled. iOS wants `&body=`, Android `?body=`; both read the other. Pure. */
export function pairingSmsLink(lineNumber: string, token: string, platform: "ios" | "android" | "unknown" = "unknown"): string {
  const body = encodeURIComponent(`START ${token}`);
  return platform === "android" ? `sms:${lineNumber}?body=${body}` : `sms:${lineNumber}&body=${body}`;
}

/** "START <token>" from the pairing screen, in any case, with any spacing. Pure. */
export function parseStartText(text: string): string | null {
  const m = text.trim().match(/^start\s+([0-9a-f]{16,64})\s*$/i);
  return m ? m[1].toLowerCase() : null;
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

export const creatorByPhone = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, a): Promise<{ creatorId: Id<"creators">; paired: boolean } | null> => {
    const row = (await ctx.db.query("creators").withIndex("by_phone", (q) => q.eq("phone", a.phone)).first()) as Doc<"creators"> | null;
    return row ? { creatorId: row._id, paired: row.channel.paired && row.channel.kind === "imessage" } : null;
  },
});

export const seenVendorMessage = internalQuery({
  args: { channelMessageId: v.string() },
  handler: async (ctx, a): Promise<boolean> => (await ctx.db.query("messages").withIndex("by_channel_message", (q) => q.eq("channelMessageId", a.channelMessageId)).first()) !== null,
});

/** The most recent outbound with buttons, if it is still a live menu. */
export const liveMenu = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<Array<{ id: string; label: string }> | null> => {
    const recent = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.now - MENU_TTL_MS)).order("desc").take(30)) as Doc<"messages">[];
    const last = recent.find((m) => m.direction === "out" && m.buttons?.length);
    return last?.buttons ?? null;
  },
});

/**
 * Record an inbound from a phone. Same rules as the Telegram door: an unknown number creates
 * nothing; a replayed vendor id is dropped; an inbound answers whatever was outstanding.
 */
export const receiveInbound = internalMutation({
  args: {
    creatorId: v.id("creators"),
    body: v.string(),
    kind: v.string(), // inbound | button | reaction | file
    channelMessageId: v.string(),
    /** For a reaction: the vendor id of the message it is about. */
    aboutChannelMessageId: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    fileMime: v.optional(v.string()),
    ts: v.optional(v.number()),
  },
  handler: async (ctx, a): Promise<{ recorded: boolean; reason?: string; messageId?: Id<"messages"> }> => {
    if (a.body.trim().length === 0 && a.kind !== "file") return { recorded: false, reason: "empty message" };
    const dup = await ctx.db.query("messages").withIndex("by_channel_message", (q) => q.eq("channelMessageId", a.channelMessageId)).first();
    if (dup) return { recorded: false, reason: "duplicate event" };
    const messageId = await ctx.db.insert("messages", {
      creatorId: a.creatorId,
      direction: "in",
      surface: "imessage",
      kind: a.kind,
      body: a.body,
      channelMessageId: a.channelMessageId,
      // The reaction path finds the reacted message by this field; on this channel it holds the vendor's id.
      telegramMessageId: a.aboutChannelMessageId,
      fileId: a.fileId,
      fileMime: a.fileMime,
      fileUniqueId: a.fileId ? a.channelMessageId : undefined,
      ts: a.ts ?? Date.now(),
    });
    const open = (await ctx.db.query("messages").withIndex("by_creator_and_awaiting", (q) => q.eq("creatorId", a.creatorId).eq("awaitingAnswer", true)).collect()) as Doc<"messages">[];
    for (const row of open) await ctx.db.patch(row._id, { awaitingAnswer: false });
    return { recorded: true, messageId };
  },
});

/**
 * X1: what the vendor told us about their chat, from any event or send: the chat id (typing, the
 * card), Linq's health (the rail's gate), the line they text. Their own message clears an opt-out:
 * Linq lifts it the moment they reply, and so do we.
 */
export const recordChat = internalMutation({
  args: { phone: v.string(), chatId: v.optional(v.string()), health: v.optional(v.string()), line: v.optional(v.string()), theyWrote: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.query("creators").withIndex("by_phone", (q) => q.eq("phone", a.phone)).first()) as Doc<"creators"> | null;
    if (!c || c.channel.kind !== "imessage") return null;
    const now = Date.now();
    await ctx.db.patch(c._id, {
      channel: {
        ...c.channel,
        ...(a.chatId ? { chatId: a.chatId } : {}),
        ...(a.health ? { health: a.health, healthAt: now } : {}),
        ...(a.line ? { line: a.line } : {}),
        ...(a.theyWrote ? { optedOutAt: undefined } : {}),
      },
      updatedAt: now,
    });
    return null;
  },
});

export const markOptedOut = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ first: boolean }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { first: false };
    if (c.channel.optedOutAt) return { first: false };
    await ctx.db.patch(a.creatorId, { channel: { ...c.channel, optedOutAt: Date.now() }, updatedAt: Date.now() });
    return { first: true };
  },
});

export const markCardShared = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (c) await ctx.db.patch(a.creatorId, { channel: { ...c.channel, cardSharedAt: Date.now() } });
    return null;
  },
});

/** A line's status or reputation changed (phone_number.status_updated): kept for the rail, and the operator hears about a bad turn. */
export const recordLine = internalMutation({
  args: { phoneNumber: v.string(), status: v.optional(v.string()), reputation: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ worse: boolean }> => {
    const key = `linq:line:${a.phoneNumber}`;
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
    const prev = row ? (JSON.parse(row.value) as { status: string | null; reputation: string | null }) : { status: null, reputation: null };
    const next = { status: a.status ?? prev.status, reputation: a.reputation ?? prev.reputation };
    const value = JSON.stringify(next);
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("syncState", { key, value, updatedAt: Date.now() });
    const bad = (x: { status: string | null; reputation: string | null }) => x.status === "FLAGGED" || x.reputation === "CRITICAL" || x.reputation === "AT_RISK";
    return { worse: bad(next) && !bad(prev) };
  },
});

/** A send the vendor accepted and then failed (message.failed): named on the row, never silent. */
export const markFailedByVendorId = internalMutation({
  args: { channelMessageId: v.string(), reason: v.string() },
  handler: async (ctx, a): Promise<{ found: boolean }> => {
    const row = (await ctx.db.query("messages").withIndex("by_channel_message", (q) => q.eq("channelMessageId", a.channelMessageId)).first()) as Doc<"messages"> | null;
    if (!row) return { found: false };
    await ctx.db.patch(row._id, { deliveredAt: undefined, deliveryError: a.reason });
    return { found: true };
  },
});

/** The vendor's id of an outbound, once it is known, so a tapback on it can be found. */
export const markVendorId = internalMutation({
  args: { messageId: v.id("messages"), channelMessageId: v.string() },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.patch(a.messageId, { channelMessageId: a.channelMessageId });
    return null;
  },
});

/* -------------------------------------------------------------------------- */
/* Inbound dispatch                                                            */
/* -------------------------------------------------------------------------- */

async function queueTurn(ctx: { runMutation: (ref: never, a: never) => Promise<unknown> }, creatorId: Id<"creators">, messageId: Id<"messages">, kind: string): Promise<void> {
  await (ctx as unknown as { runMutation: (ref: typeof internal.core.jobs.enqueue, a: { kind: string; idempotencyKey: string; creatorId: Id<"creators">; payloadJson: string }) => Promise<unknown> })
    .runMutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: `converse:${messageId}`, creatorId, payloadJson: JSON.stringify({ messageId, kind }) });
}

/**
 * One inbound text from a phone: pairing if it is a START, a menu pick if it matches the
 * live menu, otherwise text. Every path either records a row and queues her turn or names
 * why not; nothing goes quietly nowhere.
 */
export const handleText = internalAction({
  args: { from: v.string(), text: v.string(), channelMessageId: v.string(), service: v.optional(v.string()), ts: v.optional(v.number()), chatId: v.optional(v.string()), health: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const phone = normalizePhone(a.from);
    if (!phone) return { ok: false, reason: "not a phone number" };
    if (await ctx.runQuery(internal.core.imessage.seenVendorMessage, { channelMessageId: a.channelMessageId })) return { ok: true, reason: "duplicate" };
    // X1: an exact opt-out keyword (Linq's list) stops everything to them at once, and she says so once.
    // Anything they send later lifts it (recordChat below, and Linq's side). "stop texting me" in a
    // sentence is the classifier's pause, not this.
    if (isOptOutKeyword(a.text)) {
      const who = await ctx.runQuery(internal.core.imessage.creatorByPhone, { phone });
      if (!who?.paired) return { ok: true, reason: "opt-out from a number we don't talk to" };
      const r = await ctx.runMutation(internal.core.imessage.receiveInbound, { creatorId: who.creatorId, body: a.text, kind: "optout", channelMessageId: a.channelMessageId, ts: a.ts });
      const first = await ctx.runMutation(internal.core.imessage.markOptedOut, { creatorId: who.creatorId });
      if (first.first) await ctx.runAction(internal.core.imessage.sendRaw, { to: phone, text: OPT_OUT_REPLY, overrideOptout: true, idempotencyKey: `optout:${a.channelMessageId}` });
      return { ok: true, reason: r.recorded ? "opted out" : "opted out (duplicate)" };
    }
    await ctx.runMutation(internal.core.imessage.recordChat, { phone, chatId: a.chatId, health: a.health, theyWrote: true });

    // Pairing: their first text. By token when the START came through, by the number they gave us otherwise.
    const token = parseStartText(a.text);
    const known = await ctx.runQuery(internal.core.imessage.creatorByPhone, { phone });
    if (token || (known && !known.paired)) {
      const claimed = await ctx.runMutation(internal.core.pairing.claimPairingByPhone, { token: token ?? undefined, phone, service: a.service });
      if (!claimed.paired) {
        // A failed claim talks back; silence after texting START is the worst outcome.
        await ctx.runAction(internal.core.imessage.sendRaw, { to: phone, text: `${claimed.reason ?? "that didn't work"}. head back to the app and tap Text Maya again.` });
        return { ok: false, reason: claimed.reason };
      }
      await ctx.runMutation(internal.core.imessage.receiveInbound, { creatorId: claimed.creatorId!, body: a.text, kind: "pairing", channelMessageId: a.channelMessageId, ts: a.ts });
      return { ok: true, reason: "paired" };
    }
    if (!known) {
      // No link: a link in the first text on a line raises its flagging risk (Linq best practices).
      await ctx.runAction(internal.core.imessage.sendRaw, { to: phone, text: "I don't think we've met. sign up in the Maya app and I'll meet you back here.", idempotencyKey: `stranger:${a.channelMessageId}` });
      return { ok: false, reason: "unknown number" };
    }

    const menu = await ctx.runQuery(internal.core.imessage.liveMenu, { creatorId: known.creatorId, now: Date.now() });
    const pick = menuPick(a.text, menu ?? undefined);
    const kind = pick ? "button" : "inbound";
    const r = await ctx.runMutation(internal.core.imessage.receiveInbound, { creatorId: known.creatorId, body: pick ?? a.text, kind, channelMessageId: a.channelMessageId, ts: a.ts });
    if (!r.recorded || !r.messageId) return { ok: false, reason: r.reason };
    if (pick) await ctx.runAction(internal.core.imessage.sendRaw, { to: phone, text: pick.endsWith(":no") ? "ok, noted" : "on it", idempotencyKey: `ack:${a.channelMessageId}` });
    // "…is typing" while her turn runs, like Telegram's; one start lasts ~90 s (Linq). Never blocks.
    await ctx.scheduler.runAfter(0, internal.core.imessage.typing, { creatorId: known.creatorId });
    await queueTurn(ctx as never, known.creatorId, r.messageId, kind);
    return { ok: true };
  },
});

/** A tapback: mapped to the reaction the Telegram path already handles, or noticed and dropped. Never fails the webhook. */
export const handleReaction = internalAction({
  args: { from: v.string(), aboutChannelMessageId: v.string(), reactionType: v.string(), emoji: v.optional(v.string()), added: v.boolean(), eventId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const phone = normalizePhone(a.from);
    if (!phone) return { ok: false, reason: "not a phone number" };
    const known = await ctx.runQuery(internal.core.imessage.creatorByPhone, { phone });
    if (!known?.paired) return { ok: false, reason: "unknown or unpaired number" };
    const emoji = reactionEmoji(a.reactionType as ClawReactionType | "unknown", a.emoji ?? null, a.added);
    if (!emoji) return { ok: true, reason: `noticed a ${a.reactionType}, nothing to do` };
    // Linq delivers at least once: its event id makes a redelivery a duplicate. Claw has none, so the minute stands in.
    const channelMessageId = a.eventId ? `rx:${a.eventId}` : `rx:${a.aboutChannelMessageId}:${a.reactionType}:${a.added ? "on" : "off"}:${Math.floor(Date.now() / 60_000)}`;
    const r = await ctx.runMutation(internal.core.imessage.receiveInbound, { creatorId: known.creatorId, body: emoji, kind: "reaction", channelMessageId, aboutChannelMessageId: a.aboutChannelMessageId });
    if (!r.recorded || !r.messageId) return { ok: false, reason: r.reason };
    await queueTurn(ctx as never, known.creatorId, r.messageId, "reaction");
    return { ok: true };
  },
});

/** An attachment (a draft, a screenshot, a voice note): fetched by URL, stored, and handed to the same file path Telegram uses. */
export const handleAttachment = internalAction({
  args: { from: v.string(), url: v.string(), mimeType: v.string(), caption: v.optional(v.string()), channelMessageId: v.string(), ts: v.optional(v.number()), chatId: v.optional(v.string()), health: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const phone = normalizePhone(a.from);
    if (!phone) return { ok: false, reason: "not a phone number" };
    const known = await ctx.runQuery(internal.core.imessage.creatorByPhone, { phone });
    if (!known?.paired) return { ok: false, reason: "unknown or unpaired number" };
    await ctx.runMutation(internal.core.imessage.recordChat, { phone, chatId: a.chatId, health: a.health, theyWrote: true });
    if (await ctx.runQuery(internal.core.imessage.seenVendorMessage, { channelMessageId: a.channelMessageId })) return { ok: true, reason: "duplicate" };
    // Downloaded in Node: a phone video is often far more than the default runtime can hold.
    const got = await ctx.runAction(internal.core.bigMedia.fetchToStorage, { url: a.url, mimeType: a.mimeType });
    if (!got.ok) {
      await ctx.runMutation(internal.core.messages.send, { creatorId: known.creatorId, surface: "imessage", body: got.reason === "too big" ? "that one's over 150 MB, too big for me to pull in. send a shorter cut, or the link once it's posted." : "that file didn't come through. worth another try?", dedupeKey: `ingest-failed:${a.channelMessageId}`, proactive: false, kind: "reply" });
      return { ok: false, reason: got.reason };
    }
    const mime = got.mime;
    const storageId = got.storageId as Id<"_storage">;
    const r = await ctx.runMutation(internal.core.imessage.receiveInbound, { creatorId: known.creatorId, body: a.caption ?? "", kind: "file", channelMessageId: a.channelMessageId, fileId: storageId, fileMime: mime, ts: a.ts });
    if (!r.recorded || !r.messageId) return { ok: false, reason: r.reason };
    await ctx.scheduler.runAfter(0, internal.core.imessage.typing, { creatorId: known.creatorId });
    await ctx.runMutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: `converse:${r.messageId}`, creatorId: known.creatorId, payloadJson: JSON.stringify({ messageId: r.messageId, kind: "file", mime }) });
    return { ok: true };
  },
});

/* -------------------------------------------------------------------------- */
/* Outbound                                                                    */
/* -------------------------------------------------------------------------- */

/** A raw text to a phone, outside the message log: pairing receipts, "I don't think we've met", the opt-out goodbye. Never for her own words. */
export const sendRaw = internalAction({
  args: { to: v.string(), text: v.string(), overrideOptout: v.optional(v.boolean()), idempotencyKey: v.optional(v.string()) },
  handler: async (_ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    if (phoneVendor() === "linq") {
      const { resolveLinqIdentity, sendMessage } = await import("../integrations/linq/client");
      const identity = resolveLinqIdentity()!;
      const r = await sendMessage(identity, { to: a.to, parts: [{ type: "text", value: a.text }], idempotencyKey: a.idempotencyKey ?? `raw:${a.to}:${a.text.length}:${Math.floor(Date.now() / 60_000)}`, overrideOptout: a.overrideOptout });
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
    const { resolveClawIdentity, sendClawMessage } = await import("../integrations/claw/client");
    const identity = resolveClawIdentity();
    if (!identity) return { ok: false, reason: "the phone channel isn't configured" };
    const r = await sendClawMessage(identity, { to: a.to, text: a.text });
    return { ok: r.ok };
  },
});

/** Register their number on the line the moment they give it, so their first text is not refused. Linq needs none: they text first. */
export const registerPhone = internalAction({
  args: { phone: v.string() },
  handler: async (_ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    if (phoneVendor() === "linq") {
      // Onboarding is the one time we pick a line (never per message): Linq's best available line for a
      // NEW person, sticky if they already have a chat. Kept on the creator; the pairing screen shows it.
      const { resolveLinqIdentity, availableNumber } = await import("../integrations/linq/client");
      const r = await availableNumber(resolveLinqIdentity()!, a.phone);
      if (!r.ok) return { ok: false, reason: `couldn't pick a line: ${r.reason}` };
      await _ctx.runMutation(internal.core.imessage.recordChat, { phone: a.phone, line: r.phoneNumber });
      return { ok: true };
    }
    const { resolveClawIdentity, registerClawRoute } = await import("../integrations/claw/client");
    const identity = resolveClawIdentity();
    if (!identity) return { ok: false, reason: "the phone channel isn't configured on this deployment" };
    return await registerClawRoute(identity, a.phone);
  },
});

/** "…is typing" while her turn runs (Linq, iMessage only). Best effort; never blocks the turn. */
export const typing = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    if (phoneVendor() !== "linq") return { ok: false, reason: "typing is a Linq feature" };
    const chat = await ctx.runQuery(internal.core.imessage.chatOf, { creatorId: a.creatorId });
    if (!chat?.chatId) return { ok: false, reason: "no chat yet" };
    const { resolveLinqIdentity, startTyping } = await import("../integrations/linq/client");
    return await startTyping(resolveLinqIdentity()!, chat.chatId);
  },
});

export const chatOf = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ chatId: string | null; cardSharedAt: number | null; phone: string | null } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return c ? { chatId: c.channel.chatId ?? null, cardSharedAt: c.channel.cardSharedAt ?? null, phone: c.phone ?? null } : null;
  },
});

/**
 * Deliver one row to a phone. Called by `deliverMessage` (the one delivery function) when the
 * row's surface is this channel. Texts go one part at a time; the menu line rides on the last;
 * an album is tried as media and reported on the row when the vendor refuses it.
 */
export const deliver = internalAction({
  args: { messageId: v.id("messages"), phone: v.string(), body: v.string(), buttons: v.optional(v.array(v.object({ id: v.string(), label: v.string() }))), frames: v.optional(v.array(v.object({ url: v.string(), caption: v.string() }))) },
  handler: async (ctx, a): Promise<{ delivered: boolean; reason?: string }> => {
    if (phoneVendor() === "linq") return await deliverLinq(ctx, a);
    const { resolveClawIdentity, sendClawMessage } = await import("../integrations/claw/client");
    const identity = resolveClawIdentity();
    if (!identity) {
      const reason = "the phone channel isn't configured";
      await ctx.runMutation(internal.core.telegram.markDelivered, { messageId: a.messageId, error: reason });
      return { delivered: false, reason };
    }
    const parts = splitParts(a.body);
    if (a.buttons?.length) parts[parts.length - 1] = `${parts[parts.length - 1]}\n${menuLine(a.buttons)}`;
    let lastId: string | null = null;
    let service: ClawService | null = null;
    for (let i = 0; i < parts.length; i++) {
      const r = await sendClawMessage(identity, { to: a.phone, text: parts[i] });
      if (!r.ok) {
        const reason = `${r.reason}${i > 0 ? ` (after ${i} of ${parts.length} texts)` : ""}`;
        await ctx.runMutation(internal.core.telegram.markDelivered, { messageId: a.messageId, error: reason, ...(lastId ? { telegramMessageId: lastId } : {}) });
        // The first part failing is a failed delivery (the job retries); a later part is partial, never re-sent.
        return i > 0 ? { delivered: true, reason } : { delivered: false, reason: r.retryable ? reason : `${reason} (not retryable)` };
      }
      lastId = r.messageId;
      service = r.service ?? service;
      if (i < parts.length - 1) await new Promise((res) => setTimeout(res, 900));
    }
    if (a.frames?.length) {
      const album = await sendClawMessage(identity, { to: a.phone, text: a.frames.map((f) => f.caption).join(" · ").slice(0, 900), mediaUrls: a.frames.map((f) => f.url) });
      if (!album.ok) {
        await ctx.runMutation(internal.core.telegram.markDelivered, { messageId: a.messageId, error: `${album.reason} (album, after ${parts.length} text${parts.length === 1 ? "" : "s"})`, ...(lastId ? { telegramMessageId: lastId } : {}) });
        return { delivered: true, reason: album.reason };
      }
    }
    await ctx.runMutation(internal.core.telegram.markDelivered, { messageId: a.messageId, ...(lastId ? { telegramMessageId: lastId } : {}) });
    if (lastId) await ctx.runMutation(internal.core.imessage.markVendorId, { messageId: a.messageId, channelMessageId: lastId });
    if (service) console.log(`[imessage] delivered ${a.messageId} as ${service}`);
    return { delivered: true };
  },
});

/**
 * X1: one row through Linq. One message per text part (Linq rejects consecutive text parts), each
 * with an idempotency key from the row and the part, so a retried job can never text twice; no
 * `from`, so Linq picks and fails over the line. Storyboard frames go as one text + media message.
 * After the first successful part: the chat id and health are kept, and the contact card is offered
 * at most once a day. An opt-out refusal (2024) is honoured and marked, never retried.
 */
async function deliverLinq(
  ctx: ActionCtx,
  a: { messageId: Id<"messages">; phone: string; body: string; buttons?: Array<{ id: string; label: string }>; frames?: Array<{ url: string; caption: string }> },
): Promise<{ delivered: boolean; reason?: string }> {
  const { resolveLinqIdentity, sendMessage, shareContactCard } = await import("../integrations/linq/client");
  const identity = resolveLinqIdentity()!;
  const parts = splitParts(a.body);
  if (a.buttons?.length) parts[parts.length - 1] = `${parts[parts.length - 1]}\n${menuLine(a.buttons)}`;
  const sends: Array<{ key: string; parts: Array<{ type: "text"; value: string } | { type: "media"; url: string }> }> = parts.map((t, i) => ({ key: `${a.messageId}:${i}`, parts: [{ type: "text" as const, value: t }] }));
  if (a.frames?.length) sends.push({ key: `${a.messageId}:frames`, parts: [{ type: "text", value: a.frames.map((f) => f.caption).join(" · ").slice(0, 900) }, ...a.frames.map((f) => ({ type: "media" as const, url: f.url }))] });
  let lastId: string | null = null;
  let chatId: string | null = null;
  for (let i = 0; i < sends.length; i++) {
    const r = await sendMessage(identity, { to: a.phone, parts: sends[i].parts, idempotencyKey: sends[i].key });
    if (!r.ok) {
      const creator = await ctx.runQuery(internal.core.imessage.creatorByPhone, { phone: a.phone });
      if (r.kind === "opted_out" && creator) await ctx.runMutation(internal.core.imessage.markOptedOut, { creatorId: creator.creatorId });
      const reason = `${r.reason}${r.retryAfterS ? ` (retry after ${r.retryAfterS}s)` : ""}${i > 0 ? ` (after ${i} of ${sends.length} texts)` : ""}`;
      await ctx.runMutation(internal.core.telegram.markDelivered, { messageId: a.messageId, error: reason, ...(lastId ? { telegramMessageId: lastId } : {}) });
      // The first part failing is a failed delivery (the job retries, and the key makes a retry safe); a later part is partial.
      return i > 0 ? { delivered: true, reason } : { delivered: false, reason: r.retryable ? reason : `${reason} (not retryable)` };
    }
    lastId = r.messageId;
    chatId = r.chatId;
    if (i === 0) await ctx.runMutation(internal.core.imessage.recordChat, { phone: a.phone, chatId: r.chatId, ...(r.health ? { health: r.health } : {}), ...(r.from ? { line: r.from } : {}) });
    if (i < sends.length - 1) await new Promise((res) => setTimeout(res, 900));
  }
  await ctx.runMutation(internal.core.telegram.markDelivered, { messageId: a.messageId, ...(lastId ? { telegramMessageId: lastId } : {}) });
  if (lastId) await ctx.runMutation(internal.core.imessage.markVendorId, { messageId: a.messageId, channelMessageId: lastId });
  // Her name and photo: offered after an outbound, at most once a day (no card on the line yet is not an error for them).
  const creator = await ctx.runQuery(internal.core.imessage.creatorByPhone, { phone: a.phone });
  const chat = creator ? await ctx.runQuery(internal.core.imessage.chatOf, { creatorId: creator.creatorId }) : null;
  if (creator && chatId && (!chat?.cardSharedAt || Date.now() - chat.cardSharedAt >= CARD_SHARE_EVERY_MS)) {
    const shared = await shareContactCard(identity, chatId);
    if (shared.ok) await ctx.runMutation(internal.core.imessage.markCardShared, { creatorId: creator.creatorId });
    else console.warn(`[imessage] contact card not shared for ${creator.creatorId}: ${shared.reason}`);
  }
  return { delivered: true };
}
