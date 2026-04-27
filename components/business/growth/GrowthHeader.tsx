/**
 * Sticky window selector + 3 top-line numbers at the top of the Growth tab.
 *
 * The window selector buttons are server-aware: Starter sees 7d/30d
 * available + 90d/YTD as locked (with a tooltip "upgrade to widen").
 * Window state lifts to the page so the queries observe it as a single
 * source of truth.
 */

"use client";

import { Lock, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import type {
  GrowthSummary,
  GrowthMetric,
} from "@/convex/queries/business/growth";

export type WindowChoice = "7d" | "30d" | "90d" | "ytd";
const ALL_WINDOWS: WindowChoice[] = ["7d", "30d", "90d", "ytd"];

const WINDOW_LABEL: Record<WindowChoice, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  ytd: "YTD",
};

interface GrowthHeaderProps {
  /** Currently-rendered summary (may be undefined while loading). */
  summary: GrowthSummary | null | undefined;
  /** Window the operator picked (may differ from summary.window when clamped). */
  selected: WindowChoice;
  onWindowChange: (w: WindowChoice) => void;
  /** Latest GBP score for the badge — Maya's persisted score, NEVER recomputed. */
  gbpScore: number | null;
  gbpScoreReasoning: string | null;
  onOpenScoreDrilldown: () => void;
}

export function GrowthHeader({
  summary,
  selected,
  onWindowChange,
  gbpScore,
  gbpScoreReasoning,
  onOpenScoreDrilldown,
}: GrowthHeaderProps) {
  const plan = summary?.plan ?? "starter";
  const isStarter = plan === "starter";

  const jobs = summary?.metrics.find((m) => m.key === "jobsBooked");
  const fiveStars = summary?.metrics.find((m) => m.key === "fiveStarReviews");

  return (
    <div
      data-testid="biz-growth-header"
      className="sticky top-0 z-10 border-b border-[var(--hairline)] bg-[var(--ink)]/85 px-5 py-4 backdrop-blur sm:px-8"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
        <div
          role="tablist"
          aria-label="Window"
          className="flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-ink-2 p-1"
        >
          {ALL_WINDOWS.map((w) => {
            const locked = isStarter && (w === "90d" || w === "ytd");
            const active = w === selected;
            return (
              <button
                key={w}
                role="tab"
                aria-selected={active}
                aria-disabled={locked}
                disabled={locked}
                data-testid={`biz-growth-window-${w}`}
                onClick={() => !locked && onWindowChange(w)}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                  active
                    ? "bg-lime text-ink"
                    : locked
                    ? "text-paper-faint/60"
                    : "text-paper-dim hover:text-paper"
                }`}
              >
                {locked && <Lock className="h-3 w-3" aria-hidden />}
                {WINDOW_LABEL[w]}
              </button>
            );
          })}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
          {plan} plan
        </span>
      </div>

      {summary?.clampedFromRequestedWindow && (
        <div
          data-testid="biz-growth-clamp-banner"
          className="mx-auto mt-3 max-w-5xl rounded-xl border border-amber-300/40 bg-amber-300/5 px-4 py-2 text-xs text-amber-100"
        >
          Starter plan covers the last 30 days. Upgrade to Pro for the full
          {" "}
          {summary.clampedFromRequestedWindow.toUpperCase()} window.
        </div>
      )}

      <div className="mx-auto mt-4 grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-3">
        <TopStat
          icon={<TrendingUp className="h-4 w-4 text-lime" aria-hidden />}
          label="Jobs"
          value={jobs?.value ?? 0}
          attributed={jobs?.attributedToMaya ?? null}
          deltaCount={deltaOf(jobs)}
        />
        <TopStat
          icon={<Sparkles className="h-4 w-4 text-lime" aria-hidden />}
          label="5-star reviews"
          value={fiveStars?.value ?? 0}
          attributed={fiveStars?.attributedToMaya ?? null}
          deltaCount={deltaOf(fiveStars)}
        />
        <button
          type="button"
          onClick={onOpenScoreDrilldown}
          data-testid="biz-growth-gbp-score-cta"
          className="flex flex-col items-start gap-2 rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-4 text-left transition-colors hover:bg-ink-2/70"
        >
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            <ShieldCheck className="h-4 w-4 text-lime" aria-hidden />
            GBP health score
          </span>
          {gbpScore !== null ? (
            <>
              <span className="font-display text-3xl tracking-tight text-paper">
                {Math.round(gbpScore)}
              </span>
              {gbpScoreReasoning && (
                <span className="line-clamp-2 text-xs text-paper-dim">
                  {gbpScoreReasoning}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-paper-faint">
              Maya runs the audit on the morning brief — your first score
              lands then.
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

function TopStat({
  icon,
  label,
  value,
  attributed,
  deltaCount,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  attributed: number | null;
  deltaCount: number | null;
}) {
  const deltaLabel =
    deltaCount === null
      ? null
      : deltaCount === 0
      ? "no change"
      : `${deltaCount > 0 ? "+" : ""}${deltaCount}`;
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-4">
      <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
        {icon}
        {label}
      </span>
      <span className="font-display text-3xl tracking-tight text-paper">
        {value.toLocaleString()}
      </span>
      <div className="flex items-center gap-2 text-xs text-paper-dim">
        {attributed !== null && value > 0 && (
          <span className="text-lime">Maya: {attributed} of {value}</span>
        )}
        {deltaLabel && <span className="text-paper-faint">{deltaLabel}</span>}
      </div>
    </div>
  );
}

function deltaOf(m: GrowthMetric | undefined): number | null {
  if (!m || m.priorValue === null) return null;
  return m.value - m.priorValue;
}
