/**
 * Sprint 12.7 Phase 1 — get_recent_trends + fetch_trends_live tests.
 *
 * Five mandatory categories all covered here:
 *  1. Cross-tenant — get_recent_trends returns ONLY the creator passed in the
 *     body; trendObservations for sibling creators are never leaked.
 *  2. Plan-tier × action — these endpoints are open to all plan tiers (the
 *     grounding discipline is universal; tier-gating happens at the standing-
 *     order layer, not the API surface). Asserted explicitly so a future
 *     accidental tier-gate is caught.
 *  3. Adversarial — missing/wrong secret → 401; malformed body → 400; missing
 *     creator → 404.
 *  4. Sibling-file scan — endpoints share `assertWebhookSecret` (no duplicate
 *     auth code); fetch_trends_live lazy-imports the ScrapeCreators endpoints
 *     module (no duplicate API client).
 *  5. TODO grep — covered repo-wide.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { _setWebhookSecretForTests } from "../../lib/webhookSecret";

const TEST_SECRET = "deadbeef".repeat(8);
const NOW = 1_700_000_000_000;

vi.mock("../../integrations/scrapeCreators/endpoints", async () => {
  // We don't load the real module — fetch_trends_live calls
  // `tiktok.trendingFeed(region)`, which we stub here. Tests override the
  // implementation via `mockTrendingFeed.mockImplementation` per case.
  return {
    tiktok: {
      trendingFeed: mockTrendingFeed,
    },
  };
});

const mockTrendingFeed = vi.fn();

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "coach" | "manager" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "imessage",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

async function seedTrend(
  t: ReturnType<typeof convexTest>,
  args: {
    creatorId: Id<"creators">;
    source:
      | "niche-scan"
      | "platform-wide"
      | "industry-intel"
      | "competitor-watch"
      | "chat-on-demand";
    observedAt: number;
    observation?: string;
    relevanceScore?: number;
  }
): Promise<Id<"trendObservations">> {
  return await t.run((ctx) =>
    ctx.db.insert("trendObservations", {
      creatorId: args.creatorId,
      source: args.source,
      observation: args.observation ?? `obs ${args.source} @${args.observedAt}`,
      evidence: [
        {
          kind: "post",
          ref: `https://www.tiktok.com/@x/video/${args.observedAt}`,
          fact: `seeded ${args.source}`,
        },
      ],
      relevanceScore: args.relevanceScore ?? 0.7,
      observedAt: args.observedAt,
    })
  );
}

/* -------------------------------------------------------------------------- */
/* get_recent_trends                                                            */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/get_recent_trends", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: returns trendObservations for creator within default 24h window, newest first", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "a", plan: "manager" });
    const now = Date.now();
    // 4 rows: 1h, 6h, 12h, 26h old.
    const ages = [60 * 60_000, 6 * 60 * 60_000, 12 * 60 * 60_000, 26 * 60 * 60_000];
    for (const age of ages) {
      await seedTrend(t, {
        creatorId,
        source: "niche-scan",
        observedAt: now - age,
      });
    }

    const res = await t.fetch("/lc_maya/get_recent_trends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.count).toBe(3); // 1h, 6h, 12h within 24h window — not 26h
    // Newest first
    for (let i = 0; i < json.trends.length - 1; i++) {
      expect(json.trends[i].observedAt).toBeGreaterThan(
        json.trends[i + 1].observedAt
      );
    }
  });

  it("HAPPY: respects custom withinMs window", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "b", plan: "manager" });
    const now = Date.now();
    await seedTrend(t, { creatorId, source: "niche-scan", observedAt: now - 60_000 });
    await seedTrend(t, { creatorId, source: "niche-scan", observedAt: now - 2 * 60 * 60_000 });

    // withinMs = 30 minutes → only the 1-minute row should return.
    const res = await t.fetch("/lc_maya/get_recent_trends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        withinMs: 30 * 60_000,
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(1);
  });

  it("HAPPY: respects source filter", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "c", plan: "manager" });
    const now = Date.now();
    await seedTrend(t, { creatorId, source: "niche-scan", observedAt: now - 60_000 });
    await seedTrend(t, { creatorId, source: "platform-wide", observedAt: now - 60_000 });
    await seedTrend(t, { creatorId, source: "chat-on-demand", observedAt: now - 60_000 });

    const res = await t.fetch("/lc_maya/get_recent_trends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        sources: ["chat-on-demand", "platform-wide"],
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(2);
    const sources = json.trends.map((t: { source: string }) => t.source).sort();
    expect(sources).toEqual(["chat-on-demand", "platform-wide"]);
  });

  it("HAPPY: respects limit", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "d", plan: "manager" });
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await seedTrend(t, {
        creatorId,
        source: "niche-scan",
        observedAt: now - (i + 1) * 60_000,
      });
    }
    const res = await t.fetch("/lc_maya/get_recent_trends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId, limit: 2 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(2);
  });

  it("CROSS-TENANT: trendObservations for creator B never returned when creator A asks", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await insertCreator(t, { suffix: "ta", plan: "manager" });
    const creatorB = await insertCreator(t, { suffix: "tb", plan: "manager" });
    const now = Date.now();
    await seedTrend(t, {
      creatorId: creatorA,
      source: "niche-scan",
      observedAt: now - 60_000,
      observation: "A-specific observation",
    });
    await seedTrend(t, {
      creatorId: creatorB,
      source: "niche-scan",
      observedAt: now - 60_000,
      observation: "B-specific observation",
    });
    const res = await t.fetch("/lc_maya/get_recent_trends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId: creatorA }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(1);
    expect(json.trends[0].observation).toBe("A-specific observation");
  });

  it("PLAN-TIER: both coach and manager creators can call (no plan-gate at API level)", async () => {
    for (const plan of ["coach", "manager"] as const) {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, { suffix: `pt-${plan}`, plan });
      const res = await t.fetch("/lc_maya/get_recent_trends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
      });
      expect(res.status, `plan=${plan}`).toBe(200);
    }
  });

  it("ADVERSARIAL: missing / wrong secret returns 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "adv1", plan: "manager" });
    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/get_recent_trends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: bad, creatorId }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("ADVERSARIAL: malformed body returns 400", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "adv2", plan: "manager" });
    const cases = [
      { body: "not-json", label: "non-json" },
      { body: JSON.stringify({}), label: "missing-secret" },
      { body: JSON.stringify({ secret: TEST_SECRET }), label: "missing-creatorId" },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId, withinMs: -1 }),
        label: "negative-withinMs",
      },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId, withinMs: "1h" }),
        label: "string-withinMs",
      },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId, limit: 999 }),
        label: "over-cap-limit",
      },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId, limit: 0 }),
        label: "zero-limit",
      },
      {
        body: JSON.stringify({
          secret: TEST_SECRET,
          creatorId,
          sources: ["unknown-source"],
        }),
        label: "bad-source",
      },
    ];
    for (const { body, label } of cases) {
      const res = await t.fetch("/lc_maya/get_recent_trends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status, `case=${label}`).toBe(400);
    }
  });

  it("ADVERSARIAL: creator-not-found returns 404", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "advm", plan: "manager" });
    await t.run((ctx) => ctx.db.delete(creatorId));
    const res = await t.fetch("/lc_maya/get_recent_trends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* fetch_trends_live                                                            */
/* -------------------------------------------------------------------------- */

const stubTrendingFeedResponse = {
  source: "tiktok_trending_feed",
  query: { region: "US" },
  posts: [
    {
      platform: "tiktok" as const,
      postId: "p1",
      url: "https://www.tiktok.com/@alpha/video/p1",
      caption: "the deadpan POV thing",
      postedAt: 1_700_001_000_000,
      metrics: {
        likeCount: 12345,
        commentCount: 220,
        viewCount: 410_000,
        shareCount: 80,
        saveCount: 40,
      },
      mediaType: "video" as const,
      thumbnailUrl: null,
      videoUrl: "https://cdn/p1.mp4",
      videoDurationSec: 12,
      raw: {},
    },
    {
      platform: "tiktok" as const,
      postId: "p2",
      url: "https://www.tiktok.com/@beta/video/p2",
      caption: "walking monologue",
      postedAt: 1_700_002_000_000,
      metrics: {
        likeCount: 55_000,
        commentCount: 1_200,
        viewCount: 2_100_000,
        shareCount: 400,
        saveCount: 200,
      },
      mediaType: "video" as const,
      thumbnailUrl: null,
      videoUrl: "https://cdn/p2.mp4",
      videoDurationSec: 32,
      raw: {},
    },
  ],
  raw: {},
};

describe("POST /lc_maya/fetch_trends_live", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
    mockTrendingFeed.mockReset();
    mockTrendingFeed.mockResolvedValue(stubTrendingFeedResponse);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: returns the stubbed trendingFeed posts with normalized fields", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "fl1", plan: "manager" });
    const res = await t.fetch("/lc_maya/fetch_trends_live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.platform).toBe("tiktok");
    expect(json.region).toBe("US");
    expect(json.count).toBe(2);
    expect(json.candidates[0]).toMatchObject({
      url: "https://www.tiktok.com/@alpha/video/p1",
      caption: "the deadpan POV thing",
      viewCount: 410_000,
    });
    expect(mockTrendingFeed).toHaveBeenCalledWith("US");
  });

  it("HAPPY: limit caps the candidate count", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "fl2", plan: "manager" });
    const res = await t.fetch("/lc_maya/fetch_trends_live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId, limit: 1 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(1);
    expect(json.candidates).toHaveLength(1);
  });

  it("HAPPY: custom region propagates to ScrapeCreators call", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "fl3", plan: "manager" });
    const res = await t.fetch("/lc_maya/fetch_trends_live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId, region: "GB" }),
    });
    expect(res.status).toBe(200);
    expect(mockTrendingFeed).toHaveBeenCalledWith("GB");
  });

  it("CROSS-TENANT: still 404s on a deleted creator even though scrape would succeed", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "fl4", plan: "manager" });
    await t.run((ctx) => ctx.db.delete(creatorId));
    const res = await t.fetch("/lc_maya/fetch_trends_live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(404);
    expect(mockTrendingFeed).not.toHaveBeenCalled();
  });

  it("PLAN-TIER: both coach and manager creators can call (API surface is open)", async () => {
    for (const plan of ["coach", "manager"] as const) {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, { suffix: `fl-pt-${plan}`, plan });
      const res = await t.fetch("/lc_maya/fetch_trends_live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
      });
      expect(res.status, `plan=${plan}`).toBe(200);
    }
  });

  it("ADVERSARIAL: missing / wrong secret returns 401", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "fl5", plan: "manager" });
    for (const bad of ["", "wrong", `${TEST_SECRET}x`]) {
      const res = await t.fetch("/lc_maya/fetch_trends_live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: bad, creatorId }),
      });
      expect(res.status).toBe(401);
    }
    expect(mockTrendingFeed).not.toHaveBeenCalled();
  });

  it("ADVERSARIAL: malformed body returns 400", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "fl6", plan: "manager" });
    const cases = [
      { body: "not-json", label: "non-json" },
      { body: JSON.stringify({}), label: "missing-secret" },
      { body: JSON.stringify({ secret: TEST_SECRET }), label: "missing-creatorId" },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId, platform: "twitter" }),
        label: "unsupported-platform",
      },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId, region: "" }),
        label: "empty-region",
      },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId, limit: 0 }),
        label: "zero-limit",
      },
      {
        body: JSON.stringify({ secret: TEST_SECRET, creatorId, limit: 200 }),
        label: "over-cap-limit",
      },
    ];
    for (const { body, label } of cases) {
      const res = await t.fetch("/lc_maya/fetch_trends_live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status, `case=${label}`).toBe(400);
    }
  });

  it("ADVERSARIAL: creator-not-found returns 404", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "fl7", plan: "manager" });
    await t.run((ctx) => ctx.db.delete(creatorId));
    const res = await t.fetch("/lc_maya/fetch_trends_live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TEST_SECRET, creatorId }),
    });
    expect(res.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* log_trend — accepts new `chat-on-demand` source                              */
/* -------------------------------------------------------------------------- */

describe("POST /lc_maya/log_trend — chat-on-demand source (Sprint 12.7)", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("HAPPY: persists `chat-on-demand` survivors with full evidence + score", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "cod", plan: "manager" });
    const res = await t.fetch("/lc_maya/log_trend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: TEST_SECRET,
        creatorId,
        source: "chat-on-demand",
        observation: "the deadpan POV pattern fits your voice",
        evidence: [
          {
            kind: "post",
            ref: "https://www.tiktok.com/@alpha/video/p1",
            fact: "viewCount 410k, format matches creator's handheld POV",
          },
        ],
        relevanceScore: 0.91,
      }),
    });
    expect(res.status).toBe(200);
    const row = await t.run((ctx) =>
      ctx.db
        .query("trendObservations")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first()
    );
    expect(row?.source).toBe("chat-on-demand");
    expect(row?.evidence[0]?.ref).toBe("https://www.tiktok.com/@alpha/video/p1");
  });
});
