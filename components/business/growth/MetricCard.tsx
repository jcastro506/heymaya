/**
 * Single metric card on the Growth tab.
 *
 * Shape:
 *   ┌─ EYEBROW ─────── (optional Maya-attribution badge)
 *   │  TITLE
 *   │  BIG VALUE                          delta-pill
 *   │  sparkline ───────────────────
 *   └──────────────────────────────────────
 *
 * The Maya-attribution badge ("Maya: 3 of 12") is only shown when the
 * upstream query supplies an `attributedToMaya` count — that's the
 * load-bearing signal: every job + 5-star with Maya's fingerprint is
 * the product's value-prop.
 */

import { Sparkline } from "@/components/creator/Sparkline";
import { ArrowDown, ArrowRight, ArrowUp, Sparkles } from "lucide-react";

export interface MetricCardProps {
  eyebrow: string;
  title: string;
  /** Pre-formatted main value (e.g. "12", "3.2%", "47s"). */
  formattedValue: string;
  /** Numeric delta vs prior period (UI-formatted by caller for percent vs absolute). */
  deltaLabel: string | null;
  /** Direction of the delta (drives icon + colour). */
  deltaDirection: "up" | "down" | "flat" | null;
  /** Sparkline values; pass [] to suppress. */
  spark: ReadonlyArray<number>;
  /** "Maya: X of Y" line; null suppresses. */
  attributionLabel: string | null;
  /** Optional dataset attribute used by tests. */
  testId?: string;
}

export function MetricCard({
  eyebrow,
  title,
  formattedValue,
  deltaLabel,
  deltaDirection,
  spark,
  attributionLabel,
  testId,
}: MetricCardProps) {
  return (
    <div
      data-testid={testId ?? "biz-growth-metric-card"}
      className="flex flex-col gap-3 rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            {eyebrow}
          </span>
          <h3 className="mt-1 font-display text-base text-paper">{title}</h3>
        </div>
        {attributionLabel && (
          <span
            data-testid="biz-growth-metric-attribution"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-lime/30 bg-lime/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-lime"
          >
            <Sparkles className="h-3 w-3" aria-hidden />
            {attributionLabel}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="font-display text-3xl tracking-tight text-paper">
          {formattedValue}
        </div>
        {deltaLabel && (
          <DeltaPill direction={deltaDirection ?? "flat"} label={deltaLabel} />
        )}
      </div>
      {spark.length > 1 && (
        <div className="text-paper-faint">
          <Sparkline values={[...spark]} height={28} ariaLabel={`${title} trend`} showBaseline={false} />
        </div>
      )}
    </div>
  );
}

function DeltaPill({
  direction,
  label,
}: {
  direction: "up" | "down" | "flat";
  label: string;
}) {
  const cls =
    direction === "up"
      ? "border-lime/30 bg-lime/10 text-lime"
      : direction === "down"
      ? "border-rose-300/40 bg-rose-300/10 text-rose-200"
      : "border-[var(--hairline)] bg-ink-3 text-paper-dim";
  const Icon =
    direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : ArrowRight;
  return (
    <span
      data-testid="biz-growth-metric-delta"
      data-direction={direction}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}
