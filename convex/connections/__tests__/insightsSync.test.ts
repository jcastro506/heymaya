/**
 * A1 part 2, the rows: the account-insights sync against a fake Zernio that answers with the
 * spec's shapes. Categories: sync writes + idempotency; budget/fail-closed (plan status, the
 * plan's account cap, broken accounts, under 100 followers never calls demographics); one
 * named failure per pass, never a throw; cross-tenant isolation (creator A never sees B's
 * audience, in her tool or in the app); what she cites is labelled and grounded.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import spec from "../../integrations/zernio/fixtures.spec.json";
import { readableAccounts } from "../insightsSync";
import { DEFAULT_BUDGET, runTool, type ToolCallRecord } from "../../agent/tools";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

const S = spec as unknown as Record<string, Record<string, unknown>>;
const DAY = 86_400_000;
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A follower series ending today: 3 follows and 1 unfollow a day (the first day has nothing to diff: 0/0). */
function history(platform: "instagram" | "tiktok", start: number, days = 40) {
  const now = Date.now();
  const values = Array.from({ length: days }, (_, i) => dayOf(now - (days - 1 - i) * DAY));
  return {
    success: true, accountId: "x", platform, metricType: "time_series",
    metrics: {
      follower_count: { total: start + 2 * days, values: values.map((date, i) => ({ date, value: start + 2 * i })) },
      followers_gained: { total: 3 * days, values: values.map((date, i) => ({ date, value: i === 0 ? 0 : 3 })) },
      followers_lost: { total: days, values: values.map((date, i) => ({ date, value: i === 0 ? 0 : 1 })) },
    },
  };
}

type Route = (url: URL) => { status: number; body: unknown };
let calls: string[] = [];
function fakeZernio(route: Route) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    calls.push(`${url.pathname}?${url.searchParams.toString()}`);
    const r = route(url);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }));
}

const specRoute = (followers = 8000): Route => (url) => {
  const p = url.pathname;
  const metrics = url.searchParams.get("metrics") ?? "";
  if (p.endsWith("/instagram/follower-history")) return { status: 200, body: history("instagram", followers) };
  if (p.endsWith("/tiktok/account-insights")) return { status: 200, body: history("tiktok", 2000) };
  if (p.endsWith("/instagram/demographics")) return followers < 100 ? { status: 400, body: S.igDemographicsInsufficient400 } : { status: 200, body: S.igDemographics };
  if (p.endsWith("/instagram/account-insights")) {
    if (url.searchParams.get("breakdown") === "follow_type") return { status: 200, body: S.igFollowsBreakdown };
    if (url.searchParams.get("metricType") === "time_series") return { status: 200, body: { ...S.igInsightsTimeSeries, metrics: { reach: (S.igInsightsTimeSeries.metrics as Record<string, unknown>).reach } } };
    if (metrics.includes("profile_links_taps")) return { status: 200, body: { ...S.igInsightsTotals, metrics: { ...(S.igInsightsTotals.metrics as object), profile_links_taps: { total: 37 } }, unavailableMetrics: undefined } };
  }
  return { status: 404, body: { error: "Account not found" } };
};

async function seed(t: ReturnType<typeof convexTest>, suffix: string, over: { plan?: Record<string, unknown>; accounts?: Array<Record<string, unknown>> } = {}) {
  return await t.run(async (ctx) => {
    const creatorId = await seedCreator(ctx, suffix, { clerkUserId: `user_${suffix}`, handles: { tiktok: `tt_${suffix}`, instagram: `ig_${suffix}` }, ...(over.plan ? { plan: { founding: true, ...over.plan } } : {}) });
    await ctx.db.insert("connections", { creatorId, provider: "zernio", status: "connected", zernioProfileId: `prof_${suffix}`, updatedAt: Date.now(),
      zernioAccounts: over.accounts ?? [
        { accountId: `ig_${suffix}`, platform: "instagram", username: `ig_${suffix}`, needsReconnect: false, canFetchAnalytics: true },
        { accountId: `tt_${suffix}`, platform: "tiktok", username: `tt_${suffix}`, needsReconnect: false, canFetchAnalytics: true },
      ] } as never);
    return creatorId;
  });
}

