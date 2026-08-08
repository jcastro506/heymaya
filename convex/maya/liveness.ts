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
import { internalAction, internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { dayKeyInZone, previousDay as previousDayKey } from "./cadence";

/* -------------------------------------------------------------------------- */
/* The contract                                                                */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ All three are hours in the FOUNDER's timezone, not UTC.
 *
 * They were `*_HOUR_UTC` and compared against `new Date(now).getUTCHours()`.
 * For `America/New_York` that put the "has anything gone out today?" check at
 * 14:00 local and the recap deadline at 15:00 — before the recap is even due
 * at 20:00. Renamed rather than re-based so the next reader cannot repeat the
 * mistake by reading the name and believing it.
 */
export const BRIEF_DUE_HOUR_LOCAL = 7;
export const BRIEF_GRACE_HOURS = 2;
/** By this hour a working day should have produced something. */
export const ZERO_PLACEMENT_CHECK_HOUR_LOCAL = 18;
export const RECAP_DUE_HOUR_LOCAL = 21;

export type BreachKind =
  | "brief_missed"
  | "recap_missed"
  | "zero_placements_today"
  | "zero_day_streak"
  | "memory_not_checkpointed"
  | "context_truncated";

export type BreachAction =
  | "reenqueue_brief"
  | "diagnose_and_report"
  | "state_plainly_in_recap"
  | "operator_alert_and_tell_founder"
  | "open_support_thread"
  | "operator_alert_only";

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
  /** The hour of day where the FOUNDER is — never UTC. */
  hourLocal: number;
  briefSentToday: boolean;
  recapSentToday: boolean;
  placementsToday: number;
  /** Consecutive prior days with zero placements, not counting today. */
  priorZeroDayStreak: number;
  /** Paused and cancelled accounts are SUPPOSED to be quiet. */
  customerState: Doc<"customers">["state"];
  /** Set when something already knows why — a dead token, a spend throttle. */
  knownReason?: string;
  /**
   * Hours since her memory was last mirrored off the machine (§2.9.6).
   *
   * When she has never checkpointed, this is measured from the account's
   * creation, NOT left undefined — otherwise a customer who signed up an hour
   * ago is instantly "never backed up", which is the same shape as the
   * zero-day-streak bug that opened a support thread for someone on their first
   * morning. A new account hasn't failed to do something; it hasn't been around
   * long enough to do it yet.
   */
  hoursSinceCheckpoint?: number;
  /** False when there has never been one — changes the wording, not the clock. */
  everCheckpointed?: boolean;
  /**
   * OpenClaw reported at the last checkpoint that it is truncating the injected
   * copy of her bootstrap context.
   *
   * NOT data loss — the files stay intact on disk — but she stops seeing the
   * tail of whatever got cut, which on `MEMORY.md` means quietly forgetting the
   * oldest durable facts while appearing to work normally.
   */
  contextTruncated?: boolean;
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
    hourLocal,
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

  // Memory checkpointing. Two full days of grace so one missed daily cron
  // doesn't page anyone — but a machine that has gone a week without mirroring
  // its memory is one volume failure away from losing all of it.
  if (
    input.hoursSinceCheckpoint === undefined ||
    input.hoursSinceCheckpoint > 48
  ) {
    breaches.push({
      kind: "memory_not_checkpointed",
      action: "operator_alert_only",
      detail:
        input.everCheckpointed === false
          ? "her memory has never been copied off the machine"
          : `her memory hasn't been copied off the machine in ${Math.floor(input.hoursSinceCheckpoint ?? 0)}h`,
    });
  }

  // Operator-only on purpose: the founder cannot act on this and telling them
  // their agent's context is truncated is noise dressed as transparency.
  if (input.contextTruncated) {
    breaches.push({
      kind: "context_truncated",
      action: "operator_alert_only",
      detail:
        "her bootstrap context is being truncated — she's losing the tail of her own instructions",
    });
  }

  if (!briefSentToday && hourLocal >= BRIEF_DUE_HOUR_LOCAL + BRIEF_GRACE_HOURS) {
    breaches.push({
      kind: "brief_missed",
      action: "reenqueue_brief",
      // Once. A re-enqueue loop on a broken brief is a message storm.
      detail: "the morning brief didn't go out — re-sending it once",
    });
  }

  if (!recapSentToday && hourLocal >= RECAP_DUE_HOUR_LOCAL + BRIEF_GRACE_HOURS) {
    breaches.push({
      kind: "recap_missed",
      action: "diagnose_and_report",
      detail: "the evening recap didn't go out",
    });
  }

  if (placementsToday === 0 && hourLocal >= ZERO_PLACEMENT_CHECK_HOUR_LOCAL) {
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
  /**
   * ⭐ OpenRouter, in **US dollars** rather than vendor credits — its balance
   * simply is a dollar figure.
   *
   * Added 2026-08-06, and it is the one that mattered: this table watched the
   * two vendors that were fine and not the one that pays for every model call
   * she makes. §7.2's own COGS work says the LLM is cost driver #1. A live
   * read that day found **$26.16 left of $2,535** — mid-way through the
   * seven-day run — with nothing anywhere that would have said so.
   *
   * Set high on purpose. Hitting zero doesn't degrade her, it stops her
   * mid-sentence for every customer at once, so the threshold has to leave
   * time to notice and top up — and this account has burned $22 in a single
   * hour during a runaway, so a small cushion is no cushion at all.
   *
   * ⚠️ At $75 this fires on the CURRENT balance ($26 on 2026-08-06),
   * immediately. That is the alert working, not a misconfiguration.
   */
  openrouter: 75,
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

  /**
   * ⚠️ OpenRouter's balance is DOLLARS; the other two are vendor credits.
   *
   * The first live run of this alert read *"openrouter is at
   * 25.92035670899986 credits, below the 75 reserve"* — the wrong unit and
   * fifteen decimal places, in a line an operator reads at a glance. It is a
   * small thing that makes a real alert look like a debug print, which is how
   * alerts start getting ignored.
   */
  const DOLLARS = new Set<keyof typeof CREDIT_RESERVES>(["openrouter"]);
  const amount = DOLLARS.has(vendor)
    ? `$${balance.toFixed(2)}`
    : `${Math.round(balance)} credits`;
  const limit = DOLLARS.has(vendor) ? `$${reserve}` : `${reserve}`;

  const detail =
    verdict === "ok"
      ? amount
      : verdict === "critical"
        ? `${vendor} is at ${amount} — every customer stops when this hits zero`
        : `${vendor} is at ${amount}, below the ${limit} reserve`;
  return { vendor, balance, verdict, detail };
}

/* -------------------------------------------------------------------------- */
/* Convex                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Gather the facts for one customer. Deliberately a query with no judgment in
 * it — `evaluate` decides, and it's pure so every branch is testable.
 */
/** The founder's timezone, for anything the sweep keys per day. */
export const timezoneFor = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<string> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    return customer?.timezone ?? "UTC";
  },
});

