import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

async function setupJob(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
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
  return {
    authed,
    accountId: started.accountId,
    agentId: started.agentId,
    jobId,
  };
}

describe("Sprint 19 — workspaceMutator", () => {
  it("snapshotResearchForMutation returns job + scores + evidenceCount", async () => {
    const t = convexTest(schema, modules);
    const { accountId, jobId } = await setupJob(t, "u_mut_snap");
    // Plant 2 evidence cards.
    await t.mutation(internal.gtmMaya.platformWorkers.recordPlatformEvidence, {
      researchJobId: jobId,
      accountId,
      cards: [
        {
          source: "reddit",
          url: "https://r.test/p1",
          snippet: "real pain",
          observedAt: Date.now(),
          recency: "fresh",
          painMatch: 0.7,
          buyerMatch: 0.6,
          channelFit: 0.7,
          promotionRisk: "medium",
          recommendedUse: "reply",
          extractedClaims: [],
        },
        {
          source: "x",
          url: "https://x.com/y",
          snippet: "more pain",
          observedAt: Date.now(),
          recency: "fresh",
          painMatch: 0.6,
          buyerMatch: 0.5,
          channelFit: 0.6,
          promotionRisk: "low",
          recommendedUse: "strategy",
          extractedClaims: [],
        },
      ],
    });
    const snap = await t.query(
      internal.gtmMaya.workspaceMutator.snapshotResearchForMutation,
      { researchJobId: jobId, accountId }
    );
    expect(snap?.evidenceCount).toBe(2);
    expect(snap?.job._id).toBe(jobId);
  });

  it("recordMutation persists an audit row + returns id", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId, jobId } = await setupJob(t, "u_mut_record");
    const id = await t.mutation(
      internal.gtmMaya.workspaceMutator.recordMutation,
      {
        accountId,
        agentId,
        triggeredBy: "research_complete",
        sourceResearchJobId: jobId,
        changedFiles: ["APP.md", "GTM.md", "MEMORY.md"],
        summary: "Primary: reddit, secondary: x",
      }
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.deployed).toBe(false);
    expect(row?.changedFiles).toContain("APP.md");
    expect(row?.changedFiles).toContain("GTM.md");
    expect(row?.changedFiles).toContain("MEMORY.md");
    expect(row?.summary).toContain("reddit");
  });

  it("mutateWorkspaceFromResearch produces a ready_for_review summary when scores exist", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId, jobId } = await setupJob(t, "u_mut_ready");
    // Mark job as ready_for_review with a primary channel score.
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, {
        status: "ready_for_review",
        phase: "complete",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("gtmChannelScores", {
        accountId,
        researchJobId: jobId,
        channel: "reddit",
        score: 0.78,
        decision: "primary",
        confidence: "high",
        reasons: ["high painMatch"],
        risks: [],
        evidenceCardIds: [],
        qualityGate: { passed: true, failures: [] },
        createdAt: Date.now(),
      });
    });
    const out = await t.action(
      internal.gtmMaya.workspaceMutator.mutateWorkspaceFromResearch,
      {
        agentId,
        accountId,
        researchJobId: jobId,
        trigger: "research_complete",
      }
    );
    expect(out.changedFiles).toContain("APP.md");
    expect(out.changedFiles).toContain("GTM.md");
    expect(out.changedFiles).toContain("MEMORY.md");
    expect(out.summary).toContain("Primary: reddit");
    expect(out.needsRedeploy).toBe(true);
  });

  it("mutateWorkspaceFromResearch handles needs_more_evidence path", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId, jobId } = await setupJob(t, "u_mut_thin");
    await t.run((ctx) =>
      ctx.db.patch(jobId, {
        status: "needs_more_evidence",
        phase: "complete",
        updatedAt: Date.now(),
      })
    );
    const out = await t.action(
      internal.gtmMaya.workspaceMutator.mutateWorkspaceFromResearch,
      {
        agentId,
        accountId,
        researchJobId: jobId,
        trigger: "research_complete",
      }
    );
    expect(out.changedFiles).toContain("MEMORY.md");
    expect(out.summary).toContain("insufficient evidence");
  });

  it("markMutationDeployed flips the deployed flag + timestamp", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId, jobId } = await setupJob(t, "u_mut_deploy");
    const id = await t.mutation(
      internal.gtmMaya.workspaceMutator.recordMutation,
      {
        accountId,
        agentId,
        triggeredBy: "operator_manual",
        sourceResearchJobId: jobId,
        changedFiles: ["MEMORY.md"],
        summary: "operator manual note",
      }
    );
    await t.mutation(internal.gtmMaya.workspaceMutator.markMutationDeployed, {
      mutationId: id,
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.deployed).toBe(true);
    expect(row?.deployedAt).toBeTypeOf("number");
  });

  it("getMyWorkspaceMutations returns only the signed-in user's rows", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_mut_iso_a");
    const b = await setupJob(t, "u_mut_iso_b");
    await t.mutation(internal.gtmMaya.workspaceMutator.recordMutation, {
      accountId: a.accountId,
      agentId: a.agentId,
      triggeredBy: "research_complete",
      sourceResearchJobId: a.jobId,
      changedFiles: ["MEMORY.md"],
      summary: "A's mutation",
    });
    const aRows = await a.authed.query(
      api.gtmMaya.workspaceMutator.getMyWorkspaceMutations,
      {}
    );
    const bRows = await b.authed.query(
      api.gtmMaya.workspaceMutator.getMyWorkspaceMutations,
      {}
    );
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(0);
  });
});
