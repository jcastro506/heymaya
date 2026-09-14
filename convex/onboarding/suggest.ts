/**
 * Who to watch, chosen from their own posts (plan §27, 2026-09-14). Discover broadly on the
 * platforms they connected, read recent posts for a bounded shortlist, and let one writer call pick
 * and explain, in one grounded sentence each. Code bounds the reads, the ids, the numbers and the
 * words; the model judges fit. About thirteen credits and one writer call per signup.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { checkPlainLanguage } from "../core/plainLanguage";
import { profilesOf, type DiscoveredProfile } from "../reads/profiles";

type Platform = "tiktok" | "instagram";
export interface Suggestion { platform: Platform; handle: string; followers: number | null; why: string; displayName?: string; avatarUrl?: string }
export interface OwnPost { platform: Platform; caption: string; hashtags: string[]; multiple: number | null; views: number }
export interface CandidatePost { caption: string; views: number | null; postedAt: number | null }
export interface CandidateStats { medianViews: number | null; bestMultiple: number | null; postsLast30: number; topCaptions: string[] }
type Pooled = DiscoveredProfile & { following?: boolean };

export const SUGGEST = {
  /** Shortlist size per platform when both are connected, and in total when one is. */
  perPlatformBoth: 4,
  single: 8,
  show: 6,
  keywords: 2,
  waitForPostsMs: 15_000,
} as const;

export const SUGGEST_SKILL = `who to watch
You pick creators worth watching for one creator who just signed up. You get their own best posts and a shortlist of accounts, each with its recent posts and numbers.
Pick up to six they can actually learn from: close to their subject or audience, a format they could borrow, and posts doing well against that account's own normal. Skip anyone who matches only by size. When the shortlist covers two platforms, pick from both.
For each pick write one sentence to the creator, second person, under 160 characters, naming the specific thing worth borrowing; tie it to one of their own posts or topics when the evidence shows it. Use only numbers that appear in the data. No hype, no "inspiring", no emoji, no follower counts as the reason.
Return STRICT JSON only: {"picks":[{"id":"c0","why":"..."}]}. If none fit, return {"picks":[]}.`;

const GENERIC = new Set(["fyp", "foryou", "foryoupage", "viral", "explore", "explorepage", "reels", "reel", "trending", "tiktok", "instagram", "instagood", "fy", "xyzbca", "capcut", "fypage", "viralvideo"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toMs = (t: number) => (t < 1e12 ? t * 1000 : t);
/**
 * Cut text by characters, never inside one (live 2026-09-14: a caption cut at 200 split an emoji's
 * surrogate pair and Convex refused the whole return value). Pure.
 */
export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

/** Search terms: the dossier's, else hashtags weighted by how the post did, else their sentence. Pure. */
export function keywordsFrom(posts: OwnPost[], niche: string | undefined, dossierKeywords: string[], max: number = SUGGEST.keywords): string[] {
  const score = new Map<string, number>();
  for (const p of posts) for (const h of p.hashtags) {
    const k = h.toLowerCase();
    if (k.length < 3 || GENERIC.has(k)) continue;
    score.set(k, (score.get(k) ?? 0) + Math.max(1, p.multiple ?? 1));
  }
  const tags = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const out = [...dossierKeywords.map((k) => k.toLowerCase().trim()).filter(Boolean), ...tags];
  if (out.length === 0 && niche) out.push(...niche.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3).slice(0, 3));
  return [...new Set(out)].slice(0, max);
}

export function bandFor(followers: number): "10K-100K" | "100K-1M" | "1M-10M" | "10M+" {
  return followers >= 10_000_000 ? "10M+" : followers >= 1_000_000 ? "1M-10M" : followers >= 100_000 ? "100K-1M" : "10K-100K";
}

export function countryFor(timezone: string): string {
  return timezone.startsWith("Europe/London") ? "GB" : timezone.startsWith("Australia/") ? "AU" : "US";
}

/**
 * The bounded shortlist: connected platforms only, no private accounts, nobody already watched or
 * theirs, deduped, nearest a size a little above theirs, accounts they follow first; split across
 * both platforms when both are connected, topped up from the other when one runs short. Pure.
 */
export function shortlist(input: { candidates: Pooled[]; platforms: Platform[]; exclude: Set<string>; ownFollowers: Partial<Record<Platform, number>> }): Pooled[] {
  const seen = new Set<string>();
  const by: Record<Platform, Pooled[]> = { tiktok: [], instagram: [] };
  for (const c of input.candidates) {
    const key = `${c.platform}:${(c.handle ?? "").toLowerCase()}`;
    if (!c.handle || !input.platforms.includes(c.platform) || c.isPrivate || seen.has(key) || input.exclude.has(key)) continue;
    seen.add(key);
    by[c.platform].push(c);
  }
  const distance = (p: Platform) => (c: Pooled) => {
    const target = Math.max((input.ownFollowers[p] ?? 0) * 3, 5_000);
    const f = c.followerCount ?? target;
    return Math.abs(Math.log10(Math.max(f, 1)) - Math.log10(target)) - (c.following ? 0.5 : 0);
  };
  for (const p of input.platforms) by[p].sort((a, b) => distance(p)(a) - distance(p)(b));
  const per = input.platforms.length > 1 ? SUGGEST.perPlatformBoth : SUGGEST.single;
  const picked = input.platforms.flatMap((p) => by[p].slice(0, per));
  const rest = input.platforms.flatMap((p) => by[p].slice(per));
  return [...picked, ...rest].slice(0, SUGGEST.single);
}

/** What their recent posts say, from numbers the read returned. Pure. */
export function statsFor(posts: CandidatePost[], now: number): CandidateStats {
  const views = posts.map((p) => p.views).filter((x): x is number => typeof x === "number" && x > 0).sort((a, b) => a - b);
  const medianViews = views.length ? views[Math.floor(views.length / 2)] : null;
  const bestMultiple = medianViews && views.length >= 3 ? Math.round((views[views.length - 1] / medianViews) * 10) / 10 : null;
  const postsLast30 = posts.filter((p) => p.postedAt && toMs(p.postedAt) >= now - 30 * 86_400_000).length;
  const topCaptions = [...posts].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).map((p) => clip(p.caption.replace(/\s+/g, " ").trim(), 120)).filter(Boolean).slice(0, 3);
  return { medianViews, bestMultiple, postsLast30, topCaptions };
}

