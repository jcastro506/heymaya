/**
 * Today screen queries — service-business HQ root (`/biz/today`).
 *
 * Per Service Sprint Plan § 12.1, the Today screen is the most-trafficked
 * surface and the spec calls for:
 *   - Morning brief (markdown)
 *   - Today's job schedule
 *   - Jobs-completed-needing-reviews queue
 *   - Pending operator approvals (review-reply drafts, GBP-post drafts)
 *   - Recent activity stream (last 24h)
 *   - Inbound-leads-pending-response counter (red alert if any >2h)
 *
 * Every query here resolves the caller's session via `getCurrentBusinessSession`
 * — there is no client-supplied `businessId` so cross-tenant violations are
 * structurally impossible.
 *
 * Returns `null` / empty arrays for unauth / mid-onboarding / pre-data. The
 * UI uses null vs [] vs populated to drive its three render states (loading
 * vs empty vs filled). Never throw — this surface lives behind a Convex
 * subscription that retries automatically.
 */

import { query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { getCurrentBusinessSession } from "./_session";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/**
 * Latest `dailyBriefs` row for this operator. The brief is keyed off the
 * `creators` (account) row — Maya writes one brief per day per account. The
 * Today screen renders `markdown` directly + iterates `recommendations`.
 *
 * Returns null when no brief has been written yet (Day 0 stage-aware empty).
 */
export const getTodaysBrief = query({
  args: {},
  handler: async (ctx): Promise<Doc<"dailyBriefs"> | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;
    return await ctx.db
      .query("dailyBriefs")
      .withIndex("by_creator", (q) => q.eq("creatorId", session.account._id))
      .order("desc")
      .first();
  },
});

/**
 * Today's scheduled + in-progress jobs, sorted by `scheduledAt`.
 *
 * "Today" is computed in UTC against the operator's timezone; the result
 * window is [today_local 00:00, today_local 23:59:59]. Jobs without a
 * `scheduledAt` (e.g. CRM bookings without a confirmed time) are excluded
 * from this surface — they appear on the Jobs screen filtered list.
 */
export const getTodaysJobs = query({
  args: {},
  handler: async (ctx): Promise<Doc<"serviceJobs">[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];

    const { startMs, endMs } = todayWindowFor(session.business, session.account);
    const all = await ctx.db
      .query("serviceJobs")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .collect();

    return all
      .filter(
        (j) =>
          j.scheduledAt !== undefined &&
          j.scheduledAt >= startMs &&
          j.scheduledAt <= endMs &&
          (j.status === "scheduled" || j.status === "in-progress")
      )
      .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  },
});

/**
 * Pending operator approvals across review replies + GBP posts.
 *
 * Returns a unified list of "items needing your eyes" for the Today screen
 * approvals strip:
 *   - reviews with `replyStatus === "drafted"` (Maya wrote a reply, awaiting
 *     operator approval — Google ReviewReplyState requires it at every tier)
 *   - gbpPosts with `status === "pending"` (drafted post awaiting publish)
 */
export const getPendingApprovals = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    reviewReplies: Doc<"reviews">[];
    gbpPosts: Doc<"gbpPosts">[];
    totalCount: number;
  }> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session)
      return { reviewReplies: [], gbpPosts: [], totalCount: 0 };

    const reviewReplies = await ctx.db
      .query("reviews")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .filter((q) => q.eq(q.field("replyStatus"), "drafted"))
      .order("desc")
      .take(20);

    const gbpPosts = await ctx.db
      .query("gbpPosts")
      .withIndex("by_business_and_status", (q) =>
        q
          .eq("businessId", session.business._id)
          .eq("status", "pending")
      )
      .order("desc")
      .take(20);

    return {
      reviewReplies,
      gbpPosts,
      totalCount: reviewReplies.length + gbpPosts.length,
    };
  },
});

/**
 * Last 24h activity stream. Shape is a unified list of small entries the
 * Today screen renders chronologically. Pulls:
 *   - new reviews                      (`reviews.receivedAt > now - 24h`)
 *   - posts that went live             (`gbpPosts.postedAt > now - 24h`)
 *   - jobs marked completed            (`serviceJobs.completedAt > now - 24h`)
 *   - inbound leads captured           (`inboundLeads.capturedAt > now - 24h`)
 */
export type ActivityEntry =
  | {
      kind: "review";
      id: Id<"reviews">;
      at: number;
      title: string;
      detail: string;
    }
  | {
      kind: "post-published";
      id: Id<"gbpPosts">;
      at: number;
      title: string;
      detail: string;
    }
  | {
      kind: "job-completed";
      id: Id<"serviceJobs">;
      at: number;
      title: string;
      detail: string;
    }
  | {
      kind: "lead-captured";
      id: Id<"inboundLeads">;
      at: number;
      title: string;
      detail: string;
    };

