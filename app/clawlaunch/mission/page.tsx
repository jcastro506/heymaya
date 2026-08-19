"use client";

/**
 * Today — the 90-second clear.
 *
 *   NEEDS YOU   decision cards: drafts (Post it / Tweak / Pass), the plan
 *               when it's waiting, channel connects. Collapses to one proud
 *               line when nothing needs the operator.
 *   THE DAY     her schedule as a horizontal timeline — calendar events +
 *               the known cron blocks (7am brief / 1pm pulse / 8pm recap),
 *               with done / now / upcoming states.
 *   PULSE       posts out today, posts gaining speed, the next work block,
 *               and the last three moves as a ticker.
 *
 * All live Convex subscriptions — Maya's writes stream in as she works.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { TodayLive } from "./_TodayLive";
import { api } from "@/convex/_generated/api";
import {
  Chip,
  clock,
  Loading,
  NeedsOnboarding,
  Panel,
  Rise,
  Shell,
} from "./_components";
import { DraftCard } from "./_DraftCard";
import { PlanDecideCard } from "./_PlanCard";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_WINDOW_MS = 10 * 60 * 1000;

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function todayAt(hour: number): number {
  return startOfTodayMs() + hour * 60 * 60 * 1000;
}

/** "TUE JUL 15 · 9:41 AM" — client-only (avoids SSR hydration drift). */
function useWallClock(): string | null {
  const [s, setS] = useState<string | null>(null);
  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      const day = d
        .toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
        .toUpperCase()
        .replace(/,/g, "");
      setS(`${day} · ${clock(d.getTime())}`);
    };
    fmt();
    const t = setInterval(fmt, 30_000);
    return () => clearInterval(t);
  }, []);
  return s;
}

type Slot = {
  key: string;
  ms: number;
  time: string; // rendered label
  what: string;
  sub?: string;
  state: "done" | "now" | "upcoming";
};

const EVENT_DONE = new Set(["published", "completed"]);
const EVENT_SUB: Record<string, string> = {
  queued: "on deck",
  posting: "posting",
  published: "posted",
  completed: "done",
  needs_confirm: "your tap",
  failed: "didn't land",
};

