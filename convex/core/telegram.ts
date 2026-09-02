/**
 * The Telegram transport (plan §12.6). Adapted from the legacy module: the same
 * "written is not delivered" discipline, delivery as a job, typing before slow
 * work; minus the Fly machine hand-off. Inbound now enqueues a `converse` job
 * for the dispatcher (§11.4) instead of waking a machine.
 *
 * `deliveredAt` is the proof a row reached a person; `deliveryError` is the
 * named failure when it did not, on outbound AND inbound rows (an inbound row
 * with `deliveryError` means "she never received it").
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Outbound                                                                    */
/* -------------------------------------------------------------------------- */

export const markDelivered = internalMutation({
  args: {
    messageId: v.id("messages"),
    deliveredAt: v.optional(v.number()),
    error: v.optional(v.string()),
    telegramMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.messageId, {
      deliveredAt: args.error ? undefined : (args.deliveredAt ?? Date.now()),
      deliveryError: args.error,
      telegramMessageId: args.telegramMessageId,
    });
    return null;
  },
});

export const deliveryTarget = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    chatId: string | null;
    body: string;
    buttons?: Array<{ id: string; label: string }>;
    alreadyDelivered: boolean;
  } | null> => {
    const message = (await ctx.db.get(args.messageId)) as Doc<"messages"> | null;
    if (!message) return null;
    const creator = (await ctx.db.get(message.creatorId)) as Doc<"creators"> | null;
    return {
      chatId: creator?.telegramChatId ?? null,
      body: message.body,
      buttons: message.buttons,
      // Idempotency: the queue retries, and a retry must not re-send a message
      // that already landed. People notice being told the same thing twice.
      alreadyDelivered: message.deliveredAt !== undefined,
    };
  },
});

/**
 * Deliver one message. The `deliver_message` job handler.
 *
 * Returns rather than throws on a missing chat id, because that isn't a
 * transient fault worth retrying: nobody has paired Telegram yet.
 */
export const deliverMessage = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args): Promise<{ delivered: boolean; reason?: string }> => {
    const target = await ctx.runQuery(internal.core.telegram.deliveryTarget, { messageId: args.messageId });
    if (!target) return { delivered: false, reason: "message not found" };
    if (target.alreadyDelivered) return { delivered: true };

    if (!target.chatId) {
      const reason = "no Telegram chat paired for this account";
      await ctx.runMutation(internal.core.telegram.markDelivered, { messageId: args.messageId, error: reason });
      return { delivered: false, reason };
    }

    const { resolveTelegramBotIdentity, sendTelegramMessage } = await import("../integrations/telegram/client");
    const identity = resolveTelegramBotIdentity();
    if (!identity) {
      const reason = "the Telegram bot isn't configured";
      await ctx.runMutation(internal.core.telegram.markDelivered, { messageId: args.messageId, error: reason });
      return { delivered: false, reason };
    }

    const result = await sendTelegramMessage(identity, {
      chatId: target.chatId,
      text: target.body,
      buttons: target.buttons,
    });

    if (!result.ok) {
      // Recorded, not swallowed. The job's own retry handles transience; this
      // is what makes a permanent failure visible instead of invisible.
      const reason = result.description ?? "Telegram rejected the message";
      await ctx.runMutation(internal.core.telegram.markDelivered, { messageId: args.messageId, error: reason });
      return { delivered: false, reason };
    }

    await ctx.runMutation(internal.core.telegram.markDelivered, {
      messageId: args.messageId,
      telegramMessageId: String(result.result.message_id),
    });
    return { delivered: true };
  },
});

/* -------------------------------------------------------------------------- */
/* Inbound                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Typing indicator, before anything slow. Telegram clears it after ~5 s; a
 * model turn is usually 3–15 s, so one send inline plus a couple of scheduled
 * refreshes cover it. Best-effort: never throws, never retried.
 */
const TYPING_REFRESHES = 3;
const TYPING_REFRESH_MS = 4_000;

async function sendOneChatAction(chatId: string): Promise<boolean> {
  try {
    const { resolveTelegramBotIdentity, sendTelegramChatAction } = await import("../integrations/telegram/client");
    const identity = resolveTelegramBotIdentity();
    if (!identity) return false;
    return (await sendTelegramChatAction(identity, { chatId })).ok;
  } catch {
    return false;
  }
}

/** One indicator, immediately. Awaited by the webhook, so it must stay fast. */
export const showTyping = internalAction({
  args: { chatId: v.string() },
  handler: async (_ctx, args): Promise<{ shown: boolean }> => ({ shown: await sendOneChatAction(args.chatId) }),
});

