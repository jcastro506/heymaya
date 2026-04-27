/**
 * Today screen — service-business HQ root.
 *
 * Per Service Sprint Plan § 12.1. Mobile-first vertical scroll, 390px-clean.
 * Real-time Convex subscriptions on every section.
 *
 * Section order (top of phone → bottom):
 *   1. Greeting          — Maya's voice
 *   2. Inbound-leads counter (red if any >2h)
 *   3. Brief (markdown)  — Day-0 stage-aware empty state
 *   4. Pending approvals (review-reply drafts + GBP-post drafts)
 *   5. Today's job schedule
 *   6. Last-24h activity stream
 */

"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  AlarmClock,
  CheckCircle2,
  Hammer,
  MailCheck,
  MessageSquareText,
  Phone,
  Star,
} from "lucide-react";
import { Section } from "@/components/business/Section";
import { EmptyState } from "@/components/business/EmptyState";
import { JobCard } from "@/components/business/JobCard";
import { MarkdownLite } from "@/components/business/MarkdownLite";
import { MayaContributionCard } from "@/components/business/growth/MayaContributionCard";

export default function TodayPage() {
  const profile = useQuery(api.queries.business.profile.getProfile);
  const brief = useQuery(api.queries.business.today.getTodaysBrief);
  const todaysJobs = useQuery(api.queries.business.today.getTodaysJobs);
  const approvals = useQuery(api.queries.business.today.getPendingApprovals);
  const activity = useQuery(api.queries.business.today.getRecentActivity);
  const leadsCounter = useQuery(
    api.queries.business.today.getInboundLeadsCounter
  );
  const mayaContribution = useQuery(
    api.queries.business.growth.getMayaContributionThisWeek
  );

  if (profile === undefined) {
    return <BootSkeleton />;
  }

  if (profile === null) {
    return (
      <div className="px-5 py-12 sm:px-8">
        <EmptyState
          stage="fresh"
          title="Finish onboarding"
          body="Your business profile is mid-setup. Resume the conversational flow to deploy your Maya."
          cta={{ label: "Continue onboarding", href: "/onboarding/business" }}
        />
      </div>
    );
  }

  const firstName = (profile.account.email ?? "").split("@")[0] || "operator";
  const greet = greetingFor(profile.account.timezone);

  return (
    <div className="pb-12 pt-4 sm:pt-6">
      {/* Wave C.7 — Maya's contribution this week. Renders nothing on Day-0
          accounts; renders a 3-stat card otherwise. Sits ABOVE the greeting
          so it's the first thing the operator sees. */}
      <MayaContributionCard data={mayaContribution} />

      {/* Greeting */}
      <Section
        eyebrow={`Today · ${formatToday(profile.account.timezone)}`}
        title={`${greet}, ${firstName}.`}
        caption="Maya watches your reviews, leads, and posts in the background. Anything that needs your eyes is below."
        rightSlot={
          <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            {profile.business.planTier ?? "starter"} plan
          </span>
        }
        variant="tight"
      />

      {/* Inbound leads counter — red alert if any > 2h */}
      {leadsCounter && leadsCounter.pending > 0 && (
        <div className="mx-auto mt-5 w-full max-w-5xl px-5 sm:px-8">
          <div
            data-testid="biz-today-leads-counter"
            data-overdue={leadsCounter.overdue > 0 ? "true" : "false"}
            className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
              leadsCounter.overdue > 0
                ? "border-rose-300/40 bg-rose-300/5"
                : "border-amber-300/40 bg-amber-300/5"
            }`}
          >
            <div className="flex items-center gap-3">
              <AlarmClock
                className={`h-4 w-4 ${
                  leadsCounter.overdue > 0
                    ? "text-rose-300"
                    : "text-amber-200"
                }`}
                aria-hidden
              />
              <div>
                <div className="text-sm font-medium text-paper">
                  {leadsCounter.pending} unanswered lead
                  {leadsCounter.pending === 1 ? "" : "s"}
                </div>
                {leadsCounter.overdue > 0 && (
                  <div className="text-xs text-rose-200">
                    {leadsCounter.overdue} older than 2 hours — Maya nudged.
                    Reply now if you can.
                  </div>
                )}
              </div>
            </div>
            <Link
              href="/biz/today#leads"
              className="rounded-full border border-[var(--hairline-strong)] bg-ink-3 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-paper"
            >
              Review
            </Link>
          </div>
        </div>
      )}

      {/* Brief */}
      <Section
        eyebrow="Maya's brief"
        title={brief ? "This morning" : "First brief incoming"}
      >
        {brief ? (
          <article className="rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-5">
            <MarkdownLite source={brief.markdown} />
          </article>
        ) : (
          <EmptyState
            stage="fresh"
            title="Maya is reading your reviews"
            body="Your first morning brief lands at 7am tomorrow in your timezone. Until then, she's quietly mapping your customers, posts, and competitors."
          />
        )}
      </Section>

      {/* Pending approvals */}
      <Section
        eyebrow="Pending approvals"
        title={
          approvals && approvals.totalCount > 0
            ? `${approvals.totalCount} item${approvals.totalCount === 1 ? "" : "s"} need your eyes`
            : "Inbox zero"
        }
        caption="Review replies and GBP posts Maya drafted overnight. Approval is required at every plan tier — Google won't auto-publish review responses."
      >
        {approvals && approvals.totalCount > 0 ? (
          <div className="space-y-3">
            {approvals.reviewReplies.slice(0, 3).map((r) => (
              <div
                key={r._id}
                data-testid="biz-today-pending-review"
                className="flex items-start gap-3 rounded-xl border border-[var(--hairline)] bg-ink-2/60 p-4"
              >
                <Star className="mt-1 h-4 w-4 text-lime" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-paper">
                    Reply draft for {r.reviewerName}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-paper-dim">
                    {r.draftReply ?? r.body}
                  </p>
                </div>
                <Link
                  href="/biz/reviews"
                  className="shrink-0 rounded-full border border-[var(--hairline-strong)] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-paper"
                >
                  Open
                </Link>
              </div>
            ))}
            {approvals.gbpPosts.slice(0, 3).map((p) => (
              <div
                key={p._id}
                data-testid="biz-today-pending-post"
                className="flex items-start gap-3 rounded-xl border border-[var(--hairline)] bg-ink-2/60 p-4"
              >
                <MailCheck className="mt-1 h-4 w-4 text-lime" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-paper">
                    GBP post draft
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-paper-dim">
                    {p.text}
                  </p>
                </div>
                <Link
                  href="/biz/posts"
                  className="shrink-0 rounded-full border border-[var(--hairline-strong)] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-paper"
                >
                  Open
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--hairline)] bg-ink-2/40 px-4 py-3 text-sm text-paper-dim">
            <CheckCircle2 className="h-4 w-4 text-lime" aria-hidden />
            <span>Nothing waiting on you. Maya will text when something lands.</span>
          </div>
        )}
      </Section>

      {/* Today's job schedule */}
      <Section
        eyebrow="Today's schedule"
        title="Jobs on the calendar"
      >
        {todaysJobs && todaysJobs.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {todaysJobs.map((j) => (
              <JobCard
                key={j._id}
                job={j}
                testId="biz-today-job"
              />
            ))}
          </div>
        ) : (
          <EmptyState
            stage="ready"
            title="No jobs on the schedule"
            body="When your CRM syncs or you text Maya about a completed job, it'll show up here."
            icon={Hammer}
          />
        )}
      </Section>

      {/* 24h activity stream */}
      <Section
        eyebrow="Last 24 hours"
        title="Activity"
        caption="Reviews, posts, jobs, and leads — chronological."
      >
        {activity && activity.length > 0 ? (
          <ul className="space-y-2">
            {activity.map((entry) => (
              <li
                key={`${entry.kind}:${entry.id}`}
                data-testid="biz-today-activity-row"
                data-kind={entry.kind}
                className="flex items-start gap-3 rounded-xl border border-[var(--hairline)] bg-ink-2/40 p-3 text-sm"
              >
                <ActivityIcon kind={entry.kind} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-paper">{entry.title}</div>
                  {entry.detail && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-paper-faint">
                      {entry.detail}
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                  {timeAgo(entry.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-paper-faint">
            Quiet day so far. Maya will surface anything that lands here.
          </p>
        )}
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function ActivityIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "review":
      return <Star className="h-4 w-4 text-lime" aria-hidden />;
    case "post-published":
      return <MailCheck className="h-4 w-4 text-sky-300" aria-hidden />;
    case "job-completed":
      return <CheckCircle2 className="h-4 w-4 text-paper-dim" aria-hidden />;
    case "lead-captured":
      return <Phone className="h-4 w-4 text-amber-200" aria-hidden />;
    default:
      return <MessageSquareText className="h-4 w-4 text-paper-faint" aria-hidden />;
  }
}

function BootSkeleton() {
  return (
    <div
      data-testid="biz-today-boot-skeleton"
      className="px-5 py-10 sm:px-8 sm:py-14"
    >
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="h-9 w-3/5 animate-pulse rounded bg-ink-3" />
        <div className="h-32 animate-pulse rounded-2xl bg-ink-3" />
        <div className="h-24 animate-pulse rounded-2xl bg-ink-3" />
      </div>
    </div>
  );
}

function greetingFor(timezone: string | undefined): string {
  try {
    const hour = parseInt(
      new Date().toLocaleString("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: timezone || "UTC",
      }),
      10
    );
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  } catch {
    return "Hello";
  }
}

function formatToday(timezone: string | undefined): string {
  try {
    return new Date().toLocaleDateString(undefined, {
      timeZone: timezone || "UTC",
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  } catch {
    return new Date().toDateString();
  }
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
