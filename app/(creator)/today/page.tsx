/**
 * Today screen — the most-trafficked Creator HQ surface.
 *
 * Lives at /today (see app/(creator)/layout.tsx for the route-group + URL
 * trade-off explanation). Mobile-first vertical scroll. Every section reads
 * from a Convex subscription so brief writes / metric updates / paid deals
 * push through without a refresh.
 *
 * Section order — top of phone to bottom:
 *   1. Greeting    — Maya's voice ("Good morning, {firstName}")
 *   2. Brief       — markdown body of the latest dailyBriefs row
 *   3. Top move    — top recommendation with citation chips
 *   4. Pending     — drafts / deliverables / brand-emails to act on
 *   5. Revenue     — MTD + 30-day sparkline
 *   6. Outliers    — link to Performance for top-quartile posts (Pro+ only)
 *
 * Empty states are deliberate. If Maya hasn't written today's brief yet, we
 * say so honestly — never fabricate a placeholder brief. Anti-sycophancy
 * applies to the dashboard chrome too.
 */

"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  ArrowUpRight,
  CheckCircle2,
  Flame,
  Inbox,
  Mail,
  Send,
  Sparkles,
} from "lucide-react";
import { Section } from "@/components/creator/Section";
import { MarkdownLite } from "@/components/creator/MarkdownLite";
import { Sparkline } from "@/components/creator/Sparkline";
import { GoalsFocusStrip } from "@/components/creator/GoalsFocusStrip";
import {
  emptyCopyFor,
  StageBanner,
  StageEmpty,
  todaySectionsFor,
  type StageContext,
  type TodaySection,
} from "@/components/creator/stage";

