import { describe, expect, it } from "vitest";
import {
  buildStrategyPlan,
  validateStrategyPlan,
  type GtmStrategyPlan,
} from "../strategyJudge";
import type { GtmChannelEvaluation } from "../channelScoring";

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

describe("GTM strategy judge", () => {
  it("builds a primary/secondary/parked plan from channel evaluations", () => {
    const evaluations = [
      evaluation("reddit", "primary"),
      evaluation("x", "secondary"),
      evaluation("linkedin", "parked", {
        qualityGate: { passed: false, failures: ["weak evidence"] },
      }),
      evaluation("tiktok", "parked", {
        qualityGate: { passed: false, failures: ["no video assets"] },
      }),
    ];

    const plan = buildStrategyPlan(evaluations);
    const gate = validateStrategyPlan({ plan, evaluations });

    expect(plan.primaryChannel).toBe("reddit");
    expect(plan.secondaryChannel).toBe("x");
    expect(plan.parkedChannels).toEqual(["linkedin", "tiktok"]);
    expect(plan.firstWeekTests[0].successMetric).toContain("qualified replies");
    expect(gate.passed).toBe(true);
  });

  it("fails when active channels lack evidence or quality gates", () => {
    const evaluations = [
      evaluation("reddit", "primary", {
        evidenceCardIds: ["one"],
        qualityGate: { passed: false, failures: ["too weak"] },
      }),
      evaluation("x", "parked", {
        qualityGate: { passed: false, failures: ["missing"] },
      }),
    ];
    const plan: GtmStrategyPlan = {
      primaryChannel: "reddit",
      parkedChannels: ["x"],
      confidence: "low",
      thesis: "Start with reddit because evidence exists.",
      firstWeekTests: [
        {
          channel: "reddit",
          test: "reply to threads",
          successMetric: "qualified replies",
          evidenceCardIds: ["one"],
        },
      ],
    };

    const gate = validateStrategyPlan({ plan, evaluations });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toEqual(
      expect.arrayContaining([
        "reddit did not pass quality gate",
        "reddit lacks enough evidence references",
        "reddit test lacks cited evidence",
      ])
    );
  });

  it("fails when parked channels are missing", () => {
    const evaluations = [
      evaluation("reddit", "primary"),
      evaluation("x", "parked", {
        qualityGate: { passed: false, failures: ["weak"] },
      }),
    ];
    const plan = buildStrategyPlan(evaluations);
    plan.parkedChannels = [];

    const gate = validateStrategyPlan({ plan, evaluations });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("x missing from parked channels");
  });

  it("rejects generic marketing advice", () => {
    const evaluations = [evaluation("reddit", "primary")];
    const plan = buildStrategyPlan(evaluations);
    plan.thesis = "Post consistently and engage with your audience.";

    const gate = validateStrategyPlan({ plan, evaluations });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("plan thesis is generic");
  });
});
