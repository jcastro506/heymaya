/**
 * Their filming habits, from what they actually did (2026-09-07). "Your usual filming hour"
 * was a planner default she had to admit was a default. After two booked or moved film
 * blocks, the hour and the days are theirs: the mode of their block hours and the weekdays
 * they keep filming on. Pure, and read by the planner, the free windows and the slot offer.
 */

import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export const HABITS = { minBlocks: 2, lookbackDays: 45 } as const;

export interface FilmingHabits { hour: number | null; days: number[]; n: number }

export function filmingHabits(blocks: Array<{ kind: string; start: number; status: string; consentAt?: number; filmedAt?: number }>, timeZone: string, now = Date.now()): FilmingHabits {
  const since = now - HABITS.lookbackDays * 86_400_000;
  const mine = blocks.filter((b) => b.kind === "film" && b.status !== "deleted" && b.start >= since && b.start <= now + 14 * 86_400_000 && (b.consentAt || b.filmedAt || b.status === "moved"));
  if (mine.length < HABITS.minBlocks) return { hour: null, days: [], n: mine.length };
  const local = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false, weekday: "short" }).formatToParts(t);
    return { hour: Number(p.find((x) => x.type === "hour")?.value ?? 0) % 24, day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.find((x) => x.type === "weekday")?.value ?? "") };
  };
  const hours = new Map<number, number>();
  const days = new Map<number, number>();
  for (const b of mine) { const { hour, day } = local(b.start); hours.set(hour, (hours.get(hour) ?? 0) + 1); if (day >= 0) days.set(day, (days.get(day) ?? 0) + 1); }
  const hour = [...hours.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  const topDays = [...days.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([d]) => d);
  return { hour, days: topDays.length ? topDays : [...days.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => d), n: mine.length };
}

export async function habitsFor(ctx: QueryCtx, creator: Doc<"creators">, now = Date.now()): Promise<FilmingHabits> {
  const blocks = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", creator._id).gte("start", now - HABITS.lookbackDays * 86_400_000)).take(200)) as Doc<"calendarBlocks">[];
  return filmingHabits(blocks, creator.timezone, now);
}
