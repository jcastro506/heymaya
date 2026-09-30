/**
 * The engagement round (2026-09-30). Growing means showing up on other people's posts, and no API
 * lets an app comment for you on someone else's post (a bot acting as them is how accounts get
 * banned). So she makes it easy for them to do it themselves: each day, up to five fresh posts from
 * the accounts she already watches for them (no extra reads), why each is a good one to comment on,
 * one tap to open it, and a streak for the days they hit the goal. Only rows; nothing is invented.
 */
import { v } from "convex/values";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { mutation } from "../lib/functions";
import type { Doc } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { recordAction } from "../core/act";

export const ENGAGE = { show: 5, goal: 3, freshHours: 72, perAuthor: 2, quietComments: 30, earlyHours: 12 } as const;

export type RoundPost = { platform: "tiktok" | "instagram"; handle: string; postId: string; url: string; createTime: number; views: number; comments: number; caption: string | null };
export type RoundItem = RoundPost & { hoursAgo: number; why: string };

/** Pure: today's round. Fresh first, quiet posts ahead of crowded ones, never more than two from one account. */
export function pickRound(posts: RoundPost[], now: number): RoundItem[] {
  const seen = new Set<string>();
  const fresh = posts
    .filter((p) => p.url && !seen.has(`${p.platform}:${p.postId}`) && seen.add(`${p.platform}:${p.postId}`))
    .map((p) => ({ ...p, hoursAgo: Math.max(0, Math.round((now - p.createTime) / 3_600_000)) }))
    .filter((p) => p.hoursAgo <= ENGAGE.freshHours)
    .sort((a, b) => a.hoursAgo + a.comments / 20 - (b.hoursAgo + b.comments / 20));
  const perAuthor = new Map<string, number>();
  const out: RoundItem[] = [];
  for (const p of fresh) {
    const key = `${p.platform}:${p.handle}`;
    if ((perAuthor.get(key) ?? 0) >= ENGAGE.perAuthor) continue;
    perAuthor.set(key, (perAuthor.get(key) ?? 0) + 1);
    const why = p.hoursAgo <= ENGAGE.earlyHours && p.comments < ENGAGE.quietComments ? "new and still quiet: an early comment gets seen" : p.hoursAgo <= 24 ? "posted today" : "still picking up";
    out.push({ ...p, why });
    if (out.length >= ENGAGE.show) break;
  }
  return out;
}

/** Pure: their calendar day, in their timezone (the streak is theirs, not UTC's). */
export function localDay(now: number, timezone: string): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now)); }
  catch { return new Date(now).toISOString().slice(0, 10); }
}

/** Pure: the state after marking one post done. The streak counts days they reached the goal, in a row. */
export function afterDone(prev: Doc<"creators">["engage"], postKey: string, today: string, yesterday: string): NonNullable<Doc<"creators">["engage"]> {
  const base = prev && prev.day === today ? prev : { day: today, done: [] as string[], streak: prev?.streak ?? 0, lastGoalDay: prev?.lastGoalDay };
  if (base.done.includes(postKey)) return base;
  const done = [...base.done, postKey];
  if (done.length === ENGAGE.goal && base.lastGoalDay !== today) {
    return { day: today, done, streak: base.lastGoalDay === yesterday ? base.streak + 1 : 1, lastGoalDay: today };
  }
  return { ...base, done };
}

async function gather(ctx: QueryCtx, creator: Doc<"creators">): Promise<RoundPost[]> {
  const tracked = ((await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect()) as Doc<"trackedAccounts">[]).filter((t) => t.status === "active").slice(0, 12);
  const posts: RoundPost[] = [];
  for (const t of tracked) {
    const obs = (await ctx.db.query("observations").withIndex("by_author", (q) => q.eq("platform", t.platform).eq("authorHandle", t.handle)).order("desc").take(24)) as Doc<"observations">[];
    const latest = new Map<string, Doc<"observations">>();
    for (const o of obs) if (!latest.has(o.postId)) latest.set(o.postId, o); // newest sample of each post
    for (const o of latest.values()) posts.push({ platform: o.platform, handle: o.authorHandle, postId: o.postId, url: o.url, createTime: o.createTime, views: o.views, comments: o.comments, caption: o.caption ?? null });
  }
  return posts;
}

export const today = query({
  args: {},
  handler: async (ctx): Promise<{ items: Array<RoundItem & { done: boolean }>; doneToday: number; goal: number; streak: number; watching: number } | null> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return null;
    const now = Date.now();
    const day = localDay(now, c.timezone);
    const state = c.engage && c.engage.day === day ? c.engage : null;
    const yesterday = localDay(now - 86_400_000, c.timezone);
    const items = pickRound(await gather(ctx, c), now);
    // A streak that wasn't kept yesterday (or today) is over; show it as it is.
    const streak = c.engage && (c.engage.lastGoalDay === day || c.engage.lastGoalDay === yesterday) ? c.engage.streak : 0;
    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()) as Doc<"trackedAccounts">[];
    return { items: items.map((i) => ({ ...i, done: state?.done.includes(`${i.platform}:${i.postId}`) ?? false })), doneToday: state?.done.length ?? 0, goal: ENGAGE.goal, streak, watching: tracked.filter((t) => t.status === "active").length };
  },
});

/** The one writer for "I commented on this" (the app calls it; she can too, so chat and app agree). */
export async function markEngaged(ctx: MutationCtx, creator: Doc<"creators">, a: { platform: "tiktok" | "instagram"; postId: string; handle: string }, now: number): Promise<{ doneToday: number; streak: number }> {
  const day = localDay(now, creator.timezone);
  const next = afterDone(creator.engage, `${a.platform}:${a.postId}`, day, localDay(now - 86_400_000, creator.timezone));
  const already = creator.engage?.day === day && creator.engage.done.includes(`${a.platform}:${a.postId}`);
  await ctx.db.patch(creator._id, { engage: next, updatedAt: now });
  if (!already) await recordAction(ctx, { creatorId: creator._id, kind: "engage.commented", objectId: `${a.platform}:${a.postId}`, summary: `commented on @${a.handle}'s post` });
  return { doneToday: next.done.length, streak: next.streak };
}

export const markDone = mutation({
  args: { platform: v.union(v.literal("tiktok"), v.literal("instagram")), postId: v.string(), handle: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; doneToday?: number; streak?: number }> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return { ok: false };
    return { ok: true, ...(await markEngaged(ctx, c, a, Date.now())) };
  },
});
