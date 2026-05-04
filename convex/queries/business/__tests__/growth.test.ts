/**
 * Service-business Growth queries (Wave C.7) — 5 mandatory test categories
 * per Service Sprint Plan § 14, plus the Wave C.7-specific judgment-not-
 * rules invariant:
 *
 *   1. Cross-tenant isolation
 *   2. Plan-tier × action matrix (window clamp + breakdown gate)
 *   3. Adversarial inputs
 *   4. Sibling-file scan (NAV order, mobile-bottom-nav count, standing-
 *      orders array length === 15)
 *   5. No-straggler-markers grep (the cat-5 mandatory category)
 *   6. Judgment-not-rules invariant — growth.ts exports no compute*Score /
 *      rank* / rate* helpers
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

const NOW = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function seedAccount(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    accountType?: "creator" | "service-business";
    plan?: "starter" | "pro" | "studio";
  }
): Promise<{ accountId: Id<"creators">; businessId: Id<"businesses"> }> {
  const accountId = (await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "coach",
      accountType: opts.accountType ?? "service-business",
      createdAt: NOW,
    })
  )) as Id<"creators">;

  const businessId = (await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId,
      name: `${opts.suffix} biz`,
      serviceTypes: ["plumbing"],
      planTier: opts.plan ?? "pro",
      createdAt: NOW,
      updatedAt: NOW,
    })
  )) as Id<"businesses">;

  await t.run((ctx) => ctx.db.patch(accountId, { businessId }));
  return { accountId, businessId };
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

/* ────────────────────────────────────────────────────────────────────── */
/* getGrowthSummary                                                       */
/* ────────────────────────────────────────────────────────────────────── */

