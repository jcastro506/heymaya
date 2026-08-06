/**
 * ⭐ The buyer map's audience half — §5.0.0, and the input Sprint 5.7 needs.
 *
 * Every component of this existed and nothing ran any of it:
 * `tiktok.followers()`, `tiktok.following()`, `computeAudienceOverlap()` and
 * `discoverGathering()` were all finished, tested, and had **zero callers**.
 * Four parts and no runner — the defect shape this codebase produces more than
 * any other.
 *
 * These tests cover the runner's judgement rather than the pure functions
 * (which have their own): what it refuses to do, what it says when the answer
 * is thin, and that it never destroys the other half of the buyer map.
 */
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { COMPETITOR_SAMPLE, ICP_SAMPLE } from "../audience";

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  buyerJson?: string
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      buyerJson,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

function targets(handles: string[], channel = "tiktok") {
  return JSON.stringify({
    targets: {
      keywords: ["indie hacker"],
      learnedAt: NOW,
      trackedAccounts: handles.map((handle, i) => ({
        handle,
        channel,
        keywordHits: handles.length - i,
        medianVelocity: 1,
        why: "posts about this niche",
      })),
    },
  });
}

describe("what it refuses to do", () => {
  it("says so plainly when learn-business has never run", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "notargets");
    const res = await t.action(internal.maya.audience.buildAudienceMap, {
      customerId,
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/learn-business/);
  });

  it("refuses to compute overlap across a single account", async () => {
    // Overlap across one account is not overlap: every score would be 1.0 and
    // mean nothing. Saying so beats writing a confident, empty map — and it
    // also saves the credits the pull would have spent.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "one", targets(["only_one"]));
    const res = await t.action(internal.maya.audience.buildAudienceMap, {
      customerId,
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/at least 2/);
  });

  it("ignores channels with no follower endpoint", async () => {
    // Only TikTok exposes a follower list. Two Instagram handles must not read
    // as two usable competitors.
    const t = convexTest(schema, modules);
    const customerId = await seed(
      t,
      "wrongchannel",
      targets(["a", "b", "c"], "instagram")
    );
    const res = await t.action(internal.maya.audience.buildAudienceMap, {
      customerId,
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/0 tracked TikTok/);
  });
});

describe("the caps ARE the cost model", () => {
  it("samples a bounded number of accounts in each direction", () => {
    // One credit per handle, both directions. At 200 customers these numbers
    // decide a monthly bill against a balance that sits near 3,000, so they
    // are a pricing decision rather than a tuning knob.
    expect(COMPETITOR_SAMPLE).toBeLessThanOrEqual(5);
    expect(ICP_SAMPLE).toBeLessThanOrEqual(15);
    // And enough to mean something: overlap across two accounts is a coin flip.
    expect(COMPETITOR_SAMPLE).toBeGreaterThanOrEqual(3);
  });
});

describe("storing never destroys the other half of the map", () => {
  it("merges into buyerJson rather than replacing it", async () => {
    // `complaints` and `targets` share this blob. An overwrite here would
    // silently delete the mined complaints — the same shape of bug as
    // storeComplaints resetting the buyer map every week.
    const t = convexTest(schema, modules);
    const existing = JSON.stringify({
      complaints: [{ text: "nobody explains the price", frequency: 4 }],
      targets: { keywords: ["indie hacker"] },
    });
    const customerId = await seed(t, "merge", existing);

    await t.mutation(internal.maya.audience.storeAudienceMap, {
      customerId,
      mapJson: JSON.stringify({
        icp: [{ handle: "buyer1", overlapScore: 0.6, followsCompetitors: ["a", "b"] }],
        gathering: [],
        competitorsSampled: ["a", "b"],
        builtAt: NOW,
      }),
    });

    const blob = await t.run(async (ctx) => {
      const c = (await ctx.db.get(customerId)) as { buyerJson?: string };
      return JSON.parse(c.buyerJson ?? "{}");
    });
    expect(blob.audience.icp).toHaveLength(1);
    // Both survived.
    expect(blob.complaints).toHaveLength(1);
    expect(blob.targets.keywords).toEqual(["indie hacker"]);
  });

  it("reads back nothing rather than throwing on a corrupt blob", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "corrupt", "{not json");
    const map = await t.query(internal.maya.audience.audienceFor, { customerId });
    expect(map).toBeNull();
  });

  it("CROSS-TENANT: one customer's audience never appears on another", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "aud_a");
    const b = await seed(t, "aud_b");
    await t.mutation(internal.maya.audience.storeAudienceMap, {
      customerId: a,
      mapJson: JSON.stringify({
        icp: [{ handle: "theirs", overlapScore: 1, followsCompetitors: ["x"] }],
        gathering: [],
        competitorsSampled: ["x"],
        builtAt: NOW,
      }),
    });
    expect(await t.query(internal.maya.audience.audienceFor, { customerId: b })).toBeNull();
  });
});
