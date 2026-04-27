/**
 * Compact card for a single service job. Used on:
 *   - Today screen "today's job schedule" section
 *   - Jobs screen pipeline list view
 *
 * Pure render — selection / detail-panel state lives in the parent. No
 * `useQuery` calls inside this component, which keeps it cheap to embed
 * in a long list.
 */

import type { Doc } from "@/convex/_generated/dataModel";
import { Hammer, MapPin, User2 } from "lucide-react";

export interface JobCardProps {
  job: Pick<
    Doc<"serviceJobs">,
    | "_id"
    | "status"
    | "scheduledAt"
    | "completedAt"
    | "technicianName"
    | "serviceType"
    | "ticketAmountUsd"
  >;
  customerName?: string;
  onClick?: () => void;
  testId?: string;
}

const STATUS_LABEL: Record<JobCardProps["job"]["status"], string> = {
  scheduled: "Scheduled",
  "in-progress": "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<JobCardProps["job"]["status"], string> = {
  scheduled: "bg-sky-300/15 text-sky-200 border-sky-300/30",
  "in-progress": "bg-lime/15 text-lime border-lime/30",
  completed: "bg-paper-dim/15 text-paper-dim border-[var(--hairline-strong)]",
  cancelled: "bg-rose-300/15 text-rose-200 border-rose-300/30",
};

export function JobCard({ job, customerName, onClick, testId }: JobCardProps) {
  const when =
    job.scheduledAt !== undefined
      ? formatTime(job.scheduledAt)
      : job.completedAt !== undefined
      ? `Completed ${formatTime(job.completedAt)}`
      : "Unscheduled";
  const Element: "button" | "div" = onClick ? "button" : "div";
  return (
    <Element
      data-testid={testId ?? "biz-job-card"}
      data-job-id={job._id}
      onClick={onClick}
      className={`group flex w-full flex-col gap-2.5 rounded-2xl border border-[var(--hairline)] bg-ink-2/60 p-4 text-left transition-colors hover:border-[var(--hairline-strong)] hover:bg-ink-2 ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-paper">
          <Hammer className="h-4 w-4 text-paper-dim" aria-hidden />
          <span className="font-medium">
            {job.serviceType ?? "Service call"}
          </span>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_COLOR[job.status]}`}
        >
          {STATUS_LABEL[job.status]}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-paper-faint">
        {customerName && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3 w-3" aria-hidden /> {customerName}
          </span>
        )}
        {job.technicianName && (
          <span className="inline-flex items-center gap-1.5">
            <User2 className="h-3 w-3" aria-hidden /> {job.technicianName}
          </span>
        )}
        <span>{when}</span>
        {job.ticketAmountUsd !== undefined && (
          <span className="text-paper-dim">
            ${job.ticketAmountUsd.toLocaleString()}
          </span>
        )}
      </div>
    </Element>
  );
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}
