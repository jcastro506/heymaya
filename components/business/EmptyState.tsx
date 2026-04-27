/**
 * Stage-aware empty state for service-business HQ screens.
 *
 * Service Sprint Plan § 12.1 calls for a Day-0 stage-aware empty state on
 * Today: "Maya is reading your reviews — first brief at 7am tomorrow."
 *
 * Generalized here so every screen can render a consistent empty surface
 * with a clear next step. Three stages mirror the operator's onboarding
 * arc:
 *   - "fresh"     — just signed up, no data yet (Maya is reading)
 *   - "ready"     — data is in but the specific surface is empty
 *                  (e.g. no reviews drafted today)
 *   - "blocked"   — operator-action required (e.g. CRM not connected on
 *                  Customers screen for a Pro tier with no Jobber wired)
 */

import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";

export interface EmptyStateProps {
  /** Stage drives the visual treatment + copy tone. */
  stage: "fresh" | "ready" | "blocked";
  /** One-line headline ("No reviews drafted today"). */
  title: string;
  /** Two-line max body ("Maya wakes at 7am to scan overnight reviews."). */
  body: string;
  /** Optional CTA — usually the path to fix the gap (e.g. /biz/profile). */
  cta?: { label: string; href: string };
  /** Optional icon override; defaults to Sparkles. */
  icon?: LucideIcon;
  /** Optional test id for component tests. */
  testId?: string;
}

export function EmptyState({
  stage,
  title,
  body,
  cta,
  icon,
  testId,
}: EmptyStateProps) {
  const Icon = icon ?? Sparkles;
  const accent =
    stage === "blocked"
      ? "text-amber-300"
      : stage === "ready"
      ? "text-paper-dim"
      : "text-lime";
  const ring =
    stage === "blocked"
      ? "border-amber-300/30"
      : "border-[var(--hairline)]";
  return (
    <div
      data-testid={testId ?? "biz-empty-state"}
      data-stage={stage}
      className={`flex flex-col items-start gap-4 rounded-2xl border ${ring} bg-ink-2/40 p-6`}
    >
      <Icon className={`h-5 w-5 ${accent}`} aria-hidden />
      <div>
        <h3 className="font-display text-xl tracking-tight text-paper">
          {title}
        </h3>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-paper-dim">
          {body}
        </p>
      </div>
      {cta && (
        <a
          href={cta.href}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline-strong)] bg-ink-3 px-4 py-2 text-xs font-mono uppercase tracking-widest text-paper transition-colors hover:bg-ink-3/80"
        >
          {cta.label}
        </a>
      )}
    </div>
  );
}
