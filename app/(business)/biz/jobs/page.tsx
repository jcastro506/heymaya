/**
 * Jobs screen — `/biz/jobs`.
 *
 * Per Service Sprint Plan § 12.2:
 *   - CRM-mirrored job pipeline (with status tabs)
 *   - Per-job detail panel with photos + review-request status
 *   - Plan-tier: Starter shows last 30d only (banner + server-clamped)
 */

"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Hammer } from "lucide-react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Section } from "@/components/business/Section";
import { EmptyState } from "@/components/business/EmptyState";
import { JobCard } from "@/components/business/JobCard";
import { JobDetailPanel } from "@/components/business/JobDetailPanel";

type Status = Doc<"serviceJobs">["status"];

const STATUS_TABS: { key: Status | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "in-progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export default function JobsPage() {
  const [activeTab, setActiveTab] = useState<Status | "all">("all");
  const [selectedJobId, setSelectedJobId] = useState<Id<"serviceJobs"> | null>(
    null
  );

  const profile = useQuery(api.queries.business.profile.getProfile);
  const counts = useQuery(api.queries.business.jobs.getStatusCounts);
  const jobs = useQuery(api.queries.business.jobs.listJobs, {
    status: activeTab === "all" ? undefined : activeTab,
  });
  const detail = useQuery(
    api.queries.business.jobs.getJob,
    selectedJobId && profile
      ? { businessId: profile.business._id, jobId: selectedJobId }
      : "skip"
  );

  const isStarter = profile?.business.planTier === "starter";

  if (profile === undefined) {
    return <Skeleton />;
  }
  if (profile === null) {
    return (
      <div className="px-5 py-10 sm:px-8">
        <EmptyState
          stage="fresh"
          title="Finish onboarding"
          body="Connect your account to start mirroring jobs."
          cta={{ label: "Onboarding", href: "/onboarding/business" }}
        />
      </div>
    );
  }

  return (
    <div className="pb-12 pt-4 sm:pt-6">
      <Section
        eyebrow="Jobs"
        title="Pipeline"
        caption="Every job your CRM syncs (or you text Maya about). Click a row to see photos and the review-request status."
        rightSlot={
          isStarter ? (
            <span className="rounded-full border border-amber-300/40 bg-amber-300/5 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-200">
              Starter · last 30 days
            </span>
          ) : null
        }
      >
        {/* Status tabs + counts */}
        <div className="mb-5 flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => {
            const count =
              tab.key === "all"
                ? counts
                  ? Object.values(counts).reduce((a, b) => a + b, 0)
                  : null
                : counts
                ? counts[tab.key]
                : null;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                data-testid={`biz-jobs-tab-${tab.key}`}
                data-active={active ? "true" : "false"}
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-lime/40 bg-lime/5 text-lime"
                    : "border-[var(--hairline)] text-paper-dim hover:bg-ink-3"
                }`}
              >
                {tab.label}
                {count !== null && count !== undefined && (
                  <span className="font-mono text-[10px] text-paper-faint">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {jobs === undefined ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-2xl bg-ink-3/60"
              />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            stage="ready"
            title="No jobs in this view"
            body={
              activeTab === "all"
                ? "Once your CRM syncs or you text Maya about a completed job, the pipeline fills in here."
                : `No ${activeTab.replace("-", " ")} jobs in your window.`
            }
            icon={Hammer}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {jobs.map((j) => (
              <JobCard
                key={j._id}
                job={j}
                onClick={() => setSelectedJobId(j._id)}
              />
            ))}
          </div>
        )}
      </Section>

      {detail && profile && selectedJobId && (
        <JobDetailPanel
          job={detail.job}
          customer={detail.customer}
          reviewRequests={detail.reviewRequests}
          onClose={() => setSelectedJobId(null)}
        />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="px-5 py-10 sm:px-8" data-testid="biz-jobs-skeleton">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="h-9 w-1/3 animate-pulse rounded bg-ink-3" />
        <div className="h-72 animate-pulse rounded-2xl bg-ink-3" />
      </div>
    </div>
  );
}