/** The reason when the model is unavailable: only what the numbers show. Pure. */
export function fallbackWhy(s: CandidateStats): string {
  const steady = s.postsLast30 >= 4 ? `Posts steadily, ${s.postsLast30} times in the last month` : "";
  const best = s.bestMultiple && s.bestMultiple >= 1.5 ? `${steady ? ", and their" : "Their"} best recent post did ${s.bestMultiple}× their usual views` : "";
  return steady || best ? `${steady}${best}.` : "Active near your lane and close to your size.";
}

/** Every number in the sentence appears in the evidence. Pure. */
export function numbersGrounded(text: string, evidence: string): boolean {
  // Whole numbers, not substrings: "2" must not pass because the evidence says 12000.
  const norm = (n: string) => String(Number(n.replace(/,/g, "")));
  const known = new Set((evidence.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(norm));
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).every((n) => known.has(norm(n)));
}

/** The model's picks, kept only when the id is on the shortlist and the sentence is usable. Pure. */
export function parsePicks(content: string, ids: Set<string>): Array<{ id: string; why: string }> {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const j = JSON.parse(m[0]) as { picks?: Array<{ id?: unknown; why?: unknown }> };
    const out: Array<{ id: string; why: string }> = [];
    const seen = new Set<string>();
    for (const p of j.picks ?? []) {
      const id = String(p.id ?? "");
      const why = String(p.why ?? "").replace(/\s+/g, " ").trim();
      if (!ids.has(id) || seen.has(id) || why.length < 12 || why.length > 220) continue;
      seen.add(id);
      out.push({ id, why });
    }
    return out.slice(0, SUGGEST.show);
  } catch {
    return [];
  }
}

/** Both platforms connected and every pick on one: the best of the other takes the last seat. Pure. */
export function balance<T extends { platform: Platform }>(chosen: T[], extras: T[], platforms: Platform[]): T[] {
  if (platforms.length < 2) return chosen;
  const out = [...chosen];
  for (const p of platforms) {
    if (out.some((c) => c.platform === p)) continue;
    const add = extras.find((e) => e.platform === p && !out.includes(e));
    if (!add) continue;
    if (out.length >= SUGGEST.show) out.pop();
    out.push(add);
  }
  return out;
}

const postsOf = (value: unknown): CandidatePost[] => {
  const arr = Array.isArray(value) ? value : ((value as { posts?: unknown[] } | null)?.posts ?? []);
  return (arr as Array<{ caption?: string | null; metrics?: { viewCount?: number | null }; postedAt?: number | null }>).map((p) => ({ caption: p.caption ?? "", views: p.metrics?.viewCount ?? null, postedAt: p.postedAt ?? null }));
};

