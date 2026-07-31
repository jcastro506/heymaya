/**
 * The liveness contract (§12).
 *
 * > **A system cannot be the watchdog for itself.**
 *
 * This runs as a server cron independent of every worker. That independence is
 * the entire point: the agent reporting its own health is worth nothing,
 * because the failure mode that matters most is the agent not running at all.
 * A dead worker files no complaints.
 *
 * ## What it checks, hourly
 *
 * Expected placements per day · brief sent · recap sent · consecutive zero
 * days. Plus two fleet-wide vendor balances, because either hitting zero is a
 * simultaneous outage for every customer rather than one customer's bad day.
 *
 * ## The rule underneath the escalation table
 *
 * > **Honest silence beats fake activity.**
 *
 * *"Nothing went out — your Instagram token expired, here's the reconnect
 * link"* is a good message. *"Found 22 posts!"* on a zero-placement day is a
 * lie by framing, and it is what shipped. So every breach here resolves to
 * either a concrete repair or an honest statement — never to activity that
 * looks like progress.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { dayKey } from "./dailyReport";

/* -------------------------------------------------------------------------- */
/* The contract                                                                */
/* -------------------------------------------------------------------------- */

/** The brief is due early; two hours late is a breach, not a delay. */
export const BRIEF_DUE_HOUR_UTC = 7;
export const BRIEF_GRACE_HOURS = 2;
/** By this hour a working day should have produced something. */
export const ZERO_PLACEMENT_CHECK_HOUR_UTC = 18;
export const RECAP_DUE_HOUR_UTC = 19;

export type BreachKind =
  | "brief_missed"
  | "recap_missed"
  | "zero_placements_today"
  | "zero_day_streak";

export type BreachAction =
  | "reenqueue_brief"
  | "diagnose_and_report"
  | "state_plainly_in_recap"
  | "operator_alert_and_tell_founder"
  | "open_support_thread";

export interface Breach {
  kind: BreachKind;
  action: BreachAction;
  /** Plain language. Reaches the founder or the operator unchanged. */
  detail: string;
  /** How many consecutive zero days, where that's the trigger. */
  streak?: number;
}

export interface LivenessInput {
  now: number;
  hourUtc: number;
  briefSentToday: boolean;
  recapSentToday: boolean;
  placementsToday: number;
  /** Consecutive prior days with zero placements, not counting today. */
  priorZeroDayStreak: number;
  /** Paused and cancelled accounts are SUPPOSED to be quiet. */
  customerState: Doc<"customers">["state"];
  /** Set when something already knows why — a dead token, a spend throttle. */
  knownReason?: string;
}

/**
 * Evaluate one customer against the contract.
 *
 * Returns every breach rather than the first: a stalled account usually
 * breaches several clauses at once, and reporting them one hour at a time
 * turns a single incident into a week of drip-fed alerts.
 */
export function evaluate(input: LivenessInput): Breach[] {
  const {
    hourUtc,
    briefSentToday,
    recapSentToday,
    placementsToday,
    priorZeroDayStreak,
    customerState,
    knownReason,
  } = input;

  // A paused or cancelled account producing nothing is the system working.
  // Alerting on it is how an operator learns to ignore alerts.
  if (customerState !== "active") return [];

  const breaches: Breach[] = [];

  if (!briefSentToday && hourUtc >= BRIEF_DUE_HOUR_UTC + BRIEF_GRACE_HOURS) {
    breaches.push({
      kind: "brief_missed",
      action: "reenqueue_brief",
      // Once. A re-enqueue loop on a broken brief is a message storm.
      detail: "the morning brief didn't go out — re-sending it once",
    });
  }

  if (!recapSentToday && hourUtc >= RECAP_DUE_HOUR_UTC + BRIEF_GRACE_HOURS) {
    breaches.push({
      kind: "recap_missed",
      action: "diagnose_and_report",
      detail: "the evening recap didn't go out",
    });
  }

  if (placementsToday === 0 && hourUtc >= ZERO_PLACEMENT_CHECK_HOUR_UTC) {
    const streak = priorZeroDayStreak + 1;

    // Escalation is by STREAK, and the wording changes with it. A first quiet
    // day is worth a sentence; three is a support thread.
    if (streak >= 3) {
      breaches.push({
        kind: "zero_day_streak",
        action: "open_support_thread",
        detail: knownReason
          ? `nothing has gone out for ${streak} days — ${knownReason}`
          : `nothing has gone out for ${streak} days and I don't have a clear reason`,
        streak,
      });
    } else if (streak === 2) {
      breaches.push({
        kind: "zero_day_streak",
        action: "operator_alert_and_tell_founder",
        detail: knownReason
          ? `nothing went out today or yesterday — ${knownReason}`
          : "nothing went out today or yesterday",
        streak,
      });
    } else {
      breaches.push({
        kind: "zero_placements_today",
        action: knownReason ? "state_plainly_in_recap" : "diagnose_and_report",
        detail: knownReason
          ? `nothing went out today — ${knownReason}`
          : "nothing went out today and I don't yet know why",
        streak,
      });
    }
  }

  return breaches;
}