/** Keep the indicator alive across a turn. Scheduled, never awaited. */
export const holdTyping = internalAction({
  args: { chatId: v.string() },
  handler: async (_ctx, args): Promise<{ sends: number }> => {
    let sends = 0;
    for (let i = 0; i < TYPING_REFRESHES; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, TYPING_REFRESH_MS));
      const ok = await sendOneChatAction(args.chatId);
      sends += 1;
      if (!ok) break;
    }
    return { sends };
  },
});

export const creatorByChatId = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, args): Promise<Id<"creators"> | null> => {
    const row = (await ctx.db
      .query("creators")
      .withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", args.chatId))
      .first()) as Doc<"creators"> | null;
    return row?._id ?? null;
  },
});

/**
 * Has this Telegram update already been processed? Telegram replays updates on
 * any non-200, so every handler checks before acting (plan §12.6).
 */
export const seenUpdate = internalQuery({
  args: { updateId: v.number() },
  handler: async (ctx, args): Promise<boolean> => {
    const row = await ctx.db
      .query("messages")
      .withIndex("by_telegramUpdateId", (q) => q.eq("telegramUpdateId", args.updateId))
      .first();
    return row !== null;
  },
});

/**
 * Record an inbound Telegram message. A message from an unknown chat is dropped
 * with a reason rather than creating anything: an unpaired chat is either
 * someone who found the bot, or a pairing that hasn't finished.
 */
export const receiveInbound = internalMutation({
  args: {
    chatId: v.string(),
    text: v.string(),
    kind: v.optional(v.string()), // inbound | button | reaction | file
    updateId: v.optional(v.number()),
    telegramMessageId: v.optional(v.string()),
    ts: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ recorded: boolean; reason?: string; messageId?: Id<"messages">; creatorId?: Id<"creators"> }> => {
    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", args.chatId))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { recorded: false, reason: "unpaired chat" };
    if (args.text.trim().length === 0 && args.kind !== "file") return { recorded: false, reason: "empty message" };

    if (args.updateId !== undefined) {
      const dup = await ctx.db
        .query("messages")
        .withIndex("by_telegramUpdateId", (q) => q.eq("telegramUpdateId", args.updateId))
        .first();
      if (dup) return { recorded: false, reason: "duplicate update" };
    }

    const messageId = await ctx.db.insert("messages", {
      creatorId: creator._id,
      direction: "in",
      surface: "telegram",
      kind: args.kind ?? "inbound",
      body: args.text,
      telegramUpdateId: args.updateId,
      telegramMessageId: args.telegramMessageId,
      ts: args.ts ?? Date.now(),
    });

    // An inbound message answers whatever was outstanding. At most one open
    // question; this is what closes it, so she isn't blocked from the next one.
    const open = (await ctx.db
      .query("messages")
      .withIndex("by_creator_and_awaiting", (q) => q.eq("creatorId", creator._id).eq("awaitingAnswer", true))
      .collect()) as Doc<"messages">[];
    for (const row of open) await ctx.db.patch(row._id, { awaitingAnswer: false });

    return { recorded: true, messageId, creatorId: creator._id };
  },
});

/**
 * Mark an inbound message as never having reached her. Written on the INBOUND
 * row: `deliveryError` means "this message did not arrive", whichever way it
 * was travelling, and the creator not being heard is the more serious case.
 */
export const markInboundUndelivered = internalMutation({
  args: { messageId: v.id("messages"), reason: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.messageId, { deliveryError: args.reason });
    return null;
  },
});

/**
 * Handle one inbound text: record it, then hand it to the dispatcher as a
 * `converse` job. The job is what makes a failure visible: a turn that cannot
 * run produces a retry and then a dead letter the creator hears about (§16.1),
 * never a message that quietly went nowhere.
 */
export const handleInbound = internalAction({
  args: {
    chatId: v.string(),
    text: v.string(),
    kind: v.optional(v.string()),
    updateId: v.optional(v.number()),
    telegramMessageId: v.optional(v.string()),
    ts: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ recorded: boolean; reason?: string }> => {
    const recorded = await ctx.runMutation(internal.core.telegram.receiveInbound, args);
    if (!recorded.recorded || !recorded.messageId || !recorded.creatorId) return recorded;

    try {
      await ctx.runMutation(internal.core.jobs.enqueue, {
        kind: "converse",
        idempotencyKey: `converse:${recorded.messageId}`,
        creatorId: recorded.creatorId,
        payloadJson: JSON.stringify({ messageId: recorded.messageId, chatId: args.chatId, kind: args.kind ?? "inbound" }),
      });
    } catch (error) {
      // Named AND recorded: a reason computed and thrown away is indistinguishable
      // from being ignored (scar tissue, 2026-08-12).
      await ctx.runMutation(internal.core.telegram.markInboundUndelivered, {
        messageId: recorded.messageId,
        reason: `could not queue her turn: ${String(error)}`,
      });
      return { recorded: true, reason: String(error) };
    }
    return { recorded: true };
  },
});
