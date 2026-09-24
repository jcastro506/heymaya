/**
 * The suggestion quality eval (plan §27.1, 2026-09-14). Are the accounts she suggests real,
 * active creators with real audiences, relevant to this creator, with reasons that match their
 * posts? Real public subjects, a first read only, production `suggestFor`, then every card
 * re-checked by code against fresh reads and judged by a different model family.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { startCreator } from "../onboarding/start";
import { clip, postsOf, statsFor, type CandidatePost, type CandidateStats } from "../onboarding/suggest";
import { profilesOf } from "../reads/profiles";

type Platform = "tiktok" | "instagram";
const platformV = v.union(v.literal("tiktok"), v.literal("instagram"));
const toMs = (t: number) => (t < 1e12 ? t * 1000 : t);
const DAY = 86_400_000;

export const QUALITY = { minFollowers: 1_000, activeWithinDays: 30, minPosts: 5, minRelevance: 2 } as const;

export interface CardFacts {
  exists: boolean;
  followers: number | null;
  verified: boolean | null;
  bio: string | null;
  postCount: number | null;
  lastPostDaysAgo: number | null;
  postsRead: number;
  stats: CandidateStats;
  recentPosts: Array<{ caption: string; views: number | null; daysAgo: number | null }>;
}
export interface HardChecks { exists: boolean; realAudience: boolean; active: boolean; enoughPosts: boolean; onConnectedPlatform: boolean; reasonNumbersMatch: boolean }
export interface Verdict { realCreator: "yes" | "no" | "unsure"; kind: string; relevance: number; learnable: number; reasonAccurate: "yes" | "partly" | "no"; note: string }

const numbersIn = (text: string) => (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => String(Number(n.replace(/,/g, ""))));

/** What code can prove about one card. Pure. */
export function hardChecks(facts: CardFacts, why: string, platform: Platform, connected: Platform[]): HardChecks {
  const known = new Set<string>();
  for (const n of [facts.stats.medianViews, facts.stats.bestMultiple, facts.stats.postsLast30, facts.followers]) if (typeof n === "number") known.add(String(n));
  for (const p of facts.recentPosts) for (const n of numbersIn(p.caption)) known.add(n);
  for (const c of facts.stats.topCaptions) for (const n of numbersIn(c)) known.add(n);
  return {
    exists: facts.exists,
    realAudience: (facts.followers ?? 0) >= QUALITY.minFollowers,
    active: facts.lastPostDaysAgo !== null && facts.lastPostDaysAgo <= QUALITY.activeWithinDays,
    enoughPosts: facts.postsRead >= QUALITY.minPosts,
    onConnectedPlatform: connected.includes(platform),
    reasonNumbersMatch: numbersIn(why).every((n) => known.has(n)),
  };
}

/** A card passes on every code check and the judge's three bars. Pure. */
export function cardPasses(h: HardChecks, v: Verdict | null): boolean {
  return h.exists && h.realAudience && h.active && h.enoughPosts && h.onConnectedPlatform && h.reasonNumbersMatch && v !== null && v.realCreator === "yes" && v.relevance >= QUALITY.minRelevance && v.reasonAccurate !== "no";
}

export const QUALITY_JUDGE = `You audit the creator accounts suggested to a new creator on an onboarding screen: "a few creators worth keeping an eye on". Be strict; a bad card costs trust.
For each card judge from the account's own bio and recent posts, not from its handle:
- realCreator: "yes" only if the account regularly posts its own original content as a person or a creator-led brand. A shop or product catalogue, meme or repost page, fan page, giveaway, or spam is "no". "unsure" when the posts cannot tell you.
- kind: creator | creator_brand | brand_catalogue | repost_or_meme | fan_page | spam | unclear
- relevance 0-3 to THIS creator: 3 same lane and audience; 2 adjacent lane with a format they could borrow; 1 loose; 0 unrelated.
- learnable 0-3: a concrete hook, format or series this creator could borrow from these posts.
- reasonAccurate: does the sentence shown on the card match this account's posts and numbers? Judge it against topPostsByViews and stats as well as recentPosts; a multiple is "their best recent post against their own median". yes | partly | no
- note: one short sentence on the biggest problem, or what makes it good.
Then score the whole set 0-3 as a first impression for this creator, and name what is missing.
Return STRICT JSON only: {"cards":[{"i":0,"realCreator":"yes","kind":"creator","relevance":2,"learnable":2,"reasonAccurate":"yes","note":"..."}],"set":{"score":2,"note":"..."}}`;

