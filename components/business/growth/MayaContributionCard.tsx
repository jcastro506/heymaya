/**
 * "Maya's contribution this week" card — placed at the top of the Today
 * screen, above the brief.
 *
 * Three numbers, no editorialization. The two outcome counts both use
 * Wave C.5 attribution: a job counts when `serviceJobs.originatingLeadId`
 * is set; a 5-star review counts when a `reviewRequests.attributedReviewId`
 * matches it. The GBP score is Maya's verbatim `compositeScore` — no
 * recomputation.
 */

"use client";

import Link from "next/link";
import { ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import type { MayaContributionThisWeek } from "@/convex/queries/business/growth";

interface MayaContributionCardProps {
  data: MayaContributionThisWeek | null | undefined;
}

export function MayaContributionCard({ data }: MayaContributionCardProps) {
  // Loading
  if (data === undefined) {
    return (
      <div
        data-testid="biz-today-contribution-skeleton"
        className="mx-auto mt-3 w-full max-w-5xl px-5 sm:px-8"
      >
        <div className="h-24 animate-pulse rounded-2xl bg-ink-3" />
      </div>
    );
  }

  // No-session / no-data — render nothing on Day-0 accounts.
  if (data === null) return null;

  const empty =
    data.jobsAttributedCount === 0 &&
    data.fiveStarReviewsAttributedCount === 0 &&
    data.gbpHealthScore === null;
  if (empty) return null;

  return (
    <div
      data-testid="biz-today-contribution-card"
      className="mx-auto mt-3 w-full max-w-5xl px-5 sm:px-8"
    >
      <Link
        href="/biz/growth"
        className="block rounded-2xl border border-lime/20 bg-lime/5 p-4 transition-colors hover:bg-lime/10"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-lime" aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-widest text-lime">
              Maya&apos;s contribution this week
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            See growth →
          </span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            icon={<TrendingUp className="h-3.5 w-3.5 text-lime" aria-hidden />}
            label="Jobs attributed"
            value={data.jobsAttributedCount.toString()}
          />
          <Stat
            icon={<Sparkles className="h-3.5 w-3.5 text-lime" aria-hidden />}
            label="5-stars attributed"
            value={data.fiveStarReviewsAttributedCount.toString()}
          />
          <Stat
            icon={<ShieldCheck className="h-3.5 w-3.5 text-lime" aria-hidden />}
            label="GBP score"
            value={
              data.gbpHealthScore === null
                ? "—"
                : Math.round(data.gbpHealthScore).toString()
            }
          />
        </div>
      </Link>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-paper-faint">
        {icon}
        {label}
      </span>
      <span className="font-display text-2xl tracking-tight text-paper">
        {value}
      </span>
    </div>
  );
}
