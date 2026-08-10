/**
 * ⭐ Fleet health (§16.9.1, Sprint 12) — the thin version, required from
 * Sprint 3.
 *
 * §18 marks Sprint 12 *"thin version required from Sprint 3"* and it was never
 * built. That matters more than its position in the list suggests: **Sprint 3
 * is the gamble** — a placement a day, seven days straight — and nothing was
 * able to answer whether that was actually happening without someone opening a
 * terminal and running queries by hand.
 *
 * ## The audit §18 asked for, rather than a rebuild
 *
 * The instruction is *"audit and adapt the existing `/founder` ops view rather
 * than rebuilding."* The audit finding is that it reads `gtmAgents`,
 * `mayaMessages`, `gtmChannelScorecard` and `gtmCostLedger` — **the deleted
 * product's tables.** It is a working dashboard for a product that no longer
 * exists, and it shows nothing about `customers`, `placements` or `costEvents`.
 *
 * So this adds the current product alongside it rather than touching it.
 *
 * ## Four queries that already existed and nothing called
 *
 * `fleetCadence` · `cogs.fleet` · `fleetTraceability` · `breaker.allVendors` —
 * **zero callers each.** Every number Sprint 12's exit criterion asks for was
 * already computable; nothing joined them or put them on a screen. That is this
 * codebase's dominant defect class showing up in the observability layer, which
 * is a particularly bad place for it: the tooling that would reveal the problem
 * had the problem.
 *
 * ## What it answers
 *
 * §18's exit: *"is anything broken · who isn't getting results · what are
 * customers repeatedly asking her to change · and which rung of the ladder is
 * the product itself failing most often."*
 *
 * The first two are here. The last two need `diagnose` and the directive
 * aggregation from Sprint 8/12 proper, and are deliberately absent rather than
 * approximated — a number that looks like an answer and isn't is worse than a
 * gap, especially on the screen you check when something is wrong.
 */