/** The judge's answer, one verdict per card index; anything malformed is null. Pure. */
export function parseJudge(content: string, n: number): { cards: Array<Verdict | null>; setScore: number | null; setNote: string } {
  const out: Array<Verdict | null> = Array.from({ length: n }, () => null);
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return { cards: out, setScore: null, setNote: "" };
  try {
    const j = JSON.parse(m[0]) as { cards?: Array<Record<string, unknown>>; set?: { score?: unknown; note?: unknown } };
    const score = (x: unknown) => { const k = Number(x); return Number.isInteger(k) && k >= 0 && k <= 3 ? k : null; };
    for (const c of j.cards ?? []) {
      const i = Number(c.i);
      const relevance = score(c.relevance), learnable = score(c.learnable);
      const real = c.realCreator, acc = c.reasonAccurate;
      if (!Number.isInteger(i) || i < 0 || i >= n || relevance === null || learnable === null) continue;
      if (real !== "yes" && real !== "no" && real !== "unsure") continue;
      if (acc !== "yes" && acc !== "partly" && acc !== "no") continue;
      out[i] = { realCreator: real, kind: String(c.kind ?? "unclear").slice(0, 30), relevance, learnable, reasonAccurate: acc, note: String(c.note ?? "").slice(0, 300) };
    }
    return { cards: out, setScore: score(j.set?.score), setNote: String(j.set?.note ?? "").slice(0, 400) };
  } catch {
    return { cards: out, setScore: null, setNote: "" };
  }
}

/** Real public subjects in a lane, from the vendor: never guessed handles. */
export const findSubjects = internalAction({
  args: { platform: platformV, keyword: v.string() },
  handler: async (ctx, a): Promise<Array<{ platform: Platform; handle: string; followers: number | null; bio: string | null; displayName: string | null }>> => {
    const read = async (kind: string, params: Record<string, unknown>) => (await ctx.runAction(internal.reads.read.read, { kind, params })).value;
    if (a.platform === "instagram") {
      return (profilesOf(await read("discover.profiles", { keyword: a.keyword })) ?? []).filter((p) => !p.isPrivate).map((p) => ({ platform: "instagram" as const, handle: p.handle, followers: p.followerCount, bio: p.bio ? clip(p.bio, 120) : null, displayName: p.displayName }));
    }
    const v0 = await read("search.keyword", { keyword: a.keyword, window: "this-month", sort: "most-liked" });
    const arr = (Array.isArray(v0) ? v0 : ((v0 as { posts?: unknown[] } | null)?.posts ?? [])) as Array<{ authorHandle?: string | null }>;
    const handles = [...new Set(arr.map((p) => (p.authorHandle ?? "").toLowerCase()).filter(Boolean))].slice(0, 8);
    const out: Array<{ platform: Platform; handle: string; followers: number | null; bio: string | null; displayName: string | null }> = [];
    for (const h of handles) {
      try {
        const p = (await read("profile", { platform: "tiktok", handle: h })) as { followerCount?: number; bio?: string | null; displayName?: string | null } | null;
        out.push({ platform: "tiktok", handle: h, followers: p?.followerCount ?? null, bio: p?.bio ? clip(p.bio, 120) : null, displayName: p?.displayName ?? null });
      } catch { /* a handle that no longer reads is not a subject */ }
    }
    return out;
  },
});

/** A subject row: the production start path, with the catalogue job retired so only the first read runs. */
export const createSubject = internalMutation({
  args: { label: v.string(), handles: v.object({ tiktok: v.optional(v.string()), instagram: v.optional(v.string()) }), niche: v.string(), timezone: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; creatorId?: Id<"creators">; error?: string }> => {
    const started = await startCreator(ctx, { subject: `eval-quality-${a.label}`, email: `eval-quality-${a.label}@example.com`, handles: a.handles, timezone: a.timezone });
    if (!started.ok || !started.creatorId) return { ok: false, error: started.error };
    const creatorId = started.creatorId as Id<"creators">;
    await ctx.db.patch(creatorId, { niche: a.niche, timezone: a.timezone, updatedAt: Date.now() });
    const job = await ctx.db.query("jobs").withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", `ingest:${creatorId}:v0`)).first();
    if (job && job.status === "queued") await ctx.db.patch(job._id, { status: "dead", lastError: "eval subject: first read only (suggestion quality eval)", updatedAt: Date.now() });
    return { ok: true, creatorId };
  },
});

