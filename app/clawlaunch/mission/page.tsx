"use client";

/**
 * Today — the action inbox, not a dashboard. One question: does Maya need me?
 *
 *   TOP    "Needs you"      — one-tap decisions: plan approval, drafts
 *                             (approve / tweak / pass), channel connects.
 *   MIDDLE "Maya's working" — today's queue: scheduled posts, threads in
 *                             play, approved drafts waiting for their window.
 *   BOTTOM one-line pulse   — this week in one grounded sentence.
 *
 * Everything is a live Convex subscription — Maya's writes stream in as she
 * works. The empty state is a feature: nothing needing you means she's got it.
 */

import { useMemo, type CSSProperties } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Card,
  clock,
  Empty,
  ExtLink,
  LiveDot,
  Loading,
  NeedsOnboarding,
  Pill,
  Rise,
  Section,
  Shell,
} from "./_components";
import { DraftCard, platformLabel } from "./_DraftCard";
import { PlanDecideCard } from "./_PlanCard";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Plain-language status line — infra words never leak. */
function mayaStatusLine(lifecycleState: string | undefined, throttled: boolean): string {
  if (throttled) return "catching her breath — back on full duty soon";
  switch (lifecycleState) {
    case "fresh":
    case "researching":
      return "deep in research on your niche";
    case "plan_ready":
      return "plan ready — waiting on your go";
    default:
      return "on the clock";
  }
}

const EVENT_STATUS_PILL: Record<string, { label: string; tone: "lime" | "paper" | "rose" }> = {
  queued: { label: "on deck", tone: "paper" },
  posting: { label: "posting", tone: "lime" },
  published: { label: "done", tone: "lime" },
  completed: { label: "done", tone: "lime" },
  needs_confirm: { label: "your tap, in Telegram", tone: "lime" },
  failed: { label: "didn't land", tone: "rose" },
  cancelled: { label: "called off", tone: "paper" },
};

