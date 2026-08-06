/**
 * ⭐ The instrument for Sprint 3's exit criterion.
 *
 * §18 calls Sprint 3 *"the gamble"* and says plainly that **nothing past it is
 * worth building until it holds**. The criterion is one sentence:
 *
 * > *a placement a day for seven straight days, verified.*
 *
 * Nothing in this repo could answer it. `placements` has had rows since
 * Sprint 2 and there was no query that returns "how many consecutive days have
 * had one" — so the single gate the whole plan hangs on was going to be
 * evaluated by someone scrolling a table and counting.
 *
 * That is the same shape as every other failure here: a criterion with no
 * instrument is a wish, exactly like a principle with no tool behind it (§13.4).
 *
 * ## What counts, and what doesn't
 *
 * §2.6: **the unit of work is a placement — something live, with a URL.**
 * Drafts and found threads are inventory. So:
 *
 * - `linkStatus: "live"` counts.
 * - `"unknown"` does **not**. A publish we couldn't confirm is exactly the
 *   thing a 7-day claim must not be built on — if we can't open it, we can't
 *   say it happened.
 * - `"gone"` does not. It counts as having happened and then stopped being
 *   true, which the streak should notice rather than paper over.
 *
 * Posts and replies are counted **separately as well as together**, because
 * seven days of replies is not the same achievement as seven days of posts and
 * a single number would hide the difference.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** Sprint 3's number. Here so the test and the report can't disagree. */
export const EXIT_STREAK_DAYS = 7;

/**
 * ⭐ The founder's day, not UTC.
 *
 * This is the trap that has already bitten this codebase once — a double
 * timezone conversion put every cron four hours late. It bites harder here:
 * the evening recap posts at 20:00, and for `America/New_York` that is **01:00
 * UTC the next day**. Counting in UTC would file a Tuesday-evening post as
 * Wednesday, showing two placements on one day and a gap on another.
 *
 * A seven-day streak evaluated in the wrong timezone is not slightly wrong —
 * it reports a broken run as clean, or kills a clean one.
 */
export function dayKeyInZone(ts: number, timezone: string): string {
  // `en-CA` yields YYYY-MM-DD, which sorts lexicographically.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

/** Step back one calendar day from a YYYY-MM-DD key. */
export function previousDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export interface CadenceReport {
  /** Consecutive days ending today (or yesterday) with a live placement. */
  streak: number;
  /** The best run ever recorded, so a broken streak doesn't erase the result. */
  longestStreak: number;
  /** Days in the current streak that had a real post, not only replies. */
  postDays: number;
  replyDays: number;
  /** Has today's placement happened yet? */
  todayDone: boolean;
  /** ⭐ True only when the Sprint 3 gate is genuinely met. */
  exitCriterionMet: boolean;
  /** Every day in the window, newest first — the receipt behind the number. */
  days: Array<{ day: string; posts: number; replies: number }>;
  detail: string;
}

/**
 * ⭐ How many days in a row has something gone live?
 *
 * Deliberately computed at read time from `placements` rather than kept as a
 * counter. A stored streak is a second source of truth that drifts the first
 * time a placement is corrected or a link is found to be dead — and this number
 * decides whether the product's central bet held, so it has to be derived from
 * the rows it claims to summarise.
 */
export const cadence = internalQuery({
  args: {
    customerId: v.id("customers"),
    /** Test seam. The streak is relative to "today", so a fixed clock is the
     *  only way to assert on it without the test breaking at midnight. */
    now: v.optional(v.number()),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CadenceReport> => {
    const now = args.now ?? Date.now();
    const windowDays = args.windowDays ?? 30;

    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    const timezone = customer?.timezone ?? "UTC";

    const placements = (await ctx.db
      .query("placements")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"placements">[];

    /**
     * Only what we can still open. A placement whose link went `gone` did
     * happen, but a seven-day claim we can't demonstrate is worth nothing —
     * the criterion says *verified*.
     */
    const live = placements.filter((p) => p.linkStatus === "live");

    const byDay = new Map<string, { posts: number; replies: number }>();
    for (const p of live) {
      const key = dayKeyInZone(p.publishedAt, timezone);
      const entry = byDay.get(key) ?? { posts: 0, replies: 0 };
      if (p.kind === "post") entry.posts += 1;
      else entry.replies += 1;
      byDay.set(key, entry);
    }

    const today = dayKeyInZone(now, timezone);
    const todayDone = byDay.has(today);

    /**
     * The streak starts at today if today already has one, otherwise at
     * yesterday — because at 09:00 a founder has not yet missed the day, and
     * a report that says "streak: 0" every morning until she posts is a report
     * nobody trusts by Wednesday.
     */
    let cursor = todayDone ? today : previousDay(today);
    let streak = 0;
    let postDays = 0;
    let replyDays = 0;
    while (byDay.has(cursor)) {
      const entry = byDay.get(cursor)!;
      streak += 1;
      if (entry.posts > 0) postDays += 1;
      if (entry.replies > 0) replyDays += 1;
      cursor = previousDay(cursor);
    }

    // The best run ever, so one missed day doesn't erase the evidence.
    const sorted = [...byDay.keys()].sort();
    let longestStreak = 0;
    let run = 0;
    let prev: string | null = null;
    for (const day of sorted) {
      run = prev !== null && previousDay(day) === prev ? run + 1 : 1;
      prev = day;
      if (run > longestStreak) longestStreak = run;
    }

    const days = sorted
      .slice(-windowDays)
      .reverse()
      .map((day) => ({ day, ...byDay.get(day)! }));

    /**
     * ⭐ The gate. Seven consecutive days, and **at least one real post** among
     * them — seven days of nothing but replies is not what §18 is asking for.
     */
    const exitCriterionMet = streak >= EXIT_STREAK_DAYS && postDays > 0;

    return {
      streak,
      longestStreak,
      postDays,
      replyDays,
      todayDone,
      exitCriterionMet,
      days,
      detail:
        live.length === 0
          ? "nothing has gone live yet"
          : exitCriterionMet
            ? `${streak} days running — the seven-day bar is met`
            : streak === 0
              ? `nothing live yesterday${todayDone ? "" : " or today"} — the run is broken`
              : `${streak} of ${EXIT_STREAK_DAYS} days${todayDone ? "" : ", today still open"}`,
    };
  },
});

/**
 * The same number for every active customer — how the operator sees whether the
 * bet is holding across the fleet rather than for the one tenant they happen to
 * be watching.
 */
export const fleetCadence = internalQuery({
  args: { now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<
    Array<{ customerId: Id<"customers">; streak: number; todayDone: boolean }>
  > => {
    const now = args.now ?? Date.now();
    const customers = (await ctx.db
      .query("customers")
      .collect()) as Doc<"customers">[];

    const rows: Array<{
      customerId: Id<"customers">;
      streak: number;
      todayDone: boolean;
    }> = [];

    for (const customer of customers.filter((c) => c.state === "active")) {
      const placements = (await ctx.db
        .query("placements")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
        .collect()) as Doc<"placements">[];

      const timezone = customer.timezone ?? "UTC";
      const dayKeys = new Set(
        placements
          .filter((p) => p.linkStatus === "live")
          .map((p) => dayKeyInZone(p.publishedAt, timezone))
      );

      const today = dayKeyInZone(now, timezone);
      const todayDone = dayKeys.has(today);
      let cursor = todayDone ? today : previousDay(today);
      let streak = 0;
      while (dayKeys.has(cursor)) {
        streak += 1;
        cursor = previousDay(cursor);
      }
      rows.push({ customerId: customer._id, streak, todayDone });
    }

    return rows;
  },
});
