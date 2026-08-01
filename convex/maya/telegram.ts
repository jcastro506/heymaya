/**
 * The Telegram transport (§3.2, §18 Sprint 2).
 *
 * The message log already exists and both surfaces read it. This is the part
 * that makes a row in that log actually reach a person, and the part that
 * records whether it did.
 *
 * ## Written is not delivered
 *
 * A row in `messages` means *we wrote it*. It does not mean *they got it*.
 * Conflating those is precisely how the old system produced eaten replies: the
 * transcript showed a message the founder never received, so every subsequent
 * decision — including "I already told them that" — was made against a
 * conversation that only ever existed on our side.
 *
 * So outbound rows start undelivered and are proven otherwise. `deliveredAt`
 * is the proof; `deliveryError` is the named failure when there isn't any.
 *
 * ## Delivery is a job, not a side effect
 *
 * Sending inline with the write would mean a transient Telegram 502 silently
 * loses a brief. Instead `send` writes the row and enqueues `deliver_message`,
 * the queue retries with backoff, and a message that never lands ends up in
 * the dead-letter view where someone can see it — rather than nowhere.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
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
  },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.messageId, {
      deliveredAt: args.error ? undefined : (args.deliveredAt ?? Date.now()),
      deliveryError: args.error,
    });
    return null;
  },
});

export const deliveryTarget = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (
    ctx,
    args
  ): Promise<{
    chatId: string | null;
    body: string;
    alreadyDelivered: boolean;
  } | null> => {
    const message = (await ctx.db.get(args.messageId)) as Doc<"messages"> | null;
    if (!message) return null;
    const customer = (await ctx.db.get(
      message.customerId
    )) as Doc<"customers"> | null;
    return {
      chatId: customer?.telegramChatId ?? null,
      body: message.body,
      // Idempotency: the queue retries, and a retry must not re-send a message
      // that already landed. Founders notice being told the same thing twice.
      alreadyDelivered: message.deliveredAt !== undefined,
    };
  },
});

/**
 * Deliver one message. The `deliver_message` job handler.
 *
 * Returns rather than throws on a missing chat id, because that isn't a
 * transient fault worth retrying — nobody has paired Telegram yet, and
 * retrying five times with backoff just delays the same answer.
 */
export const deliverMessage = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (
    ctx,
    args
  ): Promise<{ delivered: boolean; reason?: string }> => {
    const target = await ctx.runQuery(internal.maya.telegram.deliveryTarget, {
      messageId: args.messageId,
    });
    if (!target) return { delivered: false, reason: "message not found" };
    if (target.alreadyDelivered) return { delivered: true };

    if (!target.chatId) {
      const reason = "no Telegram chat paired for this account";
      await ctx.runMutation(internal.maya.telegram.markDelivered, {
        messageId: args.messageId,
        error: reason,
      });
      return { delivered: false, reason };
    }

    const { resolveTelegramBotIdentity, sendTelegramMessage } = await import(
      "../integrations/telegram/client"
    );
    const identity = resolveTelegramBotIdentity({});
    if (!identity) {
      const reason = "the Telegram bot isn't configured";
      await ctx.runMutation(internal.maya.telegram.markDelivered, {
        messageId: args.messageId,
        error: reason,
      });
      return { delivered: false, reason };
    }

    const result = await sendTelegramMessage(identity, {
      chatId: target.chatId,
      text: target.body,
    });

    if (!result.ok) {
      // Recorded, not swallowed. The job's own retry handles transience; this
      // is what makes a permanent failure visible instead of invisible.
      const reason = result.description ?? "Telegram rejected the message";
      await ctx.runMutation(internal.maya.telegram.markDelivered, {
        messageId: args.messageId,
        error: reason,
      });
      return { delivered: false, reason };
    }

    await ctx.runMutation(internal.maya.telegram.markDelivered, {
      messageId: args.messageId,
    });
    return { delivered: true };
  },
});

/**
 * Outbound messages that never reached anyone.
 *
 * The honest answer to "did she actually say that?" — and the thing the
 * liveness sweep should eventually read, because a brief that was written and
 * never delivered is indistinguishable from a brief that was never written,
 * from the founder's side.
 */
export const undelivered = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"messages">[]> => {
    const rows = (await ctx.db
      .query("messages")
      .withIndex("by_delivery", (q) =>
        q.eq("direction", "out").eq("deliveredAt", undefined)
      )
      .take(args.limit ?? 100)) as Doc<"messages">[];
    return rows;
  },
});

/* -------------------------------------------------------------------------- */
/* Inbound                                                                     */
/* -------------------------------------------------------------------------- */

export const customerByChatId = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, args): Promise<Id<"customers"> | null> => {
    const row = (await ctx.db
      .query("customers")
      .withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", args.chatId))
      .first()) as Doc<"customers"> | null;
    return row?._id ?? null;
  },
});

/**
 * Record an inbound Telegram message.
 *
 * A message from an unknown chat is dropped with a reason rather than creating
 * anything — an unpaired chat is either someone who found the bot, or a
 * pairing that hasn't finished. Neither should mint a customer.
 */
export const receiveInbound = internalMutation({
  args: {
    chatId: v.string(),
    text: v.string(),
    ts: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ recorded: boolean; reason?: string }> => {
    const customer = (await ctx.db
      .query("customers")
      .withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", args.chatId))
      .first()) as Doc<"customers"> | null;
    if (!customer) {
      return { recorded: false, reason: "unpaired chat" };
    }
    if (args.text.trim().length === 0) {
      return { recorded: false, reason: "empty message" };
    }

    await ctx.db.insert("messages", {
      customerId: customer._id,
      direction: "in",
      surface: "telegram",
      body: args.text,
      ts: args.ts ?? Date.now(),
    });

    // An inbound message answers whatever was outstanding. Invariant 5 keeps
    // at most one open question; this is what closes it, so she isn't blocked
    // from asking the next one.
    const open = (await ctx.db
      .query("messages")
      .withIndex("by_customer_and_awaiting", (q) =>
        q.eq("customerId", customer._id).eq("awaitingAnswer", true)
      )
      .collect()) as Doc<"messages">[];
    for (const row of open) {
      await ctx.db.patch(row._id, { awaitingAnswer: false });
    }

    return { recorded: true };
  },
});