export const gatherFacts = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<Omit<LivenessInput, "knownReason"> | null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return null;

    const now = args.now ?? Date.now();
    const timezone = customer.timezone ?? "UTC";

    /**
     * ⭐ Every boundary in this function is the FOUNDER's day, not UTC.
     *
     * Until 2026-08-06 it was `floor(now / 86_400_000) * 86_400_000`, which in
     * `America/New_York` starts "today" at **20:00 the previous evening**.
     * Observed live: she published four times on the evening of 08-05, and at
     * 11:57 on 08-06 this function reported `placementsToday: 5` while cadence
     * — counting in her timezone — correctly reported zero.
     *
     * ⚠️ That is not a cosmetic drift. `evaluate()` gates the whole
     * zero-placement escalation on `placementsToday === 0`, so a non-zero count
     * carried over from last night **suppresses the alert entirely**. And
     * because she posts in the evening, the suppression was not an edge case —
     * it was the normal pattern. The watchdog was blind on exactly the days it
     * existed for.
     */
    const today = dayKeyInZone(now, timezone);
    const windowStart = now - 9 * 86_400_000;

    const messages = (await ctx.db
      .query("messages")
      .withIndex("by_customer_and_ts", (q) =>
        q.eq("customerId", args.customerId).gte("ts", windowStart)
      )
      .collect()) as Doc<"messages">[];

    const briefSentToday = messages.some(
      (m) => m.dedupeKey === `brief:${today}`
    );
    const recapSentToday = messages.some(
      (m) => m.dedupeKey === `recap:${today}`
    );

    /**
     * ⭐ `linkStatus === "live"` only — the same rule cadence.ts applies.
     *
     * These two functions both answer "did anything go out?", and they must
     * not answer it differently. An `"unknown"` placement is a publish we
     * could not confirm; counting it here would suppress the alert on exactly
     * the day the alert is most warranted — we published something and cannot
     * open it. §2.6: the unit of work is something *live, with a URL*.
     */
    const placements = (
      (await ctx.db
        .query("placements")
        .withIndex("by_customer_and_publishedAt", (q) =>
          q.eq("customerId", args.customerId).gte("publishedAt", windowStart)
        )
        .collect()) as Doc<"placements">[]
    ).filter((p) => p.linkStatus === "live");

    const placementDays = new Set(
      placements.map((p) => dayKeyInZone(p.publishedAt, timezone))
    );
    const placementsToday = placements.filter(
      (p) => dayKeyInZone(p.publishedAt, timezone) === today
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
    let cursor = previousDayKey(today);
    for (let back = 1; back <= 7; back += 1) {
      // The creation clamp, still in the founder's timezone: a day that ended
      // before the account existed is not a day she was silent.
      if (dayKeyInZone(customer.createdAt, timezone) > cursor) break;
      if (placementDays.has(cursor)) break;
      priorZeroDayStreak += 1;
      cursor = previousDayKey(cursor);
    }

    // The machine's last self-report. Absent means it has never checked in,
    // which is a different (and worse) signal than a stale one.
    const checkpoint = (await ctx.db
      .query("memorySnapshots")
      .withIndex("by_customer_and_capturedAt", (q) =>
        q.eq("customerId", args.customerId)
      )
      .order("desc")
      .first()) as Doc<"memorySnapshots"> | null;

    return {
      now,
      hourLocal: Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          hour: "2-digit",
          hour12: false,
        }).format(new Date(now))
      ),
      briefSentToday,
      recapSentToday,
      placementsToday,
      priorZeroDayStreak,
      customerState: customer.state,
      // Clamped to account age when she has never checked in — see the field
      // docs. A two-hour-old account is two hours behind, not infinitely.
      hoursSinceCheckpoint:
        (now - (checkpoint?.capturedAt ?? customer.createdAt)) / 3_600_000,
      everCheckpointed: checkpoint !== null,
      contextTruncated: checkpoint?.contextTruncated === true,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Reading the balances — the part that was missing                            */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ Fetch what's actually left, so `checkBalance` has something to judge.
 *
 * `CREDIT_RESERVES` and `checkBalance` have existed since Sprint 6 with **no
 * caller** — the twentieth such find this week, and the one with the widest
 * blast radius. Nothing ever asked a vendor how much credit remained, so the
 * fleet could reach zero and the first anyone would know is every customer's
 * sweeps failing at once.
 *
 * ScrapeCreators returns `credits_remaining` on **every** response, so this
 * costs one credit rather than needing a dedicated endpoint. Live at time of
 * writing: 3181.
 *
 * ⚠️ Creatify is checked only when configured. An unconfigured vendor is not a
 * vendor at zero, and reporting it as `critical` would train whoever reads
 * these alerts to ignore them — which is how a real one gets missed.
 */
