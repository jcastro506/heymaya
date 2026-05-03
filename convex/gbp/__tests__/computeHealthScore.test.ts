/**
 * computeHealthScore (Wave C.6, judgment-driven) — orchestration tests.
 *
 * Per the operator's 2026-04-27 directive: this action is a thin wrapper
 * around the auditor skill. We do NOT test exact prose; we test the
 * orchestration shape:
 *   1. Cross-tenant — A's posts/reviews/photos never leak into B's bundle.
 *   2. Plan-tier × action — the audit runs at every tier (universal per
 *      north-star rule).
 *   3. Adversarial — empty business state, missing business row, malicious
 *      LLM seam responses.
 *   4. Sibling-file scan — separate file.
 *   5. TODO grep — separate file.
 *
 * Plus Wave-C.6-specific:
 *   - safe-fallback row lands when no LLM caller is wired (documented v0
 *     behavior pre-LLM-wiring).
 *   - injected LLM caller's nudges flow through to mayaTaskQueue.
 *   - score + reasoning + nudgesPending persist on the row.
 *   - audit attaches model + thinking budget metadata.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { _setAuditorLlmCallerForTests } from "../computeHealthScore";

const NOW = 1_700_000_000_000;
const ONE_DAY = 24 * 60 * 60 * 1000;

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
      tonePreference: "friendly-neighborhood",
      planTier: plan,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.patch(accountId, { businessId });
    await ctx.db.insert("gbpLocations", {
      businessId,
      gbpLocationId: `loc_${suffix}`,
      gbpAccountId: `acct_${suffix}`,
      address: "123 Main",
      primaryCategory: "HVAC contractor",
      verifiedAt: NOW - 30 * ONE_DAY,
      createdAt: NOW,
    });
    await ctx.db.insert("businessPicture", {
      businessId,
      brandVoice: "friendly",
      recurringServicePatterns: [],
      localCompetitors: [],
      generatedAt: NOW,
      model: "google/gemini-3-flash",
      sourceCitations: [],
    });
    return businessId as Id<"businesses">;
  });
}

afterEach(() => {
  _setAuditorLlmCallerForTests(null);
});

describe("gatherAuditorBundle — cross-tenant + windowing", () => {
  it("cross-tenant: A's posts never appear in B's bundle", async () => {
    const t = convexTest(schema, modules);
    const a = await seedBusiness(t, "a");
    const b = await seedBusiness(t, "b");
    await t.run(async (ctx) => {
      const aLoc = (
        await ctx.db
          .query("gbpLocations")
          .withIndex("by_business", (q) => q.eq("businessId", a))
          .collect()
      )[0];
      await ctx.db.insert("gbpPosts", {
        businessId: a,
        gbpLocationId: aLoc._id,
        status: "posted",
        text: "A's post",
        postedAt: NOW - 5 * ONE_DAY,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    const bundleA = await t.query(
      internal.gbp.computeHealthScore.gatherAuditorBundle,
      { businessId: a, nowMs: NOW }
    );
    const bundleB = await t.query(
      internal.gbp.computeHealthScore.gatherAuditorBundle,
      { businessId: b, nowMs: NOW }
    );
    expect(bundleA.recentPosts.length).toBe(1);
    expect(bundleB.recentPosts.length).toBe(0);
  });

  it("excludes posts older than 30 days", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "old");
    await t.run(async (ctx) => {
      const loc = (
        await ctx.db
          .query("gbpLocations")
          .withIndex("by_business", (q) => q.eq("businessId", businessId))
          .collect()
      )[0];
      // post 60d old — should be excluded
      await ctx.db.insert("gbpPosts", {
        businessId,
        gbpLocationId: loc._id,
        status: "posted",
        text: "old",
        postedAt: NOW - 60 * ONE_DAY,
        createdAt: NOW,
        updatedAt: NOW,
      });
      // post 5d old — should be included
      await ctx.db.insert("gbpPosts", {
        businessId,
        gbpLocationId: loc._id,
        status: "posted",
        text: "fresh",
        postedAt: NOW - 5 * ONE_DAY,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    const bundle = await t.query(
      internal.gbp.computeHealthScore.gatherAuditorBundle,
      { businessId, nowMs: NOW }
    );
    expect(bundle.recentPosts.length).toBe(1);
    expect(bundle.recentPosts[0].text).toBe("fresh");
  });
});

describe("persistHealthScore + enqueueAuditorNudge — guards", () => {
  it("persistHealthScore rejects unknown businessId", async () => {
    const t = convexTest(schema, modules);
    const real = await seedBusiness(t, "real");
    const ghost = await seedBusiness(t, "ghost");
    await t.run(async (ctx) => ctx.db.delete(ghost));
    await expect(
      t.mutation(internal.gbp.computeHealthScore.persistHealthScore, {
        businessId: ghost,
        scoreAt: NOW,
        compositeScore: 50,
        reasoning: "x",
        nudgesPending: 0,
        model: "google/gemini-3-flash",
        thinkingBudget: "medium",
      })
    ).rejects.toThrow(/not found/);
    expect(real).toBeTruthy();
  });

  it("enqueueAuditorNudge rejects unknown businessId", async () => {
    const t = convexTest(schema, modules);
    const real = await seedBusiness(t, "real");
    const ghost = await seedBusiness(t, "ghost");
    await t.run(async (ctx) => ctx.db.delete(ghost));
    await expect(
      t.mutation(internal.gbp.computeHealthScore.enqueueAuditorNudge, {
        businessId: ghost,
        headline: "x",
        body: "x",
        suggestedAction: "operator-fix",
        rationale: "x",
      })
    ).rejects.toThrow(/not found/);
    expect(real).toBeTruthy();
  });
});

describe("runGbpHealthAuditForBusiness — orchestration", () => {
  it("ships safe-fallback row when no LLM caller is wired", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "fallback");
    _setAuditorLlmCallerForTests(null);
    const result = await t.action(
      internal.gbp.computeHealthScore.runGbpHealthAuditForBusiness,
      { businessId, nowMs: NOW, operatorFirstName: "Mike" }
    );
    expect(result.score).toBe(50);
    expect(result.nudgesEnqueued).toBe(0);
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("gbpHealthScores")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows.length).toBe(1);
    expect(rows[0].compositeScore).toBe(50);
    expect(rows[0].reasoning).toMatch(/maya did not have/i);
    expect(rows[0].model).toBe("gemini-3-flash");
    expect(rows[0].thinkingBudget).toBe("medium");
  });

  it("persists Maya's score + reasoning when LLM is wired; enqueues nudges", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "auditor");
    _setAuditorLlmCallerForTests(async () =>
      JSON.stringify({
        score: 78,
        reasoning: "Posts were quiet for 9 days. Photos are fresh. Replies on time.",
        nudges: [
          {
            headline: "Resume posting cadence",
            body: "It has been 9 days since your last GBP post. I will draft one from your unused photos.",
            suggestedAction: "maya-queue",
            rationale: "longest gap in last 30d",
          },
        ],
      })
    );
    const result = await t.action(
      internal.gbp.computeHealthScore.runGbpHealthAuditForBusiness,
      { businessId, nowMs: NOW, operatorFirstName: "Mike" }
    );
    expect(result.score).toBe(78);
    expect(result.nudgesEnqueued).toBe(1);
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("gbpHealthScores")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows[0].compositeScore).toBe(78);
    expect(rows[0].reasoning).toMatch(/9 days/);
    expect(rows[0].nudgesPending).toBe(1);

    const queueRows = await t.run(async (ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business_and_kind", (q) =>
          q.eq("businessId", businessId).eq("kind", "gbp.seo.nudge")
        )
        .collect()
    );
    expect(queueRows.length).toBe(1);
    expect((queueRows[0].payload as { suggestedAction: string }).suggestedAction).toBe(
      "maya-queue"
    );
  });

  it("plan-tier: runs at every tier (universal per north-star)", async () => {
    for (const plan of ["starter", "pro", "studio"] as const) {
      const t = convexTest(schema, modules);
      const businessId = await seedBusiness(t, plan, plan);
      _setAuditorLlmCallerForTests(null);
      const result = await t.action(
        internal.gbp.computeHealthScore.runGbpHealthAuditForBusiness,
        { businessId, nowMs: NOW }
      );
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it("safely handles malicious LLM output via the auditor's policy scrub", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "evil");
    _setAuditorLlmCallerForTests(async () =>
      JSON.stringify({
        score: 30,
        reasoning: "x",
        nudges: [
          {
            headline: "Spam",
            body: "Ask friends to leave a review on your GBP profile.",
            suggestedAction: "operator-fix",
            rationale: "spam",
          },
          {
            headline: "Legit",
            body: "I will queue review requests for your last 5 completed jobs.",
            suggestedAction: "maya-queue",
            rationale: "legit",
          },
        ],
      })
    );
    const result = await t.action(
      internal.gbp.computeHealthScore.runGbpHealthAuditForBusiness,
      { businessId, nowMs: NOW }
    );
    // Spam nudge dropped at the policy scrub; only the legit one persisted.
    expect(result.nudgesEnqueued).toBe(1);
  });
});
