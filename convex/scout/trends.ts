/**
 * Trends (2026-10-13). A trend is people posting to the same sound right now: a dance, a meme, a format.
 * Hopping on one early gets eyeballs, so she watches for them, works out what each one is, and tells the
 * people it fits.
 *
 * Tested live before building (31 credits): TikTok's trending feed is a random For You batch (weeks old,
 * any language) and #trendalert is months old, so neither is used. What works: searches for "new dance
 * trend" / "new tiktok trend" / "trend to hop on", #newtrend, and sounds several accounts in someone's own
 * lane used this week (a running trend on an old Gwen Stefani song showed up only there).
 *
 *   code finds     sounds used by two or more accounts across those reads (shared by everyone, once a day)
 *   code checks    is it new (the sound's top videos are days old) or an old song; how many videos use it, day over day
 *   she watches    two examples, once per trend: what it is, the beats, how hard it is to film
 *   she judges     per person: hop on it, borrow the format, or skip, and their version (the Trending tab)
 *   the editor     the best fresh fit is a candidate for her one text a day; the rest wait in the app
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { PostSound } from "../integrations/scrapeCreators/platforms/tiktok";
import { fetchMedia, watchMedia } from "../integrations/gemini/client";
import { WATCH_MODEL_TOP, REGISTRY } from "../agent/registry";
import { buildPrefix } from "../agent/context";
import { callModel } from "../core/llm";
import { pairedRows } from "../core/schedule";
import { spreadDelays, HOURLY_SPREAD_MS } from "../core/fanout";
import { coverKey, rememberMedia } from "../media";
import { clip } from "../lib/clip";
import { risingSounds } from "./sounds";

export const TREND = {
  /** What found real trends in the live test. Each is one shared read a day. */
  // "trending audio" is where the non-dance ones showed up (a "where are you sitting?" format); the rest lean dance.
  searches: ["new dance trend", "new tiktok trend", "trend to hop on", "trending audio"],
  hashtags: ["newtrend"],
  /** A sound two different accounts used is a pattern; one is a post. */
  minAccounts: 2,
  /** New sounds checked a day (1 credit each), best-corroborated first. */
  checkPerDay: 12,
  /** Live trends re-counted a day (1 credit each). */
  recountPerDay: 12,
  /** A sound whose top videos are younger than this is new; older is a song people keep using. */
  newWithinDays: 21,
  /** Watched a day (two Gemini passes each). */
  watchPerDay: 6,
  /** A trend is over this long after we first saw it unless it's still climbing. */
  lifeMs: 10 * 86_400_000,
  /** Shown to one person at most. */
  perPerson: 8,
} as const;

const DAY = 86_400_000;

/* ------------------------------------------------------------------ pure */

export interface SeenPost { sound: PostSound | null; authorHandle: string | null; url: string | null; views: number; postedAt: number | null; videoUrl: string | null; thumbnailUrl: string | null; source: string; keywords: string[] }

export interface Candidate { clipId: string; title: string; author: string | null; accounts: string[]; sources: string[]; niche: string[]; uses: number | null; original: boolean | null; examples: Array<{ url: string; handle: string; views: number; postedAt: number; videoUrl: string | null; thumb: string | null }> }

