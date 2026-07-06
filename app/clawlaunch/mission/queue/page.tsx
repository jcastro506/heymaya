"use client";

/**
 * Queue — everything Maya wrote or made, and the place the founder DECIDES.
 * v2: this is a control surface, not a gallery. Every reviewable card gets
 * Approve / Tweak / Pass, and reply drafts show the conversation they answer
 * (approving a reply blind is how trust dies).
 *
 * Two views: Content (drafts) and Media (Maya-made assets), one toggle.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { QueueDraft } from "@/convex/gtmMaya/missionActions";
import {
  Shell,
  Section,
  Card,
  Pill,
  Loading,
  Empty,
  NeedsOnboarding,
  timeAgo,
  ExtLink,
  ActionButton,
} from "../_components";

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

function platformLabel(p: string): string {
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

function DraftCard({ d }: { d: QueueDraft }) {
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
          {error ? <p className="mt-2 text-xs text-[#b3261e]">{error}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

const STATE_ORDER: Record<QueueDraft["approvalState"], number> = {
  pending_approval: 0,
  needs_revision: 1,
  draft: 2,
  approved: 0,
  published: 1,
  rejected: 0,
};

function sortDrafts(list: QueueDraft[]): QueueDraft[] {
  return [...list].sort((a, b) => {
    const o = STATE_ORDER[a.approvalState] - STATE_ORDER[b.approvalState];
    if (o !== 0) return o;
    return b.createdAt - a.createdAt;
  });
}

/** Matches mediaAssets.getMyMediaAssets's MediaGalleryItem shape. */
type MediaItem = {
  id: string;
  kind: string;
  source: string;
  isVideo: boolean;
  url: string | null;
  label: string | null;
  createdAt: number;
  groundedCount: number;
  generatedByMaya: boolean;
};

const MEDIA_KIND_LABEL: Record<string, string> = {
  slide: "slideshow",
  image: "image",
  video: "video",
  screenshot: "screenshot",
  screen_recording: "recording",
};

function MediaTile({ item }: { item: MediaItem }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="relative aspect-square bg-ink">
        {item.url ? (
          item.isVideo ? (
            <video src={item.url} controls playsInline className="h-full w-full object-cover" />
          ) : (
            <a href={item.url} target="_blank" rel="noreferrer" title="Open full size">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt={item.label ?? item.kind}
                className="h-full w-full object-cover"
              />
            </a>
          )
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center font-mono text-[11px] text-paper-faint">
            preview still rendering…
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="flex items-center gap-2">
          <Pill tone={item.generatedByMaya ? "lime" : "paper"}>
            {MEDIA_KIND_LABEL[item.kind] ?? item.kind}
          </Pill>
          {item.groundedCount > 0 ? (
            <span
              className="font-mono text-[10px] text-paper-faint"
              title="Built from your real screenshots"
            >
              grounded ×{item.groundedCount}
            </span>
          ) : null}
        </div>
        <span className="font-mono text-[10px] text-paper-faint">{timeAgo(item.createdAt)}</span>
      </div>
    </Card>
  );
}

function MediaGrid() {
  const items = useQuery(api.gtmMaya.mediaAssets.getMyMediaAssets) as
    | MediaItem[]
    | undefined;
  if (items === undefined) return <Loading />;
  const made = (items ?? []).filter((a) => a.generatedByMaya);
  const source = (items ?? []).filter((a) => !a.generatedByMaya);
  if ((items ?? []).length === 0) {
    return (
      <Empty
        title="No media yet"
        body="Slideshows, images, and videos Maya makes for your posts collect here — built from your real product."
      />
    );
  }
  return (
    <>
      <Section title="Made by Maya" count={made.length}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {made.map((a) => (
            <MediaTile key={a.id} item={a} />
          ))}
        </div>
      </Section>
      {source.length > 0 ? (
        <Section title="Your source material" count={source.length}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {source.map((a) => (
              <MediaTile key={a.id} item={a} />
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

export default function QueuePage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const drafts = useQuery(api.gtmMaya.missionActions.getMyDraftQueue);
  // Honors /queue?view=media (the old Assets tab's redirect target). Read
  // lazily from location so we skip the useSearchParams Suspense bailout.
  const [view, setView] = useState<"content" | "media">(() =>
    typeof window !== "undefined" &&
    typeof window.location?.search === "string" &&
    new URLSearchParams(window.location.search).get("view") === "media"
      ? "media"
      : "content"
  );

  const grouped = useMemo(() => {
    const all = drafts ?? [];
    return {
      review: sortDrafts(
        all.filter(
          (d) =>
            d.approvalState === "pending_approval" ||
            d.approvalState === "draft" ||
            d.approvalState === "needs_revision"
        )
      ),
      live: sortDrafts(
        all.filter((d) => d.approvalState === "approved" || d.approvalState === "published")
      ),
      passed: sortDrafts(all.filter((d) => d.approvalState === "rejected")),
    };
  }, [drafts]);

  if (snapshot === undefined || drafts === undefined) return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  return (
    <Shell
      title="Queue"
      subtitle="Everything Maya wrote in your voice, with the conversation it belongs to. Approve it, tweak it, or pass — she handles the rest."
    >
      <div className="mb-8 flex gap-1 rounded-full border border-paper-faint/20 p-1 sm:w-fit">
        {(["content", "media"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`flex-1 rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors sm:flex-none ${
              view === v ? "bg-paper text-ink" : "text-paper-dim hover:text-paper"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "media" ? (
        <MediaGrid />
      ) : (drafts ?? []).length === 0 ? (
        <Empty
          title="Nothing written yet"
          body="Once Maya finds threads worth joining and posts worth making, her drafts land here for your call."
        />
      ) : (
        <>
          <Section title="Your call" count={grouped.review.length}>
            {grouped.review.length === 0 ? (
              <Empty
                title="Nothing waiting on you"
                body="Every draft is decided. New ones land here as she writes them."
              />
            ) : (
              <ul className="space-y-3">
                {grouped.review.map((d) => (
                  <li key={d._id}>
                    <DraftCard d={d} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {grouped.live.length > 0 ? (
            <Section title="Approved & posted" count={grouped.live.length}>
              <ul className="space-y-3">
                {grouped.live.map((d) => (
                  <li key={d._id}>
                    <DraftCard d={d} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {grouped.passed.length > 0 ? (
            <Section title="Passed on" count={grouped.passed.length}>
              <ul className="space-y-3">
                {grouped.passed.map((d) => (
                  <li key={d._id}>
                    <DraftCard d={d} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}
    </Shell>
  );
}
