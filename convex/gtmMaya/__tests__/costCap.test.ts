import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import {
  HOURLY_COST_CAP_USD,
  evaluateCostCap,
  type CostCapStatus,
} from "../costCap";

const ADMIN_TOKEN = "test-admin-token";

function user(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
}

async function setupAccount(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = user(t, subject);
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const appId = await authed.mutation(
    api.gtmMaya.researchLifecycle.setAppProfile,
    {
      name: `App for ${subject}`,
      url: `https://${subject}.test`,
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    }
  );
  const jobId = await authed.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 3 }
  );
  return { authed, accountId: started.accountId, jobId };
}

describe("cost-cap kill switch — pure evaluator", () => {
  it("allows spend strictly below the cap", () => {
    expect(
      evaluateCostCap({
        scope: "hour",
        currentSpendUsd: 0.5,
        capUsd: 1.0,
        nextCostUsd: 0.4,
      })
    ).toEqual<CostCapStatus>({
      scope: "hour",
      allowed: true,
      currentSpendUsd: 0.5,
      capUsd: 1.0,
      nextCostUsd: 0.4,
      overrideActive: false,
    });
  });

  it("rejects spend that would cross the cap", () => {
    const status = evaluateCostCap({
      scope: "hour",
      currentSpendUsd: 0.95,
      capUsd: 1.0,
      nextCostUsd: 0.1,
    });
    expect(status.allowed).toBe(false);
    expect(status.reason).toContain("hour cost cap exceeded");
  });

  it("rejects spend exactly at the cap", () => {
    const status = evaluateCostCap({
      scope: "day",
      currentSpendUsd: 1.99,
      capUsd: 2.0,
      nextCostUsd: 0.02,
    });
    expect(status.allowed).toBe(false);
  });

  it("rejects negative cost", () => {
    expect(
      evaluateCostCap({
        scope: "hour",
        currentSpendUsd: 0,
        capUsd: 1.0,
        nextCostUsd: -0.01,
      }).reason
    ).toBe("cost cannot be negative");
  });

  it("rejects negative cap", () => {
    expect(
      evaluateCostCap({
        scope: "hour",
        currentSpendUsd: 0,
        capUsd: -1,
        nextCostUsd: 0.01,
      }).reason
    ).toBe("cap cannot be negative");
  });

  it("locks the hourly cap at $1.00", () => {
    expect(HOURLY_COST_CAP_USD).toBe(1.0);
  });
});