describe("queries.business.growth.getGrowthSummary", () => {
  it("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "a" });
    const result = await t.query(
      api.queries.business.growth.getGrowthSummary,
      { window: "30d" }
    );
    expect(result).toBeNull();
  });

  it("returns null for a creator-type account (wrong product surface)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "creator-a", accountType: "creator" });
    const result = await asUser(t, "creator-a").query(
      api.queries.business.growth.getGrowthSummary,
      { window: "30d" }
    );
    expect(result).toBeNull();
  });

  it("returns zero metrics for an empty business (Day-0 stage)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "a" });
    const result = await asUser(t, "a").query(
      api.queries.business.growth.getGrowthSummary,
      { window: "30d" }
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.window).toBe("30d");
    expect(result.clampedFromRequestedWindow).toBeNull();
    for (const m of result.metrics) {
      expect(m.value).toBe(0);
    }
  });

  it("PLAN-TIER: Starter requesting 90d gets clamped to 30d with a clamp signal", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "starter-a", plan: "starter" });
    const result = await asUser(t, "starter-a").query(
      api.queries.business.growth.getGrowthSummary,
      { window: "90d" }
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.window).toBe("30d");
    expect(result.clampedFromRequestedWindow).toBe("90d");
    expect(result.plan).toBe("starter");
  });

  it("PLAN-TIER: Starter requesting YTD also clamps to 30d", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "starter-a", plan: "starter" });
    const result = await asUser(t, "starter-a").query(
      api.queries.business.growth.getGrowthSummary,
      { window: "ytd" }
    );
    expect(result?.window).toBe("30d");
    expect(result?.clampedFromRequestedWindow).toBe("ytd");
  });

  it("PLAN-TIER: Pro requesting 90d gets the unclamped window", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "pro-a", plan: "pro" });
    const result = await asUser(t, "pro-a").query(
      api.queries.business.growth.getGrowthSummary,
      { window: "90d" }
    );
    expect(result?.window).toBe("90d");
    expect(result?.clampedFromRequestedWindow).toBeNull();
  });

  it("PLAN-TIER: Studio gets unclamped YTD", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "studio-a", plan: "studio" });
    const result = await asUser(t, "studio-a").query(
      api.queries.business.growth.getGrowthSummary,
      { window: "ytd" }
    );
    expect(result?.window).toBe("ytd");
    expect(result?.clampedFromRequestedWindow).toBeNull();
  });

  it("counts jobs / 5-stars in window + period-over-period priors", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "a" });
    const now = Date.now();
    // job in current 30d window
    await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId,
        status: "completed",
        scheduledAt: now - 5 * ONE_DAY_MS,
        photos: [],
        createdAt: now - 5 * ONE_DAY_MS,
        updatedAt: now - 5 * ONE_DAY_MS,
      })
    );
    // job in prior 30d window
    await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId,
        status: "completed",
        scheduledAt: now - 35 * ONE_DAY_MS,
        photos: [],
        createdAt: now - 35 * ONE_DAY_MS,
        updatedAt: now - 35 * ONE_DAY_MS,
      })
    );
    // 5-star in window
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId,
        platform: "gbp",
        externalReviewId: "ext-r-1",
        reviewerName: "Sarah",
        starRating: 5,
        body: "great work",
        receivedAt: now - 2 * ONE_DAY_MS,
      })
    );
    const result = await asUser(t, "a").query(
      api.queries.business.growth.getGrowthSummary,
      { window: "30d" }
    );
    expect(result).not.toBeNull();
    if (!result) return;
    const jobs = result.metrics.find((m) => m.key === "jobsBooked");
    expect(jobs?.value).toBe(1);
    expect(jobs?.priorValue).toBe(1);
    const fives = result.metrics.find((m) => m.key === "fiveStarReviews");
    expect(fives?.value).toBe(1);
  });

  it("attributes jobs that have originatingLeadId set", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "a" });
    const now = Date.now();
    const leadId = (await t.run((ctx) =>
      ctx.db.insert("inboundLeads", {
        businessId,
        source: "gbp-msg",
        externalId: "lead-1",
        capturedAt: now - 7 * ONE_DAY_MS,
      })
    )) as Id<"inboundLeads">;
    // attributed job
    await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId,
        status: "completed",
        scheduledAt: now - 6 * ONE_DAY_MS,
        photos: [],
        createdAt: now - 6 * ONE_DAY_MS,
        updatedAt: now - 6 * ONE_DAY_MS,
        originatingLeadId: leadId,
      })
    );
    // unattributed job
    await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId,
        status: "completed",
        scheduledAt: now - 5 * ONE_DAY_MS,
        photos: [],
        createdAt: now - 5 * ONE_DAY_MS,
        updatedAt: now - 5 * ONE_DAY_MS,
      })
    );
    const result = await asUser(t, "a").query(
      api.queries.business.growth.getGrowthSummary,
      { window: "30d" }
    );
    const jobs = result?.metrics.find((m) => m.key === "jobsBooked");
    expect(jobs?.value).toBe(2);
    expect(jobs?.attributedToMaya).toBe(1);
  });

  it("CROSS-TENANT: business B never sees A's jobs / reviews / leads", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAccount(t, { suffix: "a" });
    await seedAccount(t, { suffix: "b" });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId: a.businessId,
        status: "completed",
        scheduledAt: now - 5 * ONE_DAY_MS,
        photos: [],
        createdAt: now - 5 * ONE_DAY_MS,
        updatedAt: now - 5 * ONE_DAY_MS,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId: a.businessId,
        platform: "gbp",
        externalReviewId: "ext-r-1",
        reviewerName: "Sarah",
        starRating: 5,
        body: "secret",
        receivedAt: now - 2 * ONE_DAY_MS,
      })
    );
    const result = await asUser(t, "b").query(
      api.queries.business.growth.getGrowthSummary,
      { window: "30d" }
    );
    expect(result).not.toBeNull();
    if (!result) return;
    for (const m of result.metrics) {
      expect(m.value).toBe(0);
    }
  });

  it("ADVERSARIAL: empty business with no rows returns zeros, not undefineds", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "a" });
    const result = await asUser(t, "a").query(
      api.queries.business.growth.getGrowthSummary,
      { window: "7d" }
    );
    expect(result).not.toBeNull();
    if (!result) return;
    for (const m of result.metrics) {
      expect(m.value).toBe(0);
      expect(m.attributedToMaya === null || m.attributedToMaya === 0).toBe(
        true
      );
    }
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* getMayaContributionThisWeek                                            */
/* ────────────────────────────────────────────────────────────────────── */

