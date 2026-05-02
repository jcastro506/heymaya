export type TrendVendor = "scrapeCreators" | "apify";

export interface TrendQueryScore {
  queryId: string;
  vendor: TrendVendor;
  freshnessHours: number | null;
  relevance: number;
  duplicateRate: number;
  metricsCoverage: number;
  costUsd: number;
  latencyMs: number;
  failed: boolean;
}

export interface VendorBenchmarkSummary {
  vendor: TrendVendor;
  queryCount: number;
  wins: number;
  averageScore: number;
  failureRate: number;
  averageCostUsd: number;
}

export type TrendVendorDecision =
  | {
      mode: "scrapeCreators_primary";
      reason: string;
      summaries: Record<TrendVendor, VendorBenchmarkSummary>;
    }
  | {
      mode: "scrapeCreators_primary_apify_fallback";
      reason: string;
      summaries: Record<TrendVendor, VendorBenchmarkSummary>;
    };

export function scoreTrendSourceResult(score: TrendQueryScore): number {
  if (score.failed) return 0;
  const freshness = score.freshnessHours === null
    ? 0
    : clamp01(1 - score.freshnessHours / 48);
  const relevance = clamp01(score.relevance);
  const uniqueness = clamp01(1 - score.duplicateRate);
  const metrics = clamp01(score.metricsCoverage);
  const latency = clamp01(1 - score.latencyMs / 15_000);
  const cost = clamp01(1 - score.costUsd / 0.25);

  return (
    freshness * 0.3 +
    relevance * 0.3 +
    uniqueness * 0.15 +
    metrics * 0.15 +
    latency * 0.05 +
    cost * 0.05
  );
}

export function decideTrendVendor(
  scores: ReadonlyArray<TrendQueryScore>
): TrendVendorDecision {
  const summaries = summarizeTrendBenchmark(scores);
  const queryIds = [...new Set(scores.map((s) => s.queryId))];
  let scrapeWinsOrTies = 0;
  let apifyWins = 0;

  for (const queryId of queryIds) {
    const scrape = scores.find(
      (s) => s.queryId === queryId && s.vendor === "scrapeCreators"
    );
    const apify = scores.find((s) => s.queryId === queryId && s.vendor === "apify");
    if (!scrape || !apify) continue;

    const scrapeScore = scoreTrendSourceResult(scrape);
    const apifyScore = scoreTrendSourceResult(apify);
    if (scrapeScore >= apifyScore) scrapeWinsOrTies += 1;
    else apifyWins += 1;
  }

  if (apifyWins >= 7) {
    return {
      mode: "scrapeCreators_primary_apify_fallback",
      reason: `Apify won ${apifyWins}/${queryIds.length} benchmark queries.`,
      summaries,
    };
  }

  return {
    mode: "scrapeCreators_primary",
    reason: `ScrapeCreators won or tied ${scrapeWinsOrTies}/${queryIds.length} benchmark queries.`,
    summaries,
  };
}

export function summarizeTrendBenchmark(
  scores: ReadonlyArray<TrendQueryScore>
): Record<TrendVendor, VendorBenchmarkSummary> {
  const vendors: TrendVendor[] = ["scrapeCreators", "apify"];
  const queryIds = [...new Set(scores.map((s) => s.queryId))];
  const wins = new Map<TrendVendor, number>([
    ["scrapeCreators", 0],
    ["apify", 0],
  ]);

  for (const queryId of queryIds) {
    const byVendor = vendors
      .map((vendor) => scores.find((s) => s.queryId === queryId && s.vendor === vendor))
      .filter((s): s is TrendQueryScore => Boolean(s));
    if (byVendor.length === 0) continue;
    const ranked = byVendor.sort(
      (a, b) => scoreTrendSourceResult(b) - scoreTrendSourceResult(a)
    );
    wins.set(ranked[0].vendor, (wins.get(ranked[0].vendor) ?? 0) + 1);
  }

  return {
    scrapeCreators: summarizeVendor("scrapeCreators", scores, wins),
    apify: summarizeVendor("apify", scores, wins),
  };
}

function summarizeVendor(
  vendor: TrendVendor,
  scores: ReadonlyArray<TrendQueryScore>,
  wins: ReadonlyMap<TrendVendor, number>
): VendorBenchmarkSummary {
  const rows = scores.filter((s) => s.vendor === vendor);
  const total = rows.length || 1;
  return {
    vendor,
    queryCount: rows.length,
    wins: wins.get(vendor) ?? 0,
    averageScore: rows.reduce((sum, s) => sum + scoreTrendSourceResult(s), 0) / total,
    failureRate: rows.filter((s) => s.failed).length / total,
    averageCostUsd: rows.reduce((sum, s) => sum + s.costUsd, 0) / total,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
