/**
 * Reminders around a block they booked (plan Sprint 4b).
 *
 * Three touches, each scheduled at booking time and RE-VALIDATED when it fires, so a
 * moved or dropped block simply produces nothing and we never track scheduler ids:
 *   prep      — the morning of a filming block, with the shot list
 *   check-in  — fifteen minutes before it: still good? [yes] [push it] [skip]
 *   post nudge — ten minutes before the post time, only if she knows they filmed
 *
 * Rules in code: at most two touches per block, a dedupe key per touch, never inside
 * quiet hours, and reminders are exempt from the daily proactive cap (see
 * `proactiveSentToday`): they exist only because the creator committed to something.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { inQuietHours } from "../scout/gate";
import { THRESHOLDS } from "../config/thresholds";
import { atLocalHour, localHour } from "./postTime";
import { freeSlotOn, PLAN } from "./planning";

export const REMINDER = {
  maxTouchesPerBlock: 2,
  checkInMinutesBefore: 15,
  postNudgeMinutesBefore: 10,
  prepHourLocal: 8,
  prepMinuteLocal: 40,
} as const;

const fmtTime = (e: number, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(e).toLowerCase().replace(":00", "");

export const context = internalQuery({
  args: { blockId: v.id("calendarBlocks") },
  handler: async (ctx, a): Promise<{ block: Doc<"calendarBlocks">; creator: Doc<"creators">; idea: Doc<"ideas"> | null; shotList: string | null } | null> => {
    const block = (await ctx.db.get(a.blockId)) as Doc<"calendarBlocks"> | null;
    if (!block) return null;
    const creator = (await ctx.db.get(block.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const idea = block.ideaId ? ((await ctx.db.get(block.ideaId)) as Doc<"ideas"> | null) : null;
    const v = idea?.version as { hook?: string; onScreenText?: string; lengthSec?: number; sound?: string } | undefined;
    const shotList = v ? [v.hook ? `open: ${v.hook}` : null, v.onScreenText ? `text: ${v.onScreenText}` : null, v.lengthSec ? `under ${v.lengthSec}s` : null, v.sound ? `sound: ${v.sound}` : null].filter(Boolean).join(". ") : null;
    return { block, creator, idea, shotList };
  },
});

export const touched = internalMutation({
  args: { blockId: v.id("calendarBlocks"), touch: v.string(), filmedAt: v.optional(v.number()) },
  handler: async (ctx, a): Promise<null> => {
    const b = (await ctx.db.get(a.blockId)) as Doc<"calendarBlocks"> | null;
    if (!b) return null;
    const touches = Array.from(new Set([...(b.touches ?? []), a.touch]));
    await ctx.db.patch(a.blockId, { touches, ...(a.filmedAt ? { filmedAt: a.filmedAt } : {}) });
    return null;
  },
});

/** Schedule the touches for one confirmed block. Idempotent by re-validation at fire time. */
export const scheduleFor = internalAction({
  args: { blockId: v.id("calendarBlocks") },
  handler: async (ctx, a): Promise<{ scheduled: string[] }> => {
    const c = await ctx.runQuery(internal.calendar.reminders.context, { blockId: a.blockId });
    if (!c) return { scheduled: [] };
    const { block, creator } = c;
    const out: string[] = [];
    if (block.kind === "film") {
      const prepAt = atLocalHour(block.start, REMINDER.prepHourLocal, creator.timezone) + REMINDER.prepMinuteLocal * 60_000;
      if (prepAt > Date.now() && prepAt < block.start) { await ctx.scheduler.runAt(prepAt, internal.calendar.reminders.fire, { blockId: a.blockId, touch: "prep", expectedStart: block.start }); out.push("prep"); }
      const checkAt = block.start - REMINDER.checkInMinutesBefore * 60_000;
      if (checkAt > Date.now()) { await ctx.scheduler.runAt(checkAt, internal.calendar.reminders.fire, { blockId: a.blockId, touch: "checkin", expectedStart: block.start }); out.push("checkin"); }
    }
    if (block.kind === "post") {
      const nudgeAt = block.start - REMINDER.postNudgeMinutesBefore * 60_000;
      if (nudgeAt > Date.now()) { await ctx.scheduler.runAt(nudgeAt, internal.calendar.reminders.fire, { blockId: a.blockId, touch: "postnudge", expectedStart: block.start }); out.push("postnudge"); }
    }
    return { scheduled: out };
  },
});

