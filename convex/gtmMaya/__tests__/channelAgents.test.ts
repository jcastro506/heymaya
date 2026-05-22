import { describe, expect, it } from "vitest";
import {
  evaluateAllChannelAgents,
  evaluateChannelAgent,
  type ChannelAgentInput,
} from "../channelAgents";
import type { GtmEvidenceCard } from "../channelScoring";

function evidence(
  source: GtmEvidenceCard["source"],
  overrides: Partial<GtmEvidenceCard> = {}
): GtmEvidenceCard {
  return {
    id: `${source}-${Math.random()}`,
    source,
    url: `https://example.com/${source}`,
    title: `${source} evidence`,
    snippet: "specific channel evidence",
    observedAt: 1_700_000_000_000,
    recency: "fresh",
    painMatch: 0.8,
    buyerMatch: 0.75,
    channelFit: 0.78,
    promotionRisk: "low",
    recommendedUse: "strategy",
    extractedClaims: ["claim"],
    ...overrides,
  };
}

const BASE: Omit<ChannelAgentInput, "channel"> = {
  app: {
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    canPostTikTokManually: true,
    excludedAudiences: [],
    productType: "b2b_workflow",
  },
  evidence: [],
};

describe("GTM channel agents", () => {
  it("does not blindly recommend TikTok for a B2B workflow tool", () => {
    const verdict = evaluateChannelAgent({
      ...BASE,
      channel: "tiktok",
      evidence: [evidence("tiktok"), evidence("tiktok")],
    });

    expect(verdict.eligible).toBe(false);
    expect(verdict.rationale.join(" ")).toContain("parked");
  });

  it("can recommend TikTok for a visual consumer/prosumer app with recording capacity", () => {
    const verdict = evaluateChannelAgent({
      ...BASE,
      channel: "tiktok",
      app: {
        ...BASE.app,
        productType: "consumer_visual",
        canRecordScreen: true,
        canPostTikTokManually: true,
      },
      evidence: [evidence("tiktok"), evidence("tiktok")],
    });

    expect(verdict.eligible).toBe(true);
    expect(verdict.rationale).toContain("visual product/demo capacity exists");
  });

  it("requires Reddit risk to be explicit and blocks high promotion-risk evidence", () => {
    const safe = evaluateChannelAgent({
      ...BASE,
      channel: "reddit",
      evidence: [evidence("reddit"), evidence("reddit")],
    });
    const risky = evaluateChannelAgent({
      ...BASE,
      channel: "reddit",
      evidence: [
        evidence("reddit", { promotionRisk: "high" }),
        evidence("reddit"),
      ],
    });

    expect(safe.eligible).toBe(true);
    expect(safe.risks).toContain("must avoid drive-by promotion");
    expect(risky.eligible).toBe(false);
    expect(risky.risks).toContain("at least one source has high promotion risk");
  });

  it("requires B2B or professional context for LinkedIn", () => {
    const consumer = evaluateChannelAgent({
      ...BASE,
      channel: "linkedin",
      app: { ...BASE.app, productType: "consumer_visual" },
      evidence: [evidence("linkedin"), evidence("linkedin")],
    });
    const b2b = evaluateChannelAgent({
      ...BASE,
      channel: "linkedin",
      evidence: [evidence("linkedin"), evidence("linkedin")],
    });

    expect(consumer.eligible).toBe(false);
    expect(consumer.risks).toContain("audience may not be in a professional feed");
    expect(b2b.eligible).toBe(true);
  });

  it("returns opinionated channel verdicts rather than post-everywhere approval", () => {
    const verdicts = evaluateAllChannelAgents({
      ...BASE,
      evidence: [
        evidence("reddit"),
        evidence("reddit"),
        evidence("linkedin"),
        evidence("linkedin"),
      ],
    });

    expect(verdicts.filter((verdict) => verdict.eligible).map((v) => v.channel))
      .toEqual(["reddit", "linkedin"]);
    expect(verdicts.filter((verdict) => !verdict.eligible).length).toBeGreaterThan(0);
  });
});
