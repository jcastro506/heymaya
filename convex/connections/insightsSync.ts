/**
 * A1 part 2, the network half: account-level reads for every connected account, into rows.
 * Code watches (law 3): she never calls Zernio; she reads `followerSnapshots` and
 * `accountInsights`.
 *
 *   Instagram, daily   follower-history (89 days: count, gained, lost) → followerSnapshots
 *                      account-insights, last 30 days: totals, the follows split, reach per day
 *   Instagram, weekly  demographics (only at 100+ followers; under that, said, not called)
 *   TikTok, daily      account-insights time series (89 days: count, gained, lost) → followerSnapshots
 *
 * Bounded: an hourly pass takes the stalest 40 creators whose reads are over 20 hours old, four
 * at a time, so every connected creator is read about once a day up to ~900 of them. Fail-soft:
 * one account's failure never stops the pass, the rows it had are kept, and each pass leaves ONE
 * named `vendorHealth` row ("account insights") saying how many failed and the first reason.
 * Only live plans (active, trialing, comped) and only accounts within the plan are read.
 */

import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { accountsWithinPlan, entitlementsFor } from "../billing/tiers";
import { instagramAccountInsights, instagramDemographics, instagramFollowerHistory, tiktokAccountInsights, zernioClient, type ZernioClient } from "../integrations/zernio/index";
import { classifyError, flowOver, IG_TOTAL_METRICS, normalizeDemographics, normalizeFollowerHistory, normalizeIgInsights, type FollowerDay, type ReadStatus } from "./accountInsights";

export const INSIGHTS = {
  staleAfterMs: 20 * 3_600_000,
  audienceEveryMs: 7 * 86_400_000,
  creatorsPerPass: 40,
  concurrency: 4,
  historyDays: 89,   // the spec's maximum for follower-history and TikTok account-insights
  insightsDays: 30,
  audienceMinFollowers: 100,
} as const;

const LIVE = new Set(["active", "trialing", "comped"]);
const DAY = 86_400_000;
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

type Account = { accountId: string; platform: "tiktok" | "instagram" };

/** Pure: the accounts of a connection we may read — live plan, within the plan's cap, able and not broken. */
export function readableAccounts(conn: Pick<Doc<"connections">, "provider" | "status" | "zernioAccounts">, plan: { status: string; tier?: string }): Account[] {
  if (conn.provider !== "zernio" || conn.status === "disconnected" || !LIVE.has(plan.status)) return [];
  return accountsWithinPlan(conn.zernioAccounts ?? [], entitlementsFor(plan).accounts)
    .filter((x) => x.canFetchAnalytics && !x.needsReconnect && (x.platform === "tiktok" || x.platform === "instagram"))
    .map((x) => ({ accountId: x.accountId, platform: x.platform }));
}

const lastTry = (r: Doc<"accountInsights"> | undefined) => (r ? Math.max(r.fetchedAt, r.attemptedAt ?? 0) : 0);

/** Who is due, stalest first, bounded. */
export const due = internalQuery({
  args: { now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, a): Promise<Id<"creators">[]> => {
    const conns = ((await ctx.db.query("connections").take(1000)) as Doc<"connections">[]).filter((c) => c.provider === "zernio" && c.status !== "disconnected");
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
    return out.sort((x, y) => x.oldest - y.oldest).slice(0, a.limit ?? INSIGHTS.creatorsPerPass).map((x) => x.creatorId);
  },
});

/** One creator's readable accounts, and what is already stored for each. */
export const state = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<Account & { audienceTriedAt: number; latestFollowers: number | null }>> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
    if (!creator || !conn) return [];
    const audience = (await ctx.db.query("accountInsights").withIndex("by_creator_kind", (q) => q.eq("creatorId", a.creatorId).eq("kind", "audience")).take(20)) as Doc<"accountInsights">[];
    const snaps = (await ctx.db.query("followerSnapshots").withIndex("by_creator_day", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(20)) as Doc<"followerSnapshots">[];
    return readableAccounts(conn, creator.plan).map((acc) => ({
      ...acc,
      audienceTriedAt: lastTry(audience.find((r) => r.accountId === acc.accountId)),
      latestFollowers: snaps.find((s) => s.accountId === acc.accountId)?.followers ?? null,
    }));
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
    creatorId: v.id("creators"), platform: v.string(), accountId: v.string(), kind: v.union(v.literal("insights"), v.literal("audience")), now: v.number(),
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
    return { raw: null, status: classifyError(e), detail: e instanceof Error ? e.message.slice(0, 160) : "read failed" };
  }
}

