/**
 * Wave C.5 — attribution layer tests.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: linking a Business A lead to a Business B job throws.
 *   2. Plan-tier × action: attribution writes succeed at every tier (no
 *      gating; runs are observability writes).
 *   3. Adversarial:
 *      - Replay (idempotent): re-applying same link is a no-op.
 *      - Self-link refused (except lead-nudge).
 *      - Silent overwrite refused — explicit clearAttribution required.
 *      - Job/lead from different businesses refused.
 *   4. Sibling-file scan: covered by separate sibling tests.
 *   5. TODO grep: separate file.
 *   Outcome-specific:
 *      - Attribution chain integrity: post → lead → job round-trips cleanly.
 *      - Lead → action with kind=none accepts arbitrary string sentinels.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function seedBusiness(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  plan: "starter" | "pro" | "studio" = "pro"
): Promise<Id<"businesses">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `clerk_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "sms",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "coach",
      accountType: "service-business",
      createdAt: NOW,
    });
    const businessId = await ctx.db.insert("businesses", {
      accountId,
      name: `Test Business ${suffix}`,
      serviceTypes: ["hvac"],
      serviceAreaPolygon: [],
      ticketSizeBucket: "200-500",
      businessSize: "solo",
      tonePreference: "friendly-neighborhood",
      responseSpeed: "within-30-min",
      voiceEnabled: false,
      planTier: plan,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.patch(accountId, { businessId });
    return businessId as Id<"businesses">;
  });
}

async function seedLead(
  t: ReturnType<typeof convexTest>,
  businessId: Id<"businesses">,
  suffix: string
): Promise<Id<"inboundLeads">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("inboundLeads", {
      businessId,
      source: "gbp-msg",
      externalId: `ext_${suffix}`,
      capturedAt: NOW,
    });
  });
}

async function seedPost(
  t: ReturnType<typeof convexTest>,
  businessId: Id<"businesses">,
  suffix: string
): Promise<Id<"gbpPosts">> {
  return await t.run(async (ctx) => {
    const gbpLocationId = await ctx.db.insert("gbpLocations", {
      businessId,
      gbpLocationId: `loc_${suffix}`,
      gbpAccountId: `acc_${suffix}`,
      address: "123 Main",
      primaryCategory: "HVAC",
      verifiedAt: NOW,
      ownerEmail: "owner@x.com",
      createdAt: NOW,
    });
    return await ctx.db.insert("gbpPosts", {
      businessId,
      gbpLocationId,
      status: "posted",
      text: `post ${suffix}`,
      postedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function seedJob(
  t: ReturnType<typeof convexTest>,
  businessId: Id<"businesses">,
  suffix: string
): Promise<Id<"serviceJobs">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("serviceJobs", {
      businessId,
      status: "completed",
      photos: [],
      completedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      crmJobId: `crm_${suffix}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Cross-tenant                                                                */
/* -------------------------------------------------------------------------- */

describe("attribution — cross-tenant", () => {
  it("refuses to link Business A's lead to Business B's post", async () => {
    const t = convexTest(schema, modules);
    const bA = await seedBusiness(t, "A");
    const bB = await seedBusiness(t, "B");
    const leadA = await seedLead(t, bA, "leadA");
    const postB = await seedPost(t, bB, "postB");

    await expect(
      t.mutation(internal.outcomes.attribution.linkLeadToAction, {
        businessId: bA,
        leadId: leadA,
        kind: "gbp-post",
        actionId: postB as unknown as string,
      })
    ).rejects.toThrow(/does not resolve within business/);
  });

  it("refuses linkLeadToJob when lead and job are from different businesses", async () => {
    const t = convexTest(schema, modules);
    const bA = await seedBusiness(t, "A");
    const bB = await seedBusiness(t, "B");
    const leadA = await seedLead(t, bA, "leadA");
    const jobB = await seedJob(t, bB, "jobB");

    await expect(
      t.mutation(internal.outcomes.attribution.linkLeadToJob, {
        businessId: bA,
        leadId: leadA,
        jobId: jobB,
      })
    ).rejects.toThrow(/cross-tenant/);
  });

  it("refuses recordReviewArrival when review is from another business", async () => {
    const t = convexTest(schema, modules);
    const bA = await seedBusiness(t, "A");
    const bB = await seedBusiness(t, "B");
    const reviewB = await t.run(async (ctx) =>
      ctx.db.insert("reviews", {
        businessId: bB,
        platform: "gbp",
        externalReviewId: "rev_B",
        reviewerName: "X",
        starRating: 5,
        body: "Great",
        receivedAt: NOW,
      })
    );
    await expect(
      t.mutation(internal.outcomes.attribution.recordReviewArrival, {
        businessId: bA,
        reviewId: reviewB,
      })
    ).rejects.toThrow(/cross-tenant/);
  });
});

