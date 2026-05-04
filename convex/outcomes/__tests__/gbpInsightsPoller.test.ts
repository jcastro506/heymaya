/**
 * Wave C.5 — gbpInsightsPoller tests.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: persistPostMetrics refuses to write to a row whose
 *      businessId differs from the caller's.
 *   2. Plan-tier × action: poll runs at every tier; we exercise persist via
 *      direct mutation calls (action is the orchestrator).
 *   3. Adversarial:
 *      - Malformed metric (NaN / negative) refused.
 *      - Polling for a deleted post (post not found) throws.
 *      - Replay (idempotent — re-persist overwrites cleanly).
 *   4. Sibling-file scan: separate file.
 *   5. TODO grep: separate file.
 *   Outcome-specific:
 *      - End-to-end: post → mutation → engagementMetrics + engagementPolledAt.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function seedBusinessAndPost(
  t: ReturnType<typeof convexTest>,
  suffix: string
): Promise<{ businessId: Id<"businesses">; postId: Id<"gbpPosts"> }> {
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
      name: `Biz ${suffix}`,
      serviceTypes: ["hvac"],
      serviceAreaPolygon: [],
      ticketSizeBucket: "200-500",
      businessSize: "solo",
      tonePreference: "friendly-neighborhood",
      responseSpeed: "within-30-min",
      voiceEnabled: false,
      planTier: "pro",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.patch(accountId, { businessId });
    const gbpLocationId = await ctx.db.insert("gbpLocations", {
      businessId,
      gbpLocationId: `loc_${suffix}`,
      gbpAccountId: `acc_${suffix}`,
      address: "1 X St",
      primaryCategory: "HVAC",
      verifiedAt: NOW,
      ownerEmail: "x@y.com",
      createdAt: NOW,
    });
    const postId = await ctx.db.insert("gbpPosts", {
      businessId,
      gbpLocationId,
      status: "posted",
      text: `post ${suffix}`,
      postedAt: NOW,
      gbpLocalPostId: `gbp_local_${suffix}`,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { businessId, postId };
  });
}

/* -------------------------------------------------------------------------- */
/* Cross-tenant                                                                */
/* -------------------------------------------------------------------------- */

describe("gbpInsightsPoller — cross-tenant", () => {
  it("persistPostMetrics refuses to write across tenants", async () => {
    const t = convexTest(schema, modules);
    const a = await seedBusinessAndPost(t, "A");
    const b = await seedBusinessAndPost(t, "B");
    await expect(
      t.mutation(internal.outcomes.gbpInsightsPoller.persistPostMetrics, {
        businessId: a.businessId,
        postId: b.postId,
        metrics: { callsClicked: 1, directionsClicked: 1, websiteClicked: 1, postViews: 10 },
        polledAt: NOW,
      })
    ).rejects.toThrow(/cross-tenant/);
  });

  it("listPostsForPoll only returns posts for the asked business", async () => {
    const t = convexTest(schema, modules);
    const a = await seedBusinessAndPost(t, "A");
    const b = await seedBusinessAndPost(t, "B");
    const posts = await t.query(
      internal.outcomes.gbpInsightsPoller.listPostsForPoll,
      { businessId: a.businessId, sinceMs: NOW - 1000 }
    );
    expect(posts.length).toBe(1);
    expect(String(posts[0]._id)).toBe(String(a.postId));
    void b;
  });

  it("getZernioConnectionForPoll returns null when no connection exists", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedBusinessAndPost(t, "A");
    const conn = await t.query(
      internal.outcomes.gbpInsightsPoller.getZernioConnectionForPoll,
      { businessId }
    );
    expect(conn).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Adversarial                                                                 */
/* -------------------------------------------------------------------------- */

describe("gbpInsightsPoller — adversarial", () => {
  it("rejects negative metric values", async () => {
    const t = convexTest(schema, modules);
    const { businessId, postId } = await seedBusinessAndPost(t, "A");
    await expect(
      t.mutation(internal.outcomes.gbpInsightsPoller.persistPostMetrics, {
        businessId,
        postId,
        metrics: { callsClicked: -1, directionsClicked: 0, websiteClicked: 0, postViews: 0 },
        polledAt: NOW,
      })
    ).rejects.toThrow(/malformed metric/);
  });

  it("rejects non-finite metric values", async () => {
    const t = convexTest(schema, modules);
    const { businessId, postId } = await seedBusinessAndPost(t, "A");
    await expect(
      t.mutation(internal.outcomes.gbpInsightsPoller.persistPostMetrics, {
        businessId,
        postId,
        metrics: { callsClicked: NaN, directionsClicked: 0, websiteClicked: 0, postViews: 0 },
        polledAt: NOW,
      })
    ).rejects.toThrow(/malformed metric/);
  });

  it("throws when post does not exist", async () => {
    const t = convexTest(schema, modules);
    const { businessId, postId } = await seedBusinessAndPost(t, "A");
    // Delete the post.
    await t.run(async (ctx) => ctx.db.delete(postId));
    await expect(
      t.mutation(internal.outcomes.gbpInsightsPoller.persistPostMetrics, {
        businessId,
        postId,
        metrics: { callsClicked: 1, directionsClicked: 1, websiteClicked: 1, postViews: 10 },
        polledAt: NOW,
      })
    ).rejects.toThrow(/not found/);
  });

  it("re-persisting overwrites cleanly (idempotent)", async () => {
    const t = convexTest(schema, modules);
    const { businessId, postId } = await seedBusinessAndPost(t, "A");
    await t.mutation(internal.outcomes.gbpInsightsPoller.persistPostMetrics, {
      businessId,
      postId,
      metrics: { callsClicked: 1, directionsClicked: 1, websiteClicked: 1, postViews: 10 },
      polledAt: NOW,
    });
    await t.mutation(internal.outcomes.gbpInsightsPoller.persistPostMetrics, {
      businessId,
      postId,
      metrics: { callsClicked: 5, directionsClicked: 2, websiteClicked: 3, postViews: 50 },
      polledAt: NOW + 1000,
    });
    const post = await t.run(async (ctx) => ctx.db.get(postId));
    expect(post?.engagementMetrics).toEqual({
      callsClicked: 5,
      directionsClicked: 2,
      websiteClicked: 3,
      postViews: 50,
    });
    expect(post?.engagementPolledAt).toBe(NOW + 1000);
  });
});

/* -------------------------------------------------------------------------- */
/* End-to-end persistence                                                      */
/* -------------------------------------------------------------------------- */

describe("gbpInsightsPoller — end-to-end persist", () => {
  it("persistPostMetrics writes engagementMetrics + engagementPolledAt", async () => {
    const t = convexTest(schema, modules);
    const { businessId, postId } = await seedBusinessAndPost(t, "A");
    await t.mutation(internal.outcomes.gbpInsightsPoller.persistPostMetrics, {
      businessId,
      postId,
      metrics: { callsClicked: 4, directionsClicked: 2, websiteClicked: 3, postViews: 40 },
      polledAt: NOW + 60_000,
    });
    const post = await t.run(async (ctx) => ctx.db.get(postId));
    expect(post?.engagementMetrics).toEqual({
      callsClicked: 4,
      directionsClicked: 2,
      websiteClicked: 3,
      postViews: 40,
    });
    expect(post?.engagementPolledAt).toBe(NOW + 60_000);
  });
});