describe("cost-cap kill switch — Convex integration", () => {
  beforeEach(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    delete process.env.GTM_COST_CAP_OVERRIDE;
  });

  afterEach(() => {
    delete process.env.ADMIN_TOKEN;
    delete process.env.GTM_COST_CAP_OVERRIDE;
  });

  it("blocks the hourly $1 cap from a fast burn", async () => {
    const t = convexTest(schema, modules);
    const { authed, jobId } = await setupAccount(t, "u_costcap_hour");

    // Burn ~$0.95 in five rapid recordCost calls.
    for (let i = 0; i < 5; i++) {
      await authed.mutation(api.gtmMaya.researchLifecycle.recordCost, {
        researchJobId: jobId,
        provider: "scrapecreators",
        operation: `reddit.search.${i}`,
        reason: "hour-cap test",
        costUsd: 0.19,
        cacheStatus: "called",
      });
    }

    const status = await authed.query(api.gtmMaya.costCap.getMyCostCapStatus, {
      scope: "hour",
      nextCostUsd: 0.1,
    });
    expect(status?.allowed).toBe(false);
    expect(status?.reason).toContain("hour cost cap exceeded");
    expect(status?.currentSpendUsd).toBeCloseTo(0.95, 4);
    expect(status?.capUsd).toBe(1.0);
  });

  it("blocks the per-research-job cap before exceeding job.budgetUsd", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, jobId } = await setupAccount(t, "u_costcap_job");

    // Lift the daily/monthly caps so the job cap is what we're actually
    // testing. Defaults are $2/day, which would block before the job cap.
    await t.mutation(api.gtmMaya.betaGuards.adminSetSafetyState, {
      token: ADMIN_TOKEN,
      accountId,
      dailyCostLimitUsd: 50,
      monthlyCostLimitUsd: 100,
      dailyApiCallLimit: 1000,
    });

    // Burn ~$2.95 against the $3 job budget — only one rapid step left.
    for (let i = 0; i < 5; i++) {
      await authed.mutation(api.gtmMaya.researchLifecycle.recordCost, {
        researchJobId: jobId,
        provider: "openrouter",
        operation: `model.call.${i}`,
        reason: "job-cap test",
        costUsd: 0.59,
        cacheStatus: "called",
      });
    }

    const status = await authed.query(api.gtmMaya.costCap.getMyCostCapStatus, {
      scope: "research-job",
      nextCostUsd: 0.5,
      researchJobId: jobId,
    });
    expect(status?.allowed).toBe(false);
    expect(status?.reason).toContain("research-job cost cap exceeded");
  });

  it("isolates cost caps cross-tenant — account A spending does not count against B", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAccount(t, "u_costcap_tenant_a");
    const b = await setupAccount(t, "u_costcap_tenant_b");

    for (let i = 0; i < 5; i++) {
      await a.authed.mutation(api.gtmMaya.researchLifecycle.recordCost, {
        researchJobId: a.jobId,
        provider: "scrapecreators",
        operation: `a.burn.${i}`,
        reason: "noisy neighbor",
        costUsd: 0.19,
        cacheStatus: "called",
      });
    }

    const aStatus = await a.authed.query(
      api.gtmMaya.costCap.getMyCostCapStatus,
      { scope: "hour", nextCostUsd: 0.1 }
    );
    const bStatus = await b.authed.query(
      api.gtmMaya.costCap.getMyCostCapStatus,
      { scope: "hour", nextCostUsd: 0.1 }
    );
    expect(aStatus?.allowed).toBe(false);
    expect(bStatus?.allowed).toBe(true);
    expect(bStatus?.currentSpendUsd).toBe(0);
  });

  it("operator override bypasses the cap and reports overrideActive", async () => {
    const t = convexTest(schema, modules);
    const { authed, jobId } = await setupAccount(t, "u_costcap_override");

    for (let i = 0; i < 5; i++) {
      await authed.mutation(api.gtmMaya.researchLifecycle.recordCost, {
        researchJobId: jobId,
        provider: "scrapecreators",
        operation: `burn.${i}`,
        reason: "override test",
        costUsd: 0.19,
        cacheStatus: "called",
      });
    }

    process.env.GTM_COST_CAP_OVERRIDE = "incident-1234 — operator override";
    const status = await authed.query(api.gtmMaya.costCap.getMyCostCapStatus, {
      scope: "hour",
      nextCostUsd: 0.5,
    });
    expect(status?.allowed).toBe(true);
    expect(status?.overrideActive).toBe(true);
    expect(status?.reason).toContain("incident-1234");
  });

  it("returns null for unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    const status = await t.query(api.gtmMaya.costCap.getMyCostCapStatus, {
      scope: "hour",
      nextCostUsd: 0.1,
    });
    expect(status).toBeNull();
  });

  it("preflight internal query mirrors the public query for actions", async () => {
    const t = convexTest(schema, modules);
    const { accountId, jobId } = await setupAccount(t, "u_costcap_preflight");

    const status = await t.query(
      internal.gtmMaya.costCap.checkCostCapPreflight,
      {
        accountId,
        nextCostUsd: 0.1,
        researchJobId: jobId,
      }
    );
    expect(status.allowed).toBe(true);
    expect(status.scope).toBe("research-job");
  });

  it("preflight checks all scopes and returns the first blocker", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, jobId } = await setupAccount(
      t,
      "u_costcap_multiscope"
    );

    // Drive day usage close to its $2 default cap.
    for (let i = 0; i < 9; i++) {
      await authed.mutation(api.gtmMaya.researchLifecycle.recordCost, {
        researchJobId: jobId,
        provider: "openrouter",
        operation: `model.${i}`,
        reason: "multi-scope test",
        costUsd: 0.19,
        cacheStatus: "called",
      });
    }

    const status = await t.query(
      internal.gtmMaya.costCap.checkCostCapPreflight,
      {
        accountId,
        nextCostUsd: 0.5,
      }
    );
    expect(status.allowed).toBe(false);
    // Hourly cap is tighter than daily here, so it should block first.
    expect(status.scope).toBe("hour");
  });
});
