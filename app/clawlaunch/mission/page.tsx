"use client";

/**
 * Today — the cockpit. Answers, in order, the founder's four questions:
 *   1. Is it working?      → the stat strip (this week's funnel numbers)
 *   2. Does she need me?   → "Needs you" tray (approvals, reconnects)
 *   3. Is she working?     → live session rollups (grouped, expandable)
 *   4. What's coming?      → today's plan rail + the standing-order box
 *
 * Design: typography-first. Numbers are big serif, labels are tracked
 * micro-caps, the accent appears only where the founder must look.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
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
  LiveDot,
  BigStat,
  ActionButton,
  groupIntoSessions,
  sessionSummary,
} from "./_components";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

/** Plain-language status line for the header — infra words never leak. */
function mayaStatusLine(lifecycleState: string | undefined, throttled: boolean): string {
  if (throttled) return "catching her breath — back on full duty soon";
  switch (lifecycleState) {
    case "fresh":
    case "researching":
      return "deep in research on your niche";
    case "plan_ready":
      return "plan ready — waiting on your go";
    case "active":
      return "on the clock";
    default:
      return "on the clock";
  }
}

function TellMaya() {
  const send = useMutation(api.gtmMaya.missionActions.sendMySteeringDirective);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  const submit = async () => {
    const directive = text.trim();
    if (!directive || state === "busy") return;
    setState("busy");
    try {
      await send({ directive });
      setText("");
      setState("sent");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  return (
    <Card className="border-paper-faint/25">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint">
        Standing order
      </p>
      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder='Steer her anytime — "go harder on Reddit", "stop mentioning pricing"…'
          className="min-h-[3.25rem] w-full resize-none bg-transparent text-sm leading-relaxed text-paper outline-none placeholder:text-paper-faint"
        />
        <ActionButton onClick={() => void submit()} busy={state === "busy"} disabled={!text.trim()}>
          Send
        </ActionButton>
      </div>
      {state === "sent" ? (
        <p className="mt-2 text-xs text-paper-dim">
          Got it — Maya folds this into everything she does from here.
        </p>
      ) : state === "error" ? (
        <p className="mt-2 text-xs text-[#b3261e]">Didn&apos;t save — try again.</p>
      ) : null}
    </Card>
  );
}

export default function TodayPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const activity = useQuery(api.gtmMaya.missionControl.getMyAgentActivity, {
    limit: 100,
  });
  const events = useQuery(api.gtmMaya.calendarWrite.getMyCalendarEvents);
  const queue = useQuery(api.gtmMaya.missionActions.getMyDraftQueue);
  const health = useQuery(api.gtmMaya.missionActions.getMyConnectionHealth);
  const attribution = useQuery(api.gtmMaya.missionControl.getMyPostAttribution, {});
  const conversions = useQuery(api.gtmMaya.missionControl.getMyConversions);
  const planDoc = useQuery(api.gtmMaya.planDoc.getMyPlanDoc);

  const sessions = useMemo(
    () => groupIntoSessions(activity ?? []),
    [activity]
  );
  const [openSession, setOpenSession] = useState<number | null>(0);

  if (snapshot === undefined || activity === undefined || events === undefined)
    return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const appName = snapshot.app?.name ?? "your app";
  const weekStart = Date.now() - WEEK_MS;

  // ── Stat strip: this week's funnel ──────────────────────────────────────
  const postedThisWeek = (queue ?? []).filter(
    (d) => d.approvalState === "published" && (d.publishedAt ?? d.updatedAt) >= weekStart
  ).length;
  const clicksThisWeek = (attribution ?? [])
    .filter((a) => a.createdAt >= weekStart)
    .reduce((s, a) => s + a.clicks, 0);
  const signupsThisWeek = (conversions ?? [])
    .filter((c) => c.occurredAt >= weekStart && (c.kind === "signup" || c.kind === "activated"))
    .reduce((s, c) => s + c.count, 0);

  // ── Needs-you tray ──────────────────────────────────────────────────────
  const awaitingApproval = (queue ?? []).filter(
    (d) => d.approvalState === "pending_approval"
  );
  const broken = (health ?? []).filter(
    (h) => h.status === "reconnect_required" || h.status === "error"
  );
  const planAwaiting = planDoc?.plan?.status === "proposed";
  const needsYouCount = awaitingApproval.length + broken.length + (planAwaiting ? 1 : 0);

  // ── Today's plan rail ───────────────────────────────────────────────────
  const todayStart = startOfTodayMs();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const todays = (events ?? [])
    .filter((e) => e.startsAtMs >= todayStart && e.startsAtMs < tomorrowStart)
    .sort((a, b) => a.startsAtMs - b.startsAtMs);

  const throttled =
    typeof snapshot.agent.spendThrottledUntil === "number" &&
    snapshot.agent.spendThrottledUntil > Date.now();

  return (
    <Shell
      title="Today"
      subtitle={`Maya, on ${appName}.`}
    >
      {/* Status line + stat strip — the first 3 seconds of the page. */}
      <div className="mb-10">
        <p className="flex items-center gap-2 text-sm text-paper-dim">
          <LiveDot />
          <span>
            Maya is {mayaStatusLine(snapshot.agent.lifecycleState, throttled)}.
          </span>
        </p>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 border-y border-paper-faint/15 py-6 sm:grid-cols-4">
          <BigStat label="Posted · 7d" value={postedThisWeek} />
          <BigStat label="Clicks · 7d" value={clicksThisWeek} />
          <BigStat
            label="Signups · 7d"
            value={signupsThisWeek}
            accent={signupsThisWeek > 0}
          />
          <BigStat
            label="Waiting on you"
            value={needsYouCount}
            accent={needsYouCount > 0}
            hint={needsYouCount === 0 ? "all clear" : undefined}
          />
        </div>
      </div>

      {/* Needs-you tray — only exists when something actually needs them. */}
      {needsYouCount > 0 ? (
        <Section title="Needs you" count={needsYouCount}>
          <div className="space-y-2">
            {planAwaiting ? (
              <Card className="flex items-center justify-between gap-4 border-l-2 border-l-lime">
                <div className="min-w-0">
                  <p className="text-sm text-paper">
                    Her plan for your product is ready (v{planDoc?.plan?.version})
                  </p>
                  <p className="mt-0.5 text-xs text-paper-dim">
                    Read it, push back in Telegram, or approve — nothing runs until you do.
                  </p>
                </div>
                <Link
                  href="/clawlaunch/mission/brain"
                  className="shrink-0 rounded-full bg-paper px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:opacity-85"
                >
                  Review
                </Link>
              </Card>
            ) : null}
            {awaitingApproval.length > 0 ? (
              <Card className="flex items-center justify-between gap-4 border-l-2 border-l-lime">
                <div className="min-w-0">
                  <p className="text-sm text-paper">
                    {awaitingApproval.length}{" "}
                    {awaitingApproval.length === 1 ? "draft" : "drafts"} waiting for
                    your OK
                  </p>
                  <p className="mt-0.5 truncate text-xs text-paper-dim">
                    {awaitingApproval[0]?.draftText?.slice(0, 90)}…
                  </p>
                </div>
                <Link
                  href="/clawlaunch/mission/queue"
                  className="shrink-0 rounded-full bg-paper px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:opacity-85"
                >
                  Review
                </Link>
              </Card>
            ) : null}
            {broken.map((h) => (
              <Card
                key={h._id}
                className="flex items-center justify-between gap-4 border-l-2 border-l-rose"
              >
                <p className="text-sm text-paper">
                  Your {h.provider === "x" ? "X" : h.provider} connection needs a
                  reconnect{h.failureReason ? ` — ${h.failureReason}` : ""}.
                </p>
                <Link
                  href="/clawlaunch/mission/account"
                  className="shrink-0 rounded-full border border-paper-faint/25 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim hover:text-paper"
                >
                  Fix
                </Link>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Live work — session rollups instead of a raw feed. */}
      <Section title="What she's been doing" count={activity.length}>
        {sessions.length === 0 ? (
          <Empty
            title="Warming up"
            body="Maya just came online. As she researches, drafts, and adjusts the plan, her work streams in here live."
          />
        ) : (
          <ol className="space-y-2">
            {sessions.slice(0, 8).map((s, i) => {
              const open = openSession === i;
              const isLive = i === 0 && Date.now() - s.endMs < 10 * 60 * 1000;
              return (
                <li key={s.endMs}>
                  <Card className="p-0">
                    <button
                      type="button"
                      onClick={() => setOpenSession(open ? null : i)}
                      className="flex w-full items-baseline justify-between gap-4 px-4 py-3 text-left"
                    >
                      <span className="flex min-w-0 items-baseline gap-2.5">
                        {isLive ? <LiveDot className="translate-y-[-1px]" /> : null}
                        <span className="truncate text-sm text-paper">
                          {s.rows[0]?.summary}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-paper-faint">
                        {sessionSummary(s.counts)} · {timeAgo(s.endMs)}
                      </span>
                    </button>
                    {open ? (
                      <ol className="space-y-2 border-t border-paper-faint/10 px-4 py-3">
                        {s.rows.map((a) => (
                          <li key={a._id} className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Pill tone={ACTIVITY_TONE[a.kind] ?? "paper"}>
                                  {a.kind.replace("_", " ")}
                                </Pill>
                                <span className="text-sm text-paper">{a.summary}</span>
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
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {/* Today's plan rail. */}
      <Section title="On deck today" count={todays.length}>
        {todays.length === 0 ? (
          <Empty
            title="Nothing scheduled for today yet"
            body="Once the week's plan is set, today's posts and reply windows show up here — what auto-posts, and the few that need your tap."
          />
        ) : (
          <ol className="space-y-2">
            {todays.map((e) => (
              <li key={e._id}>
                <Card className="flex items-baseline gap-3">
                  <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-paper-faint">
                    {new Date(e.startsAtMs).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-paper">{e.title}</p>
                    {e.description ? (
                      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-paper-dim">
                        {e.description}
                      </p>
                    ) : null}
                  </div>
                  {e.status === "completed" || e.status === "published" ? (
                    <span className="ml-auto shrink-0">
                      <Pill tone="lime">done</Pill>
                    </span>
                  ) : e.status === "needs_confirm" ? (
                    <span className="ml-auto shrink-0">
                      <Pill tone="lime">needs your tap</Pill>
                    </span>
                  ) : e.status === "failed" || e.status === "cancelled" ? (
                    <span className="ml-auto shrink-0">
                      <Pill tone="rose">{e.status}</Pill>
                    </span>
                  ) : null}
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* Rest of the week — the old Plan tab, collapsed under Today. */}
      <RestOfWeek events={events ?? []} tomorrowStart={tomorrowStart} />

      {/* Standing order — steer her without opening Telegram. */}
      <TellMaya />
    </Shell>
  );
}

function RestOfWeek({
  events,
  tomorrowStart,
}: {
  events: Array<{
    _id: string;
    startsAtMs: number;
    title: string;
    description?: string;
    status?: string;
  }>;
  tomorrowStart: number;
}) {
  const weekEnd = tomorrowStart + 6 * 24 * 60 * 60 * 1000;
  const upcoming = events
    .filter((e) => e.startsAtMs >= tomorrowStart && e.startsAtMs < weekEnd)
    .sort((a, b) => a.startsAtMs - b.startsAtMs);
  if (upcoming.length === 0) return null;

  const byDay = new Map<string, typeof upcoming>();
  for (const e of upcoming) {
    const d = new Date(e.startsAtMs);
    const key = d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }

  return (
    <details className="group mb-10 border-t border-paper-faint/15 pt-5">
      <summary className="flex cursor-pointer select-none items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-paper-faint transition-colors hover:text-paper">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span>
        Rest of the week · {upcoming.length}
      </summary>
      <div className="mt-5 space-y-6">
        {[...byDay.entries()].map(([day, list]) => (
          <div key={day}>
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
              {day}
            </p>
            <ol className="space-y-2">
              {list.map((e) => (
                <li key={e._id}>
                  <Card className="flex items-baseline gap-3">
                    <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-paper-faint">
                      {new Date(e.startsAtMs).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-paper">{e.title}</p>
                      {e.description ? (
                        <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-paper-dim">
                          {e.description}
                        </p>
                      ) : null}
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </details>
  );
}