export const getRecentActivity = query({
  args: {},
  handler: async (ctx): Promise<ActivityEntry[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];

    const since = Date.now() - ONE_DAY_MS;
    const businessId = session.business._id;

    const [reviews, posts, jobs, leads] = await Promise.all([
      ctx.db
        .query("reviews")
        .withIndex("by_business_and_received_at", (q) =>
          q.eq("businessId", businessId).gte("receivedAt", since)
        )
        .order("desc")
        .take(20),
      ctx.db
        .query("gbpPosts")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect(),
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business_and_completed_at", (q) =>
          q.eq("businessId", businessId).gte("completedAt", since)
        )
        .order("desc")
        .take(20),
      ctx.db
        .query("inboundLeads")
        .withIndex("by_business_and_captured_at", (q) =>
          q.eq("businessId", businessId).gte("capturedAt", since)
        )
        .order("desc")
        .take(20),
    ]);

    const entries: ActivityEntry[] = [];

    for (const r of reviews) {
      entries.push({
        kind: "review",
        id: r._id,
        at: r.receivedAt,
        title: `${r.starRating}-star review on ${r.platform.toUpperCase()}`,
        detail: truncate(r.body, 140),
      });
    }
    for (const p of posts) {
      if (p.postedAt && p.postedAt >= since) {
        entries.push({
          kind: "post-published",
          id: p._id,
          at: p.postedAt,
          title: "GBP post published",
          detail: truncate(p.text, 140),
        });
      }
    }
    for (const j of jobs) {
      if (j.completedAt) {
        entries.push({
          kind: "job-completed",
          id: j._id,
          at: j.completedAt,
          title: `Job completed: ${j.serviceType ?? "service call"}`,
          detail: j.technicianName ? `By ${j.technicianName}` : "",
        });
      }
    }
    for (const l of leads) {
      entries.push({
        kind: "lead-captured",
        id: l._id,
        at: l.capturedAt,
        title: `New lead via ${humanSource(l.source)}`,
        detail: l.contactName ?? l.contactPhone ?? "Anonymous lead",
      });
    }

    return entries.sort((a, b) => b.at - a.at).slice(0, 30);
  },
});

/**
 * Inbound-leads counter. `pending` is the count of leads with no
 * `operatorRespondedAt`; `overdue` is the subset older than 2h (the red
 * alert threshold per spec § 12.1). The UI shows `pending` as a small badge
 * and `overdue > 0` as a red urgency cue.
 */
export const getInboundLeadsCounter = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{ pending: number; overdue: number }> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return { pending: 0, overdue: 0 };

    const now = Date.now();
    const cutoff = now - TWO_HOURS_MS;
    const leads = await ctx.db
      .query("inboundLeads")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .collect();

    let pending = 0;
    let overdue = 0;
    for (const l of leads) {
      if (l.operatorRespondedAt !== undefined) continue;
      pending++;
      if (l.capturedAt <= cutoff) overdue++;
    }
    return { pending, overdue };
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Compute the [start, end] millisecond window for "today" in the operator's
 * timezone. Falls back to UTC if the timezone string is malformed or
 * unsupported by the runtime.
 */
function todayWindowFor(
  business: Doc<"businesses">,
  account: Doc<"creators">
): { startMs: number; endMs: number } {
  // The business doesn't carry its own timezone field — fall back to the
  // account row's timezone (creator-side schema reuses creators.timezone for
  // both products per the service plan § 8 additive-extension model).
  void business;
  const tz = account.timezone || "UTC";
  const now = new Date();
  try {
    // Build a YYYY-MM-DD string in the operator's tz, then parse back.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const ymd = fmt.format(now);
    const startMs = Date.parse(`${ymd}T00:00:00Z`);
    const endMs = startMs + ONE_DAY_MS - 1;
    return { startMs, endMs };
  } catch {
    const startMs = Math.floor(now.getTime() / ONE_DAY_MS) * ONE_DAY_MS;
    return { startMs, endMs: startMs + ONE_DAY_MS - 1 };
  }
}

function humanSource(source: Doc<"inboundLeads">["source"]): string {
  switch (source) {
    case "gbp-msg":
      return "GBP message";
    case "fb-dm":
      return "Facebook DM";
    case "twilio-missed-call":
      return "missed call";
    case "twilio-sms":
      return "text";
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