export const gather = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ handles: { tiktok?: string; instagram?: string }; timezone: string; niche: string | undefined; keywords: string[]; own: OwnPost[]; ownCount: number; exclude: string[] } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(60)) as Doc<"ownPosts">[];
    const own = [...posts].sort((x, y) => (y.multiple ?? 0) - (x.multiple ?? 0)).slice(0, 12).map((p) => ({ platform: p.platform, caption: clip(p.caption, 200), hashtags: p.hashtags, multiple: p.multiple ?? null, views: p.metrics.views }));
    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
    const mine = [c.handles.tiktok, c.handles.instagram].filter((h): h is string => Boolean(h)).map((h) => h.toLowerCase());
    const exclude = [...tracked.filter((t) => t.status !== "removed").map((t) => `${t.platform}:${t.handle.toLowerCase()}`), ...mine.flatMap((h) => [`tiktok:${h}`, `instagram:${h}`])];
    return { handles: c.handles, timezone: c.timezone, niche: typeof c.niche === "string" ? c.niche : undefined, keywords: (c.dossier as { keywords?: string[] } | undefined)?.keywords ?? [], own, ownCount: posts.length, exclude };
  },
});

export const suggestFor = internalAction({
  args: { creatorId: v.id("creators"), waitMs: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ suggestions: Suggestion[]; trace: Record<string, unknown> }> => {
    const failures: string[] = [];
    let g = await ctx.runQuery(internal.onboarding.suggest.gather, { creatorId: a.creatorId });
    const deadline = Date.now() + (a.waitMs ?? SUGGEST.waitForPostsMs);
    while (g && g.ownCount === 0 && Date.now() < deadline) {
      await sleep(3_000);
      g = await ctx.runQuery(internal.onboarding.suggest.gather, { creatorId: a.creatorId });
    }
    if (!g) return { suggestions: [], trace: { reason: "no creator" } };
    const gg = g;
    const platforms = (["tiktok", "instagram"] as const).filter((p) => gg.handles[p]);
    if (!platforms.length) return { suggestions: [], trace: { reason: "no connected account" } };

    const read = async (kind: string, params: Record<string, unknown>, force = false): Promise<unknown> => {
      try {
        return (await ctx.runAction(internal.reads.read.read, { kind, params, creatorId: a.creatorId, ...(force ? { force } : {}) })).value;
      } catch (e) {
        failures.push(`${kind}: ${String(e).slice(0, 140)}`);
        return null;
      }
    };
    // A row cached before §27 has no `profiles`; read it once more rather than wait out its TTL.
    const discover = async (kind: string, params: Record<string, unknown>): Promise<DiscoveredProfile[]> => {
      const first = await read(kind, params);
      if (first === null) return [];
      return profilesOf(first) ?? profilesOf(await read(kind, params, true)) ?? [];
    };

    const ownFollowers: Partial<Record<Platform, number>> = {};
    await Promise.all(platforms.map(async (p) => {
      const f = Number((await read("profile", { platform: p, handle: gg.handles[p] }) as { followerCount?: number } | null)?.followerCount ?? 0);
      if (f > 0) ownFollowers[p] = f;
    }));
    const keywords = keywordsFrom(gg.own, gg.niche, gg.keywords);
    const pool: Pooled[] = [];
    const jobs: Array<Promise<void>> = [];
    if (platforms.includes("tiktok")) {
      jobs.push(discover("discover.creators", { band: bandFor(ownFollowers.tiktok ?? 0), country: countryFor(gg.timezone) }).then((r) => { pool.push(...r); }));
      jobs.push(discover("account.following", { handle: gg.handles.tiktok }).then((r) => { pool.unshift(...r.map((x) => ({ ...x, following: true }))); }));
      if (keywords[0]) jobs.push(read("search.keyword", { keyword: keywords[0], window: "this-month", sort: "most-liked" }).then((v) => {
        const arr = Array.isArray(v) ? v : ((v as { posts?: unknown[] } | null)?.posts ?? []);
        for (const p of arr as Array<{ authorHandle?: string | null }>) if (p.authorHandle) pool.push({ platform: "tiktok", handle: p.authorHandle.toLowerCase(), displayName: null, followerCount: null, avatarUrl: null, bio: null, isPrivate: false });
      }));
    }
    if (platforms.includes("instagram")) for (const k of keywords) jobs.push(discover("discover.profiles", { keyword: k }).then((r) => { pool.push(...r); }));
    await Promise.all(jobs);

    const short = shortlist({ candidates: pool, platforms: [...platforms], exclude: new Set(gg.exclude), ownFollowers });
    const now = Date.now();
    const detailed = await Promise.all(short.map(async (c, i) => ({ id: `c${i}`, c, stats: statsFor(postsOf(await read("account.posts", { platform: c.platform, handle: c.handle, sort: "latest", slot: "onboarding" })), now) })));
    const usable = detailed.filter((d) => d.stats.topCaptions.length > 0);
    const trace: Record<string, unknown> = { platforms, keywords, ownPosts: gg.ownCount, ownFollowers, pool: pool.length, shortlist: short.map((s) => `${s.platform}:${s.handle}`), usable: usable.length };

    let modelAnswered = false;
    let picks: Array<{ id: string; why: string }> = [];
    let dropped = 0;
    if (usable.length) {
      const evidence = JSON.stringify({
        theirBestPosts: gg.own.slice(0, 6).map((p) => ({ platform: p.platform, caption: clip(p.caption, 140), timesTheirNormal: p.multiple })),
        shortlist: usable.map((d) => ({ id: d.id, platform: d.c.platform, handle: d.c.handle, followers: d.c.followerCount, bio: clip(d.c.bio ?? "", 120), postsLast30Days: d.stats.postsLast30, medianViews: d.stats.medianViews, bestRecentTimesTheirNormal: d.stats.bestMultiple, topRecentCaptions: d.stats.topCaptions })),
      });
      for (const model of [REGISTRY.writer.primary, REGISTRY.writer.fallback]) {
        const r = await callModel(ctx, { creatorId: a.creatorId, purpose: "onboarding_suggest", model, messages: [{ role: "system", content: SUGGEST_SKILL }, { role: "user", content: evidence }], temperature: 0.3, maxTokens: 900, timeoutMs: 25_000, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
        if (!r.ok) { failures.push(`model ${model}: ${r.reason.slice(0, 120)}`); continue; }
        modelAnswered = true;
        const parsed = parsePicks(r.content, new Set(usable.map((d) => d.id)));
        picks = parsed.filter((p) => checkPlainLanguage(p.why).ok && numbersGrounded(p.why, evidence));
        dropped = parsed.length - picks.length;
        trace.model = model;
        break;
      }
    }
    const byId = new Map(usable.map((d) => [d.id, d]));
    type Chosen = { platform: Platform; d: (typeof usable)[number]; why: string };
    // The model judged none fit: say nothing rather than guess. It failed, or every sentence was dropped: the numbers speak.
    const base: Chosen[] = picks.length
      ? picks.map((p) => ({ platform: byId.get(p.id)!.c.platform, d: byId.get(p.id)!, why: p.why }))
      : !modelAnswered || dropped > 0 ? usable.slice(0, SUGGEST.show).map((d) => ({ platform: d.c.platform, d, why: fallbackWhy(d.stats) })) : [];
    const extras: Chosen[] = usable.filter((d) => !base.some((b) => b.d === d)).map((d) => ({ platform: d.c.platform, d, why: fallbackWhy(d.stats) }));
    const chosen = balance(base, extras, [...platforms]);
    const suggestions: Suggestion[] = chosen.map(({ d, why }) => ({ platform: d.c.platform, handle: d.c.handle, followers: d.c.followerCount, why, ...(d.c.displayName ? { displayName: d.c.displayName } : {}), ...(d.c.avatarUrl ? { avatarUrl: d.c.avatarUrl } : {}) }));
    return { suggestions, trace: { ...trace, picked: picks.length, dropped, failures } };
  },
});

/** Dev: which creators could run suggestions live (real handles, any plan). */
export const devCandidates = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ id: Id<"creators">; handles: { tiktok?: string; instagram?: string }; ownPosts: number }>> => {
    const cs = (await ctx.db.query("creators").take(200)) as Doc<"creators">[];
    const out: Array<{ id: Id<"creators">; handles: { tiktok?: string; instagram?: string }; ownPosts: number }> = [];
    for (const c of cs) {
      if (!c.handles.tiktok && !c.handles.instagram) continue;
      const n = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).take(30)).length;
      out.push({ id: c._id, handles: c.handles, ownPosts: n });
    }
    return out.sort((x, y) => y.ownPosts - x.ownPosts).slice(0, 20);
  },
});
