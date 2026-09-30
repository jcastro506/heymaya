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

export const ENGAGE = { show: 5, goal: 3, freshHours: 72, perAuthor: 2, quietComments: 30, earlyHours: 12, /** Her text: around midday their time, up to three links, at most four a week, and only with two or more she hasn't sent. */ textHourLocal: 12, textShow: 3, textMin: 2, textsPerWeek: 4, remember: 200,
  /** Lane-wide finds (her daily keyword sweep, creators they don't watch yet): at most this many per round. */
  laneInApp: 2, laneInText: 1, laneKeywords: 8,
  /** The text goes only to people talking to her: a list of links gets no reply, and texts into silence cost the line (the phone back-off). */
  textOnlyIfWroteWithinMs: 48 * 3_600_000 } as const;

export type RoundPost = { platform: "tiktok" | "instagram"; handle: string; postId: string; url: string; createTime: number; views: number; comments: number; caption: string | null; fromLane?: boolean };
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
    const base = p.hoursAgo <= ENGAGE.earlyHours && p.comments < ENGAGE.quietComments ? "new and still quiet: an early comment gets seen" : p.hoursAgo <= 24 ? "posted today" : "still picking up";
    const why = p.fromLane ? `new to you, in your lane: ${base}` : base;
    out.push({ ...p, why });
    if (out.length >= show) break;
  }
  return out;
}

/** Accounts that repost or compile other people's work: nobody to build a relationship with. Pure. */
const AGGREGATOR = /(repost|reposts|memes?|compilation|clips|dailydose|fyp|viral|funny(videos)?|tiktokfeed)/i;
export const looksLikeAggregator = (handle: string) => AGGREGATOR.test(handle);

/**
 * Pure: their accounts first, then up to `laneMax` new-to-them lane finds; if their accounts run
 * short, lane finds fill the rest (still never more than two from one account).
 */
export function mixRound(watched: RoundPost[], lane: RoundPost[], now: number, exclude: ReadonlySet<string>, show: number, laneMax: number): RoundItem[] {
  const own = pickRound(watched, now, exclude, show);
  const taken = new Set([...exclude, ...own.map((i) => `${i.platform}:${i.postId}`)]);
  const finds = pickRound(lane.map((p) => ({ ...p, fromLane: true })), now, taken, show);
  const laneSlots = Math.min(finds.length, Math.max(laneMax, show - own.length)); // more lane only when theirs run short
  const ownSlots = Math.min(own.length, show - laneSlots);
  return [...own.slice(0, ownSlots), ...finds.slice(0, show - ownSlots)];
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

async function gather(ctx: QueryCtx, creator: Doc<"creators">, now: number): Promise<{ watched: RoundPost[]; lane: RoundPost[] }> {
  const allTracked = ((await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect()) as Doc<"trackedAccounts">[]).filter((t) => t.status === "active");
  const tracked = allTracked.slice(0, 12);
  const posts: RoundPost[] = [];
  for (const t of tracked) {
    const obs = (await ctx.db.query("observations").withIndex("by_author", (q) => q.eq("platform", t.platform).eq("authorHandle", t.handle)).order("desc").take(24)) as Doc<"observations">[];
    const latest = new Map<string, Doc<"observations">>();
    for (const o of obs) if (!latest.has(o.postId)) latest.set(o.postId, o); // newest sample of each post
    for (const o of latest.values()) posts.push({ platform: o.platform, handle: o.authorHandle, postId: o.postId, url: o.url, createTime: o.createTime, views: o.views, comments: o.comments, caption: o.caption ?? null });
  }
  // Lane-wide finds: what her daily keyword sweep saved for THEIR lane keywords (no extra reads), from
  // creators they don't already watch and that aren't them, minus repost and meme pages.
  const keywords = new Set(((creator.dossier as { keywords?: string[] } | undefined)?.keywords ?? []).slice(0, ENGAGE.laneKeywords).map((k) => k.toLowerCase()));
  const skip = new Set([...allTracked.map((t) => `${t.platform}:${t.handle.toLowerCase()}`), ...Object.entries(creator.handles).filter(([, h]) => h).map(([p, h]) => `${p}:${String(h).toLowerCase()}`)]);
  const lane: RoundPost[] = [];
  if (keywords.size) {
    const recent = (await ctx.db.query("observations").withIndex("by_sampledAt", (q) => q.gte("sampledAt", now - ENGAGE.freshHours * 3_600_000)).order("desc").take(1500)) as Doc<"observations">[];
    const latest = new Map<string, Doc<"observations">>();
    for (const o of recent) {
      if (!o.source.startsWith("search.") || !o.keywords.some((k) => keywords.has(k.toLowerCase()))) continue;
      if (!o.authorHandle || skip.has(`${o.platform}:${o.authorHandle.toLowerCase()}`) || looksLikeAggregator(o.authorHandle)) continue;
      const key = `${o.platform}:${o.postId}`;
      if (!latest.has(key)) latest.set(key, o);
    }
    for (const o of latest.values()) lane.push({ platform: o.platform, handle: o.authorHandle, postId: o.postId, url: o.url, createTime: o.createTime, views: o.views, comments: o.comments, caption: o.caption ?? null, fromLane: true });
  }
  return { watched: posts, lane };
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
    const g = await gather(ctx, c, now);
    const items = mixRound(g.watched, g.lane, now, before, ENGAGE.show, ENGAGE.laneInApp);
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
  const lines = items.map((i) => `@${i.handle}${i.fromLane ? " (new to you)" : ""}${i.caption ? `: ${clip(i.caption, 60)}` : ""}\n${i.url}`);
  return { body: [opener, ...lines].join("\n---\n"), links: items.map((i) => i.url) };
}

export const textInputs = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ paired: boolean; day: string; doneToday: number; items: RoundItem[]; textsThisWeek: number; lastInboundAt: number | null } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const day = localDay(a.now, c.timezone);
    const never = new Set([...(c.engage?.commented ?? []), ...(c.engage?.sent ?? [])]);
    const recent = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.now - 7 * 86_400_000)).collect()) as Doc<"messages">[];
    const g = await gather(ctx, c, a.now);
    const lastIn = recent.filter((m) => m.direction === "in").sort((x, y) => y.ts - x.ts)[0];
    return {
      paired: c.channel.paired === true,
      day,
      doneToday: c.engage?.day === day ? c.engage.done.length : 0,
      items: mixRound(g.watched, g.lane, a.now, never, ENGAGE.textShow, ENGAGE.laneInText),
      textsThisWeek: recent.filter((m) => m.direction === "out" && m.kind === "engage").length,
      lastInboundAt: lastIn?.ts ?? null,
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
    // The back-off (core/phoneRail) counts every proactive text since their last reply. Nobody replies to a
    // list of links, so this text only goes into a live conversation; otherwise the round waits in the app.
    if (f.lastInboundAt === null || now - f.lastInboundAt > ENGAGE.textOnlyIfWroteWithinMs) return { sent: false, reason: "they haven't written lately; the round waits in the app" };
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
