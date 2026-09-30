/**
 * The engagement round (2026-09-30). Growing means showing up on other people's posts, and no API
 * lets an app comment for you on someone else's post (a bot acting as them is how accounts get
 * banned). So she makes it easy for them to do it themselves: each day, up to five fresh posts from
 * the accounts she already watches for them (no extra reads), why each is a good one to comment on,
 * one tap to open it, and a streak for the days they hit the goal. Only rows; nothing is invented.
 */
import { v } from "convex/values";
import { internalAction, internalQuery, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation, mutation } from "../lib/functions";
import { internal } from "../_generated/api";
import { clip } from "../lib/clip";
import type { Doc, Id } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { recordAction } from "../core/act";

export const ENGAGE = { show: 5, goal: 3, freshHours: 72, perAuthor: 2, quietComments: 30, earlyHours: 12, /** Her text: around midday their time, up to three links, at most four a week, and only with two or more she hasn't sent. */ textHourLocal: 12, textShow: 3, textMin: 2, textsPerWeek: 4, remember: 200 } as const;

export type RoundPost = { platform: "tiktok" | "instagram"; handle: string; postId: string; url: string; createTime: number; views: number; comments: number; caption: string | null };
export type RoundItem = RoundPost & { hoursAgo: number; why: string };

/** Pure: today's round. Fresh first, quiet posts ahead of crowded ones, never more than two from one account. */
export function pickRound(posts: RoundPost[], now: number, exclude: ReadonlySet<string> = new Set(), show: number = ENGAGE.show): RoundItem[] {
  const seen = new Set<string>();
  const fresh = posts
    .filter((p) => p.url && !exclude.has(`${p.platform}:${p.postId}`) && !seen.has(`${p.platform}:${p.postId}`) && seen.add(`${p.platform}:${p.postId}`))
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
    if (out.length >= show) break;
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
  const base = prev && prev.day === today ? prev : { day: today, done: [] as string[], streak: prev?.streak ?? 0, lastGoalDay: prev?.lastGoalDay, commented: prev?.commented, sent: prev?.sent };
  if (base.done.includes(postKey)) return base;
  const done = [...base.done, postKey];
  // Remembered past today, so a post they commented on never comes back tomorrow.
  const commented = [...(base.commented ?? []).filter((k) => k !== postKey), postKey].slice(-ENGAGE.remember);
  if (done.length === ENGAGE.goal && base.lastGoalDay !== today) {
    return { ...base, day: today, done, commented, streak: base.lastGoalDay === yesterday ? base.streak + 1 : 1, lastGoalDay: today };
  }
  return { ...base, done, commented };
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
    // Posts they commented on before today never return; today's stay, ticked.
    const before = new Set((c.engage?.commented ?? []).filter((k) => !(state?.done ?? []).includes(k)));
    const items = pickRound(await gather(ctx, c), now, before);
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

/* -------------------------------------------------------------------------- */
/* Her text: "found a few in your lane worth a comment"                        */
/* -------------------------------------------------------------------------- */

const OPENERS = [
  "found a few posts in your lane worth a comment today. these are fresh, so yours gets seen:",
  "a few right in your lane today, still early enough that a comment lands:",
  "worth two minutes: these just went up in your lane and the comments are still quiet:",
] as const;

/** Pure: the text. Code writes it from rows (no model): an opener that rotates by day, then each post on its own lines. */
export function engageText(items: RoundItem[], day: string): { body: string; links: string[] } {
  const opener = OPENERS[[...day].reduce((h, ch) => h + ch.charCodeAt(0), 0) % OPENERS.length];
  const lines = items.map((i) => `@${i.handle}${i.caption ? `: ${clip(i.caption, 60)}` : ""}\n${i.url}`);
  return { body: [opener, ...lines].join("\n---\n"), links: items.map((i) => i.url) };
}

export const textInputs = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ paired: boolean; day: string; doneToday: number; items: RoundItem[]; textsThisWeek: number } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const day = localDay(a.now, c.timezone);
    const never = new Set([...(c.engage?.commented ?? []), ...(c.engage?.sent ?? [])]);
    const recent = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.now - 7 * 86_400_000)).collect()) as Doc<"messages">[];
    return {
      paired: c.channel.paired === true,
      day,
      doneToday: c.engage?.day === day ? c.engage.done.length : 0,
      items: pickRound(await gather(ctx, c), a.now, never, ENGAGE.textShow),
      textsThisWeek: recent.filter((m) => m.direction === "out" && m.kind === "engage").length,
    };
  },
});

export const markSent = internalMutation({
  args: { creatorId: v.id("creators"), keys: v.array(v.string()), now: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const day = localDay(a.now, c.timezone);
    const prev = c.engage ?? { day, done: [], streak: 0 };
    await ctx.db.patch(a.creatorId, { engage: { ...prev, sent: [...(prev.sent ?? []).filter((k) => !a.keys.includes(k)), ...a.keys].slice(-ENGAGE.remember) } });
    return null;
  },
});

/**
 * Once a day at most (four a week), around midday their time: up to three fresh posts from their
 * lane she has never sent them and they haven't commented on. Held when they've already done the
 * round today, when there are fewer than two, and by every rail her other texts obey (the daily
 * cap, quiet hours, pause, and the back-off when they aren't replying, inside messages.send).
 */
export const sendText = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string }> => {
    const now = a.now ?? Date.now();
    const f = await ctx.runQuery(internal.engage.round.textInputs, { creatorId: a.creatorId, now });
    if (!f) return { sent: false, reason: "no creator" };
    if (!f.paired) return { sent: false, reason: "not paired" };
    if (f.doneToday > 0) return { sent: false, reason: "they're already on it today" };
    if (f.textsThisWeek >= ENGAGE.textsPerWeek) return { sent: false, reason: `${f.textsThisWeek} this week already (cap ${ENGAGE.textsPerWeek})` };
    if (f.items.length < ENGAGE.textMin) return { sent: false, reason: "fewer than two fresh posts she hasn't sent" };
    const rails = await ctx.runQuery(internal.scout.gate.railsOnly, { creatorId: a.creatorId, now });
    if (!rails) return { sent: false, reason: "no creator" };
    if (!rails.ok) return { sent: false, reason: rails.reason ?? "rails" };
    const { body, links } = engageText(f.items, f.day);
    const sent = (await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body, dedupeKey: `engage:${f.day}`, ts: now, proactive: true, capped: true, kind: "engage", links, criticSkipped: true, awaitingAnswer: false })) as { sent: boolean; held?: string };
    if (!sent.sent) return { sent: false, reason: sent.held ?? "already sent today" };
    await ctx.runMutation(internal.engage.round.markSent, { creatorId: a.creatorId as Id<"creators">, keys: f.items.map((i) => `${i.platform}:${i.postId}`), now });
    return { sent: true, reason: "sent" };
  },
});