/** The first read of their posts, exactly as the catalogue's pass one does it. */
export const firstPass = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ posts: number; baseline: number | null }> => {
    const g = await ctx.runQuery(internal.onboarding.suggest.gather, { creatorId: a.creatorId });
    if (!g) throw new Error("no such subject");
    const now = Date.now();
    for (const platform of ["tiktok", "instagram"] as const) {
      const handle = g.handles[platform];
      if (!handle) continue;
      for (const sort of ["popular", "latest"] as const) {
        try {
          const r = await ctx.runAction(internal.reads.read.read, { kind: "account.posts", params: { platform, handle, sort, slot: "onboarding" }, creatorId: a.creatorId });
          await ctx.runMutation(internal.onboarding.ingest.upsertOwnPosts, { creatorId: a.creatorId, posts: Array.isArray(r.value) ? r.value : [], now, handle });
        } catch (e) {
          console.error(`[suggestQuality] ${platform}/${sort} first read failed: ${String(e).slice(0, 160)}`);
        }
      }
    }
    return await ctx.runMutation(internal.onboarding.ingest.computeMultiples, { creatorId: a.creatorId });
  },
});

export const save = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", a.key)).unique();
    if (row) await ctx.db.patch(row._id, { value: a.value, updatedAt: Date.now() });
    else await ctx.db.insert("syncState", { key: a.key, value: a.value, updatedAt: Date.now() });
    return null;
  },
});

export const reports = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ key: string; value: unknown }>> => {
    const rows = await ctx.db.query("syncState").take(2000);
    return rows.filter((r) => r.key.startsWith("eval:suggest_quality:")).map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
  },
});

