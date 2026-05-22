import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { projectMissionBoard } from "../missionBoard";

function authed(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
}

describe("GTM Mission Board", () => {
  it("projects progress, approvals, evidence, channel decisions, and results", () => {
    const board = projectMissionBoard({
      agent: {
        onboardingStep: "active",
        openClawFlyAppId: "clawlaunch-demo",
      },
      app: {
        name: "BugBrief",
        url: "https://bugbrief.test",
        stage: "live-beta",
        weekGoal: "signups",
        diagnosis: { problem: "Bug reports lose reproduction context" },
      },
      latestJob: {
        status: "ready_for_review",
        phase: "complete",
        budgetUsd: 4,
        spentUsd: 0.42,
      },
      evidence: [
        {
          source: "reddit",
          title: "How do I get first users?",
          snippet: "Founders are asking for launch feedback.",
          url: "https://reddit.test/thread",
          recommendedUse: "reply",
          createdAt: 3,
        },
      ],
      channelScores: [
        {
          channel: "reddit",
          decision: "primary",
          confidence: "high",
          reasons: ["Fresh pain"],
          risks: ["Promotion rules"],
          firstWeekTest: "Reply to 10 qualified threads.",
          createdAt: 4,
        },
      ],
      drafts: [
        {
          _id: "draft_1",
          platform: "reddit",
          status: "drafted",
          body: "Useful reply draft",
          evidenceCardIds: ["ev1", "ev2"],
          createdAt: 5,
        },
      ],
      snapshots: [
        {
          replies: 2,
          clicks: 12,
          signups: 1,
          demos: 0,
          feedbackItems: 1,
          capturedAt: 6,
        },
      ],
    } as never);

    expect(board.appName).toBe("BugBrief");
    expect(board.progress.map((item) => item.label)).toEqual([
      "App profile",
      "Maya runtime",
      "Research",
      "Plan",
    ]);
    expect(board.pendingApprovals).toHaveLength(1);
    expect(board.evidenceCards[0].source).toBe("reddit");
    expect(board.channelDecisions[0].decision).toBe("primary");
    expect(board.todayTasks[0].label).toBe("Review approvals");
    expect(board.results[0].detail).toContain("1 signups");
    expect(board.cost).toEqual({ budgetUsd: 4, spentUsd: 0.42 });
  });

  it("returns null for users without a GTM account and populated board for owners", async () => {
    const t = convexTest(schema, modules);
    const owner = authed(t, "u_mission_owner");
    const stranger = authed(t, "u_mission_stranger");

    await owner.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});
    const appId = await owner.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
      name: "LaunchLens",
      url: "https://launchlens.test",
      stage: "live-beta",
      weekGoal: "feedback",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
      diagnosis: { audience: "indie builders with unlaunched apps" },
    });
    const jobId = await owner.mutation(
      api.gtmMaya.researchLifecycle.createResearchJob,
      { appId, budgetUsd: 3 }
    );
    const evidenceIds = await owner.mutation(
      api.gtmMaya.researchLifecycle.recordEvidenceCards,
      {
        researchJobId: jobId,
        cards: [
          {
            source: "reddit",
            url: "https://reddit.test/launchlens",
            title: "First users are hard",
            snippet: "A founder asks for users after building in public.",
            observedAt: 1_700_000_000_000,
            recency: "fresh",
            painMatch: 0.9,
            buyerMatch: 0.8,
            channelFit: 0.85,
            promotionRisk: "medium",
            recommendedUse: "reply",
            extractedClaims: ["first-user pain"],
          },
        ],
      }
    );
    await owner.mutation(api.gtmMaya.researchLifecycle.recordChannelScores, {
      researchJobId: jobId,
      scores: [
        {
          channel: "reddit",
          score: 0.82,
          decision: "primary",
          confidence: "high",
          reasons: ["Live demand"],
          risks: ["Must be useful"],
          evidenceCardIds: evidenceIds,
          firstWeekTest: "Reply to 10 launch-feedback threads.",
          qualityGate: { passed: true, failures: [] },
        },
      ],
    });

    const board = await owner.query(api.gtmMaya.missionBoard.getMyMissionBoard, {});
    const none = await stranger.query(api.gtmMaya.missionBoard.getMyMissionBoard, {});

    expect(none).toBeNull();
    expect(board?.appName).toBe("LaunchLens");
    expect(board?.evidenceCards).toHaveLength(1);
    expect(board?.channelDecisions[0].channel).toBe("reddit");
  });
});
