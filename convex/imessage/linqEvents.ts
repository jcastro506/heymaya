/**
 * The work behind Linq's webhook (X1), scheduled so the webhook answers inside Linq's 10 s. Each is
 * idempotent: an at-least-once redelivery changes nothing the first delivery didn't.
 */
import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import type { Doc } from "../_generated/dataModel";

/** Linq's chat health rides on every chat event; the rail reads the newest. */
export const healthByChat = internalMutation({
  args: { chatId: v.string(), health: v.string() },
  handler: async (ctx, a): Promise<{ found: boolean }> => {
    const c = (await ctx.db.query("creators").withIndex("by_chat", (q) => q.eq("channel.chatId", a.chatId)).first()) as Doc<"creators"> | null;
    if (!c) return { found: false };
    if (c.channel.health !== a.health) await ctx.db.patch(c._id, { channel: { ...c.channel, health: a.health, healthAt: Date.now() } });
    return { found: true };
  },
});

/**
 * A send Linq accepted and then couldn't deliver: named on the row (never silent), and a 2024
 * (they opted out) is honoured at once.
 */
export const failed = internalMutation({
  args: { channelMessageId: v.string(), reason: v.string(), code: v.optional(v.number()), chatId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ found: boolean }> => {
    const row = (await ctx.db.query("messages").withIndex("by_channel_message", (q) => q.eq("channelMessageId", a.channelMessageId)).first()) as Doc<"messages"> | null;
    if (row) await ctx.db.patch(row._id, { deliveredAt: undefined, deliveryError: `not delivered: ${a.reason}` });
    if (a.code === 2024) {
      const c = row ? ((await ctx.db.get(row.creatorId)) as Doc<"creators"> | null) : a.chatId ? ((await ctx.db.query("creators").withIndex("by_chat", (q) => q.eq("channel.chatId", a.chatId)).first()) as Doc<"creators"> | null) : null;
      if (c && !c.channel.optedOutAt) await ctx.db.patch(c._id, { channel: { ...c.channel, optedOutAt: Date.now() } });
    }
    return { found: Boolean(row) };
  },
});

/**
 * A line's status or reputation changed. Kept for the rail (syncState `linq:line:<number>`), and a
 * turn for the worse is a failing `vendorHealth` row, which the hourly operator alert already reports
 * (core/alerts.ts, customer-chat guard included). Linq: page on FLAGGED, slow on AT_RISK/CRITICAL.
 */
export const line = internalMutation({
  args: { phoneNumber: v.string(), status: v.optional(v.string()), reputation: v.optional(v.string()), previousStatus: v.optional(v.string()), previousReputation: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ bad: boolean }> => {
    const key = `linq:line:${a.phoneNumber}`;
    const value = JSON.stringify({ status: a.status ?? null, reputation: a.reputation ?? null });
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("syncState", { key, value, updatedAt: Date.now() });
    const bad = a.status === "FLAGGED" || a.reputation === "CRITICAL" || a.reputation === "AT_RISK";
    await ctx.db.insert("vendorHealth", { vendor: "linq", check: `line ${a.phoneNumber}`, ok: !bad, detail: { status: a.status ?? null, reputation: a.reputation ?? null, was: { status: a.previousStatus ?? null, reputation: a.previousReputation ?? null } }, at: Date.now() });
    return { bad };
  },
});
