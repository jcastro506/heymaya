/**
 * "Maya is getting smarter" callout — Pro/Studio only.
 *
 * Reads `weeklyLearnings.topPatterns` and renders the top 3 with the
 * grounding bits attached: claim, sample size, jobs/5-stars attributed.
 * Adds a "since last week" delta when `priorWeekDelta` is set.
 *
 * The list is grounded — no synthesized prose; we render the exact `claim`
 * Maya wrote into the row. Sample size + attribution counts visible inline
 * to defuse "is this real?" skepticism (the phantom-pattern guard ensures
 * `sampleSize >= 3` before a row makes it to this surface).
 */

"use client";

import { Brain } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";

interface LearningsCalloutProps {
  learnings: Doc<"weeklyLearnings"> | null | undefined;
}

export function LearningsCallout({ learnings }: LearningsCalloutProps) {
  if (!learnings) return null;
  const top3 = learnings.topPatterns.slice(0, 3);
  if (top3.length === 0) return null;

  const delta = learnings.priorWeekDelta;

  return (
    <div
      data-testid="biz-growth-learnings"
      className="rounded-2xl border border-lime/20 bg-lime/5 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="inline-flex items-center gap-2">
          <Brain className="h-4 w-4 text-lime" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-widest text-lime">
            Maya is getting smarter
          </span>
        </div>
        {delta && (
          <span
            data-testid="biz-growth-learnings-delta"
            className="font-mono text-[10px] uppercase tracking-widest text-paper-faint"
          >
            +{delta.newPatternCount} new ·{" "}
            {delta.jobsAttributedDelta >= 0 ? "+" : ""}
            {delta.jobsAttributedDelta} jobs vs last week
          </span>
        )}
      </div>
      <ul className="mt-4 space-y-3">
        {top3.map((p, i) => (
          <li
            key={`${p.kind}:${i}`}
            data-testid="biz-growth-learning-row"
            className="rounded-xl border border-[var(--hairline)] bg-ink-2/50 p-3"
          >
            <div className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
              {p.kind}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-paper">
              {p.claim}
            </p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-paper-faint">
              <span>n = {p.sampleSize}</span>
              <span>{p.jobsAttributed} jobs</span>
              <span>{p.fiveStarsAttributed} 5-stars</span>
              <span>conf {Math.round(p.confidence * 100)}%</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
