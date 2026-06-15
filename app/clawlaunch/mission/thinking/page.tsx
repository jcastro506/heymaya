"use client";

/**
 * Thinking — a clean, filterable window into Maya's mind.
 *
 * Reads the same live `gtmAgentActivity` stream the Today tab shows, but lets
 * the operator scope it to the last Hour / Day / Week and filter by what kind
 * of thought it was (thinking / researching / found / drafted / plan / posted).
 * Rows are grouped into readable time buckets so a week reads as a diary, not
 * a wall.
 *
 * Source is the operator-facing `summary`/`detail` Maya writes via
 * `post_activity` — already sanitized of infra. We deliberately do NOT surface
 * raw model chain-of-thought; this is her *narrated* thinking.
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

const ACTIVITY_TONE: Record<string, "lime" | "paper" | "rose"> = {
  found: "lime",
  drafted: "lime",
  plan_changed: "lime",
  posted: "lime",
  researching: "paper",
  thinking: "paper",
  status: "paper",
};

// The filter chips, in narrative order (reasoning first, status last).
const KINDS: { key: string; label: string }[] = [
  { key: "thinking", label: "Thinking" },
  { key: "researching", label: "Researching" },
  { key: "found", label: "Found" },
  { key: "drafted", label: "Drafted" },
  { key: "plan_changed", label: "Plan" },
  { key: "posted", label: "Posted" },
  { key: "status", label: "Status" },
];

type Activity = {
  _id: string;
  kind: string;
  summary: string;
  detail?: string;
  linkedRef?: string;
  createdAt: number;
};

/** Bucket key + human label for a timestamp, given the active range. */
function bucketFor(ms: number, range: Range): { key: string; label: string } {
  const d = new Date(ms);
  if (range === "week") {
    // Group by calendar day.
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
    // Group by hour.
    const hour = new Date(d);
    hour.setMinutes(0, 0, 0);
    return {
      key: `h-${hour.getTime()}`,
      label: hour.toLocaleTimeString([], { hour: "numeric" }),
    };
  }
  // hour → single flat bucket.
  return { key: "now", label: "Just now" };
}

export default function ThinkingPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const [range, setRange] = useState<Range>("day");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Anchor the lower bound at selection time (not every render) so the live
  // subscription stays stable — new activity still streams in because its
  // createdAt is always > sinceMs. Re-derives only when `range` changes.
  const sinceMs = useMemo(() => Date.now() - RANGE_MS[range], [range]);

  const activity = useQuery(api.gtmMaya.missionControl.getMyAgentActivity, {
    sinceMs,
    limit: 500,
  }) as Activity[] | undefined;

  if (snapshot === undefined || activity === undefined) return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const appName = snapshot.app?.name ?? "your app";

  // Client-side kind filter (instant; no re-query). Empty selection = all.
  const filtered =
    selected.size === 0
      ? activity
      : activity.filter((a) => selected.has(a.kind));

  // Group into time buckets, preserving the desc order the query returned.
  const buckets: { key: string; label: string; rows: Activity[] }[] = [];
  const byKey = new Map<string, { key: string; label: string; rows: Activity[] }>();
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
      subtitle={`What ${appName}'s manager has been thinking, researching, and deciding. Scope it to the last hour, day, or week.`}
    >
      {/* Range toggle */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-paper-faint/15 bg-ink-2 p-0.5">
          {(["hour", "day", "week"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide transition-colors ${
                range === r
                  ? "bg-paper/10 text-paper"
                  : "text-paper-dim hover:text-paper"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] text-paper-faint">
          {RANGE_LABEL[range]}
        </span>
      </div>

      {/* Kind filter chips */}
      <div className="mb-7 flex flex-wrap items-center gap-2">
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
          const on = selected.has(k.key);
          return (
            <button
              key={k.key}
              type="button"
              onClick={() => toggleKind(k.key)}
              className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                on
                  ? "bg-paper/20 text-paper"
                  : "bg-paper/5 text-paper-dim hover:text-paper"
              }`}
            >
              {k.label}
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
              : "No activity in this window yet. As your manager works, her thinking streams in here live."
          }
        />
      ) : (
        buckets.map((group) => (
          <Section key={group.key} title={group.label} count={group.rows.length}>
            <ol className="space-y-2">
              {group.rows.map((a) => (
                <li key={a._id}>
                  <Card className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Pill tone={ACTIVITY_TONE[a.kind] ?? "paper"}>
                          {a.kind}
                        </Pill>
                        <span className="truncate text-sm text-paper">
                          {a.summary}
                        </span>
                      </div>
                      {a.detail ? (
                        <p className="mt-1 text-xs leading-relaxed text-paper-dim">
                          {a.detail}
                        </p>
                      ) : null}
                      {a.linkedRef && /^https?:\/\//.test(a.linkedRef) ? (
                        <p className="mt-1 text-xs">
                          <ExtLink href={a.linkedRef}>open ↗</ExtLink>
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-paper-faint">
                      {timeAgo(a.createdAt)}
                    </span>
                  </Card>
                </li>
              ))}
            </ol>
          </Section>
        ))
      )}
    </Shell>
  );
}