export default function TodayPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  /**
   * ⚠️ v2. This read `gtmMaya.missionActions.getMyDraftQueue` — the FROZEN
   * product — while a v2 Maya wrote to `convex/maya/drafts`. See
   * docs/MISSION_CONTROL_V2_MIGRATION.md.
   */
  const draftQueue = useQuery(api.maya.drafts.myDraftQueue);
  const drafts = draftQueue?.drafts;
  const health = useQuery(api.gtmMaya.missionActions.getMyConnectionHealth);
  const connected = useQuery(api.gtmMaya.zernioConnect.getMyConnectedAccounts);
  const events = useQuery(api.gtmMaya.calendarWrite.getMyCalendarEvents);
  const planDoc = useQuery(api.gtmMaya.planDoc.getMyPlanDoc);
  const activity = useQuery(api.gtmMaya.missionControl.getMyAgentActivity, {
    limit: 5,
  });
  const postResults = useQuery(
    api.gtmMaya.postResults.getMyRecentPostResults,
    {},
  );

  const when = useWallClock();
  const todayStart = startOfTodayMs();
  const tomorrowStart = todayStart + DAY_MS;
  const now = Date.now();

  const todaysEvents = useMemo(
    () =>
      (events ?? [])
        .filter(
          (e) =>
            e.startsAtMs >= todayStart &&
            e.startsAtMs < tomorrowStart &&
            e.status !== "cancelled",
        )
        .sort((a, b) => a.startsAtMs - b.startsAtMs),
    [events, todayStart, tomorrowStart],
  );

  if (snapshot === undefined || draftQueue === undefined || events === undefined)
    return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  // ── Needs you ───────────────────────────────────────────────────────────
  /**
   * ⭐ No filtering or sorting here any more. `myDraftQueue` returns only
   * drafts that are pending AND unexpired, oldest first — an expired draft is
   * dead (publishing will not touch it) and showing it invites an approval that
   * silently does nothing.
   *
   * v1 filtered on three `approvalState` values here because the frozen table
   * modelled revision as a state; v2 records a tweak as a rejection carrying
   * the founder's reason, so there is one pending state and nothing to rank.
   */
  const decidable = drafts ?? [];
  const broken = (health ?? []).filter(
    (h) => h.status === "reconnect_required" || h.status === "error",
  );
  const planAwaiting = planDoc?.plan?.status === "proposed";
  const noChannels = connected !== undefined && (connected ?? []).length === 0;
  const needsYouCount =
    decidable.length +
    broken.length +
    (planAwaiting ? 1 : 0) +
    (noChannels ? 1 : 0);

  // ── The day she's running ───────────────────────────────────────────────
  const cronBlocks: Array<{ hour: number; what: string; sub: string }> = [
    { hour: 7, what: "Morning brief", sub: "threads + drafts" },
    { hour: 13, what: "Midday pulse", sub: "fresh-thread sweep" },
    { hour: 20, what: "Evening recap", sub: "skips if empty" },
  ];
  const slots: Slot[] = [
    ...cronBlocks.map((b) => {
      const ms = todayAt(b.hour);
      return {
        key: `cron-${b.hour}`,
        ms,
        time: clock(ms),
        what: b.what,
        sub: b.sub,
        state: (ms <= now ? "done" : "upcoming") as Slot["state"],
      };
    }),
    ...todaysEvents.map((e) => ({
      key: String(e._id),
      ms: e.startsAtMs,
      time: clock(e.startsAtMs),
      what: e.title,
      sub: e.status ? EVENT_SUB[e.status] : undefined,
      state: ((e.status && EVENT_DONE.has(e.status)) || e.startsAtMs <= now
        ? "done"
        : "upcoming") as Slot["state"],
    })),
  ];
  const latest = (activity ?? [])[0];
  if (latest && now - latest.createdAt < NOW_WINDOW_MS) {
    slots.push({
      key: "now",
      ms: now,
      time: "NOW",
      what: latest.summary,
      state: "now",
    });
  }
  slots.sort((a, b) => a.ms - b.ms);
  const nextSlot = slots.find((s) => s.state === "upcoming");

  // ── Pulse ───────────────────────────────────────────────────────────────
  /**
   * ⚠️ COUNTED FROM PLACEMENTS, NOT DRAFTS. v1 kept published rows in the same
   * table and filtered on `approvalState === "published"`. In v2 a draft is
   * inventory and a PLACEMENT is the proof — §2.6, the unit of work is
   * something live with a URL. `myDraftQueue` returns only what is still
   * pending, so counting published drafts there would always be zero.
   */
  const postsOutToday = (postResults ?? []).filter(
    (p) => p.snapshotAtMs >= todayStart,
  ).length;
  const gainingSpeed = new Set(
    (postResults ?? [])
      .filter((p) => p.snapshotAtMs >= todayStart && p.surfacedToOperator)
      .map((p) => String(p.draftId)),
  ).size;
  const ticker = (activity ?? []).slice(0, 3);

  return (
    <Shell title="Today" when={when}>
      {/* ⭐ The live module's Today. Renders only for a v2 customer; a
          gtm-only account sees exactly what it saw before. Placed first
          because for the accounts that have it, it is the only block on this
          page reading what she actually did. */}
      <TodayLive />
      <div className="mc-grid mc-today-grid">
        {/* ── Needs you ─────────────────────────────────────────────────── */}
        <Rise className="mc-a-needs">
          <Panel title="Needs you" raised className="h-full">
            {needsYouCount > 0 ? (
              <span className="mc-needcount">{needsYouCount}</span>
            ) : null}
            {needsYouCount === 0 ? (
              <p className="text-sm text-paper">
                Nothing needs you.
                {nextSlot ? (
                  <span className="text-paper-dim">
                    {" "}
                    Next: {nextSlot.what} · {nextSlot.time}.
                  </span>
                ) : null}
              </p>
            ) : (
              <div className="mc-action-row">
                {planAwaiting ? <PlanDecideCard /> : null}
                {noChannels ? (
                  <div className="mc-action">
                    <div className="mc-action-src">
                      <Chip>no channel connected</Chip>
                    </div>
                    <div className="mc-thread">Maya has nowhere to post.</div>
                    <div className="mc-acts">
                      <Link
                        href="/clawlaunch/mission/settings"
                        className="mc-btn mc-btn-primary flex-1 no-underline"
                      >
                        Connect a channel
                      </Link>
                    </div>
                  </div>
                ) : null}
                {broken.map((h) => (
                  <div key={h._id} className="mc-action">
                    <div className="mc-action-src">
                      <Chip platform={h.provider}>
                        {h.provider === "x" ? "X" : h.provider} · needs a
                        reconnect
                      </Chip>
                    </div>
                    {h.failureReason ? (
                      <div className="mc-draft">{h.failureReason}</div>
                    ) : null}
                    <div className="mc-acts">
                      <Link
                        href="/clawlaunch/mission/settings"
                        className="mc-btn flex-1 no-underline"
                      >
                        Fix
                      </Link>
                    </div>
                  </div>
                ))}
                {decidable.map((d) => (
                  <DraftCard key={d.id} d={d} />
                ))}
              </div>
            )}
          </Panel>
        </Rise>

        {/* ── Pulse ─────────────────────────────────────────────────────── */}
        <Rise i={1} className="mc-a-side">
          <Panel title="Pulse" live className="h-full">
            <div className="mc-ptiles">
              <div className="mc-ptile">
                <div className="v">{postsOutToday}</div>
                <div className="k">posts out today</div>
              </div>
              <div className="mc-ptile">
                <div
                  className="v"
                  style={
                    gainingSpeed > 0 ? { color: "var(--mc-good)" } : undefined
                  }
                >
                  {gainingSpeed}
                </div>
                <div className="k">gaining speed</div>
              </div>
            </div>
            <div className="mc-nextblock">
              <span className="k">next work block</span>
              <span className="v">
                {nextSlot
                  ? `${nextSlot.what} · ${nextSlot.time}`
                  : "tomorrow · 7:00 AM"}
              </span>
            </div>
            {ticker.length > 0 ? (
              <ul className="mc-tick">
                {ticker.map((a) => (
                  <li key={a._id}>
                    <span className="t">{clock(a.createdAt)}</span>
                    <span className="s">{a.summary}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        </Rise>

        {/* ── The day she's running ─────────────────────────────────────── */}
        <Rise i={2} className="mc-a-work">
          <Panel title="The day she's running">
            <div className="mc-timeline">
              {slots.map((s) => (
                <div
                  key={s.key}
                  className={`mc-tl-slot ${s.state === "now" ? "now" : s.state === "done" ? "done" : ""}`}
                >
                  <div className="mc-tl-time">{s.time}</div>
                  <div className="mc-tl-what">{s.what}</div>
                  {s.sub ? <div className="mc-tl-sub">{s.sub}</div> : null}
                </div>
              ))}
            </div>
          </Panel>
        </Rise>
      </div>
    </Shell>
  );
}
