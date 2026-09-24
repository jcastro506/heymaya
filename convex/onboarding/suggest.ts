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
export interface CandidateStats { medianViews: number | null; bestMultiple: number | null; postsLast30: number; topCaptions: string[]; /** One post far above a thin normal: real, but no multiple is quoted for it. */ runawayPost: boolean; lastPostDaysAgo: number | null; postsRead: number }
type Pooled = DiscoveredProfile & { following?: boolean };

export const SUGGEST = {
  /** Shortlist size per platform when both are connected, and in total when one is. */
  perPlatformBoth: 4,
  single: 8,
  show: 6,
  keywords: 2,
  waitForPostsMs: 15_000,
  /** Where an unsized account sorts: after sized accounts within about 1.5 orders of magnitude. */
  unknownSizeDistance: 1.5,
} as const;

/** What code requires before the model sees an account (§27.2): readable, active, a real audience. */
export const GATE = { minPosts: 5, activeWithinDays: 30, minFollowers: 1_000 } as const;

/** Whether an account clears the gate, and why not. Pure. */
export function qualifies(s: CandidateStats, followers: number | null): { ok: boolean; reason?: string } {
  if (s.postsRead < GATE.minPosts) return { ok: false, reason: `only ${s.postsRead} posts read` };
  if (s.lastPostDaysAgo === null || s.lastPostDaysAgo > GATE.activeWithinDays) return { ok: false, reason: s.lastPostDaysAgo === null ? "no post dates" : `last post ${s.lastPostDaysAgo} days ago` };
  if (!followers || followers < GATE.minFollowers) return { ok: false, reason: followers ? `${followers} followers` : "follower count unknown" };
  return { ok: true };
}

export const SUGGEST_SKILL = `who to watch
You pick accounts worth watching for one creator who just signed up. You get their own sentence about what they make, their best posts, and a shortlist of accounts that code has already checked are active, sized and readable, each with its bio, numbers and most-viewed recent captions.
Pick up to six this creator can actually learn from. Every pick must be a person or a creator-led brand posting its own original content. Never pick repost or aggregator pages, meme pages, community hubs that feature other people's work, magazines, apps, or product and recipe catalogues; the bio and captions usually give them away ("DM for credit", "tag us to be featured", "community", "download the app", a feed of other people's clips).
Relevance comes from their sentence first: the same subject and audience, or an adjacent lane with a format they could borrow. Skip anyone who matches only by size or a broad tag. When the shortlist covers two platforms, pick from both. Fewer good picks beat six weak ones.
For each pick write one sentence to the creator, second person, under 160 characters: name the specific format, hook or series worth borrowing as it appears in that account's captions, and tie it to their own sentence or posts when you can. A number is optional and at most one; never make a number the reason. No hype, no "inspiring", no emoji, no follower counts.
Return STRICT JSON only: {"picks":[{"id":"c0","why":"..."}]}. If none fit, return {"picks":[]}.`;

const GENERIC = new Set(["fyp", "foryou", "foryoupage", "viral", "explore", "explorepage", "reels", "reel", "trending", "tiktok", "instagram", "instagood", "fy", "xyzbca", "capcut", "fypage", "viralvideo", "motivation", "fitnessmotivation", "inspiration", "healthy", "healthydiet", "love", "instadaily", "photooftheday", "trend", "trend2026", "reelsinstagram", "explorar", "fitness", "lifestyle", "tips"]);
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

const STOP = new Set(["about", "make", "makes", "making", "videos", "video", "content", "people", "their", "getting", "with", "that", "this", "from", "into", "your", "what", "they", "them", "just", "like", "who", "for", "and", "the", "help", "helping", "things", "stuff", "creator", "posts", "real", "over", "little", "busy", "best", "daily", "sense", "ideas", "week"]);

/**
 * Search terms (§27; tightened live 2026-09-14, when an Instagram coach's own-name hashtag
 * "charliejohnson" and a one-off tag returned namesakes and strangers): the dossier's; then a two-word
 * phrase from their own sentence; then hashtags that recur on at least two of their posts, weighted by
 * how those posts did, never one containing their own handle. Pure.
 */
