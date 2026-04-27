/**
 * 24h passive review-reply verifier tests.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: verifier action + markRejectedByGoogle never leak
 *      across businesses.
 *   2. Plan-tier × action: runs at every tier (no gating). Verified by
 *      Starter + Studio fixtures both flipping cleanly.
 *   3. Adversarial:
 *      - replyStatus already !== "posted" → skipped (idempotency)
 *      - fetcher returns ok=false → no flip (network-noise tolerance)
 *      - fetcher returns hasReply=true → no flip (happy path)
 *      - re-running on already-rejected review → no double telemetry
 *   4. Sibling-file scan: serviceTelemetry whitelist now includes
 *      "silent-rejection" for the review-reply-moderation signal.
 *   5. TODO grep: separate file.
 *
 *   Outcome-specific:
 *      - Telemetry row gets emitted with correct businessId pinning.
 *      - Reply status flips to "rejected-by-google", never to "rejected".
 */

import { describe, it, expect, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  __setZernioReviewFetcher,
  type ZernioReviewFetcher,
} from "../reviewReplyVerifier";

// Clear the module-level fetcher between tests so injection doesn't leak.
afterEach(() => __setZernioReviewFetcher(null));

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
      plan: "pro",
      accountType: "service-business",
      createdAt: NOW,
    });
    const businessId = await ctx.db.insert("businesses", {
      accountId,
      name: `Biz ${suffix}`,
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

async function seedReviewPosted(
  t: ReturnType<typeof convexTest>,
  businessId: Id<"businesses">,
  suffix: string
): Promise<Id<"reviews">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("reviews", {
      businessId,
      platform: "gbp",
      externalReviewId: `ext_${suffix}`,
      reviewerName: "Test Reviewer",
      starRating: 5,
      body: "Great service!",
      replyStatus: "posted",
      receivedAt: NOW,
    });
  });
}

const fetcherSilentRejection: ZernioReviewFetcher = async () => ({
  ok: true,
  hasReply: false,
});
const fetcherStillPresent: ZernioReviewFetcher = async () => ({
  ok: true,
  hasReply: true,
});
const fetcherNetworkFail: ZernioReviewFetcher = async () => ({
  ok: false,
  reason: "ETIMEDOUT",
});

/* -------------------------------------------------------------------------- */
/* Cross-tenant                                                                */
/* -------------------------------------------------------------------------- */

describe("reviewReplyVerifier — cross-tenant", () => {
  it("flipping a Business A review never affects Business B", async () => {
    const t = convexTest(schema, modules);
    const bizA = await seedBusiness(t, "A");
    const bizB = await seedBusiness(t, "B");
    const revA = await seedReviewPosted(t, bizA, "rev_A");
    const revB = await seedReviewPosted(t, bizB, "rev_B");

    __setZernioReviewFetcher(fetcherSilentRejection);
    await t.action(
      internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
      { reviewId: revA }
    );

    const after = await t.run(async (ctx) => ({
      a: await ctx.db.get(revA),
      b: await ctx.db.get(revB),
    }));
    expect(after.a?.replyStatus).toBe("rejected-by-google");
    expect(after.b?.replyStatus).toBe("posted"); // untouched

    // Telemetry row: businessId pinned to A, not leaked.
    const telemetry = await t.run(async (ctx) =>
      await ctx.db.query("serviceTelemetry").collect()
    );
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]?.businessId).toBe(bizA);
    expect(telemetry[0]?.signal).toBe("review-reply-moderation");
    expect(telemetry[0]?.outcome).toBe("silent-rejection");
  });
});

/* -------------------------------------------------------------------------- */
/* Plan-tier (no gating — runs at every tier)                                  */
/* -------------------------------------------------------------------------- */

describe("reviewReplyVerifier — plan-tier", () => {
  it.each(["starter", "pro", "studio"] as const)(
    "%s tier flips status on silent rejection",
    async (plan) => {
      const t = convexTest(schema, modules);
      const biz = await seedBusiness(t, `tier_${plan}`, plan);
      const rev = await seedReviewPosted(t, biz, `rev_${plan}`);

      __setZernioReviewFetcher(fetcherSilentRejection);
      await t.action(
        internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
        { reviewId: rev }
      );

      const after = await t.run(async (ctx) => await ctx.db.get(rev));
      expect(after?.replyStatus).toBe("rejected-by-google");
    }
  );
});

/* -------------------------------------------------------------------------- */
/* Adversarial                                                                 */
/* -------------------------------------------------------------------------- */

