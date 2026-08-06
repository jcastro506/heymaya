/**
 * ⭐ What a customer actually costs, and what they're on track to cost.
 *
 * Operator, 2026-08-06:
 *
 * > *"COGS are gonna amortize and blend over many users, but each user can't
 * > just blow out. We're not gonna cap any one user, like heymaya is just
 * > gonna stop talking to them. We just got to make sure we're watching, if
 * > this specific machine was a user, how much money has it used so far, and
 * > how much is it projected to use for the month?"*
 *
 * That sets the purpose precisely, and it is **not** enforcement:
 *
 * - **Blended, not per-seat.** A month where one customer costs $40 and nine
 *   cost $4 is a fine month at $149. The number that matters is the fleet
 *   average against the price, with the outliers named so they can be
 *   understood rather than clipped.
 * - **Never by going quiet.** `spendCeiling.ALWAYS_ALLOWED_KINDS` already
 *   guarantees this: delivering messages, answering comments, DMs and
 *   mentions, and publishing an already-approved post all continue at any
 *   spend. Only speculative work — sweeps, renders, production — pauses. A cap
 *   that silences her is indistinguishable from an outage.
 * - **So this module reports. It does not block.** Nothing here can hold a
 *   post or stop a reply, and it should stay that way (§9.1: exactly one
 *   function decides publish-or-hold, and this is not it).
 *
 * ## Why projection, and not just a running total
 *
 * A total answers "what have we spent"; pricing needs "where does this land by
 * month end". Those diverge most exactly when it matters — on day 3 of a
 * runaway, the total still looks small.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { dayKeyInZone, isSameMonthInZone, monthScanFloor } from "./cadence";

/**
 * Days of data before a projection is trustworthy.
 *
 * Below this the extrapolation multiplier is enormous — six hours of data
 * scaled to a month multiplies by 120, so a single expensive sweep reads as a
 * $400 customer. Reporting "too early" is more useful than a confident number
 * that is wrong by two orders of magnitude.
 */
export const MIN_DAYS_TO_PROJECT = 3;

export interface CostProjection {
  /** Spend so far in the current calendar month, in the founder's timezone. */
  monthToDateUsd: number;
  /** Days of the month that have actually been observed for this customer. */
  daysObserved: number;
  daysInMonth: number;
  /** Null when there isn't enough data to say — never a guess dressed as one. */
  projectedMonthUsd: number | null;
  /** Plain language, for the operator surface. */
  detail: string;
}