describe("queries.business.growth.getMayaContributionThisWeek", () => {
  it("returns null when unauth", async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(
      api.queries.business.growth.getMayaContributionThisWeek,
      {}
    );
    expect(result).toBeNull();
  });

  it("returns zeros for a brand new business with no actions", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "a" });
    const result = await asUser(t, "a").query(
      api.queries.business.growth.getMayaContributionThisWeek,
      {}
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.jobsAttributedCount).toBe(0);
    expect(result.fiveStarReviewsAttributedCount).toBe(0);
    expect(result.gbpHealthScore).toBeNull();
    expect(result.gbpHealthScoreReasoning).toBeNull();
  });

  it("counts attributed jobs + 5-stars in the rolling 7d window", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "a" });
    const now = Date.now();
    // attributed job in week
    const leadId = (await t.run((ctx) =>
      ctx.db.insert("inboundLeads", {
        businessId,
        source: "gbp-msg",
        externalId: "lead-1",
        capturedAt: now - 3 * ONE_DAY_MS,
      })
    )) as Id<"inboundLeads">;
    await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId,
        status: "completed",
        scheduledAt: now - 2 * ONE_DAY_MS,
        photos: [],
        createdAt: now - 2 * ONE_DAY_MS,
        updatedAt: now - 2 * ONE_DAY_MS,
        originatingLeadId: leadId,
      })
    );
    // attributed 5-star in week
    const reviewId = (await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId,
        platform: "gbp",
        externalReviewId: "ext-r-1",
        reviewerName: "Sarah",
        starRating: 5,
        body: "great",
        receivedAt: now - ONE_DAY_MS,
      })
    )) as Id<"reviews">;
    const customerId = (await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId,
        name: "Sarah",
        createdAt: now,
        updatedAt: now,
      })
    )) as Id<"serviceCustomers">;
    const jobId = (await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId,
        status: "completed",
        completedAt: now - 4 * ONE_DAY_MS,
        photos: [],
        createdAt: now - 4 * ONE_DAY_MS,
        updatedAt: now - 4 * ONE_DAY_MS,
      })
    )) as Id<"serviceJobs">;
    await t.run((ctx) =>
      ctx.db.insert("reviewRequests", {
        businessId,
        jobId,
        customerId,
        channel: "sms",
        status: "completed",
        sentAt: now - 2 * ONE_DAY_MS,
        followupCount: 0,
        createdAt: now - 2 * ONE_DAY_MS,
        attributedReviewId: reviewId,
      })
    );

    const result = await asUser(t, "a").query(
      api.queries.business.growth.getMayaContributionThisWeek,
      {}
    );
    expect(result?.jobsAttributedCount).toBe(1);
    expect(result?.fiveStarReviewsAttributedCount).toBe(1);
  });

  it("surfaces the latest gbpHealthScore + reasoning verbatim", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "a" });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("gbpHealthScores", {
        businessId,
        scoreAt: now - 60_000,
        compositeScore: 78,
        reasoning: "Maya's verbatim reasoning string",
        nudgesPending: 2,
        model: "gemini-3-flash",
        thinkingBudget: "high",
      })
    );
    // newer row should win
    await t.run((ctx) =>
      ctx.db.insert("gbpHealthScores", {
        businessId,
        scoreAt: now,
        compositeScore: 81,
        reasoning: "Latest reasoning",
        nudgesPending: 1,
        model: "gemini-3-flash",
        thinkingBudget: "high",
      })
    );
    const result = await asUser(t, "a").query(
      api.queries.business.growth.getMayaContributionThisWeek,
      {}
    );
    expect(result?.gbpHealthScore).toBe(81);
    expect(result?.gbpHealthScoreReasoning).toBe("Latest reasoning");
  });

  it("CROSS-TENANT: B never sees A's contribution", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAccount(t, { suffix: "a" });
    await seedAccount(t, { suffix: "b" });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("gbpHealthScores", {
        businessId: a.businessId,
        scoreAt: now,
        compositeScore: 99,
        reasoning: "A only",
        nudgesPending: 0,
        model: "gemini-3-flash",
        thinkingBudget: "high",
      })
    );
    const result = await asUser(t, "b").query(
      api.queries.business.growth.getMayaContributionThisWeek,
      {}
    );
    expect(result?.gbpHealthScore).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* getGbpHealthScoreLatest                                                */
/* ────────────────────────────────────────────────────────────────────── */

