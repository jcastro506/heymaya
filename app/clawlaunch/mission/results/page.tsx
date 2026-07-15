"use client";

/**
 * Results — is it working? Signups, not likes.
 *
 * Leads with the North Star: attributed signups this week vs last. Then the
 * funnel (posts shipped → clicks → signups) per channel, then per-post
 * receipt cards with their numbers, the weekly strategic review, and the
 * patterns Maya has locked in. A small "log a win" affordance keeps the
 * attribution loop honest. No vanity metrics above the fold.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  ActionButton,
  BigStat,
  Card,
  Empty,
  Fold,
  Loading,
  NeedsOnboarding,
  Pill,
  Rise,
  Section,
  Shell,
  SourceChip,
  timeAgo,
} from "../_components";
import { platformLabel } from "../_DraftCard";
import { MediaLibrary } from "./_MediaLibrary";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/* ── Log a win — the founder self-report floor ─────────────────────────── */

function LogAWin() {
  const report = useMutation(api.gtmMaya.missionActions.reportMyConversion);
  const [kind, setKind] = useState<
    "signup" | "demo" | "revenue" | "activated" | "feedback"
  >("signup");
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  const submit = async () => {
    if (state === "busy") return;
    setState("busy");
    try {
      await report({ kind, count, note: note.trim() || undefined });
      setNote("");
      setCount(1);
      setState("done");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  return (
    <Card className="border-paper-faint/25">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint">
        Log a win
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          max={10000}
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
          className="w-16 rounded-lg border border-paper-faint/25 bg-transparent px-2.5 py-1.5 text-sm tabular-nums text-paper outline-none focus:border-lime/50"
          aria-label="How many"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="rounded-lg border border-paper-faint/25 bg-ink-2 px-2.5 py-1.5 text-sm text-paper outline-none focus:border-lime/50"
          aria-label="Kind of win"
        >
          <option value="signup">signups</option>
          <option value="demo">demos</option>
          <option value="revenue">paying customers</option>
          <option value="activated">came back</option>
          <option value="feedback">feedback</option>
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='where from? — "said they saw the Reddit post"'
          className="min-w-0 flex-1 rounded-lg border border-paper-faint/25 bg-transparent px-2.5 py-1.5 text-sm text-paper outline-none placeholder:text-paper-faint focus:border-lime/50"
        />
        <ActionButton onClick={() => void submit()} busy={state === "busy"}>
          Log it
        </ActionButton>
      </div>
      {state === "done" ? (
        <p className="mt-2 text-xs text-paper-dim">
          Logged — it counts toward the goal now.
        </p>
      ) : state === "error" ? (
        <p className="mt-2 text-xs text-rose">Didn&apos;t save — try again.</p>
      ) : null}
    </Card>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

const CONVERSION_LABEL: Record<string, string> = {
  signup: "signups",
  demo: "demos",
  feedback: "feedback",
  revenue: "revenue",
  activated: "came back",
};

const SOURCE_LABEL: Record<string, string> = {
  self_report: "you told Maya",
  pixel: "tracked",
};

/** Map a North-Star metric string to the conversion kind it counts. */
function metricToKind(metric: string): string {
  const m = metric.toLowerCase();
  if (m.includes("revenue") || m.includes("mrr") || m.includes("$")) return "revenue";
  if (m.includes("demo")) return "demo";
  if (m.includes("feedback") || m.includes("interview")) return "feedback";
  return "signup";
}

function formatDeadline(ms: number): string {
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ResultsPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const conversions = useQuery(api.gtmMaya.missionControl.getMyConversions);
  const learnings = useQuery(api.gtmMaya.missionControl.getMyNicheLearnings, {});
  const posts = useQuery(api.gtmMaya.postResults.getMyRecentPostResults, {});
  const attribution = useQuery(api.gtmMaya.missionControl.getMyPostAttribution, {});
  const weeklyReview = useQuery(api.gtmMaya.missionControl.getMyLatestWeeklyReview);

  if (
    snapshot === undefined ||
    conversions === undefined ||
    learnings === undefined ||
    posts === undefined ||
    attribution === undefined ||
    weeklyReview === undefined
  ) {
    return <Loading />;
  }
  if (snapshot === null) return <NeedsOnboarding />;

  const app = snapshot.app;
  const conversionRows = conversions ?? [];
  const learningRows = learnings ?? [];
  const postRows = posts ?? [];
  const attributionRows = [...(attribution ?? [])]
    .filter((a) => a.clicks > 0 || a.conversions > 0)
    .sort((a, b) => b.conversions - a.conversions || b.clicks - a.clicks);

  // ── The funnel, this week vs last ───────────────────────────────────────
  const now = Date.now();
  const inWindow = (t: number, weeksBack: number) =>
    t >= now - WEEK_MS * (weeksBack + 1) && t < now - WEEK_MS * weeksBack;
  const funnel = (weeksBack: number) => ({
    posts: (attribution ?? []).filter((a) => inWindow(a.createdAt, weeksBack)).length,
    clicks: (attribution ?? [])
      .filter((a) => inWindow(a.createdAt, weeksBack))
      .reduce((s, a) => s + a.clicks, 0),
    signups: conversionRows
      .filter(
        (c) =>
          inWindow(c.occurredAt, weeksBack) &&
          (c.kind === "signup" || c.kind === "activated" || c.kind === "revenue")
      )
      .reduce((s, c) => s + c.count, 0),
  });
  const thisWeek = funnel(0);
  const lastWeek = funnel(1);
  const delta = (cur: number, prev: number): string | undefined =>
    prev > 0 || cur > 0 ? `${cur >= prev ? "+" : ""}${cur - prev} vs last week` : undefined;

  const hasAnything =
    Boolean(app?.northStarMetric) ||
    conversionRows.length > 0 ||
    learningRows.length > 0 ||
    postRows.length > 0 ||
    attributionRows.length > 0 ||
    weeklyReview !== null;

  if (!hasAnything) {
    return (
      <Shell
        title="Results"
        subtitle="Signups, not likes. What's actually working, and whether we're on track for your goal."
      >
        <Rise>
          <Empty
            title="No results yet"
            body="Once you start posting and people start clicking and signing up, the numbers land here — and Maya re-weights the plan around what actually converts."
          />
        </Rise>
        <div className="mt-4">
          <LogAWin />
        </div>
      </Shell>
    );
  }

  // ── North Star ──────────────────────────────────────────────────────────
  const nsMetric = app?.northStarMetric;
  const nsTarget = app?.northStarTarget;
  const nsDeadline = app?.northStarDeadlineMs;
  const conversionsTotal = conversionRows.reduce((sum, c) => sum + c.count, 0);

  let northStar: {
    metric: string;
    target?: number;
    deadlineMs?: number;
    current: number;
    paceLine: string;
    paceTone: "lime" | "paper" | "rose";
    paceLabel: string;
  } | null = null;

  if (nsMetric) {
    const kind = metricToKind(nsMetric);
    const current = conversionRows
      .filter((c) => c.kind === kind)
      .reduce((sum, c) => sum + c.count, 0);

    let paceLine: string;
    let paceTone: "lime" | "paper" | "rose" = "paper";
    let paceLabel = "in progress";

    if (current === 0) {
      paceLine =
        "No confirmed wins yet — tell Maya in Telegram when someone converts, or log one below, and this starts moving.";
      paceLabel = "no data yet";
    } else if (nsTarget && nsTarget > 0) {
      const pct = current / nsTarget;
      if (current >= nsTarget) {
        paceLine = `Hit the goal — ${current} of ${nsTarget}. Time to set the next one with Maya.`;
        paceTone = "lime";
        paceLabel = "goal hit";
      } else if (nsDeadline) {
        const earliest = conversionRows.reduce(
          (min, c) => Math.min(min, c.occurredAt),
          Date.now()
        );
        const totalSpan = nsDeadline - earliest;
        const elapsed = now - earliest;
        const expectedPct =
          totalSpan > 0 ? Math.min(1, Math.max(0, elapsed / totalSpan)) : 1;
        if (now > nsDeadline) {
          paceLine = `Deadline passed (${formatDeadline(nsDeadline)}) at ${current} of ${nsTarget}. Worth resetting the target with Maya.`;
          paceTone = "rose";
          paceLabel = "deadline passed";
        } else if (pct >= expectedPct) {
          paceLine = `On track — ${current} of ${nsTarget} (${Math.round(pct * 100)}%) by ${formatDeadline(nsDeadline)}.`;
          paceTone = "lime";
          paceLabel = "on track";
        } else {
          paceLine = `Behind pace — ${current} of ${nsTarget} (${Math.round(pct * 100)}%) with ${formatDeadline(nsDeadline)} ahead. Maya is re-weighting toward what converts.`;
          paceTone = "rose";
          paceLabel = "at risk";
        }
      } else {
        paceLine = `${current} of ${nsTarget} (${Math.round(pct * 100)}%). No deadline set — ask Maya to put one on it for a real pace read.`;
        paceTone = pct >= 0.5 ? "lime" : "paper";
        paceLabel = "tracking";
      }
    } else {
      paceLine = `${current} so far. No target set — ask Maya for a number to aim at.`;
      paceLabel = "no target";
    }

    northStar = {
      metric: nsMetric,
      target: nsTarget,
      deadlineMs: nsDeadline,
      current,
      paceLine,
      paceTone,
      paceLabel,
    };
  }

  // ── Per-channel rollup ──────────────────────────────────────────────────
  const byChannel = new Map<string, { clicks: number; conversions: number }>();
  for (const a of attribution ?? []) {
    const key = a.platform ?? "unattributed";
    const cur = byChannel.get(key) ?? { clicks: 0, conversions: 0 };
    cur.clicks += a.clicks;
    cur.conversions += a.conversions;
    byChannel.set(key, cur);
  }
  const channelRows = [...byChannel.entries()]
    .filter(([, v]) => v.clicks > 0 || v.conversions > 0)
    .sort((a, b) => b[1].conversions - a[1].conversions || b[1].clicks - a[1].clicks);
  const maxClicks = Math.max(1, ...channelRows.map(([, v]) => v.clicks));

  return (
    <Shell
      title="Results"
      subtitle="Signups, not likes. What's actually working, and whether we're on track for your goal."
    >
      {/* ── The week in three numbers — signups lead ───────────────────── */}
      <Rise>
        <div className="mb-11 grid grid-cols-3 gap-x-6 border-y border-paper-faint/15 py-6">
          <BigStat
            label="Signups · 7d"
            value={thisWeek.signups}
            accent={thisWeek.signups > 0}
            hint={delta(thisWeek.signups, lastWeek.signups)}
          />
          <BigStat
            label="Clicks · 7d"
            value={thisWeek.clicks}
            hint={delta(thisWeek.clicks, lastWeek.clicks)}
          />
          <BigStat
            label="Posts tracked · 7d"
            value={thisWeek.posts}
            hint={delta(thisWeek.posts, lastWeek.posts)}
          />
        </div>
      </Rise>

      {/* ── North Star ─────────────────────────────────────────────────── */}
      <Section title="North Star">
        {northStar ? (
          <Rise>
            <Card className="border-lime/25">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-paper">
                  {northStar.metric}
                </p>
                <Pill tone={northStar.paceTone}>{northStar.paceLabel}</Pill>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-display text-4xl leading-none tabular-nums sm:text-5xl">
                  {northStar.current}
                </span>
                {northStar.target !== undefined ? (
                  <span className="font-display text-2xl leading-none text-paper-faint">
                    / {northStar.target}
                  </span>
                ) : null}
              </div>
              {northStar.deadlineMs !== undefined ? (
                <p className="mt-2 font-mono text-[11px] text-paper-faint">
                  by {formatDeadline(northStar.deadlineMs)}
                </p>
              ) : null}
              <p className="mt-3 text-sm leading-relaxed text-paper-dim">
                {northStar.paceLine}
              </p>
            </Card>
          </Rise>
        ) : (
          <Card>
            <p className="text-sm leading-relaxed text-paper-dim">
              No North Star set yet — a single number to aim at (usually signups)
              with a deadline. Ask Maya in Telegram to lock one in and this turns
              into a live pace tracker.
            </p>
          </Card>
        )}
      </Section>

      {/* ── By channel — where signups actually come from ──────────────── */}
      {channelRows.length > 0 ? (
        <Section title="By channel">
          <Rise>
            <Card>
              <ol className="space-y-3">
                {channelRows.map(([channel, v]) => (
                  <li key={channel} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate font-mono text-[11px] uppercase tracking-wide text-paper-dim">
                      {channel === "x" ? "X" : channel}
                    </span>
                    <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-paper/10">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-lime transition-[width] duration-700"
                        style={{ width: `${Math.round((v.clicks / maxClicks) * 100)}%` }}
                      />
                    </span>
                    <span className="w-32 shrink-0 text-right font-mono text-[11px] tabular-nums text-paper-dim">
                      {v.clicks} clicks
                      {v.conversions > 0 ? (
                        <span className="text-lime-soft"> · {v.conversions} signups</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] leading-relaxed text-paper-faint">
                This is the data Maya re-weights the week on — channels that convert
                get more of her time.
              </p>
            </Card>
          </Rise>
        </Section>
      ) : null}

      {/* ── Post receipts — every post, with its numbers ────────────────── */}
      <Section
        title="Post receipts"
        count={attributionRows.length + postRows.length}
      >
        {attributionRows.length === 0 && postRows.length === 0 ? (
          <Empty
            title="No receipts yet"
            body="Every post Maya puts out is tracked. Once they're live you'll see exactly which one drove the clicks and signups — and she doubles down on what converts."
          />
        ) : (
          <div className="space-y-3">
            {attributionRows.map((a, i) => (
              <Rise key={a.linkWrapId} i={i}>
                <Card>
                  <div className="flex flex-wrap items-center gap-2">
                    {a.platform ? (
                      <Pill tone="paper">{platformLabel(a.platform)}</Pill>
                    ) : null}
                    {a.conversions > 0 ? (
                      <Pill tone="lime">
                        {a.conversions} signup{a.conversions === 1 ? "" : "s"}
                      </Pill>
                    ) : null}
                    <span className="font-mono text-[11px] tabular-nums text-paper-faint">
                      {a.clicks} click{a.clicks === 1 ? "" : "s"}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-paper-faint">
                      {timeAgo(a.createdAt)}
                    </span>
                  </div>
                  {a.draftText ? (
                    <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-paper">
                      {a.draftText}
                    </p>
                  ) : null}
                  <div className="mt-2">
                    <SourceChip url={a.destinationUrl} label="where it points" />
                  </div>
                </Card>
              </Rise>
            ))}

            {postRows.map((p) => {
              const m = p.metrics ?? {};
              const stats: { label: string; value: number }[] = [];
              if (m.upvotes !== undefined) stats.push({ label: "upvotes", value: m.upvotes });
              if (m.likes !== undefined) stats.push({ label: "likes", value: m.likes });
              if (m.views !== undefined) stats.push({ label: "views", value: m.views });
              if (m.comments !== undefined)
                stats.push({ label: "comments", value: m.comments });
              if (m.shares !== undefined) stats.push({ label: "shares", value: m.shares });
              const shown = stats.slice(0, 3);
              return (
                <Card key={p._id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="paper">{platformLabel(p.platform)}</Pill>
                    {p.surfacedToOperator ? (
                      <Pill tone="lime">Maya flagged this</Pill>
                    ) : null}
                    <span className="ml-auto font-mono text-[11px] text-paper-faint">
                      checked {timeAgo(p.snapshotAtMs)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-paper-dim">
                    {shown.length > 0 ? (
                      shown.map((s) => (
                        <span key={s.label}>
                          {s.value} {s.label}
                        </span>
                      ))
                    ) : (
                      <span className="text-paper-faint">no numbers captured yet</span>
                    )}
                  </div>
                  {p.notes ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-paper-dim">{p.notes}</p>
                  ) : null}
                  {/^https?:\/\//.test(p.providerPostId) ? (
                    <div className="mt-2">
                      <SourceChip url={p.providerPostId} label="view the post" />
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Log a win ───────────────────────────────────────────────────── */}
      <Section title="Conversions" count={conversionsTotal}>
        <div className="space-y-3">
          <LogAWin />
          {conversionRows.length > 0 ? (
            <ol className="space-y-2">
              {conversionRows.map((c) => (
                <li key={c._id}>
                  <Card className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Pill tone={c.kind === "revenue" ? "lime" : "paper"}>
                          {CONVERSION_LABEL[c.kind] ?? c.kind}
                        </Pill>
                        <span className="font-display text-lg tabular-nums">{c.count}</span>
                        <span className="font-mono text-[11px] text-paper-faint">
                          {SOURCE_LABEL[c.source] ?? c.source}
                        </span>
                      </div>
                      {c.note ? (
                        <p className="mt-1 text-xs leading-relaxed text-paper-dim">
                          {c.note}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-paper-faint">
                      {timeAgo(c.occurredAt)}
                    </span>
                  </Card>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </Section>

      {/* ── Weekly strategic review ─────────────────────────────────────── */}
      <Section title="Strategic review">
        {weeklyReview === null ? (
          <Card>
            <p className="text-sm leading-relaxed text-paper-dim">
              Your first weekly review lands Sunday. Every week Maya steps back,
              reads what converted, and writes up the wins, the losses, and what
              she&apos;s changing next week — grounded in your real numbers, not
              vibes.
            </p>
          </Card>
        ) : (
          <Rise>
            <Card>
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-paper">
                  week of {weeklyReview.weekStartLocal}
                </p>
                <span className="shrink-0 font-mono text-[11px] text-paper-faint">
                  {timeAgo(weeklyReview.generatedAt)}
                </span>
              </div>
              {weeklyReview.markdown ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-paper-dim">
                  {weeklyReview.markdown}
                </p>
              ) : null}
              {weeklyReview.winsArray.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                    Wins
                  </p>
                  <ul className="space-y-1">
                    {weeklyReview.winsArray.map((w, i) => (
                      <li key={`win-${i}`} className="flex gap-2 text-sm leading-relaxed text-paper">
                        <span className="select-none text-lime">+</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {weeklyReview.lossesArray.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                    Losses
                  </p>
                  <ul className="space-y-1">
                    {weeklyReview.lossesArray.map((l, i) => (
                      <li key={`loss-${i}`} className="flex gap-2 text-sm leading-relaxed text-paper">
                        <span className="select-none text-rose">−</span>
                        <span>{l}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {weeklyReview.nextWeekRecommendations.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                    Next week
                  </p>
                  <ul className="space-y-1">
                    {weeklyReview.nextWeekRecommendations.map((r, i) => (
                      <li key={`next-${i}`} className="flex gap-2 text-sm leading-relaxed text-paper">
                        <span className="select-none text-paper-faint">→</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          </Rise>
        )}
      </Section>

      {/* ── What's working — the locked-in patterns ─────────────────────── */}
      {learningRows.length > 0 ? (
        <Section title="What's working" count={learningRows.length}>
          <ol className="space-y-2">
            {learningRows
              .slice()
              .sort((a, b) => b.confidenceScore - a.confidenceScore)
              .map((l) => (
                <li key={l._id}>
                  <Card>
                    <div className="flex items-center gap-2">
                      <Pill tone="lime">{l.learningKind.replace(/_/g, " ")}</Pill>
                      <span className="font-mono text-[11px] tabular-nums text-paper-faint">
                        {Math.round(l.confidenceScore * 100)}% confident
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-paper-faint">
                        {l.evidenceCount} {l.evidenceCount === 1 ? "signal" : "signals"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-paper">{l.learning}</p>
                  </Card>
                </li>
              ))}
          </ol>
        </Section>
      ) : null}

      {/* ── Media library — what she made, collapsed ────────────────────── */}
      <MediaLibrary />
    </Shell>
  );
}
