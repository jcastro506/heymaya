/**
 * The 1,000-creator test, on real vendors and real models (operator, 2026-09-24): "can we test Maya
 * being used by 1000 plus users, all asking her to watch things, and making ScrapeCreators calls".
 *
 * Stages, each measured before the next: seed N load creators across 24 zones and 20 lanes (TikTok,
 * Instagram and both) → each texts Maya 2 "watch @x" requests through the SAME path a phone takes
 * (inbound row → converse job → queue → classifier → addTracked) → the fleet sampler reads every
 * distinct watched account (TikTok AND Instagram) → the scout runs for everyone due.
 * What it proves: the queue drains without starving anyone or breaking "one turn at a time per
 * creator"; vendor spend scales with DISTINCT accounts (the shared cache), not with users; nothing
 * fails silently; what it costs.
 *
 * Load creators are `eval-load:` (fleet jobs include them like real users; their texts are never
 * delivered). A hard credit ceiling stops the vendor stages. `loadTest:clear` removes them.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { LOAD_PREFIX } from "./loadTest";

const POOL_KEY = "scale:pool";
const RUN_KEY = (runId: string) => `scale:${runId}`;
export const CREDIT_CEILING = 2500;

const LANES: Array<{ niche: string; keywords: string[]; platforms: Array<"tiktok" | "instagram"> }> = [
  { niche: "running", keywords: ["running", "marathon training"], platforms: ["tiktok", "instagram"] },
  { niche: "meal prep", keywords: ["meal prep", "high protein"], platforms: ["tiktok", "instagram"] },
  { niche: "solo travel", keywords: ["solo travel", "travel vlog"], platforms: ["instagram"] },
  { niche: "personal finance", keywords: ["personal finance", "budgeting"], platforms: ["tiktok"] },
  { niche: "home workouts", keywords: ["home workout", "fitness over 40"], platforms: ["instagram"] },
  { niche: "skincare", keywords: ["skincare routine", "skincare"], platforms: ["tiktok", "instagram"] },
  { niche: "cooking", keywords: ["easy dinner", "recipes"], platforms: ["tiktok"] },
  { niche: "plants", keywords: ["houseplants", "plant care"], platforms: ["instagram"] },
  { niche: "books", keywords: ["booktok", "book recommendations"], platforms: ["tiktok"] },
  { niche: "coffee", keywords: ["coffee", "latte art"], platforms: ["tiktok", "instagram"] },
  { niche: "photography", keywords: ["photography tips", "street photography"], platforms: ["instagram"] },
  { niche: "dogs", keywords: ["dog training", "dogs"], platforms: ["tiktok", "instagram"] },
  { niche: "tech", keywords: ["tech tips", "iphone tips"], platforms: ["tiktok"] },
  { niche: "fashion", keywords: ["outfit ideas", "thrifting"], platforms: ["tiktok", "instagram"] },
  { niche: "gardening", keywords: ["gardening", "vegetable garden"], platforms: ["instagram"] },
  { niche: "gaming", keywords: ["gaming", "nintendo"], platforms: ["tiktok"] },
  { niche: "yoga", keywords: ["yoga", "mobility"], platforms: ["instagram"] },
  { niche: "baking", keywords: ["baking", "sourdough"], platforms: ["tiktok", "instagram"] },
  { niche: "parenting", keywords: ["mom life", "parenting tips"], platforms: ["tiktok", "instagram"] },
  { niche: "cars", keywords: ["car detailing", "cars"], platforms: ["tiktok"] },
];
const ZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Athens", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Tokyo", "Australia/Brisbane", "Australia/Sydney", "Pacific/Auckland", "Pacific/Honolulu", "America/Anchorage", "Atlantic/Azores", "Europe/Moscow", "Asia/Karachi", "Asia/Dhaka", "Asia/Shanghai", "Pacific/Noumea", "Pacific/Tongatapu"];

type PoolEntry = { platform: "tiktok" | "instagram"; handle: string; lane: string };

/** Pure: a skewed pick (popular accounts are watched by many, the long tail by few), deterministic. */
export function skewedPick<T>(xs: T[], i: number, k: number): T {
  const r = ((i * 2654435761 + k * 40503) >>> 0) / 4294967296;
  return xs[Math.min(xs.length - 1, Math.floor(xs.length * r * r))];
}