/** Pure: a post's link without the share tracking (`?_r=1&u_code=…`), so one video is one example. */
export function canonicalLink(url: string): string {
  return url.split(/[?#]/)[0];
}

/** Pure: group what we read by sound, keep sounds two or more accounts used, best-corroborated first. */
export function candidates(posts: SeenPost[]): Candidate[] {
  const by = new Map<string, Candidate>();
  for (const raw of posts) {
    const p = raw.url ? { ...raw, url: canonicalLink(raw.url) } : raw;
    if (!p.sound?.clipId || !p.authorHandle || !p.url) continue;
    const c = by.get(p.sound.clipId) ?? { clipId: p.sound.clipId, title: p.sound.title ?? "original sound", author: p.sound.author, accounts: [], sources: [], niche: [], uses: null, original: p.sound.original, examples: [] };
    const handle = p.authorHandle.replace(/^@/, "");
    if (!c.accounts.includes(handle)) c.accounts.push(handle);
    if (!c.sources.includes(p.source)) c.sources.push(p.source);
    for (const k of p.keywords) if (!c.niche.includes(k)) c.niche.push(k);
    c.uses = Math.max(c.uses ?? 0, p.sound.uses ?? 0) || c.uses;
    if (!c.examples.some((e) => e.url === p.url)) c.examples.push({ url: p.url, handle, views: p.views, postedAt: p.postedAt ?? 0, videoUrl: p.videoUrl, thumb: p.thumbnailUrl });
    by.set(p.sound.clipId, c);
  }
  return [...by.values()]
    .filter((c) => c.accounts.length >= TREND.minAccounts)
    .map((c) => ({ ...c, examples: c.examples.sort((a, b) => b.views - a.views).slice(0, 5) }))
    .sort((a, b) => b.accounts.length - a.accounts.length || b.sources.length - a.sources.length);
}

/** Pure: median age in days of a sound's top videos (TikTok returns its most popular, any age). */
export function topAgeDays(postedAt: number[], now: number): number | null {
  const ages = postedAt.filter((t) => t > 0).map((t) => (now - toMs(t)) / DAY).sort((a, b) => a - b);
  return ages.length ? Math.round(ages[Math.floor(ages.length / 2)] * 10) / 10 : null;
}

/** TikTok times are seconds; ours are milliseconds. */
export function toMs(t: number): number {
  return t < 1e12 ? t * 1000 : t;
}

/**
 * Pure: is it a trend right now? New sounds are; an old song is only when the people in someone's own
 * lane are all on it this week (the niche read found exactly that: an old song, a new running trend).
 */
export function liveOrNot(input: { topAgeDays: number | null; niche: boolean }): "live" | "evergreen" {
  if (input.niche) return "live";
  return input.topAgeDays !== null && input.topAgeDays <= TREND.newWithinDays ? "live" : "evergreen";
}

export type Momentum = "new" | "rising" | "steady" | "fading";

/** Pure: from TikTok's count of videos on the sound, day over day. */
export function momentum(uses: Array<{ at: number; n: number }>): Momentum {
  const s = [...uses].sort((a, b) => a.at - b.at);
  if (s.length < 2) return "new";
  const first = s[0], last = s[s.length - 1];
  const days = Math.max(0.5, (last.at - first.at) / DAY);
  if (first.n <= 0) return "rising";
  const perDay = (last.n / first.n - 1) / days;
  // The last two counts decide fading: a trend that grew last week and stopped is over.
  const prev = s[s.length - 2];
  const lastStep = prev.n > 0 ? (last.n / prev.n - 1) / Math.max(0.5, (last.at - prev.at) / DAY) : 1;
  if (lastStep < 0.01) return "fading";
  return perDay >= 0.05 ? "rising" : "steady";
}

/** Pure: plain words for the app and for her. Never a number. */
export function momentumWords(m: Momentum, firstSeenAt: number, now: number): string {
  const days = Math.floor((now - firstSeenAt) / DAY);
  if (m === "rising") return days <= 2 ? "just starting to take off" : "still picking up fast";
  if (m === "fading") return "slowing down: last call";
  if (m === "steady") return "steady this week";
  return "new this week";
}

export interface Recipe { kind: string; what: string; beats: string[]; onScreenText: string; difficulty: string; solo: boolean }

/** Pure: the watcher's answer, held to a shape. Null when it isn't one. */
export function parseRecipe(text: string): Recipe | null {
  try {
    const j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "") as Partial<Recipe> & { isTrend?: boolean };
    if (j.isTrend === false || typeof j.what !== "string" || j.what.trim().length < 6) return null;
    const kinds = ["dance", "format", "meme", "lip-sync", "transition", "challenge", "other"];
    const diff = ["easy", "needs practice", "needs a second person"];
    return {
      kind: kinds.includes(String(j.kind)) ? String(j.kind) : "other",
      what: clip(j.what.trim(), 200),
      beats: (Array.isArray(j.beats) ? j.beats : []).map((b) => clip(String(b).trim(), 140)).filter(Boolean).slice(0, 6),
      onScreenText: clip(String(j.onScreenText ?? "").trim(), 120),
      difficulty: diff.includes(String(j.difficulty)) ? String(j.difficulty) : "easy",
      solo: j.solo !== false,
    };
  } catch {
    return null;
  }
}

export const WATCH_TREND_PROMPT = `This TikTok uses a sound that a lot of people are posting to right now. Watch AND listen, then say what the trend IS so a creator in any niche could film their own version. Describe only what you can see and hear; never invent.
Return ONLY JSON:
{"isTrend": true, "kind": "dance|format|meme|lip-sync|transition|challenge|other", "what": "≤200 chars, what people do with this sound, in plain words", "beats": ["≤140 chars each, 2–6 steps with rough timings, where the beat drop lands"], "onScreenText": "≤120, the text pattern people put on screen, or ''", "difficulty": "easy|needs practice|needs a second person", "solo": true}
isTrend false when it's just a song playing under an unrelated video.`;

/** The second example is watched knowing what the first showed, so a one-off variant isn't taken for the trend. */
export function secondWatchPrompt(first: Recipe): string {
  return `${WATCH_TREND_PROMPT}
Another video on this same sound was described as: ${JSON.stringify(first)}. Describe what the TWO have in common: that's the trend. Drop what only one of them does.`;
}

export interface Pick { id: string; verdict: "hop_on" | "borrow" | "skip"; why: string; hook: string; onScreenText: string; lengthSec: number | null }

/** Pure: her read of the trends for one person, held to the ids she was given. */
export function parsePicks(text: string, ids: string[]): Pick[] {
  try {
    const j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "") as { picks?: unknown };
    const rows = Array.isArray(j.picks) ? (j.picks as Array<Record<string, unknown>>) : [];
    const out: Pick[] = [];
    for (const r of rows) {
      const id = String(r.id ?? "");
      if (!ids.includes(id) || out.some((o) => o.id === id)) continue;
      const verdict = r.verdict === "hop_on" || r.verdict === "borrow" ? r.verdict : "skip";
      const hook = clip(String(r.hook ?? "").trim(), 120);
      if (verdict !== "skip" && hook.length < 6) continue;
      out.push({ id, verdict, why: clip(String(r.why ?? "").trim(), 160), hook, onScreenText: clip(String(r.onScreenText ?? "").trim(), 80), lengthSec: typeof r.lengthSec === "number" && r.lengthSec > 0 ? Math.min(180, Math.round(r.lengthSec)) : null });
    }
    return out;
  } catch {
    return [];
  }
}

