/**
 * Sprint 2.25 — gtmCostLedger writes tests.
 *
 * Validates the internal mutation that all cost-recording funnels into:
 *   1. recordGtmCostInternal inserts a row with the right shape.
 *   2. Rolls up onto gtmResearchJobs.spentUsd when researchJobId set.
 *   3. Rejects negative costs.
 *   4. Cross-tenant isolation: cost rows scoped per-accountId.
 *
 * The callOpenRouterAndRecordCost wrapper is just (callOpenRouter +
 * recordGtmCostInternal). callOpenRouter has its own unit tests; this
 * mutation has its own. Integration is dumb composition.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: `App for ${subject}`,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  return { authed, accountId: started.accountId, agentId: started.agentId };
}

describe("Sprint 2.25 — recordGtmCostInternal", () => {
  it("inserts a row with the expected fields", async () => {
    const t = convexTest(schema, modules);
    const { accountId } = await setupAgent(t, "u_cost_record");

    const id = await t.mutation(
      internal.gtmMaya.costLedger.recordGtmCostInternal,
      {
        accountId,
        provider: "openrouter",
        operation: "openrouter.google/gemma-4-26b-a4b-it",
        reason: "judge_channels_synthesis",
        costUsd: 0.0123,
        units: 4500,
        cacheStatus: "called",
        metadata: { inputTokens: 2000, outputTokens: 2500 },
      }
    );

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.accountId).toBe(accountId);
    expect(row?.provider).toBe("openrouter");
    expect(row?.operation).toBe("openrouter.google/gemma-4-26b-a4b-it");
    expect(row?.reason).toBe("judge_channels_synthesis");
    expect(row?.costUsd).toBe(0.0123);
    expect(row?.units).toBe(4500);
    expect(row?.cacheStatus).toBe("called");
    expect(row?.metadata).toEqual({ inputTokens: 2000, outputTokens: 2500 });
    expect(row?.createdAt).toBeGreaterThan(Date.now() - 5_000);
  });

  it("rejects negative costs", async () => {
    const t = convexTest(schema, modules);
    const { accountId } = await setupAgent(t, "u_cost_neg");

    await expect(
      t.mutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
        accountId,
        provider: "openrouter",
        operation: "openrouter.test",
        reason: "test_call",
        costUsd: -0.01,
        cacheStatus: "called",
      })
    ).rejects.toThrow(/costUsd cannot be negative/);

    const all = await t.run(async (ctx) =>
      ctx.db.query("gtmCostLedger").collect()
    );
    expect(all.length).toBe(0);
  });

  it("rolls up onto gtmResearchJobs.spentUsd when researchJobId set", async () => {
    const t = convexTest(schema, modules);
    const { accountId, authed } = await setupAgent(t, "u_cost_rollup");

    // Create a research job for this agent.
    const jobId = await t.run(async (ctx) => {
      return await ctx.db.insert("gtmResearchJobs", {
        accountId,
        appId: (await ctx.db
          .query("gtmApps")
          .withIndex("by_account", (q) => q.eq("accountId", accountId))
          .first())!._id,
        status: "running",
        phase: "app_inspection",
        budgetUsd: 5,
        spentUsd: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Record two costs against the same job.
    await t.mutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
      accountId,
      researchJobId: jobId,
      provider: "openrouter",
      operation: "openrouter.test",
      reason: "step_1",
      costUsd: 0.05,
      cacheStatus: "called",
    });
    await t.mutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
      accountId,
      researchJobId: jobId,
      provider: "scrapecreators",
      operation: "scrape.reddit",
      reason: "step_2",
      costUsd: 0.015,
      cacheStatus: "called",
    });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.spentUsd).toBeCloseTo(0.065, 4);
    // authed setup is necessary even though we don't query through it —
    // setupAgent creates the gtmApps row the job references.
    expect(authed).toBeDefined();
  });

  it("does NOT roll up when researchJobId belongs to a different account", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_cost_xtenant_a");
    const b = await setupAgent(t, "u_cost_xtenant_b");

    // Create a research job under account A.
    const aJobId = await t.run(async (ctx) => {
      return await ctx.db.insert("gtmResearchJobs", {
        accountId: a.accountId,
        appId: (await ctx.db
          .query("gtmApps")
          .withIndex("by_account", (q) => q.eq("accountId", a.accountId))
          .first())!._id,
        status: "running",
        phase: "app_inspection",
        budgetUsd: 5,
        spentUsd: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Account B tries to attribute spend to A's job — should not roll up.
    await t.mutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
      accountId: b.accountId,
      researchJobId: aJobId,
      provider: "openrouter",
      operation: "openrouter.test",
      reason: "cross_tenant_attempt",
      costUsd: 0.99,
      cacheStatus: "called",
    });

    const aJob = await t.run((ctx) => ctx.db.get(aJobId));
    expect(aJob?.spentUsd).toBe(0); // Untouched.
  });

  it("cross-tenant isolation: cost rows scoped per-accountId", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_cost_iso_a");
    const b = await setupAgent(t, "u_cost_iso_b");

    await t.mutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
      accountId: a.accountId,
      provider: "openrouter",
      operation: "openrouter.test",
      reason: "a_call",
      costUsd: 0.001,
      cacheStatus: "called",
    });
    await t.mutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
      accountId: b.accountId,
      provider: "scrapecreators",
      operation: "scrape.reddit_search",
      reason: "b_call",
      costUsd: 0.005,
      cacheStatus: "called",
    });

    const all = await t.run(async (ctx) =>
      ctx.db.query("gtmCostLedger").collect()
    );
    expect(all.length).toBe(2);

    const aRows = all.filter((r) => r.accountId === a.accountId);
    const bRows = all.filter((r) => r.accountId === b.accountId);
    expect(aRows.length).toBe(1);
    expect(bRows.length).toBe(1);
    expect(aRows[0]?.provider).toBe("openrouter");
    expect(bRows[0]?.provider).toBe("scrapecreators");
  });

  it("supports all cost-provider literals", async () => {
    const t = convexTest(schema, modules);
    const { accountId } = await setupAgent(t, "u_cost_providers");
    const providers = [
      "openrouter",
      "scrapecreators",
      "gemini",
      "composio",
      "x_api",
      "openclaw",
      "other",
    ] as const;

    for (const p of providers) {
      await t.mutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
        accountId,
        provider: p,
        operation: `${p}.smoke`,
        reason: `smoke_${p}`,
        costUsd: 0.001,
        cacheStatus: "called",
      });
    }

    const all = await t.run(async (ctx) =>
      ctx.db.query("gtmCostLedger").collect()
    );
    expect(all.length).toBe(providers.length);
    expect(new Set(all.map((r) => r.provider))).toEqual(new Set(providers));
  });
});