export default function TodayPage() {
  const me = useQuery(api.creators.me);
  const brief = useQuery(api.today.latestBrief);
  const pending = useQuery(api.today.pendingItems);
  const pendingExtra = useQuery(api.businessReadiness.pendingItemsExtended);
  const revenue = useQuery(api.today.revenueWidget);
  const outliers = useQuery(api.today.outlierPosts);
  const actionLog = useQuery(api.businessReadiness.latestActionLog);
  const gmail = useQuery(api.businessReadiness.gmailWatchStatus);
  const stageCtx = useQuery(api.businessReadiness.creatorStage);
  const goalsFocus = useQuery(api.today.goalsFocusContext);

  // Loading state for the very first render — every Convex query starts as
  // `undefined` until it lands. Once any query resolves we show the page.
  const stillBooting =
    me === undefined &&
    brief === undefined &&
    pending === undefined &&
    revenue === undefined;

  if (stillBooting) {
    return <BootSkeleton />;
  }

  const firstName = (me?.email ?? "").split("@")[0] || "creator";
  const topRec = brief?.recommendations[0] ?? null;

  return (
    <div className="pt-2 sm:pt-6">
      {/* 0. Goals + Focus + Maya activity strip — anchors every other screen */}
      <GoalsFocusStrip data={goalsFocus} />

      {/* 1. Greeting */}
      <Section
        eyebrow={`§ Today · ${formatToday(me?.timezone)}`}
        title={`${greetingFor(me?.timezone)}, ${firstName}.`}
        caption="Maya is reading your accounts in the background. Anything that needs your eyes is below."
        rightSlot={
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            {me?.plan ? `${me.plan} plan` : null}
          </span>
        }
        variant="tight"
      >
        <div className="flex flex-wrap items-center gap-3">
          {brief?.generatedAt && (
            <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Brief written {timeAgo(brief.generatedAt)} · grounded
            </span>
          )}
          {gmail && <GmailWatchBadge status={gmail} />}
        </div>
      </Section>

      {/*
        Stage-aware section ordering. `todaySectionsFor(stage)` returns the
        ordered list of section ids per stage (just-starting leads with
        growth + accountability; scaling leads with deals/revenue). We
        iterate that list and dispatch to the per-section renderer below.
        While `stageCtx` is still loading, fall back to the building-stage
        ordering — it's the most common bracket and the safest neutral default.
      */}
      {(() => {
        const renderable: StageContext =
          stageCtx ?? FALLBACK_STAGE_CTX;
        const order: ReadonlyArray<TodaySection> = todaySectionsFor(
          renderable.stage
        );
        const combinedPending: ReadonlyArray<{
          kind:
            | "draft"
            | "deliverable"
            | "brand-email"
            | "approved-content"
            | "pitch-followup";
          title: string;
          dueAt: number | null;
          sourceTable: string;
          sourceId: string;
        }> = [...(pending ?? []), ...(pendingExtra ?? [])];

        return order.map((sectionId) => {
          switch (sectionId) {
            case "growth":
              // Only renders for just-starting (helper omits it elsewhere).
              return (
                <Section
                  key="growth"
                  eyebrow="§00 · Where you are"
                  title="Stage-aware focus"
                >
                  <StageBanner ctx={renderable} />
                </Section>
              );
            case "brief":
              return (
                <Section key="brief" eyebrow="§01 · Morning brief" title="From Maya">
                  {brief ? (
                    <article className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-6 sm:p-8">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-paper-faint">
                        <Sparkles className="h-3.5 w-3.5 text-lime" />
                        Maya · {formatBriefDate(brief.briefDateLocal)}
                      </div>
                      <div className="mt-5">
                        <MarkdownLite source={brief.markdown} />
                      </div>
                    </article>
                  ) : (
                    <StageEmpty copy={emptyCopyFor("today-brief", renderable)} />
                  )}
                </Section>
              );
            case "topMove":
              return (
                <Section key="topMove" eyebrow="§02 · Today's move" title="Do this first">
                  {topRec ? (
                    <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-3 p-6 sm:p-7">
                      <div className="flex items-center gap-2">
                        <PriorityPill priority={topRec.priority} />
                        <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                          Maya recommends
                        </span>
                      </div>
                      <p className="mt-4 font-display text-2xl leading-snug text-paper sm:text-3xl">
                        {topRec.move}
                      </p>
                      <p className="mt-3 text-sm leading-relaxed text-paper-dim">
                        <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                          Evidence ·{" "}
                        </span>
                        {topRec.evidence}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-paper-dim">
                        <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                          Expected ·{" "}
                        </span>
                        {topRec.expectedOutcome}
                      </p>
                      {topRec.citations.length > 0 && (
                        <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--hairline)] pt-4">
                          {topRec.citations.map((c, i) => (
                            <CitationChip key={i} kind={c.kind} ref={c.ref} />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <EmptyCard
                      title="No specific move yet."
                      body="Maya only writes a top recommendation when she has grounded evidence for it. Quiet day = quiet brief; that's the contract."
                    />
                  )}
                </Section>
              );
            case "pending":
              return (
                <Section
                  key="pending"
                  eyebrow="§03 · Pending"
                  title="Needs you"
                  rightSlot={
                    combinedPending.length > 0 ? (
                      <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                        {combinedPending.length} open
                      </span>
                    ) : null
                  }
                >
                  {combinedPending.length > 0 ? (
                    <ul className="overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 divide-y divide-[var(--hairline)]">
                      {combinedPending.map((item, i) => (
                        <li
                          key={`${item.sourceTable}-${item.sourceId}-${i}`}
                          className="flex items-center gap-4 p-4 sm:p-5"
                        >
                          <PendingIcon kind={item.kind} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                                {labelForKind(item.kind)}
                              </span>
                              {item.dueAt && (
                                <span className="font-mono text-[11px] text-paper-faint">
                                  · due {formatDue(item.dueAt)}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-sm text-paper">
                              {item.title}
                            </p>
                          </div>
                          <span className="text-paper-faint">
                            <ArrowUpRight className="h-4 w-4" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <StageEmpty copy={emptyCopyFor("today-pending", renderable)} />
                  )}
                </Section>
              );
            case "revenue":
              return (
                <Section key="revenue" eyebrow="§04 · Revenue" title="This month">
                  {revenue && revenue.mtdUsd > 0 ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-6 sm:col-span-1">
                        <div className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                          MTD · brand deals paid
                        </div>
                        <div className="mt-3 font-display text-4xl tracking-tight text-paper">
                          {formatUsd(revenue.mtdUsd)}
                        </div>
                        <p className="mt-2 text-xs text-paper-faint">
                          Source: brandDeals where status = paid in current UTC month.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-6 sm:col-span-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                            Last 30 days
                          </span>
                          <span className="font-mono text-[11px] text-paper-faint">
                            total {formatUsd(revenue.trend.reduce((a, b) => a + b, 0))}
                          </span>
                        </div>
                        <div className="mt-4 text-paper-faint">
                          <Sparkline
                            values={revenue.trend}
                            height={48}
                            ariaLabel="Brand-deal revenue, last 30 days, daily totals"
                          />
                        </div>
                        <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                          <span>30d ago</span>
                          <span>today</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <StageEmpty copy={emptyCopyFor("today-revenue", renderable)} />
                  )}
                </Section>
              );
            case "accountability":
              if (!actionLog || actionLog.length === 0) return null;
              return (
                <Section
                  key="accountability"
                  eyebrow="§05 · Accountability"
                  title="What Maya did for you"
                  rightSlot={
                    <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                      last {actionLog.length}
                    </span>
                  }
                >
                  <ul className="overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 divide-y divide-[var(--hairline)]">
                    {actionLog.map((entry) => (
                      <li
                        key={entry._id}
                        className="flex items-start gap-3 p-4 sm:p-5"
                      >
                        <ActionLogIcon outcome={entry.outcome} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                              {entry.entryId}
                            </span>
                            <span className="font-mono text-[11px] text-paper-faint">
                              · {timeAgo(entry.ts)}
                            </span>
                          </div>
                          {entry.detail && (
                            <p className="mt-0.5 text-sm leading-relaxed text-paper-dim">
                              {entry.detail}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              );
            case "outliers":
              if (!outliers || outliers.length === 0) return null;
              return (
                <Section
                  key="outliers"
                  eyebrow="§06 · Outlier alert"
                  title="One of yours is moving"
                >
                  <Link
                    href="/performance"
                    className="flex items-center gap-4 rounded-2xl border border-lime/40 bg-lime/5 p-5 transition-colors hover:bg-lime/10 sm:p-6"
                  >
                    <span
                      aria-hidden
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-lime/40 text-lime"
                    >
                      <Flame className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-mono uppercase tracking-wider text-ink">
                          Outlier
                        </span>
                        <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                          {outliers.length} post{outliers.length === 1 ? "" : "s"} top quartile
                        </span>
                      </div>
                      <p className="mt-1.5 truncate font-display text-lg text-paper">
                        {outliers[0].caption || `Your ${outliers[0].platform} post is tracking high`}
                      </p>
                    </div>
                    <ArrowUpRight className="h-5 w-5 shrink-0 text-paper-dim" />
                  </Link>
                </Section>
              );
          }
        });
      })()}
    </div>
  );
}

/**
 * Fallback stage context used while `stageCtx` is still loading. We pick the
 * `building` stage because it's the most common bracket and its section
 * ordering is the safest neutral default — no growth banner up top, no
 * scaling-only emphasis. As soon as `stageCtx` lands, the live ordering
 * applies.
 */
const FALLBACK_STAGE_CTX: StageContext = {
  stage: "building",
  stageSource: "inferred",
  topFollowers: 0,
  nextMilestone: { label: "10K", targetFollowers: 10_000 },
  focusArea: "hook-craft",
};

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function PriorityPill({ priority }: { priority: "p0" | "p1" | "p2" }) {
  const styles: Record<typeof priority, string> = {
    p0: "bg-rose text-ink",
    p1: "bg-lime text-ink",
    p2: "bg-ink-3 text-paper-dim border border-[var(--hairline-strong)]",
  };
  const label: Record<typeof priority, string> = {
    p0: "Now",
    p1: "Today",
    p2: "When you can",
  };
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-mono uppercase tracking-wider ${styles[priority]}`}
    >
      {label[priority]}
    </span>
  );
}

function CitationChip({
  kind,
  ref,
}: {
  kind: "post" | "deal" | "metric" | "competitor" | "calendar" | "brief";
  ref: string;
}) {
  // Map citation kinds to a destination route. Posts go to Performance with
  // a query param the detail panel can pick up; deals to Deals; everything
  // else just shows as an inert chip until the relevant screen ships.
  const KIND_LABEL: Record<typeof kind, string> = {
    post: "post",
    deal: "deal",
    metric: "metric",
    competitor: "peer",
    calendar: "cal",
    brief: "brief",
  };
  const label = KIND_LABEL[kind];
  const tail = ref.length > 12 ? `${ref.slice(0, 12)}…` : ref;
  const inner = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline-strong)] bg-ink-2 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-paper-dim">
      <span className="text-lime">·</span>
      {label} {tail}
    </span>
  );
  if (kind === "post") {
    return (
      <Link href={`/performance?postId=${encodeURIComponent(ref)}`}>
        {inner}
      </Link>
    );
  }
  if (kind === "deal") {
    return <Link href="/deals">{inner}</Link>;
  }
  return inner;
}

function PendingIcon({
  kind,
}: {
  kind:
    | "draft"
    | "deliverable"
    | "brand-email"
    | "approved-content"
    | "pitch-followup";
}) {
  if (kind === "brand-email") {
    return (
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--hairline-strong)] text-lime">
        <Inbox className="h-4 w-4" strokeWidth={1.75} />
      </span>
    );
  }
  if (kind === "pitch-followup") {
    return (
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--hairline-strong)] text-lime">
        <Send className="h-4 w-4" strokeWidth={1.75} />
      </span>
    );
  }
  if (kind === "approved-content") {
    return (
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--hairline-strong)] text-lime">
        <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--hairline-strong)] text-paper-dim">
      <Sparkles className="h-4 w-4" strokeWidth={1.75} />
    </span>
  );
}

/**
 * Status badge for the Gmail watch. Three states:
 *   connected + plan-enabled  → "Watching · last seen Xm ago"
 *   connected + not enabled   → "Connected · upgrade to Pro for triage"
 *   not connected             → "Connect Gmail for inbound triage"
 *
 * Quiet by default — pin to the same `font-mono uppercase tracking-widest`
 * vocabulary as the rest of the eyebrow chrome.
 */
function GmailWatchBadge({
  status,
}: {
  status: {
    connected: boolean;
    planEnabled: boolean;
    lastEventAt: number | null;
  };
}) {
  const tone = status.connected && status.planEnabled ? "lime" : "dim";
  const colorCls =
    tone === "lime"
      ? "border-lime/40 bg-lime/5 text-lime"
      : "border-[var(--hairline-strong)] text-paper-faint";
  let label: string;
  if (!status.connected) {
    label = "Gmail not connected";
  } else if (!status.planEnabled) {
    label = "Gmail · upgrade for triage";
  } else if (status.lastEventAt) {
    label = `Watching Gmail · last ${timeAgo(status.lastEventAt)}`;
  } else {
    label = "Watching Gmail · idle";
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest ${colorCls}`}
    >
      <Mail className="h-3 w-3" />
      {label}
    </span>
  );
}

/**
 * Action-log icon. `ran` outcomes get the lime sparkle (Maya did the work);
 * `failed` outcomes get a paper-dim sparkle (Maya tried but errored — we
 * surface for transparency, not alarm).
 */
function ActionLogIcon({ outcome }: { outcome: string }) {
  const colorCls =
    outcome === "ran"
      ? "border-lime/40 text-lime"
      : "border-[var(--hairline-strong)] text-paper-dim";
  return (
    <span
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border ${colorCls}`}
    >
      <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
    </span>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ink-2/40 p-6 sm:p-8">
      <p className="font-display text-xl text-paper">{title}</p>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-paper-dim">
        {body}
      </p>
    </div>
  );
}

function BootSkeleton() {
  return (
    <div className="px-5 pt-10 sm:px-8 sm:pt-14">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="h-3 w-32 rounded-full bg-ink-2" />
        <div className="h-12 w-3/4 rounded-2xl bg-ink-2" />
        <div className="h-40 w-full rounded-2xl bg-ink-2" />
        <div className="h-32 w-full rounded-2xl bg-ink-2" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function labelForKind(
  kind:
    | "draft"
    | "deliverable"
    | "brand-email"
    | "approved-content"
    | "pitch-followup"
): string {
  switch (kind) {
    case "draft":
      return "Draft";
    case "deliverable":
      return "Deliverable";
    case "brand-email":
      return "Brand email";
    case "approved-content":
      return "Ready to post";
    case "pitch-followup":
      return "Follow-up";
  }
}

function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Local-time greeting in the creator's timezone. We tolerate a missing
 * timezone because the Today page can render before `me` lands.
 */
function greetingFor(tz: string | undefined): string {
  if (!tz) return "Hello";
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatToday(tz: string | undefined): string {
  if (!tz) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());
}

function formatBriefDate(briefDateLocal: string): string {
  // briefDateLocal is YYYY-MM-DD; render as "Apr 26".
  const [, m, d] = briefDateLocal.split("-").map(Number);
  if (!m || !d) return briefDateLocal;
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${MONTHS[m - 1]} ${d}`;
}

function formatDue(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timeAgo(ts: number): string {
  const diffMin = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