// ------------------------------------------------------------------ the pool of real accounts

/** Real creators to watch: TikTok from the creator-discovery list, Instagram from Reels search on each lane keyword. */
export const buildPool = internalAction({
  args: {},
  handler: async (ctx): Promise<{ tiktok: number; instagram: number }> => {
    const pool: PoolEntry[] = [];
    const seen = new Set<string>();
    const add = (platform: "tiktok" | "instagram", handle: string | null | undefined, lane: string) => {
      const h = (handle ?? "").replace(/^@/, "").toLowerCase().trim();
      if (!h || seen.has(`${platform}:${h}`)) return;
      seen.add(`${platform}:${h}`);
      pool.push({ platform, handle: h, lane });
    };
    for (const lane of LANES) {
      for (const kw of lane.keywords.slice(0, 1)) {
        if (lane.platforms.includes("instagram")) {
          try {
            const r = await ctx.runAction(internal.reads.read.read, { kind: "search.reels", params: { keyword: kw, window: "last-month" } });
            const posts = (Array.isArray(r.value) ? r.value : ((r.value as { posts?: unknown[] } | null)?.posts ?? [])) as Array<{ authorHandle?: string; author?: string }>;
            for (const p of posts.slice(0, 15)) add("instagram", p.authorHandle ?? p.author, lane.niche);
          } catch { /* a lane with no reels read is simply thinner */ }
        }
        if (lane.platforms.includes("tiktok")) {
          try {
            const r = await ctx.runAction(internal.reads.read.read, { kind: "search.keyword", params: { keyword: kw, window: "this-month", sort: "most-liked" } });
            const posts = (Array.isArray(r.value) ? r.value : ((r.value as { posts?: unknown[] } | null)?.posts ?? [])) as Array<{ authorHandle?: string }>;
            for (const p of posts.slice(0, 15)) add("tiktok", p.authorHandle, lane.niche);
          } catch { /* same */ }
        }
      }
    }
    await ctx.runMutation(internal.eval.scaleTest.saveKey, { key: POOL_KEY, value: pool });
    return { tiktok: pool.filter((p) => p.platform === "tiktok").length, instagram: pool.filter((p) => p.platform === "instagram").length };
  },
});

export const saveKey = internalMutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, a): Promise<null> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", a.key)).unique();
    const json = JSON.stringify(a.value);
    if (row) await ctx.db.patch(row._id, { value: json, updatedAt: Date.now() });
    else await ctx.db.insert("syncState", { key: a.key, value: json, updatedAt: Date.now() });
    return null;
  },
});

export const readKey = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, a): Promise<unknown> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", a.key)).unique();
    return row ? JSON.parse(row.value) : null;
  },
});

// ------------------------------------------------------------------ creators and their asks

/** N creators across zones and lanes; handles on the platforms their lane lives on. */
export const seed = internalMutation({
  args: { from: v.number(), count: v.number() },
  handler: async (ctx, a): Promise<number> => {
    const now = Date.now();
    for (let i = a.from; i < a.from + a.count; i++) {
      const lane = LANES[i % LANES.length];
      const handles: Record<string, string> = {};
      for (const p of lane.platforms) handles[p] = `scale_${p === "tiktok" ? "tt" : "ig"}_${i}`;
      await ctx.db.insert("creators", {
        clerkUserId: `${LOAD_PREFIX}${i}`, email: `load-${i}@eval.invalid`, handles, ownership: "unverified",
        niche: lane.niche, timezone: ZONES[i % ZONES.length], quietHours: { start: "22:00", end: "07:00" }, tone: "friend", mode: "full",
        dossier: { persona: `${lane.niche} creator (load test)`, voice: "plain", keywords: lane.keywords, lane: lane.niche },
        dossierVersion: 1, notes: [], affinities: [], experiments: [],
        channel: { paired: true, pairedAt: now, kind: "telegram" }, plan: { status: "active", founding: false, tier: "solo" },
        createdAt: now, updatedAt: now,
      } as never);
    }
    return a.count;
  },
});

