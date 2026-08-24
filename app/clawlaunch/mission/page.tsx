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
  channelLabel,
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
  /**
   * ⚠️ v2. Today used `getMyGtmSnapshot` for ONE THING — an onboarding gate —
   * and it came from the frozen product, so a founder fully set up on v2 could
   * be told to onboard. `myState` answers the same question from the live
   * tables: is there a customer at all.
   */
  const setup = useQuery(api.maya.setup.myState, {});
  /**
   * ⚠️ v2. This read `gtmMaya.missionActions.getMyDraftQueue` — the FROZEN
   * product — while a v2 Maya wrote to `convex/maya/drafts`. See
   * docs/MISSION_CONTROL_V2_MIGRATION.md.
   */
  const draftQueue = useQuery(api.maya.drafts.myDraftQueue);
  const drafts = draftQueue?.drafts;
  /**
   * ⭐ TWO v1 QUERIES BECOME ONE. `getMyConnectionHealth` and
   * `getMyConnectedAccounts` asked the same table two questions; `myChannels`
   * returns every channel with its state, so "which are broken" and "how many
   * are connected" are both derivations of one read rather than two round trips
   * that can disagree.
   */
  const myChannels = useQuery(api.maya.channels.myChannels);
  const channels = myChannels?.channels;
  const events = useQuery(api.gtmMaya.calendarWrite.getMyCalendarEvents);
  const planDoc = useQuery(api.gtmMaya.planDoc.getMyPlanDoc);
  /**
   * ⚠️ v2 activity IS THE PLACEMENT LEDGER, not a log of what she did. §2.6 —
   * the unit of work is something live with a URL — so an entry here is a post
   * a stranger could have seen, never "started a sweep". Narrower and truer:
   * v1's feed could report activity on a day nothing shipped.
   */
  const activityQ = useQuery(api.maya.archive.myActivity, { limit: 5 });
  const research = useQuery(api.maya.dashboard.myResearch, {});
  const work = useQuery(api.maya.activityFeed.myWork, {});
  const activity = activityQ?.entries;
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

  if (setup === undefined || draftQueue === undefined || events === undefined)
    return <Loading />;
  if (!setup?.customerId) return <NeedsOnboarding />;

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
  /**
   * ⚠️ `needs_attention` covers what v1 split across `reconnect_required` and
   * `error`. The distinction was about WHY a grant died; the founder's action
   * is identical either way, and `myChannels.reason` already carries the why in
   * her words.
   */
  const broken = (channels ?? []).filter((c) => c.state === "needs_attention");
  /**
   * ⚠️ STILL v1, AND IT NEEDS A FEATURE THAT DOES NOT EXIST. v2 has
   * `strategy.planScreen`, but it carries targeting and a changelog — there is
   * no proposed/approved state, because weekly plan approval is
   * `pick-the-week`'s territory and that skill has not shipped. Swapping the
   * query would silently drop the card; leaving it reads a frozen table.
   * Recorded rather than guessed at — see docs/MISSION_CONTROL_V2_MIGRATION.md.
   */
  const planAwaiting = planDoc?.plan?.status === "proposed";
  const noChannels =
    channels !== undefined &&
    channels.filter((c) => c.state === "connected").length === 0;
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
  if (latest && now - latest.publishedAt < NOW_WINDOW_MS) {
    slots.push({
      key: "now",
      ms: now,
      time: "NOW",
      what: latest.text,
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
                {/**
                  * ⚠️ The `provider === "x" ? "X" : provider` special case went
                  * with the channel (2026-08-18). `channelLabel` handles the
                  * three we ship, so a per-channel conditional in the markup is
                  * exactly the branch CONVENTIONS.md forbids.
                  */}
                {broken.map((c) => (
                  <div key={c.channel} className="mc-action">
                    <div className="mc-action-src">
                      <Chip platform={c.channel}>
                        {channelLabel(c.channel)} · needs a reconnect
                      </Chip>
                    </div>
                    {/**
                      * ⚠️ HER WORDS, NOT A SCOPE NAME. `reason` is written for
                      * the founder — v1's `failureReason` sometimes carried a
                      * raw provider string, which is the leak §11 forbids.
                      */}
                    {c.reason ? <div className="mc-draft">{c.reason}</div> : null}
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
                  <li key={String(a.placementId)}>
                    <span className="t">{clock(a.publishedAt)}</span>
                    <span className="s">{a.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        </Rise>

        {/**
          * ⭐ WHAT SHE'S LEARNED — the homework, which IS the work on day four.
          *
          * ⚠️ Audited on a live account: 51 ideas, 72 observations, 12
          * competitor ads with their structure recorded, a verified niche
          * vocabulary and ranked buyer complaints — and this screen showed an
          * empty room, because every panel asked a question that only has an
          * answer after something is live.
          *
          * The founder's own words were "Results is empty, Videos have nothing,
          * Today is useless." All three true, all three the wrong question.
          */}
        {/**
          * ⭐ WHAT SHE DID — from the spend ledger, which cannot be padded.
          *
          * ⚠️ 111 cost events read by nothing. The founder's only signal about
          * whether she was working was a watchdog announcing that nothing had
          * gone out, and their question was literally "so are you still doing
          * stuff or".
          */}
        <Rise i={2} className="mc-a-did">
          <Panel title="What she's been doing">
            {!work ? null : !work.ok || work.days.length === 0 ? (
              <p className="text-sm text-paper-faint">
                Nothing logged yet — this fills as she works.
              </p>
            ) : (
              <div className="mc-did">
                {work.days.slice(0, 4).map((d) => (
                  <div key={d.day} className="mc-did-day">
                    <div className="mc-did-date">
                      {d.day}
                      <span className="mc-did-total">{d.total}</span>
                    </div>
                    <ul>
                      {d.items.slice(0, 5).map((it) => (
                        <li key={it.what}>
                          <span className="n">{it.times}×</span>
                          {it.what}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </Rise>

        <Rise i={3} className="mc-a-learn">
          <Panel title="What she's learned">
            {/* ⚠️ Null AND undefined: undefined is loading, null is a query
                that resolved to nothing. Checking only one renders a crash. */}
            {!research ? null : !research.ok ? (
              <p className="text-sm text-paper-faint">Sign in to see this.</p>
            ) : (
              <>
                <div className="mc-learn-counts">
                  <div>
                    <div className="v">{research.counts.ideas}</div>
                    <div className="k">ideas banked</div>
                  </div>
                  <div>
                    <div className="v">{research.counts.posts}</div>
                    <div className="k">posts read</div>
                  </div>
                  <div>
                    <div className="v">{research.counts.ads}</div>
                    <div className="k">competitor ads</div>
                  </div>
                  <div>
                    <div className="v">{research.watching}</div>
                    <div className="k">accounts watched</div>
                  </div>
                </div>

                {research.ads.length > 0 ? (
                  <>
                    <div className="mc-learn-sub">
                      Ads their competitors keep paying to run
                    </div>
                    {research.ads.slice(0, 4).map((ad) => (
                      <div key={ad.url} className="mc-ad">
                        <div className="mc-ad-top">
                          {/* The number first — it is the whole argument. */}
                          <span className="mc-ad-days">
                            {ad.daysRunning}d live
                          </span>
                          <span className="mc-ad-who">{ad.advertiser}</span>
                          {ad.isVideo ? (
                            <span className="mc-chip">video</span>
                          ) : null}
                          {ad.url ? (
                            <a
                              href={ad.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mc-chip no-underline"
                            >
                              watch it
                            </a>
                          ) : null}
                        </div>
                        {ad.hook ? (
                          <div className="mc-ad-hook">{ad.hook}</div>
                        ) : null}
                        {/* Only present once she has actually watched it. */}
                        {ad.borrowable ? (
                          <div className="mc-ad-steal">{ad.borrowable}</div>
                        ) : null}
                      </div>
                    ))}
                  </>
                ) : null}

                {research.complaints.length > 0 ? (
                  <>
                    <div className="mc-learn-sub">
                      What their buyers keep complaining about
                    </div>
                    {research.complaints.map((c) => (
                      <div key={c} className="mc-ad-hook">
                        {c}
                      </div>
                    ))}
                  </>
                ) : null}

                {research.niche.length > 0 ? (
                  <>
                    <div className="mc-learn-sub">
                      The words their buyers actually use
                    </div>
                    <div className="mc-chips">
                      {research.niche.map((k) => (
                        <span key={k} className="mc-chip">
                          {k}
                        </span>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            )}
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