/* -------------------------------------------------------------------------- */
/* Plan-tier (no gating — every tier writes)                                   */
/* -------------------------------------------------------------------------- */

describe("attribution — plan-tier (no gating)", () => {
  for (const plan of ["starter", "pro", "studio"] as const) {
    it(`linkLeadToAction succeeds at ${plan}`, async () => {
      const t = convexTest(schema, modules);
      const businessId = await seedBusiness(t, plan, plan);
      const leadId = await seedLead(t, businessId, `lead_${plan}`);
      const postId = await seedPost(t, businessId, `post_${plan}`);
      const result = await t.mutation(
        internal.outcomes.attribution.linkLeadToAction,
        {
          businessId,
          leadId,
          kind: "gbp-post",
          actionId: postId as unknown as string,
        }
      );
      expect(result.linked).toBe(true);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Adversarial: idempotency, self-link, overwrite                              */
/* -------------------------------------------------------------------------- */

describe("attribution — adversarial guards", () => {
  it("re-applying same (lead, kind, action) is idempotent (alreadyLinked=true)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const leadId = await seedLead(t, businessId, "lead");
    const postId = await seedPost(t, businessId, "post");

    const first = await t.mutation(internal.outcomes.attribution.linkLeadToAction, {
      businessId,
      leadId,
      kind: "gbp-post",
      actionId: postId as unknown as string,
    });
    expect(first).toEqual({ linked: true, alreadyLinked: false });

    const second = await t.mutation(internal.outcomes.attribution.linkLeadToAction, {
      businessId,
      leadId,
      kind: "gbp-post",
      actionId: postId as unknown as string,
    });
    expect(second).toEqual({ linked: false, alreadyLinked: true });
  });

  it("silent overwrite refused — clearAttribution required first", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const leadId = await seedLead(t, businessId, "lead");
    const post1 = await seedPost(t, businessId, "post1");
    const post2 = await seedPost(t, businessId, "post2");

    await t.mutation(internal.outcomes.attribution.linkLeadToAction, {
      businessId,
      leadId,
      kind: "gbp-post",
      actionId: post1 as unknown as string,
    });

    await expect(
      t.mutation(internal.outcomes.attribution.linkLeadToAction, {
        businessId,
        leadId,
        kind: "gbp-post",
        actionId: post2 as unknown as string,
      })
    ).rejects.toThrow(/already linked/);

    await t.mutation(internal.outcomes.attribution.clearAttribution, {
      businessId,
      leadId,
    });

    const result = await t.mutation(internal.outcomes.attribution.linkLeadToAction, {
      businessId,
      leadId,
      kind: "gbp-post",
      actionId: post2 as unknown as string,
    });
    expect(result.linked).toBe(true);
  });

  it("self-link refused for non-lead-nudge kinds", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const leadId = await seedLead(t, businessId, "lead");

    await expect(
      t.mutation(internal.outcomes.attribution.linkLeadToAction, {
        businessId,
        leadId,
        kind: "gbp-post",
        actionId: leadId as unknown as string,
      })
    ).rejects.toThrow(/refused self-link/);
  });

  it("self-link allowed for lead-nudge (Maya's nudge is ABOUT this lead)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const leadId = await seedLead(t, businessId, "lead");

    const result = await t.mutation(internal.outcomes.attribution.linkLeadToAction, {
      businessId,
      leadId,
      kind: "lead-nudge",
      actionId: leadId as unknown as string,
    });
    expect(result.linked).toBe(true);
  });

  it("kind=none accepts arbitrary string sentinel", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const leadId = await seedLead(t, businessId, "lead");
    const result = await t.mutation(internal.outcomes.attribution.linkLeadToAction, {
      businessId,
      leadId,
      kind: "none",
      actionId: "system",
    });
    expect(result.linked).toBe(true);
  });

  it("recordLeadResponse is idempotent — first response wins", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const leadId = await seedLead(t, businessId, "lead");

    const first = await t.mutation(
      internal.outcomes.attribution.recordLeadResponse,
      { businessId, leadId, respondedAtMs: NOW + 5 * 60 * 1000 }
    );
    expect(first).toEqual({ recorded: true, alreadyRecorded: false });

    const second = await t.mutation(
      internal.outcomes.attribution.recordLeadResponse,
      { businessId, leadId, respondedAtMs: NOW + 30 * 60 * 1000 }
    );
    expect(second).toEqual({ recorded: false, alreadyRecorded: true });

    const lead = await t.run(async (ctx) => ctx.db.get(leadId));
    expect(lead?.responseLatencyMs).toBe(5 * 60 * 1000);
  });

  it("recordLeadResponse refuses respondedAtMs < capturedAt", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const leadId = await seedLead(t, businessId, "lead");

    await expect(
      t.mutation(internal.outcomes.attribution.recordLeadResponse, {
        businessId,
        leadId,
        respondedAtMs: NOW - 1000,
      })
    ).rejects.toThrow(/before capturedAt/);
  });
});

