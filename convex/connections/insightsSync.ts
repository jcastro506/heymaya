import { clip } from "../lib/clip";
/**
 * A1 part 2, the network half: account-level reads for every connected account, into rows.
 * Code watches (law 3): she never calls Zernio; she reads `followerSnapshots` and
 * `accountInsights`.
 *
 *   TikTok, daily      account-insights time series (89 days: count, gained, lost) → followerSnapshots
 *   TikTok, daily (A2) comments on posts with new ones (read only) → postComments; post timelines → ownPosts.history
 *
 * TikTok only: an old Instagram connection is never read.
 *
 * Bounded: an hourly pass takes the stalest 40 creators whose reads are over 20 hours old, four
 * at a time, so every connected creator is read about once a day up to ~900 of them. Fail-soft:
 * one account's failure never stops the pass, the rows it had are kept, and each pass leaves ONE
 * named `vendorHealth` row ("account insights") saying how many failed and the first reason.
 * Only live plans (active, trialing, comped) and only accounts within the plan are read.
 */

import { v } from "convex/values";
import { drillCheck, faultFetch, faultFor, type Fault } from "../eval/faults";
import { internalAction, internalQuery, type ActionCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { accountsWithinPlan, entitlementsFor } from "../billing/tiers";
import { tiktokAccountInsights, zernioClient, type ZernioClient } from "../integrations/zernio/index";
import { syncAccountComments } from "./comments";
import { syncAccountTimelines } from "./timeline";
import { classifyError, flowOver, normalizeFollowerHistory, type FollowerDay, type ReadStatus } from "./accountInsights";

export const INSIGHTS = {
  staleAfterMs: 20 * 3_600_000,
  creatorsPerPass: 40,
  concurrency: 4,
  historyDays: 89,   // the spec's maximum for TikTok account-insights
  insightsDays: 30,
} as const;

const LIVE = new Set(["active", "trialing", "comped"]);
const DAY = 86_400_000;
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

type Account = { accountId: string; platform: "tiktok" };

/** Pure: the accounts of a connection we may read — live plan, within the plan's cap, able and not broken. */
export function readableAccounts(conn: Pick<Doc<"connections">, "provider" | "status" | "zernioAccounts">, plan: { status: string; tier?: string }): Account[] {
  if (conn.provider !== "zernio" || conn.status === "disconnected" || !LIVE.has(plan.status)) return [];
  return accountsWithinPlan(conn.zernioAccounts ?? [], entitlementsFor(plan).accounts)
    .filter((x) => x.canFetchAnalytics && !x.needsReconnect && x.platform === "tiktok")
    .map((x) => ({ accountId: x.accountId, platform: "tiktok" as const }));
}

const lastTry = (r: Doc<"accountInsights"> | undefined) => (r ? Math.max(r.fetchedAt, r.attemptedAt ?? 0) : 0);

export const DUE_PAGE = 200;

/**
 * Who is due, one page of Zernio connections at a time (S0 fleet scale: a `take(1000)` silently
 * dropped every connection after the thousandth). The action walks the pages and keeps the stalest.
 */
export const duePage = internalQuery({
  args: { now: v.number(), cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ due: Array<{ creatorId: Id<"creators">; oldest: number }>; isDone: boolean; continueCursor: string }> => {
    const res = await ctx.db.query("connections").withIndex("by_provider", (q) => q.eq("provider", "zernio")).paginate({ cursor: a.cursor, numItems: Math.min(a.numItems ?? DUE_PAGE, 500) });
    const conns = (res.page as Doc<"connections">[]).filter((c) => c.status !== "disconnected");
    const out: Array<{ creatorId: Id<"creators">; oldest: number }> = [];
    for (const conn of conns) {
      const creator = (await ctx.db.get(conn.creatorId)) as Doc<"creators"> | null;
      if (!creator) continue;
      const accounts = readableAccounts(conn, creator.plan);
      if (!accounts.length) continue;
      const rows = (await ctx.db.query("accountInsights").withIndex("by_creator_kind", (q) => q.eq("creatorId", conn.creatorId).eq("kind", "insights")).take(20)) as Doc<"accountInsights">[];
      const oldest = Math.min(...accounts.map((acc) => lastTry(rows.find((r) => r.accountId === acc.accountId))));
      if (oldest <= a.now - INSIGHTS.staleAfterMs) out.push({ creatorId: conn.creatorId, oldest });
    }
    return { due: out, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/** Every page, then the stalest `limit`. Bounded by the page count, never by a silent cap. */
export async function dueCreators(ctx: Pick<ActionCtx, "runQuery">, now: number, limit: number = INSIGHTS.creatorsPerPass): Promise<Id<"creators">[]> {
  const all: Array<{ creatorId: Id<"creators">; oldest: number }> = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 500; pages++) {
    const r: { due: Array<{ creatorId: Id<"creators">; oldest: number }>; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.connections.insightsSync.duePage, { now, cursor });
    all.push(...r.due);
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return all.sort((x, y) => x.oldest - y.oldest).slice(0, limit).map((x) => x.creatorId);
}

/** One creator's readable accounts. */
export const state = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Account[]> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
    if (!creator || !conn) return [];
    return readableAccounts(conn, creator.plan);
  },
});

const dayArg = v.object({ day: v.string(), followers: v.union(v.number(), v.null()), gained: v.union(v.number(), v.null()), lost: v.union(v.number(), v.null()) });

/**
 * Follower days onto `followerSnapshots`, one row per account per day, idempotent. A day's count
 * is only written where the platform gave one; gained/lost patch an existing day even without a
 * count; a new row's `at` is that day (so "30 days ago" means the day, not the fetch).
 */
export const writeHistory = internalMutation({
  args: { creatorId: v.id("creators"), platform: v.string(), accountId: v.string(), days: v.array(dayArg), now: v.number() },
  handler: async (ctx, a): Promise<{ inserted: number; patched: number }> => {
    let inserted = 0, patched = 0;
    for (const d of a.days.slice(-120)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.day)) continue;
      const existing = ((await ctx.db.query("followerSnapshots").withIndex("by_creator_day", (q) => q.eq("creatorId", a.creatorId).eq("day", d.day)).collect()) as Doc<"followerSnapshots">[]).find((r) => r.accountId === a.accountId);
      const flow = { ...(d.gained !== null ? { gained: d.gained } : {}), ...(d.lost !== null ? { lost: d.lost } : {}) };
      if (existing) {
        // The daily follower-stats read is "now"; history is Zernio's end-of-day snapshot. Keep a same-day live count.
        const patch = { ...flow, ...(d.followers !== null && d.day !== dayOf(a.now) ? { followers: d.followers } : {}) };
        if (Object.keys(patch).length) { await ctx.db.patch(existing._id, patch); patched++; }
      } else if (d.followers !== null) {
        await ctx.db.insert("followerSnapshots", { creatorId: a.creatorId, platform: a.platform, accountId: a.accountId, day: d.day, followers: d.followers, at: Math.min(a.now, Date.parse(`${d.day}T23:59:59Z`)), ...flow });
        inserted++;
      }
    }
    return { inserted, patched };
  },
});

