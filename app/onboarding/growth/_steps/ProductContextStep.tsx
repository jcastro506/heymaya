"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { OnboardingDraft } from "../_state";

export function ProductContextStep({
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
  const setProductContext = useMutation(
    api.onboarding.growth.pipeline.setProductContext
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ctx = draft.productContext;
  const set = (
    field: keyof OnboardingDraft["productContext"],
    value: string
  ) =>
    setDraft((d) => ({
      ...d,
      productContext: { ...d.productContext, [field]: value },
    }));

  async function handleSubmit() {
    setError(null);
    const trimmed = {
      productName: ctx.productName.trim(),
      oneLiner: ctx.oneLiner.trim(),
      targetAudience: ctx.targetAudience.trim(),
      primaryUrl: ctx.primaryUrl.trim() || undefined,
      focus: ctx.focus.trim(),
    };
    if (!trimmed.productName || !trimmed.oneLiner || !trimmed.targetAudience || !trimmed.focus) {
      setError("Fill in product name, one-liner, target audience, and focus.");
      return;
    }
    setSubmitting(true);
    try {
      await setProductContext({ productContext: trimmed });
      await onNext();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h1 className="mb-3 font-serif text-3xl">What is Riley building hype for?</h1>
      <p className="mb-8 max-w-xl text-paper-dim">
        Tell Riley what you&rsquo;re launching, who it&rsquo;s for, and what angles
        you want her to focus on. This goes straight into her SOUL.md.
      </p>

      <div className="space-y-6">
        <Field
          label="Product name"
          placeholder="HeyMaya"
          value={ctx.productName}
          onChange={(v) => set("productName", v)}
        />
        <Field
          label="One-liner"
          placeholder="An AI creator manager that lives in your messages"
          value={ctx.oneLiner}
          onChange={(v) => set("oneLiner", v)}
        />
        <Field
          label="Target audience"
          placeholder="Creators with 5K–500K followers who can't afford a human manager"
          value={ctx.targetAudience}
          onChange={(v) => set("targetAudience", v)}
        />
        <Field
          label="Primary URL (optional)"
          placeholder="https://heymaya.ai"
          value={ctx.primaryUrl}
          onChange={(v) => set("primaryUrl", v)}
        />
        <Field
          label="What should Riley focus on?"
          placeholder="Pre-launch waitlist building. Themes: anti-sycophancy AI, single-agent designs, founder-as-the-product. Avoid: rebuttals to specific competitors, generic AI hot takes."
          value={ctx.focus}
          onChange={(v) => set("focus", v)}
          textarea
        />
      </div>

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
          className="rounded-full bg-lime px-7 py-3 text-sm font-medium text-ink hover:bg-lime/90 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Continue →"}
        </button>
      </div>
    </section>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  textarea,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-mono uppercase tracking-widest text-paper-faint">
        {label}
      </label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={5}
          className="w-full rounded-xl border border-paper-faint/30 bg-ink-2 px-4 py-3 text-paper placeholder:text-paper-faint focus:border-lime focus:outline-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-paper-faint/30 bg-ink-2 px-4 py-3 text-paper placeholder:text-paper-faint focus:border-lime focus:outline-none"
        />
      )}
    </div>
  );
}
