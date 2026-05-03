"use client";

/**
 * Step 6: Deploy.
 *
 * Final step. Triggers the real deploy pipeline via the public
 * `api.onboarding.maya.deployMaya.runOnboardingDeploy` action. That wrapper
 * re-resolves the creator from the Clerk identity inside Convex (cross-tenant
 * safe) and runs the 8-stage pipeline:
 *   1. scrape-pull (parallel ScrapeCreators bulk pull)
 *   2. synthesize-picture (multimodal Gemini 3 Flash @ HIGH thinking)
 *   3. generate-config (workspace tarball assembled + uploaded)
 *   4-7. create-app / set-secrets / create-machine / wait-for-state (Fly)
 *   8. patch-creator (status → active)
 *
 * The UI polls a wall-clock ticker for visual progress; the gating boolean
 * `done` only flips after the action resolves. On success we redirect to
 * `/today`. On failure we surface the stage + retryable bit inline.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { Check, Loader2, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { OnboardingState } from "../_state";
import { StepShell } from "./HandlesStep";

/**
 * The deploy action surface lives at `api.onboarding.maya.deployMaya.runOnboardingDeploy`.
 * Use `anyApi` so this file typechecks even before `npx convex dev` regenerates
 * the api map for the new public wrapper. Once codegen runs, the function
 * still works — `useAction` resolves anyApi refs at runtime against the live
 * api index.
 */
const runOnboardingDeployRef =
  anyApi.onboarding.maya.deployMaya.runOnboardingDeploy;

interface DeployActionResult {
  ok: boolean;
  stage?: string;
  message?: string;
  retryable?: boolean;
}

interface DeployStepProps {
  state: OnboardingState;
}

interface Stage {
  id: "soul" | "machine" | "channel";
  label: string;
  detail: string;
  /** Wall-clock delay (ms) at which we mark this stage complete in the stub. */
  completeAtMs: number;
}

const STAGES: ReadonlyArray<Stage> = [
  {
    id: "soul",
    label: "Writing your Maya's soul",
    detail:
      "Niche, voice fingerprint, audience, top hooks, brand-deal posture — grounded in what she just read.",
    completeAtMs: 4500,
  },
  {
    id: "machine",
    label: "Booting Maya",
    detail: "Provisioning the agent runtime on Fly · pushing your secrets · loading her playbook.",
    completeAtMs: 9500,
  },
  {
    id: "channel",
    label: "Pairing your channel",
    detail: "Connecting Maya to where you said she should reach you.",
    completeAtMs: 13500,
  },
];

const TOTAL_DEPLOY_MS = 14_500;