const sliceArr = v.array(v.object({ label: v.string(), value: v.number(), share: v.union(v.number(), v.null()) }));

/** Latest-only: one row per creator, account and kind. `status: failed` touches only the attempt time. */
export const writeInsights = internalMutation({
  args: {
    creatorId: v.id("creators"), platform: v.string(), accountId: v.string(), kind: v.union(v.literal("insights"), v.literal("audience"), v.literal("engaged"), v.literal("comments")), now: v.number(),
    status: v.union(v.literal("ok"), v.literal("not_reported"), v.literal("too_few_followers"), v.literal("not_available"), v.literal("failed")),
    fromDate: v.optional(v.string()), toDate: v.optional(v.string()),
    metrics: v.optional(v.record(v.string(), v.number())),
    reachDaily: v.optional(v.array(v.object({ date: v.string(), value: v.number() }))),
    audience: v.optional(v.object({ age: v.optional(sliceArr), gender: v.optional(sliceArr), country: v.optional(sliceArr), city: v.optional(sliceArr) })),
    audienceBase: v.optional(v.number()),
    unavailable: v.optional(v.array(v.string())),
  },
  handler: async (ctx, a): Promise<null> => {
    const existing = ((await ctx.db.query("accountInsights").withIndex("by_creator_kind", (q) => q.eq("creatorId", a.creatorId).eq("kind", a.kind)).take(20)) as Doc<"accountInsights">[]).find((r) => r.accountId === a.accountId);
    if (a.status === "failed") {
      // A failed read keeps what we had (still true, and dated) and only moves the retry clock.
      if (existing) await ctx.db.patch(existing._id, { attemptedAt: a.now });
      else await ctx.db.insert("accountInsights", { creatorId: a.creatorId, platform: a.platform, accountId: a.accountId, kind: a.kind, status: "not_reported", fetchedAt: 0, attemptedAt: a.now });
      return null;
    }
    const optional = { fromDate: a.fromDate, toDate: a.toDate, metrics: a.metrics, reachDaily: a.reachDaily, audience: a.audience, audienceBase: a.audienceBase, unavailable: a.unavailable };
    const row = {
      creatorId: a.creatorId, platform: a.platform, accountId: a.accountId, kind: a.kind, status: a.status, fetchedAt: a.now, attemptedAt: a.now,
      ...Object.fromEntries(Object.entries(optional).filter(([, x]) => x !== undefined)),
    } as Omit<Doc<"accountInsights">, "_id" | "_creationTime">;
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("accountInsights", row);
    return null;
  },
});