export default function TodayPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const drafts = useQuery(api.gtmMaya.missionActions.getMyDraftQueue);
  const health = useQuery(api.gtmMaya.missionActions.getMyConnectionHealth);
  const connected = useQuery(api.gtmMaya.zernioConnect.getMyConnectedAccounts);
  const events = useQuery(api.gtmMaya.calendarWrite.getMyCalendarEvents);
  const threads = useQuery(api.gtmMaya.targetList.getMyTargetThreads, {});
  const planDoc = useQuery(api.gtmMaya.planDoc.getMyPlanDoc);
  const attribution = useQuery(api.gtmMaya.missionControl.getMyPostAttribution, {});
  const conversions = useQuery(api.gtmMaya.missionControl.getMyConversions);

  const todayStart = startOfTodayMs();
  const tomorrowStart = todayStart + DAY_MS;

  const todaysEvents = useMemo(
    () =>
      (events ?? [])
        .filter((e) => e.startsAtMs >= todayStart && e.startsAtMs < tomorrowStart)
        .sort((a, b) => a.startsAtMs - b.startsAtMs),
    [events, todayStart, tomorrowStart]
  );

  const watchlist = useMemo(
    () =>
      (threads ?? [])
        .filter((t) => t.status === "queued")
        .sort((a, b) => {
          const tier = (t: { tier?: string }) =>
            t.tier === "T1" ? 0 : t.tier === "T2" ? 1 : 2;
          return tier(a) - tier(b) || b.createdAt - a.createdAt;
        })
        .slice(0, 6),
    [threads]
  );

  if (snapshot === undefined || drafts === undefined || events === undefined)
    return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const appName = snapshot.app?.name ?? "your product";
  const throttled =
    typeof snapshot.agent.spendThrottledUntil === "number" &&
    snapshot.agent.spendThrottledUntil > Date.now();

  // ── Needs-you tray ──────────────────────────────────────────────────────
  const decidable = (drafts ?? [])
    .filter(
      (d) =>
        d.approvalState === "pending_approval" ||
        d.approvalState === "draft" ||
        d.approvalState === "needs_revision"
    )
    .sort((a, b) => {
      const rank = (s: string) =>
        s === "pending_approval" ? 0 : s === "needs_revision" ? 1 : 2;
      return rank(a.approvalState) - rank(b.approvalState) || b.createdAt - a.createdAt;
    });
  const broken = (health ?? []).filter(
    (h) => h.status === "reconnect_required" || h.status === "error"
  );
  const planAwaiting = planDoc?.plan?.status === "proposed";
  const noChannels = connected !== undefined && (connected ?? []).length === 0;
  const needsYouCount =
    decidable.length + broken.length + (planAwaiting ? 1 : 0) + (noChannels ? 1 : 0);

  // ── Working list ────────────────────────────────────────────────────────
  const approvedWaiting = (drafts ?? []).filter((d) => d.approvalState === "approved");
  const workingCount = todaysEvents.length + watchlist.length + approvedWaiting.length;

  // ── Pulse ───────────────────────────────────────────────────────────────
  const weekStart = Date.now() - WEEK_MS;
  const postedThisWeek = (drafts ?? []).filter(
    (d) => d.approvalState === "published" && (d.publishedAt ?? d.updatedAt) >= weekStart
  ).length;
  const clicksThisWeek = (attribution ?? [])
    .filter((a) => a.createdAt >= weekStart)
    .reduce((s, a) => s + a.clicks, 0);
  const signupsThisWeek = (conversions ?? [])
    .filter(
      (c) => c.occurredAt >= weekStart && (c.kind === "signup" || c.kind === "activated")
    )
    .reduce((s, c) => s + c.count, 0);

  const pulse =
    postedThisWeek > 0
      ? `${postedThisWeek} post${postedThisWeek === 1 ? "" : "s"} out this week · ${clicksThisWeek} click${clicksThisWeek === 1 ? "" : "s"}${
          signupsThisWeek > 0
            ? ` · ${signupsThisWeek} signup${signupsThisWeek === 1 ? "" : "s"}`
            : ""
        }`
      : null;

  // What's next — for the proud empty state.
  const nextEvent = (events ?? [])
    .filter((e) => e.startsAtMs > Date.now() && e.status !== "cancelled")
    .sort((a, b) => a.startsAtMs - b.startsAtMs)[0];
  const nextLine = nextEvent
    ? `Next: ${nextEvent.title} at ${clock(nextEvent.startsAtMs)}${
        nextEvent.startsAtMs >= tomorrowStart ? " tomorrow" : ""
      }.`
    : "Next: tomorrow's 7am brief.";

  return (
    <Shell
      title="Today"
      status={
        <>
          <LiveDot />
          <span>
            Maya is {mayaStatusLine(snapshot.agent.lifecycleState, throttled)} for{" "}
            {appName}.
          </span>
        </>
      }
    >
      {/* ── Needs you ─────────────────────────────────────────────────── */}
      <Section title="Needs you" count={needsYouCount}>
        {needsYouCount === 0 ? (
          <Rise>
            <Empty title="Nothing needs you." body={nextLine} />
          </Rise>
        ) : (
          <div className="space-y-3">
            {planAwaiting ? (
              <Rise i={0}>
                <PlanDecideCard />
              </Rise>
            ) : null}
            {noChannels ? (
              <Rise i={planAwaiting ? 1 : 0}>
                <Card className="flex items-center justify-between gap-4 border-l-2 border-l-lime">
                  <div className="min-w-0">
                    <p className="text-sm text-paper">No channels connected yet</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-paper-dim">
                      Link at least one — X, LinkedIn, Reddit — and Maya can start
                      putting work out.
                    </p>
                  </div>
                  <Link
                    href="/clawlaunch/mission/settings"
                    className="shrink-0 rounded-full bg-lime px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink transition-opacity hover:opacity-85"
                  >
                    Connect
                  </Link>
                </Card>
              </Rise>
            ) : null}
            {broken.map((h, i) => (
              <Rise key={h._id} i={i + 1}>
                <Card className="flex items-center justify-between gap-4 border-l-2 border-l-rose">
                  <p className="min-w-0 text-sm text-paper">
                    Your {h.provider === "x" ? "X" : h.provider} connection needs a
                    reconnect{h.failureReason ? ` — ${h.failureReason}` : ""}.
                  </p>
                  <Link
                    href="/clawlaunch/mission/settings"
                    className="shrink-0 rounded-full border border-paper-faint/25 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim transition-colors hover:text-paper"
                  >
                    Fix
                  </Link>
                </Card>
              </Rise>
            ))}
            {decidable.map((d, i) => (
              <Rise key={d._id} i={i + 2}>
                <DraftCard d={d} />
              </Rise>
            ))}
          </div>
        )}
      </Section>

      {/* ── Maya's working ────────────────────────────────────────────── */}
      <Section title="Maya's working" count={workingCount}>
        {workingCount === 0 ? (
          <Rise>
            <Empty
              title="Quiet right now"
              body="She's between working sessions. Scheduled posts and the conversations she's tracking show up here as she lines them up."
            />
          </Rise>
        ) : (
          <div className="space-y-3">
            {todaysEvents.length > 0 ? (
              <ol className="space-y-2">
                {todaysEvents.map((e, i) => {
                  const pill = e.status ? EVENT_STATUS_PILL[e.status] : undefined;
                  return (
                    <li
                      key={e._id}
                      className="mc-rise"
                      style={{ "--i": i } as CSSProperties}
                    >
                      <Card className="flex items-baseline gap-3">
                          <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-paper-faint">
                            {clock(e.startsAtMs)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-paper">{e.title}</p>
                            {e.description ? (
                              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-paper-dim">
                                {e.description}
                              </p>
                            ) : null}
                          </div>
                        {pill ? (
                          <span className="shrink-0">
                            <Pill tone={pill.tone}>{pill.label}</Pill>
                          </span>
                        ) : null}
                      </Card>
                    </li>
                  );
                })}
              </ol>
            ) : null}

            {approvedWaiting.length > 0 ? (
              <Rise i={todaysEvents.length}>
                <Card className="flex items-center gap-3">
                  <Pill tone="lime">approved</Pill>
                  <p className="text-sm text-paper-dim">
                    {approvedWaiting.length}{" "}
                    {approvedWaiting.length === 1 ? "piece" : "pieces"} you approved,
                    waiting for the right posting window.
                  </p>
                </Card>
              </Rise>
            ) : null}

            {watchlist.length > 0 ? (
              <Rise i={todaysEvents.length + 1}>
                <Card>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint">
                    Conversations she&apos;s tracking
                  </p>
                  <ol className="mt-3 space-y-2.5">
                    {watchlist.map((t) => (
                      <li key={t._id} className="flex items-start gap-2.5">
                        <Pill tone={t.tier === "T1" ? "lime" : "paper"}>
                          {t.tier === "T1" ? "buying intent" : platformLabel(t.platform)}
                        </Pill>
                        <p className="min-w-0 flex-1 truncate text-sm text-paper">
                          {t.title ?? t.excerpt?.slice(0, 90) ?? t.url}
                        </p>
                        <span className="shrink-0 text-xs">
                          <ExtLink href={t.url}>open ↗</ExtLink>
                        </span>
                      </li>
                    ))}
                  </ol>
                </Card>
              </Rise>
            ) : null}
          </div>
        )}
      </Section>

      {/* ── Pulse ─────────────────────────────────────────────────────── */}
      <Rise i={2}>
        <div className="flex items-center justify-between gap-4 border-t border-paper-faint/15 pt-5">
          <p className="font-mono text-[11px] tabular-nums text-paper-dim">
            {pulse ?? "First posts land once the plan is approved and a channel is connected."}
          </p>
          {pulse ? (
            <Link
              href="/clawlaunch/mission/results"
              className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint transition-colors hover:text-lime-soft"
            >
              Results →
            </Link>
          ) : null}
        </div>
      </Rise>
    </Shell>
  );
}
