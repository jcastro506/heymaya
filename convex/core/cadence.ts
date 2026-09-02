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

/**
 * ⭐ Is this timestamp in the founder's TODAY?
 *
 * Every "per day" budget in this codebase originally wrote
 * `Math.floor(now / 86_400_000) * 86_400_000` — UTC midnight, which in
 * `America/New_York` starts the day at **20:00 the previous evening**. Seven
 * instances were found on 2026-08-06 across five files: the liveness watchdog,
 * the evening recap, the daily spend ceiling, the throttle alert, the post and
 * video budgets, and her daily proactive-message allowance.
 *
 * Each was silently wrong in the same direction — evening activity counted
 * against the wrong day, so budgets reset at 8pm and a watchdog went blind.
 *
 * Comparing day KEYS rather than doing millisecond arithmetic is also correct
 * across DST, where the offset is not constant and a fixed subtraction is
 * wrong twice a year.
 */
export function isSameDayInZone(
  ts: number,
  now: number,
  timezone: string
): boolean {
  return dayKeyInZone(ts, timezone) === dayKeyInZone(now, timezone);
}

/** Same, for a calendar month — the monthly video and asset budgets. */
export function isSameMonthInZone(
  ts: number,
  now: number,
  timezone: string
): boolean {
  return (
    dayKeyInZone(ts, timezone).slice(0, 7) ===
    dayKeyInZone(now, timezone).slice(0, 7)
  );
}

/**
 * The widest safe lower bound for an index scan of "today in any timezone".
 *
 * Index ranges need a number, and no timezone is more than 26 hours from UTC
 * — so two days back always contains the founder's day, and the key filter
 * above decides actual membership. Scanning two days of one creator's rows is
 * cheaper than being wrong about which day it is.
 */
export function dayScanFloor(now: number): number {
  return now - 2 * 86_400_000;
}

/** The same bound for a month scan: the longest month plus two days of slack. */
export function monthScanFloor(now: number): number {
  return now - 33 * 86_400_000;
}

/** Step back one calendar day from a YYYY-MM-DD key. */
export function previousDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

// The placement-streak `cadence`/`fleetCadence` queries were removed: the creator product
// measures posts-vs-stated-cadence (plan §13.7 L0) and lives in the weekly job. The
// timezone helpers above are the fix for seven UTC bugs and are kept verbatim.

export function weekKeyInZone(ts: number, timezone: string): string {
  const dayKey = dayKeyInZone(ts, timezone);
  // `en-CA` gives YYYY-MM-DD; parsed as UTC midnight it's a stable calendar
  // date with no clock component to drift.
  const asUtc = new Date(`${dayKey}T00:00:00Z`);
  // getUTCDay: 0 = Sunday. Shift so Monday starts the week.
  const shift = (asUtc.getUTCDay() + 6) % 7;
  asUtc.setUTCDate(asUtc.getUTCDate() - shift);
  return `w${asUtc.toISOString().slice(0, 10)}`;
}
