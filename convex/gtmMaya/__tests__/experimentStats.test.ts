/**
 * Sprint 4 (top-tier) — the experiment-stats core. Pure functions, so these are
 * exact + deterministic. Covers: the canonical "leaning" example, the winner
 * floor (P(best) alone is never enough), determinism, single-arm honesty, the
 * not-enough-data → conversionsNeeded path, and the single-motion assessor.
 */
import { describe, expect, it } from "vitest";
import {
  summarizeExperiment,
  assessSingleMotion,
  confirmedConversions,
  WIN_THRESHOLD,
  MIN_CONVERSIONS,
} from "../experimentStats";

describe("summarizeExperiment — Beta-Bernoulli verdict", () => {
  it("the canonical example: 3/12 vs 0/9 → leans to the converter, not a winner", () => {
    const v = summarizeExperiment([
      { label: "lowercase", trials: 12, conversions: 3 },
      { label: "polished", trials: 9, conversions: 0 },
    ]);
    expect(v.leader).toBe("lowercase");
    // It should clearly favor lowercase but NOT call a winner (only 3 conversions,
    // below the floor) — this is the "84% likely better, not enough to promote" case.
    expect(v.pBestLeader).toBeGreaterThan(0.75);
    expect(v.verdict).toBe("leaning");
    expect(v.winner).toBeNull();
    expect(v.conversionsNeeded).toBeGreaterThan(0);
  });

  it("a winner needs BOTH high P(best) AND the conversion floor", () => {
    // Strong separation AND the leader clears MIN_CONVERSIONS.
    const v = summarizeExperiment([
      { label: "A", trials: 40, conversions: 12 },
      { label: "B", trials: 38, conversions: 1 },
    ]);
    expect(v.verdict).toBe("winner");
    expect(v.winner).toBe("A");
    expect(v.pBestLeader).toBeGreaterThanOrEqual(WIN_THRESHOLD);
    expect(v.arms.find((a) => a.label === "A")!.conversions).toBeGreaterThanOrEqual(
      MIN_CONVERSIONS
    );
    expect(v.conversionsNeeded).toBe(0);
  });

  it("high P(best) on TINY conversions is NOT a winner (floor guard)", () => {
    // 2/2 vs 0/2 → pBest is high, but 2 < MIN_CONVERSIONS, so no winner.
    const v = summarizeExperiment([
      { label: "tiny", trials: 2, conversions: 2 },
      { label: "zero", trials: 2, conversions: 0 },
    ]);
    expect(v.verdict).not.toBe("winner");
    expect(v.winner).toBeNull();
    expect(v.conversionsNeeded).toBeGreaterThan(0);
  });

  it("is deterministic — same input yields the identical verdict + pBest", () => {
    const arms = [
      { label: "a", trials: 20, conversions: 5 },
      { label: "b", trials: 22, conversions: 2 },
    ];
    const a = summarizeExperiment(arms);
    const b = summarizeExperiment(arms);
    expect(a.pBestLeader).toBe(b.pBestLeader);
    expect(a.verdict).toBe(b.verdict);
    expect(a.arms.map((x) => x.pBest)).toEqual(b.arms.map((x) => x.pBest));
  });

  it("a single arm can never 'win' a comparison (no alternative to beat)", () => {
    const v = summarizeExperiment([{ label: "only", trials: 30, conversions: 9 }]);
    expect(v.verdict).toBe("not_enough_data");
    expect(v.winner).toBeNull();
    expect(v.reason).toMatch(/one variant|nothing to compare/i);
  });

  it("no conversions anywhere → not_enough_data + needs the full floor", () => {
    const v = summarizeExperiment([
      { label: "a", trials: 50, conversions: 0 },
      { label: "b", trials: 60, conversions: 0 },
    ]);
    expect(v.verdict).toBe("not_enough_data");
    expect(v.conversionsNeeded).toBe(MIN_CONVERSIONS);
  });

  it("empty input is handled (no arms)", () => {
    const v = summarizeExperiment([]);
    expect(v.verdict).toBe("not_enough_data");
    expect(v.leader).toBeNull();
    expect(v.arms).toEqual([]);
  });

  it("sanitizes conversions > trials (clamps, never NaN)", () => {
    const v = summarizeExperiment([{ label: "bad", trials: 3, conversions: 99 }]);
    expect(v.arms[0].conversions).toBe(3);
    expect(Number.isFinite(v.arms[0].mean)).toBe(true);
    expect(v.arms[0].mean).toBeGreaterThan(0);
    expect(v.arms[0].mean).toBeLessThanOrEqual(1);
  });
});

describe("confirmedConversions — unweighted real customer actions", () => {
  it("sums real conversions and ignores vanity (no replies/likes weighting)", () => {
    expect(
      confirmedConversions({ signups: 2, demos: 1, feedbackItems: 1 })
    ).toBe(4);
    // No 'replies' or 'likes' term exists — vanity can't inflate the count.
    expect(confirmedConversions({})).toBe(0);
  });
});

describe("assessSingleMotion — honest floor, not a weighted threshold", () => {
  it("clears the floor → strong", () => {
    const a = assessSingleMotion(MIN_CONVERSIONS, { samples: 20 });
    expect(a.signal).toBe("strong");
    expect(a.conversionsNeeded).toBe(0);
  });

  it("below the floor → not_enough_data with an exact conversionsNeeded", () => {
    const a = assessSingleMotion(2, { samples: 10 });
    expect(a.signal).toBe("not_enough_data");
    expect(a.conversionsNeeded).toBe(MIN_CONVERSIONS - 2);
    expect(a.reason).toMatch(/need 3 more/i);
  });

  it("lots of reach, zero conversions → weak (revise/park), not 'too early'", () => {
    const a = assessSingleMotion(0, { samples: 100, largeExposureNoConversion: true });
    expect(a.signal).toBe("weak");
    expect(a.reason).toMatch(/isn't converting|revise or park/i);
  });
});
