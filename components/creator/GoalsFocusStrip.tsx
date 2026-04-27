/**
 * GoalsFocusStrip — the top-of-Today anchor strip.
 *
 * Three semantic columns that orient the creator the moment they open
 * HeyMaya:
 *
 *   1. Your goals       — pulled from creators.onboardingProgress.answers
 *                         (with picture-owned fields as fallback)
 *   2. This stage's focus — pulled from creatorPicture.growthPlan
 *                            (rich shape preferred; legacy narrow shape
 *                            tolerated)
 *   3. Maya's currently working on — recent mayaActionLog `ran` rows + a
 *                                     synthetic next-cron hint
 *
 * Universal: every plan tier sees this. It's an orientation surface, not a
 * gated feature.
 *
 * Defensive rendering: every field is optional. Wave 2 will add multi-select
 * goals / blockers / 90-day priority — those land on the same query shape
 * (extending the `goals` object) and the column degrades gracefully if a
 * field is absent.
 *
 * When `hasInferredPicture` is false (synthesis hasn't run yet, picture is
 * placeholder), the strip renders a calibrating-mode variant — only goals +
 * a single "Maya is calibrating her plan" line in the focus column. This
 * keeps the strip honest (no fabricated milestones) without disappearing.
 *
 * Layout: 3 columns at lg, stacked on mobile. Editorial vocabulary —
 * font-mono eyebrows, hairline dividers, no new design tokens.
 */

import { type ReactNode } from "react";

export interface GoalsFocusStripData {
  goals: {
    free: string | null;
    oneYear: string | null;
    fiveYear: string | null;
    revenueStreams: ReadonlyArray<string>;
    careerStage:
      | "just-starting"
      | "building"
      | "monetizing"
      | "scaling"
      | null;
  };
  focus: {
    nextMilestoneText: string | null;
    focusAreas: ReadonlyArray<string>;
    horizonWeeks: number | null;
  };
  recentMayaActions: ReadonlyArray<{
    entryId: string;
    detail: string | null;
    ts: number;
  }>;
  nextScheduledCronHint: string | null;
  hasInferredPicture: boolean;
}

export interface GoalsFocusStripProps {
  data: GoalsFocusStripData | null | undefined;
}

const STAGE_LABEL: Record<
  "just-starting" | "building" | "monetizing" | "scaling",
  string
> = {
  "just-starting": "Just starting",
  building: "Building",
  monetizing: "Monetizing",
  scaling: "Scaling",
};

const REVENUE_STREAM_LABEL: Record<string, string> = {
  "brand-deals": "Brand deals",
  affiliate: "Affiliate",
  merch: "Merch",
  courses: "Courses",
  subs: "Subs",
  "ad-rev": "Ad rev",
  "email-list": "Email list",
  "live-events": "Events",
  consulting: "Consulting",
  other: "Other",
};

