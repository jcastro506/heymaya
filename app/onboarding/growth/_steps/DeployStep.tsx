"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { OnboardingDraft } from "../_state";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Deploy step — final pre-launch checkout. Calls the real
 * `runOnboardingDeploy` action, which spins up Maya's per-user Fly
 * machine using the existing OpenClaw runtime image. Surfaces the
 * deploy stage on failure so the operator can diagnose.
 */
export function DeployStep({
  draft,
  agentId,
  onComplete,
  onBack,
}: {
  draft: OnboardingDraft;
  agentId: Id<"growthAgents"> | null;
  onComplete: () => Promise<void>;
  onBack: () => Promise<void>;
}) {
  const runDeploy = useAction(
    api.onboarding.growth.deployRiley.runOnboardingDeploy
  );
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    flyAppId: string;
    machineId: string;
    durationMs: number;
  } | null>(null);

  async function handleDeploy() {
    setDeployError(null);
    setDeploying(true);
    try {
      const res = await runDeploy({});
      if (!res.ok) {
        setDeployError(`stage=${res.stage}: ${res.message}`);
        return;
      }
      setSuccess({
        flyAppId: res.flyAppId,
        machineId: res.machineId,
        durationMs: res.durationMs,
      });
      // Server already patched onboardingStep to "complete" — surface the
      // win here, then move the UI forward.
      await onComplete();
    } catch (e) {
      setDeployError((e as Error).message);
    } finally {
      setDeploying(false);
    }
  }
  const linkedinSamples = draft.voiceSamples.linkedin.filter((s) =>
    s.trim()
  ).length;
  const twitterSamples = draft.voiceSamples.twitter.filter((s) =>
    s.trim()
  ).length;

  return (
    <section>
      <h1 className="mb-3 font-serif text-3xl">Deploy Maya</h1>
      <p className="mb-8 max-w-xl text-paper-dim">
        She gets her own machine. From here she drafts in your voice, watches
        engagement, and asks before she sends anything.
      </p>

      <div className="mb-8 space-y-3 rounded-2xl border border-paper-faint/15 bg-ink-2 p-6 text-sm">
        <Row label="Product" value={draft.productContext.productName || "—"} />
        <Row
          label="One-liner"
          value={draft.productContext.oneLiner || "—"}
        />
        <Row
          label="Audience"
          value={draft.productContext.targetAudience || "—"}
        />
        <Row
          label="LinkedIn connection"
          value={
            draft.linkedinComposioId ? "Connected" : "Missing"
          }
          good={Boolean(draft.linkedinComposioId)}
        />
        <Row
          label="X (Twitter) connection"
          value={
            draft.twitterComposioId ? "Connected" : "Missing"
          }
          good={Boolean(draft.twitterComposioId)}
        />
        <Row
          label="LinkedIn voice samples"
          value={`${linkedinSamples}`}
          good={linkedinSamples >= 1}
        />
        <Row
          label="X voice samples"
          value={`${twitterSamples}`}
          good={twitterSamples >= 1}
        />
        <Row label="Agent id" value={agentId ?? "—"} />
      </div>

      {success && (
        <div className="mb-8 rounded-2xl border border-paper-faint/30 bg-paper/5 p-6 text-sm">
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-paper">
            Maya is live
          </p>
          <p className="mb-1 text-paper">
            <span className="text-paper-faint">Fly app:</span>{" "}
            <code className="text-paper">{success.flyAppId}</code>
          </p>
          <p className="mb-1 text-paper">
            <span className="text-paper-faint">Machine:</span>{" "}
            <code className="text-paper">{success.machineId}</code>
          </p>
          <p className="text-paper-dim">
            Boot took {(success.durationMs / 1000).toFixed(1)}s.
          </p>
        </div>
      )}

      {deployError && (
        <div className="mb-8 rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-sm">
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-red-400">
            Deploy failed
          </p>
          <p className="text-paper-dim">{deployError}</p>
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          disabled={deploying}
          className="rounded-full border border-paper-faint/30 px-7 py-3 text-sm text-paper-dim hover:border-paper hover:text-paper disabled:opacity-50"
        >
          ← Back
        </button>
        <button
          onClick={handleDeploy}
          disabled={deploying || Boolean(success)}
          className="rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink hover:bg-white disabled:opacity-50"
        >
          {deploying
            ? "Deploying…"
            : success
              ? "Deployed →"
              : "Deploy Maya →"}
        </button>
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="font-mono text-xs uppercase tracking-widest text-paper-faint">
        {label}
      </span>
      <span
        className={
          good === undefined
            ? "text-paper"
            : good
              ? "text-paper"
              : "text-red-400"
        }
      >
        {value}
      </span>
    </div>
  );
}
