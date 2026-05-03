/**
 * GBP Health Score drilldown sheet.
 *
 * Surfaces Maya's score + reasoning verbatim. CRITICAL: this component does
 * NOT recompute the score, decompose it, or show "input weights" — per the
 * judgment-not-rules invariant the score IS Maya's call. The drilldown's
 * job is provenance: model + thinking budget + nudges count.
 *
 * Nudges themselves live in OpenClaw's queue (operator chat surface) — we
 * don't reach into that runtime here, so we show the count and a pointer.
 */

"use client";

import { useEffect } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";

interface GbpHealthDrilldownProps {
  score: Doc<"gbpHealthScores"> | null;
  open: boolean;
  onClose: () => void;
}

export function GbpHealthDrilldown({
  score,
  open,
  onClose,
}: GbpHealthDrilldownProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="biz-growth-gbp-drilldown"
      role="dialog"
      aria-modal="true"
      aria-label="GBP health score detail"
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/70 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-t-3xl border border-[var(--hairline)] bg-ink-2 p-6 shadow-xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
              <ShieldCheck className="h-4 w-4 text-lime" aria-hidden />
              GBP health score
            </span>
            <h3 className="mt-1 font-display text-2xl tracking-tight text-paper">
              {score ? `${Math.round(score.compositeScore)} of 100` : "Pending audit"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            className="rounded-full border border-[var(--hairline)] p-2 text-paper-dim transition-colors hover:bg-ink-3"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {score ? (
          <>
            <p
              data-testid="biz-growth-gbp-reasoning"
              className="mt-4 text-sm leading-relaxed text-paper-dim"
            >
              {score.reasoning}
            </p>
            <div className="mt-5 rounded-xl border border-[var(--hairline)] bg-ink-3/40 p-4">
              <div className="text-xs font-medium text-paper">
                {score.nudgesPending} nudge{score.nudgesPending === 1 ? "" : "s"} queued
              </div>
              <p className="mt-1 text-xs text-paper-faint">
                Maya&apos;s nudges live in your operator chat. Open the
                conversation to act on them.
              </p>
            </div>
            <dl
              data-testid="biz-growth-gbp-audit-meta"
              className="mt-4 grid grid-cols-2 gap-3 font-mono text-[10px] uppercase tracking-widest text-paper-faint"
            >
              <div>
                <dt>Model</dt>
                <dd className="mt-1 text-paper-dim">{score.model}</dd>
              </div>
              <div>
                <dt>Thinking budget</dt>
                <dd className="mt-1 text-paper-dim">{score.thinkingBudget}</dd>
              </div>
              <div className="col-span-2">
                <dt>Last audit</dt>
                <dd className="mt-1 text-paper-dim">
                  {new Date(score.scoreAt).toLocaleString()}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="mt-4 text-sm text-paper-dim">
            Maya runs the GBP audit during the morning brief. Once she has a
            full pass through your profile, posts, reviews, and competitors,
            her score and reasoning land here.
          </p>
        )}
      </div>
    </div>
  );
}