export function keywordsFrom(posts: OwnPost[], niche: string | undefined, dossierKeywords: string[], max: number = SUGGEST.keywords, ownHandles: string[] = []): string[] {
  const stems = ownHandles.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(fitness|official|tv|show|\d+)$/g, "")).filter((h) => h.length >= 4);
  const isOwn = (tag: string) => stems.some((st) => tag.includes(st) || st.includes(tag));
  const score = new Map<string, number>();
  const seenOn = new Map<string, number>();
  for (const p of posts) for (const h of new Set(p.hashtags.map((x) => x.toLowerCase()))) {
    if (h.length < 3 || GENERIC.has(h) || isOwn(h)) continue;
    score.set(h, (score.get(h) ?? 0) + Math.max(1, p.multiple ?? 1));
    seenOn.set(h, (seenOn.get(h) ?? 0) + 1);
  }
  const tags = [...score.entries()].filter(([k]) => (seenOn.get(k) ?? 0) >= 2).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  // §27.2: their own sentence outranks their hashtags; broad recurring tags pulled a generic pool.
  const phrase: string[] = [];
  if (niche) {
    const words = niche.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !STOP.has(w));
    if (words.length >= 2) phrase.push(`${words[0]} ${words[1]}`);
    else if (words.length === 1) phrase.push(words[0]);
  }
  const out = [...dossierKeywords.map((k) => k.toLowerCase().trim()).filter((k) => k && !isOwn(k.replace(/\s+/g, ""))), ...phrase, ...tags];
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
    // §27.2: an unknown size is not a perfect match; it ranks after known sizes near theirs.
    if (!c.followerCount) return SUGGEST.unknownSizeDistance - (c.following ? 0.5 : 0);
    return Math.abs(Math.log10(c.followerCount) - Math.log10(target)) - (c.following ? 0.5 : 0);
  };
  for (const p of input.platforms) by[p].sort((a, b) => distance(p)(a) - distance(p)(b));
  const per = input.platforms.length > 1 ? SUGGEST.perPlatformBoth : SUGGEST.single;
  const picked = input.platforms.flatMap((p) => by[p].slice(0, per));
  const rest = input.platforms.flatMap((p) => by[p].slice(per));
  return [...picked, ...rest].slice(0, SUGGEST.single);
}

export const STATS = { minViewPosts: 5, minMedianViews: 500, maxQuotedMultiple: 50 } as const;

/** What their recent posts say, from numbers the read returned. Pure. */
export function statsFor(posts: CandidatePost[], now: number): CandidateStats {
  const views = posts.map((p) => p.views).filter((x): x is number => typeof x === "number" && x > 0).sort((a, b) => a - b);
  const medianViews = views.length ? views[Math.floor(views.length / 2)] : null;
  // Live 2026-09-14: "1374.7x their normal" was true arithmetic on a handful of view counts with a
  // tiny median, and meant nothing. A multiple is quoted only on a real normal, and a runaway post
  // is named as one rather than as a four-digit number.
  const ratio = medianViews && views.length >= STATS.minViewPosts && medianViews >= STATS.minMedianViews ? views[views.length - 1] / medianViews : null;
  const runawayPost = ratio !== null && ratio > STATS.maxQuotedMultiple;
  const bestMultiple = ratio !== null && !runawayPost ? Math.round(ratio * 10) / 10 : null;
  const postsLast30 = posts.filter((p) => p.postedAt && toMs(p.postedAt) >= now - 30 * 86_400_000).length;
  const topCaptions = [...posts].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).map((p) => clip(p.caption.replace(/\s+/g, " ").trim(), 120)).filter(Boolean).slice(0, 3);
  const dates = posts.map((p) => p.postedAt).filter((x): x is number => typeof x === "number" && x > 0).map(toMs);
  const lastPostDaysAgo = dates.length ? Math.max(0, Math.round((now - Math.max(...dates)) / 86_400_000)) : null;
  return { medianViews, bestMultiple, postsLast30, topCaptions, runawayPost, lastPostDaysAgo, postsRead: posts.length };
}

