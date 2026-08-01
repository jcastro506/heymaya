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
/* Fleet correlation — one incident, not N                                     */
/* -------------------------------------------------------------------------- */

/**
 * Above this share of the checked fleet breaching the SAME way, it is one
 * incident with one cause, not many customers each having a bad day.
 */
export const FLEET_CORRELATION_THRESHOLD = 0.5;

/**
 * Below this many checked accounts, correlation is meaningless.
 *
 * A fleet of one where that one breaches is 100% correlated by arithmetic and
 * zero percent an incident — it's one customer's bad day, and collapsing it
 * would hide the only signal there is. Early on, when the fleet IS small, that
 * distinction is the whole operator surface.
 */
export const FLEET_CORRELATION_MIN_ACCOUNTS = 5;

export interface FleetVerdict {
  correlated: boolean;
  /** The breach kind shared across the fleet, when there is one. */
  dominantKind?: BreachKind;
  affected: number;
  checked: number;
  detail: string;
}

/**
 * Decide whether a set of per-customer breaches is really one fleet incident.
 *
 * Why this exists: a vendor outage makes every customer breach identically. At
 * 200 customers that's 200 support threads and 4,800 error lines a day for a
 * single root cause — an alert storm precisely when something big is wrong,
 * which is when the operator surface most needs to be readable.
 *
 * The per-customer rows are still written; they're the record, and each
 * founder's recap still tells them the truth. What changes is the ESCALATION:
 * one fleet incident instead of N individual ones.
 */
export function correlateFleet(
  perCustomer: ReadonlyArray<{ breaches: ReadonlyArray<Breach> }>,
  checked: number
): FleetVerdict {
  const affected = perCustomer.filter((c) => c.breaches.length > 0).length;
  if (checked < FLEET_CORRELATION_MIN_ACCOUNTS || affected === 0) {
    return {
      correlated: false,
      affected,
      checked,
      detail:
        affected === 0
          ? "no breaches"
          : `${affected} of ${checked} affected — too few accounts to call it a fleet incident`,
    };
  }

  const counts = new Map<BreachKind, number>();
  for (const { breaches } of perCustomer) {
    // One vote per customer per kind, so a customer breaching three ways
    // can't outweigh three customers breaching one way.
    for (const kind of new Set(breaches.map((b) => b.kind))) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }

  let dominantKind: BreachKind | undefined;
  let dominantCount = 0;
  for (const [kind, count] of counts) {
    if (count > dominantCount) {
      dominantKind = kind;
      dominantCount = count;
    }
  }

  const share = dominantCount / checked;
  if (share < FLEET_CORRELATION_THRESHOLD) {
    return {
      correlated: false,
      affected,
      checked,
      detail: `${affected} of ${checked} accounts affected, no single shared cause`,
    };
  }

  return {
    correlated: true,
    dominantKind,
    affected: dominantCount,
    checked,
    detail: `${dominantCount} of ${checked} accounts hit "${dominantKind}" in the same sweep — treating this as one incident, not ${dominantCount}`,
  };
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

    // Walk back day by day. Stops at the first day that HAD a placement, so an
    // old quiet week doesn't inflate a current streak.
    //
    // It ALSO stops at the customer's own creation date, and that clamp is
    // load-bearing: without it a brand-new account looks like seven days of
    // silence on its first evening, because "no placements in the last week"
    // and "failing for a week" are the same query. That opened a support
    // thread for someone who signed up this morning — found by the
    // day-in-the-life composition test, invisible to every unit test, since
    // each piece was individually correct.
    let priorZeroDayStreak = 0;
    for (let back = 1; back <= 7; back += 1) {
      const dayStart = startOfToday - back * 86_400_000;
      const dayEnd = dayStart + 86_400_000;
      if (dayEnd <= customer.createdAt) break;
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
