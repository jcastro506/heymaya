/**
 * Sprint B4 — /lc_gtm/set_strategy_approval endpoint + setStrategyApproval
 * mutation (the propose→approve gate).
 *
 * Mandatory categories: happy path, cross-tenant isolation, idempotency,
 * adversarial/validation, auth.
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

async function setupAgentWithJob(
  t: ReturnType<typeof convexTest>,
  subject: string
) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  await authed.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});
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
  const hookToken = "fake-hook-" + Math.random().toString(36).slice(2);
  const jobId = await t.run(async (ctx) => {
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account")
      .collect()
      .then((rows) => rows.find((a) => a.appId === appId));
    if (agent) await ctx.db.patch(agent._id, { hookToken });
    const app = await ctx.db.get(appId);
    return await ctx.db.insert("gtmResearchJobs", {
      accountId: app!.accountId,
      appId,
      status: "running" as const,
      phase: "strategy_judge" as const,
      budgetUsd: 1,
      spentUsd: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  return { appId, hookToken, jobId };
}

async function call(
  t: ReturnType<typeof convexTest>,
  hookToken: string,
  body: Record<string, unknown>
): Promise<{ status: number; text: string }> {
  const res = await t.fetch("/lc_gtm/set_strategy_approval", {
    method: "POST",
    headers: {
      authorization: `Bearer ${hookToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

describe("Sprint B4 — set_strategy_approval", () => {
  it("records the approval state on the agent's latest research job", async () => {
    const t = convexTest(schema, modules);
    const { jobId, hookToken } = await setupAgentWithJob(t, "u_sa_happy");

    const res = await call(t, hookToken, {
      idempotencyKey: "k1",
      state: "proposed",
    });
    expect(res.status).toBe(200);

    const job = await t.run(async (ctx) =>
      ctx.db.get(jobId as Id<"gtmResearchJobs">)
    );
    expect(job?.strategyApprovalState).toBe("proposed");
  });

  it("never lets one agent's write land on another agent's job", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgentWithJob(t, "u_sa_a");
    const b = await setupAgentWithJob(t, "u_sa_b");

    await call(t, a.hookToken, { idempotencyKey: "ka", state: "approved" });

    const jobA = await t.run(async (ctx) =>
      ctx.db.get(a.jobId as Id<"gtmResearchJobs">)
    );
    const jobB = await t.run(async (ctx) =>
      ctx.db.get(b.jobId as Id<"gtmResearchJobs">)
    );
    expect(jobA?.strategyApprovalState).toBe("approved");
    expect(jobB?.strategyApprovalState).toBeUndefined();
  });

  it("idempotency: replay does not re-apply", async () => {
    const t = convexTest(schema, modules);
    const { jobId, hookToken } = await setupAgentWithJob(t, "u_sa_idem");

    await call(t, hookToken, { idempotencyKey: "dup", state: "proposed" });
    const replay = await call(t, hookToken, {
      idempotencyKey: "dup",
      state: "approved",
    });
    expect(replay.status).toBe(200);
    expect(replay.text).toContain("replay");

    const job = await t.run(async (ctx) =>
      ctx.db.get(jobId as Id<"gtmResearchJobs">)
    );
    expect(job?.strategyApprovalState).toBe("proposed");
  });

  it("rejects missing key and invalid state", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgentWithJob(t, "u_sa_bad");

    expect((await call(t, hookToken, { state: "approved" })).status).toBe(400);
    expect(
      (await call(t, hookToken, { idempotencyKey: "x", state: "bogus" })).status
    ).toBe(400);
  });

  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema, modules);
    await setupAgentWithJob(t, "u_sa_auth");
    const res = await call(t, "not-a-real-token", {
      idempotencyKey: "z",
      state: "proposed",
    });
    expect(res.status).toBe(401);
  });
});