/* -------------------------------------------------------------------------- */
/* Attribution chain integrity                                                 */
/* -------------------------------------------------------------------------- */

describe("attribution — chain integrity", () => {
  it("post → lead → job round-trips with bidirectional refs", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const leadId = await seedLead(t, businessId, "lead");
    const postId = await seedPost(t, businessId, "post");
    const jobId = await seedJob(t, businessId, "job");

    // Link lead → post
    await t.mutation(internal.outcomes.attribution.linkLeadToAction, {
      businessId,
      leadId,
      kind: "gbp-post",
      actionId: postId as unknown as string,
    });

    // Link lead → job
    await t.mutation(internal.outcomes.attribution.linkLeadToJob, {
      businessId,
      leadId,
      jobId,
    });

    // Verify all three rows.
    const lead = await t.run(async (ctx) => ctx.db.get(leadId));
    const post = await t.run(async (ctx) => ctx.db.get(postId));
    const job = await t.run(async (ctx) => ctx.db.get(jobId));

    expect(lead?.originatingActionKind).toBe("gbp-post");
    expect(lead?.originatingActionId).toBe(postId);
    expect(lead?.convertedJobId).toBe(jobId);
    expect(post?.attributedLeadIds).toEqual([leadId]);
    expect(job?.originatingLeadId).toBe(leadId);
  });

  it("linkLeadToJob refuses to repurpose an already-converted lead", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const leadId = await seedLead(t, businessId, "lead");
    const job1 = await seedJob(t, businessId, "j1");
    const job2 = await seedJob(t, businessId, "j2");

    await t.mutation(internal.outcomes.attribution.linkLeadToJob, {
      businessId,
      leadId,
      jobId: job1,
    });

    await expect(
      t.mutation(internal.outcomes.attribution.linkLeadToJob, {
        businessId,
        leadId,
        jobId: job2,
      })
    ).rejects.toThrow(/already converted/);
  });

  it("clearAttribution scrubs gbp-post.attributedLeadIds back-pointer", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const leadId = await seedLead(t, businessId, "lead");
    const postId = await seedPost(t, businessId, "post");

    await t.mutation(internal.outcomes.attribution.linkLeadToAction, {
      businessId,
      leadId,
      kind: "gbp-post",
      actionId: postId as unknown as string,
    });

    let post = await t.run(async (ctx) => ctx.db.get(postId));
    expect(post?.attributedLeadIds).toEqual([leadId]);

    await t.mutation(internal.outcomes.attribution.clearAttribution, {
      businessId,
      leadId,
    });

    post = await t.run(async (ctx) => ctx.db.get(postId));
    expect(post?.attributedLeadIds).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* recordReviewArrival                                                         */
/* -------------------------------------------------------------------------- */

describe("attribution — recordReviewArrival", () => {
  it("attributes review to most-recent in-window request when requestId not given", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const jobId = await seedJob(t, businessId, "job");

    // Create a customer + review request linked to the job.
    const { customerId, requestId } = await t.run(async (ctx) => {
      const customerId = await ctx.db.insert("serviceCustomers", {
        businessId,
        name: "Jane",
        phone: "+15551234",
        email: "jane@example.com",
        address: "1 X St",
        lifetimeValueUsd: 0,
        reviewStatus: "not-yet",
        createdAt: NOW,
        updatedAt: NOW,
      });
      const requestId = await ctx.db.insert("reviewRequests", {
        businessId,
        jobId,
        customerId,
        channel: "sms",
        status: "sent",
        sentAt: NOW - 5 * 24 * 60 * 60 * 1000,
        followupCount: 0,
        createdAt: NOW - 5 * 24 * 60 * 60 * 1000,
      });
      return { customerId, requestId };
    });

    const reviewId = await t.run(async (ctx) =>
      ctx.db.insert("reviews", {
        businessId,
        platform: "gbp",
        externalReviewId: "rev_1",
        reviewerName: "Jane",
        starRating: 5,
        body: "Great",
        customerMatchedJobId: jobId,
        receivedAt: NOW,
      })
    );

    const result = await t.mutation(
      internal.outcomes.attribution.recordReviewArrival,
      { businessId, reviewId }
    );
    expect(result).toEqual({ attributed: true });

    const request = await t.run(async (ctx) => ctx.db.get(requestId));
    expect(request?.attributedReviewId).toBe(reviewId);
    expect(request?.responseRating).toBe(5);
    expect(request?.status).toBe("completed");
    void customerId; // suppress unused
  });

  it("returns attributed=false when no in-window request exists", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const reviewId = await t.run(async (ctx) =>
      ctx.db.insert("reviews", {
        businessId,
        platform: "gbp",
        externalReviewId: "rev_x",
        reviewerName: "Y",
        starRating: 4,
        body: "ok",
        receivedAt: NOW,
      })
    );
    const result = await t.mutation(
      internal.outcomes.attribution.recordReviewArrival,
      { businessId, reviewId }
    );
    expect(result.attributed).toBe(false);
  });

  it("re-applying the same review is idempotent", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "A");
    const jobId = await seedJob(t, businessId, "job");
    const { requestId } = await t.run(async (ctx) => {
      const customerId = await ctx.db.insert("serviceCustomers", {
        businessId,
        name: "Y",
        phone: "+15551",
        email: "y@e.com",
        address: "x",
        lifetimeValueUsd: 0,
        reviewStatus: "not-yet",
        createdAt: NOW,
        updatedAt: NOW,
      });
      return {
        requestId: await ctx.db.insert("reviewRequests", {
          businessId,
          jobId,
          customerId,
          channel: "sms",
          status: "sent",
          sentAt: NOW - 1000,
          followupCount: 0,
          createdAt: NOW - 1000,
        }),
      };
    });
    const reviewId = await t.run(async (ctx) =>
      ctx.db.insert("reviews", {
        businessId,
        platform: "gbp",
        externalReviewId: "rev_dup",
        reviewerName: "Y",
        starRating: 5,
        body: "Great",
        customerMatchedJobId: jobId,
        receivedAt: NOW,
      })
    );
    const a = await t.mutation(internal.outcomes.attribution.recordReviewArrival, {
      businessId,
      reviewId,
    });
    expect(a.attributed).toBe(true);
    const b = await t.mutation(internal.outcomes.attribution.recordReviewArrival, {
      businessId,
      reviewId,
    });
    expect(b.attributed).toBe(false);
    expect(b.reason).toBe("already-attributed");
    void requestId; // suppress unused
  });
});
