"use client";

/**
 * Thinking — a live window into Maya's mind.
 *
 * Not the Today card-list with a filter: a connected *reasoning trace*. Each
 * entry leads with her insight (the `summary`), shows her reasoning beneath it
 * (`detail`), and — when she's grounded it — a source chip (`linkedRef`). It
 * reads like watching a sharp analyst work, scoped to the last Hour / Day /
 * Week and filterable by the kind of thought.
 *
 * Source is the operator-facing narration Maya writes via `post_activity`
 * (already sanitized of infra) — never raw model chain-of-thought.
 */

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
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
} from "../_components";
import { FoundationInsights } from "./_FoundationInsights";
import { DecisionTimeline } from "./_DecisionTimeline";

type Range = "hour" | "day" | "week";

const RANGE_MS: Record<Range, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

const RANGE_LABEL: Record<Range, string> = {
  hour: "Past hour",
  day: "Past day",
  week: "Past week",
};

// Each kind gets a dot color + a one-word register. Reasoning/judgment kinds
// (thinking, plan) use the lime accent — they're the "wow"; discovery + status
// stay muted so the eye lands on the calls she's making.
const KIND_META: Record<string, { label: string; dot: string }> = {
  thinking: { label: "Thinking", dot: "bg-lime" },
  plan_changed: { label: "Plan", dot: "bg-lime" },
  found: { label: "Found", dot: "bg-lime/70" },
  drafted: { label: "Drafted", dot: "bg-paper/70" },
  posted: { label: "Posted", dot: "bg-paper/70" },
  researching: { label: "Researching", dot: "bg-paper/30" },
  status: { label: "Status", dot: "bg-paper/20" },
};

const KINDS = [
  "thinking",
  "researching",
  "found",
  "drafted",
  "plan_changed",
  "posted",
  "status",
] as const;

type Activity = {
  _id: string;
  kind: string;
  summary: string;
  detail?: string;
  linkedRef?: string;
  createdAt: number;
};