// ------------------------------------------------------------------ the reads

const nonNull = (m: Record<string, number | null>): Record<string, number> => Object.fromEntries(Object.entries(m).filter((e): e is [string, number] => e[1] !== null));

async function attempt(read: () => Promise<unknown>): Promise<{ raw: unknown; status: ReadStatus; detail?: string }> {
  try {
    return { raw: await read(), status: "ok" };
  } catch (e) {
    return { raw: null, status: classifyError(e), detail: e instanceof Error ? clip(e.message, 160) : "read failed" };
  }
}

/** One account's history into snapshots, returning the days for the totals. */
async function history(ctx: ActionCtx, c: ZernioClient, creatorId: Id<"creators">, acc: Account, now: number): Promise<{ status: ReadStatus; days: FollowerDay[]; unavailable: string[]; detail?: string }> {
  const q = { accountId: acc.accountId, fromDate: dayOf(now - (INSIGHTS.historyDays - 1) * DAY), toDate: dayOf(now), metrics: ["follower_count", "followers_gained", "followers_lost"], metricType: "time_series" as const };
  const r = await attempt(() => tiktokAccountInsights(c, q));
  if (r.status !== "ok") return { status: r.status, days: [], unavailable: [], detail: r.detail };
  const h = normalizeFollowerHistory(r.raw);
  if (!h) return { status: "failed", days: [], unavailable: [], detail: "follower history was not the expected shape" };
  if (h.days.length) await ctx.runMutation(internal.connections.insightsSync.writeHistory, { creatorId, platform: acc.platform, accountId: acc.accountId, days: h.days, now });
  return { status: h.days.length ? "ok" : "not_reported", days: h.days, unavailable: h.unavailable };
}

/** Every read for one account. Returns the failures, named, for the pass's one health row. */
async function syncAccount(ctx: ActionCtx, c: ZernioClient, creatorId: Id<"creators">, acc: Account, now: number): Promise<string[]> {
  const failures: string[] = [];
  const base = { creatorId, platform: acc.platform, accountId: acc.accountId, now };
  const h = await history(ctx, c, creatorId, acc, now);
  if (h.status === "failed") failures.push(`${acc.platform} history: ${h.detail}`);

  // A2: comments on their recent posts (read only) and how their views arrived.
  const cm = await syncAccountComments(ctx, c, creatorId, acc, now, classifyError);
  if (cm.status === "failed") failures.push(`${acc.platform} comments: ${cm.detail}`);
  await ctx.runMutation(internal.connections.insightsSync.writeInsights, { ...base, kind: "comments", status: cm.status === "ok" ? "ok" : cm.status, ...(cm.status === "ok" ? { metrics: { postsRead: cm.posts, commentsRead: cm.read } } : {}) });
  const tl = await syncAccountTimelines(ctx, c, creatorId, acc, now, classifyError);
  if (tl.failure) failures.push(`${acc.platform} timeline: ${tl.failure}`);

  // TikTok's account endpoint has nothing else at account level (no reach, no demographics, per the spec).
  const flow = flowOver(h.days, INSIGHTS.insightsDays, dayOf(now));
  const metrics = nonNull({ followersGained: flow.gained, followersLost: flow.lost });
  const status: ReadStatus = h.status === "ok" && Object.keys(metrics).length ? "ok" : h.status === "ok" ? "not_reported" : h.status;
  await ctx.runMutation(internal.connections.insightsSync.writeInsights, { ...base, kind: "insights", status, fromDate: dayOf(now - (INSIGHTS.insightsDays - 1) * DAY), toDate: dayOf(now), metrics, unavailable: h.unavailable });
  return failures;
}

