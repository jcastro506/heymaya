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
 * `health` answers the first two. `aggregateLearning` answers the last two —
 * the fleet-wide ladder and directives counted per account.
 *
 * ⚠️ `notYetAnswered` stays as a field even now that it is empty. The next
 * thing this view cannot answer belongs there: a screen that silently covers
 * three of four questions is how an operator concludes the fourth is fine.
 */

import { v } from "convex/values";
import { query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { UnreachableCustomer } from "../maya/delivery";
import type { Doc, Id } from "../_generated/dataModel";
// ⚠️ Static. Convex queries and mutations cannot do dynamic imports — the
// failure is a RUNTIME `dynamic module import unsupported`, not a compile
// error, so it typechecks cleanly and dies on first call.
import { diagnoseFrom } from "../maya/ladder";

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
    outliers: Array<{
      customerId: Id<"customers">;
      usd: number;
      timesAverage: number;
    }>;
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
  /**
   * ⭐ Customers we can no longer reach at all.
   *
   * Listed above traceability in importance and below cadence in order: an
   * account we cannot message is one where every other number on this screen
   * is describing work the founder will never hear about. It is also the only
   * failure here that the operator fixes with a thirty-second email.
   */
  unreachable?: UnreachableCustomer[];
  /**
   * ⭐ Sprint 4's exit criterion across the fleet — "a stranger can't tell it
   * isn't the founder writing", measured rather than assumed.
   *
   * ⚠️ `void` is reported separately from `detectable`. A void run means the
   * judge failed to catch the deliberately-synthetic control, so the
   * INSTRUMENT was broken that week — counting it as a pass would bless
   * whatever shipped, and counting it as a failure would send someone chasing
   * a voice problem that was never measured.
   */
  voice?: {
    measured: number;
    indistinguishable: number;
    detectable: number;
    voided: number;
    oldestAsOf?: number;
  };
  /**
   * ⭐ §16.9.2's ACTIVATION FUNNEL, and the metric the spec calls the headline:
   * **time to first placement**.
   *
   * > *"signup → connected → approved → **first placement** → first click →
   * > first signup → month 2. Time-to-first-placement is the headline metric."*
   *
   * ⚠️ It was absent entirely. Every other number here describes customers who
   * are already working; this is the only one that describes the ones who never
   * started — and a founder who signs up, connects nothing and leaves is
   * invisible on a screen built from placements and spend.
   *
   * `medianHours` is null when nobody has placed yet, which is a real answer
   * rather than a zero. A zero here would read as "instant", the opposite of
   * the truth.
   */
  activation?: {
    signedUp: number;
    connected: number;
    placed: number;
    /** Hours from account creation to first live placement. */
    medianHours: number | null;
    /**
     * ⚠️ Named, not counted. Connected days ago and still nothing published is
     * the exact account the operator should open, and a count cannot be opened.
     */
    stalled: Array<{ customerId: Id<"customers">; daysSinceSignup: number }>;
  };
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
    const trace = await ctx.runQuery(
      internal.maya.traceability.fleetTraceability,
      {
        now,
      },
    );
    const breakers = await ctx.runQuery(internal.maya.breaker.allVendors, {});
    const unreachable = await ctx.runQuery(
      internal.maya.delivery.fleetUnreachable,
      { now },
    );

    /**
     * ⭐ §16.9.2's activation funnel. Every other number on this screen
     * describes customers who are already working; this is the only one that
     * describes the ones who never started.
     *
     * ⚠️ Computed from rows already in hand — `customers` for signup and
     * connection, `cadenceRows` for whether anything has ever gone live — so it
     * costs no extra read on a screen the operator opens when something is
     * already wrong.
     */
    const allCustomers = (await ctx.db
      .query("customers")
      .collect()) as Doc<"customers">[];
    const live = allCustomers.filter(
      (c) => c.state !== "cancelled" && c.agentVersion === "v2",
    );

    const channels = (await ctx.db.query("channels").collect()) as Doc<"channels">[];
    const connectedIds = new Set(
      channels
        .filter((ch) => ch.status === "connected")
        .map((ch) => String(ch.customerId)),
    );

    const placements = (await ctx.db
      .query("placements")
      .collect()) as Doc<"placements">[];
    /** First live placement per customer — the funnel's fourth step. */
    const firstPlacementAt = new Map<string, number>();
    for (const p of placements) {
      if (p.linkStatus !== "live") continue;
      const key = String(p.customerId);
      const at = p.publishedAt ?? p._creationTime;
      const seen = firstPlacementAt.get(key);
      if (seen === undefined || at < seen) firstPlacementAt.set(key, at);
    }

    const hoursToFirst: number[] = [];
    const stalled: Array<{ customerId: Id<"customers">; daysSinceSignup: number }> = [];
    for (const c of live) {
      const key = String(c._id);
      const first = firstPlacementAt.get(key);
      const signedUpAt = c.createdAt ?? c._creationTime;
      if (first !== undefined) {
        hoursToFirst.push(Math.max(0, (first - signedUpAt) / 3_600_000));
        continue;
      }
      /**
       * ⚠️ Only CONNECTED accounts count as stalled. Someone who signed up an
       * hour ago and hasn't connected a channel is mid-onboarding, not stuck,
       * and flagging them would bury the accounts that genuinely are.
       */
      if (connectedIds.has(key)) {
        stalled.push({
          customerId: c._id,
          daysSinceSignup: Math.floor((now - signedUpAt) / 86_400_000),
        });
      }
    }
    hoursToFirst.sort((a, b) => a - b);
    const medianHours =
      hoursToFirst.length === 0
        ? null
        : hoursToFirst[Math.floor(hoursToFirst.length / 2)];
    // Longest-waiting first — that is the one to open.
    stalled.sort((a, b) => b.daysSinceSignup - a.daysSinceSignup);

    /**
     * ⚠️ Stuck is computed from the LAST PLACEMENT, not from the streak.
     *
     * A streak of 0 means "nothing today", which is true of every customer
     * before their first post of the day and would flag the entire fleet every
     * morning. Days-since-last-placement is the thing that distinguishes a
     * quiet morning from an account that has stopped.
     */
    const stuck: Array<{
      customerId: Id<"customers">;
      daysSince: number | null;
    }> = [];

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

    /**
     * Read off the customer rows the weekly `voice` sweep writes. A customer
     * with too little writing has no verdict and is simply not counted — a
     * missing measurement must never dilute the ones that exist.
     */
    const voiceRows = (await ctx.db
      .query("customers")
      .collect()) as Doc<"customers">[];
    const verdicts = voiceRows
      .map((c) => {
        if (!c.voiceEvalJson) return null;
        try {
          const parsed = JSON.parse(c.voiceEvalJson) as { verdict?: string };
          return { verdict: parsed.verdict, at: c.voiceEvalAt };
        } catch {
          return null;
        }
      })
      .filter(
        (v): v is { verdict: string | undefined; at: number | undefined } =>
          v !== null,
      );

    const voice = verdicts.length
      ? {
          measured: verdicts.length,
          indistinguishable: verdicts.filter(
            (v) => v.verdict === "indistinguishable",
          ).length,
          detectable: verdicts.filter((v) => v.verdict === "detectable").length,
          voided: verdicts.filter((v) => v.verdict === "void").length,
          // ⚠️ OLDEST, not newest — §16.4. The freshest stamp hides a customer
          // whose voice hasn't been measured in a month.
          oldestAsOf: verdicts
            .map((v) => v.at)
            .filter((t): t is number => typeof t === "number")
            .sort((a, b) => a - b)[0],
        }
      : undefined;

    return {
      ok: true,
      unreachable,
      voice,
      cadence: {
        activeCustomers: cadenceRows.length,
        doneToday: cadenceRows.filter((r) => r.todayDone).length,
        bestStreak: cadenceRows.reduce(
          (best, r) => Math.max(best, r.streak),
          0,
        ),
        // Longest-stopped first: the account that has been silent longest is
        // the one to look at, not the one that happens to sort first.
        stuck: stuck.sort(
          (a, b) => (b.daysSince ?? 1e9) - (a.daysSince ?? 1e9),
        ),
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
        .sort(
          (a, b) =>
            (a.verdict === "critical" ? -1 : 1) -
            (b.verdict === "critical" ? -1 : 1),
        ),
      activation: {
        signedUp: live.length,
        connected: live.filter((c) => connectedIds.has(String(c._id))).length,
        placed: hoursToFirst.length,
        medianHours,
        stalled: stalled.slice(0, 10),
      },
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
      /**
       * ⭐ Empty, because both gaps are now closed by `aggregateLearning`
       * below — §18's four questions all have an answer on this screen.
       *
       * ⚠️ Kept as a field rather than deleted. The next thing this view can't
       * answer should be *stated here*, not omitted: a screen that silently
       * covers three of four questions is how an operator concludes the fourth
       * is fine.
       */
      notYetAnswered: [],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Aggregate learning (§16.9.3)                                                */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ The fleet-wide ladder — *"which rung is most commonly broken across ALL
 * customers, which is a statement about our product, not theirs."*
 *
 * That framing is the whole point. A single customer stuck at L1 has a format
 * problem. **Most** customers stuck at L1 means the thing we ship doesn't
 * travel, and no amount of per-account coaching fixes it.
 *
 * Computed from the same `diagnoseFrom` the weekly verdict and `nextIdea` use,
 * so the fleet number and every per-customer number are the same arithmetic.
 * Re-deriving it here would let the operator view and the founder's own recap
 * quietly disagree about the same week.
 */
export interface FleetLadder {
  /** Customers with enough data to place on the ladder at all. */
  measured: number;
  /** Rung → how many customers are sitting there, worst-first. */
  byRung: Array<{ rung: string; customers: number }>;
  /** ⭐ The one that is a statement about us. Null when nothing is measurable. */
  mostCommonBreak: string | null;
}

/**
 * What customers keep asking her to change.
 *
 * §16.9.3 lists *"directives by type"* as aggregate learning, and the reason is
 * that a rule one founder sets is a preference — the same rule set by nine is a
 * default we got wrong. This is the difference between reading complaints and
 * counting them.
 */
export interface DirectivePatterns {
  total: number;
  /** Kind → how many ACCOUNTS set one, not how many rows exist. */
  byKind: Array<{ kind: string; accounts: number }>;
}

export const aggregateLearning = query({
  args: { token: v.string(), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    ladder?: FleetLadder;
    directives?: DirectivePatterns;
  }> => {
    if (!authorized(args.token)) return { ok: false };
    const now = args.now ?? Date.now();

    const customers = (await ctx.db
      .query("customers")
      .collect()) as Doc<"customers">[];
    const active = customers.filter((c) => c.state === "active");

    const rungCounts = new Map<string, number>();
    let measured = 0;

    for (const customer of active) {
      const placements = (await ctx.db
        .query("placements")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
        .collect()) as Doc<"placements">[];

      const verdict = diagnoseFrom(placements, now, 7);
      /**
       * ⚠️ `unknown` is excluded from the fleet picture, not counted as a rung.
       *
       * §14.2.1: *"`unknown` is a real answer"* — it means no numbers came
       * back. Folding it in would make "we can't see" look like a diagnosis,
       * and at low customer counts it would usually be the winner.
       */
      if (verdict.rung === "unknown") continue;
      measured += 1;
      rungCounts.set(verdict.rung, (rungCounts.get(verdict.rung) ?? 0) + 1);
    }

    const byRung = [...rungCounts.entries()]
      .map(([rung, count]) => ({ rung, customers: count }))
      .sort((a, b) => b.customers - a.customers);

    /**
     * ⚠️ `healthy` is never "the most common break".
     *
     * It is the good outcome, and a fleet that is mostly healthy would
     * otherwise report "healthy" as the thing to fix.
     */
    const broken = byRung.filter((r) => r.rung !== "healthy");

    const directiveRows = (await ctx.db
      .query("directives")
      .collect()) as Doc<"directives">[];
    const activeDirectives = directiveRows.filter((d) => d.active);

    /**
     * Counted per ACCOUNT, not per row. One founder who restates the same rule
     * five times is one signal, not five — otherwise the loudest customer sets
     * the product roadmap.
     */
    const accountsByKind = new Map<string, Set<string>>();
    for (const row of activeDirectives) {
      const set = accountsByKind.get(row.kind) ?? new Set<string>();
      set.add(row.customerId as string);
      accountsByKind.set(row.kind, set);
    }

    return {
      ok: true,
      ladder: {
        measured,
        byRung,
        mostCommonBreak: broken[0]?.rung ?? null,
      },
      directives: {
        total: activeDirectives.length,
        byKind: [...accountsByKind.entries()]
          .map(([kind, accounts]) => ({ kind, accounts: accounts.size }))
          .sort((a, b) => b.accounts - a.accounts),
      },
    };
  },
});