export const TREND_SKILL = `trends
When: a few trends are live on TikTok right now and you decide, for this one person, which are worth their time.
For each trend: "hop_on" (it fits them as is: they could film it this week and it would look like them), "borrow" (the sound or structure works if they put their own subject in it), or "skip" (it's not them, it needs something they don't have, or it's already over). Most are skips; that's fine. Never pick a trend that would make them look like they're chasing it.
For hop_on and borrow, write THEIR version: a hook line (≤120 chars, what they'd film, in their world), on-screen text if the trend uses it, a length. "why" is written to them in plain words (you, your), ≤160 chars, no numbers, about why it fits THEM. Use only what each trend's description says it is; never describe a move or a moment you weren't given.
Output ONLY JSON: {"picks": [{"id": "", "verdict": "hop_on|borrow|skip", "why": "", "hook": "", "onScreenText": "", "lengthSec": 0}]}`;

/* ------------------------------------------------------------------ rows */

export const byClip = internalQuery({
  args: { clipIds: v.array(v.string()) },
  handler: async (ctx, a): Promise<Array<{ clipId: string; checkedAt: number; status: string }>> => {
    const out: Array<{ clipId: string; checkedAt: number; status: string }> = [];
    for (const clipId of a.clipIds) {
      const t = (await ctx.db.query("trends").withIndex("by_clip", (q) => q.eq("clipId", clipId)).first()) as Doc<"trends"> | null;
      if (t) out.push({ clipId, checkedAt: t.checkedAt, status: t.status });
    }
    return out;
  },
});

/** Lane observations this week that carry a sound (the sweep and the sampler), for the niche half. */
export const laneSounds = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<SeenPost[]> => {
    const rows = (await ctx.db.query("observations").withIndex("by_sampledAt", (q) => q.gte("sampledAt", a.now - 7 * DAY)).collect()) as Doc<"observations">[];
    const keep = new Set(risingSounds(rows.filter((r) => r.clipId).map((r) => ({ clipId: r.clipId, authorHandle: r.authorHandle, url: r.url, views: r.views, keywords: r.keywords }))).map((s) => s.clipId));
    return rows
      .filter((r) => r.platform === "tiktok" && r.clipId && keep.has(r.clipId))
      .map((r) => ({ sound: { clipId: r.clipId!, title: null, author: null, uses: null, original: null }, authorHandle: r.authorHandle, url: r.url, views: r.views, postedAt: r.createTime, videoUrl: null, thumbnailUrl: null, source: "lane", keywords: r.keywords }));
  },
});