export const loadCreators = internalQuery({
  args: { from: v.number(), count: v.number() },
  handler: async (ctx, a): Promise<Array<{ id: Id<"creators">; i: number; platforms: string[]; niche: string }>> => {
    const out: Array<{ id: Id<"creators">; i: number; platforms: string[]; niche: string }> = [];
    for (let i = a.from; i < a.from + a.count; i++) {
      const c = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", `${LOAD_PREFIX}${i}`)).first()) as Doc<"creators"> | null;
      if (c) out.push({ id: c._id, i, platforms: Object.keys(c.handles).filter((k) => (c.handles as Record<string, string | undefined>)[k]), niche: c.niche ?? "" });
    }
    return out;
  },
});

/** Pure: how a real person asks. Instagram asks say so ("on insta"); TikTok is the default. */
export function askText(e: PoolEntry, i: number): string {
  const ig = e.platform === "instagram";
  const forms = ig
    ? [`watch @${e.handle} on insta`, `can you keep an eye on @${e.handle} on instagram for me`, `add @${e.handle} (instagram) to my list`]
    : [`watch @${e.handle}`, `can you keep an eye on @${e.handle} for me`, `add @${e.handle} to my list`];
  return forms[i % forms.length];
}

/** Each creator texts two "watch" requests from the pool (their lane first, skewed toward popular accounts). */
export const ask = internalMutation({
  args: { runId: v.string(), creators: v.array(v.object({ id: v.id("creators"), i: v.number(), platforms: v.array(v.string()), niche: v.string() })), perCreator: v.number(), pool: v.any() },
  handler: async (ctx, a): Promise<number> => {
    const pool = a.pool as PoolEntry[];
    let n = 0;
    for (const c of a.creators) {
      const cr = (await ctx.db.get(c.id)) as Doc<"creators"> | null;
      if (!cr?.clerkUserId.startsWith(LOAD_PREFIX)) continue;
      const mine = pool.filter((p) => c.platforms.includes(p.platform) && p.lane === c.niche);
      const any = pool.filter((p) => c.platforms.includes(p.platform));
      for (let k = 0; k < a.perCreator; k++) {
        const src = mine.length >= 3 && k === 0 ? mine : any;
        if (!src.length) continue;
        const e = skewedPick(src, c.i, k);
        const messageId = await ctx.db.insert("messages", { creatorId: c.id, direction: "in", surface: "telegram", body: askText(e, c.i + k), ts: Date.now(), kind: "inbound" } as never);
        await ctx.runMutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: `converse:${messageId}`, creatorId: c.id, payloadJson: JSON.stringify({ messageId }) });
        n++;
      }
    }
    return n;
  },
});

// ------------------------------------------------------------------ measuring

export const measure = internalQuery({
  args: { from: v.number(), count: v.number(), since: v.number() },
  handler: async (ctx, a): Promise<Record<string, unknown>> => {
    let asks = 0, replies = 0, tracked = 0, trackedIg = 0, watchingReplies = 0, refusals = 0;
    const lat: number[] = [];
    let usd = 0;
    for (let i = a.from; i < a.from + a.count; i++) {
      const c = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", `${LOAD_PREFIX}${i}`)).first()) as Doc<"creators"> | null;
      if (!c) continue;
      const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id).gte("ts", a.since)).take(50)) as Doc<"messages">[];
      const ins = msgs.filter((m) => m.direction === "in");
      asks += ins.length;
      for (const m of ins) {
        const r = msgs.find((o) => o.direction === "out" && (o.dedupeKey ?? "").includes(String(m._id)));
        if (r) { replies++; lat.push(r.ts - m.ts); if (/^watching @/.test(r.body)) watchingReplies++; else refusals++; }
      }
      const t = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).take(20)) as Doc<"trackedAccounts">[];
      tracked += t.length; trackedIg += t.filter((x) => x.platform === "instagram").length;
      const costs = (await ctx.db.query("costEvents").filter((q) => q.eq(q.field("creatorId"), c._id)).take(200)) as Array<{ costUsd?: number }>;
      usd += costs.reduce((s, x) => s + (x.costUsd ?? 0), 0);
    }
    lat.sort((x, y) => x - y);
    const q = (p: number) => (lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] / 1000) : null);
    return { asks, replies, watchingReplies, otherReplies: refusals, tracked, trackedInstagram: trackedIg, latencySec: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1) }, modelAndVendorUsd: Math.round(usd * 100) / 100 };
  },
});

