/**
 * Orchestrator that turns a `GrowthSummary` into a grid of MetricCards.
 *
 * Lives as a separate component so the Growth page can keep its render
 * function shallow; per-card formatting (percent vs count vs ms) lives
 * here in one place.
 */

import { MetricCard } from "./MetricCard";
import type { GrowthSummary, GrowthMetric } from "@/convex/queries/business/growth";

interface MetricsGridProps {
  summary: GrowthSummary;
}

export function MetricsGrid({ summary }: MetricsGridProps) {
  return (
    <div
      data-testid="biz-growth-metrics-grid"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {summary.metrics.map((m) => {
        const view = formatMetric(m);
        return (
          <MetricCard
            key={m.key}
            eyebrow={view.eyebrow}
            title={view.title}
            formattedValue={view.formattedValue}
            deltaLabel={view.deltaLabel}
            deltaDirection={view.deltaDirection}
            spark={m.spark}
            attributionLabel={view.attributionLabel}
            testId={`biz-growth-metric-${m.key}`}
          />
        );
      })}
    </div>
  );
}

interface MetricView {
  eyebrow: string;
  title: string;
  formattedValue: string;
  deltaLabel: string | null;
  deltaDirection: "up" | "down" | "flat" | null;
  attributionLabel: string | null;
}

function formatMetric(m: GrowthMetric): MetricView {
  const meta = METRIC_META[m.key];
  const formattedValue = formatValue(m.value, meta.format);

  let deltaLabel: string | null = null;
  let deltaDirection: "up" | "down" | "flat" | null = null;
  if (m.priorValue !== null) {
    const diff = m.value - m.priorValue;
    if (diff === 0) {
      deltaLabel = "no change";
      deltaDirection = "flat";
    } else {
      const direction = directionFor(diff, meta.lowerIsBetter ?? false);
      deltaDirection = direction;
      deltaLabel = formatDelta(diff, m.value, m.priorValue, meta.format);
    }
  }

  let attributionLabel: string | null = null;
  if (m.attributedToMaya !== null && m.value > 0) {
    attributionLabel = `Maya: ${m.attributedToMaya} of ${m.value}`;
  }

  return {
    eyebrow: meta.eyebrow,
    title: meta.title,
    formattedValue,
    deltaLabel,
    deltaDirection,
    attributionLabel,
  };
}

function directionFor(
  diff: number,
  lowerIsBetter: boolean
): "up" | "down" | "flat" {
  if (diff === 0) return "flat";
  if (diff > 0) return lowerIsBetter ? "down" : "up";
  return lowerIsBetter ? "up" : "down";
}

function formatValue(
  value: number,
  format: "count" | "percent" | "ms"
): string {
  switch (format) {
    case "count":
      return value.toLocaleString();
    case "percent":
      return `${value.toFixed(1)}%`;
    case "ms":
      return formatMs(value);
  }
}

function formatMs(ms: number): string {
  if (ms <= 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  return `${hr}h`;
}

function formatDelta(
  diff: number,
  value: number,
  prior: number,
  format: "count" | "percent" | "ms"
): string {
  const sign = diff > 0 ? "+" : "";
  if (format === "ms") {
    if (prior === 0) return `+${formatMs(value)}`;
    return `${sign}${formatMs(Math.abs(diff))}`;
  }
  if (format === "percent") {
    return `${sign}${diff.toFixed(1)}pp`;
  }
  // count
  if (prior === 0) return `+${value.toLocaleString()}`;
  const pct = Math.round((diff / prior) * 100);
  return `${sign}${pct}%`;
}

const METRIC_META: Record<
  GrowthMetric["key"],
  {
    eyebrow: string;
    title: string;
    format: "count" | "percent" | "ms";
    lowerIsBetter?: boolean;
  }
> = {
  jobsBooked: {
    eyebrow: "North star",
    title: "Jobs booked",
    format: "count",
  },
  fiveStarReviews: {
    eyebrow: "North star",
    title: "5-star reviews",
    format: "count",
  },
  totalReviews: {
    eyebrow: "Reviews",
    title: "Total reviews",
    format: "count",
  },
  gbpCalls: {
    eyebrow: "GBP",
    title: "Calls clicked",
    format: "count",
  },
  gbpDirections: {
    eyebrow: "GBP",
    title: "Directions clicked",
    format: "count",
  },
  gbpWebsiteClicks: {
    eyebrow: "GBP",
    title: "Website clicks",
    format: "count",
  },
  metaPostEngagement: {
    eyebrow: "Meta",
    title: "Post engagement",
    format: "count",
  },
  leadToJobConversion: {
    eyebrow: "Funnel",
    title: "Lead → job conversion",
    format: "percent",
  },
  avgResponseLatencyMs: {
    eyebrow: "Funnel",
    title: "Avg response latency",
    format: "ms",
    lowerIsBetter: true,
  },
};
