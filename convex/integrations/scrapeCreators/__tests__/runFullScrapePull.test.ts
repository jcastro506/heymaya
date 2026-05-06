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
  tiktokAudienceFixture,
  tiktokFollowingFixture,
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
    if (url.includes("/v1/tiktok/user/audience")) return jsonResp(tiktokAudienceFixture);
    if (url.includes("/v1/tiktok/user/following")) return jsonResp(tiktokFollowingFixture);
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

    const posts = await t.run(async (ctx) =>
      ctx.db
        .query("posts")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(posts.length).toBeGreaterThanOrEqual(6);
    const firstTikTok = posts.find(
      (p) => p.platform === "tiktok" && p.platformPostId === "7341111111111111111"
    );
    expect(firstTikTok?.url).toBe(
      "https://www.tiktok.com/@fitcreator99/video/7341111111111111111"
    );

    const metrics = await t.run(async (ctx) =>
      ctx.db
        .query("postMetrics")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(metrics.length).toBe(posts.length);
    const firstTikTokMetrics = metrics.find(
      (m) => m.postId === firstTikTok?._id
    );
    expect(firstTikTokMetrics).toMatchObject({
      viewCount: 1840000,
      likeCount: 41200,
      commentCount: 312,
      shareCount: 1280,
      saveCount: 8800,
    });
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

    const posts = await t.run(async (ctx) =>
      ctx.db
        .query("posts")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(posts).toHaveLength(2);

    const metrics = await t.run(async (ctx) =>
      ctx.db
        .query("postMetrics")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(metrics).toHaveLength(4);
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint 4 — bulk pull expansion: tiktok.audience + tiktok.following          */
/* -------------------------------------------------------------------------- */

import {
  TIKTOK_AUDIENCE_MIN_FOLLOWERS,
} from "../runFullScrapePull";

describe("runFullScrapePull — Sprint 4 audience + following", () => {
  it("calls tiktok.audience + tiktok.following for >5K-follower TT handles and writes cache + audit rows", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "s4_tt_big");
    const fetchSpy = makeRouter();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      {
        creatorId,
        handles: [{ platform: "tiktok", handle: "fitcreator99" }],
      }
    );

    const tt = result.platforms[0];
    expect(tt.ok).toBe(true);
    expect(tt.audience).not.toBeNull();
    expect(tt.audience?.ageRanges).toContain("18-24");
    expect(tt.audience?.topGeos).toContain("US");
    expect(tt.audience?.genderSplit).not.toBeNull();
    expect(tt.following).not.toBeNull();
    expect(tt.following?.users.length).toBeGreaterThan(0);
    expect(tt.followerSnapshotId).not.toBeNull();

    // Cache rows: audience + following keys present
    const cacheRows = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCache")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(
      cacheRows.some((r) => r.cacheKey === "sc:tiktok:audience:fitcreator99")
    ).toBe(true);
    expect(
      cacheRows.some((r) => r.cacheKey === "sc:tiktok:following:fitcreator99")
    ).toBe(true);

    // Credit audit: one "called" row for audience (26 credits) + one for following (1 credit).
    const audit = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCreditAudit")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    const audienceAudit = audit.find((a) => a.kind === "audience");
    const followingAudit = audit.find((a) => a.kind === "following");
    expect(audienceAudit?.called).toBe(true);
    expect(audienceAudit?.credits).toBe(26);
    expect(followingAudit?.called).toBe(true);
    expect(followingAudit?.credits).toBe(1);

    // Follower snapshot: one row written.
    const snaps = await t.run(async (ctx) =>
      ctx.db
        .query("creatorFollowerSnapshots")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(snaps.length).toBe(1);
    expect(snaps[0].followerCount).toBe(248311);
    expect(snaps[0].platform).toBe("tiktok");
  });

  it("SKIPS tiktok.audience for handles with <5K followers (credit gating)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "s4_tt_small");

    // Override the profile fixture to return <5K followers.
    const smallFollowerProfile = {
      ...tiktokProfileFixture,
      stats: {
        ...tiktokProfileFixture.stats,
        followerCount: 1234, // below TIKTOK_AUDIENCE_MIN_FOLLOWERS
      },
    };
    expect(smallFollowerProfile.stats.followerCount).toBeLessThan(
      TIKTOK_AUDIENCE_MIN_FOLLOWERS
    );

    let audienceCalled = false;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes("/v1/tiktok/user/audience")) {
        audienceCalled = true;
        return jsonResp(tiktokAudienceFixture);
      }
      if (url.includes("/v1/tiktok/user/following"))
        return jsonResp(tiktokFollowingFixture);
      if (url.includes("/v1/tiktok/profile")) return jsonResp(smallFollowerProfile);
      if (url.includes("/v3/tiktok/profile/videos")) return jsonResp(tiktokPostsFixture);
      if (url.includes("/v1/tiktok/video/comments")) return jsonResp(tiktokCommentsFixture);
      if (url.includes("/v1/tiktok/video/transcript")) return jsonResp(tiktokTranscriptFixture);
      return jsonResp({ error: "unmatched" }, 404);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      {
        creatorId,
        handles: [{ platform: "tiktok", handle: "fitcreator99" }],
      }
    );

    expect(audienceCalled).toBe(false);
    expect(result.platforms[0].audience).toBeNull();
    // Following is NOT credit-gated (1 credit) — should still fire.
    expect(result.platforms[0].following).not.toBeNull();

    // Audit row: audience skipped with credits=0, reason mentions threshold.
    const audit = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCreditAudit")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    const audienceAudit = audit.find((a) => a.kind === "audience");
    expect(audienceAudit?.called).toBe(false);
    expect(audienceAudit?.credits).toBe(0);
    expect(audienceAudit?.reason).toContain("skipped");
    expect(audienceAudit?.reason).toContain("1234");
  });

  it("SKIPS tiktok.audience + following entirely for non-TikTok platforms", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "s4_ig_only");
    const fetchSpy = vi.fn(makeRouter());
    vi.stubGlobal("fetch", fetchSpy);

    const result = await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      {
        creatorId,
        handles: [{ platform: "instagram", handle: "studio.lena" }],
      }
    );

    expect(result.platforms[0].audience).toBeNull();
    expect(result.platforms[0].following).toBeNull();

    // No audience or following endpoint should have been called for IG.
    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/v1/tiktok/user/audience"))).toBe(false);
    expect(calls.some((u) => u.includes("/v1/tiktok/user/following"))).toBe(false);

    // No credit audit rows for an IG-only handle (the gating logic is
    // TT-only; non-TT platforms never enter the audit path).
    const audit = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCreditAudit")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(audit).toEqual([]);
  });

  it("malformed audience response → graceful fallback (no crash, audience=null)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "s4_adv_audience");
    const wrapped = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes("/v1/tiktok/user/audience")) {
        // Garbage shape — Zod parser tolerates it (passthrough), normalizer
        // returns empty arrays. The endpoint still returns ok; pull keeps going.
        return jsonResp({ totally: "wrong shape", garbage: [1, 2, 3] });
      }
      if (url.includes("/v1/tiktok/user/following"))
        return jsonResp(tiktokFollowingFixture);
      if (url.includes("/v1/tiktok/profile")) return jsonResp(tiktokProfileFixture);
      if (url.includes("/v3/tiktok/profile/videos")) return jsonResp(tiktokPostsFixture);
      if (url.includes("/v1/tiktok/video/comments")) return jsonResp(tiktokCommentsFixture);
      if (url.includes("/v1/tiktok/video/transcript")) return jsonResp(tiktokTranscriptFixture);
      return jsonResp({ error: "unmatched" }, 404);
    });
    vi.stubGlobal("fetch", wrapped);

    const result = await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      {
        creatorId,
        handles: [{ platform: "tiktok", handle: "fitcreator99" }],
      }
    );

    // The pull should succeed overall; audience normalizer returns empty
    // arrays from the malformed payload (no crash, no thrown error).
    expect(result.platforms[0].ok).toBe(true);
    const aud = result.platforms[0].audience;
    expect(aud).not.toBeNull();
    expect(aud?.ageRanges).toEqual([]);
    expect(aud?.topGeos).toEqual([]);
    expect(aud?.genderSplit).toBeNull();

    // Audit row still records the call.
    const audit = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCreditAudit")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(audit.find((a) => a.kind === "audience")?.called).toBe(true);
  });

  it("audience + following caches are CREATOR-SCOPED (cross-tenant isolation)", async () => {
    const t = convexTest(schema, modules);
    const a = await makeCreator(t, "s4_iso_a");
    const b = await makeCreator(t, "s4_iso_b");
    vi.stubGlobal("fetch", makeRouter());

    await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      { creatorId: a, handles: [{ platform: "tiktok", handle: "fitcreator99" }] }
    );
    await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      { creatorId: b, handles: [{ platform: "tiktok", handle: "fitcreator99" }] }
    );

    const aAud = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCache")
        .withIndex("by_creator_and_key", (q) =>
          q.eq("creatorId", a).eq("cacheKey", "sc:tiktok:audience:fitcreator99")
        )
        .unique()
    );
    const bAud = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCache")
        .withIndex("by_creator_and_key", (q) =>
          q.eq("creatorId", b).eq("cacheKey", "sc:tiktok:audience:fitcreator99")
        )
        .unique()
    );
    expect(aAud).not.toBeNull();
    expect(bAud).not.toBeNull();
    expect(aAud?.creatorId).toBe(a);
    expect(bAud?.creatorId).toBe(b);
    expect(aAud?._id).not.toBe(bAud?._id);

    const aSnaps = await t.run(async (ctx) =>
      ctx.db
        .query("creatorFollowerSnapshots")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    const bSnaps = await t.run(async (ctx) =>
      ctx.db
        .query("creatorFollowerSnapshots")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .collect()
    );
    for (const s of aSnaps) expect(s.creatorId).toBe(a);
    for (const s of bSnaps) expect(s.creatorId).toBe(b);
  });

  it("plan-tier × action: BOTH coach and manager tiers gate at the same >5K threshold (no special-casing)", async () => {
    const t = convexTest(schema, modules);
    const coachId = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_coach_s4",
        email: "coach@s4.test",
        channelPreference: "web",
        timezone: "America/Los_Angeles",
        status: "active",
        plan: "coach",
        createdAt: NOW,
      })
    );
    const managerId = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_mgr_s4",
        email: "manager@s4.test",
        channelPreference: "web",
        timezone: "America/Los_Angeles",
        status: "active",
        plan: "manager",
        createdAt: NOW,
      })
    );

    // Both creators get the SAME small (<5K) profile — gating is purely a
    // budget concern, not a tier feature. Both should skip.
    const smallProfile = {
      ...tiktokProfileFixture,
      stats: { ...tiktokProfileFixture.stats, followerCount: 4_999 },
    };
    let audienceHits = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        if (url.includes("/v1/tiktok/user/audience")) {
          audienceHits++;
          return jsonResp(tiktokAudienceFixture);
        }
        if (url.includes("/v1/tiktok/user/following"))
          return jsonResp(tiktokFollowingFixture);
        if (url.includes("/v1/tiktok/profile")) return jsonResp(smallProfile);
        if (url.includes("/v3/tiktok/profile/videos")) return jsonResp(tiktokPostsFixture);
        if (url.includes("/v1/tiktok/video/comments")) return jsonResp(tiktokCommentsFixture);
        if (url.includes("/v1/tiktok/video/transcript")) return jsonResp(tiktokTranscriptFixture);
        return jsonResp({ error: "unmatched" }, 404);
      })
    );

    await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      { creatorId: coachId, handles: [{ platform: "tiktok", handle: "fitcreator99" }] }
    );
    await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      { creatorId: managerId, handles: [{ platform: "tiktok", handle: "fitcreator99" }] }
    );

    expect(audienceHits).toBe(0);
  });

  it("follower snapshot: re-pull writes a NEW row each time (append-only history)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "s4_snap_history");
    vi.stubGlobal("fetch", makeRouter());

    await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      { creatorId, handles: [{ platform: "tiktok", handle: "fitcreator99" }] }
    );
    await t.action(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      { creatorId, handles: [{ platform: "tiktok", handle: "fitcreator99" }] }
    );

    const snaps = await t.run(async (ctx) =>
      ctx.db
        .query("creatorFollowerSnapshots")
        .withIndex("by_creator_and_platform", (q) =>
          q.eq("creatorId", creatorId).eq("platform", "tiktok")
        )
        .collect()
    );
    expect(snaps.length).toBe(2);
    expect(snaps[0].followerCount).toBe(snaps[1].followerCount);
  });
});
