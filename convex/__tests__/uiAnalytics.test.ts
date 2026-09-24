/**
 * The app's analytics reads (app spec, analytics card → screen). Built on the REAL recorded
 * Zernio responses (integrations/zernio/fixtures.recorded.json) passed through the real
 * normaliser, so what the screen shows is what Zernio actually returns per platform.
 * Mandatory categories: cross-tenant isolation; honest per-platform limits.
 *
 * CAPTURE_APP_FIXTURES=1 also writes these outputs to apps/ios/Fixtures for the Swift
 * contract tests (the connected case can't be captured live until a pilot connects).
 */
import { writeFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { seedCreator } from "../../tests/lib/creatorRow";
import { normalizeConnected, type ZernioPostRow } from "../connections/analytics";
import recorded from "../integrations/zernio/fixtures.recorded.json";
import spec from "../integrations/zernio/fixtures.spec.json";
import { normalizeDemographics, normalizeFollowerHistory, normalizeIgInsights } from "../connections/accountInsights";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const capture = process.env.CAPTURE_APP_FIXTURES === "1";
const save = (name: string, value: unknown) => { if (capture) writeFileSync(`apps/ios/Fixtures/${name}.json`, JSON.stringify(value, null, 1)); };

const rec = recorded as unknown as Record<string, { posts?: ZernioPostRow[] }>;
const zernioPosts: ZernioPostRow[] = Object.entries(rec).filter(([k]) => k.startsWith("/api/v1/analytics")).flatMap(([, v]) => v.posts ?? []);

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const a = await seedCreator(ctx, "a", { clerkUserId: "user_a", handles: { tiktok: "kevin.castro9996", instagram: "heymaya" } });
    const b = await seedCreator(ctx, "b", { clerkUserId: "user_b" });
    await ctx.db.insert("connections", { creatorId: a, provider: "zernio", status: "connected", zernioAccounts: [
      { accountId: "tt", platform: "tiktok", username: "kevin.castro9996", needsReconnect: false, canFetchAnalytics: true },
      { accountId: "ig", platform: "instagram", username: "heymaya", needsReconnect: false, canFetchAnalytics: true },
    ], updatedAt: now } as never);
    const out: Record<string, string> = {};
    for (const [i, row] of zernioPosts.entries()) {
      const c = normalizeConnected(row);
      if (!c?.url) continue;
      const id = await ctx.db.insert("ownPosts", {
        creatorId: a, platform: c.platform, postId: c.postId ?? `p${i}`, url: c.url, createTime: now - (i + 3) * 86_400_000,
        contentType: c.durationSec ? "video" : c.platform === "tiktok" ? "video" : "photo", caption: String(row.content ?? ""), hashtags: [],
        metrics: { views: c.views ?? 0, likes: c.likes ?? 0, comments: c.comments ?? 0, shares: c.shares ?? 0, saves: c.saves ?? undefined },
        metricsAsOf: now - 3_600_000, source: "zernio",
        connected: { asOf: now - 3_600_000, syncStatus: "synced", views: c.views, likes: c.likes, comments: c.comments, shares: c.shares, saves: c.saves, impressions: c.impressions, reach: c.reach, clicks: c.clicks, follows: c.follows, avgWatchMs: c.avgWatchMs, totalWatchMs: c.totalWatchMs, skipRatePct: c.skipRatePct, durationSec: c.durationSec },
      } as never);
      out[c.platform] ??= id;
    }
    const publicOnly = await ctx.db.insert("ownPosts", { creatorId: a, platform: "tiktok", postId: "999", url: "https://www.tiktok.com/@kevin.castro9996/video/999", createTime: now - 86_400_000, contentType: "video", caption: "public only", hashtags: [], metrics: { views: 5000, likes: 300, comments: 12, shares: 9 }, metricsAsOf: now - 7_200_000, source: "scrape" } as never);
    const bPost = await ctx.db.insert("ownPosts", { creatorId: b, platform: "tiktok", postId: "1", url: "https://www.tiktok.com/@b/video/1", createTime: now, contentType: "video", caption: "b", hashtags: [], metrics: { views: 1, likes: 0, comments: 0, shares: 0 }, metricsAsOf: now, source: "scrape" } as never);
    for (const [day, followers] of [[35, 1800], [1, 2000]] as const) {
      await ctx.db.insert("followerSnapshots", { creatorId: a, platform: "tiktok", accountId: "tt", day: new Date(now - day * 86_400_000).toISOString().slice(0, 10), followers, at: now - day * 86_400_000 });
    }
    return { tiktok: out.tiktok, instagram: out.instagram, publicOnly, bPost };
  });
  return { t, ...ids };
}