/* -------------------------------------------------------------------------- */
/* Fleet-wide vendor balances                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Reserves, in vendor credits.
 *
 * Set well above zero on purpose: hitting zero is a simultaneous outage for
 * every customer at once, and the gap between "alert" and "dead" has to be
 * wide enough to actually buy more.
 */
export const CREDIT_RESERVES = {
  scrapecreators: 500,
  creatify: 100,
} as const;

export type BalanceVerdict = "ok" | "low" | "critical";

export interface BalanceCheck {
  vendor: keyof typeof CREDIT_RESERVES;
  balance: number;
  verdict: BalanceVerdict;
  detail: string;
}

/**
 * Judge a fleet balance.
 *
 * `low` means alert now, keep working. `critical` is below a quarter of the
 * reserve — close enough that the next sweep may find zero, which is a
 * fleet-wide outage rather than a degraded day.
 */
export function checkBalance(
  vendor: keyof typeof CREDIT_RESERVES,
  balance: number
): BalanceCheck {
  const reserve = CREDIT_RESERVES[vendor];
  const verdict: BalanceVerdict =
    balance <= reserve / 4 ? "critical" : balance <= reserve ? "low" : "ok";
  const detail =
    verdict === "ok"
      ? `${balance} credits`
      : verdict === "critical"
        ? `${vendor} is at ${balance} credits — every customer stops when this hits zero`
        : `${vendor} is at ${balance} credits, below the ${reserve} reserve`;
  return { vendor, balance, verdict, detail };
}

/* -------------------------------------------------------------------------- */
/* Convex                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Gather the facts for one customer. Deliberately a query with no judgment in
 * it — `evaluate` decides, and it's pure so every branch is testable.
 */
export const gatherFacts = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<Omit<LivenessInput, "knownReason"> | null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return null;

    const now = args.now ?? Date.now();
    const startOfToday = Math.floor(now / 86_400_000) * 86_400_000;
    const today = dayKey(now);

    const messages = (await ctx.db
      .query("messages")
      .withIndex("by_customer_and_ts", (q) =>
        q.eq("customerId", args.customerId).gte("ts", startOfToday - 86_400_000 * 8)
      )
      .collect()) as Doc<"messages">[];

    const briefSentToday = messages.some(
      (m) => m.dedupeKey === `brief:${today}`
    );
    const recapSentToday = messages.some(
      (m) => m.dedupeKey === `recap:${today}`
    );

    const placements = (await ctx.db
      .query("placements")
      .withIndex("by_customer_and_publishedAt", (q) =>
        q
          .eq("customerId", args.customerId)
          .gte("publishedAt", startOfToday - 86_400_000 * 8)
      )
      .collect()) as Doc<"placements">[];

    const placementsToday = placements.filter(
      (p) => p.publishedAt >= startOfToday
    ).length;

    // Walk back day by day. Stops at the first day that HAD a placement, so
    // an old quiet week doesn't inflate a current streak.
    let priorZeroDayStreak = 0;
    for (let back = 1; back <= 7; back += 1) {
      const dayStart = startOfToday - back * 86_400_000;
      const dayEnd = dayStart + 86_400_000;
      const had = placements.some(
        (p) => p.publishedAt >= dayStart && p.publishedAt < dayEnd
      );
      if (had) break;
      priorZeroDayStreak += 1;
    }

    return {
      now,
      hourUtc: new Date(now).getUTCHours(),
      briefSentToday,
      recapSentToday,
      placementsToday,
      priorZeroDayStreak,
      customerState: customer.state,
    };
  },
});
