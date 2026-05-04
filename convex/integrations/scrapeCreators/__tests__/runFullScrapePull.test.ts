/**
 * runFullScrapePull — integration test against convex-test with a mocked fetch layer.
 *
 * Coverage:
 *  - Pulls profile + posts in parallel for each handle
 *  - Persists `creatorHandles` rows (verified=true, scrapedAt=now, followerCount)
 *  - Writes cache rows for profile + posts
 *  - TikTok deep-dive: pulls transcript + comments for top-N posts
 *  - Cross-tenant: two creators submitting same handle do not pollute each other's caches
 *  - Adversarial: a network error on one platform doesn't kill the others
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import {
  tiktokProfileFixture,
  tiktokPostsFixture,
  tiktokCommentsFixture,
  tiktokTranscriptFixture,
} from "./fixtures/tiktok";
import {
  igProfileFixture,
  igPostsFixture,
} from "./fixtures/instagram";
import {
  ytChannelFixture,
  ytVideosFixture,
} from "./fixtures/youtube";

import { modules } from "../../../../tests/_modules";

const NOW = 1_700_000_000_000;

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Route a fetch call to the right fixture by URL path.
 */
function makeRouter(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    // Paths follow the official ScrapeCreators agent skill (v3/v2 for TikTok
    // single-video and feed endpoints). Order matters: the `/v1/tiktok/video/*`
    // patterns must be checked before the bare `/v1/tiktok/profile` pattern.
    if (url.includes("/v1/tiktok/profile")) return jsonResp(tiktokProfileFixture);
    if (url.includes("/v3/tiktok/profile/videos")) return jsonResp(tiktokPostsFixture);
    if (url.includes("/v1/tiktok/video/comments")) return jsonResp(tiktokCommentsFixture);
    if (url.includes("/v1/tiktok/video/transcript")) return jsonResp(tiktokTranscriptFixture);
    if (url.includes("/v1/instagram/profile")) return jsonResp(igProfileFixture);
    if (url.includes("/v1/instagram/user/posts")) return jsonResp(igPostsFixture);
    if (url.includes("/v1/youtube/channel/videos")) return jsonResp(ytVideosFixture);
    if (url.includes("/v1/youtube/channel")) return jsonResp(ytChannelFixture);
    return jsonResp({ error: `unmatched url ${url}` }, 404);
  });
}

async function makeCreator(t: ReturnType<typeof convexTest>, suffix: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    })
  );
}

beforeEach(() => {
  process.env.SCRAPE_CREATORS_API_KEY = "test-key-runFullScrapePull";
  process.env.SCRAPE_CREATORS_BASE_URL = "https://api.example-sc.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runFullScrapePull — happy path", () => {
  it("pulls TT + IG + YT in parallel and persists handles + cache", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "happy");
    const fetchSpy = makeRouter();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      {
        creatorId,
        handles: [
          { platform: "tiktok", handle: "fitcreator99" },
          { platform: "instagram", handle: "studio.lena" },
          { platform: "youtube", handle: "@codecast" },
        ],
      }
    );

    expect(result.platforms).toHaveLength(3);
    for (const p of result.platforms) {
      expect(p.ok).toBe(true);
      expect(p.profile).not.toBeNull();
      expect(p.posts.length).toBeGreaterThan(0);
      expect(p.errors).toEqual([]);
    }

    // creatorHandles persisted
    const handles = await t.run(async (ctx) =>
      ctx.db
        .query("creatorHandles")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(handles).toHaveLength(3);
    for (const h of handles) {
      expect(h.verified).toBe(true);
      expect(h.scrapedAt).toBeGreaterThan(0);
      expect(typeof h.followerCount).toBe("number");
    }

    // cache rows: at least 1 profile + 1 posts per platform = 6 minimum
    // (TT also adds transcript + comments rows for top posts)
    const cacheRows = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCache")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(cacheRows.length).toBeGreaterThanOrEqual(6);
    expect(cacheRows.some((r) => r.cacheKey.startsWith("sc:tiktok:profile:"))).toBe(true);
    expect(cacheRows.some((r) => r.cacheKey.startsWith("sc:instagram:posts:"))).toBe(true);
  });

  it("TikTok deep-dive: produces topPostExtras with transcript + topComments", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "deepdive");
    vi.stubGlobal("fetch", makeRouter());

    const result = await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      {
        creatorId,
        handles: [{ platform: "tiktok", handle: "fitcreator99" }],
      }
    );

    const tt = result.platforms.find((p) => p.platform === "tiktok")!;
    expect(tt.topPostExtras.length).toBeGreaterThan(0);
    expect(tt.topPostExtras[0].transcript).toContain("Five high-protein");
    expect(tt.topPostExtras[0].topComments.length).toBeGreaterThan(0);
  });
});

describe("runFullScrapePull — cross-tenant isolation", () => {
  it("two creators pulling the same TT handle do not see each other's cache", async () => {
    const t = convexTest(schema, modules);
    const a = await makeCreator(t, "ctA");
    const b = await makeCreator(t, "ctB");
    vi.stubGlobal("fetch", makeRouter());

    await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      { creatorId: a, handles: [{ platform: "tiktok", handle: "fitcreator99" }] }
    );
    await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      { creatorId: b, handles: [{ platform: "tiktok", handle: "fitcreator99" }] }
    );

    const aRows = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCache")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    const bRows = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCache")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .collect()
    );
    expect(aRows.length).toBeGreaterThan(0);
    expect(bRows.length).toBeGreaterThan(0);
    for (const r of aRows) expect(r.creatorId).toBe(a);
    for (const r of bRows) expect(r.creatorId).toBe(b);
  });
});

describe("runFullScrapePull — adversarial", () => {
  it("a network error on one platform does not abort the others", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "adv");
    const router = makeRouter();
    const wrapped = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      // Force IG profile to error every time.
      if (url.includes("/v1/instagram/profile")) {
        return jsonResp({ error: "auth" }, 403);
      }
      return router(input, init);
    });
    vi.stubGlobal("fetch", wrapped);

    const result = await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      {
        creatorId,
        handles: [
          { platform: "tiktok", handle: "fitcreator99" },
          { platform: "instagram", handle: "studio.lena" },
          { platform: "youtube", handle: "@codecast" },
        ],
      }
    );

    const tt = result.platforms.find((p) => p.platform === "tiktok")!;
    const ig = result.platforms.find((p) => p.platform === "instagram")!;
    const yt = result.platforms.find((p) => p.platform === "youtube")!;
    expect(tt.ok).toBe(true);
    expect(yt.ok).toBe(true);
    expect(ig.ok).toBe(false);
    expect(ig.errors.length).toBeGreaterThan(0);
    expect(ig.profile).toBeNull();

    // creatorHandles row should NOT be inserted for the failed IG pull (we require profile).
    const handles = await t.run(async (ctx) =>
      ctx.db
        .query("creatorHandles")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(handles.find((h) => h.platform === "instagram")).toBeUndefined();
    expect(handles.find((h) => h.platform === "tiktok")).toBeDefined();
    expect(handles.find((h) => h.platform === "youtube")).toBeDefined();
  });

  it("upsertHandle is idempotent on re-pull", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "idempot");
    vi.stubGlobal("fetch", makeRouter());

    await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      { creatorId, handles: [{ platform: "tiktok", handle: "fitcreator99" }] }
    );
    await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      { creatorId, handles: [{ platform: "tiktok", handle: "fitcreator99" }] }
    );

    const handles = await t.run(async (ctx) =>
      ctx.db
        .query("creatorHandles")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(handles).toHaveLength(1);
    expect(handles[0].platform).toBe("tiktok");
  });
});