describe("analytics for the app", () => {
  it("the recording has both platforms", () => {
    expect(new Set(zernioPosts.map((p) => String(p.platform).toLowerCase()))).toEqual(new Set(["tiktok", "instagram"]));
  });

  it("overview: both accounts, connected, followers now and a month ago, posts with a basis", async () => {
    const { t } = await setup();
    const r = await t.withIdentity({ subject: "user_a" }).query(api.ui.analytics, {});
    expect(r?.accounts.map((a) => [a.platform, a.connected])).toEqual([["tiktok", true], ["instagram", true]]);
    const tt = r!.accounts.find((a) => a.platform === "tiktok")!;
    expect([tt.followers, tt.followers30dAgo]).toEqual([2000, 1800]);
    expect(r?.posts.length).toBeGreaterThan(0);
    for (const p of r!.posts) expect(["connected", "public"]).toContain(p.headline.basis);
  });

  it("a TikTok post never carries watch time or skip rate, and says so", async () => {
    const { t, tiktok } = await setup();
    const r = await t.withIdentity({ subject: "user_a" }).query(api.ui.post, { id: tiktok as never });
    expect(r?.connected?.avgWatchMs ?? null).toBeNull();
    expect(r?.connected?.skipRatePct ?? null).toBeNull();
    expect(r?.cannotKnow.join(" ")).toMatch(/watch time/);
    save("post.tiktok", r);
  });

  it("an Instagram post keeps its connected numbers and labels them", async () => {
    const { t, instagram } = await setup();
    const r = await t.withIdentity({ subject: "user_a" }).query(api.ui.post, { id: instagram as never });
    expect(r?.platform).toBe("instagram");
    expect(r?.connected).not.toBeNull();
    save("post.instagram", r);
  });

  it("a public-only post leads with the public count and says reach is unknown", async () => {
    const { t, publicOnly } = await setup();
    const r = await t.withIdentity({ subject: "user_a" }).query(api.ui.post, { id: publicOnly as never });
    expect(r?.headline).toMatchObject({ what: "views", basis: "public", value: 5000 });
    expect(r?.connected).toBeNull();
    expect(r?.cannotKnow.join(" ")).toMatch(/no account connected/);
    save("post.public", r);
  });

  it("another creator's post is not found; strangers see null", async () => {
    const { t, bPost } = await setup();
    expect(await t.withIdentity({ subject: "user_a" }).query(api.ui.post, { id: bPost as never })).toBeNull();
    expect(await t.withIdentity({ subject: "user_zzz" }).query(api.ui.analytics, {})).toBeNull();
    expect(await t.query(api.ui.post, { id: bPost as never })).toBeNull();
  });

  it("A1: follower growth per platform, 'From your profile' and 'Who follows you' on Instagram, from stored rows only", async () => {
    const { t } = await setupWithInsights();
    const r = await t.withIdentity({ subject: "user_a" }).query(api.ui.analytics, {});
    const ig = r!.accounts.find((x) => x.platform === "instagram")!;
    const tt = r!.accounts.find((x) => x.platform === "tiktok")!;
    expect(ig.growth!.days.length).toBeGreaterThan(30);
    expect(ig.growth!.days.length).toBeLessThanOrEqual(90);
    expect(ig.growth!.flowReported).toBe(true);
    expect(ig.growth!.gained30d).toBeGreaterThan(0);
    for (const d of ig.growth!.days) expect(Object.keys(d).sort()).toEqual(["day", "followers", "gained", "lost"]);
    expect(ig.profile).toMatchObject({ status: "ok", profileLinkTaps: 37, follows: 142, unfollows: 19 });
    expect(ig.audience!.status).toBe("ok");
    for (const k of ["gender", "age", "countries", "cities"] as const) {
      expect(ig.audience![k].length).toBeGreaterThan(0);
      for (const x of ig.audience![k]) { expect(x.share).toBeGreaterThan(0); expect(x.share).toBeLessThanOrEqual(1); }
    }
    expect(ig.audience!.gender.reduce((s, x) => s + x.share, 0)).toBeLessThanOrEqual(1.001);
    expect(tt.growth!.days.length).toBeGreaterThan(0);
    expect([tt.profile, tt.audience], "TikTok gives neither at account level").toEqual([null, null]);
    save("analytics", r);
  });

  it("A1: empty states carry a reason: not connected, under 100 followers, not reported yet", async () => {
    const { t, a } = await setupWithInsights();
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("accountInsights").collect();
      for (const row of rows) if (row.kind === "audience") await ctx.db.patch(row._id, { status: "too_few_followers", audience: undefined, audienceBase: undefined });
      for (const row of rows) if (row.kind === "insights" && row.platform === "instagram") await ctx.db.delete(row._id);
    });
    let r = await t.withIdentity({ subject: "user_a" }).query(api.ui.analytics, {});
    let ig = r!.accounts.find((x) => x.platform === "instagram")!;
    expect(ig.audience).toMatchObject({ status: "too_few_followers", gender: [], age: [], countries: [], cities: [] });
    expect(ig.profile).toMatchObject({ status: "not_reported", profileLinkTaps: null, follows: null });
    await t.run(async (ctx) => {
      const conn = await ctx.db.query("connections").filter((q) => q.eq(q.field("creatorId"), a)).first();
      await ctx.db.patch(conn!._id, { zernioAccounts: [] });
    });
    r = await t.withIdentity({ subject: "user_a" }).query(api.ui.analytics, {});
    ig = r!.accounts.find((x) => x.platform === "instagram")!;
    expect([ig.connected, ig.growth, ig.profile?.status, ig.audience?.status]).toEqual([false, null, "not_connected", "not_connected"]);
  });

  it("A1 cross-tenant: B sees none of A's audience or growth", async () => {
    const { t } = await setupWithInsights();
    await t.run(async (ctx) => {
      const b = (await ctx.db.query("creators").collect()).find((c) => c.clerkUserId === "user_b")!;
      await ctx.db.patch(b._id, { handles: { tiktok: "tt_b", instagram: "ig_b" } });
      await ctx.db.insert("connections", { creatorId: b._id, provider: "zernio", status: "connected", zernioAccounts: [{ accountId: "ig", platform: "instagram", username: "ig_b", needsReconnect: false, canFetchAnalytics: true }], updatedAt: Date.now() } as never);
    });
    const r = await t.withIdentity({ subject: "user_b" }).query(api.ui.analytics, {});
    const ig = r!.accounts.find((x) => x.platform === "instagram")!;
    expect(ig.growth, "same Zernio account id, other creator: nothing").toBeNull();
    expect(ig.audience).toMatchObject({ status: "not_reported", gender: [] });
    expect(ig.profile).toMatchObject({ status: "not_reported", profileLinkTaps: null });
  });
});