export const upsert = internalMutation({
  args: {
    c: v.object({ clipId: v.string(), title: v.string(), author: v.union(v.string(), v.null()), accounts: v.array(v.string()), sources: v.array(v.string()), niche: v.array(v.string()) }),
    uses: v.union(v.number(), v.null()),
    topAgeDays: v.union(v.number(), v.null()),
    status: v.union(v.literal("live"), v.literal("evergreen")),
    examples: v.array(v.object({ url: v.string(), handle: v.string(), views: v.number(), postedAt: v.number(), thumb: v.union(v.string(), v.null()) })),
    now: v.number(),
  },
  handler: async (ctx, a): Promise<{ id: Id<"trends">; isNew: boolean }> => {
    const have = (await ctx.db.query("trends").withIndex("by_clip", (q) => q.eq("clipId", a.c.clipId)).first()) as Doc<"trends"> | null;
    await rememberMedia(ctx, a.examples.filter((e) => e.thumb).map((e) => ({ platform: "tiktok" as const, kind: "cover" as const, key: coverKey("tiktok", e.url) ?? e.url, url: e.thumb! })));
    const examples = a.examples.slice(0, 3).map(({ thumb: _t, ...e }) => ({ ...e, postedAt: toMs(e.postedAt) }));
    const merge = (x: string[], y: string[]) => [...new Set([...x, ...y])].slice(0, 12);
    if (have) {
      await ctx.db.patch(have._id, {
        title: have.title === "original sound" ? a.c.title : have.title,
        status: have.status === "faded" ? have.status : a.status, // today's check wins; over is over
        accounts: merge(have.accounts, a.c.accounts), sources: merge(have.sources, a.c.sources), niche: merge(have.niche, a.c.niche),
        uses: a.uses ? [...have.uses, { at: a.now, n: a.uses }].slice(-14) : have.uses,
        ...(a.topAgeDays !== null ? { topAgeDays: a.topAgeDays } : {}),
        examples: [...examples, ...have.examples.map((e) => ({ ...e, url: canonicalLink(e.url) })).filter((e) => !examples.some((x) => x.url === e.url))].slice(0, 3),
        lastSeenAt: a.now, checkedAt: a.now,
      });
      return { id: have._id, isNew: false };
    }
    const id = await ctx.db.insert("trends", {
      clipId: a.c.clipId, title: a.c.title, ...(a.c.author ? { author: a.c.author } : {}), status: a.status,
      niche: a.c.niche, sources: a.c.sources, accounts: a.c.accounts.slice(0, 12),
      uses: a.uses ? [{ at: a.now, n: a.uses }] : [], ...(a.topAgeDays !== null ? { topAgeDays: a.topAgeDays } : {}),
      examples, firstSeenAt: a.now, lastSeenAt: a.now, checkedAt: a.now,
    });
    return { id, isNew: true };
  },
});

export const recount = internalMutation({
  args: { id: v.id("trends"), n: v.union(v.number(), v.null()), now: v.number() },
  handler: async (ctx, a): Promise<{ status: string }> => {
    const t = (await ctx.db.get(a.id)) as Doc<"trends"> | null;
    if (!t) return { status: "gone" };
    const uses = a.n ? [...t.uses, { at: a.now, n: a.n }].slice(-14) : t.uses;
    const m = momentum(uses);
    // Over: slowing two counts running, or past its life and not climbing.
    const prevFading = momentum(uses.slice(0, -1)) === "fading";
    const over = (m === "fading" && prevFading) || (a.now - t.firstSeenAt > TREND.lifeMs && m !== "rising");
    await ctx.db.patch(t._id, { uses, checkedAt: a.now, ...(over ? { status: "faded" as const } : {}) });
    return { status: over ? "faded" : t.status };
  },
});

export const toRecount = internalQuery({
  args: { now: v.number(), skip: v.array(v.string()) },
  handler: async (ctx, a): Promise<Array<{ id: Id<"trends">; clipId: string }>> =>
    ((await ctx.db.query("trends").withIndex("by_status", (q) => q.eq("status", "live")).order("desc").take(60)) as Doc<"trends">[])
      .filter((t) => !a.skip.includes(t.clipId) && a.now - t.checkedAt > 18 * 3_600_000)
      .slice(0, TREND.recountPerDay)
      .map((t) => ({ id: t._id, clipId: t.clipId })),
});

export const toWatch = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Array<{ id: Id<"trends">; clipId: string }>> =>
    ((await ctx.db.query("trends").withIndex("by_status", (q) => q.eq("status", "live")).order("desc").take(60)) as Doc<"trends">[])
      .filter((t) => !t.recipe && (!t.watchedAt || a.now - t.watchedAt > 20 * 3_600_000))
      // The most accounts on it first: that's the one people will see everywhere.
      .sort((x, y) => y.accounts.length - x.accounts.length || Number(y.niche.length > 0) - Number(x.niche.length > 0))
      .slice(0, TREND.watchPerDay)
      .map((t) => ({ id: t._id, clipId: t.clipId })),
});

export const setRecipe = internalMutation({
  args: { id: v.id("trends"), recipe: v.union(v.object({ kind: v.string(), what: v.string(), beats: v.array(v.string()), onScreenText: v.string(), difficulty: v.string(), solo: v.boolean() }), v.null()), failed: v.optional(v.string()), now: v.number() },
  handler: async (ctx, a): Promise<null> => {
    // Not a trend after all (a song under unrelated videos): it leaves the live list.
    if (a.recipe) await ctx.db.patch(a.id, { recipe: a.recipe, watchedAt: a.now, watchFailed: undefined });
    else if (a.failed) await ctx.db.patch(a.id, { watchFailed: a.failed, watchedAt: a.now });
    else await ctx.db.patch(a.id, { watchFailed: "watched: not a trend", watchedAt: a.now, status: "evergreen" });
    return null;
  },
});

