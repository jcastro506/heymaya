/**
 * Job detail panel — opens when an operator clicks a row in the Jobs list.
 *
 * Displays:
 *   - Job header (service type, status, customer, time)
 *   - Photos (drag-drop upload — handler is parent-supplied; this component
 *     just renders the dropzone + grid)
 *   - Maya's recommended best-photos curation (Sprint 4 wires the data;
 *     for now we render the existing photos array)
 *   - Review-request status (queued / sent / opened / completed)
 *
 * Pure render — all state lives in parent. The drop handler accepts a
 * `FileList` so the parent can route to the R2 ingest mutation.
 */

"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { Camera, MailOpen, MessageSquare, X } from "lucide-react";
import { useState } from "react";

export interface JobDetailPanelProps {
  job: Doc<"serviceJobs">;
  customer: Doc<"serviceCustomers"> | null;
  reviewRequests: Doc<"reviewRequests">[];
  onClose: () => void;
  onPhotoDrop?: (files: FileList) => void;
}

export function JobDetailPanel({
  job,
  customer,
  reviewRequests,
  onClose,
  onPhotoDrop,
}: JobDetailPanelProps) {
  const [dragOver, setDragOver] = useState(false);
  const latestReq = reviewRequests
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return (
    <aside
      data-testid="biz-job-detail-panel"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-[var(--hairline)] bg-ink-2 shadow-[ -16px_0_40px_-20px_rgba(0,0,0,0.6)] sm:max-w-md"
      aria-label="Job detail"
    >
      <header className="flex items-center justify-between border-b border-[var(--hairline)] px-6 py-5">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            Job · {job.status}
          </span>
          <h3 className="mt-1 font-display text-2xl tracking-tight text-paper">
            {job.serviceType ?? "Service call"}
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
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
        <section className="space-y-2 text-sm text-paper-dim">
          {customer && (
            <div className="flex justify-between">
              <span className="text-paper-faint">Customer</span>
              <span className="text-paper">{customer.name}</span>
            </div>
          )}
          {job.technicianName && (
            <div className="flex justify-between">
              <span className="text-paper-faint">Technician</span>
              <span>{job.technicianName}</span>
            </div>
          )}
          {job.ticketAmountUsd !== undefined && (
            <div className="flex justify-between">
              <span className="text-paper-faint">Ticket</span>
              <span>${job.ticketAmountUsd.toLocaleString()}</span>
            </div>
          )}
          {job.scheduledAt && (
            <div className="flex justify-between">
              <span className="text-paper-faint">Scheduled</span>
              <span>{new Date(job.scheduledAt).toLocaleString()}</span>
            </div>
          )}
          {job.completedAt && (
            <div className="flex justify-between">
              <span className="text-paper-faint">Completed</span>
              <span>{new Date(job.completedAt).toLocaleString()}</span>
            </div>
          )}
          {job.notes && (
            <p className="mt-3 rounded-xl bg-ink-3/60 p-3 text-paper-dim">
              {job.notes}
            </p>
          )}
        </section>

        <section>
          <header className="mb-3 flex items-center gap-2 text-paper">
            <Camera className="h-4 w-4 text-paper-dim" />
            <h4 className="font-display text-lg">Photos</h4>
            <span className="ml-auto text-xs text-paper-faint">
              {job.photos.length} on file
            </span>
          </header>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (onPhotoDrop && e.dataTransfer.files.length > 0) {
                onPhotoDrop(e.dataTransfer.files);
              }
            }}
            className={`rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
              dragOver
                ? "border-lime bg-lime/5"
                : "border-[var(--hairline-strong)] bg-ink-3/40"
            }`}
          >
            <p className="text-sm text-paper-dim">
              Drag photos here, or text them to Maya — she catalogs each one
              automatically.
            </p>
          </div>
          {job.photos.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {job.photos.map((url, i) => (
                <div
                  key={i}
                  className="aspect-square overflow-hidden rounded-lg border border-[var(--hairline)] bg-ink-3"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- R2 signed URLs are short-lived; next/image's optimizer caches under the wrong key */}
                  <img
                    src={url}
                    alt={`Photo ${i + 1} from ${job.serviceType ?? "job"}`}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <header className="mb-3 flex items-center gap-2 text-paper">
            <MailOpen className="h-4 w-4 text-paper-dim" />
            <h4 className="font-display text-lg">Review request</h4>
          </header>
          {latestReq ? (
            <div className="space-y-2 rounded-xl bg-ink-3/60 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-paper-faint">Status</span>
                <span className="text-paper">{latestReq.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-paper-faint">Channel</span>
                <span className="text-paper-dim">{latestReq.channel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-paper-faint">Followups</span>
                <span className="text-paper-dim">
                  {latestReq.followupCount}
                </span>
              </div>
            </div>
          ) : (
            <p className="rounded-xl bg-ink-3/60 p-3 text-sm text-paper-dim">
              No review request sent yet. Maya will queue one once the job
              is marked completed.
            </p>
          )}
        </section>

        {reviewRequests.length > 1 && (
          <section className="text-xs text-paper-faint">
            <MessageSquare className="mb-1 h-3 w-3" aria-hidden />
            <span>
              {reviewRequests.length} request rows total. Showing latest
              above.
            </span>
          </section>
        )}
      </div>
    </aside>
  );
}