describe("queries.business.growth.getGbpHealthScoreLatest", () => {
  it("returns null when no audit has run", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "a" });
    const result = await asUser(t, "a").query(
      api.queries.business.growth.getGbpHealthScoreLatest,
      {}
    );
    expect(result).toBeNull();
  });

  it("returns Maya's score + reasoning verbatim", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "a" });
    await t.run((ctx) =>
      ctx.db.insert("gbpHealthScores", {
        businessId,
        scoreAt: Date.now(),
        compositeScore: 65,
        reasoning: "Posts are sparse; reviews healthy.",
        nudgesPending: 3,
        model: "gemini-3-flash",
        thinkingBudget: "high",
      })
    );
    const result = await asUser(t, "a").query(
      api.queries.business.growth.getGbpHealthScoreLatest,
      {}
    );
    expect(result?.score.compositeScore).toBe(65);
    expect(result?.score.reasoning).toBe("Posts are sparse; reviews healthy.");
    expect(result?.score.nudgesPending).toBe(3);
  });

  it("CROSS-TENANT: B doesn't see A's GBP score", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAccount(t, { suffix: "a" });
    await seedAccount(t, { suffix: "b" });
    await t.run((ctx) =>
      ctx.db.insert("gbpHealthScores", {
        businessId: a.businessId,
        scoreAt: Date.now(),
        compositeScore: 50,
        reasoning: "A only",
        nudgesPending: 0,
        model: "gemini-3-flash",
        thinkingBudget: "high",
      })
    );
    const result = await asUser(t, "b").query(
      api.queries.business.growth.getGbpHealthScoreLatest,
      {}
    );
    expect(result).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* getCustomerProvenance                                                  */
/* ────────────────────────────────────────────────────────────────────── */

describe("queries.business.growth.getCustomerProvenance", () => {
  it("returns null for a customer with no matching lead", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "a" });
    const customerId = (await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId,
        name: "No Match Person",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    )) as Id<"serviceCustomers">;
    const result = await asUser(t, "a").query(
      api.queries.business.growth.getCustomerProvenance,
      { customerId }
    );
    expect(result).toBeNull();
  });

  it("resolves the chain when a lead matches by phone", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "a" });
    const now = Date.now();
    const customerId = (await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId,
        name: "Sarah Smith",
        phone: "+15551234567",
        createdAt: now,
        updatedAt: now,
      })
    )) as Id<"serviceCustomers">;
    const gbpLocId = (await t.run((ctx) =>
      ctx.db.insert("gbpLocations", {
        businessId,
        gbpLocationId: "loc-1",
        gbpAccountId: "acct-1",
        address: "123 Main",
        createdAt: now,
      })
    )) as Id<"gbpLocations">;
    const postId = (await t.run((ctx) =>
      ctx.db.insert("gbpPosts", {
        businessId,
        gbpLocationId: gbpLocId,
        status: "posted",
        text: "We just finished a kitchen sink swap on Main St.",
        postedAt: now - 3 * ONE_DAY_MS,
        createdAt: now - 3 * ONE_DAY_MS,
        updatedAt: now - 3 * ONE_DAY_MS,
      })
    )) as Id<"gbpPosts">;
    const leadId = (await t.run((ctx) =>
      ctx.db.insert("inboundLeads", {
        businessId,
        source: "gbp-msg",
        externalId: "lead-1",
        contactPhone: "+15551234567",
        capturedAt: now - 2 * ONE_DAY_MS,
        originatingActionKind: "gbp-post",
        originatingActionId: postId,
      })
    )) as Id<"inboundLeads">;
    const jobId = (await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId,
        status: "completed",
        completedAt: now - ONE_DAY_MS,
        serviceType: "kitchen-sink",
        photos: [],
        createdAt: now - ONE_DAY_MS,
        updatedAt: now - ONE_DAY_MS,
        originatingLeadId: leadId,
      })
    )) as Id<"serviceJobs">;
    await t.run((ctx) =>
      ctx.db.patch(leadId, { convertedJobId: jobId })
    );

    const result = await asUser(t, "a").query(
      api.queries.business.growth.getCustomerProvenance,
      { customerId }
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.lead.id).toBe(leadId);
    expect(result.action?.kind).toBe("gbp-post");
    expect(result.action?.summary).toContain("kitchen sink");
    expect(result.convertedJob?.id).toBe(jobId);
    expect(result.convertedJob?.serviceType).toBe("kitchen-sink");
  });

  it("ADVERSARIAL: customerId from a different tenant returns null (not throw)", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAccount(t, { suffix: "a" });
    await seedAccount(t, { suffix: "b" });
    const now = Date.now();
    const aCustomerId = (await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId: a.businessId,
        name: "A's Customer",
        createdAt: now,
        updatedAt: now,
      })
    )) as Id<"serviceCustomers">;
    // B signed in, requests A's customerId.
    const result = await asUser(t, "b").query(
      api.queries.business.growth.getCustomerProvenance,
      { customerId: aCustomerId }
    );
    expect(result).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* getAttributionBreakdown — Pro/Studio only                              */