/** One account's history into snapshots, returning the days for the totals. */
async function history(ctx: ActionCtx, c: ZernioClient, creatorId: Id<"creators">, acc: Account, now: number): Promise<{ status: ReadStatus; days: FollowerDay[]; unavailable: string[]; detail?: string }> {
  const q = { accountId: acc.accountId, fromDate: dayOf(now - (INSIGHTS.historyDays - 1) * DAY), toDate: dayOf(now), metrics: ["follower_count", "followers_gained", "followers_lost"], metricType: "time_series" as const };
  const r = await attempt(() => (acc.platform === "instagram" ? instagramFollowerHistory(c, q) : tiktokAccountInsights(c, q)));
  if (r.status !== "ok") return { status: r.status, days: [], unavailable: [], detail: r.detail };
  const h = normalizeFollowerHistory(r.raw);
  if (!h) return { status: "failed", days: [], unavailable: [], detail: "follower history was not the expected shape" };
  if (h.days.length) await ctx.runMutation(internal.connections.insightsSync.writeHistory, { creatorId, platform: acc.platform, accountId: acc.accountId, days: h.days, now });
  return { status: h.days.length ? "ok" : "not_reported", days: h.days, unavailable: h.unavailable };
}

/** Every read for one account. Returns the failures, named, for the pass's one health row. */
async function syncAccount(ctx: ActionCtx, c: ZernioClient, creatorId: Id<"creators">, acc: Account & { audienceTriedAt: number; latestFollowers: number | null }, now: number): Promise<string[]> {
  const failures: string[] = [];
  const base = { creatorId, platform: acc.platform, accountId: acc.accountId, now };
  const h = await history(ctx, c, creatorId, acc, now);
  if (h.status === "failed") failures.push(`${acc.platform} history: ${h.detail}`);

  if (acc.platform === "tiktok") {
    // TikTok's account endpoint has nothing else at account level (no reach, no demographics, per the spec).
    const flow = flowOver(h.days, INSIGHTS.insightsDays, dayOf(now));
    const metrics = nonNull({ followersGained: flow.gained, followersLost: flow.lost });
    const status: ReadStatus = h.status === "ok" && Object.keys(metrics).length ? "ok" : h.status === "ok" ? "not_reported" : h.status;
    await ctx.runMutation(internal.connections.insightsSync.writeInsights, { ...base, kind: "insights", status, fromDate: dayOf(now - (INSIGHTS.insightsDays - 1) * DAY), toDate: dayOf(now), metrics, unavailable: h.unavailable });
    return failures;
  }

  // Instagram: three reads for the last 30 days. Breakdowns and time series can't share a call (spec).
  const range = { accountId: acc.accountId, fromDate: dayOf(now - (INSIGHTS.insightsDays - 1) * DAY), toDate: dayOf(now) };
  const totals = await attempt(() => instagramAccountInsights(c, { ...range, metrics: IG_TOTAL_METRICS, metricType: "total_value" }));
  const follows = await attempt(() => instagramAccountInsights(c, { ...range, metrics: ["follows_and_unfollows"], metricType: "total_value", breakdown: "follow_type" }));
  const reach = await attempt(() => instagramAccountInsights(c, { ...range, metrics: ["reach"], metricType: "time_series" }));
  const reads = [totals, follows, reach];
  for (const [name, r] of [["totals", totals], ["follows", follows], ["reach by day", reach]] as const) if (r.status === "failed") failures.push(`instagram ${name}: ${r.detail}`);
  const ig = normalizeIgInsights({ totals: totals.raw, follows: follows.raw, reachSeries: reach.raw });
  if (ig) {
    const flow = flowOver(h.days, INSIGHTS.insightsDays, dayOf(now));
    const metrics = nonNull({ reach: ig.reach, views: ig.views, accountsEngaged: ig.accountsEngaged, totalInteractions: ig.totalInteractions, profileLinkTaps: ig.profileLinkTaps, follows: ig.follows, unfollows: ig.unfollows, followersGained: flow.gained, followersLost: flow.lost });
    await ctx.runMutation(internal.connections.insightsSync.writeInsights, { ...base, kind: "insights", status: Object.keys(metrics).length || ig.reachDaily ? "ok" : "not_reported", fromDate: ig.fromDate ?? range.fromDate, toDate: ig.toDate ?? range.toDate, metrics, ...(ig.reachDaily ? { reachDaily: ig.reachDaily } : {}), unavailable: ig.unavailable });
  } else {
    const all = reads.map((r) => r.status);
    const status: ReadStatus = all.every((s) => s === "not_available") ? "not_available" : all.some((s) => s === "failed") ? "failed" : "not_reported";
    await ctx.runMutation(internal.connections.insightsSync.writeInsights, { ...base, kind: "insights", status });
  }

  // Who follows them: weekly, and only where Instagram will answer.
  if (acc.audienceTriedAt <= now - INSIGHTS.audienceEveryMs) {
    const followers = h.days.filter((d) => d.followers !== null).at(-1)?.followers ?? acc.latestFollowers;
    if (followers !== null && followers < INSIGHTS.audienceMinFollowers) {
      await ctx.runMutation(internal.connections.insightsSync.writeInsights, { ...base, kind: "audience", status: "too_few_followers" });
    } else {
      const r = await attempt(() => instagramDemographics(c, { accountId: acc.accountId, metric: "follower_demographics", breakdown: ["age", "gender", "country", "city"], timeframe: "this_month" }));
      if (r.status === "failed") failures.push(`instagram audience: ${r.detail}`);
      const aud = r.status === "ok" ? normalizeDemographics(r.raw) : null;
      if (aud) {
        const audience = Object.fromEntries((["age", "gender", "country", "city"] as const).filter((k) => aud[k]).map((k) => [k, aud[k]!]));
        await ctx.runMutation(internal.connections.insightsSync.writeInsights, { ...base, kind: "audience", status: "ok", audience, ...(aud.base !== null ? { audienceBase: aud.base } : {}) });
      } else {
        await ctx.runMutation(internal.connections.insightsSync.writeInsights, { ...base, kind: "audience", status: r.status === "ok" ? "not_reported" : r.status });
      }
    }
  }
  return failures;
}