const S = spec as unknown as Record<string, Record<string, unknown>>;

/** A realistic 60-day follower series ending today (Zernio's envelope), for the growth chart. */
function series(start: number, perDay: (i: number) => [number, number]) {
  const now = Date.now();
  const days = 60;
  const dates = Array.from({ length: days }, (_, i) => new Date(now - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  let f = start;
  const count: Array<{ date: string; value: number }> = [], gained: typeof count = [], lost: typeof count = [];
  dates.forEach((date, i) => {
    const [g, l] = i === 0 ? [0, 0] : perDay(i);
    f += g - l;
    count.push({ date, value: f }); gained.push({ date, value: g }); lost.push({ date, value: l });
  });
  return { metrics: { follower_count: { values: count }, followers_gained: { values: gained }, followers_lost: { values: lost } } };
}

async function setupWithInsights() {
  const base = await setup();
  const { t } = base;
  const a = await t.run(async (ctx) => (await ctx.db.query("creators").collect()).find((c) => c.clerkUserId === "user_a")!._id as Id<"creators">);
  const now = Date.now();
  // Instagram: a steady week, then a post that took off around day 45 (more follows, a few more unfollows).
  const igDays = normalizeFollowerHistory(series(7400, (i) => (i > 44 && i < 50 ? [60 - (i - 45) * 8, 6] : [9 + (i % 4), 2 + (i % 3 === 0 ? 1 : 0)])))!.days;
  const ttDays = normalizeFollowerHistory(series(1760, (i) => [3 + (i % 5 === 0 ? 4 : 0), i % 6 === 0 ? 2 : 1]))!.days;
  await t.mutation(internal.connections.insightsSync.writeHistory, { creatorId: a, platform: "instagram", accountId: "ig", days: igDays, now });
  await t.mutation(internal.connections.insightsSync.writeHistory, { creatorId: a, platform: "tiktok", accountId: "tt", days: ttDays, now });
  const totals = { ...S.igInsightsTotals, metrics: { ...(S.igInsightsTotals.metrics as object), profile_links_taps: { total: 37 } }, unavailableMetrics: undefined };
  const ig = normalizeIgInsights({ totals, follows: S.igFollowsBreakdown, reachSeries: S.igInsightsTimeSeries })!;
  const metrics = Object.fromEntries(Object.entries({ reach: ig.reach, views: ig.views, accountsEngaged: ig.accountsEngaged, totalInteractions: ig.totalInteractions, profileLinkTaps: ig.profileLinkTaps, follows: ig.follows, unfollows: ig.unfollows }).filter((e): e is [string, number] => e[1] !== null));
  await t.mutation(internal.connections.insightsSync.writeInsights, { creatorId: a, platform: "instagram", accountId: "ig", kind: "insights", status: "ok", now, fromDate: ig.fromDate!, toDate: ig.toDate!, metrics, reachDaily: ig.reachDaily! });
  const aud = normalizeDemographics(S.igDemographics)!;
  await t.mutation(internal.connections.insightsSync.writeInsights, { creatorId: a, platform: "instagram", accountId: "ig", kind: "audience", status: "ok", now, audience: { age: aud.age!, gender: aud.gender!, country: aud.country!, city: aud.city! }, audienceBase: aud.base! });
  return { ...base, a };
}