describe("reviewReplyVerifier — adversarial", () => {
  it("does not flip when fetcher returns hasReply=true", async () => {
    const t = convexTest(schema, modules);
    const biz = await seedBusiness(t, "happy");
    const rev = await seedReviewPosted(t, biz, "happy");

    __setZernioReviewFetcher(fetcherStillPresent);
    await t.action(
      internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
      { reviewId: rev }
    );

    const after = await t.run(async (ctx) => await ctx.db.get(rev));
    expect(after?.replyStatus).toBe("posted"); // unchanged
  });

  it("does not flip when fetcher fails (network noise tolerance)", async () => {
    const t = convexTest(schema, modules);
    const biz = await seedBusiness(t, "netfail");
    const rev = await seedReviewPosted(t, biz, "netfail");

    __setZernioReviewFetcher(fetcherNetworkFail);
    await t.action(
      internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
      { reviewId: rev }
    );

    const after = await t.run(async (ctx) => await ctx.db.get(rev));
    expect(after?.replyStatus).toBe("posted"); // unchanged
  });

  it("idempotent: re-running on already-rejected review is a no-op", async () => {
    const t = convexTest(schema, modules);
    const biz = await seedBusiness(t, "idem");
    const rev = await seedReviewPosted(t, biz, "idem");

    __setZernioReviewFetcher(fetcherSilentRejection);
    await t.action(
      internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
      { reviewId: rev }
    );
    await t.action(
      internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
      { reviewId: rev }
    );

    const telemetry = await t.run(async (ctx) =>
      await ctx.db.query("serviceTelemetry").collect()
    );
    expect(telemetry).toHaveLength(1); // not duplicated
  });

  it("skips when replyStatus already changed (e.g. operator deleted)", async () => {
    const t = convexTest(schema, modules);
    const biz = await seedBusiness(t, "deleted");
    const rev = await t.run(async (ctx) =>
      ctx.db.insert("reviews", {
        businessId: biz,
        platform: "gbp",
        externalReviewId: "ext_deleted",
        reviewerName: "X",
        starRating: 4,
        body: "ok",
        replyStatus: "rejected", // operator-issued rejection — don't overwrite
        receivedAt: NOW,
      })
    );

    __setZernioReviewFetcher(fetcherSilentRejection);
    await t.action(
      internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
      { reviewId: rev }
    );

    const after = await t.run(async (ctx) => await ctx.db.get(rev));
    expect(after?.replyStatus).toBe("rejected"); // untouched, not "rejected-by-google"
  });

  it("returns skipped when no fetcher is wired (production scaffold)", async () => {
    const t = convexTest(schema, modules);
    const biz = await seedBusiness(t, "noFetcher");
    const rev = await seedReviewPosted(t, biz, "noFetcher");

    // No __setZernioReviewFetcher call → production scaffold path
    const result = await t.action(
      internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
      { reviewId: rev }
    );

    expect(result).toEqual({ skipped: "no-zernio-fetcher-wired-yet" });
    const after = await t.run(async (ctx) => await ctx.db.get(rev));
    expect(after?.replyStatus).toBe("posted"); // unchanged — no false positive
  });

  it("returns skipped when review row doesn't exist", async () => {
    const t = convexTest(schema, modules);
    const biz = await seedBusiness(t, "missing");
    const rev = await seedReviewPosted(t, biz, "missing");
    await t.run(async (ctx) => await ctx.db.delete(rev));

    __setZernioReviewFetcher(fetcherSilentRejection);
    const result = await t.action(
      internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
      { reviewId: rev }
    );

    expect(result).toEqual({ skipped: "review-not-found" });
  });
});

/* -------------------------------------------------------------------------- */
/* Outcome-specific                                                            */
/* -------------------------------------------------------------------------- */

describe("reviewReplyVerifier — outcome semantics", () => {
  it("uses 'rejected-by-google' status, distinct from operator 'rejected'", async () => {
    const t = convexTest(schema, modules);
    const biz = await seedBusiness(t, "distinct");
    const rev = await seedReviewPosted(t, biz, "distinct");

    __setZernioReviewFetcher(fetcherSilentRejection);
    await t.action(
      internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
      { reviewId: rev }
    );

    const after = await t.run(async (ctx) => await ctx.db.get(rev));
    expect(after?.replyStatus).toBe("rejected-by-google");
    expect(after?.replyStatus).not.toBe("rejected"); // operator-issued path
  });

  it("uses the centralized telemetry whitelist (silent-rejection accepted)", async () => {
    const t = convexTest(schema, modules);
    const biz = await seedBusiness(t, "whitelist");
    const rev = await seedReviewPosted(t, biz, "whitelist");

    __setZernioReviewFetcher(fetcherSilentRejection);
    await t.action(
      internal.outcomes.reviewReplyVerifier.verifyReviewReplyAfter24h,
      { reviewId: rev }
    );

    const telemetry = await t.run(async (ctx) =>
      await ctx.db.query("serviceTelemetry").collect()
    );
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]?.outcome).toBe("silent-rejection");
  });
});
