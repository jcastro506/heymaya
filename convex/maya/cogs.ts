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
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
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

/**
 * Money, at the scale this actually reports.
 *
 * ⚠️ `toFixed(2)` alone is wrong here. The first live reading was
 * **$0.00006925**, which renders as "$0.00 over 3 days — on track for about
 * $0.00 this month": technically true, completely useless, and
 * indistinguishable from a ledger that isn't recording. Early in a month, or
 * for a cheap customer, sub-cent totals are the normal case rather than an
 * edge one.
 *
 * Two decimals once there's a cent to show; enough significant figures below
 * that to tell $0.00007 from $0.007 — a 100× difference that both round to
 * zero.
 */
export function formatUsd(usd: number): string {
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd === 0) return "$0.00";
  return `$${usd.toPrecision(2)}`;
}

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
  /**
   * ⭐ The REAL month-to-date bill from OpenRouter, when we have it.
   *
   * ⚠️ `monthToDateUsd` above sums `costEvents`, which only records calls made
   * from Convex — about 2% of the money. The agent loop on Fly calls the
   * vendor directly. So this field and that one differ by ~50x, and an
   * operator surface that shows the wrong one is answering "can we afford this
   * customer at $99" with a number off by a factor of fifty.
   */
  vendorMonthUsd?: number;
  /** §16.4 — a borrowed number carries its age or it eventually lies. */
  vendorAsOf?: number;
  /**
   * True when `monthToDateUsd` is all we have. Stated, never implied: a
   * partial figure presented as the bill is worse than no figure.
   */
  partialOnly: boolean;
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
  /** The vendor's own figure, when the customer has a provisioned key. */
  vendorMonthUsd?: number;
  vendorAsOf?: number;
}): CostProjection {
  const { monthToDateUsd, daysObserved, daysInMonth } = input;

  /**
   * ⭐ The vendor's number wins whenever we have it.
   *
   * `monthToDateUsd` sums `costEvents` — Convex's own calls, ~2% of the money.
   * Projecting from it produces a confident, precise figure that is wrong by
   * roughly fifty times, which is worse than saying we don't know.
   */
  const spend = input.vendorMonthUsd ?? monthToDateUsd;
  const partialOnly = input.vendorMonthUsd === undefined;
  const vendorFields = {
    vendorMonthUsd: input.vendorMonthUsd,
    vendorAsOf: input.vendorAsOf,
    partialOnly,
  };

  /** ⚠️ Said outright. A partial figure presented as the bill is the failure. */
  const caveat = partialOnly
    ? " — this is only what Convex spent, not the agent's own model calls"
    : "";

  if (daysObserved < MIN_DAYS_TO_PROJECT) {
    return {
      monthToDateUsd,
      daysObserved,
      daysInMonth,
      projectedMonthUsd: null,
      detail: `${formatUsd(spend)} so far — too early in the month to project${caveat}`,
      ...vendorFields,
    };
  }

  const perDay = spend / daysObserved;
  const projectedMonthUsd = perDay * daysInMonth;
  return {
    monthToDateUsd,
    daysObserved,
    daysInMonth,
    projectedMonthUsd,
    detail: `${formatUsd(spend)} over ${daysObserved} days — on track for about ${formatUsd(projectedMonthUsd)} this month${caveat}`,
    ...vendorFields,
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
        `[cogs] ${args.vendor}/${args.purpose} reported no cost — not recorded`,
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
    args,
  ): Promise<
    | (CostProjection & { byPurpose: Array<{ purpose: string; usd: number }> })
    | null
  > => {
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    if (!customer) return null;

    const now = args.now ?? Date.now();
    const timezone = customer.timezone ?? "UTC";
    const todayKey = dayKeyInZone(now, timezone);

    const events = (
      (await ctx.db
        .query("costEvents")
        .withIndex("by_customer_and_at", (q) =>
          q.eq("customerId", args.customerId).gte("at", monthScanFloor(now)),
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
      byPurposeMap.set(
        e.purpose,
        (byPurposeMap.get(e.purpose) ?? 0) + e.costUsd,
      );
    }
    const byPurpose = [...byPurposeMap.entries()]
      .map(([purpose, usd]) => ({ purpose, usd }))
      .sort((a, b) => b.usd - a.usd);

    return {
      ...project({
        monthToDateUsd,
        daysObserved,
        daysInMonth: daysInMonthOf(todayKey),
        // ⭐ The real bill, refreshed daily by the `spend` sweep. Absent for a
        // customer with no provisioned key yet — and then the caller is told
        // the figure is partial rather than handed it as the truth.
        vendorMonthUsd: customer.vendorSpendMonthUsd,
        vendorAsOf: customer.vendorSpendAsOf,
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
    args,
  ): Promise<{
    customers: number;
    totalUsd: number;
    averageUsd: number;
    /** Ranked worst-first. The tail is where the pricing risk actually lives. */
    outliers: Array<{
      customerId: Id<"customers">;
      usd: number;
      timesAverage: number;
    }>;
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
      byCustomer.set(
        e.customerId,
        (byCustomer.get(e.customerId) ?? 0) + e.costUsd,
      );
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

/**
 * ⭐ THE WHOLE BILL, from the vendor rather than from our own bookkeeping.
 *
 * `forCustomer` sums `costEvents`, and `costEvents` only ever contains calls
 * made from **Convex** — the gates, the sweeps, the critic. It cannot see the
 * largest line item by far: OpenClaw, on the Fly machine, calling OpenRouter
 * directly for every turn of the agent loop. Reading the Convex ledger alone
 * and calling it "what this customer costs" would understate it by an order of
 * magnitude, which is the same shape of mistake as the $0.025-against-$22
 * ledger this product already shipped.
 *
 * OpenRouter reports usage **per key**, which is the honest source:
 *
 *     usage_daily · usage_weekly · usage_monthly · usage (lifetime)
 *
 * ⚠️ **Today this is the whole account, not one customer.** Every machine
 * shares one key, so with a single dogfood customer it happens to be the same
 * number — and it stops being true the moment there are two. The fix is a key
 * per customer machine, minted with a provisioning key at deploy time, so this
 * same call answers per customer. Named here rather than assumed: see §17.
 */
export const accountSpend = internalAction({
  args: {},
  handler: async (): Promise<{
    ok: boolean;
    todayUsd?: number;
    weekUsd?: number;
    monthUsd?: number;
    lifetimeUsd?: number;
    detail: string;
  }> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return { ok: false, detail: "no OpenRouter key configured" };
    try {
      const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${key}` },
      });
      const body = (await res.json()) as {
        data?: {
          usage?: number;
          usage_daily?: number;
          usage_weekly?: number;
          usage_monthly?: number;
        };
      };
      const d = body.data;
      if (!d || typeof d.usage_monthly !== "number") {
        return { ok: false, detail: "OpenRouter did not report usage" };
      }
      return {
        ok: true,
        todayUsd: d.usage_daily,
        weekUsd: d.usage_weekly,
        monthUsd: d.usage_monthly,
        lifetimeUsd: d.usage,
        detail: `${formatUsd(d.usage_monthly)} this month, ${formatUsd(d.usage_daily ?? 0)} today`,
      };
    } catch (error) {
      return {
        ok: false,
        detail: `couldn't read OpenRouter usage: ${String(error)}`,
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* Per-customer keys — the only way the LLM number can be both complete and    */
/* attributable                                                                */
/* -------------------------------------------------------------------------- */

export const storeKeyHash = internalMutation({
  args: { customerId: v.id("customers"), hash: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.customerId, {
      openRouterKeyHash: args.hash,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * ⭐ Mint this customer's own OpenRouter key.
 *
 * Measured 2026-08-07: `costEvents` — the ledger built the day before — covers
 * **2% of the LLM bill**. It records what Convex spends: the gates, the sweeps,
 * the critics, totalling $0.16/month. The other 98% is OpenClaw's agent loop on
 * Fly, calling OpenRouter directly, where nothing of ours can see it.
 *
 * Per-key usage closes that, because OpenRouter reports `usage_daily` and
 * `usage_monthly` on each key. One key per machine makes the number complete
 * AND per-customer, which no amount of instrumentation on our side could.
 *
 * ## ⚠️ NO SPEND LIMIT IS SET, DELIBERATELY
 *
 * The API supports a per-key `limit`. We do not use it, because a key that
 * hits its cap stops answering — and the operator's rule is explicit:
 *
 * > *"We're not gonna cap any one user, like heymaya is just gonna stop
 * > talking to them."*
 *
 * A hard vendor cap is exactly that failure, one layer lower and less visible:
 * she would go silent mid-conversation with no throttle state, no alert and no
 * degraded mode. `spendCeiling` already protects the fleet the right way — it
 * pauses speculative work and never the conversation. This key is an
 * instrument, not a valve.
 *
 * Returns the key ONCE. OpenRouter never shows it again, so the caller must
 * hand it to the machine in the same breath; only the hash is stored.
 */
export const provisionKey = internalAction({
  args: { customerId: v.id("customers"), label: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<
    { ok: true; key: string; hash: string } | { ok: false; error: string }
  > => {
    const provisioning = process.env.OPENROUTER_PROVISIONING_KEY;
    if (!provisioning) {
      // Named, not thrown: without it the shared key still works and the
      // ledger stays incomplete, which is a degradation rather than an outage.
      return {
        ok: false,
        error:
          "no OPENROUTER_PROVISIONING_KEY — falling back to the shared key",
      };
    }
    try {
      const res = await fetch("https://openrouter.ai/api/v1/keys", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provisioning}`,
          "Content-Type": "application/json",
        },
        // No `limit`. See the block above — a capped key is a silent mute.
        body: JSON.stringify({
          name: args.label ?? `maya-${args.customerId}`,
        }),
      });
      const body = (await res.json()) as {
        key?: string;
        data?: { hash?: string; name?: string };
        error?: { message?: string };
      };
      if (!res.ok || !body.key || !body.data?.hash) {
        return {
          ok: false,
          error: body.error?.message ?? `OpenRouter returned ${res.status}`,
        };
      }
      await ctx.runMutation(internal.maya.cogs.storeKeyHash, {
        customerId: args.customerId,
        hash: body.data.hash,
      });
      return { ok: true, key: body.key, hash: body.data.hash };
    } catch (error) {
      return { ok: false, error: `couldn't mint a key: ${String(error)}` };
    }
  },
});

/**
 * What THIS customer's machine has actually spent, from the vendor.
 *
 * The complete number, unlike `forCustomer` which sums only what Convex did.
 * Falls back to reporting nothing rather than to the account total: a
 * whole-fleet figure presented as one customer's is worse than a gap, and with
 * one customer today the two are identical, which is exactly how that mistake
 * would go unnoticed until there were two.
 */
export const machineSpend = internalAction({
  args: { customerId: v.id("customers") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; todayUsd: number; monthUsd: number; lifetimeUsd: number }
    | { ok: false; error: string }
  > => {
    const provisioning = process.env.OPENROUTER_PROVISIONING_KEY;
    const hash = await ctx.runQuery(internal.maya.cogs.keyHashFor, {
      customerId: args.customerId,
    });
    if (!provisioning || !hash) {
      return {
        ok: false,
        error: hash
          ? "no provisioning key to read usage with"
          : "this customer has no key of their own yet",
      };
    }
    try {
      const res = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
        headers: { Authorization: `Bearer ${provisioning}` },
      });
      const body = (await res.json()) as {
        data?: {
          usage?: number;
          usage_daily?: number;
          usage_monthly?: number;
        };
      };
      const d = body.data;
      if (!d || typeof d.usage_monthly !== "number") {
        return {
          ok: false,
          error: "OpenRouter did not report usage for that key",
        };
      }
      return {
        ok: true,
        todayUsd: d.usage_daily ?? 0,
        monthUsd: d.usage_monthly,
        lifetimeUsd: d.usage ?? 0,
      };
    } catch (error) {
      return { ok: false, error: `couldn't read key usage: ${String(error)}` };
    }
  },
});

export const keyHashFor = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<string | null> => {
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    return customer?.openRouterKeyHash ?? null;
  },
});

/* -------------------------------------------------------------------------- */

export const storeVendorSpend = internalMutation({
  args: {
    customerId: v.id("customers"),
    monthUsd: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.customerId, {
      vendorSpendMonthUsd: args.monthUsd,
      vendorSpendAsOf: args.now ?? Date.now(),
    });
    return null;
  },
});

/**
 * ⭐ Refresh the real bill for one customer. Runs daily, per customer.
 *
 * `machineSpend` and `accountSpend` were both written and never called, so the
 * only spend figure anywhere was `forCustomer`'s — which sums `costEvents` and
 * therefore sees about 2% of the money. Every spend number the operator has
 * looked at has been wrong by roughly 50x.
 *
 * ⚠️ Silent no-op on failure, deliberately. A customer with no provisioned key
 * yet (every customer created before today) simply has no vendor number, and
 * the reader states that rather than substituting the 2% figure and calling it
 * the bill.
 */
export const refreshVendorSpend = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: boolean; monthUsd?: number }> => {
    const spend = await ctx.runAction(internal.maya.cogs.machineSpend, {
      customerId: args.customerId,
    });
    if (!spend.ok) return { ok: false };

    await ctx.runMutation(internal.maya.cogs.storeVendorSpend, {
      customerId: args.customerId,
      monthUsd: spend.monthUsd,
      now: args.now,
    });
    return { ok: true, monthUsd: spend.monthUsd };
  },
});
