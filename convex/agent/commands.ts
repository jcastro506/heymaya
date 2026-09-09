/**
 * Commands (plan §15.3): stop, resume, forget that, talk to a person, delete. Matched
 * by code in `inbound.ts`, executed here, never by a model. Every one is enforced by
 * a row (plan status, a tombstone, a forwarded message), and answered in one line.
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { deliverNow } from "../core/scheduler";
import { resolveTelegramBotIdentity, sendTelegramMessage } from "../integrations/telegram/client";
import { forgetEvidence, recordVisible } from "./personalHistory";

export const apply = internalMutation({
  args: { creatorId: v.id("creators"), command: v.union(v.literal("stop"), v.literal("resume"), v.literal("forget"), v.literal("delete")), topic: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ body: string }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { body: "" };
    const now = Date.now();
    if (a.command === "stop") {
      if (c.plan.status !== "paused") await ctx.db.patch(c._id, { plan: { ...c.plan, status: "paused" }, updatedAt: now });
      return { body: "paused. i'll stop texting first. say resume whenever, and i'm still here if you write." };
    }
    if (a.command === "resume") {
      if (c.plan.status === "paused") await ctx.db.patch(c._id, { plan: { ...c.plan, status: "active" }, updatedAt: now });
      return { body: "back on. i'll pick up from where the lane is now, not from where it was." };
    }
    if (a.command === "forget") {
      const live = (c.notes ?? []).filter((n) => !n.tombstonedAt).sort((x, y) => y.at - x.at);
      // A named thing ("about my sister") forgets the newest note that carries those words; an empty match is said plainly, nothing else is touched.
      if (a.topic) {
        const words = a.topic.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length >= 3 && !["the", "that", "this", "about", "what", "told", "said", "you", "and", "for", "with", "thing"].includes(w));
        const hit = live.find((n) => words.some((w) => n.text.toLowerCase().includes(w)));
        if (!hit) return { body: `i don't have anything kept about ${a.topic}. tell me the line and i'll drop it.` };
        await forgetEvidence(ctx, c, hit);
        return { body: `forgotten: "${hit.text.slice(0, 80)}".` };
      }
      let last = live[0];
      const records = await ctx.db.query("personalRecords").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(30);
      for (const record of records) {
        if (record.kind !== "style" && (!last || record.at > last.at) && await recordVisible(ctx, record, c._id)) {
          last = { id: String(record._id), text: record.text, kind: "fact", at: record.at, sourceMessageId: record.sourceMessageIds[0] };
        }
      }
      if (!last) return { body: "nothing recent to forget. tell me what you mean and i'll drop it." };
      await forgetEvidence(ctx, c, last);
      return { body: `forgotten: "${last.text.slice(0, 80)}".` };
    }
    // delete: the nine-step procedure (§16.5) runs from Settings after a confirm; never from a text alone.
    return { body: `deleting everything is a one-tap in Settings, so it can't happen by accident from a text. ${process.env.APP_URL ?? ""}/app/settings` };
  },
});

/** "Talk to a person": the thread goes to the operator chat, and she says so. */
export const person = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages") },
  handler: async (ctx, a): Promise<{ forwarded: boolean }> => {
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId, messageId: a.messageId });
    if (!g) return { forwarded: false };
    const operator = process.env.TELEGRAM_OPERATOR_CHAT_ID;
    const identity = resolveTelegramBotIdentity();
    let forwarded = false;
    if (operator && identity) {
      const thread = g.recent.slice(-8).map((m) => `${m.direction === "in" ? "them" : "maya"}: ${m.body.slice(0, 300)}`).join("\n");
      const r = await sendTelegramMessage(identity, { chatId: operator, text: `👤 ${g.creator.handles.tiktok ? "@" + g.creator.handles.tiktok : g.creator.email} asked for a person (creator ${g.creator._id}).\n\n${thread}` }).catch(() => null);
      forwarded = Boolean(r && r.ok);
    }
    await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: forwarded ? "a person will reply here. i've sent them the thread." : "i've flagged this for a person; they'll reply here.", dedupeKey: `person:${a.messageId}`, proactive: false, kind: "reply" });
    await deliverNow(ctx as never);
    return { forwarded };
  },
});

export type CommandId = Id<"messages">;
