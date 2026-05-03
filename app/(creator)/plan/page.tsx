/**
 * Plan screen — Maya's Sun-4pm content arc for the upcoming week.
 *
 * Sections (mobile-first vertical scroll):
 *   1. Header        — "This week" + week range + prev/next arrows
 *   2. Day cards     — drag-to-reorder, one card per day in the arc
 *   3. Plan history  — collapsed by default, expands to past weeks
 *
 * Drag-and-drop: HTML5 native (`draggable` + `onDragStart` / `onDragOver` /
 * `onDrop`). Picked over `react-beautiful-dnd` because (a) DnD here is
 * one-list-reorder, not multi-list, so the heavy lib is wasted; (b) RBD has
 * known React 18+ issues and we're on React 19; (c) zero new deps keeps the
 * Sprint 5 footprint clean. The reorder reducer is split into a pure
 * function so it can be unit-tested without rendering.
 *
 * The reorder is local-only in v0 — Sprint 6's Plan-edit work (TODO(s6))
 * will persist the new ordering server-side. For now, drag-reorder gives
 * the creator the in-session rearrangement they ask for and Maya re-derives
 * from `dayOffset` on the next regen.
 */

"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { Section } from "@/components/creator/Section";
import {
  reorderArc,
  type PlanArcEntry,
} from "@/components/creator/planReorder";
import { emptyCopyFor, StageEmpty } from "@/components/creator/stage";

type Platform = "tiktok" | "instagram" | "youtube" | "linkedin" | "x";

const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: "TT",
  instagram: "IG",
  youtube: "YT",
  linkedin: "LI",
  x: "X",
};

