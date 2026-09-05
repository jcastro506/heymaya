/**
 * Sprint 4e, the rows: connected numbers land on the right own-post, refresh the public
 * counters only when newer, carry a reach multiple once there is a normal, and never
 * double-write a follower day. The join is by native id then by platform URL, because the
 * scraped Instagram id is the numeric pk while Zernio hands us the shortcode.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { matchOwnPost, normalReach } from "../sync";
import type { Connected } from "../analytics";

const NOW = Date.UTC(2026, 8, 5, 12, 0);
const conn = (over: Partial<Connected> = {}): Connected => ({ platform: "tiktok", postId: "7670709537535544590", url: "https://www.tiktok.com/@kevin.castro9996/video/7670709537535544590?utm_campaign=x", publishedAt: NOW - 86_400_000, asOf: NOW, syncStatus: "synced", views: 107, likes: 1, comments: 0, shares: 1, saves: 0, impressions: null, reach: null, clicks: 0, follows: null, avgWatchMs: null, totalWatchMs: null, skipRatePct: null, durationSec: null, ...over });

describe("the join", () => {
  const rows = [
    { platform: "tiktok", postId: "7670709537535544590", url: "https://www.tiktok.com/@kevin.castro9996/video/7670709537535544590" },
    { platform: "instagram", postId: "3712345678901234567", url: "https://www.instagram.com/p/DbrZ8lIlxma/" },
  ];
  it("matches tiktok by native id and instagram by the url's shortcode, ignoring query strings", () => {
    expect(matchOwnPost(rows, conn())?.postId).toBe("7670709537535544590");
    const ig = conn({ platform: "instagram", postId: "DbrZ8lIlxma", url: "https://www.instagram.com/p/DbrZ8lIlxma/?igsh=abc" });
    expect(matchOwnPost(rows, ig)?.postId, "scraped pk vs Zernio shortcode still joins").toBe("3712345678901234567");
    expect(matchOwnPost(rows, conn({ postId: "999", url: "https://www.tiktok.com/@x/video/999" }))).toBeNull();
    expect(matchOwnPost(rows, conn({ platform: "instagram" })), "never across platforms").toBeNull();
  });
  it("their normal reach needs three posts with reach, and is the median", () => {
    expect(normalReach([{ connected: { reach: 100 } }, { connected: { reach: 900 } }])).toBeNull();
    expect(normalReach([{ connected: { reach: 100 } }, { connected: { reach: 500 } }, { connected: { reach: 900 } }, { connected: { reach: null } }])).toBe(500);
  });
});

describe("upsert", () => {
  async function seeded() {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const ownPostId = await t.run((ctx) => ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: "7670709537535544590", url: "https://www.tiktok.com/@kevin.castro9996/video/7670709537535544590", createTime: NOW - 86_400_000, contentType: "video", caption: "scraped caption", hashtags: [], metrics: { views: 90, likes: 1, comments: 0, shares: 0 }, metricsAsOf: NOW - 3_600_000, source: "scrape" } as never));
    return { t, creatorId, ownPostId };
  }

  it("lands on the scraped row, refreshes the counters when newer, labels the source", async () => {
    const { t, creatorId, ownPostId } = await seeded();
    const r = await t.mutation(internal.connections.sync.upsert, { creatorId, connected: conn(), caption: "ignored on match" });
    expect(r.created).toBe(false);
    expect(r.ownPostId).toBe(ownPostId);
    const row = await t.run((ctx) => ctx.db.get(ownPostId));
    expect(row!.connected?.views).toBe(107);
    expect(row!.connected?.reach, "null, not zero").toBeNull();
    expect(row!.metrics.views, "the owner's number is the true one when it is newer").toBe(107);
    expect(row!.source).toBe("zernio");
    expect(row!.caption, "scraped caption kept").toBe("scraped caption");
  });

  it("does not overwrite public counters with a stale connected read", async () => {
    const { t, creatorId, ownPostId } = await seeded();
    await t.mutation(internal.connections.sync.upsert, { creatorId, connected: conn({ asOf: NOW - 7_200_000, views: 5 }) });
    const row = await t.run((ctx) => ctx.db.get(ownPostId));
    expect(row!.metrics.views).toBe(90);
    expect(row!.connected?.views, "but the connected block still records what Zernio said").toBe(5);
  });

  it("creates the own-post when scraping never saw it, with hashtags from the caption", async () => {
    const { t, creatorId } = await seeded();
    const r = await t.mutation(internal.connections.sync.upsert, { creatorId, connected: conn({ platform: "instagram", postId: "DbrZ8lIlxma", url: "https://www.instagram.com/p/DbrZ8lIlxma/", views: 3, reach: 3, impressions: 3 }), caption: "third pipeline test #running #brisbane" });
    expect(r.created).toBe(true);
    const row = await t.run((ctx) => ctx.db.get(r.ownPostId));
    expect(row!.source).toBe("zernio");
    expect(row!.hashtags).toEqual(["running", "brisbane"]);
    expect(row!.connected?.reach).toBe(3);
  });

  it("writes a reach multiple once three other posts have reach", async () => {
    const { t, creatorId } = await seeded();
    for (const [i, reach] of [1000, 2000, 3000].entries()) {
      await t.mutation(internal.connections.sync.upsert, { creatorId, connected: conn({ platform: "instagram", postId: `P${i}`, url: `https://www.instagram.com/p/P${i}/`, views: reach, reach, impressions: reach }) });
    }
    const r = await t.mutation(internal.connections.sync.upsert, { creatorId, connected: conn({ platform: "instagram", postId: "PX", url: "https://www.instagram.com/p/PX/", views: 8000, reach: 6000, impressions: 8000 }) });
    expect((await t.run((ctx) => ctx.db.get(r.ownPostId)))!.reachMultiple).toBe(3);
  });

  it("cross-tenant: a row never lands on another creator's post", async () => {
    const { t } = await seeded();
    const other = await t.run((ctx) => seedCreator(ctx, "b", {}));
    const r = await t.mutation(internal.connections.sync.upsert, { creatorId: other, connected: conn() });
    expect(r.created, "same native id, different creator: a new row, not theirs").toBe(true);
  });
});

describe("cursor and snapshots", () => {
  it("the delta cursor is a row, and a follower day is written once per account", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(internal.connections.sync.cursor, { key: "k" })).toBeNull();
    await t.mutation(internal.connections.sync.setCursor, { key: "k", value: "v1.abc" });
    await t.mutation(internal.connections.sync.setCursor, { key: "k", value: "v1.def" });
    expect(await t.query(internal.connections.sync.cursor, { key: "k" })).toBe("v1.def");
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", {}));
    await t.mutation(internal.connections.sync.writeSnapshot, { creatorId, platform: "tiktok", accountId: "acc", day: "2026-09-05", followers: 2 });
    await t.mutation(internal.connections.sync.writeSnapshot, { creatorId, platform: "tiktok", accountId: "acc", day: "2026-09-05", followers: 3 });
    const rows = await t.run((ctx) => ctx.db.query("followerSnapshots").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].followers).toBe(3);
  });

  it("the delta, followers and the synced webhook are all wired", async () => {
    const { readFileSync } = await import("node:fs");
    const crons = readFileSync(new URL("../../crons.ts", import.meta.url), "utf8");
    expect(crons).toMatch(/connections\.sync\.delta/);
    expect(crons).toMatch(/connections\.sync\.followers/);
    const hook = readFileSync(new URL("../zernio.ts", import.meta.url), "utf8");
    expect(hook).toMatch(/analytics\.synced/);
  });
});
