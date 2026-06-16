"use client";

/**
 * W2 — the founder picks how much rope Maya gets on the auto channels
 * (X / LinkedIn / Instagram / YouTube). Reddit + TikTok always confirm (ban
 * safety) regardless of this; the plan tier is the hard ceiling. This is a
 * preference layered inside both — never a bypass.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card } from "../_components";

type Mode = "confirm_each" | "confirm_first_week" | "autonomous";

const OPTIONS: { value: Mode; label: string; blurb: string }[] = [
  {
    value: "confirm_each",
    label: "Confirm every post",
    blurb: "I send each post to you for a one-tap OK before it goes out.",
  },
  {
    value: "confirm_first_week",
    label: "Confirm at first, then handle it",
    blurb:
      "You approve the first few; once you've okayed 3 (or a week passes), I post the auto channels myself.",
  },
  {
    value: "autonomous",
    label: "Just handle it",
    blurb:
      "I post the auto channels myself. (Reddit & TikTok always come to you — platform safety.)",
  },
];

export function PostingControl({
  mode,
  graduated,
}: {
  mode: string | null;
  graduated: boolean;
}) {
  const setMode = useMutation(api.gtmMaya.researchLifecycle.setMyPostingMode);
  const [saving, setSaving] = useState<Mode | null>(null);
  const current = (mode ?? "confirm_first_week") as Mode;

  async function choose(value: Mode) {
    if (value === current) return;
    setSaving(value);
    try {
      await setMode({ mode: value });
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <div className="space-y-2">
        {OPTIONS.map((o) => {
          const active = o.value === current;
          return (
            <button
              key={o.value}
              onClick={() => choose(o.value)}
              disabled={saving !== null}
              className={`block w-full rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                active
                  ? "border-lime/50 bg-lime/10"
                  : "border-paper-faint/15 hover:border-paper-faint/30"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-paper">{o.label}</span>
                {active ? (
                  <span className="font-mono text-[11px] uppercase tracking-wide text-lime">
                    {saving === o.value ? "saving…" : "current"}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-paper-dim">{o.blurb}</p>
            </button>
          );
        })}
      </div>
      {current === "confirm_first_week" && graduated ? (
        <p className="mt-3 border-t border-paper-faint/15 pt-3 text-xs text-paper-dim">
          You&apos;ve approved enough posts that I can take the auto channels off
          your plate — switch to <span className="text-paper">Just handle it</span>{" "}
          whenever you&apos;re ready.
        </p>
      ) : null}
    </Card>
  );
}