/** Live, watched trends, newest first: the list she judges and the app shows. */
async function liveTrends(ctx: QueryCtx): Promise<Doc<"trends">[]> {
  return ((await ctx.db.query("trends").withIndex("by_status", (q) => q.eq("status", "live")).order("desc").take(40)) as Doc<"trends">[]).filter((t) => t.recipe);
}

export const forJudging = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ fresh: Doc<"trends">[]; keywords: string[] } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const judged = new Set((c.trendPicks ?? []).map((p) => String(p.trendId)));
    const keywords = ((c.dossier as { keywords?: string[] } | undefined)?.keywords ?? []).map((k) => k.toLowerCase());
    const live = await liveTrends(ctx);
    // Their lane first, then the rest; only what she hasn't judged for them yet.
    const mine = (t: Doc<"trends">) => t.niche.some((k) => keywords.includes(k.toLowerCase()));
    const fresh = live.filter((t) => !judged.has(String(t._id))).sort((x, y) => Number(mine(y)) - Number(mine(x))).slice(0, TREND.perPerson);
    return { fresh, keywords };
  },
});

export const savePicks = internalMutation({
  args: { creatorId: v.id("creators"), picks: v.array(v.object({ trendId: v.id("trends"), verdict: v.union(v.literal("hop_on"), v.literal("borrow"), v.literal("skip")), why: v.string(), hook: v.string(), onScreenText: v.optional(v.string()), lengthSec: v.optional(v.number()) })), now: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const live = new Set((await liveTrends(ctx)).map((t) => String(t._id)));
    const kept = (c.trendPicks ?? []).filter((p) => live.has(String(p.trendId)) && !a.picks.some((n) => n.trendId === p.trendId));
    await ctx.db.patch(c._id, { trendPicks: [...a.picks.map((p) => ({ ...p, at: a.now })), ...kept].slice(0, 30) });
    return null;
  },
});

/** One person's trends, the app's Trending tab and her `trends_now` tool: one definition. */
export async function trendsFor(ctx: QueryCtx, c: Doc<"creators">, now: number) {
  const out: Array<{ trendId: Id<"trends">; verdict: "hop_on" | "borrow"; why: string; hook: string; onScreenText: string | null; lengthSec: number | null; ideaId: Id<"ideas"> | null; title: string; kind: string; what: string; beats: string[]; trendText: string; difficulty: string; solo: boolean; momentum: string; niche: boolean; examples: Doc<"trends">["examples"]; firstSeenAt: number }> = [];
  const keywords = ((c.dossier as { keywords?: string[] } | undefined)?.keywords ?? []).map((k) => k.toLowerCase());
  for (const p of c.trendPicks ?? []) {
    if (p.verdict === "skip") continue;
    const t = (await ctx.db.get(p.trendId)) as Doc<"trends"> | null;
    if (!t || t.status !== "live" || !t.recipe) continue;
    out.push({
      trendId: t._id, verdict: p.verdict, why: p.why, hook: p.hook, onScreenText: p.onScreenText ?? null, lengthSec: p.lengthSec ?? null, ideaId: p.ideaId ?? null,
      title: t.title, kind: t.recipe.kind, what: t.recipe.what, beats: t.recipe.beats, trendText: t.recipe.onScreenText, difficulty: t.recipe.difficulty, solo: t.recipe.solo,
      momentum: momentumWords(momentum(t.uses), t.firstSeenAt, now), niche: t.niche.some((k) => keywords.includes(k.toLowerCase())), examples: t.examples, firstSeenAt: t.firstSeenAt,
    });
  }
  // Hop-ons before borrows, their lane first, newest first.
  return out.sort((a, b) => Number(b.verdict === "hop_on") - Number(a.verdict === "hop_on") || Number(b.niche) - Number(a.niche) || b.firstSeenAt - a.firstSeenAt);
}

/** "Save it" on a trend: it becomes one of their ideas (and can go on their week), once. */
export async function saveTrendIdea(ctx: MutationCtx, a: { creatorId: Id<"creators">; trendId: Id<"trends">; now: number }): Promise<{ ok: boolean; ideaId?: Id<"ideas"> }> {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const t = (await ctx.db.get(a.trendId)) as Doc<"trends"> | null;
    const p = c?.trendPicks?.find((x) => x.trendId === a.trendId);
    if (!c || !t || !p || p.verdict === "skip") return { ok: false };
    if (p.ideaId && (await ctx.db.get(p.ideaId))) return { ok: true, ideaId: p.ideaId };
    const ideaId = await ctx.db.insert("ideas", {
      creatorId: c._id,
      evidenceLinks: t.examples.slice(0, 1).map((e) => e.url),
      fit: p.verdict === "hop_on" ? "yes" : "maybe",
      fitWhy: p.why || "a trend that fits you",
      version: { hook: p.hook, onScreenText: p.onScreenText ?? t.recipe?.onScreenText ?? "", ...(p.lengthSec ? { lengthSec: p.lengthSec } : {}), sound: t.title, shotList: t.recipe?.beats ?? [] },
      messageText: `${t.recipe?.what ?? t.title}`,
      status: "sent",
      newForYou: false,
      urgency: "now",
      features: { format: t.recipe?.kind ?? "other", topics: [], tone: "unknown", lengthBucket: "unknown", sound: "trending", source: "trend" },
      savedAt: a.now,
      seenAt: a.now,
      produced: { skillVersion: "trend/1", model: "trend", thresholdsVersion: "n/a" },
      createdAt: a.now,
      sentAt: a.now,
    } as never);
    await ctx.db.patch(c._id, { trendPicks: (c.trendPicks ?? []).map((x) => (x.trendId === a.trendId ? { ...x, ideaId } : x)) });
    return { ok: true, ideaId };
}