/** One touch. Re-validates everything, so a stale schedule is harmless. */
export const fire = internalAction({
  args: { blockId: v.id("calendarBlocks"), touch: v.union(v.literal("prep"), v.literal("checkin"), v.literal("postnudge")), expectedStart: v.number() },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string }> => {
    const c = await ctx.runQuery(internal.calendar.reminders.context, { blockId: a.blockId });
    if (!c) return { sent: false, reason: "block gone" };
    const { block, creator, shotList } = c;
    if (block.status === "deleted") return { sent: false, reason: "block dropped" };
    if (block.start !== a.expectedStart) return { sent: false, reason: "block moved; a fresh schedule owns it" };
    if (!block.consentAt) return { sent: false, reason: "never booked" };
    // Two touches, full stop. A repeat of an earlier touch is also refused here, before the
    // dedupe key would have caught it, so the count is the rule and the key is the backstop.
    if ((block.touches ?? []).length >= REMINDER.maxTouchesPerBlock) return { sent: false, reason: "two touches already" };
    const now = Date.now();
    if (inQuietHours(now, creator.timezone, creator.quietHours ?? THRESHOLDS.quietHoursDefault)) return { sent: false, reason: "quiet hours" };

    const tz = creator.timezone;
    const t = fmtTime(block.start, tz);
    const hook = block.title.replace(/^(film|edit|post)( \(experiment\))?: /, "");
    let body: string;
    let buttons: Array<{ id: string; label: string }> | undefined;
    let awaitingAnswer = false;
    if (a.touch === "prep") {
      body = `today's ${hook}, filming at ${t}.${shotList ? ` shot list: ${shotList}.` : ""}`;
    } else if (a.touch === "checkin") {
      // The shot list appears once: here only if the prep never went out.
      const withList = !(block.touches ?? []).includes("prep") && shotList ? ` ${shotList}.` : "";
      body = `still good for ${t}? i still like this one.${withList}`;
      buttons = [{ id: `cal:${block._id}:yes`, label: "yes" }, { id: `cal:${block._id}:push`, label: "push it" }, { id: `cal:${block._id}:skip`, label: "skip" }];
      awaitingAnswer = true;
    } else {
      // The post nudge needs to know they filmed: the film block's filmedAt, set by their yes or a clip.
      const film = await ctx.runQuery(internal.calendar.reminders.filmFor, { creatorId: creator._id, planKey: block.planKey ?? "", ideaId: block.ideaId ?? undefined });
      if (!film?.filmedAt) return { sent: false, reason: "no sign they filmed; no nudge" };
      body = `${t} is your hour. go when it's ready.`;
    }
    // The check-in is THE open question: it supersedes whatever was open.
    if (awaitingAnswer) await ctx.runMutation(internal.core.messages.closeOpen, { creatorId: creator._id });
    const sent = await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body, dedupeKey: `block:${block._id}:${a.touch}`, proactive: true, kind: "reminder", awaitingAnswer, buttons });
    if (!sent.sent) return { sent: false, reason: "already said" };
    await ctx.runMutation(internal.calendar.reminders.touched, { blockId: a.blockId, touch: a.touch });
    return { sent: true, reason: a.touch };
  },
});

export const filmFor = internalQuery({
  args: { creatorId: v.id("creators"), planKey: v.string(), ideaId: v.optional(v.id("ideas")) },
  handler: async (ctx, a): Promise<Doc<"calendarBlocks"> | null> => {
    const rows = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(300)) as Doc<"calendarBlocks">[];
    return rows.find((b) => b.kind === "film" && b.status !== "deleted" && (a.ideaId ? b.ideaId === a.ideaId : b.planKey === a.planKey)) ?? null;
  },
});

/**
 * "push it": the next real gap today after now, else tomorrow at the same hour. Pure over
 * rows; the calendar write happens only when they pick one.
 */
export const proposeMove = internalQuery({
  args: { blockId: v.id("calendarBlocks"), now: v.number() },
  handler: async (ctx, a): Promise<{ today: { start: number; end: number } | null; tomorrow: { start: number; end: number }; tz: string } | null> => {
    const b = (await ctx.db.get(a.blockId)) as Doc<"calendarBlocks"> | null;
    if (!b) return null;
    const creator = (await ctx.db.get(b.creatorId)) as Doc<"creators"> | null;
    if (!creator) return null;
    const tz = creator.timezone;
    const minutes = Math.max(15, Math.round((b.end - b.start) / 60_000));
    const events = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", b.creatorId).gte("start", a.now - 86_400_000).lte("start", a.now + 2 * 86_400_000)).take(100)) as Doc<"calendarEvents">[];
    const blocks = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", b.creatorId).gte("start", a.now - 86_400_000)).take(100)) as Doc<"calendarBlocks">[];
    const busy = [
      ...events.filter((e) => e.status === "active" && !e.allDay).map((e) => ({ start: e.start, end: e.end })),
      ...blocks.filter((x) => x.status !== "deleted" && x._id !== b._id).map((x) => ({ start: x.start, end: x.end })),
      // Nothing earlier than half an hour from now.
      { start: 0, end: a.now + 30 * 60_000 },
    ];
    const preferHour = Math.min(PLAN.dayEndHour, localHour(a.now, tz) + 1);
    const today = freeSlotOn(a.now, minutes, busy, preferHour, tz);
    const tomorrowStart = atLocalHour(a.now + 86_400_000, localHour(b.start, tz), tz);
    return { today: today && today.start < atLocalHour(a.now, 23, tz) + 3_600_000 ? today : null, tomorrow: { start: tomorrowStart, end: tomorrowStart + minutes * 60_000 }, tz };
  },
});