function bucketFor(ms: number, range: Range): { key: string; label: string } {
  const d = new Date(ms);
  if (range === "week") {
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    return {
      key: `d-${day.getTime()}`,
      label: day.toLocaleDateString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
    };
  }
  if (range === "day") {
    const hour = new Date(d);
    hour.setMinutes(0, 0, 0);
    return {
      key: `h-${hour.getTime()}`,
      label: hour.toLocaleTimeString([], { hour: "numeric" }),
    };
  }
  return { key: "now", label: "Latest" };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One thought in the trace. */
function Thought({ a, live }: { a: Activity; live: boolean }) {
  const meta = KIND_META[a.kind] ?? KIND_META.status;
  const host =
    a.linkedRef && /^https?:\/\//.test(a.linkedRef) ? hostOf(a.linkedRef) : null;
  return (
    <article className="relative pl-7">
      {/* node on the spine */}
      <span
        className={`absolute left-[-4.5px] top-[6px] size-[10px] rounded-full ring-4 ring-ink ${meta.dot} ${
          live ? "animate-pulse" : ""
        }`}
      />
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
          {meta.label}
        </span>
        <span className="font-mono text-[10px] text-paper-faint">
          {clock(a.createdAt)}
        </span>
        {live ? (
          <span className="rounded-full bg-lime/20 px-1.5 font-mono text-[9px] uppercase tracking-wide text-lime">
            live
          </span>
        ) : null}
      </div>
      {/* the insight — the headline she's making */}
      <p className="mt-1 text-[15px] font-medium leading-snug text-paper">
        {a.summary}
      </p>
      {/* her reasoning */}
      {a.detail ? (
        <p className="mt-1.5 whitespace-pre-line border-l border-paper-faint/20 pl-3 text-[13px] leading-relaxed text-paper-dim">
          {a.detail}
        </p>
      ) : null}
      {/* grounded source */}
      {host ? (
        <a
          href={a.linkedRef}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 rounded-full border border-paper-faint/20 bg-paper/[0.04] px-2.5 py-0.5 font-mono text-[10px] text-paper-dim hover:border-paper-faint/40 hover:text-paper"
        >
          <span className="text-lime">↗</span> {host}
        </a>
      ) : null}
    </article>
  );
}

export default function ThinkingPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const [range, setRange] = useState<Range>("day");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sinceMs = useMemo(() => Date.now() - RANGE_MS[range], [range]);

  const activity = useQuery(api.gtmMaya.missionControl.getMyAgentActivity, {
    sinceMs,
    limit: 500,
  }) as Activity[] | undefined;

  // W3 — Maya's state of knowledge (foundation tables), rendered as grounded
  // reasoning cards above the live pulse. Optional: never blocks the pulse.
  const insights = useQuery(
    api.gtmMaya.missionControl.getMyFoundationInsights
  );

  if (snapshot === undefined || activity === undefined) return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const appName = snapshot.app?.name ?? "your app";

  const filtered =
    selected.size === 0 ? activity : activity.filter((a) => selected.has(a.kind));

  // Newest activity id → the "live" pulse anchor.
  const liveId = activity[0]?._id;

  const buckets: { key: string; label: string; rows: Activity[] }[] = [];
  const byKey = new Map<string, (typeof buckets)[number]>();
  for (const a of filtered) {
    const b = bucketFor(a.createdAt, range);
    let group = byKey.get(b.key);
    if (!group) {
      group = { key: b.key, label: b.label, rows: [] };
      byKey.set(b.key, group);
      buckets.push(group);
    }
    group.rows.push(a);
  }

  const toggleKind = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Shell
      title="Thinking"
      subtitle={`What ${appName}'s manager has figured out — and what she's thinking right now.`}
    >
      {/* W3 — grounded reasoning (state of knowledge), above everything. */}
      {insights ? <FoundationInsights data={insights} /> : null}

      {/* The centerpiece — Maya's real tool-call decision trace, live. */}
      <DecisionTimeline />

      {/* Live pulse — Maya's own narration (post_activity), secondary to the
          grounded decision timeline above. */}
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-paper-faint">
          In her words
        </h2>
        <div className="h-px flex-1 bg-paper-faint/15" />
      </div>

      {/* Range toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-paper-faint/15 bg-ink-2 p-0.5">
          {(["hour", "day", "week"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide transition-colors ${
                range === r ? "bg-paper/10 text-paper" : "text-paper-dim hover:text-paper"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] text-paper-faint">
          {RANGE_LABEL[range]} · {filtered.length} thoughts
        </span>
      </div>

      {/* Kind filter */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide transition-colors ${
            selected.size === 0
              ? "bg-lime/30 text-[#0a0a0a]"
              : "bg-paper/5 text-paper-dim hover:text-paper"
          }`}
        >
          All
        </button>
        {KINDS.map((k) => {
          const on = selected.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                on ? "bg-paper/20 text-paper" : "bg-paper/5 text-paper-dim hover:text-paper"
              }`}
            >
              {KIND_META[k]?.label ?? k}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <Empty
          title="Quiet for now"
          body={
            selected.size > 0
              ? "Nothing of those kinds in this window. Widen the range or clear the filter."
              : "No thoughts in this window yet. As your manager reads, reasons, and decides, her trace streams in here live."
          }
        />
      ) : (
        <div className="space-y-9">
          {buckets.map((group) => (
            <section key={group.key}>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
                  {group.label}
                </h2>
                <div className="h-px flex-1 bg-paper-faint/10" />
                <span className="font-mono text-[11px] text-paper-faint">
                  {group.rows.length}
                </span>
              </div>
              {/* the trace: a spine with thoughts hanging off it */}
              <div className="relative space-y-6 border-l border-paper-faint/15">
                {group.rows.map((a) => (
                  <Thought key={a._id} a={a} live={a._id === liveId} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Shell>
  );
}
