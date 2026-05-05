"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { OnboardingDraft } from "../_state";

export function VoiceSamplesStep({
  draft,
  setDraft,
  onNext,
  onBack,
}: {
  draft: OnboardingDraft;
  setDraft: React.Dispatch<React.SetStateAction<OnboardingDraft>>;
  onNext: () => Promise<void>;
  onBack: () => Promise<void>;
}) {
  const setVoiceSamples = useMutation(
    api.onboarding.growth.pipeline.setVoiceSamples
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setSamples = (
    platform: "linkedin" | "twitter",
    samples: string[]
  ) => {
    setDraft((d) => ({
      ...d,
      voiceSamples: { ...d.voiceSamples, [platform]: samples },
    }));
  };

  async function handleSubmit() {
    setError(null);
    const li = draft.voiceSamples.linkedin.map((s) => s.trim()).filter(Boolean);
    const tw = draft.voiceSamples.twitter.map((s) => s.trim()).filter(Boolean);
    if (li.length === 0 && tw.length === 0) {
      setError(
        "Paste at least one sample. Maya needs voice ground-truth or she'll sound generic."
      );
      return;
    }
    setSubmitting(true);
    try {
      await setVoiceSamples({
        voiceSamples: { linkedin: li, twitter: tw },
      });
      await onNext();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h1 className="mb-3 font-serif text-3xl">Voice samples</h1>
      <p className="mb-8 max-w-xl text-paper-dim">
        Paste 5&ndash;10 of your strongest posts per platform. These are what
        Maya fits her voice to. The hardest part of her job is sounding
        like you.
      </p>

      <SampleList
        platform="LinkedIn"
        samples={draft.voiceSamples.linkedin}
        setSamples={(s) => setSamples("linkedin", s)}
      />
      <SampleList
        platform="X / Twitter"
        samples={draft.voiceSamples.twitter}
        setSamples={(s) => setSamples("twitter", s)}
      />

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <div className="mt-8 flex justify-between">
        <button
          onClick={onBack}
          className="rounded-full border border-paper-faint/30 px-7 py-3 text-sm text-paper-dim hover:border-paper hover:text-paper"
        >
          ← Back
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink hover:bg-white disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Continue →"}
        </button>
      </div>
    </section>
  );
}

function SampleList({
  platform,
  samples,
  setSamples,
}: {
  platform: string;
  samples: string[];
  setSamples: (s: string[]) => void;
}) {
  const add = () => setSamples([...samples, ""]);
  const remove = (idx: number) =>
    setSamples(samples.filter((_, i) => i !== idx));
  const update = (idx: number, value: string) =>
    setSamples(samples.map((s, i) => (i === idx ? value : s)));

  return (
    <div className="mb-8">
      <label className="mb-2 block text-xs font-mono uppercase tracking-widest text-paper-faint">
        {platform} ({samples.filter((s) => s.trim()).length})
      </label>
      <div className="space-y-3">
        {samples.map((s, i) => (
          <div key={i} className="flex gap-2">
            <textarea
              value={s}
              onChange={(e) => update(i, e.target.value)}
              placeholder={`Paste a ${platform} post you wrote that you're proud of`}
              rows={4}
              className="flex-1 rounded-xl border border-paper-faint/30 bg-ink-2 px-4 py-3 text-paper placeholder:text-paper-faint focus:border-paper-dim focus:outline-none"
            />
            {samples.length > 1 && (
              <button
                onClick={() => remove(i)}
                aria-label="Remove sample"
                className="self-start rounded-full border border-paper-faint/30 px-3 py-2 text-xs text-paper-faint hover:border-red-400 hover:text-red-400"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={add}
        className="mt-3 text-xs font-mono uppercase tracking-widest text-paper-faint hover:text-paper"
      >
        + Add another
      </button>
    </div>
  );
}