beforeEach(() => { process.env.ZERNIO_API_KEY = "test_key_not_real"; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.ZERNIO_API_KEY; });

describe("the sync writes rows", () => {
  it("history onto followerSnapshots with gained/lost, Instagram insights and audience, TikTok totals; once a day each", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a", { plan: { status: "active", tier: "duo" } });
    fakeZernio(specRoute());
    const r = await t.action(internal.connections.insightsSync.run, {});
    expect(r).toMatchObject({ creators: 1, accounts: 2, failed: 0 });

    const snaps = await t.run((ctx) => ctx.db.query("followerSnapshots").collect());
    expect(snaps.filter((s) => s.platform === "instagram").length).toBe(40);
    expect(snaps.filter((s) => s.platform === "tiktok").length).toBe(40);
    const first = snaps.find((s) => s.platform === "tiktok" && s.day === dayOf(Date.now() - 39 * DAY))!;
    expect(first.gained, "the first day has nothing to diff against: absent, not 0").toBeUndefined();
    expect(snaps.find((s) => s.day === dayOf(Date.now()))!.gained).toBe(3);

    const rows = await t.run((ctx) => ctx.db.query("accountInsights").collect());
    const ig = rows.find((x) => x.platform === "instagram" && x.kind === "insights")!;
    expect(ig.status).toBe("ok");
    expect(ig.metrics).toMatchObject({ reach: 12500, profileLinkTaps: 37, follows: 142, unfollows: 19, followersGained: 90, followersLost: 30 });
    expect(ig.reachDaily?.length).toBe(2);
    const aud = rows.find((x) => x.kind === "audience")!;
    expect(aud).toMatchObject({ status: "ok", platform: "instagram", audienceBase: 7800 });
    expect(aud.audience?.country?.[0].label).toBe("US");
    const tt = rows.find((x) => x.platform === "tiktok")!;
    expect(tt.metrics).toEqual({ followersGained: 90, followersLost: 30 });
    expect(rows.every((x) => x.creatorId === a)).toBe(true);

    // The request carries the spec's parameters.
    expect(calls.some((c) => c.includes("/api/v1/analytics/instagram/demographics") && c.includes("metric=follower_demographics") && c.includes("breakdown=age%2Cgender%2Ccountry%2Ccity") && c.includes("timeframe=this_month"))).toBe(true);
    expect(calls.some((c) => c.includes("/api/v1/analytics/instagram/account-insights") && c.includes("breakdown=follow_type") && c.includes("metrics=follows_and_unfollows"))).toBe(true);
    expect(calls.some((c) => c.includes("/api/v1/analytics/tiktok/account-insights") && c.includes("metricType=time_series"))).toBe(true);

    // Idempotent: a second pass inside 20 h reads nobody; a forced one rewrites the same rows.
    expect(await t.action(internal.connections.insightsSync.run, {})).toMatchObject({ creators: 0 });
    calls.length = 0;
    await t.action(internal.connections.insightsSync.syncCreator, { creatorId: a });
    expect((await t.run((ctx) => ctx.db.query("followerSnapshots").collect())).length).toBe(80);
    expect((await t.run((ctx) => ctx.db.query("accountInsights").collect())).length).toBe(3);
    expect(calls.filter((c) => c.includes("demographics")).length, "audience is weekly, not on every pass").toBe(0);
  });

  it("history keeps a same-day live count and patches gained/lost onto it", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    const today = dayOf(Date.now());
    await t.mutation(internal.connections.sync.writeSnapshot, { creatorId: a, platform: "tiktok", accountId: "tt_a", day: today, followers: 5555 });
    await t.mutation(internal.connections.insightsSync.writeHistory, { creatorId: a, platform: "tiktok", accountId: "tt_a", now: Date.now(), days: [{ day: today, followers: 5000, gained: 4, lost: 1 }, { day: "not-a-day", followers: 1, gained: null, lost: null }] });
    const rows = await t.run((ctx) => ctx.db.query("followerSnapshots").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ followers: 5555, gained: 4, lost: 1 });
  });
});

