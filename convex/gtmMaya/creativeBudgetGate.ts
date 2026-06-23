import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { planFeaturesGtm } from "./planGtm";

/**
 * CREATIVE BUDGET GATE — paced, fail-closed credit budget for paid Creatify
 * renders (Aurora UGC avatar video). The SOFT/structural sibling of
 * `discoveryBudgetGate.ts`, but windowed on the BILLING PERIOD (≈30 days) rather
 * than a rolling 24h, because creative credits are a monthly allowance that must
 * not be blown in week 1.
 *
 * THREE STACKED VERDICTS (fail-closed):
 *   - `full`             — under the daily pro-rata drip line; render freely.
 *   - `graceful_degrade` — over the drip line (+ a one-render burst buffer). Maya
 *                          has run ahead of this month's pace; she should wait or
 *                          drop to a cheaper format (static asset / Gemini
 *                          slideshow). NOTHING is destroyed; the drip advances
 *                          each day and recovers.
 *   - `hard_block`       — the absolute monthly ceiling (`ugcCreditsMonth`) is
 *                          hit, OR the tier has no UGC budget at all
 *                          (starter/growth/fail-closed → cap 0 → blocked on
 *                          attempt #1). The hard COGS wall per tier.
 *
 * WHAT COUNTS (`isCountableCreativeRow`): ONLY ledger rows explicitly tagged
 * `creative: true`. Our UGC finalize stamps that flag with `units = creditsUsed`.
 * We deliberately do NOT lump in every `provider:'creatify'` row — standard video
 * (videoCreditsMonth) and static images (assetCreditsMonth) have their own count
 * caps; conflating them here would double-bound. Credit semantics: we sum `units`
 * (Creatify credits), NOT `costUsd`, so a 15s fast clip (~7.5cr) is cheaper than a
 * 30s realistic one.
 *
 * PER-ACCOUNT, not per-agent: `creatifyJobsJson` is per-`gtmAgents` row but the
 * budget must bound the whole account (multi-agent accounts share the ceiling), so
 * the gate sums the `gtmCostLedger` (per-`accountId`) via the
 * `by_account_creative_created` index. Cross-tenant isolation is the
 * accountId-prefixed index range.
 *
 * Creative spend stays EXCLUDED from the operational spend-kill ($1/hr, $6/24h) —
 * `costCap.ts` / `spendKill.ts` already exclude `provider:'creatify'`. A burst of
 * renders must never destroy the agent; these three creative guards are its only
 * ceiling.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Billing period length for the pro-rata drip + the rolling-window fallback. */
export const PERIOD_MS = 30 * DAY_MS;

/**
 * One-render burst buffer (in credits) the drip is allowed to run ahead by, so a
 * founder isn't blocked at 9am on day 1. ≈ one `aurora_v1_fast` 15s clip (7.5cr,
 * rounded to 8). More legible to Maya than discovery's fractional hourly cap.
 */
export const PER_RENDER_BUFFER_CREDITS = 8;

export type CreativeBudgetMode = "full" | "graceful_degrade" | "hard_block";

export interface CreativeBudgetVerdict {
  /** True iff a NEW paid render is allowed right now. */
  allowed: boolean;
  mode: CreativeBudgetMode;
  /** Creative credits already spent THIS billing period. */
  usedCreditsThisPeriod: number;
  /** Creative credits spent in the last rolling hour (burst visibility). */
  usedCreditsThisHour: number;
  /** Pro-rata credits unlocked through `now` (+ the per-render buffer). */
  allowedThroughNowCredits: number;
  /** The absolute monthly ceiling for this tier. */
  monthlyCapCredits: number;
  /** Human-readable explanation of the verdict. */
  reason: string;
}

/**
 * PURE — the daily pro-rata DRIP. Credits unlocked so far this period =
 * `monthlyCredits × (msIntoPeriod / periodLengthMs)`, clamped to [0, monthlyCredits].
 * On day 5 of 30, ~1/6 of the month's credits are unlocked. Guards a zero/negative
 * period length (returns the full cap so a degenerate window never hard-blocks a
 * valid plan). Unit-testable without a DB.
 */
