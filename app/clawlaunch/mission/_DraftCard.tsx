"use client";

/**
 * DraftCard — one decision in Today's "Needs you" band. Channel chip, age,
 * the draft clamped to three lines, and Post it / Tweak / Pass.
 *
 * ⚠️ MIGRATED TO v2 (2026-08-19). This read `gtmMaya.missionActions` — the
 * FROZEN product — while a v2 Maya wrote to `convex/maya/drafts`. The founder
 * was shown a deleted product's drafts and could approve nothing she had
 * actually written. See docs/MISSION_CONTROL_V2_MIGRATION.md.
 *
 * ⚠️ TWO FIELDS WENT AND BOTH WERE X-ERA. `thread` (the source thread the reply
 * answered) and `draftSegments` (multi-part posts) only ever meant anything on
 * X, which was dropped 2026-08-18. Carrying them forward would have kept UI for
 * a channel we no longer sell, and there is nothing in `convex/maya/drafts` to
 * populate them with.
 *
 * ⭐ THREE MUTATIONS BECAME ONE. `approveMyDraft` / `passOnMyDraft` /
 * `requestDraftTweak` were one decision with three outcomes; `decideMyDraft`
 * takes the outcome as an argument, so the tenant and expiry checks live in one
 * place instead of three.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Btn, Chip, channelLabel, timeAgo } from "./_components";

/** What `maya.drafts.myDraftQueue` returns, one row. */
export type QueueDraft = {
  id: string;
  channel: string;
  kind: string;
  text: string;
  proposedAt: number;
  expiresAt: number;
};

export function platformLabel(p: string): string {
  return channelLabel(p);
}

export function DraftCard({ d }: { d: QueueDraft }) {
  const decide = useMutation(api.maya.drafts.decideMyDraft);

  const [busy, setBusy] = useState<"approve" | "pass" | "tweak" | null>(null);
  const [tweaking, setTweaking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async (
    which: "approve" | "pass" | "tweak",
    fn: () => Promise<{ ok: boolean; error?: string }>
  ) => {
    setBusy(which);
    setError(null);
    try {
      const res = await fn();
      /**
       * ⚠️ The mutation returns `{ok:false, error}` rather than throwing — an
       * expired or already-decided draft is a NAMED failure, not an exception.
       * Only checking for a thrown error would show a success state for a
       * decision that did nothing.
       */
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      setTweaking(false);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const srcLabel = `${channelLabel(d.channel)} · ${d.kind} draft`;

  return (
    <div className="mc-action">
      <div className="mc-action-src">
        <Chip platform={d.channel}>{srcLabel}</Chip>
        <span className="mc-when mc-num">{timeAgo(d.proposedAt)}</span>
      </div>

      <div className="mc-draft">{d.text}</div>

      {tweaking ? (
        <div>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="What should she change?"
            className="w-full resize-none rounded-lg border border-[var(--mc-line)] bg-ink p-2.5 text-[12.5px] leading-relaxed text-paper outline-none placeholder:text-paper-faint focus:border-lime/50"
          />
          <div className="mc-acts">
            <Btn
              tone="primary"
              busy={busy === "tweak"}
              disabled={!note.trim()}
              /**
               * ⚠️ A tweak is a REJECTION carrying their reason, not a separate
               * state. `decide` records `rejectionReason` verbatim — §7.5.2
               * layer 2, never paraphrased — and that is what she rewrites
               * from. Inventing an extra outcome would put the same sentence in
               * two places.
               */
              onClick={() =>
                void run("tweak", () =>
                  decide({ draftId: d.id as never, outcome: "rejected", reason: note })
                )
              }
            >
              Send to Maya
            </Btn>
            <Btn tone="ghost" onClick={() => setTweaking(false)}>
              Cancel
            </Btn>
          </div>
        </div>
      ) : (
        <div className="mc-acts">
          <Btn
            tone="primary"
            busy={busy === "approve"}
            onClick={() =>
              void run("approve", () =>
                decide({ draftId: d.id as never, outcome: "approved" })
              )
            }
          >
            Post it
          </Btn>
          <Btn onClick={() => setTweaking(true)}>Tweak</Btn>
          <Btn
            tone="ghost"
            busy={busy === "pass"}
            onClick={() =>
              void run("pass", () =>
                decide({ draftId: d.id as never, outcome: "rejected" })
              )
            }
          >
            Pass
          </Btn>
        </div>
      )}
      {error ? <p className="text-xs text-rose">{error}</p> : null}
    </div>
  );
}
