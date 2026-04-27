/**
 * Reviews screen queries — `/biz/reviews`.
 *
 * Per Service Sprint Plan § 12.3:
 *   - Multi-platform review feed (GBP / FB / Yelp monitor-only)
 *   - Drafted-replies inline approval queue
 *   - Reply-status tracker (drafted → approved → posted → moderation outcome)
 *   - Sentiment trend chart (last 90d)
 *   - Unmatched-customer surfacing
 *
 * Plan-tier:
 *   - Starter: manual queue only — `replyStatus` rows still readable, but
 *     auto-draft is gated server-side at the WRITE layer (not here).
 *   - Pro+:    auto-draft + auto-send-on-approve, surfaced as toggles in
 *     Profile § approvalRules.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { getCurrentBusinessSession } from "./_session";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const REVIEW_PLATFORM = v.union(
  v.literal("gbp"),
  v.literal("fb"),
  v.literal("yelp")
);

const REPLY_STATUS = v.union(
  v.literal("drafted"),
  v.literal("approved"),
  v.literal("posted"),
  v.literal("rejected")
);

/**
 * Multi-platform review list with optional filters. Returns most-recent
 * first. The UI uses `sentiment` to color-code rows + `customerMatchedJobId`
 * to surface unmatched-customer warnings.
 */
export const listReviews = query({
  args: {
    platform: v.optional(REVIEW_PLATFORM),
    replyStatus: v.optional(REPLY_STATUS),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"reviews">[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];

    const limit = clampLimit(args.limit);

    let q;
    if (args.platform !== undefined) {
      const platform = args.platform;
      q = ctx.db
        .query("reviews")
        .withIndex("by_business_and_platform", (b) =>
          b.eq("businessId", session.business._id).eq("platform", platform)
        );
    } else {
      q = ctx.db
        .query("reviews")
        .withIndex("by_business_and_received_at", (b) =>
          b.eq("businessId", session.business._id)
        );
    }

    const rows = await q.order("desc").collect();
    const filtered = args.replyStatus
      ? rows.filter((r) => r.replyStatus === args.replyStatus)
      : rows;

    return filtered.slice(0, limit);
  },
});

/**
 * Drafted-reply queue. Subset of `listReviews` that the Today screen and
 * the Reviews approval-queue tab read directly. Returns reviews where Maya
 * has written a draft awaiting operator approval.
 *
 * CRITICAL: Google ReviewReplyState moderation requires operator approval
 * on every reply at every plan tier. There is no auto-approve path. The
 * write-layer mutation that flips `replyStatus` to `posted` enforces this
 * — this query just surfaces the queue.
 */
export const getDraftedReplies = query({
  args: {},
  handler: async (ctx): Promise<Doc<"reviews">[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];

    return await ctx.db
      .query("reviews")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .filter((q) => q.eq(q.field("replyStatus"), "drafted"))
      .order("desc")
      .take(50);
  },
});

/**
 * Sentiment-trend bucket points for the last 90 days. Returns one
 * `{ dayOffsetFromToday, positive, neutral, negative }` per day with at
 * least one review. Days with zero reviews are omitted (the UI line chart
 * connects existing points). Limit is enforced at 90 entries to bound the
 * query cost.
 */
export type SentimentBucket = {
  /** ISO date string (YYYY-MM-DD) in operator's timezone — keyed for stability. */
  dayKey: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
};

export const getSentimentTrend = query({
  args: {},
  handler: async (ctx): Promise<SentimentBucket[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];

    const since = Date.now() - NINETY_DAYS_MS;
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_business_and_received_at", (q) =>
        q.eq("businessId", session.business._id).gte("receivedAt", since)
      )
      .collect();

    const buckets = new Map<string, SentimentBucket>();
    for (const r of reviews) {
      const dayKey = ymd(r.receivedAt);
      const existing = buckets.get(dayKey) ?? {
        dayKey,
        positive: 0,
        neutral: 0,
        negative: 0,
        total: 0,
      };
      if (r.sentiment === "positive") existing.positive++;
      else if (r.sentiment === "negative") existing.negative++;
      else existing.neutral++;
      existing.total++;
      buckets.set(dayKey, existing);
    }

    return Array.from(buckets.values()).sort((a, b) =>
      a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0
    );
  },
});

/**
 * Reviews where Maya could not match the reviewer to an existing customer
 * row. Surfaces "this review mentions Sarah but no Sarah in your CRM" so
 * the operator can manually link or import.
 */
export const getUnmatchedReviews = query({
  args: {},
  handler: async (ctx): Promise<Doc<"reviews">[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];
    return await ctx.db
      .query("reviews")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .filter((q) => q.eq(q.field("customerMatchedJobId"), undefined))
      .order("desc")
      .take(20);
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (limit < 1) return 1;
  if (limit > 200) return 200;
  return Math.floor(limit);
}

/**
 * UTC YYYY-MM-DD for sentiment bucketing. We deliberately use UTC rather
 * than the operator's tz so the bucket boundary is stable across DST
 * transitions — the chart shows trend, not exact-time-of-day.
 */
function ymd(timestampMs: number): string {
  const d = new Date(timestampMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
