import { describe, expect, it } from "vitest";
import type { GtmEvidenceCard } from "../channelScoring";
import {
  assessUgcReadiness,
  buildFormatExperimentPlan,
  decideExperimentScale,
  evaluateDistributionMotions,
} from "../distributionMotions";

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

describe("GTM distribution motions", () => {
  it("turns a visual consumer app into concrete short-form motions", () => {
    const verdicts = evaluateDistributionMotions({
      app: {
        stage: "live-beta",
        weekGoal: "signups",
        canRecordScreen: true,
        canShowFace: false,
        excludedAudiences: [],
        productType: "consumer_visual",
      },
      evidence: [
        evidence("tiktok"),
        evidence("tiktok"),
        evidence("reddit"),
        evidence("reddit"),
      ],
    });

    const faceless = verdicts.find((v) => v.motion === "tiktok_faceless_demo");
    const slideshow = verdicts.find(
      (v) => v.motion === "tiktok_slideshow_carousel"
    );
    const ugc = verdicts.find((v) => v.motion === "ugc_creator_test");

    expect(faceless?.status).toBe("test_now");
    expect(faceless?.doubleDownCriteria).toContain("installs");
    expect(slideshow?.status).toBe("test_now");
    expect(slideshow?.minimumCadence).toContain("slideshow");
    expect(ugc?.status).toBe("test_later");
    expect(ugc?.risks.join(" ")).toContain("premature");
  });

  it("parks TikTok motions for B2B tools without visual proof", () => {
    const verdicts = evaluateDistributionMotions({
      app: {
        stage: "live-beta",
        weekGoal: "demos",
        canRecordScreen: false,
        canShowFace: false,
        excludedAudiences: [],
        productType: "b2b_workflow",
      },
      evidence: [
        evidence("linkedin"),
        evidence("linkedin"),
        evidence("tiktok"),
        evidence("tiktok"),
      ],
    });

    expect(
      verdicts.find((v) => v.motion === "linkedin_founder_led")?.status
    ).toBe("test_now");
    expect(verdicts.find((v) => v.motion === "tiktok_faceless_demo")?.status)
      .toBe("parked");
    expect(
      verdicts.find((v) => v.motion === "tiktok_slideshow_carousel")?.status
    ).toBe("parked");
  });

  it("builds variants from a chosen motion instead of a single generic post", () => {
    const verdict = evaluateDistributionMotions({
      app: {
        stage: "live-beta",
        weekGoal: "signups",
        canRecordScreen: true,
        canShowFace: false,
        excludedAudiences: [],
        productType: "consumer_visual",
      },
      evidence: [evidence("tiktok"), evidence("tiktok")],
    }).find((v) => v.motion === "tiktok_faceless_demo");

    expect(verdict).toBeDefined();
    const plan = buildFormatExperimentPlan(verdict!, "ClipForge");

    expect(plan.motion).toBe("tiktok_faceless_demo");
    expect(plan.variants.length).toBeGreaterThan(1);
    expect(plan.variants[0].formatSkeleton).toContain("pain");
    expect(plan.scaleDecision).toBe("keep_testing");
  });

  it("builds TikTok slideshow experiments for screenshot-led products", () => {
    const verdict = evaluateDistributionMotions({
      app: {
        stage: "live-beta",
        weekGoal: "signups",
        canRecordScreen: true,
        canShowFace: false,
        excludedAudiences: [],
        productType: "consumer_visual",
      },
      evidence: [evidence("tiktok"), evidence("tiktok")],
    }).find((v) => v.motion === "tiktok_slideshow_carousel");

    expect(verdict).toBeDefined();
    const plan = buildFormatExperimentPlan(verdict!, "ClipForge");

    expect(plan.motion).toBe("tiktok_slideshow_carousel");
    expect(plan.variants[0].formatSkeleton).toContain("problem slide");
    expect(plan.variants[1].formatSkeleton).toContain("product reveal");
  });

  it("does not mark high-view low-signal posts as winners", () => {
    expect(decideExperimentScale([{ views: 80_000, likes: 2_000 }])).toBe("revise");
    expect(
      decideExperimentScale([
        { views: 5_000, replies: 2, signups: 2 },
        { views: 4_000, installs: 2 },
        { views: 3_000, trials: 1 },
      ])
    ).toBe("double_down");
  });

  it("keeps UGC advisory-only until a short-form motion wins", () => {
    const usefulSoon = assessUgcReadiness({
      app: {
        stage: "live-beta",
        weekGoal: "signups",
        canRecordScreen: true,
        canShowFace: false,
        excludedAudiences: [],
      },
      motionDecisions: [
        { motion: "tiktok_faceless_demo", scaleDecision: "keep_testing" },
      ],
    });
    const ready = assessUgcReadiness({
      app: {
        stage: "live-beta",
        weekGoal: "signups",
        canRecordScreen: true,
        canShowFace: false,
        excludedAudiences: [],
      },
      motionDecisions: [
        { motion: "tiktok_slideshow_carousel", scaleDecision: "double_down" },
      ],
    });

    expect(usefulSoon.readiness).toBe("useful_soon");
    expect(usefulSoon.requiredProof.join(" ")).toContain("three short-form tests");
    expect(ready.readiness).toBe("ready");
    expect(ready.trainingOutline?.length).toBeGreaterThan(2);
  });
});
