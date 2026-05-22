import { describe, expect, it } from "vitest";
import type { GtmChannelEvaluation, GtmEvidenceCard } from "../channelScoring";
import {
  buildGtmExperimentPlan,
  validateGtmExperimentPlan,
} from "../experimentPlanner";

function evaluation(
  channel: GtmChannelEvaluation["channel"],
  decision: GtmChannelEvaluation["decision"],
  overrides: Partial<GtmChannelEvaluation> = {}
): GtmChannelEvaluation {
  return {
    channel,
    score: decision === "primary" ? 0.8 : 0.65,
    decision,
    confidence: "medium",
    reasons: ["grounded evidence"],
    risks: [],
    evidenceCardIds: [`${channel}-1`, `${channel}-2`, `${channel}-3`],
    firstWeekTest: `run ${channel} test`,
    qualityGate: { passed: decision !== "parked", failures: [] },
    ...overrides,
  };
}

function evidence(
  source: GtmEvidenceCard["source"],
  overrides: Partial<GtmEvidenceCard> = {}
): GtmEvidenceCard {
  return {
    id: `${source}-${Math.random()}`,
    source,
    url: `https://example.com/${source}`,
    title: `${source} evidence`,
    snippet: "specific evidence",
    observedAt: 1_700_000_000_000,
    recency: "fresh",
    painMatch: 0.85,
    buyerMatch: 0.8,
    channelFit: 0.82,
    promotionRisk: "low",
    recommendedUse: "strategy",
    extractedClaims: ["claim"],
    ...overrides,
  };
}

describe("GTM experiment planner", () => {
  it("combines strategy, motions, variants, and UGC advisory into a bounded week-one plan", () => {
    const evaluations = [
      evaluation("reddit", "primary"),
      evaluation("x", "secondary"),
      evaluation("tiktok", "parked", {
        qualityGate: { passed: false, failures: ["not enough production proof"] },
      }),
    ];
    const plan = buildGtmExperimentPlan({
      productName: "ClipForge",
      weekCount: 1,
      app: {
        stage: "live-beta",
        weekGoal: "signups",
        canRecordScreen: true,
        canShowFace: false,
        canProvideScreenshots: true,
        canPostTikTokManually: true,
        canPostInstagramManually: true,
        excludedAudiences: [],
        productType: "consumer_visual",
      },
      evaluations,
      evidence: [
        evidence("reddit"),
        evidence("reddit"),
        evidence("x"),
        evidence("x"),
        evidence("tiktok"),
        evidence("tiktok"),
        evidence("instagram"),
        evidence("instagram"),
      ],
    });

    expect(plan.strategy.primaryChannel).toBe("reddit");
    expect(plan.formatExperiments.length).toBeLessThanOrEqual(3);
    expect(plan.formatExperiments.map((experiment) => experiment.motion)).toContain(
      "reddit_helpful_reply"
    );
    expect(plan.ugcReadiness.readiness).not.toBe("ready");
    expect(validateGtmExperimentPlan({ plan, evaluations }).passed).toBe(true);
  });

  it("refuses to build when the strategy gate does not pass", () => {
    expect(() =>
      buildGtmExperimentPlan({
        productName: "ClipForge",
        app: {
          stage: "live-beta",
          weekGoal: "signups",
          canRecordScreen: false,
          canShowFace: false,
          excludedAudiences: [],
          productType: "unknown",
        },
        evaluations: [
          evaluation("reddit", "parked", {
            qualityGate: { passed: false, failures: ["weak evidence"] },
          }),
        ],
        evidence: [evidence("reddit")],
      })
    ).toThrow(/strategy is not experiment-ready/);
  });

  it("fails validation when too many week-one experiments are added", () => {
    const evaluations = [evaluation("reddit", "primary"), evaluation("x", "secondary")];
    const plan = buildGtmExperimentPlan({
      productName: "ClipForge",
      app: {
        stage: "live-beta",
        weekGoal: "signups",
        canRecordScreen: true,
        canShowFace: true,
        canProvideScreenshots: true,
        canPostTikTokManually: true,
        canPostInstagramManually: true,
        excludedAudiences: [],
        productType: "consumer_visual",
      },
      evaluations,
      evidence: [
        evidence("reddit"),
        evidence("reddit"),
        evidence("x"),
        evidence("x"),
        evidence("tiktok"),
        evidence("tiktok"),
        evidence("instagram"),
        evidence("instagram"),
      ],
    });
    plan.formatExperiments.push(...plan.formatExperiments);

    expect(validateGtmExperimentPlan({ plan, evaluations }).failures).toContain(
      "week-one plan has too many simultaneous experiments"
    );
  });
});