export function proratedAllowanceCredits(
  monthlyCredits: number,
  periodStart: number,
  periodEnd: number,
  now: number
): number {
  if (monthlyCredits <= 0) return 0;
  const span = periodEnd - periodStart;
  if (!(span > 0)) return round4(monthlyCredits);
  const elapsed = now - periodStart;
  const fraction = elapsed <= 0 ? 0 : elapsed >= span ? 1 : elapsed / span;
  return round4(monthlyCredits * fraction);
}

/**
 * PURE predicate — does this ledger row count toward the creative budget?
 * ONLY explicitly-tagged `creative: true` rows count (see the module header for
 * why we don't lump in all `provider:'creatify'` spend). Exported + DB-free.
 */
export function isCountableCreativeRow(row: { creative?: boolean }): boolean {
  return row.creative === true;
}

/** Minimal ledger-row shape the windowing math needs (decoupled from Doc). */
export interface CreativeLedgerRow {
  creative?: boolean;
  /** Creatify credits consumed by this render — the budget unit. */
  units?: number;
  createdAt: number;
}

/**
 * PURE windowing math — sum creative-credit spend over the billing period and the
 * last rolling hour relative to `now`. A row counts iff `isCountableCreativeRow`.
 * Period lower bound is inclusive (`createdAt >= periodStart`); future-dated rows
 * (`createdAt > now`) are ignored. Sums `units` (credits), defaulting absent units
 * to 0. Unit-testable without a DB.
 */
export function summarizeCreativeSpend(
  rows: readonly CreativeLedgerRow[],
  periodStart: number,
  now: number
): { usedCreditsThisPeriod: number; usedCreditsThisHour: number } {
  const hourFloor = now - HOUR_MS;
  let usedCreditsThisPeriod = 0;
  let usedCreditsThisHour = 0;
  for (const row of rows) {
    if (!isCountableCreativeRow(row)) continue;
    if (row.createdAt > now) continue; // ignore future-dated rows
    if (row.createdAt < periodStart) continue;
    const credits = typeof row.units === "number" && row.units > 0 ? row.units : 0;
    usedCreditsThisPeriod += credits;
    if (row.createdAt >= hourFloor) usedCreditsThisHour += credits;
  }
  return {
    usedCreditsThisPeriod: round4(usedCreditsThisPeriod),
    usedCreditsThisHour: round4(usedCreditsThisHour),
  };
}

/**
 * PURE verdict — given windowed spend, the pro-rata drip line, and the cap, decide
 * the mode. Fail-closed ordering:
 *   1. `usedPeriod >= monthlyCap`                       → hard_block (the ceiling;
 *      `monthlyCap === 0` blocks on attempt #1).
 *   2. `usedPeriod > proratedAllowance + perRenderBuffer` → graceful_degrade (drip).
 *   3. else                                              → full.
 * Exported so windowing + decision can be tested without a DB.
 */
export function evaluateCreativeBudget(input: {
  usedCreditsThisPeriod: number;
  usedCreditsThisHour: number;
  proratedAllowanceCredits: number;
  monthlyCapCredits: number;
  perRenderBufferCredits: number;
}): CreativeBudgetVerdict {
  const usedPeriod = round4(input.usedCreditsThisPeriod);
  const usedHour = round4(input.usedCreditsThisHour);
  const monthlyCap = round4(input.monthlyCapCredits);
  const allowedThroughNow = round4(
    input.proratedAllowanceCredits + input.perRenderBufferCredits
  );

  // 1) Hard ceiling. cap 0 (starter/growth/fail-closed) blocks immediately.
  if (usedPeriod >= monthlyCap) {
    return {
      allowed: false,
      mode: "hard_block",
      usedCreditsThisPeriod: usedPeriod,
      usedCreditsThisHour: usedHour,
      allowedThroughNowCredits: allowedThroughNow,
      monthlyCapCredits: monthlyCap,
      reason:
        monthlyCap <= 0
          ? "no UGC budget on this tier — UGC avatar video is Studio only"
          : `monthly creative ceiling reached (${usedPeriod}/${monthlyCap} credits this billing period); UGC resumes next period`,
    };
  }

  // 2) Pro-rata drip + one-render burst buffer.
  if (usedPeriod > allowedThroughNow) {
    return {
      allowed: false,
      mode: "graceful_degrade",
      usedCreditsThisPeriod: usedPeriod,
      usedCreditsThisHour: usedHour,
      allowedThroughNowCredits: allowedThroughNow,
      monthlyCapCredits: monthlyCap,
      reason: `running ahead of this month's pace (${usedPeriod} used, ${allowedThroughNow} unlocked so far of ${monthlyCap}); wait for the drip to advance or drop to a cheaper format (static asset / slideshow)`,
    };
  }

  // 3) Under the drip line — render freely.
  return {
    allowed: true,
    mode: "full",
    usedCreditsThisPeriod: usedPeriod,
    usedCreditsThisHour: usedHour,
    allowedThroughNowCredits: allowedThroughNow,
    monthlyCapCredits: monthlyCap,
    reason: `on pace: ${usedPeriod} of ${allowedThroughNow} unlocked credits used (${monthlyCap} cap this period)`,
  };
}