export const saveAsIdea = internalMutation({
  args: { creatorId: v.id("creators"), trendId: v.id("trends"), now: v.number() },
  handler: async (ctx, a): Promise<{ ok: boolean; ideaId?: Id<"ideas"> }> => await saveTrendIdea(ctx, a),
});

/** Her `trends_now` tool reads the same list the app shows. */
export const forChat = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a) => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return c ? await trendsFor(ctx, c, a.now) : [];
  },
});

export const judgeable = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"creators">[]> => (await pairedRows(ctx, { activeOnly: true })).filter((c) => c.hasDossier).map((c) => c.creatorId),
});

/* ------------------------------------------------------------------ jobs */

type Read = { value: unknown };
function postsOf(r: Read): Array<{ sound?: PostSound | null; authorHandle?: string | null; url?: string | null; metrics?: { viewCount?: number | null }; postedAt?: number | null; videoUrl?: string | null; thumbnailUrl?: string | null }> {
  const v = r.value as { posts?: unknown[] } | unknown[] | null;
  return (Array.isArray(v) ? v : (v?.posts ?? [])) as ReturnType<typeof postsOf>;
}
function seen(r: Read, source: string, keywords: string[] = []): SeenPost[] {
  return postsOf(r).map((p) => ({ sound: p.sound ?? null, authorHandle: p.authorHandle ?? null, url: p.url ?? null, views: p.metrics?.viewCount ?? 0, postedAt: p.postedAt ?? null, videoUrl: p.videoUrl ?? null, thumbnailUrl: p.thumbnailUrl ?? null, source, keywords }));
}

