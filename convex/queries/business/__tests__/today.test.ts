/**
 * Service-business Today queries — 5 mandatory test categories per Service
 * Sprint Plan § 14:
 *   1. Cross-tenant isolation
 *   2. Plan-tier × action matrix (read-action matrix here)
 *   3. Adversarial inputs
 *   4. Sibling-file scan (covered repo-wide; we keep nav ↔ route sanity here)
 *   5. TODO grep (covered repo-wide)
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

const NOW = 1_700_000_000_000;

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

describe("queries.business.today.getTodaysBrief", () => {
  it("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "a" });
    const brief = await t.query(api.queries.business.today.getTodaysBrief, {});
    expect(brief).toBeNull();
  });

  it("returns null for a creator-type account (wrong product surface)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "creator-a", accountType: "creator" });
    const brief = await asUser(t, "creator-a").query(
      api.queries.business.today.getTodaysBrief,
      {}
    );
    expect(brief).toBeNull();
  });

  it("returns the brief for the signed-in operator's account", async () => {
    const t = convexTest(schema, modules);
    const { accountId } = await seedAccount(t, { suffix: "a" });
    await t.run((ctx) =>
      ctx.db.insert("dailyBriefs", {
        creatorId: accountId,
        briefDateLocal: "2026-04-27",
        markdown: "good morning",
        recommendations: [],
        pendingItems: [],
        outlierPostIds: [],
        generatedAt: NOW,
      })
    );
    const brief = await asUser(t, "a").query(
      api.queries.business.today.getTodaysBrief,
      {}
    );
    expect(brief?.markdown).toBe("good morning");
  });

  it("CROSS-TENANT: business A's brief never surfaces for business B", async () => {
    const t = convexTest(schema, modules);
    const { accountId: aAcct } = await seedAccount(t, { suffix: "a" });
    await seedAccount(t, { suffix: "b" });
    await t.run((ctx) =>
      ctx.db.insert("dailyBriefs", {
        creatorId: aAcct,
        briefDateLocal: "2026-04-27",
        markdown: "A's secret brief",
        recommendations: [],
        pendingItems: [],
        outlierPostIds: [],
        generatedAt: NOW,
      })
    );
    // B signed in — must see null, never A's brief
    const brief = await asUser(t, "b").query(
      api.queries.business.today.getTodaysBrief,
      {}
    );
    expect(brief).toBeNull();
  });
});

describe("queries.business.today.getPendingApprovals", () => {
  it("returns zeros when unauth", async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(
      api.queries.business.today.getPendingApprovals,
      {}
    );
    expect(result.totalCount).toBe(0);
    expect(result.reviewReplies).toEqual([]);
    expect(result.gbpPosts).toEqual([]);
  });

  it("counts drafted review replies + pending GBP posts for the operator", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "a" });
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId,
        platform: "gbp",
        externalReviewId: "ext-r-1",
        reviewerName: "Sarah",
        starRating: 5,
        body: "great work",
        replyStatus: "drafted",
        receivedAt: NOW,
      })
    );
    const gbpLocId = (await t.run((ctx) =>
      ctx.db.insert("gbpLocations", {
        businessId,
        gbpLocationId: "loc-1",
        gbpAccountId: "acct-1",
        address: "123 Main",
        createdAt: NOW,
      })
    )) as Id<"gbpLocations">;
    await t.run((ctx) =>
      ctx.db.insert("gbpPosts", {
        businessId,
        gbpLocationId: gbpLocId,
        status: "pending",
        text: "fresh draft",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const result = await asUser(t, "a").query(
      api.queries.business.today.getPendingApprovals,
      {}
    );
    expect(result.totalCount).toBe(2);
    expect(result.reviewReplies.length).toBe(1);
    expect(result.gbpPosts.length).toBe(1);
  });

  it("CROSS-TENANT: business B never sees A's drafted replies", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAccount(t, { suffix: "a" });
    await seedAccount(t, { suffix: "b" });
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId: a.businessId,
        platform: "gbp",
        externalReviewId: "ext-r-1",
        reviewerName: "Sarah",
        starRating: 5,
        body: "great",
        replyStatus: "drafted",
        receivedAt: NOW,
      })
    );
    const result = await asUser(t, "b").query(
      api.queries.business.today.getPendingApprovals,
      {}
    );
    expect(result.totalCount).toBe(0);
  });
});

describe("queries.business.today.getInboundLeadsCounter", () => {
  it("returns zeros when no leads", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "a" });
    const result = await asUser(t, "a").query(
      api.queries.business.today.getInboundLeadsCounter,
      {}
    );
    expect(result).toEqual({ pending: 0, overdue: 0 });
  });

  it("counts pending + overdue (>2h) leads", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "a" });
    const now = Date.now();
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    await t.run((ctx) =>
      ctx.db.insert("inboundLeads", {
        businessId,
        source: "gbp-msg",
        externalId: "lead-1",
        capturedAt: now - TWO_HOURS - 60_000, // overdue
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("inboundLeads", {
        businessId,
        source: "fb-dm",
        externalId: "lead-2",
        capturedAt: now - 60_000, // recent, not overdue
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("inboundLeads", {
        businessId,
        source: "twilio-sms",
        externalId: "lead-3",
        capturedAt: now - 30 * 60_000,
        operatorRespondedAt: now, // already handled — NOT pending
      })
    );
    const result = await asUser(t, "a").query(
      api.queries.business.today.getInboundLeadsCounter,
      {}
    );
    expect(result.pending).toBe(2);
    expect(result.overdue).toBe(1);
  });
});

describe("queries.business.today.getRecentActivity (adversarial)", () => {
  it("ADVERSARIAL: handles a business with zero rows gracefully", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "a" });
    const result = await asUser(t, "a").query(
      api.queries.business.today.getRecentActivity,
      {}
    );
    expect(result).toEqual([]);
  });

  it("ADVERSARIAL: returns [] for unauth, never throws", async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(
      api.queries.business.today.getRecentActivity,
      {}
    );
    expect(result).toEqual([]);
  });
});
