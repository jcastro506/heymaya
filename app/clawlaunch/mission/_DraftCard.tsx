"use client";

/**
 * DraftCard — one board "action": a decision card in Today's "Needs you"
 * band. Channel chip + thread metrics, the thread line, the draft clamped
 * to three lines, and Post it / Tweak / Pass wired to missionActions.
 * The thread link is the receipt; no prose beyond the draft itself.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { QueueDraft } from "@/convex/gtmMaya/missionActions";
import { Btn, Chip, channelLabel, timeAgo } from "./_components";

export function platformLabel(p: string): string {
  return channelLabel(p);
}

/** Draft age — thread vote metrics aren't on QueueDraft, so age only. */
function threadMeta(d: QueueDraft): string {
  return timeAgo(d.createdAt);
}

export function DraftCard({ d }: { d: QueueDraft }) {
  const approve = useMutation(api.gtmMaya.missionActions.approveMyDraft);
  const pass = useMutation(api.gtmMaya.missionActions.passOnMyDraft);
  const tweak = useMutation(api.gtmMaya.missionActions.requestDraftTweak);

  const [busy, setBusy] = useState<"approve" | "pass" | "tweak" | null>(null);
  const [tweaking, setTweaking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async (
    which: "approve" | "pass" | "tweak",
    fn: () => Promise<unknown>
  ) => {
    setBusy(which);
    setError(null);
    try {
      await fn();
      setTweaking(false);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const srcLabel = `${channelLabel(d.platform)} · ${d.kind} draft`;
  const threadLine = d.thread?.title ?? d.thread?.excerpt ?? null;
  const body =
    d.kind === "thread" && d.draftSegments && d.draftSegments.length > 0
      ? d.draftSegments.join("\n")
      : d.draftText;

  return (
    <div className="mc-action">
      <div className="mc-action-src">
        <Chip platform={d.platform}>{srcLabel}</Chip>
        <span className="mc-when mc-num">
          {d.approvalState === "needs_revision" ? "reworking · " : ""}
          {threadMeta(d)}
        </span>
      </div>

      {threadLine ? (
        <div className="mc-thread">
          {d.thread?.url ? (
            <a
              href={d.thread.url}
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline hover:underline"
            >
              “{threadLine}”
            </a>
          ) : (
            <>“{threadLine}”</>
          )}
        </div>
      ) : null}

      <div className="mc-draft">{body}</div>

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
              onClick={() => void run("tweak", () => tweak({ draftId: d._id, note }))}
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
            onClick={() => void run("approve", () => approve({ draftId: d._id }))}
          >
            Post it
          </Btn>
          <Btn onClick={() => setTweaking(true)}>Tweak</Btn>
          <Btn
            tone="ghost"
            busy={busy === "pass"}
            onClick={() => void run("pass", () => pass({ draftId: d._id }))}
          >
            Pass
          </Btn>
        </div>
      )}
      {error ? <p className="text-xs text-rose">{error}</p> : null}
    </div>
  );
}