export default function PlanPage() {
  const currentPlan = useQuery(api.plan.currentPlan);
  const history = useQuery(api.plan.planHistory, {
    paginationOpts: { numItems: 12, cursor: null },
  });
  const voice = useQuery(api.businessReadiness.voiceFingerprint);
  const stageCtx = useQuery(api.businessReadiness.creatorStage);
  const replanDay = useMutation(api.plan.replanDay);
  const approveDay = useMutation(api.plan.approveDay);
  const markPosted = useMutation(api.businessReadiness.markDayPosted);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [arcOverride, setArcOverride] = useState<PlanArcEntry[] | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  if (currentPlan === undefined) {
    return <PlanSkeleton />;
  }

  if (currentPlan === null) {
    // Stage-aware empty: just-starting creators see "keep posting, plan
    // arrives once Maya has 2 weeks of pattern"; building+ get the
    // emphasis-on-craft / diversification framing.
    return (
      <div className="pt-2 sm:pt-6">
        <Section
          eyebrow="§ Plan"
          title="No plan yet."
          caption="Maya drafts the upcoming week on Sunday at 4pm in your timezone. Once she does, this screen renders the 7-day arc."
          variant="tight"
        >
          {stageCtx ? (
            <StageEmpty copy={emptyCopyFor("plan-current", stageCtx)} />
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ink-2/40 p-8">
              <p className="text-sm text-paper-dim">
                First plan lands the Sunday after onboarding completes. If
                it&rsquo;s past Sunday 4pm and the plan still hasn&rsquo;t shown
                up, Maya is likely waiting on a fresh ScrapeCreators pull.
              </p>
            </div>
          )}
        </Section>
      </div>
    );
  }

  const arc = arcOverride ?? currentPlan.arc;

  return (
    <div className="pt-2 sm:pt-6">
      {/* Header */}
      <Section
        eyebrow={`§ Plan · week of ${formatWeek(currentPlan.weekStartLocal)}`}
        title="This week"
        caption={currentPlan.rationale}
        rightSlot={<WeekNav weekStartLocal={currentPlan.weekStartLocal} />}
        variant="tight"
      >
        <p className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
          Generated {formatGeneratedAt(currentPlan.generatedAt)} · drag any
          card to re-sequence
        </p>
      </Section>

      {/* Voice fingerprint sidebar — surfaces the soul Maya plans against */}
      {voice && (
        <Section eyebrow="§00 · Voice" title="What Maya is writing in">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5 sm:col-span-2">
              <div className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                Voice fingerprint · {voice.niche}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-paper">
                {voice.voiceFingerprint || (
                  <span className="text-paper-faint">
                    Voice not synthesized yet — will land after onboarding completes.
                  </span>
                )}
              </p>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                Edit from Profile → Picture
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5">
              <div className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                Top hooks
              </div>
              {voice.topHooks.length > 0 ? (
                <ul className="mt-3 space-y-2 text-sm text-paper-dim">
                  {voice.topHooks.map((h, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-2 h-1 w-3 shrink-0 bg-lime" />
                      <span className="line-clamp-2">{h.pattern}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-paper-faint">
                  Hook library builds as Maya watches your top posts.
                </p>
              )}
            </div>
          </div>
        </Section>
      )}

      {/* Day cards */}
      <Section eyebrow="§01 · Days" title="">
        <ul className="space-y-3">
          {arc.map((entry, idx) => (
            <li
              key={`${entry.dayOffset}-${entry.platform}-${idx}`}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx === null || dragIdx === idx) return;
                setArcOverride(reorderArc(arc, dragIdx, idx));
                setDragIdx(null);
              }}
              onDragEnd={() => setDragIdx(null)}
            >
              <DayCard
                entry={entry}
                onApprove={async () => {
                  await approveDay({
                    planId: currentPlan._id,
                    dayOffset: entry.dayOffset,
                  });
                }}
                onReplan={async () => {
                  await replanDay({
                    planId: currentPlan._id,
                    dayOffset: entry.dayOffset,
                  });
                }}
                onMarkPosted={async () => {
                  await markPosted({
                    planId: currentPlan._id,
                    dayOffset: entry.dayOffset,
                  });
                }}
              />
            </li>
          ))}
        </ul>
      </Section>

      {/* Plan history */}
      <Section eyebrow="§02 · History" title="Past weeks">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 px-5 py-4 text-left transition-colors hover:bg-ink-3"
          aria-expanded={historyOpen}
        >
          <span className="font-mono text-xs uppercase tracking-widest text-paper-dim">
            {history?.page.length ?? 0} past plan
            {(history?.page.length ?? 0) === 1 ? "" : "s"}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-paper-faint transition-transform ${
              historyOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {historyOpen && (
          <ul className="mt-3 space-y-2">
            {(history?.page ?? []).map((p) => (
              <li
                key={p._id}
                className="rounded-xl border border-[var(--hairline)] bg-ink-2 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-display text-lg text-paper">
                    Week of {formatWeek(p.weekStartLocal)}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                    {p.arc.length} day{p.arc.length === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-paper-dim">
                  {p.rationale}
                </p>
              </li>
            ))}
            {(history?.page.length ?? 0) === 0 && (
              <li className="rounded-xl border border-dashed border-[var(--hairline-strong)] bg-ink-2/40 p-5 text-sm text-paper-dim">
                No past plans yet. The first archive lands once Maya generates
                week two.
              </li>
            )}
          </ul>
        )}
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Day card                                                                    */
/* -------------------------------------------------------------------------- */

function DayCard({
  entry,
  onApprove,
  onReplan,
  onMarkPosted,
}: {
  entry: PlanArcEntry;
  onApprove: () => Promise<void>;
  onReplan: () => Promise<void>;
  onMarkPosted: () => Promise<void>;
}) {
  const dayLabel = DAY_LABELS[entry.dayOffset % 7] ?? `Day ${entry.dayOffset + 1}`;
  const isApproved = entry.status === "approved";
  const isPosted = entry.status === "posted";

  return (
    <article className="group relative cursor-move overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5 transition-colors hover:border-[var(--paper-faint)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            {dayLabel}
          </span>
          <PlatformChip platform={entry.platform as Platform} />
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-dim">
            {entry.format}
          </span>
        </div>
        <StatusPill status={entry.status} />
      </div>

      {/* Hook + script */}
      <div className="mt-4">
        <p className="font-display text-xl leading-snug text-paper sm:text-2xl">
          {entry.hookOptions[0] ?? <span className="text-paper-faint">No hook drafted</span>}
        </p>
        {entry.hookOptions.length > 1 && (
          <p className="mt-2 text-xs text-paper-faint">
            +{entry.hookOptions.length - 1} alternate hook
            {entry.hookOptions.length - 1 === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {/* Caption draft */}
      {entry.captionDraft && (
        <div className="mt-4 rounded-xl border border-[var(--hairline)] bg-ink-3 p-4">
          <div className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            Caption draft
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-paper-dim">
            {entry.captionDraft}
          </p>
        </div>
      )}

      {/* Posting time */}
      <div className="mt-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-paper-faint">
        <Sparkles className="h-3 w-3 text-lime" />
        Suggested · {entry.postingTimeLocal}
      </div>

      {/* Actions */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--hairline)] pt-4">
        <button
          type="button"
          onClick={onApprove}
          disabled={isApproved || isPosted}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
            isApproved || isPosted
              ? "cursor-not-allowed border-[var(--hairline)] text-paper-faint"
              : "border-lime bg-lime text-ink hover:bg-lime-soft"
          }`}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {isApproved ? "Approved" : isPosted ? "Posted" : "Approve"}
        </button>
        {isApproved && !isPosted && (
          <button
            type="button"
            onClick={onMarkPosted}
            className="inline-flex items-center gap-1.5 rounded-full border border-paper bg-paper px-3 py-1.5 text-xs text-ink transition-colors hover:bg-paper-dim"
          >
            <Send className="h-3.5 w-3.5" />
            Mark posted
          </button>
        )}
        <button
          type="button"
          onClick={onReplan}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline-strong)] px-3 py-1.5 text-xs text-paper-dim transition-colors hover:text-paper"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Replan
        </button>
        <button
          type="button"
          disabled
          aria-label="Edit (coming Sprint 6)"
          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-[var(--hairline)] px-3 py-1.5 text-xs text-paper-faint"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function StatusPill({ status }: { status: "draft" | "approved" | "posted" }) {
  const styles: Record<typeof status, string> = {
    draft: "bg-ink-3 text-paper-dim border border-[var(--hairline-strong)]",
    approved: "bg-lime text-ink",
    posted: "bg-paper text-ink",
  };
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-mono uppercase tracking-wider ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function PlatformChip({ platform }: { platform: Platform }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink-3 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-paper-dim">
      {PLATFORM_LABELS[platform]}
    </span>
  );
}

function WeekNav({ weekStartLocal }: { weekStartLocal: string }) {
  // Prev/next arrows are cosmetic in Sprint 5 — Maya only ever holds the
  // current week's plan + an archive accessible below. Wiring them to scroll
  // through history lands in Sprint 6 alongside the inline editor.
  // TODO(s6): wire arrows to step through `planHistory`.
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline-strong)] bg-ink-2 p-0.5">
      <button
        type="button"
        disabled
        aria-label="Previous week (coming Sprint 6)"
        className="grid h-7 w-7 cursor-not-allowed place-items-center rounded-full text-paper-faint"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="px-2 font-mono text-[11px] uppercase tracking-widest text-paper-dim">
        {formatWeek(weekStartLocal)}
      </span>
      <button
        type="button"
        disabled
        aria-label="Next week (coming Sprint 6)"
        className="grid h-7 w-7 cursor-not-allowed place-items-center rounded-full text-paper-faint"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function PlanSkeleton() {
  return (
    <div className="px-5 pt-10 sm:px-8 sm:pt-14">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="h-3 w-32 rounded-full bg-ink-2" />
        <div className="h-12 w-2/3 rounded-2xl bg-ink-2" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-44 w-full rounded-2xl bg-ink-2" />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatWeek(weekStartLocal: string): string {
  // weekStartLocal is YYYY-MM-DD (Monday). Render as "Apr 22".
  const [, m, d] = weekStartLocal.split("-").map(Number);
  if (!m || !d) return weekStartLocal;
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${MONTHS[m - 1]} ${d}`;
}

function formatGeneratedAt(ts: number): string {
  const diffHr = Math.round((Date.now() - ts) / 3_600_000);
  if (diffHr < 1) return "just now";
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