/* ────────────────────────────────────────────────────────────────────── */

describe("queries.business.growth.getAttributionBreakdown", () => {
  it("PLAN-TIER: Starter gets null (server-side gate)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "starter-a", plan: "starter" });
    const result = await asUser(t, "starter-a").query(
      api.queries.business.growth.getAttributionBreakdown,
      { window: "30d" }
    );
    expect(result).toBeNull();
  });

  it("PLAN-TIER: Pro gets a populated breakdown", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "pro-a", plan: "pro" });
    const now = Date.now();
    const leadId = (await t.run((ctx) =>
      ctx.db.insert("inboundLeads", {
        businessId,
        source: "gbp-msg",
        externalId: "lead-1",
        capturedAt: now - 3 * ONE_DAY_MS,
        originatingActionKind: "gbp-post",
        originatingActionId: "stub",
      })
    )) as Id<"inboundLeads">;
    await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId,
        status: "completed",
        completedAt: now - 2 * ONE_DAY_MS,
        photos: [],
        createdAt: now - 2 * ONE_DAY_MS,
        updatedAt: now - 2 * ONE_DAY_MS,
        originatingLeadId: leadId,
      })
    );
    const result = await asUser(t, "pro-a").query(
      api.queries.business.growth.getAttributionBreakdown,
      { window: "30d" }
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.jobsByActionKind["gbp-post"]).toBe(1);
    expect(result.window).toBe("30d");
  });

  it("PLAN-TIER: Studio also gets a breakdown", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "studio-a", plan: "studio" });
    const result = await asUser(t, "studio-a").query(
      api.queries.business.growth.getAttributionBreakdown,
      { window: "30d" }
    );
    expect(result).not.toBeNull();
  });

  it("CROSS-TENANT: B never sees A's breakdown", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAccount(t, { suffix: "pro-a", plan: "pro" });
    await seedAccount(t, { suffix: "pro-b", plan: "pro" });
    const now = Date.now();
    const leadId = (await t.run((ctx) =>
      ctx.db.insert("inboundLeads", {
        businessId: a.businessId,
        source: "gbp-msg",
        externalId: "lead-1",
        capturedAt: now - 3 * ONE_DAY_MS,
        originatingActionKind: "review-request",
        originatingActionId: "stub",
      })
    )) as Id<"inboundLeads">;
    await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId: a.businessId,
        status: "completed",
        completedAt: now - 2 * ONE_DAY_MS,
        photos: [],
        createdAt: now - 2 * ONE_DAY_MS,
        updatedAt: now - 2 * ONE_DAY_MS,
        originatingLeadId: leadId,
      })
    );
    const result = await asUser(t, "pro-b").query(
      api.queries.business.growth.getAttributionBreakdown,
      { window: "30d" }
    );
    expect(result).not.toBeNull();
    if (!result) return;
    for (const v of Object.values(result.jobsByActionKind)) {
      expect(v).toBe(0);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* getLatestWeeklyLearnings — Pro/Studio only                             */
/* ────────────────────────────────────────────────────────────────────── */

describe("queries.business.growth.getLatestWeeklyLearnings", () => {
  it("PLAN-TIER: Starter gets null", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "starter-a", plan: "starter" });
    const result = await asUser(t, "starter-a").query(
      api.queries.business.growth.getLatestWeeklyLearnings,
      {}
    );
    expect(result).toBeNull();
  });

  it("Pro returns the latest learnings row", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "pro-a", plan: "pro" });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("weeklyLearnings", {
        businessId,
        weekStartMs: now - 7 * ONE_DAY_MS,
        weekEndMs: now,
        synthesizedAt: now,
        topPatterns: [
          {
            kind: "review-request-channel",
            claim: "SMS review requests convert at 2.3x email",
            sampleSize: 8,
            jobsAttributed: 0,
            fiveStarsAttributed: 5,
            confidence: 0.82,
            wikiVaultPath: "concepts/what-works/gbp/sms-vs-email.md",
          },
        ],
      })
    );
    const result = await asUser(t, "pro-a").query(
      api.queries.business.growth.getLatestWeeklyLearnings,
      {}
    );
    expect(result?.topPatterns.length).toBe(1);
    expect(result?.topPatterns[0].claim).toContain("SMS");
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* SIBLING-FILE SCAN — NAV order, mobile nav count, standing-orders lock  */
/* ────────────────────────────────────────────────────────────────────── */

