/**
 * Nothing they agree to make is left without a time (2026-09-06, the operator: "she should
 * always make sure it ends up on the calendar"). When they save an idea, or reply warmly to
 * one, she proposes the next free filming slot as one tap. The slot is code: their film hour,
 * their busy calendar, their existing blocks. The words are hers.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { freeSlotOn, PLAN } from "./planning";

/** Pure: the offer, in words. */
export function offerText(start: number, tz: string, hook: string): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(start).toLowerCase();
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(start).toLowerCase().replace(":00", "");
  return `${day} ${time} is free for "${hook.slice(0, 60)}". block it and i'll remind you before?`;
}

/**
 * Propose a film block for an idea, or return the one it already has. Never two blocks for
 * one idea; never a slot in the past; never on top of something on their calendar.
 */
export const proposeSlot = internalMutation({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ blockId: Id<"calendarBlocks">; start: number; existing: boolean; consented: boolean; hook: string } | null> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const idea = (await ctx.db.get(a.ideaId)) as Doc<"ideas"> | null;
    if (!creator || !idea || idea.creatorId !== a.creatorId) return null;
    const now = a.now ?? Date.now();
    const hook = ((idea.version as { hook?: string } | undefined)?.hook ?? idea.messageText).slice(0, 80);
    const blocks = ((await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("start", now - 3_600_000)).take(200)) as Doc<"calendarBlocks">[]).filter((b) => b.status !== "deleted");
    const mine = blocks.find((b) => b.ideaId === a.ideaId && b.kind === "film");
    if (mine) return { blockId: mine._id, start: mine.start, existing: true, consented: Boolean(mine.consentAt), hook };
    const events = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", a.creatorId).gte("start", now).lte("start", now + 8 * 86_400_000)).take(200)) as Doc<"calendarEvents">[];
    const busy = [...events.filter((e) => e.status === "active" && !e.allDay).map((e) => ({ start: e.start, end: e.end })), ...blocks.map((b) => ({ start: b.start, end: b.end }))];
    const preferHour = PLAN.defaultFilmHour; // preferredSendHour is when they reply, not when they film (2026-09-07)
    for (let d = 1; d <= 7; d++) {
      const slot = freeSlotOn(now + d * 86_400_000, PLAN.filmMinutes, busy, preferHour, creator.timezone);
      if (!slot || slot.start <= now) continue;
      const blockId = await ctx.db.insert("calendarBlocks", { creatorId: a.creatorId, kind: "film", start: slot.start, end: slot.end, title: `film: ${hook.slice(0, 60)}`, ideaId: a.ideaId, status: "proposed", createdAt: now });
      return { blockId, start: slot.start, existing: false, consented: false, hook };
    }
    return null;
  },
});

/** The offer as a message: propose (or find) the slot, say it, one tap to block. Idempotent per idea. */
export const offer = internalAction({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas") },
  handler: async (ctx, a): Promise<{ sent: boolean; reason?: string }> => {
    const p = await ctx.runMutation(internal.calendar.secure.proposeSlot, { creatorId: a.creatorId, ideaId: a.ideaId });
    if (!p) return { sent: false, reason: "no free slot in the next week, or no such idea" };
    if (p.existing && p.consented) return { sent: false, reason: "already on the calendar" };
    const creator = await ctx.runQuery(internal.calendar.secure.creatorTz, { creatorId: a.creatorId });
    if (!creator) return { sent: false, reason: "creator not found" };
    const { sent } = await ctx.runMutation(internal.core.messages.send, {
      creatorId: a.creatorId, surface: "telegram", body: offerText(p.start, creator.timezone, p.hook),
      dedupeKey: `secure:${a.ideaId}`, proactive: false, kind: "reply",
      buttons: [{ id: `block:${p.blockId}:yes`, label: "block it" }, { id: `block:${p.blockId}:no`, label: "not now" }],
    });
    if (sent) await ctx.runAction(internal.core.scheduler.drainJobs, { kinds: ["deliver_message"] });
    return { sent };
  },
});

export const creatorTz = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ timezone: string } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return c ? { timezone: c.timezone } : null;
  },
});
