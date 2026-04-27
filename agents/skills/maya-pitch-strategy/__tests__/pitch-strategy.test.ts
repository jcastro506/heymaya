/**
 * Sprint 3.5b — `maya-pitch-strategy` unit tests.
 *
 * Pure-logic tests; no Convex, no LLM. Coverage:
 *   - happy path: each size-bucket produces the documented recommendation
 *     under the canonical input shape from SKILL.md
 *   - adversarial: hard "no X" creator goals override to decline; floor-rate
 *     enforcement triggers decline at established/pro tiers; exploitative
 *     hobbyist asks decline; missing prior deals cap conversion likelihood
 */

import { describe, it, expect } from "vitest";
import { decidePitchStrategy } from "../script";
import { runFirewall } from "../../maya-citation-firewall/script";

const today = (offsetDays: number): string => {
  const d = new Date(Date.now() - offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
};

describe("maya-pitch-strategy — happy path by bucket", () => {
  it("hobbyist with no paid history → pitch-free-build-book", () => {
    const result = decidePitchStrategy({
      creatorPicture: {
        followerCount: 4_500,
        monthlyRevenueUsd: 0,
        brandDealHistory: [],
      },
      opportunity: {
        brandName: "Lululemon",
        deliverables: "1× IG Reel",
        urgency: "low",
      },
      creatorGoals: "Build my fitness brand and grow to 50K followers.",
    });
    expect(result.recommendation).toBe("pitch-free-build-book");
    expect(result.suggestedRateUsd).toBeUndefined();
    expect(result.expectedConversionLikelihood).toBeGreaterThan(0);
    expect(result.expectedConversionLikelihood).toBeLessThanOrEqual(0.95);
    expect(result.citations.length).toBeGreaterThanOrEqual(2);
  });

  it("hobbyist with one recent paid deal → pitch-paid", () => {
    const result = decidePitchStrategy({
      creatorPicture: {
        followerCount: 8_000,
        monthlyRevenueUsd: 1_200,
        brandDealHistory: [{ amountUsd: 750, date: today(30) }],
      },
      opportunity: {
        brandName: "Athletic Greens",
        estimatedRateRange: { low: 600, high: 1_000 },
        deliverables: "1× IG Reel",
        urgency: "medium",
      },
      creatorGoals: "Land 4 paid deals this quarter.",
    });
    expect(result.recommendation).toBe("pitch-paid");
    expect(result.suggestedRateUsd).toBeGreaterThanOrEqual(600);
    expect(result.suggestedRateUsd).toBeLessThanOrEqual(1_000);
  });

  it("emerging tier with in-niche brand → pitch-paid with $500 floor", () => {
    const result = decidePitchStrategy({
      creatorPicture: {
        followerCount: 30_000,
        monthlyRevenueUsd: 5_000,
        brandDealHistory: [
          { amountUsd: 1_500, date: today(45) },
          { amountUsd: 2_000, date: today(60) },
        ],
      },
      opportunity: {
        brandName: "Glossier",
        estimatedRateRange: { low: 1_500, high: 3_000 },
        deliverables: "1× IG Reel + 2× Story",
        urgency: "high",
      },
      creatorGoals: "Land in-niche beauty deals.",
    });
    expect(result.recommendation).toBe("pitch-paid");
    expect(result.suggestedRateUsd).toBeGreaterThanOrEqual(500);
  });

  it("established tier with brand offer above floor → pitch-paid at trailing-3 anchor", () => {
    const result = decidePitchStrategy({
      creatorPicture: {
        followerCount: 200_000,
        monthlyRevenueUsd: 18_000,
        brandDealHistory: [
          { amountUsd: 8_000, date: today(20) },
          { amountUsd: 9_000, date: today(50) },
          { amountUsd: 7_000, date: today(80) },
        ],
      },
      opportunity: {
        brandName: "Sephora",
        estimatedRateRange: { low: 7_000, high: 10_000 },
        deliverables: "1× IG Reel + 1× TikTok video",
        urgency: "medium",
      },
      creatorGoals: "Sustain $20K/mo from brand deals.",
    });
    expect(result.recommendation).toBe("pitch-paid");
    expect(result.suggestedRateUsd).toBeGreaterThanOrEqual(7_000);
  });

  it("pro tier with high-end estimate above floor → pitch-paid at trailing-3 high", () => {
    const result = decidePitchStrategy({
      creatorPicture: {
        followerCount: 800_000,
        monthlyRevenueUsd: 75_000,
        brandDealHistory: [
          { amountUsd: 25_000, date: today(15) },
          { amountUsd: 30_000, date: today(45) },
          { amountUsd: 28_000, date: today(75) },
        ],
      },
      opportunity: {
        brandName: "Nike",
        estimatedRateRange: { low: 30_000, high: 45_000 },
        deliverables: "1× YT integration + 2× IG Reel",
        urgency: "high",
      },
      creatorGoals: "Tier-1 brand only.",
    });
    expect(result.recommendation).toBe("pitch-paid");
    expect(result.suggestedRateUsd).toBeGreaterThanOrEqual(30_000);
  });
});

describe("maya-pitch-strategy — adversarial / overrides", () => {
  it("hard-no goal keyword forces decline regardless of bucket", () => {
    // The keyword detector is conservative: it triggers when the offending
    // category phrase appears in either the brand name OR the deliverables
    // string. Real-world inputs are upstream-augmented (the wrapping action
    // looks up brand → category metadata before invoking this skill); for
    // the unit test we exercise the deliverables-side trigger.
    const result = decidePitchStrategy({
      creatorPicture: {
        followerCount: 100_000,
        monthlyRevenueUsd: 12_000,
        brandDealHistory: [{ amountUsd: 5_000, date: today(20) }],
      },
      opportunity: {
        brandName: "BigRetail",
        deliverables: "1× TikTok haul of fast fashion items",
        urgency: "high",
      },
      creatorGoals: "No fast fashion brands ever.",
    });
    expect(result.recommendation).toBe("decline");
    expect(result.riskOfMisaligningCreator).toBe("high");
    expect(result.expectedConversionLikelihood).toBe(0);
    expect(result.suggestedRateUsd).toBeUndefined();
  });

  it("established tier — brand offer below floor → decline", () => {
    const result = decidePitchStrategy({
      creatorPicture: {
        followerCount: 250_000,
        monthlyRevenueUsd: 25_000,
        brandDealHistory: [
          { amountUsd: 10_000, date: today(15) },
          { amountUsd: 12_000, date: today(45) },
          { amountUsd: 11_000, date: today(75) },
        ],
      },
      opportunity: {
        brandName: "TinyBrand",
        estimatedRateRange: { low: 1_000, high: 2_500 },
        deliverables: "1× IG Reel",
        urgency: "low",
      },
      creatorGoals: "Maintain $25K/mo.",
    });
    expect(result.recommendation).toBe("decline");
  });

  it("hobbyist with exploitative ask (4 posts + full buyout) → decline", () => {
    const result = decidePitchStrategy({
      creatorPicture: {
        followerCount: 6_000,
        monthlyRevenueUsd: 500,
        brandDealHistory: [],
      },
      opportunity: {
        brandName: "BigCorp",
        deliverables: "4 posts on TikTok with full buyout usage rights",
        urgency: "medium",
      },
      creatorGoals: "Build my following.",
    });
    expect(result.recommendation).toBe("decline");
  });

  it("zero-prior-deal hobbyist gets reduced conversion likelihood", () => {
    const result = decidePitchStrategy({
      creatorPicture: {
        followerCount: 5_000,
        monthlyRevenueUsd: 0,
        brandDealHistory: [],
      },
      opportunity: {
        brandName: "RuckPack",
        deliverables: "1× IG Story",
        urgency: "low",
      },
      creatorGoals: "Try things and see what sticks.",
    });
    // base for free-build-book = 0.40, minus 0.10 for no prior deals = 0.30
    expect(result.expectedConversionLikelihood).toBeCloseTo(0.3, 2);
  });

  it("throws on negative followerCount", () => {
    expect(() =>
      decidePitchStrategy({
        creatorPicture: {
          followerCount: -1,
          monthlyRevenueUsd: 0,
          brandDealHistory: [],
        },
        opportunity: { brandName: "X", deliverables: "x", urgency: "low" },
        creatorGoals: "x",
      })
    ).toThrow();
  });

  it("throws on empty brand name (adversarial input)", () => {
    expect(() =>
      decidePitchStrategy({
        creatorPicture: {
          followerCount: 1000,
          monthlyRevenueUsd: 0,
          brandDealHistory: [],
        },
        opportunity: { brandName: "  ", deliverables: "x", urgency: "low" },
        creatorGoals: "x",
      })
    ).toThrow();
  });

  it("reasoning string passes the citation firewall against returned citations", () => {
    const result = decidePitchStrategy({
      creatorPicture: {
        followerCount: 35_000,
        monthlyRevenueUsd: 6_000,
        brandDealHistory: [{ amountUsd: 2_000, date: today(40) }],
      },
      opportunity: {
        brandName: "Glossier",
        estimatedRateRange: { low: 1_500, high: 3_000 },
        deliverables: "1× IG Reel + 2× Story",
        urgency: "medium",
      },
      creatorGoals: "Land in-niche beauty deals.",
    });
    const firewall = runFirewall({
      draft: result.reasoning,
      citations: result.citations.map((c) => ({
        kind: c.kind,
        id: c.id,
        fact: c.fact,
      })),
    });
    if (!firewall.pass) {
      throw new Error(
        `pitch-strategy reasoning failed firewall: ${JSON.stringify(firewall.flaggedClaims)}`
      );
    }
    expect(firewall.pass).toBe(true);
  });
});
