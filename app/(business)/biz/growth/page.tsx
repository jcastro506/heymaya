/**
 * Growth tab — service-business HQ outcome surface.
 *
 * Per Service Sprint Plan § 12 (Wave C.7) and `project_north_star_outcomes.md`:
 * the two numbers are jobs booked + 5-star reviews. The lever is GBP local-
 * pack ranking. This screen exposes Maya's attribution chain (Wave C.5) and
 * her GBP Health Score (Wave C.6) — read-only.
 *
 * Section order (top → bottom):
 *   1. Sticky header — window selector + 3 top-line stats (jobs, 5-stars,
 *      GBP score with reasoning truncation; click → drilldown sheet).
 *   2. Metrics grid — full set of metric cards with sparklines + Maya
 *      attribution badges.
 *   3. (Pro/Studio) Learnings callout — top 3 weekly patterns.
 *
 * Plan-tier gating notes:
 *   - Server returns clamped data + `clampedFromRequestedWindow` for Starter
 *     hitting 90d/YTD; the header banner is wired off that signal.
 *   - `getAttributionBreakdown` returns null on Starter; the UI hides the
 *     section by simply not rendering it (no flash-of-content).
 *   - `getLatestWeeklyLearnings` returns null on Starter; LearningsCallout
 *     short-circuits on null.
 */

"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Section } from "@/components/business/Section";
import { EmptyState } from "@/components/business/EmptyState";
import { GrowthHeader } from "@/components/business/growth/GrowthHeader";
import type { WindowChoice } from "@/components/business/growth/GrowthHeader";
import { MetricsGrid } from "@/components/business/growth/MetricsGrid";
import { GbpHealthDrilldown } from "@/components/business/growth/GbpHealthDrilldown";
import { LearningsCallout } from "@/components/business/growth/LearningsCallout";
import { TelemetryAuditList } from "@/components/business/growth/TelemetryAuditList";

export default function GrowthPage() {
  const [window, setWindow] = useState<WindowChoice>("30d");
  const [drilldownOpen, setDrilldownOpen] = useState(false);

  const profile = useQuery(api.queries.business.profile.getProfile);
  const summary = useQuery(api.queries.business.growth.getGrowthSummary, {
    window,
  });
  const gbpLatest = useQuery(
    api.queries.business.growth.getGbpHealthScoreLatest
  );
  const learnings = useQuery(
    api.queries.business.growth.getLatestWeeklyLearnings
  );
  const telemetry = useQuery(
    api.queries.business.growth.getTelemetrySummary,
    { window }
  );

  if (profile === undefined) {
    return <BootSkeleton />;
  }
  if (profile === null) {
    return (
      <div className="px-5 py-12 sm:px-8">
        <EmptyState
          stage="fresh"
          title="Finish onboarding"
          body="Your Growth tab unlocks once Maya has profile data to read against."
          cta={{ label: "Continue onboarding", href: "/onboarding/business" }}
        />
      </div>
    );
  }

  return (
    <div className="pb-12">
      <GrowthHeader
        summary={summary}
        selected={window}
        onWindowChange={setWindow}
        gbpScore={gbpLatest?.score.compositeScore ?? null}
        gbpScoreReasoning={gbpLatest?.score.reasoning ?? null}
        onOpenScoreDrilldown={() => setDrilldownOpen(true)}
      />

      <Section
        eyebrow="Outcomes"
        title="What Maya moved this period"
        caption="Every metric is grounded in your data. The Maya badge marks the slice that traces back through her actions — posts, requests, replies, nudges."
      >
        {summary === undefined ? (
          <div
            data-testid="biz-growth-metrics-skeleton"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-2xl bg-ink-3/60"
              />
            ))}
          </div>
        ) : summary === null ? (
          <EmptyState
            stage="fresh"
            title="Maya is still mapping your outcomes"
            body="The first window of attribution data lands once you've completed your first jobs and reviews."
          />
        ) : (
          <MetricsGrid summary={summary} />
        )}
      </Section>

      {/* Pro/Studio learnings callout — short-circuits to null on Starter */}
      {learnings && (
        <Section
          eyebrow="Learning loop"
          title="Patterns Maya found this week"
          caption="Maya synthesizes a weekly read on what's working in YOUR business. Sample size + attribution counts are visible so you can sanity-check her claims."
        >
          <LearningsCallout learnings={learnings} />
        </Section>
      )}

      {/* Pro/Studio per-nudge audit log — Wave D telemetry surface.
          Renders nothing on Starter (telemetry === null). */}
      {telemetry !== null && (
        <Section
          eyebrow="Audit log"
          title="What Maya logged this period"
          caption="Approval outcomes, reply-moderation results, nudge engagement, voice ratings, mirrored AI costs, and webhook dedupe hits. Counts only — no synthesized scores."
        >
          <TelemetryAuditList data={telemetry} />
        </Section>
      )}

      <GbpHealthDrilldown
        score={gbpLatest?.score ?? null}
        open={drilldownOpen}
        onClose={() => setDrilldownOpen(false)}
      />
    </div>
  );
}

function BootSkeleton() {
  return (
    <div
      data-testid="biz-growth-boot-skeleton"
      className="px-5 py-10 sm:px-8 sm:py-14"
    >
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="h-9 w-2/5 animate-pulse rounded bg-ink-3" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="h-24 animate-pulse rounded-2xl bg-ink-3" />
          <div className="h-24 animate-pulse rounded-2xl bg-ink-3" />
          <div className="h-24 animate-pulse rounded-2xl bg-ink-3" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="h-32 animate-pulse rounded-2xl bg-ink-3" />
          <div className="h-32 animate-pulse rounded-2xl bg-ink-3" />
          <div className="h-32 animate-pulse rounded-2xl bg-ink-3" />
        </div>
      </div>
    </div>
  );
}
