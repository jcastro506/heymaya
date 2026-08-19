"use client";

/**
 * ⭐ Brain — what she's watching, what she plans to make, what she has to make
 * it with.
 *
 * ## Why this was rewritten rather than migrated
 *
 * It used to read "Intent signal", "Pain, verbatim", "Who she believes is
 * buying", "Where she's betting" — the **superseded** intent-hunting design in
 * docs/AGENT_REDESIGN_V2.md, which CLAUDE.md records as history rather than
 * decisions. Those are the right questions for an agent that hunts people
 * expressing buying intent and replies to them. They are the wrong questions
 * for one that makes vertical video.
 *
 * So this is not a query swap. The questions changed
 * (docs/MISSION_CONTROL_UGC.md), and all three answers already existed as
 * queries with no consumer:
 *
 * - `formats.myFormats` — the shapes that are working in the niche
 * - `dashboard.myIdeaBank` — what she plans to make
 * - `dashboard.myMediaLibrary` — what she has to make it with
 *
 * ## What it deliberately does not have
 *
 * No upload button, no "add an idea", no editing. §2.1 — connect + receipts,
 * never a workbench. Assets arrive in the messenger or during onboarding; ideas
 * come from the sweeps. This screen proves she is paying attention.
 */

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Card,
  Chip,
  Empty,
  Loading,
  NeedsOnboarding,
  Rise,
  Section,
  Shell,
  channelLabel,
} from "../_components";

/** The §7.5.3 ladder, in the founder's words. */
const RUNG_LABEL: Record<string, string> = {
  founder_footage: "your footage",
  screen_recording: "screen recording",
  product_screenshot: "screenshot",
  generated_background: "generated",
  avatar: "presenter",
};

export default function BrainPage() {
  const formats = useQuery(api.maya.formats.myFormats, {});
  const ideas = useQuery(api.maya.dashboard.myIdeaBank, {});
  const library = useQuery(api.maya.dashboard.myMediaLibrary, {});

  if (formats === undefined || ideas === undefined || library === undefined)
    return <Loading />;
  if (!formats || !formats.ok) return <NeedsOnboarding />;

  const shapes = formats.shapes ?? [];
  const bank = ideas?.ideas ?? [];
  const assets = library?.assets ?? [];

  return (
    <Shell
      title="Brain"
      subtitle="What she's watching, what she plans to make, and what she has to make it with."
    >
      {/* ── What she's watching ─────────────────────────────────────────── */}
      <Section title="Shapes that are working" count={shapes.length}>
        {shapes.length === 0 ? (
          <Rise>
            <Empty
              title="Nothing yet."
              body="She sweeps the niche daily. Shapes show up here once she's seen enough to be sure."
            />
          </Rise>
        ) : (
          shapes.map((s) => (
            <Rise key={s.id}>
              <Card>
                <div className="mc-action-src">
                  <Chip platform={s.channel}>{channelLabel(s.channel)}</Chip>
                  {/**
                   * ⭐ Watched vs read is a real distinction, not decoration. A
                   * watched card was actually viewed — that is the difference
                   * between knowing a video did well and knowing WHY.
                   */}
                  {s.watched ? <Chip>watched</Chip> : null}
                  <span className="mc-when mc-num">
                    {s.views.toLocaleString()} views
                  </span>
                </div>
                {/**
                 * ⚠️ THE HOOK LINE ONLY. §7.5.3: copy the structure, never the
                 * content. Rendering a competitor's full transcript on our own
                 * dashboard is one copy-paste from reproducing someone else's
                 * claims, which the spec calls a defect rather than a feature.
                 */}
                <div className="mc-draft">“{s.hook}”</div>
              </Card>
            </Rise>
          ))
        )}
      </Section>

      {/* ── What she plans to make ──────────────────────────────────────── */}
      <Section title="Ideas she's banked" count={bank.length}>
        {bank.length === 0 ? (
          <Rise>
            <Empty
              title="Nothing banked."
              body="Ideas come from what she reads in your niche — the bank fills as she sweeps."
            />
          </Rise>
        ) : (
          bank.map((i) => (
            <Rise key={i.id}>
              <Card>
                <div className="mc-draft">{i.angle}</div>
                <div className="mc-action-src">
                  {i.sourceKind ? <Chip>{i.sourceKind}</Chip> : null}
                  {/**
                   * ⭐ Evidence as a boolean, not the blob. A founder wants to
                   * know she has a REASON for an idea, not to read our JSON.
                   */}
                  {i.hasEvidence ? <Chip>has evidence</Chip> : null}
                </div>
              </Card>
            </Rise>
          ))
        )}
      </Section>

      {/* ── What she has to make it with ────────────────────────────────── */}
      <Section title="What she has to work with" count={assets.length}>
        {/**
         * ⭐ THE LADDER VERDICT, NOT A COUNT. "You have 6 assets" is not the
         * useful sentence; "everything here is generated, so your videos use a
         * presenter" is — and it is the one §7.5.3 exists to force. It comes
         * straight from `planAssets().detail`, in her words.
         */}
        {library?.note ? (
          <Rise>
            <Card>
              <div className="mc-draft">{library.note}</div>
            </Card>
          </Rise>
        ) : null}
        {assets.length === 0 ? (
          <Rise>
            <Empty
              title="Nothing yet."
              body="Send her screenshots or a screen recording in chat and she'll build from those instead of stock images."
            />
          </Rise>
        ) : (
          <Rise>
            <Card>
              <div className="flex flex-wrap gap-2">
                {assets.map((a) => (
                  <Chip key={a.id}>
                    {a.rung ? (RUNG_LABEL[a.rung] ?? a.rung) : a.kind}
                  </Chip>
                ))}
              </div>
            </Card>
          </Rise>
        )}
      </Section>
    </Shell>
  );
}