describe("budget and fail-closed", () => {
  it("only live plans, only accounts within the plan, never a broken or unreadable account", () => {
    const conn = { provider: "zernio" as const, status: "connected" as const, zernioAccounts: [
      { accountId: "1", platform: "instagram" as const, canFetchAnalytics: true, needsReconnect: false },
      { accountId: "2", platform: "tiktok" as const, canFetchAnalytics: true, needsReconnect: false },
    ] };
    expect(readableAccounts(conn, { status: "canceled" })).toEqual([]);
    expect(readableAccounts(conn, { status: "deleting" })).toEqual([]);
    expect(readableAccounts(conn, { status: "active", tier: "solo" }).map((x) => x.accountId), "solo reads one account").toEqual(["1"]);
    expect(readableAccounts({ ...conn, zernioAccounts: [{ ...conn.zernioAccounts[0], needsReconnect: true }] }, { status: "active", tier: "duo" })).toEqual([]);
    expect(readableAccounts({ ...conn, zernioAccounts: [{ ...conn.zernioAccounts[0], canFetchAnalytics: false }] }, { status: "active", tier: "duo" })).toEqual([]);
    expect(readableAccounts({ ...conn, status: "disconnected" }, { status: "active", tier: "duo" })).toEqual([]);
  });

  it("a canceled creator costs no calls", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "a", { plan: { status: "canceled" } });
    fakeZernio(specRoute());
    expect(await t.action(internal.connections.insightsSync.run, {})).toMatchObject({ creators: 0 });
    expect(calls).toEqual([]);
  });

  it("under 100 followers: demographics is never called and the row says why", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "a", { plan: { status: "active", tier: "duo" } });
    fakeZernio(specRoute(20));
    await t.action(internal.connections.insightsSync.run, {});
    expect(calls.some((c) => c.includes("demographics"))).toBe(false);
    const aud = (await t.run((ctx) => ctx.db.query("accountInsights").collect())).find((x) => x.kind === "audience")!;
    expect(aud.status).toBe("too_few_followers");
    expect(aud.audience).toBeUndefined();
  });

  it("no add-on (402) and no TikTok scope (412) are 'not available', recorded, not failures", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "a", { plan: { status: "active", tier: "duo" } });
    fakeZernio((url) => ({ status: url.pathname.includes("tiktok") ? 412 : 402, body: { error: "Analytics add-on required", code: "analytics_addon_required" } }));
    const r = await t.action(internal.connections.insightsSync.run, {});
    expect(r.failed).toBe(0);
    const rows = await t.run((ctx) => ctx.db.query("accountInsights").collect());
    expect(rows.map((x) => `${x.platform}:${x.kind}:${x.status}`).sort()).toEqual(["instagram:audience:not_available", "instagram:insights:not_available", "tiktok:insights:not_available"]);
  });
});

