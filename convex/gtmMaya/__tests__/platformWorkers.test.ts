import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { PER_CALL_COST_USD, rawItemToEvidence } from "../platformWorkers";
import type { ResearchRawItem } from "../scrapeCreatorsGtmResearch";

async function setupJob(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const appId = await authed.mutation(
    api.gtmMaya.researchLifecycle.setAppProfile,
    {
      name: `App for ${subject}`,
      url: `https://${subject}.test`,
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    }
  );
  const jobId = await authed.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 3 }
  );
  return { authed, accountId: started.accountId, jobId };
}

describe("Sprint 4 — rawItemToEvidence (pure)", () => {
  function rawItem(overrides: Partial<ResearchRawItem> = {}): ResearchRawItem {
    return {
      platform: "reddit",
      externalId: "abc",
      url: "https://r.test/p",
      title: "Sample",
      excerpt: "body",
      author: "u",
      createdAtMs: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
      engagement: {
        likes: 10,
        comments: 4,
        shares: null,
        views: null,
        upvotes: 12,
        downvotes: 2,
      },
      tags: ["sub:S"],
      rawRef: "reddit:search:abc123",
      ...overrides,
    };
  }

  it("tags reddit → source:reddit", () => {
    const ev = rawItemToEvidence("reddit", rawItem());
    expect(ev.source).toBe("reddit");
  });

  it("tags twitter → source:x", () => {
    const ev = rawItemToEvidence("twitter", rawItem({ platform: "twitter" }));
    expect(ev.source).toBe("x");
  });

  it("recency=fresh for items <7 days old", () => {
    const fresh = rawItem({ createdAtMs: Date.now() - 2 * 24 * 60 * 60 * 1000 });
    const old = rawItem({ createdAtMs: Date.now() - 120 * 24 * 60 * 60 * 1000 });
    const unknown = rawItem({ createdAtMs: null });
    expect(rawItemToEvidence("reddit", fresh).recency).toBe("fresh");
    expect(rawItemToEvidence("reddit", old).recency).toBe("old");
    expect(rawItemToEvidence("reddit", unknown).recency).toBe("unknown");
  });

  it("scores higher for items with more engagement", () => {
    const low = rawItem({
      engagement: {
        likes: 1,
        comments: 0,
        shares: null,
        views: null,
        upvotes: 1,
        downvotes: null,
      },
    });
    const high = rawItem({
      engagement: {
        likes: 200,
        comments: 50,
        shares: 5,
        views: 5000,
        upvotes: null,
        downvotes: null,
      },
    });
    const lowEv = rawItemToEvidence("reddit", low);
    const highEv = rawItemToEvidence("reddit", high);
    expect(highEv.painMatch).toBeGreaterThan(lowEv.painMatch);
    expect(highEv.painMatch).toBeLessThanOrEqual(1.0);
  });

  it("Reddit promotion risk defaults to medium; Google to low", () => {
    expect(rawItemToEvidence("reddit", rawItem()).promotionRisk).toBe("medium");
    expect(rawItemToEvidence("google", rawItem({ platform: "google" })).promotionRisk).toBe("low");
  });

  it("rawRef is preserved on the evidence card", () => {
    const ev = rawItemToEvidence("reddit", rawItem({ rawRef: "reddit:search:xyz" }));
    expect(ev.rawRef).toBe("reddit:search:xyz");
  });

  it("snippet falls back to title when excerpt is null", () => {
    const ev = rawItemToEvidence(
      "reddit",
      rawItem({ excerpt: null, title: "Only the title" })
    );
    expect(ev.snippet).toBe("Only the title");
  });
});

describe("Sprint 4 — internal mutations", () => {
  it("recordPlatformEvidence rejects cross-tenant insert", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_pw_iso_a");
    const b = await setupJob(t, "u_pw_iso_b");

    await expect(
      t.mutation(internal.gtmMaya.platformWorkers.recordPlatformEvidence, {
        researchJobId: a.jobId,
        accountId: b.accountId, // wrong account!
        cards: [
          {
            source: "reddit",
            url: "https://r.test/x",
            snippet: "should not insert",
            observedAt: Date.now(),
            recency: "fresh",
            painMatch: 0.5,
            buyerMatch: 0.5,
            channelFit: 0.5,
            promotionRisk: "low",
            recommendedUse: "strategy",
            extractedClaims: [],
          },
        ],
      })
    ).rejects.toThrow("does not belong to accountId");
  });

  it("recordPlatformEvidence inserts cards under the correct account", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_pw_insert");
    const ids = await t.mutation(
      internal.gtmMaya.platformWorkers.recordPlatformEvidence,
      {
        researchJobId: a.jobId,
        accountId: a.accountId,
        cards: [
          {
            source: "reddit",
            url: "https://r.test/p1",
            snippet: "real pain",
            observedAt: Date.now(),
            recency: "fresh",
            painMatch: 0.7,
            buyerMatch: 0.6,
            channelFit: 0.8,
            promotionRisk: "medium",
            recommendedUse: "reply",
            extractedClaims: ["pain claim"],
            rawRef: "reddit:search:abc",
          },
        ],
      }
    );
    expect(ids).toHaveLength(1);
  });

  it("recordPlatformCost increments spentUsd on the job for cacheStatus=called", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_pw_cost");
    await t.mutation(internal.gtmMaya.platformWorkers.recordPlatformCost, {
      researchJobId: a.jobId,
      accountId: a.accountId,
      provider: "scrapecreators",
      operation: "reddit.pain",
      reason: "query: how do I X",
      costUsd: 0.01,
      cacheStatus: "called",
    });
    await t.mutation(internal.gtmMaya.platformWorkers.recordPlatformCost, {
      researchJobId: a.jobId,
      accountId: a.accountId,
      provider: "scrapecreators",
      operation: "reddit.solution",
      reason: "query: alternatives",
      costUsd: 0.01,
      cacheStatus: "called",
    });
    const job = await t.run((ctx) => ctx.db.get(a.jobId));
    expect(job?.spentUsd).toBeCloseTo(0.02, 4);
  });

  it("recordPlatformCost does NOT increment spentUsd for cacheStatus=failed", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_pw_cost_failed");
    await t.mutation(internal.gtmMaya.platformWorkers.recordPlatformCost, {
      researchJobId: a.jobId,
      accountId: a.accountId,
      provider: "scrapecreators",
      operation: "reddit.pain",
      reason: "query: failing",
      costUsd: 0,
      cacheStatus: "failed",
    });
    const job = await t.run((ctx) => ctx.db.get(a.jobId));
    expect(job?.spentUsd).toBe(0);
  });
});

describe("Sprint 4 — cost-cost-cap rate table", () => {
  it("every platform has a non-zero per-call cost estimate", () => {
    for (const platform of [
      "reddit",
      "tiktok",
      "twitter",
      "instagram",
      "google",
    ] as const) {
      expect(PER_CALL_COST_USD[platform]).toBeGreaterThan(0);
      expect(PER_CALL_COST_USD[platform]).toBeLessThan(0.05); // sanity
    }
  });
});
