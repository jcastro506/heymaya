"use client";

/**
 * Step 1: Handles.
 *
 * Multi-platform handle entry. Every typed handle is round-tripped through
 * `internal.integrations.scrapeCreators.verifyHandle.verifyHandle` before the
 * UI accepts it into the list — account-takeover guard. The verified row
 * shows the canonical handle + display name + follower count as the
 * "ScrapeCreators-confirmed" signal.
 *
 * Plan-tier cap is mirrored in `_state.ts`'s `PLAN_MAX_HANDLES`. Server-side
 * enforcement still lives in the Convex onboarding pipeline.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useMutation } from "convex/react";
import { Check, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  PLAN_MAX_HANDLES,
  addHandle,
  removeHandle,
  setBulkPullJobId,
  type OnboardingState,
  type Platform,
  type VerifiedHandle,
} from "../_state";

const verifyHandleRef =
  api.integrations.scrapeCreators.verifyHandle.verifyHandle;
const kickoffBulkPullRef = api.onboarding.maya.jobs.kickoffBulkPullJob;
const cancelJobRef = api.onboarding.maya.jobs.cancelJob;

const PLATFORMS: ReadonlyArray<{ id: Platform; label: string; placeholder: string }> = [
  { id: "tiktok", label: "TikTok", placeholder: "@yourhandle" },
  { id: "instagram", label: "Instagram", placeholder: "@yourhandle" },
  { id: "youtube", label: "YouTube", placeholder: "@yourchannel" },
  { id: "linkedin", label: "LinkedIn", placeholder: "your-public-id" },
  { id: "x", label: "X / Twitter", placeholder: "@yourhandle" },
];

interface HandlesStepProps {
  state: OnboardingState;
  setState: (next: OnboardingState) => void;
  onAdvance: () => void;
}

export function HandlesStep({ state, setState, onAdvance }: HandlesStepProps) {
  const verify = useAction(verifyHandleRef);
  const kickoffBulkPull = useAction(kickoffBulkPullRef);
  const cancelJob = useMutation(cancelJobRef);
  const [activePlatform, setActivePlatform] = useState<Platform>("tiktok");
  const [draftHandle, setDraftHandle] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  // Wave 3 — once "Continue" fires kickoffBulkPullJob, lock the form
  // against further edits. The "Undo" button cancels the job + clears
  // the lock so the user can resume editing if they realize they
  // forgot a handle.
  const [continuing, setContinuing] = useState(false);
  const editingLocked = state.bulkPullJobId !== null;

  const cap = PLAN_MAX_HANDLES[state.plan];
  const atCap = state.handles.length >= cap;
  const usedPlatforms = useMemo(
    () => new Set(state.handles.map((h) => h.platform)),
    [state.handles]
  );

  /**
   * Wave 3 advance handler: fire `kickoffBulkPullJob` BEFORE moving forward
   * so the heavy bulk pull starts running while the user is on PullingStep
   * (and continues while they're on QuestionsStep / ChannelStep / etc.).
   * The job is async — we don't await it here, but we DO await the kickoff
   * to get the jobId back so PullingStep can subscribe.
   */
  const onContinue = async () => {
    if (continuing || editingLocked) {
      onAdvance();
      return;
    }
    setContinuing(true);
    try {
      const result = await kickoffBulkPull({});
      if (result.ok && result.jobId) {
        setState(setBulkPullJobId(state, result.jobId));
      }
      // Even if kickoff failed, we still advance — PullingStep falls back
      // to inline behavior + DeployStep will run the pull itself.
      onAdvance();
    } finally {
      setContinuing(false);
    }
  };

  const onUndoLock = async () => {
    await cancelJob({ jobType: "bulk-pull" });
    setState(setBulkPullJobId(state, null));
  };

  const onAddHandle = async () => {
    const handleInput = draftHandle.trim();
    if (handleInput.length === 0 || verifying || editingLocked) return;
    setVerifyError(null);
    setVerifying(true);
    try {
      const result = (await verify({
        platform: activePlatform,
        handle: handleInput,
      })) as VerifiedHandle;
      const next = addHandle(state, {
        platform: activePlatform,
        handle: result.handle,
        displayName: result.displayName ?? null,
        followerCount: result.followerCount ?? 0,
        avatarUrl: result.avatarUrl ?? null,
      });
      if (!next.ok) {
        if (next.reason === "duplicate-platform") {
          setVerifyError(`You already added a ${activePlatform} handle.`);
        } else {
          setVerifyError(
            `Your ${state.plan} plan caps you at ${cap} handle${cap === 1 ? "" : "s"}.`
          );
        }
        return;
      }
      setState(next.state);
      setDraftHandle("");
      // Auto-advance the platform picker to the first unused option for speed.
      const nextUnused = PLATFORMS.find((p) => !next.state.handles.some((h) => h.platform === p.id));
      if (nextUnused) setActivePlatform(nextUnused.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not find that handle.";
      setVerifyError(stripStack(msg));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <StepShell
      eyebrow="§01 · Handles"
      title="Where do you create?"
      caption="Add every account Maya should manage. We confirm each one against the platform before accepting it — keeps anyone from typing your handle and stealing your Maya."
    >
      {/* Platform chips */}
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => {
          const used = usedPlatforms.has(p.id);
          const active = activePlatform === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={used || editingLocked}
              onClick={() => setActivePlatform(p.id)}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                active
                  ? "border-lime bg-lime text-ink"
                  : used
                    ? "cursor-not-allowed border-[var(--hairline)] text-paper-faint line-through"
                    : "border-[var(--hairline-strong)] text-paper-dim hover:text-paper"
              }`}
            >
              {p.label}
              {used && <Check className="ml-1.5 inline h-3.5 w-3.5" />}
            </button>
          );
        })}
      </div>

      {/* Handle input row */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 items-center rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 px-4">
          <span className="font-mono text-sm text-paper-faint">
            {activePlatform === "linkedin" ? "in/" : "@"}
          </span>
          <input
            value={draftHandle.replace(/^@+/, "")}
            onChange={(e) => setDraftHandle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onAddHandle();
              }
            }}
            placeholder={
              PLATFORMS.find((p) => p.id === activePlatform)?.placeholder ?? "yourhandle"
            }
            disabled={verifying || atCap || editingLocked}
            className="h-14 w-full bg-transparent pl-2 text-base text-paper outline-none placeholder:text-paper-faint disabled:opacity-50"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={`Your ${activePlatform} handle`}
          />
        </div>
        <button
          type="button"
          onClick={() => void onAddHandle()}
          disabled={
            draftHandle.trim().length === 0 || verifying || atCap || editingLocked
          }
          className="btn btn-primary h-14 px-6 disabled:opacity-50"
        >
          {verifying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Confirming…
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Add handle
            </>
          )}
        </button>
      </div>

      {editingLocked && (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-lime/40 bg-ink-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-lime" />
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                Reading in the background
              </div>
              <p className="mt-1 text-sm text-paper-dim">
                Editing is locked while we pull your data. Maya is reading every
                account in parallel — by the time you finish answering her
                questions, she&rsquo;ll be ready to deploy.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void onUndoLock()}
            className="btn btn-ghost h-9 shrink-0 px-3 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Undo + restart
          </button>
        </div>
      )}

      {verifyError && (
        <p className="mt-3 text-sm text-rose">{verifyError}</p>
      )}

      {/* Verified handles list */}
      {state.handles.length > 0 && (
        <ul className="mt-7 divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-ink-2">
          {state.handles.map((h) => (
            <li
              key={`${h.platform}-${h.handle}`}
              className="flex items-center gap-4 p-4 sm:p-5"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-lime text-ink">
                <Check className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                    {h.platform}
                  </span>
                  <span className="truncate font-display text-lg text-paper">
                    {h.displayName ?? h.handle}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-paper-dim">
                  <span className="font-mono">@{h.handle}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                    {formatFollowers(h.followerCount)} followers · ScrapeCreators-confirmed
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setState(removeHandle(state, h.platform))}
                disabled={editingLocked}
                aria-label={`Remove ${h.platform} handle`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--hairline)] text-paper-faint transition-colors hover:border-rose hover:text-rose disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Plan-tier upgrade nudge for Starter once they hit the cap. */}
      {atCap && state.plan === "starter" && (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[var(--hairline-strong)] bg-ink-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Starter plan · 1 platform
            </div>
            <p className="mt-1 text-paper-dim">
              Want Maya watching your full footprint? Pro adds up to 3
              platforms, every channel, and the full Gmail deal desk.
            </p>
          </div>
          <Link
            href="/sign-up?plan=pro&trial=true"
            className="btn btn-ghost shrink-0"
          >
            Start Pro trial
          </Link>
        </div>
      )}

      {/* Footer / CTA */}
      <StepFooter
        leftMeta={`${state.handles.length} of ${cap} ${cap === 1 ? "handle" : "handles"}`}
        canAdvance={state.handles.length > 0 && !continuing}
        onAdvance={() => void onContinue()}
        advanceLabel={continuing ? "Starting…" : "Read my accounts"}
      />
    </StepShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers + shared shell                                                */
/* -------------------------------------------------------------------------- */

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function stripStack(msg: string): string {
  // Convex action errors come back wrapped with `[CONVEX A(...)]` prefixes —
  // not useful in onboarding UI. Show the last meaningful sentence.
  const cleaned = msg.replace(/\[CONVEX[^\]]*\]\s*/g, "").trim();
  // Also drop the `Server Error` prefix that Convex adds in dev.
  return cleaned.replace(/^Server Error:?\s*/i, "");
}

interface StepShellProps {
  eyebrow: string;
  title: string;
  caption: string;
  children: React.ReactNode;
}

export function StepShell({ eyebrow, title, caption, children }: StepShellProps) {
  return (
    <section className="mx-auto w-full max-w-2xl px-5 pb-16 pt-8 sm:px-8 sm:pt-14">
      <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
        {eyebrow}
      </span>
      <h1 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-paper-dim sm:text-lg">
        {caption}
      </p>
      <div className="mt-8">{children}</div>
    </section>
  );
}

interface StepFooterProps {
  leftMeta?: string;
  canAdvance: boolean;
  onAdvance: () => void;
  advanceLabel: string;
  /** Optional secondary action — e.g. "Skip" with confirmation. */
  secondary?: { label: string; onClick: () => void };
}

export function StepFooter({
  leftMeta,
  canAdvance,
  onAdvance,
  advanceLabel,
  secondary,
}: StepFooterProps) {
  return (
    <div className="mt-10 flex flex-col-reverse items-stretch justify-between gap-4 border-t border-[var(--hairline)] pt-6 sm:flex-row sm:items-center">
      <span className="font-mono text-xs uppercase tracking-widest text-paper-faint">
        {leftMeta ?? ""}
      </span>
      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center">
        {secondary && (
          <button
            type="button"
            onClick={secondary.onClick}
            className="btn btn-ghost h-12 px-5 text-sm"
          >
            {secondary.label}
          </button>
        )}
        <button
          type="button"
          onClick={onAdvance}
          disabled={!canAdvance}
          className="btn btn-primary h-12 px-6 text-sm disabled:opacity-40"
        >
          {advanceLabel}
        </button>
      </div>
    </div>
  );
}