describe("nothing fails silently, nothing fails loudly", () => {
  it("one creator's failing reads are one named health row; the other creator is still read; earlier rows survive", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a", { plan: { status: "active", tier: "duo" } });
    const b = await seed(t, "b", { plan: { status: "active", tier: "duo" } });
    await t.run((ctx) => ctx.db.insert("accountInsights", { creatorId: a, platform: "instagram", accountId: "ig_a", kind: "insights", status: "ok", metrics: { reach: 1 }, fetchedAt: 1 }));
    const ok = specRoute();
    // A 400 we didn't expect is a failure without retries (a 5xx would retry with real backoff).
    fakeZernio((url) => (url.searchParams.get("accountId")?.endsWith("_a") ? { status: 400, body: { error: "Invalid metrics: impressions" } } : ok(url)));
    const r = await t.action(internal.connections.insightsSync.run, {});
    expect(r.creators).toBe(2);
    expect(r.failed).toBeGreaterThan(0);
    const health = await t.run((ctx) => ctx.db.query("vendorHealth").collect());
    expect(health.filter((h) => h.check === "account insights")).toHaveLength(1);
    expect(health[0].ok).toBe(false);
    const rows = await t.run((ctx) => ctx.db.query("accountInsights").collect());
    const aIg = rows.find((x) => x.creatorId === a && x.kind === "insights" && x.platform === "instagram")!;
    expect(aIg.metrics, "a failed read keeps what we had").toEqual({ reach: 1 });
    expect(aIg.attemptedAt, "and moves the retry clock").toBeGreaterThan(1);
    expect(rows.some((x) => x.creatorId === b && x.status === "ok")).toBe(true);
  });

  it("wired: the hourly timed job and the connect-time read", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(new URL("../../crons.ts", import.meta.url), "utf8")).toMatch(/job: "account insights"/);
    expect(readFileSync(new URL("../../core/timedJobs.ts", import.meta.url), "utf8")).toMatch(/connections\.insightsSync\.run/);
    expect(readFileSync(new URL("../zernio.ts", import.meta.url), "utf8")).toMatch(/connections\.insightsSync\.syncCreator/);
  });
});

describe("cross-tenant and grounded", () => {
  async function twoCreators() {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a", { plan: { status: "active", tier: "duo" } });
    const b = await seed(t, "b", { plan: { status: "active", tier: "duo" } });
    fakeZernio(specRoute());
    await t.action(internal.connections.insightsSync.syncCreator, { creatorId: b });
    return { t, a, b };
  }

  it("creator A never sees B's audience: not in her tool, not in the app", async () => {
    const { t, a } = await twoCreators();
    const facts = await t.query(internal.connections.audience.forCreator, { creatorId: a });
    expect(facts.flatMap((f) => f.lines)).toEqual([]);
    expect(facts.find((f) => f.platform === "instagram")!.cannotKnow.join(" ")).toMatch(/not reported yet/);
    const app = await t.withIdentity({ subject: "user_a" }).query(api.ui.analytics, {});
    const ig = app!.accounts.find((x) => x.platform === "instagram")!;
    expect(ig.audience?.status).toBe("not_reported");
    expect(ig.audience?.gender).toEqual([]);
    expect(ig.growth).toBeNull();
  });

  it("B's tool reads only stored rows, each labelled connected", async () => {
    const { t, b } = await twoCreators();
    const trace: ToolCallRecord[] = [];
    const ctx = { runQuery: (ref: unknown, args: unknown) => (t.query as (r: unknown, a: unknown) => Promise<unknown>)(ref, args) } as unknown as ActionCtx;
    const out = await runTool(ctx, b as Id<"creators">, { name: "audience", args: { why: "who follows me" } }, DEFAULT_BUDGET(), trace);
    expect(trace).toMatchObject([{ tool: "audience", ok: true, credits: 0 }]);
    for (const line of out.split("\n").filter((l) => l.startsWith("- "))) expect(line).toMatch(/\(connected, (Instagram|TikTok)/);
    expect(out).toContain("12,500"); // reach from the spec example, a stored row
    expect(out).toContain("cannot know");
  });

  it("not connected: nothing to cite, and the next step is connecting, never an estimate", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "c", { handles: { tiktok: "tt_c" } }));
    const ctx = { runQuery: (ref: unknown, args: unknown) => (t.query as (r: unknown, a: unknown) => Promise<unknown>)(ref, args) } as unknown as ActionCtx;
    const out = await runTool(ctx, c, { name: "audience", args: { why: "x" } }, DEFAULT_BUDGET(), []);
    expect(out).toMatch(/not connected/);
    expect(out).toMatch(/next:/);
    expect(out).not.toMatch(/\d{2,}/);
  });
});