/** Days in the calendar month containing `dayKey` (YYYY-MM-DD). */
function daysInMonthOf(dayKey: string): number {
  const [y, m] = dayKey.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Project a month from what's been observed.
 *
 * Pure, so the arithmetic is testable without a database — and so the operator
 * surface and any alert cannot disagree about the number.
 *
 * ⚠️ `daysObserved` is measured from the LATER of the month's start and the
 * customer's own creation. A customer who signed up on the 28th has observed
 * three days, not twenty-eight, and dividing by the latter under-reports them
 * by 10× — which would make every new customer look cheap.
 */
export function project(input: {
  monthToDateUsd: number;
  daysObserved: number;
  daysInMonth: number;
}): CostProjection {
  const { monthToDateUsd, daysObserved, daysInMonth } = input;

  if (daysObserved < MIN_DAYS_TO_PROJECT) {
    return {
      monthToDateUsd,
      daysObserved,
      daysInMonth,
      projectedMonthUsd: null,
      detail: `$${monthToDateUsd.toFixed(2)} so far — too early in the month to project`,
    };
  }

  const perDay = monthToDateUsd / daysObserved;
  const projectedMonthUsd = perDay * daysInMonth;
  return {
    monthToDateUsd,
    daysObserved,
    daysInMonth,
    projectedMonthUsd,
    detail: `$${monthToDateUsd.toFixed(2)} over ${daysObserved} days — on track for about $${projectedMonthUsd.toFixed(2)} this month`,
  };
}

/**
 * Record what a call cost.
 *
 * Called from the LLM wrapper rather than from each site, so a new caller
 * cannot forget. Writes nothing when the vendor didn't report a cost: an
 * unknown cost stored as 0 reads as free, and a ledger that under-reports is
 * worse than one that admits a gap.
 */
export const record = internalMutation({
  args: {
    customerId: v.id("customers"),
    vendor: v.string(),
    purpose: v.string(),
    costUsd: v.optional(v.number()),
    resource: v.optional(v.string()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    if (typeof args.costUsd !== "number" || !Number.isFinite(args.costUsd)) {
      // Loud, because a vendor that stops reporting cost would otherwise make
      // the whole fleet look free.
      console.warn(
        `[cogs] ${args.vendor}/${args.purpose} reported no cost — not recorded`
      );
      return { recorded: false };
    }
    await ctx.db.insert("costEvents", {
      customerId: args.customerId,
      at: args.now ?? Date.now(),
      vendor: args.vendor,
      resource: args.resource,
      purpose: args.purpose,
      costUsd: args.costUsd,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
    });
    return { recorded: true };
  },
});

/**
 * One customer's month: what they've cost, and where that lands.
 *
 * ⭐ This is the "if this machine were a user" number. On the dogfood account
 * it answers whether the product is affordable at its own price, which is the
 * question the seven-day run is really testing alongside the cadence.
 */
export const forCustomer = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<(CostProjection & { byPurpose: Array<{ purpose: string; usd: number }> }) | null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return null;

    const now = args.now ?? Date.now();
    const timezone = customer.timezone ?? "UTC";
    const todayKey = dayKeyInZone(now, timezone);

    const events = (
      (await ctx.db
        .query("costEvents")
        .withIndex("by_customer_and_at", (q) =>
          q.eq("customerId", args.customerId).gte("at", monthScanFloor(now))
        )
        .collect()) as Doc<"costEvents">[]
    ).filter((e) => isSameMonthInZone(e.at, now, timezone));

    const monthToDateUsd = events.reduce((sum, e) => sum + e.costUsd, 0);

    // Observed days start at the LATER of the month's first day and the day
    // the account existed — see the note on `project`.
    const dayOfMonth = Number(todayKey.slice(8, 10));
    const createdKey = dayKeyInZone(customer.createdAt, timezone);
    const createdThisMonth =
      createdKey.slice(0, 7) === todayKey.slice(0, 7)
        ? Number(createdKey.slice(8, 10))
        : 1;
    const daysObserved = dayOfMonth - createdThisMonth + 1;

    const byPurposeMap = new Map<string, number>();
    for (const e of events) {
      byPurposeMap.set(e.purpose, (byPurposeMap.get(e.purpose) ?? 0) + e.costUsd);
    }
    const byPurpose = [...byPurposeMap.entries()]
      .map(([purpose, usd]) => ({ purpose, usd }))
      .sort((a, b) => b.usd - a.usd);

    return {
      ...project({
        monthToDateUsd,
        daysObserved,
        daysInMonth: daysInMonthOf(todayKey),
      }),
      byPurpose,
    };
  },
});

/**
 * ⭐ The fleet number, which is the one that decides whether the price works.
 *
 * Reports the blended average — a $40 customer beside nine $4 customers is a
 * fine month at $149 — and names the outliers rather than clipping them.
 * Understanding why one customer costs 10× is a product finding; capping them
 * is a worse product.
 */
export const fleet = internalQuery({
  args: { now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    customers: number;
    totalUsd: number;
    averageUsd: number;
    /** Ranked worst-first. The tail is where the pricing risk actually lives. */
    outliers: Array<{ customerId: Id<"customers">; usd: number; timesAverage: number }>;
    windowDays: number;
  }> => {
    /**
     * ⚠️ A TRAILING 30 DAYS, deliberately — not a calendar month.
     *
     * A fleet spans timezones, so "this month" would have to be resolved per
     * customer and the boundary would differ between rows in the same answer.
     * A trailing window is one unambiguous question with one answer, and for a
     * blended average it is the more useful number anyway: it doesn't collapse
     * to near-zero every 1st of the month, which is exactly when someone
     * checking the price would be most misled.
     *
     * `forCustomer` stays on the calendar month, because that is the unit a
     * customer is billed in.
     */
    const now = args.now ?? Date.now();
    const events = (await ctx.db
      .query("costEvents")
      .withIndex("by_at", (q) => q.gte("at", now - 30 * 86_400_000))
      .collect()) as Doc<"costEvents">[];

    const byCustomer = new Map<Id<"customers">, number>();
    for (const e of events) {
      byCustomer.set(e.customerId, (byCustomer.get(e.customerId) ?? 0) + e.costUsd);
    }

    const totalUsd = [...byCustomer.values()].reduce((a, b) => a + b, 0);
    const customers = byCustomer.size;
    const averageUsd = customers === 0 ? 0 : totalUsd / customers;

    const outliers = [...byCustomer.entries()]
      .map(([customerId, usd]) => ({
        customerId,
        usd,
        timesAverage: averageUsd === 0 ? 0 : usd / averageUsd,
      }))
      .filter((row) => row.timesAverage >= 2)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 10);

    return { customers, totalUsd, averageUsd, outliers, windowDays: 30 };
  },
});
