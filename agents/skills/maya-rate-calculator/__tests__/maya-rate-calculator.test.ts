import { describe, it, expect } from "vitest";
import { computeBaselineRate } from "../script";
import { runFirewall } from "../../maya-citation-firewall/script";

describe("maya-rate-calculator — happy path", () => {
  it("computes a sane range for a lifestyle TikTok creator at 85k followers", () => {
    const result = computeBaselineRate({
      followerCount: 85000,
      niche: "lifestyle",
      deliverables: [
        {
          format: "tiktok-video",
          count: 1,
          exclusivity: { scope: "none", durationDays: 0 },
          usageRights: { kind: "organic-only", durationDays: 30 },
        },
      ],
    });
    // 85 * 14 * 1.0 * 1.05 * 1.10 = 1374.45
    // low = 1374.45 * 0.85 = 1168.28 -> rounded to nearest $50 = 1150
    // mid = 1374.45 -> 1400
    // high = 1374.45 * 1.20 = 1649.34 -> 1650
    expect(result.suggestedRate.low).toBeGreaterThanOrEqual(1100);
    expect(result.suggestedRate.low).toBeLessThanOrEqual(1200);
    expect(result.suggestedRate.high).toBeGreaterThanOrEqual(1600);
    expect(result.suggestedRate.high).toBeLessThanOrEqual(1700);
    expect(result.confidence).toBe("medium");
    expect(result.citations.length).toBeGreaterThanOrEqual(2);
  });

  it("anchors the range toward prior-deal average when prior deals exist", () => {
    const result = computeBaselineRate({
      followerCount: 120000,
      niche: "fitness",
      deliverables: [
        {
          format: "ig-reel",
          count: 2,
          exclusivity: { scope: "category", durationDays: 60 },
          usageRights: { kind: "paid-amplification", durationDays: 90 },
        },
      ],
      priorDeals: [
        { brand: "Gymshark", amount: 4500, format: "1× IG Reel + 3× Story" },
        { brand: "MyProtein", amount: 5200, format: "2× IG Reel" },
      ],
    });
    expect(result.confidence).toMatch(/^(high|medium)$/);
    expect(result.suggestedRate.mid).toBeGreaterThan(0);
    // Heuristic should be in the $4k-$8k zone after anchoring; assert the
    // citations include a prior-deal anchor.
    expect(
      result.citations.some((c) => c.kind === "prior-deal")
    ).toBe(true);
  });

  it("reasoning string passes the citation firewall", () => {
    const result = computeBaselineRate({
      followerCount: 50000,
      niche: "tech",
      deliverables: [{ format: "yt-short", count: 1 }],
    });
    const firewall = runFirewall({
      draft: result.reasoning,
      citations: result.citations.map((c) => ({
        kind: c.kind === "deliverable" ? "metric" : c.kind === "prior-deal" ? "deal" : "metric",
        id: c.id,
        fact: c.fact,
      })),
    });
    // The reasoning string is templated and every numeric claim it makes is
    // contained in the citations[].fact strings (the same numbers appear
    // verbatim in both). So the firewall must pass.
    if (!firewall.pass) {
      // Surface the offending claims for fast debugging.
      throw new Error(
        `Reasoning failed firewall: ${JSON.stringify(firewall.flaggedClaims)}`
      );
    }
    expect(firewall.pass).toBe(true);
  });
});

describe("maya-rate-calculator — adversarial / edge cases", () => {
  it("falls back to 'general' CPM and lowers confidence on unknown niche", () => {
    const result = computeBaselineRate({
      followerCount: 12000,
      niche: "underwater-basket-weaving",
      deliverables: [{ format: "yt-long", count: 1 }],
    });
    expect(result.confidence).toBe("low");
    expect(
      result.citations.some(
        (c) => c.kind === "heuristic-table" && c.id === "cpm:general"
      )
    ).toBe(true);
  });

  it("throws on negative followerCount", () => {
    expect(() =>
      computeBaselineRate({
        followerCount: -1,
        niche: "fitness",
        deliverables: [{ format: "tiktok-video", count: 1 }],
      })
    ).toThrow();
  });

  it("throws on empty deliverables", () => {
    expect(() =>
      computeBaselineRate({
        followerCount: 50000,
        niche: "fitness",
        deliverables: [],
      })
    ).toThrow();
  });

  it("throws on deliverable.count <= 0 (adversarial input)", () => {
    expect(() =>
      computeBaselineRate({
        followerCount: 50000,
        niche: "fitness",
        deliverables: [{ format: "tiktok-video", count: 0 }],
      })
    ).toThrow();
  });

  it("handles a 0-follower creator without crashing (returns $0 range)", () => {
    const result = computeBaselineRate({
      followerCount: 0,
      niche: "fitness",
      deliverables: [{ format: "tiktok-video", count: 1 }],
    });
    expect(result.suggestedRate.low).toBe(0);
    expect(result.suggestedRate.mid).toBe(0);
    expect(result.suggestedRate.high).toBe(0);
  });
});
