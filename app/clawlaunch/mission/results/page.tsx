"use client";

/**
 * Results — signups first, receipts as a wall.
 *
 *   KPI row      hero attributed signups (sparkline + delta) · clicks ·
 *                posts shipped. Reply rate is hidden — not derivable from
 *                the data we track. "+ Log a win" keeps attribution honest.
 *   FUNNEL       posts → clicks → signups as a picture, with per-stage
 *                conversion microcopy.
 *   BY CHANNEL   scorecards side by side, one "Best:" line each.
 *   RECEIPTS     every tracked post as a compact card in a grid.
 *
 * The Today / This week / All time segment flips the whole screen.
 */

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Btn,
  Chip,
  channelLabel,
  Empty,
  Loading,
  NeedsOnboarding,
  Panel,
  Rise,
  Shell,
  Sparkline,
  SrcLink,
} from "../_components";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

type Range = "today" | "week" | "all";
const SIGNUP_KINDS = new Set(["signup", "activated", "revenue"]);

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ── Log a win — the founder self-report floor ─────────────────────────── */

function LogAWin({ onDone }: { onDone: () => void }) {
  const report = useMutation(api.gtmMaya.missionActions.reportMyConversion);
  const [kind, setKind] = useState<
    "signup" | "demo" | "revenue" | "activated" | "feedback"
  >("signup");
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  const submit = async () => {
    if (state === "busy") return;
    setState("busy");
    try {
      await report({ kind, count, note: note.trim() || undefined });
      setNote("");
      setCount(1);
      setState("idle");
      onDone();
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  return (
    <Panel title="Log a win" className="mb-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          max={10000}
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
          className="mc-num w-16 rounded-lg border border-[var(--mc-line)] bg-ink px-2.5 py-1.5 text-sm text-paper outline-none focus:border-lime/50"
          aria-label="How many"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="rounded-lg border border-[var(--mc-line)] bg-ink-3 px-2.5 py-1.5 text-sm text-paper outline-none focus:border-lime/50"
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
          placeholder="where from?"
          className="min-w-0 flex-1 rounded-lg border border-[var(--mc-line)] bg-ink px-2.5 py-1.5 text-sm text-paper outline-none placeholder:text-paper-faint focus:border-lime/50"
        />
        <Btn tone="primary" busy={state === "busy"} onClick={() => void submit()}>
          Log it
        </Btn>
      </div>
      {state === "error" ? (
        <p className="mt-2 text-xs text-rose">Didn&apos;t save — try again.</p>
      ) : null}
    </Panel>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function ResultsPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const conversions = useQuery(api.gtmMaya.missionControl.getMyConversions);
  const attribution = useQuery(api.gtmMaya.missionControl.getMyPostAttribution, {});
  const drafts = useQuery(api.gtmMaya.missionActions.getMyDraftQueue);
  const postRows = useQuery(api.gtmMaya.postResults.getMyRecentPostResults, {});

  const [range, setRange] = useState<Range>("week");
  const [logging, setLogging] = useState(false);

  const now = Date.now();
  const todayStart = startOfTodayMs();

  // Window bounds + previous window for the delta.
  const [winStart, prevStart, prevEnd]: [number, number | null, number] =
    range === "today"
      ? [todayStart, todayStart - DAY_MS, todayStart]
      : range === "week"
        ? [now - WEEK_MS, now - 2 * WEEK_MS, now - WEEK_MS]
        : [0, null, 0];

  if (
    snapshot === undefined ||
    conversions === undefined ||
    attribution === undefined ||
    drafts === undefined ||
    postRows === undefined
  ) {
    return <Loading />;
  }
  if (snapshot === null) return <NeedsOnboarding />;

  const inWin = (t: number) => t >= winStart && t <= now;
  const inPrev = (t: number) =>
    prevStart !== null && t >= prevStart && t < prevEnd;

  // ── KPIs ────────────────────────────────────────────────────────────────
  const signupRows = (conversions ?? []).filter((c) => SIGNUP_KINDS.has(c.kind));
  const signups = signupRows.filter((c) => inWin(c.occurredAt)).reduce((s, c) => s + c.count, 0);
  const signupsPrev = signupRows.filter((c) => inPrev(c.occurredAt)).reduce((s, c) => s + c.count, 0);

  const wrapsInWin = (attribution ?? []).filter((a) => inWin(a.createdAt));
  const clicks = wrapsInWin.reduce((s, a) => s + a.clicks, 0);
  const clicksPrev = (attribution ?? [])
    .filter((a) => inPrev(a.createdAt))
    .reduce((s, a) => s + a.clicks, 0);

  const publishedAtOf = (d: { publishedAt?: number; updatedAt: number }) =>
    d.publishedAt ?? d.updatedAt;
  const published = (drafts ?? []).filter((d) => d.approvalState === "published");
  const posts = published.filter((d) => inWin(publishedAtOf(d))).length;
  const postsPrev = published.filter((d) => inPrev(publishedAtOf(d))).length;

  // Sparklines: real per-day series over the trailing 7 days.
  const daySeries = (times: Array<{ t: number; n: number }>): number[] => {
    const out = new Array(7).fill(0) as number[];
    for (const { t, n } of times) {
      const idx = Math.floor((t - (todayStart - 6 * DAY_MS)) / DAY_MS);
      if (idx >= 0 && idx < 7) out[idx] += n;
    }
    return out;
  };
  const signupSpark = daySeries(signupRows.map((c) => ({ t: c.occurredAt, n: c.count })));
  const postSpark = daySeries(published.map((d) => ({ t: publishedAtOf(d), n: 1 })));

  const delta = (cur: number, prev: number): ReactNode => {
    if (range === "all") return null;
    const label = range === "today" ? "vs yesterday" : "vs last week";
    if (cur === prev)
      return <div className="mc-delta flat">— same {label}</div>;
    const up = cur > prev;
    return (
      <div className={`mc-delta ${up ? "up" : "down"}`}>
        {up ? "▲" : "▼"} {Math.abs(cur - prev)} {label}
      </div>
    );
  };

  const hasAnything =
    signupRows.length > 0 ||
    (attribution ?? []).length > 0 ||
    published.length > 0 ||
    (postRows ?? []).length > 0;

  // ── By channel ──────────────────────────────────────────────────────────
  const byChannel = new Map<
    string,
    { posts: number; clicks: number; signups: number; best: { text: string; score: number } | null }
  >();
  for (const a of wrapsInWin) {
    const key = a.platform ?? "other";
    const cur =
      byChannel.get(key) ?? { posts: 0, clicks: 0, signups: 0, best: null };
    cur.posts += 1;
    cur.clicks += a.clicks;
    cur.signups += a.conversions;
    const score = a.conversions * 1000 + a.clicks;
    if (a.draftText && score > 0 && (!cur.best || score > cur.best.score)) {
      cur.best = { text: a.draftText, score };
    }
    byChannel.set(key, cur);
  }
  const channelRows = [...byChannel.entries()]
    .filter(([, v]) => v.clicks > 0 || v.signups > 0 || v.posts > 0)
    .sort((a, b) => b[1].signups - a[1].signups || b[1].clicks - a[1].clicks);
  const signupsAttributed = channelRows.reduce((s, [, v]) => s + v.signups, 0);

  // ── Receipts ────────────────────────────────────────────────────────────
  const attributionReceipts = [...wrapsInWin].sort(
    (a, b) => b.conversions - a.conversions || b.clicks - a.clicks
  );
  // Latest snapshot per draft, joined to its draft text.
  type PostRow = NonNullable<typeof postRows>[number];
  const draftText = new Map(published.map((d) => [String(d._id), d.draftText]));
  const latestByDraft = new Map<string, PostRow>();
  for (const p of postRows ?? []) {
    if (!inWin(p.snapshotAtMs)) continue;
    const k = String(p.draftId);
    const prev = latestByDraft.get(k);
    if (!prev || p.snapshotAtMs > prev.snapshotAtMs) latestByDraft.set(k, p);
  }
  const metricReceipts = [...latestByDraft.values()];

  // Funnel bar widths — log-compressed so one big stage doesn't flatten the
  // others; the exact number is printed beside every bar.
  const funnelMax = Math.max(posts, clicks, signups, 1);
  const barW = (v: number) =>
    v <= 0
      ? "8px"
      : `${Math.max(6, Math.round((Math.log1p(v) / Math.log1p(funnelMax)) * 100))}%`;

  const seg = (
    <div className="mc-seg" role="tablist" aria-label="Time range">
      {(
        [
          ["today", "Today"],
          ["week", "This week"],
          ["all", "All time"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          className={range === k ? "on" : ""}
          onClick={() => setRange(k)}
          role="tab"
          aria-selected={range === k}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (!hasAnything) {
    return (
      <Shell title="Results" when={seg}>
        <Rise>
          <Empty
            title="No results yet"
            body="Numbers land here once posts go out and people click."
          />
        </Rise>
        <div className="mt-3.5">
          <LogAWin onDone={() => undefined} />
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Results" when={seg}>
      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <Rise>
        <div className="mc-grid mc-kpis mb-3.5">
          <div className="mc-panel mc-raised mc-kpi-hero">
            <button className="mc-btn mc-btn-ghost mc-logwin" onClick={() => setLogging((v) => !v)}>
              + Log a win
            </button>
            <div className="mc-kpi-label">Signups · attributed</div>
            <div className="mc-kpi-value">{signups}</div>
            {delta(signups, signupsPrev)}
            {signupSpark.some((v) => v > 0) ? (
              <Sparkline
                points={signupSpark}
                width={190}
                height={36}
                stroke="var(--mc-accent)"
                endDot
                label="signups per day, 7 days"
              />
            ) : null}
          </div>
          <div className="mc-panel">
            <div className="mc-kpi-label">Clicks</div>
            <div className="mc-kpi-value">{clicks}</div>
            {delta(clicks, clicksPrev)}
          </div>
          <div className="mc-panel">
            <div className="mc-kpi-label">Posts shipped</div>
            <div className="mc-kpi-value">{posts}</div>
            {delta(posts, postsPrev)}
            {postSpark.some((v) => v > 0) ? (
              <Sparkline points={postSpark} label="posts per day, 7 days" />
            ) : null}
          </div>
        </div>
      </Rise>

      {logging ? <LogAWin onDone={() => setLogging(false)} /> : null}

      {/* ── Funnel + channels ───────────────────────────────────────────── */}
      <Rise i={1}>
        <div className="mc-grid mc-results-mid mb-3.5">
          <Panel
            title={
              range === "today"
                ? "Today as a funnel"
                : range === "week"
                  ? "The week as a funnel"
                  : "All time as a funnel"
            }
          >
            <div className="mc-funnel-stage">
              <span className="k">Posts</span>
              <div className="mc-funnel-bar mc-funnel-bar-1" style={{ width: barW(posts) }} />
              <span className="v">{posts}</span>
            </div>
            {posts > 0 ? (
              <div className="mc-funnel-conv">
                <span>→ {(clicks / posts).toFixed(1)} clicks per post</span>
              </div>
            ) : null}
            <div className="mc-funnel-stage">
              <span className="k">Clicks</span>
              <div className="mc-funnel-bar mc-funnel-bar-2" style={{ width: barW(clicks) }} />
              <span className="v">{clicks}</span>
            </div>
            {clicks > 0 ? (
              <div className="mc-funnel-conv">
                <span>→ {((signups / clicks) * 100).toFixed(1)}% click-to-signup</span>
              </div>
            ) : null}
            <div className="mc-funnel-stage">
              <span className="k">Signups</span>
              <div className="mc-funnel-bar mc-funnel-bar-3" style={{ width: barW(signups) }} />
              <span className="v">{signups}</span>
            </div>
          </Panel>

          <Panel title="By channel">
            {channelRows.length === 0 ? (
              <p className="text-xs text-paper-faint">No tracked posts in this window.</p>
            ) : (
              <div className="mc-chan-grid">
                {channelRows.map(([channel, v]) => (
                  <div key={channel} className="mc-chan">
                    <div className="top">
                      <Chip platform={channel}>{channelLabel(channel)}</Chip>
                      {signupsAttributed > 0 ? (
                        <span className="mc-when mc-num">
                          {v.signups} of {signupsAttributed} signups
                        </span>
                      ) : null}
                    </div>
                    <div className="nums">
                      <div>
                        <div className="v">{v.posts}</div>
                        <div className="k">posts</div>
                      </div>
                      <div>
                        <div className="v">{v.clicks}</div>
                        <div className="k">clicks</div>
                      </div>
                      <div>
                        <div className="v" style={v.signups > 0 ? { color: "var(--mc-good)" } : undefined}>
                          {v.signups}
                        </div>
                        <div className="k">signups</div>
                      </div>
                    </div>
                    {v.best ? <div className="best">Best: {v.best.text}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </Rise>

      {/* ── Receipts ────────────────────────────────────────────────────── */}
      <Rise i={2}>
        <Panel title="Every post, with receipts">
          {attributionReceipts.length === 0 && metricReceipts.length === 0 ? (
            <p className="text-xs text-paper-faint">No receipts in this window yet.</p>
          ) : (
            <div className="mc-receipts">
              {attributionReceipts.map((a) => (
                <div key={a.linkWrapId} className="mc-receipt">
                  <div>
                    <Chip platform={a.platform}>
                      {a.platform ? channelLabel(a.platform) : "tracked link"}
                      {a.draftKind ? ` ${a.draftKind}` : ""}
                    </Chip>
                  </div>
                  {a.draftText ? <div className="mc-hook">{a.draftText}</div> : null}
                  <div className="mc-mets">
                    <div>
                      <div className="v">{a.clicks}</div>
                      <div className="k">CLICKS</div>
                    </div>
                    <div className="got">
                      <div className="v">{a.conversions}</div>
                      <div className="k">SIGNUPS</div>
                    </div>
                  </div>
                  <SrcLink href={a.destinationUrl}>where it points ↗</SrcLink>
                </div>
              ))}
              {metricReceipts.map((p) => {
                const m = p.metrics ?? {};
                const stats: Array<[string, number | undefined]> = [
                  ["VIEWS", m.views],
                  ["UPVOTES", m.upvotes],
                  ["LIKES", m.likes],
                  ["COMMENTS", m.comments],
                ];
                const shown = stats.filter(
                  (s): s is [string, number] => s[1] !== undefined
                );
                const hook = draftText.get(String(p.draftId));
                return (
                  <div key={p._id} className="mc-receipt">
                    <div className="flex items-center justify-between gap-2">
                      <Chip platform={p.platform}>{channelLabel(p.platform)}</Chip>
                      {p.surfacedToOperator ? (
                        <span className="mc-when" style={{ color: "var(--mc-good)" }}>
                          flagged
                        </span>
                      ) : null}
                    </div>
                    {hook ? <div className="mc-hook">{hook}</div> : null}
                    <div className="mc-mets">
                      {shown.slice(0, 3).map(([k, v]) => (
                        <div key={k}>
                          <div className="v">{v}</div>
                          <div className="k">{k}</div>
                        </div>
                      ))}
                      {shown.length === 0 ? (
                        <span className="text-[10px] text-paper-faint">no numbers yet</span>
                      ) : null}
                    </div>
                    {/^https?:\/\//.test(p.providerPostId) ? (
                      <SrcLink href={p.providerPostId}>view post ↗</SrcLink>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </Rise>
    </Shell>
  );
}