export const readBalances = internalAction({
  args: {},
  handler: async (): Promise<BalanceCheck[]> => {
    const out: BalanceCheck[] = [];

    const scKey = process.env.SCRAPE_CREATORS_API_KEY;
    if (scKey) {
      try {
        const res = await fetch(
          "https://api.scrapecreators.com/v1/tiktok/profile?handle=tiktok",
          { headers: { "x-api-key": scKey } }
        );
        const body = (await res.json()) as { credits_remaining?: unknown };
        if (typeof body.credits_remaining === "number") {
          out.push(checkBalance("scrapecreators", body.credits_remaining));
        }
      } catch (error) {
        console.error(`[liveness] scrapecreators balance failed: ${String(error)}`);
      }
    }

    const cfId = process.env.CREATIFY_API_ID;
    const cfKey = process.env.CREATIFY_API_KEY;
    if (cfId && cfKey) {
      try {
        const res = await fetch(
          "https://api.creatify.ai/api/remaining_credits/",
          { headers: { "X-API-ID": cfId, "X-API-KEY": cfKey } }
        );
        const body = (await res.json()) as { remaining_credits?: unknown };
        if (typeof body.remaining_credits === "number") {
          out.push(checkBalance("creatify", body.remaining_credits));
        }
      } catch (error) {
        console.error(`[liveness] creatify balance failed: ${String(error)}`);
      }
    }

    /**
     * ⚠️ The balance that pays for thinking. Read last because it is the one
     * most likely to be missing a key in a partial environment, and a throw
     * here would drop the two above it.
     */
    const orKey = process.env.OPENROUTER_API_KEY;
    if (orKey) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/credits", {
          headers: { Authorization: `Bearer ${orKey}` },
        });
        const body = (await res.json()) as {
          data?: { total_credits?: unknown; total_usage?: unknown };
        };
        const bought = body.data?.total_credits;
        const used = body.data?.total_usage;
        if (typeof bought === "number" && typeof used === "number") {
          // OpenRouter reports lifetime bought and lifetime used; the number
          // that matters is neither of them.
          out.push(checkBalance("openrouter", bought - used));
        }
      } catch (error) {
        console.error(`[liveness] openrouter balance failed: ${String(error)}`);
      }
    }

    return out;
  },
});
