/**
 * When to post, from their own history (plan Sprint 4b).
 *
 * Every number here is a fact from a row: the hour each of their posts went up, in their
 * timezone, and how that post did against their normal. No platform folklore ("post at
 * 6pm"), no model. A creator with too little history gets `confidence: "none"` and a plain
 * default, said as a default.
 *
 * Pure functions, unit-tested; the query at the bottom just feeds them rows.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { zonedTimeToEpoch } from "./time";

export interface PostSample { createTime: number; multiple: number | null }
export interface HourScore { hour: number; n: number; medianMultiple: number }
export interface PostTimeModel {
  /** Best hours first. Empty when there is nothing to learn from. */
  hours: HourScore[];
  confidence: "none" | "thin" | "solid";
  /** Local hour she will use when nothing better is known. */
  defaultHour: number;
}

export const MIN_SAMPLES_THIN = 4;
export const MIN_SAMPLES_SOLID = 12;
export const DEFAULT_HOUR = 18; // early evening, said as a default when used

export function localHour(epoch: number, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(epoch);
  return Number(h) % 24;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/** Build the model from their posts. Posts with no multiple yet are not evidence and are skipped. */
export function buildPostTimeModel(posts: PostSample[], timeZone: string): PostTimeModel {
  const scored = posts.filter((p) => typeof p.multiple === "number" && p.multiple > 0);
  const byHour = new Map<number, number[]>();
  for (const p of scored) {
    const h = localHour(p.createTime, timeZone);
    byHour.set(h, [...(byHour.get(h) ?? []), p.multiple as number]);
  }
  // A single post in an hour is an anecdote; group neighbouring hours so one lucky post
  // does not own 3pm forever.
  const hours: HourScore[] = [...byHour.entries()]
    .map(([hour, ms]) => ({ hour, n: ms.length, medianMultiple: Math.round(median(ms) * 100) / 100 }))
    .filter((h) => h.n >= 2)
    .sort((a, b) => b.medianMultiple - a.medianMultiple || b.n - a.n);
  const confidence = scored.length >= MIN_SAMPLES_SOLID && hours.length > 0 ? "solid" : scored.length >= MIN_SAMPLES_THIN && hours.length > 0 ? "thin" : "none";
  return { hours, confidence, defaultHour: hours[0]?.hour ?? DEFAULT_HOUR };
}

/**
 * The next good post time at or after `after`, on their clock: the best known hour that
 * still lies ahead today, else the best hour tomorrow. Returns an epoch and the hour used.
 */
export function nextPostTime(model: PostTimeModel, after: number, timeZone: string): { at: number; hour: number; fromHistory: boolean } {
  const candidates = model.hours.length ? model.hours.map((h) => h.hour) : [model.defaultHour];
  const fromHistory = model.hours.length > 0;
  const nowHour = localHour(after, timeZone);
  // Try each preferred hour today, in preference order, then the best one tomorrow.
  for (const hour of candidates) {
    if (hour > nowHour) return { at: atLocalHour(after, hour, timeZone), hour, fromHistory };
  }
  const tomorrow = after + 86_400_000;
  return { at: atLocalHour(tomorrow, candidates[0], timeZone), hour: candidates[0], fromHistory };
}

/** The epoch of `hour:00` on the same local calendar day as `epoch`, in `timeZone`. */
export function atLocalHour(epoch: number, hour: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(epoch);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return zonedTimeToEpoch(`${get("year")}-${get("month")}-${get("day")}T${String(hour).padStart(2, "0")}:00`, timeZone);
}

export const modelFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<PostTimeModel> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return { hours: [], confidence: "none", defaultHour: DEFAULT_HOUR };
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(60)) as Doc<"ownPosts">[];
    return buildPostTimeModel(posts.map((p) => ({ createTime: p.createTime, multiple: p.multiple ?? null })), creator.timezone);
  },
});