/** Suggest, then audit every card. */
export const audit = internalAction({
  args: { creatorId: v.id("creators"), label: v.string() },
  handler: async (ctx, a): Promise<{ label: string; cards: number; passed: number; setScore: number | null }> => {
    const g = await ctx.runQuery(internal.onboarding.suggest.gather, { creatorId: a.creatorId });
    if (!g) throw new Error("no such subject");
    const connected = (["tiktok", "instagram"] as const).filter((p) => g.handles[p]);
    const t0 = Date.now();
    const r = await ctx.runAction(internal.onboarding.suggest.suggestFor, { creatorId: a.creatorId, waitMs: 0 });
    const now = Date.now();
    const cards = await Promise.all(r.suggestions.map(async (s) => {
      let exists = false;
      type Prof = { followerCount?: number; verified?: boolean; bio?: string | null; postCount?: number | null } | null;
      let prof: Prof = null;
      try {
        prof = (await ctx.runAction(internal.reads.read.read, { kind: "profile", params: { platform: s.platform, handle: s.handle }, creatorId: a.creatorId })).value as Prof;
        exists = Boolean(prof);
      } catch { exists = false; }
      let posts: CandidatePost[] = [];
      try {
        posts = postsOf((await ctx.runAction(internal.reads.read.read, { kind: "account.posts", params: { platform: s.platform, handle: s.handle, sort: "latest", slot: "onboarding" }, creatorId: a.creatorId })).value);
      } catch { posts = []; }
      const dates = posts.map((p) => p.postedAt).filter((x): x is number => typeof x === "number" && x > 0).map(toMs);
      const last = dates.length ? Math.max(...dates) : null;
      const facts: CardFacts = {
        exists,
        followers: typeof prof?.followerCount === "number" ? prof.followerCount : null,
        verified: typeof prof?.verified === "boolean" ? prof.verified : null,
        bio: prof?.bio ? clip(prof.bio, 160) : null,
        postCount: prof?.postCount ?? null,
        lastPostDaysAgo: last !== null ? Math.round((now - last) / DAY) : null,
        postsRead: posts.length,
        stats: statsFor(posts, now),
        recentPosts: posts.slice(0, 6).map((p) => ({ caption: clip(p.caption.replace(/\s+/g, " ").trim(), 140), views: p.views, daysAgo: p.postedAt ? Math.round((now - toMs(p.postedAt)) / DAY) : null })),
      };
      return { ...s, facts, checks: hardChecks(facts, s.why, s.platform, [...connected]) };
    }));

    const failures: string[] = [];
    let verdicts: Array<Verdict | null> = cards.map(() => null);
    let setScore: number | null = null;
    let setNote = "";
    if (cards.length) {
      const input = JSON.stringify({
        creator: { platforms: connected, sentence: g.niche ?? null, theirBestPosts: g.own.slice(0, 6).map((p) => ({ platform: p.platform, caption: clip(p.caption, 140), timesTheirNormal: p.multiple })) },
        // §27.2: the judge sees the evidence the engine wrote from, not only the newest posts.
        cards: cards.map((c, i) => ({ i, platform: c.platform, handle: c.handle, reasonShown: c.why, followers: c.facts.followers, verified: c.facts.verified, bio: c.facts.bio, lastPostDaysAgo: c.facts.lastPostDaysAgo, stats: { medianViews: c.facts.stats.medianViews, bestRecentTimesTheirNormal: c.facts.stats.bestMultiple, oneRunawayPost: c.facts.stats.runawayPost, postsLast30Days: c.facts.stats.postsLast30 }, topPostsByViews: c.facts.stats.topCaptions, recentPosts: c.facts.recentPosts })),
      });
      for (const model of [REGISTRY.critic.primary, REGISTRY.critic.fallback]) {
        const res = await callModel(ctx, { creatorId: a.creatorId, purpose: "eval_judge", model, messages: [{ role: "system", content: QUALITY_JUDGE }, { role: "user", content: input }], temperature: 0, maxTokens: 2400, timeoutMs: 60_000, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
        if (!res.ok) { failures.push(`judge ${model}: ${res.reason.slice(0, 120)}`); continue; }
        const parsed = parseJudge(res.content, cards.length);
        // §27.2: a judge answer that yields no verdict is a named failure, and the fallback gets its turn.
        if (parsed.cards.every((x) => x === null)) { failures.push(`judge ${model}: no readable verdicts (${res.content.length} chars)`); continue; }
        verdicts = parsed.cards; setScore = parsed.setScore; setNote = parsed.setNote;
        break;
      }
    }
    const rows = cards.map((c, i) => ({ platform: c.platform, handle: c.handle, why: c.why, followers: c.facts.followers, verified: c.facts.verified, lastPostDaysAgo: c.facts.lastPostDaysAgo, postsRead: c.facts.postsRead, bio: c.facts.bio, checks: c.checks, verdict: verdicts[i], pass: cardPasses(c.checks, verdicts[i]) }));
    const passed = rows.filter((x) => x.pass).length;
    const summary = { label: a.label, creatorId: a.creatorId, platforms: connected, sentence: g.niche ?? null, ownPosts: g.ownCount, cards: rows.length, passed, setScore, setNote, trace: r.trace, ms: Date.now() - t0, failures, at: Date.now() };
    await ctx.runMutation(internal.eval.suggestQuality.save, { key: `eval:suggest_quality:${a.label}`, value: JSON.stringify({ summary, rows }) });
    return { label: a.label, cards: rows.length, passed, setScore };
  },
});

/** One subject end to end, off the CLI's connection: the first read, then the audit. */
export const runSubject = internalAction({
  args: { creatorId: v.id("creators"), label: v.string(), skipFirstPass: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<null> => {
    try {
      if (!a.skipFirstPass) await ctx.runAction(internal.eval.suggestQuality.firstPass, { creatorId: a.creatorId });
      await ctx.runAction(internal.eval.suggestQuality.audit, { creatorId: a.creatorId, label: a.label });
    } catch (e) {
      await ctx.runMutation(internal.eval.suggestQuality.save, { key: `eval:suggest_quality:${a.label}`, value: JSON.stringify({ summary: { label: a.label, creatorId: a.creatorId, error: String(e).slice(0, 400), at: Date.now() }, rows: [] }) });
    }
    return null;
  },
});

export const start = internalMutation({
  args: { subjects: v.array(v.object({ creatorId: v.id("creators"), label: v.string(), skipFirstPass: v.optional(v.boolean()) })) },
  handler: async (ctx, a): Promise<{ started: number }> => {
    for (const s of a.subjects) await ctx.scheduler.runAfter(0, internal.eval.suggestQuality.runSubject, s);
    return { started: a.subjects.length };
  },
});
