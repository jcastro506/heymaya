"use client";

/**
 * Results — the outcomes view. Signups, not likes.
 *
 * Four sections:
 *  1. North Star — the goal set at synthesis (metric + target + deadline),
 *     measured against the current confirmed count (sum of matching
 *     conversions). On-track / at-risk judged honestly against pace. If no
 *     conversions are confirmed yet, we say so plainly and point the operator
 *     back to Telegram.
 *  2. Conversions — the outcome ledger (signup / demo / feedback / revenue).
 *  3. What's working — niche learnings, each with its kind + confidence.
 *  4. Recent posts — post-metric snapshots (platform + a couple metrics +
 *     when), so the operator sees reach without mistaking it for the goal.
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
} from "../_components";

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

/** Map a North-Star metric string to the conversion kind it most likely
 *  counts. Defaults to signups — the canonical goal. */
function metricToKind(metric: string): string {
  const m = metric.toLowerCase();
  if (m.includes("revenue") || m.includes("mrr") || m.includes("$")) {
    return "revenue";
  }
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
  const attribution = useQuery(
    api.gtmMaya.missionControl.getMyPostAttribution,
    {}
  );
  const weeklyReview = useQuery(
    api.gtmMaya.missionControl.getMyLatestWeeklyReview
  );

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
  // Per-post attribution, ranked by what converted (then clicks). This is the
  // "which post drove signups" view + the data Maya re-weights the plan on.
  const attributionRows = [...(attribution ?? [])]
    .filter((a) => a.clicks > 0 || a.conversions > 0)
    .sort((a, b) => b.conversions - a.conversions || b.clicks - a.clicks);

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
        <Empty
          title="No results yet"
          body="Once you start posting and people start clicking + signing up, the numbers show up here — and your manager re-weights the plan around what actually converts."
        />
      </Shell>
    );
  }

  // ── North Star ─────────────────────────────────────────────
  const nsMetric = app?.northStarMetric;
  const nsTarget = app?.northStarTarget;
  const nsDeadline = app?.northStarDeadlineMs;

  // Total conversions count (for the ledger header).
  const conversionsTotal = conversionRows.reduce(
    (sum, c) => sum + c.count,
    0
  );

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
        "No signup confirmations yet — tell Maya in Telegram how many converted, or connect a tracking link, and this starts moving.";
      paceTone = "paper";
      paceLabel = "no data yet";
    } else if (nsTarget && nsTarget > 0) {
      const pct = current / nsTarget;
      if (current >= nsTarget) {
        paceLine = `Hit the goal — ${current} of ${nsTarget}. Time to set the next one with Maya.`;
        paceTone = "lime";
        paceLabel = "goal hit";
      } else if (nsDeadline) {
        // Honest pace check: where should we be by now on a straight line
        // from the deadline window? Without a start anchor we use the
        // earliest conversion as the baseline.
        const earliest = conversionRows.reduce(
          (min, c) => Math.min(min, c.occurredAt),
          Date.now()
        );
        const now = Date.now();
        const totalSpan = nsDeadline - earliest;
        const elapsed = now - earliest;
        const expectedPct =
          totalSpan > 0 ? Math.min(1, Math.max(0, elapsed / totalSpan)) : 1;
        const overdue = now > nsDeadline;
        if (overdue) {
          paceLine = `Deadline passed (${formatDeadline(
            nsDeadline
          )}) at ${current} of ${nsTarget}. Worth resetting the target with Maya.`;
          paceTone = "rose";
          paceLabel = "deadline passed";
        } else if (pct >= expectedPct) {
          paceLine = `On track — ${current} of ${nsTarget} (${Math.round(
            pct * 100
          )}%) by ${formatDeadline(nsDeadline)}.`;
          paceTone = "lime";
          paceLabel = "on track";
        } else {
          paceLine = `Behind pace — ${current} of ${nsTarget} (${Math.round(
            pct * 100
          )}%) with ${formatDeadline(
            nsDeadline
          )} ahead. Maya is re-weighting toward what converts.`;
          paceTone = "rose";
          paceLabel = "at risk";
        }
      } else {
        paceLine = `${current} of ${nsTarget} (${Math.round(
          pct * 100
        )}%). No deadline set — ask Maya to put one on it for a real pace read.`;
        paceTone = pct >= 0.5 ? "lime" : "paper";
        paceLabel = "tracking";
      }
    } else {
      paceLine = `${current} so far. No target set — set one at synthesis or ask Maya for a number to aim at.`;
      paceTone = "paper";
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

  return (
    <Shell
      title="Results"
      subtitle="Signups, not likes. What's actually working, and whether we're on track for your goal."
    >
      {/* ── North Star ── */}
      <Section title="North Star">
        {northStar ? (
          <Card className="border-lime/30">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-paper">
                {northStar.metric}
              </p>
              <Pill tone={northStar.paceTone}>{northStar.paceLabel}</Pill>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-4xl leading-none sm:text-5xl">
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
        ) : (
          <Card>
            <p className="text-sm leading-relaxed text-paper-dim">
              No North Star set yet. Your manager sets one at synthesis — a
              single number to aim at (usually signups) with a deadline. Ask
              Maya in Telegram to lock it in and this turns into a live pace
              tracker.
            </p>
          </Card>
        )}
      </Section>

      {/* ── Strategic Review (weekly) ── */}
      <Section title="Strategic Review">
        {weeklyReview === null ? (
          <Card>
            <p className="text-sm leading-relaxed text-paper-dim">
              Your first weekly review lands Sunday. Every week Maya steps back
              from the day-to-day, reads what converted, and writes up the wins,
              the losses, and what she&apos;s changing next week — grounded in
              your real numbers, not vibes. It&apos;ll show up here.
            </p>
          </Card>
        ) : (
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
        )}
      </Section>

      {/* ── Conversions ── */}
      <Section title="Conversions" count={conversionsTotal}>
        {conversionRows.length === 0 ? (
          <Empty
            title="No conversions logged yet"
            body="When someone signs up, books a demo, gives feedback, or pays, it lands here. Tell Maya in Telegram and she'll log it — or it shows up automatically once a tracking link is wired."
          />
        ) : (
          <ol className="space-y-2">
            {conversionRows.map((c) => (
              <li key={c._id}>
                <Card className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Pill tone={c.kind === "revenue" ? "lime" : "paper"}>
                        {CONVERSION_LABEL[c.kind] ?? c.kind}
                      </Pill>
                      <span className="font-display text-lg">{c.count}</span>
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
        )}
      </Section>

      {/* ── Per-post attribution: which post drove what ── */}
      <Section title="By post — what drove clicks + signups" count={attributionRows.length}>
        {attributionRows.length === 0 ? (
          <Empty
            title="No tracked posts yet"
            body="Every product link Maya hands you is tracked. Once you start posting them, you'll see exactly which post drove the clicks and signups — and Maya doubles down on what converts."
          />
        ) : (
          <ol className="space-y-2">
            {attributionRows.map((a) => (
              <li key={a.linkWrapId}>
                <Card className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {a.platform ? (
                        <Pill tone="paper">{a.platform}</Pill>
                      ) : null}
                      {a.conversions > 0 ? (
                        <Pill tone="lime">
                          {a.conversions} signup{a.conversions === 1 ? "" : "s"}
                        </Pill>
                      ) : null}
                      <span className="font-mono text-[11px] text-paper-faint">
                        {a.clicks} click{a.clicks === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs leading-relaxed text-paper-dim">
                      {a.draftText ?? a.destinationUrl}
                    </p>
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

      {/* ── What's working ── */}
      <Section title="What's working" count={learningRows.length}>
        {learningRows.length === 0 ? (
          <Empty
            title="Nothing locked in yet"
            body="As Maya watches what converts, she writes down the patterns that hold — best channels, timing, hooks, angles — and re-weights the plan around them. They'll appear here."
          />
        ) : (
          <ol className="space-y-2">
            {learningRows
              .slice()
              .sort((a, b) => b.confidenceScore - a.confidenceScore)
              .map((l) => (
                <li key={l._id}>
                  <Card>
                    <div className="flex items-center gap-2">
                      <Pill tone="lime">
                        {l.learningKind.replace(/_/g, " ")}
                      </Pill>
                      <span className="font-mono text-[11px] text-paper-faint">
                        {Math.round(l.confidenceScore * 100)}% confident
                      </span>
                      <span className="font-mono text-[11px] text-paper-faint">
                        {l.evidenceCount}{" "}
                        {l.evidenceCount === 1 ? "signal" : "signals"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-paper">
                      {l.learning}
                    </p>
                  </Card>
                </li>
              ))}
          </ol>
        )}
      </Section>

      {/* ── Recent posts ── */}
      <Section title="Recent posts" count={postRows.length}>
        {postRows.length === 0 ? (
          <Empty
            title="No post snapshots yet"
            body="Once your posts go live, Maya checks back on each one and records how it's doing. The numbers — and which ones she flagged — show up here."
          />
        ) : (
          <ol className="space-y-2">
            {postRows.map((p) => {
              const m = p.metrics ?? {};
              const stats: { label: string; value: number }[] = [];
              if (m.upvotes !== undefined)
                stats.push({ label: "upvotes", value: m.upvotes });
              if (m.likes !== undefined)
                stats.push({ label: "likes", value: m.likes });
              if (m.views !== undefined)
                stats.push({ label: "views", value: m.views });
              if (m.comments !== undefined)
                stats.push({ label: "comments", value: m.comments });
              if (m.shares !== undefined)
                stats.push({ label: "shares", value: m.shares });
              const shown = stats.slice(0, 3);
              return (
                <li key={p._id}>
                  <Card className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Pill tone="paper">{p.platform}</Pill>
                        {p.surfacedToOperator ? (
                          <Pill tone="lime">Maya flagged this</Pill>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-paper-dim">
                        {shown.length > 0 ? (
                          shown.map((s) => (
                            <span key={s.label}>
                              {s.value} {s.label}
                            </span>
                          ))
                        ) : (
                          <span className="text-paper-faint">
                            no metrics captured yet
                          </span>
                        )}
                      </div>
                      {p.notes ? (
                        <p className="mt-1 text-xs leading-relaxed text-paper-dim">
                          {p.notes}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-paper-faint">
                      {timeAgo(p.snapshotAtMs)}
                    </span>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </Shell>
  );
}