export const queueState = internalQuery({
  args: {},
  handler: async (ctx): Promise<Record<string, unknown>> => {
    const queued = await ctx.db.query("jobs").withIndex("by_status_and_runAfter", (q) => q.eq("status", "queued")).take(3000);
    const running = await ctx.db.query("jobs").withIndex("by_status_and_runAfter", (q) => q.eq("status", "running")).take(3000);
    const failed = (await ctx.db.query("jobs").withIndex("by_status_and_runAfter", (q) => q.eq("status", "failed")).order("desc").take(200)) as Doc<"jobs">[];
    // "One turn at a time per creator": more than one converse running for one creator is a violation.
    const perCreator = new Map<string, number>();
    for (const r of running as Doc<"jobs">[]) if (r.kind === "converse" && r.creatorId) perCreator.set(r.creatorId, (perCreator.get(r.creatorId) ?? 0) + 1);
    const errors = new Map<string, number>();
    for (const f of failed) { const k = String((f as { lastError?: string; error?: string }).lastError ?? (f as { error?: string }).error ?? "?").slice(0, 90); errors.set(k, (errors.get(k) ?? 0) + 1); }
    return { queued: queued.length, running: running.length, runningConverse: (running as Doc<"jobs">[]).filter((r) => r.kind === "converse").length, serialViolations: [...perCreator.values()].filter((n) => n > 1).length, recentFailed: failed.length, failureKinds: Object.fromEntries(errors) };
  },
});

// ------------------------------------------------------------------ the stages

/** One stage: seed [from, from+count), then everyone asks. Measure with `measure` + `queueState`. */
export const stage = internalAction({
  args: { runId: v.string(), from: v.number(), count: v.number(), perCreator: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ seeded: number; asks: number; startedAt: number }> => {
    const pool = (await ctx.runQuery(internal.eval.scaleTest.readKey, { key: POOL_KEY })) as PoolEntry[] | null;
    if (!pool?.length) throw new Error("build the pool first (buildPool)");
    const startedAt = Date.now();
    for (let f = a.from; f < a.from + a.count; f += 100) await ctx.runMutation(internal.eval.scaleTest.seed, { from: f, count: Math.min(100, a.from + a.count - f) });
    let asks = 0;
    for (let f = a.from; f < a.from + a.count; f += 50) {
      const creators = await ctx.runQuery(internal.eval.scaleTest.loadCreators, { from: f, count: Math.min(50, a.from + a.count - f) });
      asks += await ctx.runMutation(internal.eval.scaleTest.ask, { runId: a.runId, creators, perCreator: a.perCreator ?? 2, pool });
    }
    await ctx.scheduler.runAfter(0, internal.core.scheduler.drainJobs, {});
    await ctx.runMutation(internal.eval.scaleTest.saveKey, { key: RUN_KEY(`${a.runId}:${a.from}`), value: { from: a.from, count: a.count, startedAt, asks } });
    return { seeded: a.count, asks, startedAt };
  },
});

/** The vendor stage: the fleet sampler over every distinct watched account, measured in credits. */
export const sampleFleet = internalAction({
  args: { creditsAtStart: v.number() },
  handler: async (ctx, a): Promise<Record<string, unknown>> => {
    const before = await creditsNow(ctx);
    if (a.creditsAtStart - before > CREDIT_CEILING) return { skipped: `credit ceiling reached (${a.creditsAtStart - before} used)` };
    const started = Date.now();
    const r = await ctx.runAction(internal.scout.sampler.run, {});
    const after = await creditsNow(ctx);
    return { ...r, seconds: Math.round((Date.now() - started) / 1000), creditsUsed: before - after, creditsLeft: after };
  },
});

async function creditsNow(ctx: { runAction: (f: never, a: never) => Promise<unknown> }): Promise<number> {
  const r = (await ctx.runAction(internal.reads.read.read as never, { kind: "vendor.credits", params: {}, force: true } as never)) as { value?: { credits?: number } };
  return r.value?.credits ?? 0;
}

export const credits = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => await creditsNow(ctx as never),
});