import { v } from "convex/values";
import { query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/** Same gate as the rest of the ops view — the token IS the auth. */
function authorized(token: string): boolean {
  const expected = process.env.ADMIN_DASH_TOKEN;
  // ⚠️ Fails CLOSED when unset. An ops view that opens up because a variable
  // is missing is worse than one that is down.
  return Boolean(expected) && token === expected;
}

/**
 * A customer is "stuck" when they are active and haven't placed anything in
 * this many days.
 *
 * ⚠️ Two days, not one. A single quiet day is a legitimate outcome — §12 is
 * explicit that honest silence beats fake activity, and alerting on it would
 * train the operator to ignore the alert. Two consecutive days is a pattern.
 */
export const STUCK_AFTER_DAYS = 2;

export interface FleetHealth {
  ok: boolean;
  /** ⭐ The Sprint 3 question, first because it is the one that matters now. */
  cadence?: {
    activeCustomers: number;
    /** Placed something today, in their own timezone. */
    doneToday: number;
    /** Consecutive days with a placement, best in the fleet. */
    bestStreak: number;
    /** Active, and nothing placed for STUCK_AFTER_DAYS. Named, not counted. */
    stuck: Array<{ customerId: Id<"customers">; daysSince: number | null }>;
  };
  spend?: {
    windowDays: number;
    totalUsd: number;
    averageUsd: number;
    /** Worst first — the tail is where the pricing risk lives. */
    outliers: Array<{ customerId: Id<"customers">; usd: number; timesAverage: number }>;
  };
  /**
   * Vendors not at `ok`. Empty is the good case.
   *
   * ⚠️ `low` is included, not just `critical`. A vendor about to run out is
   * the actionable moment — once it is critical the day's collection has
   * already failed, and `detail` is written to be relayed unchanged.
   */
  vendorsDegraded?: Array<{
    vendor: string;
    verdict: "low" | "critical";
    balance: number;
    detail: string;
    checkedAt: number;
  }>;
  traceability?: { posts: number; traceable: number; share: number | null };
  /** What this view deliberately cannot answer yet. Stated, never implied. */
  notYetAnswered: string[];
}

/**
 * ⭐ One read, for the phone.
 *
 * Joined server-side rather than as four client calls: the operator opens this
 * when something is wrong, and four round trips on a phone is when they give up
 * and open a terminal instead — which is the behaviour this replaces.
 */
export const health = query({
  args: { token: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<FleetHealth> => {
    if (!authorized(args.token)) {
      return { ok: false, notYetAnswered: [] };
    }
    const now = args.now ?? Date.now();

    const cadenceRows = await ctx.runQuery(internal.maya.cadence.fleetCadence, {
      now,
    });
    const spend = await ctx.runQuery(internal.maya.cogs.fleet, { now });
    const trace = await ctx.runQuery(internal.maya.traceability.fleetTraceability, {
      now,
    });
    const breakers = await ctx.runQuery(internal.maya.breaker.allVendors, {});

    /**
     * ⚠️ Stuck is computed from the LAST PLACEMENT, not from the streak.
     *
     * A streak of 0 means "nothing today", which is true of every customer
     * before their first post of the day and would flag the entire fleet every
     * morning. Days-since-last-placement is the thing that distinguishes a
     * quiet morning from an account that has stopped.
     */
    const stuck: Array<{ customerId: Id<"customers">; daysSince: number | null }> = [];

    for (const row of cadenceRows) {
      if (row.todayDone) continue;
      const placements = (await ctx.db
        .query("placements")
        .withIndex("by_customer", (q) => q.eq("customerId", row.customerId))
        .collect()) as Doc<"placements">[];

      const live = placements
        .filter((p) => p.linkStatus === "live")
        .sort((a, b) => b.publishedAt - a.publishedAt);
      const last = live[0];
      const daysSince = last
        ? Math.floor((now - last.publishedAt) / (24 * 60 * 60 * 1000))
        : null;

      // `null` means nothing has EVER gone out — worse than stale, so it is
      // always listed rather than compared against the threshold.
      if (daysSince === null || daysSince >= STUCK_AFTER_DAYS) {
        stuck.push({ customerId: row.customerId, daysSince });
      }
    }

    return {
      ok: true,
      cadence: {
        activeCustomers: cadenceRows.length,
        doneToday: cadenceRows.filter((r) => r.todayDone).length,
        bestStreak: cadenceRows.reduce((best, r) => Math.max(best, r.streak), 0),
        // Longest-stopped first: the account that has been silent longest is
        // the one to look at, not the one that happens to sort first.
        stuck: stuck.sort((a, b) => (b.daysSince ?? 1e9) - (a.daysSince ?? 1e9)),
      },
      spend: {
        windowDays: spend.windowDays,
        totalUsd: spend.totalUsd,
        averageUsd: spend.averageUsd,
        outliers: spend.outliers,
      },
      vendorsDegraded: breakers
        .filter((b: Doc<"vendorBreaker">) => b.verdict !== "ok")
        .map((b: Doc<"vendorBreaker">) => ({
          vendor: b.vendor,
          verdict: b.verdict as "low" | "critical",
          balance: b.balance,
          detail: b.detail,
          checkedAt: b.checkedAt,
        }))
        // Critical before low — the one already failing outranks the warning.
        .sort((a, b) => (a.verdict === "critical" ? -1 : 1) - (b.verdict === "critical" ? -1 : 1)),
      traceability: {
        posts: trace.posts,
        traceable: trace.traceable,
        share: trace.share,
      },
      /**
       * ⭐ Stated, never approximated.
       *
       * §18's exit asks four questions and this answers two. Showing a
       * plausible-looking number for the other two would be worse than a gap —
       * this is the screen someone opens when they already suspect something is
       * wrong, and a wrong number there sends them the wrong way.
       */
      notYetAnswered: [
        "what customers repeatedly ask her to change — needs directive aggregation (§16.9.3)",
        "which ladder rung the product fails most often — needs `diagnose` (Sprint 8)",
      ],
    };
  },
});
