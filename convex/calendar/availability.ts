/**
 * Her calendar sense (2026-09-07): the operator asked for a slot "next open" on a Monday and
 * got Thursday. She could see blocks and events but had no view of FREE time, no notion that
 * today counts, and no grounding for "why those times". Free windows and best hours are
 * code; picking, and saying why, is hers.
 */

import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { freeSlotOn, PLAN, type Busy } from "./planning";
import { atLocalHour, buildPostTimeModel, type PostTimeModel } from "./postTime";
import { localHourMinute } from "../scout/gate";

export interface Window { start: number; end: number; label: string; why: string }

export const AVAILABILITY = { days: 4, todayCutoffHour: 19 } as const;

/**
 * Pure. The earliest free filming windows from now: today first if it is not too late (a
 * 45-minute shoot before the day-end hour), then each following day at their usual hour or
 * the nearest free slot to it. Quiet hours are never offered.
 */
export function freeWindows(input: { now: number; timeZone: string; busy: Busy[]; filmHour: number | null; days?: number; quiet?: { start: string; end: string } }): Window[] {
  const out: Window[] = [];
  const preferHour = input.filmHour ?? PLAN.defaultFilmHour;
  const quietStart = Number((input.quiet?.start ?? "22:00").split(":")[0]);
  const { hour: nowHour } = localHourMinute(input.now, input.timeZone);
  const days = Math.max(1, Math.min(7, input.days ?? AVAILABILITY.days));
  for (let d = 0; d < days; d++) {
    const dayEpoch = input.now + d * 86_400_000;
    if (d === 0 && nowHour >= AVAILABILITY.todayCutoffHour) continue; // too late to shoot today
    // Today: the next full hour from now, or their usual hour if that is still ahead.
    const hour = d === 0 ? Math.max(nowHour + 1, Math.min(preferHour, quietStart - 1)) : preferHour;
    const slot = freeSlotOn(dayEpoch, PLAN.filmMinutes, input.busy, hour, input.timeZone);
    if (!slot || slot.start <= input.now) continue;
    const { hour: slotHour } = localHourMinute(slot.start, input.timeZone);
    if (slotHour >= quietStart || slotHour < PLAN.dayStartHour) continue;
    const dayName = d === 0 ? "today" : d === 1 ? "tomorrow" : new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, weekday: "long" }).format(slot.start).toLowerCase();
    const t = new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, hour: "numeric", minute: "2-digit" }).format(slot.start).toLowerCase().replace(":00", "");
    const why = slotHour === preferHour ? `their usual filming hour` : d === 0 ? `the next free hour today` : `the nearest free slot to their usual ${preferHour > 12 ? preferHour - 12 + "pm" : preferHour + "am"}`;
    out.push({ start: slot.start, end: slot.end, label: `${dayName} ${t}`, why });
  }
  return out;
}

/** Pure. Best posting hours from their own numbers, in words she can repeat. */
export function bestHoursLine(model: PostTimeModel, timeZone: string): string {
  const fmt = (h: number) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric" }).format(atLocalHour(Date.now(), h, timeZone)).toLowerCase();
  if (model.confidence === "none" || model.hours.length === 0) return `no posting-hour data yet; ${fmt(model.defaultHour)} is a default, say so if asked`;
  const top = model.hours.slice(0, 2).map((h) => `${fmt(h.hour)}${"n" in h && typeof (h as { n?: number }).n === "number" ? ` (${(h as { n: number }).n} posts)` : ""}`);
  return `${top.join(" and ")} from their own posts (${model.confidence} read)`;
}

/** The prefix block: what is free, and why those hours; read on every turn. */
export function availabilitySection(windows: Window[], bestHours: string): string {
  const lines = windows.length ? windows.map((w) => `- ${w.label} (${w.why})`) : ["- nothing free in the next few days before quiet hours; ask them"];
  return `# Their free filming windows, from now (their clock; "next open slot" means the FIRST of these)\n${lines.join("\n")}\nBest posting hours: ${bestHours}\nRules: today counts if it is on this list. Say why you picked a time in one clause, from this list, never a guess about "the evening scroll window".`;
}

export async function availabilityFor(ctx: QueryCtx, creator: Doc<"creators">, now: number, days?: number): Promise<{ windows: Window[]; bestHours: string }> {
  const events = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", creator._id).gte("start", now - 3_600_000).lte("start", now + 8 * 86_400_000)).take(200)) as Doc<"calendarEvents">[];
  const blocks = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", creator._id).gte("start", now - 3_600_000).lte("start", now + 8 * 86_400_000)).take(200)) as Doc<"calendarBlocks">[];
  const busy: Busy[] = [...events.filter((e) => e.status === "active" && !e.allDay).map((e) => ({ start: e.start, end: e.end })), ...blocks.filter((b) => b.status !== "deleted").map((b) => ({ start: b.start, end: b.end }))];
  const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).order("desc").take(60)) as Doc<"ownPosts">[];
  const model = buildPostTimeModel(posts.map((p) => ({ createTime: p.createTime, multiple: p.reachMultiple ?? p.multiple ?? null })), creator.timezone);
  const windows = freeWindows({ now, timeZone: creator.timezone, busy, filmHour: null /* preferredSendHour is when they REPLY, not when they film (2026-09-07: "your usual filming hour" was 9pm) */, days, quiet: creator.quietHours });
  return { windows, bestHours: bestHoursLine(model, creator.timezone) };
}

export const forCreator = internalQuery({
  args: { creatorId: v.id("creators"), days: v.optional(v.number()), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ windows: Window[]; bestHours: string } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return c ? await availabilityFor(ctx, c, a.now ?? Date.now(), a.days) : null;
  },
});
