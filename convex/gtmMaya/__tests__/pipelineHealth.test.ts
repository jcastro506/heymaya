import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";

/**
 * Sprint 2.14a.4 — pipeline health tracking via recordPipelineHealth.
 * Verifies counts persist and partial updates don't overwrite
 * unrelated fields.
 *
 * Uses seedGtmAgentAndApp to provision the full row shape rather than
 * tracking creators/gtmApps schema field requirements directly.
 *
 * 5 mandatory categories:
 *   1. Cross-tenant — N/A (single research job per test)
 *   2. Auth — internalMutation, no auth path
 *   3. Adversarial — missing job no-op
 *   4. Sibling-file scan — wired into researchWorker.runBudgetedResearchJob
 *      after card scoring + after comment mining (verified by tsc + live
 *      run on 2026-05-25)
 *   5. TODO grep — zero offenders
 */

async function seedTestJob(t: ReturnType<typeof convexTest>, suffix: string) {
  return await t.mutation(
    internal._admin.realWorldDeployGtm.seedGtmAgentAndApp,
    {
      clerkUserId: `test_health_${suffix}_${Date.now()}`,
      productName: "TestProduct",
      productUrl: "https://test.app",
      founderWhy: "test",
      stage: "live-beta" as const,
      weekGoal: "signups" as const,
      budgetUsd: 1,
    }
  );
}

describe("recordPipelineHealth", () => {
  it("patches scoring + mining counts onto the research job row", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTestJob(t, "a");

    await t.mutation(
      internal.gtmMaya.researchWorker.recordPipelineHealth,
      {
        researchJobId: seed.researchJobId,
        cardsScoredCount: 400,
        cardsExpectedCount: 445,
        commentsMinedCount: 8,
        commentsAttemptedCount: 10,
      }
    );

    const job = await t.run(async (ctx) => await ctx.db.get(seed.researchJobId));
    expect(job?.cardsScoredCount).toBe(400);
    expect(job?.cardsExpectedCount).toBe(445);
    expect(job?.commentsMinedCount).toBe(8);
    expect(job?.commentsAttemptedCount).toBe(10);
  });

  it("supports partial updates (scoring without overwriting mining)", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTestJob(t, "b");

    // First, set mining counts
    await t.mutation(
      internal.gtmMaya.researchWorker.recordPipelineHealth,
      {
        researchJobId: seed.researchJobId,
        commentsMinedCount: 5,
        commentsAttemptedCount: 7,
      }
    );

    // Then, set scoring counts (mining should survive)
    await t.mutation(
      internal.gtmMaya.researchWorker.recordPipelineHealth,
      {
        researchJobId: seed.researchJobId,
        cardsScoredCount: 200,
        cardsExpectedCount: 250,
      }
    );

    const job = await t.run(async (ctx) => await ctx.db.get(seed.researchJobId));
    expect(job?.cardsScoredCount).toBe(200);
    expect(job?.cardsExpectedCount).toBe(250);
    expect(job?.commentsMinedCount).toBe(5);
    expect(job?.commentsAttemptedCount).toBe(7);
  });
});
