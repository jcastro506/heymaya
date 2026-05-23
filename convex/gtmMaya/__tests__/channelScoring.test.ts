import { describe, expect, it } from "vitest";
import {
  evaluateChannel,
  evaluateChannelSet,
  scoreEvidenceCard,
  validateStrategyGate,
  type GtmAppContext,
  type GtmEvidenceCard,
} from "../channelScoring";

const APP: GtmAppContext = {
  stage: "live-beta",
  weekGoal: "signups",
  canRecordScreen: true,
  canShowFace: false,
  canRecordVoice: false,
  canProvideScreenshots: true,
  canPostTikTokManually: true,
  tiktokWarmupState: "ready",
  tiktokAccountAgeDays: 30,
  tiktokAccountStatusChecked: true,
  excludedAudiences: [],
};

function card(
  id: string,
  source: GtmEvidenceCard["source"],
  overrides: Partial<GtmEvidenceCard> = {}
): GtmEvidenceCard {
  return {
    id,
    source,
    url: `https://example.com/${id}`,
    title: `Evidence ${id}`,
    snippet: "Builders are asking for a concrete way to get first users without hiring a marketer.",
    observedAt: 1_700_000_000_000,
    recency: "fresh",
    engagement: { likes: 40, comments: 18, shares: 5, views: 1_000 },
    painMatch: 0.9,
    buyerMatch: 0.86,
    channelFit: 0.82,
    promotionRisk: "low",
    recommendedUse: "strategy",
    extractedClaims: ["founder needs users", "manual marketing is confusing"],
    ...overrides,
  };
}

describe("GTM Maya channel scoring", () => {
  it("scores fresh, relevant, low-risk evidence above stale or avoid evidence", () => {
    const useful = card("useful", "reddit");
    const stale = card("stale", "reddit", {
      recency: "old",
      engagement: { likes: 1, comments: 0 },
      painMatch: 0.45,
      buyerMatch: 0.4,
      channelFit: 0.5,
      promotionRisk: "medium",
    });
    const avoid = card("avoid", "reddit", { recommendedUse: "avoid" });

    expect(scoreEvidenceCard(useful)).toBeGreaterThan(scoreEvidenceCard(stale));
    expect(scoreEvidenceCard(avoid)).toBe(0);
  });

  it("requires enough cited evidence before choosing an active channel", () => {
    const evaluation = evaluateChannel("x", [card("x1", "x")], APP);

    expect(evaluation.decision).toBe("parked");
    expect(evaluation.qualityGate.passed).toBe(false);
    expect(evaluation.qualityGate.failures).toContain(
      "needs at least two useful evidence cards"
    );
    expect(evaluation.firstWeekTest).toBeUndefined();
  });

  it("selects one primary and one secondary channel from grounded evidence", () => {
    const evaluations = evaluateChannelSet(
      [
        card("r1", "reddit"),
        card("r2", "reddit"),
        card("r3", "reddit"),
        card("x1", "x", { painMatch: 0.76 }),
        card("x2", "x", { painMatch: 0.74 }),
        card("l1", "linkedin", { painMatch: 0.58, buyerMatch: 0.55 }),
      ],
      APP
    );

    const gate = validateStrategyGate(evaluations);
    expect(gate.passed).toBe(true);
    expect(evaluations.filter((row) => row.decision === "primary")).toHaveLength(1);
    expect(evaluations.filter((row) => row.decision === "secondary")).toHaveLength(1);
    expect(evaluations.find((row) => row.channel === "reddit")?.firstWeekTest).toContain(
      "Reply to 10 fresh threads"
    );
  });

  it("parks TikTok when the user cannot provide usable video assets", () => {
    const noVideoApp: GtmAppContext = {
      ...APP,
      canRecordScreen: false,
      canShowFace: false,
      canProvideScreenshots: false,
      canPostTikTokManually: false,
    };
    const evaluation = evaluateChannel(
      "tiktok",
      [card("t1", "tiktok"), card("t2", "tiktok"), card("t3", "tiktok")],
      noVideoApp
    );

    expect(evaluation.decision).toBe("parked");
    expect(evaluation.qualityGate.failures).toContain(
      "TikTok needs manual posting plus screen recording, screenshots, voice/face, or later UGC budget"
    );
  });

  it("allows TikTok when the user can make screenshot slideshows and post manually", () => {
    const screenshotApp: GtmAppContext = {
      ...APP,
      canRecordScreen: false,
      canShowFace: false,
      canRecordVoice: false,
      canProvideScreenshots: true,
      canPostTikTokManually: true,
    };
    const evaluation = evaluateChannel(
      "tiktok",
      [card("t1", "tiktok"), card("t2", "tiktok"), card("t3", "tiktok")],
      screenshotApp
    );

    expect(evaluation.qualityGate.passed).toBe(true);
    expect(evaluation.firstWeekTest).toContain("manual TikTok visual tests");
  });

  it("parks TikTok launch cadence when the account still needs warm-up", () => {
    const evaluation = evaluateChannel(
      "tiktok",
      [card("t1", "tiktok"), card("t2", "tiktok"), card("t3", "tiktok")],
      {
        ...APP,
        canRecordScreen: true,
        canProvideScreenshots: true,
        canPostTikTokManually: true,
        tiktokWarmupState: "new_needs_warmup",
        tiktokAccountAgeDays: 1,
        tiktokAccountStatusChecked: false,
      }
    );

    expect(evaluation.decision).toBe("parked");
    expect(evaluation.qualityGate.failures).toContain(
      "TikTok account needs warm-up or Account Check before launch cadence"
    );
    expect(evaluation.risks).toContain(
      "start with TikTok warm-up tasks before posting cadence"
    );
  });

  it("fails strategy validation when active channels are not evidence-backed", () => {
    const bad = [
      {
        channel: "reddit" as const,
        score: 0.8,
        decision: "primary" as const,
        confidence: "high" as const,
        reasons: [],
        risks: [],
        evidenceCardIds: ["a"],
        qualityGate: { passed: true, failures: [] },
      },
      {
        channel: "x" as const,
        score: 0.7,
        decision: "primary" as const,
        confidence: "medium" as const,
        reasons: [],
        risks: [],
        evidenceCardIds: ["b", "c"],
        firstWeekTest: "post and reply",
        qualityGate: { passed: true, failures: [] },
      },
    ];

    const gate = validateStrategyGate(bad);

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("strategy must choose exactly one primary channel");
    expect(gate.failures).toContain("reddit has too few cited evidence cards");
  });
});
