import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { planFeaturesGtm, type GtmPlan } from "./planGtm";

/**
 * Phase 2 ⑤ — DISCOVERY BUDGET GATE with DEGRADE-TO-MONITORING.
 *
 * This is the SOFT counterpart to the HARD-KILL caps in `spendKill.ts` /
 * `costCap.ts`. Those caps 403 the agent and DESTROY its Fly machine when a
 * runaway burn crosses a ceiling — the right behavior for an out-of-control
 * loop. The continuous discovery hunt (read-API scans + cheap-model scoring,
 * tagged `discovery: true` on `gtmCostLedger`) needs the OPPOSITE: when the
 * day's discovery budget is exhausted, Maya must NOT die. She must DEGRADE TO
 * MONITORING-ONLY — keep watching her own posts + the inbox (cheap, bounded by
 * watermarks) and simply STOP INITIATING NEW DISCOVERY READS until the rolling
 * window frees up. Nothing is destroyed; the agent stays alive and responsive.
 *
 * The gate is a READ-ONLY budget check. It never mutates, never throws, never
 * destroys. The pulse/workers consult it (Phase 3 wiring) and, on
 * `mode === "monitoring_only"`, skip the discovery legs of the loop while
 * leaving own-post + inbox monitoring untouched.
 *
 * PER-TIER DAILY DISCOVERY BUDGET (sized to the COGS ceilings in
 * `docs/SPRINT_PLAN_REALTIME_OPERATOR_V1.md` §9b — the discovery loop is the #1
 * variable-COGS driver, so each tier gets a daily discovery allowance scaled to
 * its headline price):
 *   - starter ($99)  → $1.00 / day
 *   - growth  ($149) → $1.50 / day
 *   - studio  ($199) → $2.00 / day
 *   - fail-closed / unknown / null → $0.10 / day (near-paused, monitoring-only
 *     almost immediately — same fail-closed philosophy as planGtm).
 *
 * A per-HOUR soft cap of `dailyCap × 0.25` prevents a single hour's burst from
 * draining the whole day in one go (so a spiky hour degrades for the rest of
 * that hour, then recovers). Either window meeting/exceeding its cap flips the
 * mode to monitoring-only.
 *
 * The plan tier is resolved READ-ONLY from the agent's `gtmPlanJson` via
 * `planFeaturesGtm` (we never mutate planGtm). An agent whose resolved features
 * land on the fail-closed default (`status: "none"`) maps to the $0.10/day
 * floor.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Per-hour budget is a quarter of the daily budget (burst guard). */
const HOURLY_FRACTION = 0.25;

/** The most-restrictive default for an unknown / corrupt / unpaid plan. */
const FAIL_CLOSED_DAILY_USD = 0.1;

/**
 * Per-tier DAILY discovery budget in USD. Pure + unit-testable.
 *
 * `null` (and anything that resolves to the fail-closed plan) → $0.10/day, the
 * near-paused floor: an agent with no valid plan can still do a sliver of
 * discovery but degrades to monitoring-only almost immediately.
 */
export function discoveryDailyBudgetUsd(planTier: GtmPlan | null): number {
  switch (planTier) {
    case "starter":
      return 1.0;
    case "growth":
      return 1.5;
    case "studio":
      return 2.0;
    default:
      // null / unknown — fail closed.
      return FAIL_CLOSED_DAILY_USD;
  }
}

/**
 * Per-tier HOURLY discovery budget in USD = daily × 0.25. Pure + unit-testable.
 * Caps a single-hour burst so it can't blow the whole day at once.
 */
export function discoveryHourlyBudgetUsd(planTier: GtmPlan | null): number {
  return round4(discoveryDailyBudgetUsd(planTier) * HOURLY_FRACTION);
}

export type DiscoveryBudgetMode = "full" | "monitoring_only";

export interface DiscoveryBudgetVerdict {
  /** True iff NEW discovery reads are allowed right now. */
  allowed: boolean;
  /** "full" = discover freely; "monitoring_only" = own-posts + inbox only. */
  mode: DiscoveryBudgetMode;
  /** Discovery-tagged spend in the last rolling hour (USD). */
  spentHourUsd: number;
  /** Discovery-tagged spend in the last rolling 24h (USD). */
  spentDayUsd: number;
  /** The hourly discovery cap for this tier (USD). */
  hourCapUsd: number;
  /** The daily discovery cap for this tier (USD). */
  dayCapUsd: number;
  /** Human-readable explanation of the verdict. */
  reason: string;
}

/** A minimal ledger-row shape the windowing math needs. Keeps the pure helper
 * decoupled from the full `Doc<"gtmCostLedger">` type. */
export interface DiscoveryLedgerRow {
  discovery?: boolean;
  costUsd: number;
  createdAt: number;
}

/**
 * PURE windowing math — sum discovery-tagged spend over the last hour and last
 * 24h relative to `nowMs`. Unit-testable without a DB.
 *
 * Only rows with `discovery === true` count: foundation/research/operational
 * spend is governed by the hard caps, never by this discovery gate. A row at
 * EXACTLY the window boundary (`createdAt === nowMs - WINDOW`) is included
 * (inclusive lower bound); future-dated rows (`createdAt > nowMs`) are ignored.
 */
