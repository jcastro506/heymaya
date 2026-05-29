"use client";

/**
 * Drafts / Content — everything the manager has written in the operator's
 * voice. She writes BOTH original posts (kind: post / thread) AND replies
 * (kind: reply / comment / dm), so both show up here.
 *
 * Grouped by approvalState into two buckets:
 *   1. "Ready to review" — draft / pending_approval / needs_revision (acts first)
 *   2. "Approved & posted" — approved / published
 * Rejected drafts are tucked into their own quiet section at the end.
 *
 * Each draft is a Card: platform + kind pills, the actual draftText (or the
 * thread segments for kind: thread), the content-attribute pills (hook / format
 * / tone / length — "what kind of post this is"), and the approvalState pill.
 */

import { useQuery } from "convex/react";
import type { Doc } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import {
  Shell,
  Section,
  Card,
  Pill,
  Loading,
  Empty,
  NeedsOnboarding,
} from "../_components";

type Draft = Doc<"gtmDraftedContent">;

/** Which approvalStates count as "an original post" vs "a reply". */
const POST_KINDS = new Set(["post", "thread"]);

/** Human label + tone for each approvalState pill. */
const STATE_PILL: Record<
  Draft["approvalState"],
  { label: string; tone: "lime" | "paper" | "rose" }
> = {
  draft: { label: "draft", tone: "paper" },
  pending_approval: { label: "needs your ok", tone: "lime" },
  needs_revision: { label: "needs a tweak", tone: "rose" },
  approved: { label: "approved", tone: "lime" },
  published: { label: "posted", tone: "lime" },
  rejected: { label: "passed on", tone: "rose" },
};

/** Reading order inside each section — most-actionable first. */
const STATE_ORDER: Record<Draft["approvalState"], number> = {
  pending_approval: 0,
  needs_revision: 1,
  draft: 2,
  approved: 0,
  published: 1,
  rejected: 0,
};

function attributePills(attrs: Draft["attributes"]) {
  if (!attrs) return [];
  const out: string[] = [];
  if (attrs.hookType) out.push(`hook: ${attrs.hookType}`);
  if (attrs.format) out.push(attrs.format);
  if (attrs.tone) out.push(attrs.tone);
  if (attrs.lengthBucket) out.push(attrs.lengthBucket);
  if (attrs.captionStyle) out.push(attrs.captionStyle);
  if (attrs.postingWindow) out.push(attrs.postingWindow);
  if (attrs.hasFace !== undefined) out.push(attrs.hasFace ? "face on cam" : "no face needed");
  return out;
}

function DraftCard({ d }: { d: Draft }) {
  const isPost = POST_KINDS.has(d.kind);
  const statePill = STATE_PILL[d.approvalState];
  const attrs = attributePills(d.attributes);
  const segments =
    d.kind === "thread" && d.draftSegments && d.draftSegments.length > 0
      ? d.draftSegments
      : null;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="paper">{d.platform}</Pill>
        <Pill tone={isPost ? "lime" : "paper"}>
          {isPost ? `post · ${d.kind}` : `reply · ${d.kind}`}
        </Pill>
        <span className="ml-auto">
          <Pill tone={statePill.tone}>{statePill.label}</Pill>
        </span>
      </div>

      {segments ? (
        <ol className="mt-3 space-y-2">
          {segments.map((seg, i) => (
            <li
              key={i}
              className="rounded-lg border border-paper-faint/15 bg-ink p-3"
            >
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
    </Card>
  );
}

function sortDrafts(list: Draft[]) {
  return [...list].sort((a, b) => {
    const o = STATE_ORDER[a.approvalState] - STATE_ORDER[b.approvalState];
    if (o !== 0) return o;
    return b.createdAt - a.createdAt;
  });
}

export default function DraftsPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const drafts = useQuery(api.gtmMaya.targetList.getMyDraftedContent, {});

  if (snapshot === undefined || drafts === undefined) return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const all = drafts ?? [];

  const review = sortDrafts(
    all.filter((d) =>
      d.approvalState === "draft" ||
      d.approvalState === "pending_approval" ||
      d.approvalState === "needs_revision"
    )
  );
  const live = sortDrafts(
    all.filter(
      (d) => d.approvalState === "approved" || d.approvalState === "published"
    )
  );
  const passed = sortDrafts(
    all.filter((d) => d.approvalState === "rejected")
  );

  return (
    <Shell
      title="Drafts"
      subtitle="Everything your manager has written in your voice — posts to publish and replies to drop in. Review, tweak, post."
    >
      {all.length === 0 ? (
        <Empty
          title="No drafts yet"
          body="Once your manager finds threads worth jumping into and posts worth making, the drafts land here — ready to review and post."
        />
      ) : (
        <>
          <Section title="Ready to review" count={review.length}>
            {review.length === 0 ? (
              <Empty
                title="Nothing waiting on you"
                body="Every draft has been reviewed. New ones will show up here as your manager writes them."
              />
            ) : (
              <ul className="space-y-3">
                {review.map((d) => (
                  <li key={d._id}>
                    <DraftCard d={d} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {live.length > 0 ? (
            <Section title="Approved & posted" count={live.length}>
              <ul className="space-y-3">
                {live.map((d) => (
                  <li key={d._id}>
                    <DraftCard d={d} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {passed.length > 0 ? (
            <Section title="Passed on" count={passed.length}>
              <ul className="space-y-3">
                {passed.map((d) => (
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
