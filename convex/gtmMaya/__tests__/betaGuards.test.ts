import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { evaluateGtmBetaGuard } from "../betaGuards";

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
  const appId = await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: "Guarded App",
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  const jobId = await authed.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 3 }
  );
  return { authed, accountId: started.accountId, jobId };
}

describe("GTM beta guards", () => {
  beforeEach(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  });

  afterEach(() => {
    delete process.env.ADMIN_TOKEN;
  });

  it("evaluates cost, API call, and admin-disable blocks deterministically", () => {
    expect(
      evaluateGtmBetaGuard({
        state: {
          adminDisabled: false,
          dailyCostLimitUsd: 1,
          monthlyCostLimitUsd: 10,
          dailyApiCallLimit: 5,
        },
        usage: { dailyCostUsd: 0.9, monthlyCostUsd: 2, dailyApiCalls: 0 },
        nextCostUsd: 0.2,
      })
    ).toEqual({ allowed: false, reason: "daily GTM cost cap exceeded" });

    expect(
      evaluateGtmBetaGuard({
        state: {
          adminDisabled: true,
          disabledReason: "manual pause",
          dailyCostLimitUsd: 1,
          monthlyCostLimitUsd: 10,
          dailyApiCallLimit: 5,
        },
        usage: { dailyCostUsd: 0, monthlyCostUsd: 0, dailyApiCalls: 0 },
        nextCostUsd: 0,
      })
    ).toEqual({ allowed: false, reason: "manual pause" });
  });

  it("blocks cost records above the configured daily cap and writes an audit event", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, jobId } = await setupAccount(t, "u_gtm_cost_cap");

    await t.mutation(api.gtmMaya.betaGuards.adminSetSafetyState, {
      token: ADMIN_TOKEN,
      accountId,
      dailyCostLimitUsd: 0.05,
      monthlyCostLimitUsd: 1,
      dailyApiCallLimit: 10,
    });
    await authed.mutation(api.gtmMaya.researchLifecycle.recordCost, {
      researchJobId: jobId,
      provider: "scrapecreators",
      operation: "reddit.search",
      reason: "first research call",
      costUsd: 0.03,
      cacheStatus: "called",
    });

    await expect(
      authed.mutation(api.gtmMaya.researchLifecycle.recordCost, {
        researchJobId: jobId,
        provider: "gemini",
        operation: "strategy",
        reason: "would exceed cap",
        costUsd: 0.03,
        cacheStatus: "called",
      })
    ).rejects.toThrow("daily GTM cost cap exceeded");

    const status = await authed.query(
      api.gtmMaya.betaGuards.getMyBetaHardeningStatus,
      {}
    );
    expect(status?.usage.dailyCostUsd).toBe(0.03);
    expect(status?.audits.some((row) => row.eventType === "gtm.safety.updated")).toBe(
      true
    );
  });

  it("admin kill switch blocks spend before external APIs can be called", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, jobId } = await setupAccount(t, "u_gtm_kill");

    await t.mutation(api.gtmMaya.betaGuards.adminSetSafetyState, {
      token: ADMIN_TOKEN,
      accountId,
      adminDisabled: true,
      disabledReason: "beta incident",
    });

    await expect(
      authed.mutation(api.gtmMaya.researchLifecycle.recordCost, {
        researchJobId: jobId,
        provider: "openrouter",
        operation: "subagent",
        reason: "should not run",
        costUsd: 0.01,
        cacheStatus: "called",
      })
    ).rejects.toThrow("beta incident");
  });

  it("tracks reconnect-required channels and unhealthy OpenClaw machines", async () => {
    const t = convexTest(schema, modules);
    const { authed } = await setupAccount(t, "u_gtm_health");

    await authed.mutation(api.gtmMaya.betaGuards.recordConnectionHealth, {
      provider: "whatsapp",
      status: "reconnect_required",
      failureReason: "linked device expired",
    });
    await authed.mutation(api.gtmMaya.betaGuards.recordMachineHealth, {
      flyAppId: "clawlaunch-health-test",
      status: "unhealthy",
      restartCount: 1,
      lastError: "ping timeout",
    });

    const status = await authed.query(
      api.gtmMaya.betaGuards.getMyBetaHardeningStatus,
      {}
    );

    expect(status?.connections[0].provider).toBe("whatsapp");
    expect(status?.connections[0].status).toBe("reconnect_required");
    expect(status?.machine?.status).toBe("unhealthy");
    expect(status?.audits.map((row) => row.eventType)).toEqual(
      expect.arrayContaining([
        "gtm.connection.unhealthy",
        "gtm.machine.unhealthy",
      ])
    );
  });
});
