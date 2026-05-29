"use client";

/**
 * Today — the daily pulse. Two showpiece sections:
 *  1. "What ClawLaunch is doing now" — the LIVE agent-activity feed
 *     (gtmAgentActivity, subscribed). OpenClaw POSTs as it works → this updates
 *     in real time. This is the autonomous-update mechanism made visible.
 *  2. "Today" — the calendar events due today (the posting + replying mix),
 *     each with its one-tap deep link.
 */

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
} from "./_components";

const ACTIVITY_TONE: Record<string, "lime" | "paper" | "rose"> = {
  found: "lime",
  drafted: "lime",
  plan_changed: "lime",
  posted: "lime",
  researching: "paper",
  thinking: "paper",
  status: "paper",
};

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function TodayPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const activity = useQuery(api.gtmMaya.missionControl.getMyAgentActivity, {
    limit: 40,
  });
  const events = useQuery(api.gtmMaya.calendarWrite.getMyCalendarEvents);

  if (snapshot === undefined || activity === undefined || events === undefined)
    return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const appName = snapshot.app?.name ?? "your app";
  const todayStart = startOfTodayMs();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const todays = (events ?? [])
    .filter((e) => e.startsAtMs >= todayStart && e.startsAtMs < tomorrowStart)
    .sort((a, b) => a.startsAtMs - b.startsAtMs);

  return (
    <Shell
      title="Today"
      subtitle={`What your manager is doing for ${appName} right now, and what's on deck today. Everything also lands in your Telegram + Google Calendar.`}
    >
      <Section title="What ClawLaunch is doing now" count={activity?.length}>
        {!activity || activity.length === 0 ? (
          <Empty
            title="Warming up"
            body="Your manager just came online. As she researches, drafts, and adjusts the plan, you'll see it stream in here live."
          />
        ) : (
          <ol className="space-y-2">
            {activity.map((a) => (
              <li key={a._id}>
                <Card className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Pill tone={ACTIVITY_TONE[a.kind] ?? "paper"}>{a.kind}</Pill>
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
        )}
      </Section>

      <Section title="On deck today" count={todays.length}>
        {todays.length === 0 ? (
          <Empty
            title="Nothing scheduled for today yet"
            body="Once your week's plan is approved, today's posts and replies show up here — each with a one-tap link to do it."
          />
        ) : (
          <ol className="space-y-2">
            {todays.map((e) => (
              <li key={e._id}>
                <Card>
                  <div className="flex items-center gap-2">
                    <Pill tone="paper">{e.kind}</Pill>
                    <span className="font-mono text-[11px] text-paper-faint">
                      {new Date(e.startsAtMs).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    {e.status === "scheduled" ? (
                      <Pill tone="lime">on calendar</Pill>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-paper">{e.title}</p>
                  {e.description ? (
                    <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-paper-dim">
                      {e.description}
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </Shell>
  );
}
