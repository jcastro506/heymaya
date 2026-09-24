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
    save("analytics", r);
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
});
