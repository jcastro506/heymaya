import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { buildResearchSkeletonEvidence } from "../researchWorker";

function authedGtm(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({
    subject: "u_gtm_research_worker",
    email: "research-worker@clawlaunch.test",
  });
}

describe("GTM Maya research worker", () => {
  it("builds evidence that parks TikTok when the user cannot provide visual assets", () => {
    const evidence = buildResearchSkeletonEvidence({
      name: "NoCam",
      url: "https://nocam.test",
      stage: "live-beta",
      weekGoal: "feedback",
      canRecordScreen: false,
      canShowFace: false,
    });

    const tiktok = evidence.find((card) => card.source === "tiktok");
    expect(tiktok?.recommendedUse).toBe("avoid");
    expect(tiktok?.snippet).toContain("cannot currently provide");
  });

  it("runs a budgeted skeleton job without external spend and produces channel scores", async () => {
    const t = convexTest(schema, modules);
    const user = authedGtm(t);

    await user.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});
    const appId = await user.mutation(
      api.gtmMaya.researchLifecycle.setAppProfile,
      {
        name: "BugBrief",
        url: "https://bugbrief.test",
        founderWhy: "Small teams lose customer bug context.",
        stage: "live-beta",
        weekGoal: "signups",
        canRecordScreen: true,
        canShowFace: false,
        excludedAudiences: [],
      }
    );
    const jobId = await user.mutation(
      api.gtmMaya.researchLifecycle.createResearchJob,
      { appId, budgetUsd: 3 }
    );

    const result = await user.mutation(
      api.gtmMaya.researchWorker.runBudgetedResearchSkeleton,
      { researchJobId: jobId }
    );
    const snapshot = await user.query(
      api.gtmMaya.researchLifecycle.getMyGtmSnapshot,
      {}
    );

    expect(result.evidenceCount).toBeGreaterThanOrEqual(5);
    expect(result.primaryChannel).toBe("reddit");
    expect(result.spentUsd).toBe(0);
    expect(snapshot?.latestJob?.status).toBe("ready_for_review");
    expect(snapshot?.evidenceCount).toBe(result.evidenceCount);
    expect(snapshot?.channelScores.some((score) => score.decision === "primary"))
      .toBe(true);
    expect(snapshot?.costTotalUsd).toBe(0);
  });

  it("refuses to run if the budget is below the minimum start threshold", async () => {
    const t = convexTest(schema, modules);
    const user = authedGtm(t);

    await user.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});
    const appId = await user.mutation(
      api.gtmMaya.researchLifecycle.setAppProfile,
      {
        name: "TinyBudget",
        url: "https://tiny-budget.test",
        stage: "live-beta",
        weekGoal: "feedback",
        canRecordScreen: true,
        canShowFace: false,
        excludedAudiences: [],
      }
    );
    const jobId = await user.mutation(
      api.gtmMaya.researchLifecycle.createResearchJob,
      { appId, budgetUsd: 0.01 }
    );

    await expect(
      user.mutation(api.gtmMaya.researchWorker.runBudgetedResearchSkeleton, {
        researchJobId: jobId,
      })
    ).rejects.toThrow("research budget is too low");
  });
});
