"use client";

/**
 * Step 2: Pulling.
 *
 * Wave 3 (2026-04-26) — REAL progress UI bound to the `onboardingJobs` row
 * patched by `runBulkPullJob`. The animated-ticker placeholder this step
 * used to render is gone. Instead:
 *
 *   - HandlesStep "Continue" fires `kickoffBulkPullJob` BEFORE landing on
 *     this step, so by the time PullingStep renders the job is already
 *     running (or done, on a fast network).
 *   - This step subscribes via `useQuery(api.onboarding.maya.jobs
 *     .getJobStatus, { jobType: "bulk-pull" })`. Convex pushes patches
 *     live, so the bar fills as ScrapeCreators returns each platform.
 *   - The user CAN proceed to QuestionsStep even while the pull is still
 *     running. PullingStep is a "watch the work happen" interstitial they
 *     pass through quickly. The deploy step waits for the job to finish if
 *     the user races ahead.
 *
 * Failure handling: if the job row reports `failed`, surface the error
 * + a Retry button that calls `kickoffBulkPullJob` again (the server-side
 * idempotency guard treats a `failed` row as expired and spawns a fresh
 * one — see convex/onboarding/maya/jobs.ts).
 */

import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Loader2, AlertTriangle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  setBulkPullJobId,
  type OnboardingState,
  type Platform,
} from "../_state";
import { StepShell, StepFooter } from "./HandlesStep";

interface PullingStepProps {
  state: OnboardingState;
  setState: (next: OnboardingState) => void;
  onScrapeComplete: () => void;
  onAdvance: () => void;
}

/**
 * Shape of the `progress` field on `onboardingJobs` rows for the
 * `bulk-pull` jobType. Mirrors what `runBulkPullJob` writes. Loose-typed
 * because the schema column is `v.any()` (shape varies by jobType).
 */
interface BulkPullProgress {
  handlesProcessed?: number;
  totalHandles?: number;
  postsPulled?: number;
  currentPlatform?: Platform;
}

const kickoffBulkPullRef = api.onboarding.maya.jobs.kickoffBulkPullJob;

export function PullingStep({
  state,
  setState,
  onScrapeComplete,
  onAdvance,
}: PullingStepProps) {
  const job = useQuery(api.onboarding.maya.jobs.getJobStatus, {
    jobType: "bulk-pull",
  });
  const kickoffBulkPull = useAction(kickoffBulkPullRef);
  const [retrying, setRetrying] = useState(false);

  const isDone = job?.status === "done";
  const isFailed = job?.status === "failed";
  const isRunning = job?.status === "running" || job?.status === "pending";
  const progress = (job?.progress ?? null) as BulkPullProgress | null;

  // Tell the parent state that the scrape is complete so legacy gating
  // (canAdvance) flips on without forcing a refactor of every step.
  useEffect(() => {
    if (isDone && !state.scrapeComplete) {
      onScrapeComplete();
    }
  }, [isDone, state.scrapeComplete, onScrapeComplete]);

  const onRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const result = await kickoffBulkPull({});
      if (result.ok && result.jobId) {
        setState(setBulkPullJobId(state, result.jobId));
      }
    } finally {
      setRetrying(false);
    }
  };

  // Render a per-handle line for each verified handle, plus a synthesis
  // tail line for the cross-platform "putting your picture together" beat
  // (the synth job is a separate row — this is just the read-pass progress).
  const platformLines = state.handles.map((h) => {
    const handlesProcessed = progress?.handlesProcessed ?? 0;
    const handleIndex = state.handles.findIndex((x) => x.platform === h.platform);
    const completed = isDone || handlesProcessed > handleIndex;
    const inProgress = !completed && handlesProcessed === handleIndex;
    return {
      key: h.platform,
      label: PLATFORM_LABEL[h.platform],
      completed,
      inProgress,
    };
  });
  // The synthesis tail line is a single visual cap — it goes solid green
  // once bulk-pull is done (synthesis itself is fired from QuestionsStep).
  const synthLine = {
    key: "synth",
    label: "Putting together your creator picture…",
    completed: false,
    inProgress: isDone,
  };

  const total = progress?.totalHandles ?? state.handles.length;
  const done = isDone ? total : progress?.handlesProcessed ?? 0;
  const fraction =
    total === 0 ? (isDone ? 1 : 0) : Math.min(1, Math.max(0, done / total));

  return (
    <StepShell
      eyebrow="§02 · Reading"
      title={
        isFailed
          ? "Hit a snag reading your accounts."
          : isDone
            ? "Done. Maya read everything."
            : "Reading your accounts."
      }
      caption={
        isFailed
          ? "Something went wrong on the read pass. You can retry — usually a one-shot blip."
          : isDone
            ? "Profile, last 30 posts per platform, top comments, audience. She's ready to talk."
            : "Profile, last 30 posts per platform, top comments, audience. Maya is being thorough on purpose."
      }
    >
      {/* Real progress bar bound to job state. */}
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-ink-2">
        <div
          className="h-full bg-lime transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>

      <ol className="space-y-3">
        {[...platformLines, synthLine].map((line) => (
          <li
            key={line.key}
            className="flex items-center gap-4 rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 px-5 py-4"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--hairline)] bg-ink-3">
              {line.completed ? (
                <span className="h-2 w-2 rounded-full bg-lime" />
              ) : line.inProgress ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-lime" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-paper-faint" />
              )}
            </span>
            <span
              className={`text-base ${line.completed || line.inProgress ? "text-paper" : "text-paper-faint"}`}
            >
              {line.label}
            </span>
          </li>
        ))}
      </ol>

      {/* Live count footer — shows real "X of Y posts" once available. */}
      <p className="mt-6 font-mono text-[11px] uppercase tracking-widest text-paper-faint">
        ScrapeCreators · {state.handles.length} platform
        {state.handles.length === 1 ? "" : "s"}
        {progress?.postsPulled ? ` · ${progress.postsPulled} posts loaded` : ""}
        {progress?.currentPlatform
          ? ` · processing ${PLATFORM_LABEL[progress.currentPlatform]}`
          : ""}
      </p>

      {isFailed && job?.errorDetail && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-rose/40 bg-ink-2 p-4 text-sm text-paper-dim">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose" />
          <div className="flex-1">
            <p>{job.errorDetail}</p>
            <button
              type="button"
              onClick={() => void onRetry()}
              disabled={retrying}
              className="btn btn-primary mt-3 h-9 px-4 text-xs disabled:opacity-50"
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        </div>
      )}

      <StepFooter
        leftMeta={
          isDone
            ? "Done · ready when you are"
            : isFailed
              ? "Failed · retry above"
              : isRunning
                ? `${progress?.handlesProcessed ?? 0} of ${total} done · keep going`
                : "Starting…"
        }
        // Wave 3: user can advance to QuestionsStep even while the pull is
        // still running. The deploy step waits for the job to finish.
        canAdvance={isDone || isRunning}
        onAdvance={onAdvance}
        advanceLabel={
          isDone ? "Hear from Maya" : isRunning ? "Hear from Maya" : "Working…"
        }
      />
    </StepShell>
  );
}

const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: "Reading your TikToks",
  instagram: "Reading your Instagram",
  youtube: "Reading your YouTube",
  linkedin: "Reading your LinkedIn",
  x: "Reading your X timeline",
};
