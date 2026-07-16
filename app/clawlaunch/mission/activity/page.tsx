"use client";

/**
 * Activity — the window into the office.
 *
 *   LIVE WIRE   what she's doing, day-grouped, kind icons, the loud events
 *               (found / drafted / posted / plan changed) visually accented.
 *   YOUR THREAD the actual conversation, mirrored read-only, phone-style —
 *               one continuous story between phone and web.
 *
 * Both are Convex live subscriptions; entries stream in as she works.
 */

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  clock,
  Empty,
  Loading,
  NeedsOnboarding,
  Panel,
  Rise,
  Shell,
  SrcLink,
} from "../_components";

/* ── Kind icons — inline strokes, board-style ──────────────────────────── */

const ICON_PATHS: Record<string, string> = {
  researching: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-3.5-3.5", // magnifier
  found: "M13 2 5 14h6l-1 8 8-12h-6l1-8z", // bolt
  drafted: "M4 19h16M4 5h16M6 12h12", // lines
  posted: "M20 6 9 17l-5-5", // check
  thinking: "M12 3v3m0 12v3m9-9h-3M6 12H3m14.5-6.5-2 2m-7 7-2 2m11 0-2-2m-7-7-2-2", // spark
  plan_changed: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14", // map
  status: "M12 20v-6m-5 6v-9m10 9V8", // bars
};
const HOT_KINDS = new Set(["found", "drafted", "posted", "plan_changed"]);

function KindIcon({ kind }: { kind: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden>
      <path d={ICON_PATHS[kind] ?? ICON_PATHS.status} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Day grouping ──────────────────────────────────────────────────────── */

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (ms >= today.getTime()) return "Today";
  if (ms >= today.getTime() - 24 * 60 * 60 * 1000) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function groupByDay<T extends { ts: number }>(
  rows: T[]
): Array<{ key: string; label: string; rows: T[] }> {
  const groups: Array<{ key: string; label: string; rows: T[] }> = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const r of rows) {
    const d = new Date(r.ts);
    d.setHours(0, 0, 0, 0);
    const key = String(d.getTime());
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: dayLabel(r.ts), rows: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.rows.push(r);
  }
  return groups;
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function ActivityPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const activity = useQuery(api.gtmMaya.missionControl.getMyAgentActivity, {
    limit: 100,
  });
  const messages = useQuery(api.gtmMaya.missionControl.getMyMayaMessages, {});

  const feedGroups = useMemo(
    () => groupByDay((activity ?? []).map((a) => ({ ...a, ts: a.createdAt }))),
    [activity]
  );
  // Phone reads oldest → newest; the query returns newest first.
  const thread = useMemo(() => [...(messages ?? [])].reverse().slice(-60), [messages]);

  const phoneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = phoneRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length]);

  if (snapshot === undefined || activity === undefined) return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const recent = activity[0] && Date.now() - activity[0].createdAt < 30 * 60 * 1000;
  const throttled =
    typeof snapshot.agent.spendThrottledUntil === "number" &&
    snapshot.agent.spendThrottledUntil > Date.now();
  const headline = throttled
    ? "RESTING"
    : recent
      ? "WORKING"
      : snapshot.agent.lifecycleState === "researching" ||
          snapshot.agent.lifecycleState === "fresh"
        ? "RESEARCHING"
        : snapshot.agent.lifecycleState === "plan_ready"
          ? "PLAN READY"
          : "ON THE CLOCK";

  return (
    <Shell
      title="Activity"
      when={
        <>
          <span style={{ color: "var(--mc-good)" }}>●</span> {headline}
        </>
      }
    >
      <div className="mc-grid mc-act-grid">
        {/* ── Live wire ─────────────────────────────────────────────────── */}
        <Rise>
          <Panel title="Live wire" live>
            {feedGroups.length === 0 ? (
              <p className="text-xs text-paper-faint">
                Her play-by-play streams in here as she works.
              </p>
            ) : (
              feedGroups.map((g) => (
                <div key={g.key}>
                  <div className="mc-feed-day">{g.label}</div>
                  {g.rows.map((a) => {
                    const sourceUrl =
                      a.linkedRef && /^https?:\/\//.test(a.linkedRef)
                        ? a.linkedRef
                        : null;
                    return (
                      <div
                        key={a._id}
                        className={`mc-evt ${HOT_KINDS.has(a.kind) ? "hot" : ""}`}
                      >
                        <div className="ic">
                          <KindIcon kind={a.kind} />
                        </div>
                        <div className="min-w-0">
                          <div className="body">{a.summary}</div>
                          {a.detail ? <div className="sub">{a.detail}</div> : null}
                          {sourceUrl ? (
                            <div className="mt-1">
                              <SrcLink href={sourceUrl}>source ↗</SrcLink>
                            </div>
                          ) : null}
                        </div>
                        <span className="t">{clock(a.createdAt)}</span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </Panel>
        </Rise>

        {/* ── Chat mirror ───────────────────────────────────────────────── */}
        <Rise i={1}>
          <Panel title="Your thread with her · read-only">
            {messages === undefined ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="mc-skeleton h-14 w-full" />
                ))}
              </div>
            ) : thread.length === 0 ? (
              <Empty title="No messages yet" body="Your chat with Maya mirrors here." />
            ) : (
              <div className="mc-phone" ref={phoneRef}>
                {thread.map((m) => (
                  <div key={m._id} className={`mc-bub ${m.role === "maya" ? "maya" : "me"}`}>
                    {m.body}
                    <span className="bt">{clock(m.ts)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </Rise>
      </div>
    </Shell>
  );
}
