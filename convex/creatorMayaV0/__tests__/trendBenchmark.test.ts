import { describe, expect, it } from "vitest";
import {
  decideTrendVendor,
  scoreTrendSourceResult,
  type TrendQueryScore,
  type TrendVendor,
} from "../trendBenchmark";

function score(
  queryId: string,
  vendor: TrendVendor,
  overrides: Partial<TrendQueryScore> = {}
): TrendQueryScore {
  return {
    queryId,
    vendor,
    freshnessHours: 6,
    relevance: 0.8,
    duplicateRate: 0.1,
    metricsCoverage: 0.9,
    costUsd: vendor === "scrapeCreators" ? 0.02 : 0.08,
    latencyMs: vendor === "scrapeCreators" ? 1_000 : 2_000,
    failed: false,
    ...overrides,
  };
}

describe("Creator Maya v0 trend-source benchmark", () => {
  it("penalizes stale, duplicate, expensive, failed trend results", () => {
    const strong = score("q1", "scrapeCreators");
    const failed = score("q1", "apify", { failed: true });
    const stale = score("q1", "apify", {
      freshnessHours: 72,
      duplicateRate: 0.7,
      costUsd: 0.3,
    });

    expect(scoreTrendSourceResult(strong)).toBeGreaterThan(
      scoreTrendSourceResult(stale)
    );
    expect(scoreTrendSourceResult(failed)).toBe(0);
  });

  it("keeps ScrapeCreators primary when it wins or ties most benchmark queries", () => {
    const rows: TrendQueryScore[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push(score(`q${i}`, "scrapeCreators"));
      rows.push(score(`q${i}`, "apify", { relevance: i < 5 ? 0.9 : 0.65 }));
    }

    const decision = decideTrendVendor(rows);

    expect(decision.mode).toBe("scrapeCreators_primary");
    expect(decision.reason).toContain("ScrapeCreators");
  });

  it("adds Apify only as fallback when it wins at least 7 benchmark queries", () => {
    const rows: TrendQueryScore[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push(
        score(`q${i}`, "scrapeCreators", {
          freshnessHours: i < 7 ? 36 : 6,
          relevance: i < 7 ? 0.4 : 0.8,
        })
      );
      rows.push(
        score(`q${i}`, "apify", {
          freshnessHours: 4,
          relevance: i < 7 ? 0.95 : 0.65,
          costUsd: 0.08,
        })
      );
    }

    const decision = decideTrendVendor(rows);

    expect(decision.mode).toBe("scrapeCreators_primary_apify_fallback");
    expect(decision.summaries.apify.wins).toBeGreaterThanOrEqual(7);
  });
});
