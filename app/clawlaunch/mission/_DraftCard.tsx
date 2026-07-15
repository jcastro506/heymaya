"use client";

/**
 * DraftCard — one piece of writing Maya wants a call on, with the conversation
 * it answers quoted above it (approving a reply blind is how trust dies).
 * Approve / Tweak / Pass wired to the missionActions mutations. Lives at the
 * mission root because Today's "Needs you" tray is its primary home.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { QueueDraft } from "@/convex/gtmMaya/missionActions";
import { Card, Pill, timeAgo, ExtLink, ActionButton } from "./_components";

const POST_KINDS = new Set(["post", "thread"]);

const STATE_PILL: Record<
  QueueDraft["approvalState"],
  { label: string; tone: "lime" | "paper" | "rose" }
> = {
  draft: { label: "in the shop", tone: "paper" },
  pending_approval: { label: "needs your ok", tone: "lime" },
  needs_revision: { label: "being reworked", tone: "rose" },
  approved: { label: "approved", tone: "lime" },
  published: { label: "posted", tone: "lime" },
  rejected: { label: "passed on", tone: "rose" },
};

export function platformLabel(p: string): string {
  return p === "x" ? "X" : p === "hn" ? "Hacker News" : p.charAt(0).toUpperCase() + p.slice(1);
}

function attributePills(attrs: QueueDraft["attributes"]): string[] {
  if (!attrs) return [];
  const out: string[] = [];
  if (attrs.hookType) out.push(`hook: ${attrs.hookType}`);
  if (attrs.format) out.push(attrs.format);
  if (attrs.tone) out.push(attrs.tone);
  if (attrs.lengthBucket) out.push(attrs.lengthBucket);
  if (attrs.captionStyle) out.push(attrs.captionStyle);
  if (attrs.postingWindow) out.push(`window: ${attrs.postingWindow}`);
  if (attrs.hasFace !== undefined) out.push(attrs.hasFace ? "face on cam" : "no face needed");
  return out;
}

/** The conversation a reply answers — quoted above the draft. */
function ThreadContext({ thread }: { thread: NonNullable<QueueDraft["thread"]> }) {
  return (
    <blockquote className="mt-3 border-l-2 border-paper-faint/30 pl-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
        Replying to{thread.author ? ` ${thread.author}` : ""} on {platformLabel(thread.platform)}
      </p>
      {thread.title ? (
        <p className="mt-1 text-sm font-medium text-paper">{thread.title}</p>
      ) : null}
      {thread.excerpt ? (
        <p className="mt-1 text-xs italic leading-relaxed text-paper-dim">
          “{thread.excerpt.slice(0, 280)}
          {thread.excerpt.length > 280 ? "…" : ""}”
        </p>
      ) : null}
      <p className="mt-1 text-xs">
        <ExtLink href={thread.url}>view the thread ↗</ExtLink>
      </p>
    </blockquote>
  );
}

export function DraftCard({ d }: { d: QueueDraft }) {
  const approve = useMutation(api.gtmMaya.missionActions.approveMyDraft);
  const pass = useMutation(api.gtmMaya.missionActions.passOnMyDraft);
  const tweak = useMutation(api.gtmMaya.missionActions.requestDraftTweak);

  const [busy, setBusy] = useState<"approve" | "pass" | "tweak" | null>(null);
  const [tweaking, setTweaking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isPost = POST_KINDS.has(d.kind);
  const statePill = STATE_PILL[d.approvalState];
  const attrs = attributePills(d.attributes);
  const segments =
    d.kind === "thread" && d.draftSegments && d.draftSegments.length > 0
      ? d.draftSegments
      : null;
  const decidable =
    d.approvalState === "pending_approval" ||
    d.approvalState === "draft" ||
    d.approvalState === "needs_revision";

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

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="paper">{platformLabel(d.platform)}</Pill>
        <Pill tone={isPost ? "lime" : "paper"}>
          {isPost ? `post · ${d.kind}` : `reply · ${d.kind}`}
        </Pill>
        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11px] text-paper-faint">
            {timeAgo(d.createdAt)}
          </span>
          <Pill tone={statePill.tone}>{statePill.label}</Pill>
        </span>
      </div>

      {d.thread ? <ThreadContext thread={d.thread} /> : null}

      {d.rationale ? (
        <p className="mt-3 rounded-lg bg-paper/5 p-2.5 text-xs leading-relaxed text-paper-dim">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            Why{" "}
          </span>
          {d.rationale}
        </p>
      ) : null}

      {segments ? (
        <ol className="mt-3 space-y-2">
          {segments.map((seg, i) => (
            <li key={i} className="rounded-lg border border-paper-faint/15 bg-ink p-3">
              <span className="font-mono text-[11px] text-paper-faint">
                {i + 1}/{segments.length}
              </span>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-paper">
                {seg}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-paper">
          {d.draftText}
        </p>
      )}

      {d.userFeedback && d.approvalState === "needs_revision" ? (
        <p className="mt-3 rounded-lg bg-paper/5 p-2.5 text-xs leading-relaxed text-paper-dim">
          Your note: “{d.userFeedback}”
        </p>
      ) : null}

      {attrs.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-paper-faint/10 pt-3">
          {attrs.map((a) => (
            <span
              key={a}
              className="inline-flex items-center rounded-full bg-paper/5 px-2 py-0.5 font-mono text-[10px] lowercase tracking-wide text-paper-faint"
            >
              {a}
            </span>
          ))}
        </div>
      ) : null}

      {decidable ? (
        <div className="mt-4 border-t border-paper-faint/10 pt-3.5">
          {tweaking ? (
            <div>
              <textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="What should she change? (tone it down, shorter, mention the free tier…)"
                className="w-full resize-none rounded-lg border border-paper-faint/25 bg-transparent p-2.5 text-sm leading-relaxed text-paper outline-none placeholder:text-paper-faint focus:border-paper-faint/50"
              />
              <div className="mt-2 flex items-center gap-2">
                <ActionButton
                  onClick={() => void run("tweak", () => tweak({ draftId: d._id, note }))}
                  busy={busy === "tweak"}
                  disabled={!note.trim()}
                >
                  Send to Maya
                </ActionButton>
                <ActionButton tone="quiet" onClick={() => setTweaking(false)}>
                  Cancel
                </ActionButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                onClick={() => void run("approve", () => approve({ draftId: d._id }))}
                busy={busy === "approve"}
              >
                Approve
              </ActionButton>
              <ActionButton tone="quiet" onClick={() => setTweaking(true)}>
                Tweak
              </ActionButton>
              <ActionButton
                tone="danger"
                onClick={() => void run("pass", () => pass({ draftId: d._id }))}
                busy={busy === "pass"}
              >
                Pass
              </ActionButton>
              <span className="ml-auto text-[11px] text-paper-faint">
                Approving hands it back to Maya — she posts it in the right window.
              </span>
            </div>
          )}
          {error ? <p className="mt-2 text-xs text-rose">{error}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