async function syncCreatorWith(ctx: ActionCtx, c: ZernioClient, creatorId: Id<"creators">, now: number): Promise<{ accounts: number; failures: string[] }> {
  const accounts = await ctx.runQuery(internal.connections.insightsSync.state, { creatorId });
  const failures: string[] = [];
  for (const acc of accounts) {
    try {
      failures.push(...(await syncAccount(ctx, c, creatorId, acc, now)));
    } catch (e) {
      failures.push(`${acc.platform}: ${e instanceof Error ? clip(e.message, 160) : "failed"}`);
    }
  }
  return { accounts: accounts.length, failures };
}

async function recordPass(ctx: ActionCtx, creators: number, accounts: number, failures: string[], fault: Fault | null = null): Promise<void> {
  if (creators === 0) return;
  const detail = failures.length ? `${failures.length} read${failures.length === 1 ? "" : "s"} failed across ${accounts} accounts; first: ${failures[0]}` : `${accounts} accounts across ${creators} creators`;
  await ctx.runMutation(internal.connections.zernio.recordHealth, { check: drillCheck("account insights", fault), ok: failures.length === 0, detail: clip(detail, 300) });
}

/** The hourly pass (via core/timedJobs): the stalest due creators, a few at a time. Never throws for one account. */
export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ creators: number; accounts: number; failed: number }> => {
    const now = Date.now();
    const ids = await dueCreators(ctx, now);
    if (!ids.length) return { creators: 0, accounts: 0, failed: 0 };
    let c: ZernioClient;
    try {
      c = zernioClient(process.env.ZERNIO_API_KEY ?? "");
    } catch (e) {
      await recordPass(ctx, ids.length, 0, [e instanceof Error ? e.message : "no client"]);
      return { creators: ids.length, accounts: 0, failed: 1 };
    }
    let accounts = 0;
    const failures: string[] = [];
    for (let i = 0; i < ids.length; i += INSIGHTS.concurrency) {
      const results = await Promise.all(ids.slice(i, i + INSIGHTS.concurrency).map((id) => syncCreatorWith(ctx, c, id, now).catch((e) => ({ accounts: 0, failures: [`creator: ${e instanceof Error ? clip(e.message, 160) : "failed"}`] }))));
      for (const r of results) { accounts += r.accounts; failures.push(...r.failures); }
    }
    await recordPass(ctx, ids.length, accounts, failures);
    return { creators: ids.length, accounts, failed: failures.length };
  },
});

/** Once on connect (scheduled next to the post backfill), so the cards fill the same day. */
export const syncCreator = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ accounts: number; failed: number }> => {
    // Outage drill (eval/faults.ts): Zernio failing for this eval creator. Null in production.
    const fault = await faultFor(ctx, a.creatorId, "zernio");
    let c: ZernioClient;
    try {
      c = fault ? zernioClient("fault-injected", faultFetch(fault)) : zernioClient(process.env.ZERNIO_API_KEY ?? "");
    } catch (e) {
      await recordPass(ctx, 1, 0, [e instanceof Error ? e.message : "no client"], fault);
      return { accounts: 0, failed: 1 };
    }
    const r = await syncCreatorWith(ctx, c, a.creatorId, Date.now());
    await recordPass(ctx, 1, r.accounts, r.failures, fault);
    return { accounts: r.accounts, failed: r.failures.length };
  },
});