/**
 * Resolve the billing-period window from `gtmPlanJson`. Reads `periodStart`
 * (`planGtm.buildGtmPlanJson` writes it). When absent/invalid (back-compat agents
 * deployed before periodStart existed), falls back to a ROLLING 30-day window
 * ending now — so pacing still works, just relative to "the last 30 days" instead
 * of the true billing anchor. Pure + DB-free.
 */
export function getBillingPeriodWindow(
  gtmPlanJson: string | null | undefined,
  now: number
): { periodStart: number; periodEnd: number } {
  let periodStart: number | null = null;
  if (gtmPlanJson) {
    try {
      const parsed = JSON.parse(gtmPlanJson) as { periodStart?: unknown };
      if (
        typeof parsed.periodStart === "number" &&
        Number.isFinite(parsed.periodStart) &&
        parsed.periodStart > 0
      ) {
        periodStart = parsed.periodStart;
      }
    } catch {
      periodStart = null;
    }
  }
  if (periodStart === null || periodStart > now) {
    // Rolling-30-day fallback (or a future-dated periodStart we won't trust).
    return { periodStart: now - PERIOD_MS, periodEnd: now };
  }
  return { periodStart, periodEnd: periodStart + PERIOD_MS };
}

/**
 * Sum creative-COUNTING `gtmCostLedger` rows for an account since `periodStart`,
 * using the `by_account_creative_created` index (accountId-prefixed range =
 * cross-tenant isolation). We scope the index read to `creative === true` so we
 * only scan the (small) set of paid renders.
 */
async function loadCreativeSpend(
  ctx: Pick<QueryCtx, "db">,
  accountId: Id<"creators">,
  periodStart: number,
  now: number
): Promise<{ usedCreditsThisPeriod: number; usedCreditsThisHour: number }> {
  const rows = await ctx.db
    .query("gtmCostLedger")
    .withIndex("by_account_creative_created", (q) =>
      q.eq("accountId", accountId).eq("creative", true).gte("createdAt", periodStart)
    )
    .collect();
  return summarizeCreativeSpend(rows, periodStart, now);
}

/**
 * Internal query: the creative-budget gate. Resolves the tier's UGC credit cap
 * READ-ONLY from `gtmPlanJson` (fail-closed: non-Studio / corrupt → cap 0 →
 * hard_block), windows on the billing period, sums per-account creative spend, and
 * returns the verdict. Never mutates, never throws, never destroys.
 */
export const checkCreativeBudget = internalQuery({
  args: {
    accountId: v.id("creators"),
    gtmPlanJson: v.union(v.string(), v.null()),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<CreativeBudgetVerdict> => {
    const features = planFeaturesGtm({ gtmPlanJson: args.gtmPlanJson });
    // Fail-closed: only a tier that actually grants UGC carries a non-zero cap.
    const monthlyCapCredits = features.canUgc ? features.ugcCreditsMonth : 0;
    const { periodStart, periodEnd } = getBillingPeriodWindow(
      args.gtmPlanJson,
      args.now
    );
    const { usedCreditsThisPeriod, usedCreditsThisHour } = await loadCreativeSpend(
      ctx,
      args.accountId,
      periodStart,
      args.now
    );
    return evaluateCreativeBudget({
      usedCreditsThisPeriod,
      usedCreditsThisHour,
      proratedAllowanceCredits: proratedAllowanceCredits(
        monthlyCapCredits,
        periodStart,
        periodEnd,
        args.now
      ),
      monthlyCapCredits,
      perRenderBufferCredits: PER_RENDER_BUFFER_CREDITS,
    });
  },
});

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
