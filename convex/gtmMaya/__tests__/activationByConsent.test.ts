/**
 * 2026-07-22 — posting consent IS plan approval (activation gate).
 *
 * Live bug: the founder approved posts, granted full autonomy, connected two
 * channels — and lifecycleState stayed `plan_ready` because nothing ever set
 * strategyApprovalState. Every scheduled touchpoint gates on `active`, so the
 * midday pulse read everything, said "plan_ready → NO_REPLY", and quit — two
 * days of dead crons on a fully-consenting founder.
 *
 * Contract: granting autonomy ("just post from now on") or landing a founder-
 * confirmed publish marks the strategy approved and activates the agent.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function drain(t: ReturnType<typeof convexTest>): Promise<void> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function setupPlanReadyAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{
  accountId: Id<"creators">;
  agentId: Id<"gtmAgents">;
  jobId: Id<"gtmResearchJobs">;
}> {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  const appId = await t.run(async (ctx) => {
    const agent = await ctx.db.get(started.agentId);
    return agent!.appId!;
  });
  const jobId = await authed.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 5 }
  );
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, {
      // plan_ready: foundation done, but strategy NEVER formally approved.
      foundationCompletedAt: Date.now(),
      connectedAccountsJson: JSON.stringify([
        { accountId: "acct_x", platform: "x", isActive: true },
      ]),
      gtmPlanJson: JSON.stringify({ status: "active", tier: "starter" }),
    });
  });
  return { accountId: started.accountId, agentId: started.agentId, jobId };
}

describe("posting consent activates the agent", () => {
  it("granting autonomy marks the strategy approved and flips lifecycleState to active", async () => {
    const t = convexTest(schema, modules);
    const a = await setupPlanReadyAgent(t, "c_act_auto");

    await t.mutation(internal.gtmMaya.researchLifecycle.setPostingModeByAgent, {
      agentId: a.agentId,
      mode: "autonomous",
    });
    await drain(t);

    const job = await t.run(async (ctx) => await ctx.db.get(a.jobId));
    expect(job?.strategyApprovalState).toBe("approved");
    const agent = await t.run(async (ctx) => await ctx.db.get(a.agentId));
    expect(agent?.lifecycleState).toBe("active");
  });

  it("a landed founder-confirmed publish (incrementConfirmedPostCount) activates too", async () => {
    const t = convexTest(schema, modules);
    const a = await setupPlanReadyAgent(t, "c_act_confirm");

    await t.mutation(internal.gtmMaya.publishEngine.incrementConfirmedPostCount, {
      agentId: a.agentId,
    });
    await drain(t);

    const job = await t.run(async (ctx) => await ctx.db.get(a.jobId));
    expect(job?.strategyApprovalState).toBe("approved");
    const agent = await t.run(async (ctx) => await ctx.db.get(a.agentId));
    expect(agent?.lifecycleState).toBe("active");
  });

  it("no consent → still plan_ready (nothing activates on its own)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupPlanReadyAgent(t, "c_act_none");
    await drain(t);
    const job = await t.run(async (ctx) => await ctx.db.get(a.jobId));
    expect(job?.strategyApprovalState).not.toBe("approved");
    const agent = await t.run(async (ctx) => await ctx.db.get(a.agentId));
    expect(agent?.lifecycleState).not.toBe("active");
  });
});

describe("no-research-job deploys (admin dogfood) — consent fallback", () => {
  it("an agent with NO gtmResearchJobs row activates on autonomy grant", async () => {
    const t = convexTest(schema, modules);
    const authed = t.withIdentity({ subject: "c_nojob", email: "c_nojob@clawlaunch.test" });
    const started = await authed.mutation(
      api.gtmMaya.researchLifecycle.startGtmOnboarding,
      { channelPreference: "telegram", timezone: "America/New_York" }
    );
    await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
      url: "https://c-nojob.test",
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(started.agentId, {
        foundationCompletedAt: Date.now(),
        connectedAccountsJson: JSON.stringify([
          { accountId: "acct_x", platform: "x", isActive: true },
        ]),
      });
    });
    await t.mutation(internal.gtmMaya.researchLifecycle.setPostingModeByAgent, {
      agentId: started.agentId,
      mode: "autonomous",
    });
    await drain(t);
    const agent = await t.run(async (ctx) => await ctx.db.get(started.agentId));
    expect(agent?.lifecycleState).toBe("active");
  });
});