async function syncCreatorWith(ctx: ActionCtx, c: ZernioClient, creatorId: Id<"creators">, now: number): Promise<{ accounts: number; failures: string[] }> {
  const accounts = await ctx.runQuery(internal.connections.insightsSync.state, { creatorId });
  const failures: string[] = [];
  for (const acc of accounts) {
    try {
      failures.push(...(await syncAccount(ctx, c, creatorId, acc, now)));
    } catch (e) {
      failures.push(`${acc.platform}: ${e instanceof Error ? e.message.slice(0, 160) : "failed"}`);
    }
  }
  return { accounts: accounts.length, failures };
}

async function recordPass(ctx: ActionCtx, creators: number, accounts: number, failures: string[]): Promise<void> {
  if (creators === 0) return;
  const detail = failures.length ? `${failures.length} read${failures.length === 1 ? "" : "s"} failed across ${accounts} accounts; first: ${failures[0]}` : `${accounts} accounts across ${creators} creators`;
  await ctx.runMutation(internal.connections.zernio.recordHealth, { check: "account insights", ok: failures.length === 0, detail: detail.slice(0, 300) });
}

/** The hourly pass (via core/timedJobs): the stalest due creators, a few at a time. Never throws for one account. */
export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ creators: number; accounts: number; failed: number }> => {
    const now = Date.now();
    const ids = await ctx.runQuery(internal.connections.insightsSync.due, { now });
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
      const results = await Promise.all(ids.slice(i, i + INSIGHTS.concurrency).map((id) => syncCreatorWith(ctx, c, id, now).catch((e) => ({ accounts: 0, failures: [`creator: ${e instanceof Error ? e.message.slice(0, 160) : "failed"}`] }))));
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
    let c: ZernioClient;
    try {
      c = zernioClient(process.env.ZERNIO_API_KEY ?? "");
    } catch (e) {
      await recordPass(ctx, 1, 0, [e instanceof Error ? e.message : "no client"]);
      return { accounts: 0, failed: 1 };
    }
    const r = await syncCreatorWith(ctx, c, a.creatorId, Date.now());
    await recordPass(ctx, 1, r.accounts, r.failures);
    return { accounts: r.accounts, failed: r.failures.length };
  },
});