export function GoalsFocusStrip({ data }: GoalsFocusStripProps) {
  // Loading shell — match the BootSkeleton vocabulary on the Today page so
  // the layout doesn't jump when the query lands.
  if (data === undefined) {
    return (
      <section
        className="px-5 pt-2 sm:px-8 sm:pt-6"
        data-testid="goals-focus-strip-loading"
      >
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-6">
            <div className="h-3 w-24 rounded-full bg-ink-2" />
            <div className="mt-3 h-4 w-3/4 rounded-full bg-ink-2" />
          </div>
        </div>
      </section>
    );
  }
  if (data === null) {
    // Unauth — Today page handles the redirect, we just render nothing.
    return null;
  }

  const { goals, focus, recentMayaActions, nextScheduledCronHint, hasInferredPicture } = data;

  return (
    <section
      className="px-5 pt-2 sm:px-8 sm:pt-6"
      data-testid="goals-focus-strip"
    >
      <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2/40">
          <div className="grid grid-cols-1 divide-y divide-[var(--hairline)] lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            {/* 1. Goals */}
            <Column
              eyebrow="Your goals"
              data-testid="goals-focus-strip-goals"
            >
              {goals.free ? (
                <p className="text-sm leading-relaxed text-paper">
                  {goals.free}
                </p>
              ) : (
                <p className="text-sm italic text-paper-faint">
                  No goal on file yet — Maya will ask in your first chat.
                </p>
              )}
              {(goals.oneYear || goals.fiveYear) && (
                <ul className="mt-3 space-y-1.5 text-sm text-paper-dim">
                  {goals.oneYear && (
                    <li>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                        1y ·{" "}
                      </span>
                      {goals.oneYear}
                    </li>
                  )}
                  {goals.fiveYear && (
                    <li>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                        5y ·{" "}
                      </span>
                      {goals.fiveYear}
                    </li>
                  )}
                </ul>
              )}
              {goals.revenueStreams.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {goals.revenueStreams.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-[var(--hairline)] bg-ink-3/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-paper-dim"
                    >
                      {REVENUE_STREAM_LABEL[s] ?? s}
                    </span>
                  ))}
                </div>
              )}
              {goals.careerStage && (
                <div className="mt-3">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                    Stage · {STAGE_LABEL[goals.careerStage]}
                  </span>
                </div>
              )}
            </Column>

            {/* 2. This stage's focus */}
            <Column
              eyebrow="This stage's focus"
              data-testid="goals-focus-strip-focus"
            >
              {!hasInferredPicture ? (
                <p className="text-sm italic text-paper-faint">
                  Maya is calibrating her plan. Picture&rsquo;s being synthesized.
                </p>
              ) : (
                <>
                  {focus.nextMilestoneText ? (
                    <p className="text-sm leading-relaxed text-paper">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-lime">
                        Milestone ·{" "}
                      </span>
                      {focus.nextMilestoneText}
                    </p>
                  ) : (
                    <p className="text-sm italic text-paper-faint">
                      No milestone set yet.
                    </p>
                  )}
                  {focus.focusAreas.length > 0 && (
                    <ul className="mt-3 space-y-1.5 text-sm text-paper-dim">
                      {focus.focusAreas.map((f, i) => (
                        <li key={`${f}-${i}`}>
                          <span className="text-lime">·</span> {f}
                        </li>
                      ))}
                    </ul>
                  )}
                  {focus.horizonWeeks !== null && (
                    <div className="mt-3">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                        Horizon · {focus.horizonWeeks}w
                      </span>
                    </div>
                  )}
                </>
              )}
            </Column>

            {/* 3. Maya's currently working on */}
            <Column
              eyebrow="Maya is on"
              data-testid="goals-focus-strip-maya"
            >
              {recentMayaActions.length > 0 ? (
                <ul className="space-y-1.5 text-sm text-paper-dim">
                  {recentMayaActions.map((a) => (
                    <li key={`${a.entryId}-${a.ts}`}>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                        {timeAgoShort(a.ts)} ·{" "}
                      </span>
                      Maya ran <span className="text-paper">{a.entryId}</span>
                      {a.detail && (
                        <span className="text-paper-faint"> · {truncate(a.detail, 60)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm italic text-paper-faint">
                  Maya is just spinning up. First check-in lands at 7am local.
                </p>
              )}
              {nextScheduledCronHint && (
                <div className="mt-3">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                    Next · {nextScheduledCronHint}
                  </span>
                </div>
              )}
            </Column>
          </div>
        </div>
      </div>
    </section>
  );
}

interface ColumnProps {
  eyebrow: string;
  children: ReactNode;
  "data-testid"?: string;
}

function Column({ eyebrow, children, ...rest }: ColumnProps) {
  return (
    <div className="p-5 sm:p-6" data-testid={rest["data-testid"]}>
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
        {eyebrow}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function timeAgoShort(ts: number): string {
  const diffMin = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1).trimEnd()}…`;
}