/** Once a day, for everyone: find, check, recount, watch, then each person's read. */
export const run = internalAction({
  args: { now: v.optional(v.number()), skipJudging: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ read: number; candidates: number; checked: number; recounted: number; watched: number; people: number; failed: string[] }> => {
    const now = a.now ?? Date.now();
    const failed: string[] = [];
    const posts: SeenPost[] = [];
    for (const keyword of TREND.searches) {
      try { posts.push(...seen(await ctx.runAction(internal.reads.read.read, { kind: "search.keyword", params: { keyword, window: "this-week", sort: "relevance" } }), "search")); }
      catch (e) { failed.push(`search ${keyword}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160)); }
    }
    for (const hashtag of TREND.hashtags) {
      try { posts.push(...seen(await ctx.runAction(internal.reads.read.read, { kind: "search.hashtag", params: { hashtag } }), "hashtag")); }
      catch (e) { failed.push(`#${hashtag}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160)); }
    }
    // A hashtag page is any age; only this week's posts count toward "right now".
    const recent = posts.filter((p) => !p.postedAt || now - toMs(p.postedAt) < 7 * DAY);
    const lane = await ctx.runQuery(internal.scout.trends.laneSounds, { now });
    const found = candidates([...recent, ...lane]);
    const known = new Map((await ctx.runQuery(internal.scout.trends.byClip, { clipIds: found.map((c) => c.clipId) })).map((k) => [k.clipId, k]));
    const toCheck = found.filter((c) => { const k = known.get(c.clipId); return !k || (k.status !== "faded" && now - k.checkedAt > 18 * 3_600_000); }).slice(0, TREND.checkPerDay);

    let checked = 0;
    for (const c of toCheck) {
      try {
        const top = postsOf(await ctx.runAction(internal.reads.read.read, { kind: "sound.tiktokVideos", params: { clipId: c.clipId } }));
        const age = topAgeDays(top.map((p) => p.postedAt ?? 0), now);
        const uses = Math.max(c.uses ?? 0, ...top.map((p) => p.sound?.uses ?? 0)) || null;
        const title = c.title !== "original sound" ? c.title : (top.find((p) => p.sound?.title)?.sound?.title ?? c.title);
        // A lane trend is one the people in someone's own searches are on (it carries their keywords); a sound two
        // accounts they admire used is checked like any other, so a years-old song doesn't count as new.
        const niche = c.sources.includes("lane") && c.niche.length > 0;
        // The examples people see: this week's, biggest first, from what we read and the sound's own top list.
        const fromTop = top.filter((p) => p.url && p.authorHandle && p.postedAt && now - toMs(p.postedAt) < 14 * DAY).map((p) => ({ url: canonicalLink(p.url!), handle: p.authorHandle!, views: p.metrics?.viewCount ?? 0, postedAt: p.postedAt!, videoUrl: p.videoUrl ?? null, thumb: p.thumbnailUrl ?? null }));
        const examples = [...c.examples, ...fromTop].filter((e, i, all) => all.findIndex((x) => x.url === e.url) === i).sort((x, y) => y.views - x.views);
        await ctx.runMutation(internal.scout.trends.upsert, {
          c: { clipId: c.clipId, title, author: c.author, accounts: c.accounts, sources: c.sources, niche: niche ? c.niche : [] },
          uses, topAgeDays: age, status: liveOrNot({ topAgeDays: age, niche }),
          examples: examples.slice(0, 3).map(({ videoUrl: _v, ...e }) => e), now,
        });
        checked++;
      } catch (e) {
        failed.push(`check ${c.clipId}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160));
      }
    }

    // Live ones not seen today: count again, so a trend that stopped growing leaves.
    let recounted = 0;
    for (const t of await ctx.runQuery(internal.scout.trends.toRecount, { now, skip: toCheck.map((c) => c.clipId) })) {
      try {
        const r = await ctx.runAction(internal.reads.read.read, { kind: "sound.tiktok", params: { clipId: t.clipId } });
        const n = (r.value as { sound?: { videosUsingIt?: number | null } | null } | null)?.sound?.videosUsingIt ?? null;
        await ctx.runMutation(internal.scout.trends.recount, { id: t.id, n, now });
        recounted++;
      } catch (e) {
        failed.push(`recount ${t.clipId}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160));
      }
    }

    const watched = await watchNew(ctx, found, now, failed);

    let people = 0;
    if (!a.skipJudging) {
      const ids = await ctx.runQuery(internal.scout.trends.judgeable, {});
      const delays = spreadDelays(ids.length, HOURLY_SPREAD_MS);
      for (let k = 0; k < ids.length; k++) await ctx.scheduler.runAfter(delays[k], internal.scout.trends.judge, { creatorId: ids[k] });
      people = ids.length;
    }
    if (failed.length) console.error(`[trends] ${failed.length} failed: ${failed.slice(0, 3).join(" | ")}`);
    return { read: posts.length, candidates: found.length, checked, recounted, watched, people, failed };
  },
});

/** Two examples each, the second watched knowing the first, so a one-off variant isn't taken for the trend. */
async function watchNew(ctx: ActionCtx, found: Candidate[], now: number, failed: string[]): Promise<number> {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) { failed.push("watch: no Gemini key"); return 0; }
  const billTo = (await ctx.runQuery(internal.scout.trends.judgeable, {}))[0];
  // TikTok's video links refuse a request with no browser agent.
  const withAgent: typeof fetch = (url, init) => fetch(url, { ...init, headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", ...(init?.headers ?? {}) } });
  let watched = 0;
  for (const t of await ctx.runQuery(internal.scout.trends.toWatch, { now })) {
    // Video links expire within hours: take them from today's reads, or the sound's own top list now.
    let videos = (found.find((c) => c.clipId === t.clipId)?.examples ?? []).filter((e) => e.videoUrl).map((e) => e.videoUrl!);
    if (videos.length < 2) {
      try {
        const top = postsOf(await ctx.runAction(internal.reads.read.read, { kind: "sound.tiktokVideos", params: { clipId: t.clipId } }));
        videos = [...videos, ...top.filter((p) => p.videoUrl && p.postedAt && now - toMs(p.postedAt) < 21 * DAY).map((p) => p.videoUrl!)];
      } catch { /* the read's failure is named on its own row; watching what we have is still worth it */ }
    }
    let recipe: Recipe | null = null;
    let notTrend = false;
    let reason = "no video to watch";
    for (const url of [...new Set(videos)].slice(0, 2)) {
      const media = await fetchMedia(url, undefined, withAgent);
      if (!media.ok) { reason = media.reason; continue; }
      const r = await watchMedia({ model: WATCH_MODEL_TOP, apiKey, prompt: recipe ? secondWatchPrompt(recipe) : WATCH_TREND_PROMPT, media: { bytes: media.bytes, mimeType: media.mimeType }, resolution: "low" });
      if (r.usage) await ctx.runMutation(internal.core.costs.record, { ...(billTo ? { creatorId: billTo } : {}), vendor: "gemini", resource: WATCH_MODEL_TOP, purpose: "watch_trend", costUsd: r.usage.costUsd, promptTokens: r.usage.promptTokens, completionTokens: r.usage.outputTokens, costSource: "endpoint_table" });
      if (!r.ok) { reason = r.reason; continue; }
      const parsed = parseRecipe(r.text);
      // The first one isn't a trend (a song under unrelated videos): it leaves. The second disagreeing keeps the first.
      if (!parsed) { notTrend = !recipe; break; }
      recipe = parsed;
    }
    // Couldn't watch (an expired link, a refused fetch) is named and tried again tomorrow with fresh links.
    await ctx.runMutation(internal.scout.trends.setRecipe, { id: t.id, recipe, ...(recipe || notTrend ? {} : { failed: clip(reason, 160) }), now });
    if (recipe) watched++;
  }
  return watched;
}

/** One person: her read of the live trends she hasn't judged for them, and the best fresh one for the editor. */
export const judge = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ judged: number; picked: number; noticed: boolean; reason?: string }> => {
    const now = a.now ?? Date.now();
    const j = await ctx.runQuery(internal.scout.trends.forJudging, { creatorId: a.creatorId });
    if (!j || !j.fresh.length) return { judged: 0, picked: 0, noticed: false, reason: "nothing new to judge" };
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!g) return { judged: 0, picked: 0, noticed: false, reason: "creator not found" };
    const prefix = buildPrefix({ creator: g.creator, directives: g.directives, skill: TREND_SKILL, personal: g.personal, voice: g.voice, history: g.history });
    const list = j.fresh.map((t) => {
      const r = t.recipe!;
      return `- id: ${t._id}\n  sound: "${t.title}"${t.niche.length ? ` · people in their lane are on it (${t.niche.slice(0, 3).join(", ")})` : " · platform-wide"} · ${momentumWords(momentum(t.uses), t.firstSeenAt, now)}\n  what it is (${r.kind}, ${r.difficulty}${r.solo ? "" : ", needs two people"}): ${r.what}\n  beats: ${r.beats.join(" / ")}${r.onScreenText ? `\n  on-screen text people use: ${r.onScreenText}` : ""}`;
    }).join("\n");
    const res = await callModel(ctx, { creatorId: a.creatorId, purpose: "trend_judge", model: REGISTRY.writer.primary, temperature: 0.3, maxTokens: 1400, apiKey: process.env.OPENROUTER_API_KEY ?? "", messages: [{ role: "system", content: prefix }, { role: "user", content: `Live on TikTok right now:\n${list}\n\nYour read for them.` }] });
    if (!res.ok) return { judged: 0, picked: 0, noticed: false, reason: `no answer: ${res.reason ?? "model error"}` };
    const picks = parsePicks(res.content, j.fresh.map((t) => String(t._id)));
    // A trend she didn't mention is a skip, so it isn't judged again tomorrow.
    const all = j.fresh.map((t) => picks.find((p) => p.id === String(t._id)) ?? { id: String(t._id), verdict: "skip" as const, why: "", hook: "", onScreenText: "", lengthSec: null });
    await ctx.runMutation(internal.scout.trends.savePicks, {
      creatorId: a.creatorId, now,
      picks: all.map((p) => ({ trendId: p.id as Id<"trends">, verdict: p.verdict, why: p.why, hook: p.hook, ...(p.onScreenText ? { onScreenText: p.onScreenText } : {}), ...(p.lengthSec ? { lengthSec: p.lengthSec } : {}) })),
    });
    // The editor's candidate: the best one that's early. A trend is worth a text only while it's early.
    const best = all
      .filter((p) => p.verdict !== "skip")
      .map((p) => ({ p, t: j.fresh.find((t) => String(t._id) === p.id)! }))
      .filter(({ t }) => now - t.firstSeenAt < 4 * DAY && momentum(t.uses) !== "fading")
      .sort((x, y) => Number(y.p.verdict === "hop_on") - Number(x.p.verdict === "hop_on") || Number(y.t.niche.length > 0) - Number(x.t.niche.length > 0))[0];
    let noticed = false;
    if (best) {
      const r = best.t.recipe!;
      const out = await ctx.runMutation(internal.core.editor.notice, {
        creatorId: a.creatorId, now,
        c: {
          id: `trend:${best.t._id}`, kind: "trend", sourceKey: `trend:${best.t.clipId}`,
          base: best.p.verdict === "hop_on" ? (best.t.niche.length ? 2.8 : 2.4) : 1.8, ttlMs: 2 * DAY,
          summary: `a trend (${r.kind}, ${r.difficulty}, ${momentumWords(momentum(best.t.uses), best.t.firstSeenAt, now)}${best.t.niche.length ? ", people in their lane are on it" : ""}) on "${best.t.title}": ${r.what} · their version: ${best.p.hook}`,
          ...(best.t.examples[0] ? { link: best.t.examples[0].url } : {}),
        },
      });
      noticed = out.added;
    }
    return { judged: all.length, picked: all.filter((p) => p.verdict !== "skip").length, noticed };
  },
});