export function summarizeDiscoverySpend(
  ledgerRows: readonly DiscoveryLedgerRow[],
  nowMs: number
): { spentHourUsd: number; spentDayUsd: number } {
  const hourFloor = nowMs - HOUR_MS;
  const dayFloor = nowMs - DAY_MS;
  let spentHourUsd = 0;
  let spentDayUsd = 0;
  for (const row of ledgerRows) {
    if (row.discovery !== true) continue;
    if (row.createdAt > nowMs) continue; // ignore future-dated rows
    if (row.createdAt >= dayFloor) {
      spentDayUsd += row.costUsd;
      if (row.createdAt >= hourFloor) {
        spentHourUsd += row.costUsd;
      }
    }
  }
  return { spentHourUsd: round4(spentHourUsd), spentDayUsd: round4(spentDayUsd) };
}

/**
 * PURE verdict — given the windowed spend and the tier's caps, decide the mode.
 * Degrade to monitoring-only when EITHER the hour OR the day cap is met/exceeded
 * (`spent >= cap`). Otherwise full discovery is allowed. Never destroys; this is
 * a soft gate. Exported so the windowing + decision can be tested without a DB.
 */
export function evaluateDiscoveryBudget(input: {
  spentHourUsd: number;
  spentDayUsd: number;
  hourCapUsd: number;
  dayCapUsd: number;
}): DiscoveryBudgetVerdict {
  const spentHourUsd = round4(input.spentHourUsd);
  const spentDayUsd = round4(input.spentDayUsd);
  const hourCapUsd = round4(input.hourCapUsd);
  const dayCapUsd = round4(input.dayCapUsd);

  const dayExhausted = spentDayUsd >= dayCapUsd;
  const hourExhausted = spentHourUsd >= hourCapUsd;

  if (dayExhausted || hourExhausted) {
    const which = dayExhausted
      ? `daily discovery budget exhausted ($${spentDayUsd.toFixed(2)} of $${dayCapUsd.toFixed(2)})`
      : `hourly discovery budget exhausted ($${spentHourUsd.toFixed(2)} of $${hourCapUsd.toFixed(2)})`;
    return {
      allowed: false,
      mode: "monitoring_only",
      spentHourUsd,
      spentDayUsd,
      hourCapUsd,
      dayCapUsd,
      reason: `degraded to monitoring-only: ${which}; keep watching own posts + inbox, pause new discovery reads`,
    };
  }

  return {
    allowed: true,
    mode: "full",
    spentHourUsd,
    spentDayUsd,
    hourCapUsd,
    dayCapUsd,
    reason: `full discovery: hour $${spentHourUsd.toFixed(2)}/$${hourCapUsd.toFixed(2)}, day $${spentDayUsd.toFixed(2)}/$${dayCapUsd.toFixed(2)}`,
  };
}

/**
 * Resolve the gating plan tier for an agent READ-ONLY from its `gtmPlanJson`.
 * An agent on the fail-closed default (status "none") maps to `null` → the
 * $0.10/day floor. We use the resolved `status` to detect the fail-closed case
 * without re-implementing planGtm's parsing.
 */
export function gatingTierForAgent(agent: {
  gtmPlanJson?: string | null;
}): GtmPlan | null {
  const features = planFeaturesGtm(agent);
  // The fail-closed default carries status "none". Treat it as null so callers
  // hit the $0.10/day floor rather than the starter $1/day allowance.
  if (features.status === "none") return null;
  return features.plan;
}

/**
 * Sum discovery-tagged `gtmCostLedger` rows for an account over the last 24h,
 * using the `by_account_discovery_created` index so we read ONLY this account's
 * discovery rows in-window (cross-tenant isolation is enforced by the
 * accountId-prefixed index range). The hour window is a subset of the day
 * window, so we collect the 24h slice once and let the pure helper split it.
 */
async function loadDiscoverySpend(
  ctx: Pick<QueryCtx, "db">,
  accountId: Id<"creators">,
  nowMs: number
): Promise<{ spentHourUsd: number; spentDayUsd: number }> {
  const dayFloor = nowMs - DAY_MS;
  const rows = await ctx.db
    .query("gtmCostLedger")
    .withIndex("by_account_discovery_created", (q) =>
      q
        .eq("accountId", accountId)
        .eq("discovery", true)
        .gte("createdAt", dayFloor)
    )
    .collect();
  return summarizeDiscoverySpend(rows, nowMs);
}

/**
 * Internal query: the SOFT discovery-budget gate. Reports whether NEW discovery
 * reads are allowed for `accountId` under `planTier`, degrading to
 * monitoring-only when the hour or day cap is met/exceeded. NEVER destroys
 * anything — degraded mode means "stop initiating discovery reads; keep
 * monitoring own posts + inbox".
 *
 * `planTier` is passed in (resolved by the caller via `gatingTierForAgent` /
 * `planFeaturesGtm`) so this query stays a pure budget check and does not need
 * to load the agent row itself.
 */
export const checkDiscoveryBudget = internalQuery({
  args: {
    accountId: v.id("creators"),
    planTier: v.union(
      v.literal("starter"),
      v.literal("growth"),
      v.literal("studio"),
      v.null()
    ),
    nowMs: v.number(),
  },
  handler: async (ctx, args): Promise<DiscoveryBudgetVerdict> => {
    const { spentHourUsd, spentDayUsd } = await loadDiscoverySpend(
      ctx,
      args.accountId,
      args.nowMs
    );
    return evaluateDiscoveryBudget({
      spentHourUsd,
      spentDayUsd,
      hourCapUsd: discoveryHourlyBudgetUsd(args.planTier),
      dayCapUsd: discoveryDailyBudgetUsd(args.planTier),
    });
  },
});

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