/** The reason when the model is unavailable: only what the numbers show. Pure. */
export function fallbackWhy(s: CandidateStats): string {
  const steady = s.postsLast30 >= 4 ? `Posts steadily, ${s.postsLast30} times in the last month` : "";
  const best = s.bestMultiple && s.bestMultiple >= 1.5 ? `${steady ? ", and their" : "Their"} best recent post did ${s.bestMultiple}× their usual views` : "";
  const runaway = !best && s.runawayPost ? `${steady ? ", and one" : "One"} recent post took off far beyond their usual reach` : "";
  return steady || best || runaway ? `${steady}${best}${runaway}.` : "Active near your lane and close to your size.";
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

/** Normalized posts from an account.posts read value. Pure. */
export const postsOf = (value: unknown): CandidatePost[] => {
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
    const keywords = keywordsFrom(gg.own, gg.niche, gg.keywords, SUGGEST.keywords, [gg.handles.tiktok, gg.handles.instagram].filter((h): h is string => Boolean(h)));
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
    if (platforms.includes("instagram")) for (const k of keywords) {
      jobs.push(discover("discover.profiles", { keyword: k }).then((r) => { pool.push(...r); }));
      // §27.3: the authors of this month's top Reels for their terms. Profile search alone mostly returned dormant accounts.
      jobs.push(read("search.reels", { keyword: k, window: "last-month" }).then((v) => {
        const arr = (v as { posts?: unknown[] } | null)?.posts ?? [];
        for (const p of arr as Array<{ authorHandle?: string | null; author?: { followerCount?: number | null; displayName?: string | null; avatarUrl?: string | null; isPrivate?: boolean } }>) {
          if (p.authorHandle) pool.push({ platform: "instagram", handle: p.authorHandle, displayName: p.author?.displayName ?? null, followerCount: p.author?.followerCount ?? null, avatarUrl: p.author?.avatarUrl ?? null, bio: null, isPrivate: p.author?.isPrivate === true });
        }
      }));
    }
    await Promise.all(jobs);

    const short = shortlist({ candidates: pool, platforms: [...platforms], exclude: new Set(gg.exclude), ownFollowers });
    const now = Date.now();
    const detailed = await Promise.all(short.map(async (c, i) => {
      const stats = statsFor(postsOf(await read("account.posts", { platform: c.platform, handle: c.handle, sort: "latest", slot: "onboarding" })), now);
      let filled: Pooled = c;
      // §27.2: an unsized account is sized before it can be judged; keyword-search authors arrive without a count.
      if (!c.followerCount && stats.postsRead >= GATE.minPosts) {
        const p = (await read("profile", { platform: c.platform, handle: c.handle })) as { followerCount?: number; displayName?: string | null; avatarUrl?: string | null; bio?: string | null } | null;
        if (p) filled = { ...c, followerCount: p.followerCount || null, displayName: c.displayName ?? p.displayName ?? null, avatarUrl: c.avatarUrl ?? p.avatarUrl ?? null, bio: c.bio ?? p.bio ?? null };
      }
      return { id: `c${i}`, c: filled, stats };
    }));
    const gated: string[] = [];
    const usable = detailed.filter((d) => {
      const q = qualifies(d.stats, d.c.followerCount);
      if (!q.ok) gated.push(`${d.c.platform}:${d.c.handle}: ${q.reason}`);
      return q.ok && d.stats.topCaptions.length > 0;
    });
    const trace: Record<string, unknown> = { platforms, keywords, ownPosts: gg.ownCount, ownFollowers, pool: pool.length, shortlist: short.map((s) => `${s.platform}:${s.handle}`), gated, usable: usable.length };

    let modelAnswered = false;
    let picks: Array<{ id: string; why: string }> = [];
    let dropped = 0;
    if (usable.length) {
      const evidence = JSON.stringify({
        theirSentence: gg.niche ?? null,
        theirBestPosts: gg.own.slice(0, 6).map((p) => ({ platform: p.platform, caption: clip(p.caption, 140), timesTheirNormal: p.multiple })),
        shortlist: usable.map((d) => ({ id: d.id, platform: d.c.platform, handle: d.c.handle, followers: d.c.followerCount, bio: clip(d.c.bio ?? "", 120), postsLast30Days: d.stats.postsLast30, medianViews: d.stats.medianViews, bestRecentTimesTheirNormal: d.stats.bestMultiple, oneRunawayPost: d.stats.runawayPost, topRecentCaptions: d.stats.topCaptions })),
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