export function DeployStep({ state }: DeployStepProps) {
  const router = useRouter();
  const runDeploy = useAction(runOnboardingDeployRef);
  // Wave 3 — peek at the pre-fired job rows so we can render
  // "Maya is finishing reading your content (X of Y done)" while she
  // catches up. The deploy action itself also waits server-side, but the
  // user sees a real progress signal instead of a vague spinner.
  const bulkPullJob = useQuery(api.onboarding.maya.jobs.getJobStatus, {
    jobType: "bulk-pull",
  });
  const synthJob = useQuery(api.onboarding.maya.jobs.getJobStatus, {
    jobType: "synth-picture",
  });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [done, setDone] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState<{
    stage: string;
    message: string;
    retryable: boolean;
  } | null>(null);
  /** Guard against the action firing twice on React StrictMode double-mount. */
  const launchedRef = useRef(0);

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 200);

    // Wave 3 — fire the deploy action immediately. The action itself
    // (server-side) checks pre-fired job state and either skips, awaits,
    // or runs inline as the fallback. The UI just shows a single status
    // line until the action returns.
    if (launchedRef.current !== retryCount + 1) {
      launchedRef.current = retryCount + 1;
      void (async () => {
        try {
          const result = (await runDeploy({})) as DeployActionResult;
          if (!result.ok) {
            setError({
              stage: result.stage ?? "deploy",
              message: result.message ?? "Deploy failed.",
              retryable: result.retryable ?? false,
            });
            return;
          }
          setDone(true);
          // Brief celebratory pause then route to the Creator HQ.
          setTimeout(() => router.push("/today"), 2000);
        } catch (e) {
          setError({
            stage: "deploy",
            message: (e as Error).message,
            retryable: true,
          });
        }
      })();
    }

    return () => clearInterval(tick);
  }, [router, runDeploy, retryCount]);

  // Surface the "Maya is finishing reading…" progress when the deploy is
  // running but the pre-fired jobs haven't completed yet.
  const bulkPullPending =
    bulkPullJob !== undefined &&
    bulkPullJob !== null &&
    (bulkPullJob.status === "running" || bulkPullJob.status === "pending");
  const synthPending =
    synthJob !== undefined &&
    synthJob !== null &&
    (synthJob.status === "running" || synthJob.status === "pending");
  const waitingOnPrefiredJobs =
    !done && !error && (bulkPullPending || synthPending);

  return (
    <StepShell
      eyebrow="§06 · Deploying"
      title={done ? "Maya's awake." : "Putting Maya together."}
      caption={
        done
          ? `She'll text you on ${describeChannel(state.channel.selected)} in a moment with her first read on your ${state.handles.length} ${state.handles.length === 1 ? "account" : "accounts"}.`
          : "Should take about 15 seconds. She'll text you the moment she's ready."
      }
    >
      {waitingOnPrefiredJobs && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-lime/40 bg-ink-3 p-4 text-sm text-paper-dim">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-lime" />
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Catching up
            </p>
            <p className="mt-1">
              Maya is finishing reading your content
              {bulkPullPending && bulkPullJob?.progress
                ? ` (${(bulkPullJob.progress as { handlesProcessed?: number }).handlesProcessed ?? 0} of ${(bulkPullJob.progress as { totalHandles?: number }).totalHandles ?? state.handles.length} handles done)`
                : synthPending
                  ? " · synthesizing your creator picture"
                  : ""}
              . She&rsquo;ll be ready in a few seconds.
            </p>
          </div>
        </div>
      )}

      <ol className="space-y-3">
        {STAGES.map((stage) => {
          const inProgress = elapsedMs >= stage.completeAtMs - 4000 && elapsedMs < stage.completeAtMs;
          const completed = elapsedMs >= stage.completeAtMs;
          return (
            <li
              key={stage.id}
              className="flex items-start gap-4 rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5"
            >
              <span
                className={`mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full border ${
                  completed
                    ? "border-lime bg-lime text-ink"
                    : inProgress
                      ? "border-lime text-lime"
                      : "border-[var(--hairline)] text-paper-faint"
                }`}
              >
                {completed ? (
                  <Check className="h-4 w-4" />
                ) : inProgress ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-paper-faint" />
                )}
              </span>
              <div>
                <div className="font-display text-lg text-paper">{stage.label}</div>
                <p className="mt-1 text-sm text-paper-dim">{stage.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {done && (
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-lime bg-ink-3 p-5">
          <Sparkles className="mt-1 h-4 w-4 shrink-0 text-lime" />
          <div>
            <p className="font-display text-xl text-paper">She&rsquo;s on her way.</p>
            <p className="mt-1 text-sm text-paper-dim">
              Maya&rsquo;s first message will reference specific posts from your
              accounts. If she ever sounds generic, that&rsquo;s a bug — tell her
              and she&rsquo;ll re-anchor.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-8 rounded-2xl border border-red-500/40 bg-red-950/30 p-5">
          <p className="font-display text-lg text-paper">
            Maya needs another minute.
          </p>
          <p className="mt-1 text-sm text-paper-dim">
            Stage <code className="font-mono text-xs">{error.stage}</code> —{" "}
            {error.message}
          </p>
          {error.retryable && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setElapsedMs(0);
                setRetryCount((n) => n + 1);
              }}
              className="btn btn-primary mt-4 h-10 px-4 text-sm"
            >
              Retry
            </button>
          )}
        </div>
      )}

      <div className="mt-10 border-t border-[var(--hairline)] pt-6">
        <span className="font-mono text-xs uppercase tracking-widest text-paper-faint">
          Plan · {state.plan} · channel · {state.channel.selected}
        </span>
      </div>
    </StepShell>
  );
}

function describeChannel(channel: OnboardingState["channel"]["selected"]): string {
  switch (channel) {
    case "imessage":
      return "iMessage";
    case "whatsapp":
      return "WhatsApp";
    case "sms":
      return "SMS";
    case "web":
      return "web chat";
  }
}
