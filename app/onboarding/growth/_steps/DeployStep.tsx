"use client";

import type { OnboardingDraft } from "../_state";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Deploy step — final pre-launch checkout. Wave B ships the visual
 * confirmation; the actual `deployRiley` Convex action lands in Wave C
 * (mirrors `deployServiceMaya` for the riley_growth pack).
 *
 * Until then, "Deploy Riley" marks onboarding complete + lands the
 * operator on the dashboard, which shows a "Riley is queued for
 * deployment" placeholder.
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
  const linkedinSamples = draft.voiceSamples.linkedin.filter((s) =>
    s.trim()
  ).length;
  const twitterSamples = draft.voiceSamples.twitter.filter((s) =>
    s.trim()
  ).length;

  return (
    <section>
      <h1 className="mb-3 font-serif text-3xl">Deploy Riley</h1>
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

      <div className="mb-8 rounded-2xl border border-lime/30 bg-lime/5 p-6 text-sm text-paper-dim">
        <p className="mb-2 font-mono text-xs uppercase tracking-widest text-lime">
          Wave B note
        </p>
        <p>
          The deploy action ships in Wave C — clicking <em>Deploy Riley</em>{" "}
          right now marks onboarding complete and lands you on the dashboard,
          where Riley will appear once her pack generators + Fly deploy land.
          Everything before this step is real and persisted.
        </p>
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="rounded-full border border-paper-faint/30 px-7 py-3 text-sm text-paper-dim hover:border-paper hover:text-paper"
        >
          ← Back
        </button>
        <button
          onClick={onComplete}
          className="rounded-full bg-lime px-7 py-3 text-sm font-medium text-ink hover:bg-lime/90"
        >
          Deploy Riley →
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
              ? "text-lime"
              : "text-red-400"
        }
      >
        {value}
      </span>
    </div>
  );
}
