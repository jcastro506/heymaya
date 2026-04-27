/**
 * Service-business Reviews / Posts / Customers queries — covers the 3
 * remaining HQ surfaces.
 *
 * 5 mandatory categories: cross-tenant isolation, plan-tier, adversarial,
 * sibling-file (covered repo-wide), TODO grep (covered repo-wide).
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function seed(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "starter" | "pro" | "studio" }
): Promise<{ accountId: Id<"creators">; businessId: Id<"businesses"> }> {
  const accountId = (await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      accountType: "service-business",
      createdAt: NOW,
    })
  )) as Id<"creators">;
  const businessId = (await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId,
      name: `${opts.suffix} biz`,
      serviceTypes: ["plumbing"],
      planTier: opts.plan,
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

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

describe("queries.business.reviews", () => {
  it("listReviews returns [] when unauth", async () => {
    const t = convexTest(schema, modules);
    const r = await t.query(api.queries.business.reviews.listReviews, {});
    expect(r).toEqual([]);
  });

  it("CROSS-TENANT: business B never sees A's reviews", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, { suffix: "a", plan: "pro" });
    await seed(t, { suffix: "b", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId: a.businessId,
        platform: "gbp",
        externalReviewId: "r-1",
        reviewerName: "Alex",
        starRating: 5,
        body: "good",
        receivedAt: NOW,
      })
    );
    const r = await asUser(t, "b").query(
      api.queries.business.reviews.listReviews,
      {}
    );
    expect(r).toEqual([]);
  });

  it("getDraftedReplies filters to drafted-status only", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seed(t, { suffix: "a", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId,
        platform: "gbp",
        externalReviewId: "r-1",
        reviewerName: "Alex",
        starRating: 5,
        body: "good",
        replyStatus: "drafted",
        receivedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId,
        platform: "gbp",
        externalReviewId: "r-2",
        reviewerName: "Sam",
        starRating: 4,
        body: "fine",
        replyStatus: "posted",
        receivedAt: NOW,
      })
    );
    const drafted = await asUser(t, "a").query(
      api.queries.business.reviews.getDraftedReplies,
      {}
    );
    expect(drafted.length).toBe(1);
    expect(drafted[0].externalReviewId).toBe("r-1");
  });

  it("getSentimentTrend buckets by day across last 90d", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seed(t, { suffix: "a", plan: "pro" });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId,
        platform: "gbp",
        externalReviewId: "r-pos-1",
        reviewerName: "Alex",
        starRating: 5,
        body: "great",
        sentiment: "positive",
        receivedAt: now - 1 * 24 * 60 * 60 * 1000,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId,
        platform: "gbp",
        externalReviewId: "r-neg-1",
        reviewerName: "Sam",
        starRating: 1,
        body: "bad",
        sentiment: "negative",
        receivedAt: now - 1 * 24 * 60 * 60 * 1000,
      })
    );
    const trend = await asUser(t, "a").query(
      api.queries.business.reviews.getSentimentTrend,
      {}
    );
    expect(trend.length).toBeGreaterThanOrEqual(1);
    const bucket = trend[trend.length - 1];
    expect(bucket.positive).toBe(1);
    expect(bucket.negative).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Posts + Library                                                             */
/* -------------------------------------------------------------------------- */

describe("queries.business.posts.getRejuvenatorPicks — plan tier", () => {
  it("STARTER: returns [] (no rejuvenator on starter)", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { suffix: "starter", plan: "starter" });
    const out = await asUser(t, "starter").query(
      api.queries.business.posts.getRejuvenatorPicks,
      {}
    );
    expect(out).toEqual([]);
  });

  it("PRO: returns assets list (empty when no library, but path is open)", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { suffix: "pro", plan: "pro" });
    const out = await asUser(t, "pro").query(
      api.queries.business.posts.getRejuvenatorPicks,
      {}
    );
    expect(Array.isArray(out)).toBe(true);
  });
});

describe("queries.business.posts.listAssets", () => {
  it("returns canSeeRejuvenator: false for Starter", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { suffix: "starter", plan: "starter" });
    const out = await asUser(t, "starter").query(
      api.queries.business.posts.listAssets,
      {}
    );
    expect(out.canSeeRejuvenator).toBe(false);
  });

  it("returns canSeeRejuvenator: true for Pro", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { suffix: "pro", plan: "pro" });
    const out = await asUser(t, "pro").query(
      api.queries.business.posts.listAssets,
      {}
    );
    expect(out.canSeeRejuvenator).toBe(true);
  });

  it("CROSS-TENANT: business B never sees A's assets", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, { suffix: "a", plan: "pro" });
    await seed(t, { suffix: "b", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("mediaAssets", {
        businessId: a.businessId,
        storageUrl: "r2://a/photo.jpg",
        storageBytes: 1024,
        mimeType: "image/jpeg",
        source: "imessage",
        receivedAt: NOW,
        catalog: {
          primarySubject: "kitchen",
          serviceCategory: "plumbing",
          visualQuality: "good",
          framingNotes: "well lit",
          suggestedUses: [],
          catalogedAt: NOW,
          catalogModel: "gemini-3-flash",
          catalogCostUsd: 0.001,
        },
        usageHistory: [],
      })
    );
    const out = await asUser(t, "b").query(
      api.queries.business.posts.listAssets,
      {}
    );
    expect(out.rows).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Customers                                                                   */
/* -------------------------------------------------------------------------- */

describe("queries.business.customers", () => {
  it("listCustomers returns [] when unauth", async () => {
    const t = convexTest(schema, modules);
    const out = await t.query(
      api.queries.business.customers.listCustomers,
      {}
    );
    expect(out).toEqual([]);
  });

  it("CROSS-TENANT: getReviewStatusCounts only counts caller's customers", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, { suffix: "a", plan: "pro" });
    await seed(t, { suffix: "b", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId: a.businessId,
        name: "Alice",
        reviewStatus: "asked",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const bCounts = await asUser(t, "b").query(
      api.queries.business.customers.getReviewStatusCounts,
      {}
    );
    expect(bCounts.total).toBe(0);

    const aCounts = await asUser(t, "a").query(
      api.queries.business.customers.getReviewStatusCounts,
      {}
    );
    expect(aCounts.total).toBe(1);
    expect(aCounts.asked).toBe(1);
  });

  it("ADVERSARIAL: nameContains filter is case-insensitive substring match", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seed(t, { suffix: "a", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId,
        name: "Alice Johnson",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const out = await asUser(t, "a").query(
      api.queries.business.customers.listCustomers,
      { nameContains: "alice" }
    );
    expect(out.length).toBe(1);
  });

  it("getCustomer returns null when caller's session is wrong tenant", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, { suffix: "a", plan: "pro" });
    await seed(t, { suffix: "b", plan: "pro" });
    const customerId = (await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId: a.businessId,
        name: "Alice",
        createdAt: NOW,
        updatedAt: NOW,
      })
    )) as Id<"serviceCustomers">;
    const out = await asUser(t, "b").query(
      api.queries.business.customers.getCustomer,
      { businessId: a.businessId, customerId }
    );
    expect(out).toBeNull();
  });
});
