"use client";

/**
 * Plan — the rolling 7-day calendar.
 *
 * A week view grouped by day (today → +6 days). Each day lists its calendar
 * events (gtmCalendarEvents) sorted by start time. Every card shows the event
 * kind as a pill, the time, the title, and the full recipe-style description
 * (whitespace-pre-line — it carries the deep link / "OPEN (one-tap)" inside).
 *
 * The point is the MIX: your manager schedules original posts AND replies, like
 * a real social-media manager. The kind pill makes that mix legible at a glance.
 * This IS the surface — Maya posts these for you on connected channels (Google
 * Calendar mirroring is retired); the queue lives here, not on any calendar.
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

type CalEvent = Doc<"gtmCalendarEvents">;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Human label + pill tone for each event kind. Posts read lime (make
 *  something), replies/engagement read paper (go talk to people). */
const KIND_META: Record<
  string,
  { label: string; tone: "lime" | "paper" | "rose" }
> = {
  soft_launch_post: { label: "post", tone: "lime" },
  hard_launch_anchor: { label: "launch post", tone: "lime" },
  reply_window: { label: "reply", tone: "paper" },
  engagement_block: { label: "engage", tone: "paper" },
  warmup_block: { label: "warm up", tone: "paper" },
  first_50_dms: { label: "dm", tone: "paper" },
  weekly_review: { label: "review", tone: "rose" },
};

function kindMeta(kind: CalEvent["kind"]): {
  label: string;
  tone: "lime" | "paper" | "rose";
} {
  if (kind && KIND_META[kind]) return KIND_META[kind];
  return { label: kind ?? "task", tone: "paper" };
}

function startOfDayMs(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function dayLabel(dayStart: number, todayStart: number): string {
  const offset = Math.round((dayStart - todayStart) / DAY_MS);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return new Date(dayStart).toLocaleDateString([], {
    weekday: "long",
  });
}

function dayDate(dayStart: number): string {
  return new Date(dayStart).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function eventTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PlanPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const events = useQuery(api.gtmMaya.calendarWrite.getMyCalendarEvents);

  if (snapshot === undefined || events === undefined) return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const todayStart = startOfDayMs(new Date());
  const windowEnd = todayStart + 7 * DAY_MS; // today → +6 days inclusive

  // Build the 7 day-buckets up front so empty days still render.
  const days = Array.from({ length: 7 }, (_, i) => {
    const dayStart = todayStart + i * DAY_MS;
    const items = (events ?? [])
      .filter((e) => e.startsAtMs >= dayStart && e.startsAtMs < dayStart + DAY_MS)
      .sort((a, b) => a.startsAtMs - b.startsAtMs);
    return { dayStart, items };
  });

  const total = days.reduce((n, d) => n + d.items.length, 0);

  if (total === 0) {
    return (
      <Shell
        title="Plan"
        subtitle="Your rolling plan — the posts and replies your manager lined up. She posts them for you on your connected channels."
      >
        <Empty
          title="Nothing scheduled yet"
          body="Once your manager finishes this week's research, she'll fill the next 7 days with posts to publish and replies to leave — each one auto-posting on your connected channels, with the few that need your tap clearly flagged. Check back shortly."
        />
      </Shell>
    );
  }

  return (
    <Shell
      title="Plan"
      subtitle="Your rolling plan — the posts and replies your manager lined up. She posts them for you on your connected channels."
    >
      {days.map(({ dayStart, items }) => (
        <Section
          key={dayStart}
          title={`${dayLabel(dayStart, todayStart)} · ${dayDate(dayStart)}`}
          count={items.length}
        >
          {items.length === 0 ? (
            <p className="text-sm text-paper-faint">Nothing scheduled.</p>
          ) : (
            <ol className="space-y-2">
              {items.map((e) => {
                const meta = kindMeta(e.kind);
                return (
                  <li key={e._id}>
                    <Card>
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={meta.tone}>{meta.label}</Pill>
                        <span className="font-mono text-[11px] text-paper-faint">
                          {eventTime(e.startsAtMs)}
                        </span>
                        {e.status === "scheduled" ? (
                          <Pill tone="lime">scheduled</Pill>
                        ) : null}
                        {e.status === "completed" ? (
                          <Pill tone="paper">done</Pill>
                        ) : null}
                        {e.status === "cancelled" ? (
                          <Pill tone="rose">cancelled</Pill>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-paper">{e.title}</p>
                      {e.description ? (
                        <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-paper-dim">
                          {e.description}
                        </p>
                      ) : null}
                      {e.successMetric ? (
                        <p className="mt-2 font-mono text-[11px] text-paper-faint">
                          target: {e.successMetric}
                        </p>
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>
      ))}
    </Shell>
  );
}