describe("Wave C.7 sibling-file scan", () => {
  it("NAV array places Growth between Today and Jobs", async () => {
    const navModule = await import("../../../../app/(business)/_nav");
    const labels = navModule.NAV.map((n) => n.label);
    expect(labels[0]).toBe("Today");
    expect(labels[1]).toBe("Growth");
    expect(labels[2]).toBe("Jobs");
  });

  it("Mobile bottom nav has 6 items (Profile collapsed off mobile)", async () => {
    const navModule = await import("../../../../app/(business)/_nav");
    const mobile = navModule.NAV.filter((n) => !n.mobileHidden);
    expect(mobile.length).toBe(6);
  });

  it("Total NAV has 7 items (6 mobile + 1 mobile-hidden Profile)", async () => {
    const navModule = await import("../../../../app/(business)/_nav");
    expect(navModule.NAV.length).toBe(7);
  });

  it("Service standing orders array length stays locked at 15", async () => {
    const { SERVICE_STANDING_ORDERS } = await import(
      "../../../agents/packs/maya_service/standingOrders"
    );
    expect(SERVICE_STANDING_ORDERS.length).toBe(15);
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* No-stragglers grep + judgment-not-rules invariant                       */
/*                                                                         */
/* Note: this test file is intentionally NOT in the scan matrix — a test   */
/* that asserts "no occurrence of substring X" cannot test itself without  */
/* the assertion strings tripping the assertion. The test file has zero    */
/* runtime ban-words substantively (no eslint-disables, no actual          */
/* code-marker comments) — only substrings inside RegExp literals and      */
/* test-name strings, which are necessary to express the test.             */
/* ────────────────────────────────────────────────────────────────────── */

describe("Wave C.7 file-level invariants", () => {
  const filesUnderTest = [
    "convex/queries/business/growth.ts",
    "components/business/growth/MetricCard.tsx",
    "components/business/growth/MetricsGrid.tsx",
    "components/business/growth/GrowthHeader.tsx",
    "components/business/growth/GbpHealthDrilldown.tsx",
    "components/business/growth/LearningsCallout.tsx",
    "components/business/growth/MayaContributionCard.tsx",
    "components/business/growth/CustomerProvenanceChain.tsx",
    "app/(business)/biz/growth/page.tsx",
    "app/(business)/_nav.ts",
  ];

  for (const rel of filesUnderTest) {
    it(`no straggler markers in ${rel}`, () => {
      const abs = resolve(__dirname, "../../../..", rel);
      const src = readFileSync(abs, "utf8");
      // Construct ban-word regexes at runtime so the source of THIS test
      // file does not contain them as plain literals (which would cause
      // any future scan that includes this test file to trip on itself).
      const todoBan = new RegExp("\\b" + "TO" + "DO" + "\\b");
      const fixmeBan = new RegExp("\\b" + "FIX" + "ME" + "\\b");
      const eslintBan = new RegExp("//\\s*es" + "lint-disable");
      expect(src).not.toMatch(todoBan);
      expect(src).not.toMatch(fixmeBan);
      expect(src).not.toMatch(eslintBan);
    });
  }

  it("JUDGMENT-NOT-RULES: growth.ts exports no compute*Score / rank* / rate* helpers", () => {
    const abs = resolve(__dirname, "../../../..", "convex/queries/business/growth.ts");
    const src = readFileSync(abs, "utf8");
    // Ban functions whose names suggest they synthesize a score/rating/rank.
    // The display score MUST come from `gbpHealthScores.compositeScore` —
    // Maya's persisted judgment — not a helper here.
    expect(src).not.toMatch(/function\s+compute\w*Score\b/);
    expect(src).not.toMatch(/function\s+calculate\w*Score\b/);
    expect(src).not.toMatch(/function\s+rank\w+\(/);
    expect(src).not.toMatch(/function\s+rate\w+\(/);
    // Sanity check: the file DOES read compositeScore from the persisted row
    // (grounding the score-on-display in Maya's judgment).
    expect(src).toMatch(/compositeScore/);
  });
});
