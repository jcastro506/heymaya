/**
 * Tone section — three-way picker for Maya's voice. Identical mutation to the
 * old picture editor's tone field, just unbundled from the long form.
 *
 * Mutation: api.profile.updateCreatorPicture
 *   - Only `tonePreference` is sent; the picture handler patches in place.
 *   - Save fires onClick — there's no submit button. The picker is the action.
 */

"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Check, Loader2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

type ProfileSummary = NonNullable<
  FunctionReturnType<typeof api.profile.getProfileSummary>
>;
type Tone = "supportive" | "strategic" | "tough-love";

const TONES: ReadonlyArray<{ id: Tone; label: string; blurb: string }> = [
  {
    id: "supportive",
    label: "Supportive",
    blurb: "She softens the edges. Tough reads come with a runway.",
  },
  {
    id: "strategic",
    label: "Strategic",
    blurb: "Even and direct. The default — clear without being sharp.",
  },
  {
    id: "tough-love",
    label: "Tough love",
    blurb: "She names misses fast. No hedging, no cushion.",
  },
];

export function ToneSection({ summary }: { summary: ProfileSummary }) {
  const update = useMutation(api.profile.updateCreatorPicture);
  const [tone, setTone] = useState<Tone | null>(summary.creator.tonePreference);
  const [busy, setBusy] = useState<Tone | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onPick = async (next: Tone) => {
    if (busy) return;
    setErr(null);
    setBusy(next);
    const previous = tone;
    setTone(next);
    try {
      await update({ tonePreference: next });
      setSavedAt(Date.now());
    } catch (e) {
      setTone(previous);
      const raw = e instanceof Error ? e.message : "Could not save.";
      setErr(raw.replace(/\[CONVEX[^\]]*\]\s*/g, "").trim());
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border-t border-[var(--hairline)] px-5 pt-10 sm:px-8 sm:pt-12">
      <div className="mx-auto max-w-2xl">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
          How she talks to you
        </span>
        <h2 className="mt-4 font-display text-3xl tracking-tight text-paper sm:text-4xl">
          Pick a tone.{" "}
          <span className="italic text-paper-dim">
            The honesty stays. The delivery shifts.
          </span>
        </h2>

        <ul className="mt-7 grid grid-cols-1 gap-3">
          {TONES.map((t) => {
            const active = tone === t.id;
            const isBusy = busy === t.id;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => void onPick(t.id)}
                  disabled={busy !== null}
                  aria-pressed={active}
                  className={`flex min-h-[72px] w-full items-start gap-4 rounded-2xl border px-5 py-4 text-left transition-colors disabled:opacity-60 ${
                    active
                      ? "border-lime bg-lime/5"
                      : "border-[var(--hairline-strong)] bg-ink-2 hover:border-paper-dim"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                      active
                        ? "border-lime bg-lime text-ink"
                        : "border-[var(--hairline-strong)]"
                    }`}
                  >
                    {active && <Check className="h-3 w-3" />}
                    {isBusy && !active && (
                      <Loader2 className="h-3 w-3 animate-spin text-paper-dim" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block font-display text-xl ${
                        active ? "text-lime" : "text-paper"
                      }`}
                    >
                      {t.label}
                    </span>
                    <span className="mt-1 block text-sm text-paper-dim">
                      {t.blurb}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {savedAt && !err && (
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-lime">
              Saved.
            </span>
          )}
          {err && <span className="text-sm text-rose">{err}</span>}
        </div>
      </div>
    </section>
  );
}
