/**
 * Trends queries — Sprint 5 acceptance.
 *
 * Mandatory test categories:
 *   1. Cross-tenant: every query — A never reads B's observations.
 *   2. Plan-tier: competitorWatch + collabMatches + industryIntel are
 *      Pro+ behaviors; Starter sees []. nicheRadar is universal.
 *   3. Adversarial: unauth → []; empty data → []; observations from
 *      unrelated sources don't leak into the wrong tab.
 *   4. Sibling-file scan + 5. TODO grep: covered repo-wide.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";

const NOW = 1_700_000_000_000;
const ONE_DAY_MS = 86_400_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "coach" | "manager" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

async function insertTrend(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  source: "niche-scan" | "platform-wide" | "industry-intel" | "competitor-watch",
  observation: string,
  observedAt: number = NOW,
  relevanceScore: number = 0.6
) {
  return await t.run((ctx) =>
    ctx.db.insert("trendObservations", {
      creatorId,
      source,
      observation,
      evidence: [],
      relevanceScore,
      observedAt,
    })
  );
}

async function insertCompetitorObs(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  peerHandle: string,
  observation: string,
  observedAt: number = NOW
) {
  return await t.run((ctx) =>
    ctx.db.insert("competitorObservations", {
      creatorId,
      peerHandle,
      platform: "tiktok" as const,
      observation,
      evidence: [],
      observedAt,
    })
  );
}

describe("trends.nicheRadar", () => {
  it("returns [] when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const r = await t.query(api.trends.nicheRadar, {});
    expect(r).toEqual([]);
  });

  it("returns niche-scan + platform-wide rows, newest first", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await insertTrend(t, a, "niche-scan", "old", NOW - ONE_DAY_MS);
    await insertTrend(t, a, "platform-wide", "new platform trend", NOW);
    await insertTrend(t, a, "industry-intel", "intel — should not appear", NOW);
    const r = await asUser(t, "a").query(api.trends.nicheRadar, {});
    expect(r.map((x) => x.observation)).toEqual(["new platform trend", "old"]);
  });

  it("CROSS-TENANT: A's niche radar excludes B's observations", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    await insertTrend(t, b, "niche-scan", "B-only");
    const r = await asUser(t, "a").query(api.trends.nicheRadar, {});
    expect(r).toEqual([]);
  });

  it("PLAN-TIER: nicheRadar is universal — Starter sees their own", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "coach" });
    await insertTrend(t, a, "niche-scan", "starter-visible");
    const r = await asUser(t, "a").query(api.trends.nicheRadar, {});
    expect(r).toHaveLength(1);
  });
});

describe("trends.competitorWatch", () => {
  it("PLAN-TIER (REVISED): Starter sees competitor rows — competitorWatchSlots is now 2 (not 0)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "coach" });
    await insertCompetitorObs(t, a, "@peer", "they posted X");
    const r = await asUser(t, "a").query(api.trends.competitorWatch, {});
    expect(r).toHaveLength(1);
    expect(r[0].peerHandle).toBe("@peer");
  });

  it("PLAN-TIER: Pro returns competitor observations", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await insertCompetitorObs(t, a, "@peer", "they posted X");
    const r = await asUser(t, "a").query(api.trends.competitorWatch, {});
    expect(r).toHaveLength(1);
    expect(r[0].peerHandle).toBe("@peer");
  });

  it("CROSS-TENANT: A never sees B's competitor rows", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    await insertCompetitorObs(t, b, "@peerB", "B's intel");
    const r = await asUser(t, "a").query(api.trends.competitorWatch, {});
    expect(r).toEqual([]);
  });
});

describe("trends.collabMatches", () => {
  it("PLAN-TIER (REVISED): Starter sees collab matches — collabMatchEnabled is universal", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "coach" });
    await t.run((ctx) =>
      ctx.db.insert("collabMatchLog", {
        creatorId: a,
        peerHandle: "@peer",
        platform: "tiktok",
        surfacedAt: NOW,
      })
    );
    const r = await asUser(t, "a").query(api.trends.collabMatches, {});
    expect(r).toHaveLength(1);
    expect(r[0].peerHandle).toBe("@peer");
  });

  it("PLAN-TIER: Pro sees pending or unactioned matches; dismissed are filtered", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await t.run((ctx) =>
      ctx.db.insert("collabMatchLog", {
        creatorId: a,
        peerHandle: "@fresh",
        platform: "tiktok",
        surfacedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("collabMatchLog", {
        creatorId: a,
        peerHandle: "@dismissed",
        platform: "tiktok",
        surfacedAt: NOW,
        creatorActedOn: "dismissed",
      })
    );
    const r = await asUser(t, "a").query(api.trends.collabMatches, {});
    expect(r.map((m) => m.peerHandle)).toEqual(["@fresh"]);
  });
});

describe("trends.industryIntel", () => {
  it("PLAN-TIER: Starter returns []", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "coach" });
    await insertTrend(t, a, "industry-intel", "TikTok algo update");
    const r = await asUser(t, "a").query(api.trends.industryIntel, {});
    expect(r).toEqual([]);
  });

  it("PLAN-TIER: Pro returns last-14d industry-intel rows", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    // Use Date.now() for the 14d cutoff (the query uses Date.now()).
    const realNow = Date.now();
    await insertTrend(t, a, "industry-intel", "fresh", realNow - ONE_DAY_MS);
    await insertTrend(t, a, "industry-intel", "stale", realNow - 30 * ONE_DAY_MS);
    const r = await asUser(t, "a").query(api.trends.industryIntel, {});
    expect(r.map((x) => x.observation)).toContain("fresh");
    expect(r.map((x) => x.observation)).not.toContain("stale");
  });

  it("ADVERSARIAL: empty corpus → []", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const r = await asUser(t, "a").query(api.trends.industryIntel, {});
    expect(r).toEqual([]);
  });
});
