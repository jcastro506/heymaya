import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Sprint 13 cost-cap kill switch.
 *
 * Extends the existing daily/monthly guard in `betaGuards.ts` with two new
 * scopes mandated by Part III of CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md:
 *
 *   - "hour"        — smoke-runaway protection. Hard $1.00/hour ceiling so
 *                     a bug in an L4 smoke can't drain a day's budget in 60s.
 *   - "research-job" — pre-flight check against the job's own budgetUsd, so
 *                     paid actions abort before exceeding the per-job cap
 *                     instead of just after.
 *
 * The existing "day" / "month" scopes from betaGuards.ts remain authoritative
 * for long-window enforcement and are also surfaced through this module so
 * callers have one preflight to consult.
 *
 * Operator override: setting GTM_COST_CAP_OVERRIDE=<reason> in Convex env
 * bypasses all caps and writes the reason as the response so the smoke
 * script logs why the cap was suspended. Never default-on.
 */

export const HOURLY_COST_CAP_USD = 1.0;
const HOURLY_COST_WINDOW_MS = 60 * 60 * 1000;

const SCOPE = v.union(
  v.literal("hour"),
  v.literal("day"),
  v.literal("month"),
  v.literal("research-job")
);

export type CostCapScope = "hour" | "day" | "month" | "research-job";

export interface CostCapStatus {
  scope: CostCapScope;
  allowed: boolean;
  reason?: string;
  currentSpendUsd: number;
  capUsd: number;
  nextCostUsd: number;
  overrideActive: boolean;
}

/**
 * Pure evaluator. Same separation-of-concerns as `evaluateGtmBetaGuard` so
 * we can unit-test without a Convex ctx.
 */
export function evaluateCostCap(input: {
  scope: CostCapScope;
  currentSpendUsd: number;
  capUsd: number;
  nextCostUsd: number;
}): CostCapStatus {
  const base: Omit<CostCapStatus, "allowed" | "reason"> = {
    scope: input.scope,
    currentSpendUsd: round4(input.currentSpendUsd),
    capUsd: round4(input.capUsd),
    nextCostUsd: round4(input.nextCostUsd),
    overrideActive: false,
  };
  if (input.nextCostUsd < 0) {
    return { ...base, allowed: false, reason: "cost cannot be negative" };
  }
  if (input.capUsd < 0) {
    return { ...base, allowed: false, reason: "cap cannot be negative" };
  }
  const projected = input.currentSpendUsd + input.nextCostUsd;
  if (projected > input.capUsd) {
    return {
      ...base,
      allowed: false,
      reason: `${input.scope} cost cap exceeded: $${projected.toFixed(4)} would exceed $${input.capUsd.toFixed(2)}`,
    };
  }
  return { ...base, allowed: true };
}

/**
 * Sum gtmCostLedger over a sliding window from `now`.
 */
export async function sumLedgerForAccountSince(
  ctx: Pick<QueryCtx, "db">,
  accountId: Id<"creators">,
  sinceMs: number,
  opts?: { excludeResearchJobSpend?: boolean }
): Promise<number> {
  const rows = await ctx.db
    .query("gtmCostLedger")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  return rows.reduce<number>((sum, row) => {
    if (row.createdAt < sinceMs) return sum;
    // Research-job spend is bounded by the job's own budgetUsd, so callers
    // governing only the uncapped operational loop (the spend kill-switch) can
    // exclude it — a legitimate deep research run must not trip a runaway kill.
    if (opts?.excludeResearchJobSpend && row.researchJobId) return sum;
    return sum + row.costUsd;
  }, 0);
}

async function loadResearchJob(
  ctx: Pick<QueryCtx, "db">,
  researchJobId: Id<"gtmResearchJobs">
): Promise<Doc<"gtmResearchJobs">> {
  const job = await ctx.db.get(researchJobId);
  if (!job) {
    throw new Error(`research job ${researchJobId} not found`);
  }
  return job;
}

async function loadSafetyLimits(
  ctx: Pick<QueryCtx, "db">,
  accountId: Id<"creators">
): Promise<{ dailyCostLimitUsd: number; monthlyCostLimitUsd: number }> {
  const doc = await ctx.db
    .query("gtmSafetyStates")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .first();
  return {
    dailyCostLimitUsd: doc?.dailyCostLimitUsd ?? 2,
    monthlyCostLimitUsd: doc?.monthlyCostLimitUsd ?? 35,
  };
}

function isOverrideActive(): { active: boolean; reason?: string } {
  const reason = process.env.GTM_COST_CAP_OVERRIDE;
  if (!reason || reason.trim().length === 0) return { active: false };
  return { active: true, reason: reason.trim() };
}

/**
 * Core preflight. Resolves the right cap and current-spend for the requested
 * scope, evaluates, and returns the status object. Never throws; callers
 * decide how to react.
 */
export async function checkCostCap(
  ctx: Pick<QueryCtx, "db">,
  args: {
    accountId: Id<"creators">;
    scope: CostCapScope;
    nextCostUsd: number;
    researchJobId?: Id<"gtmResearchJobs">;
    now?: number;
  }
): Promise<CostCapStatus> {
  const now = args.now ?? Date.now();
  const override = isOverrideActive();

  let currentSpendUsd = 0;
  let capUsd = 0;

  switch (args.scope) {
    case "hour": {
      currentSpendUsd = await sumLedgerForAccountSince(
        ctx,
        args.accountId,
        now - HOURLY_COST_WINDOW_MS
      );
      capUsd = HOURLY_COST_CAP_USD;
      break;
    }
    case "day": {
      currentSpendUsd = await sumLedgerForAccountSince(
        ctx,
        args.accountId,
        now - 24 * 60 * 60 * 1000
      );
      const limits = await loadSafetyLimits(ctx, args.accountId);
      capUsd = limits.dailyCostLimitUsd;
      break;
    }
    case "month": {
      currentSpendUsd = await sumLedgerForAccountSince(
        ctx,
        args.accountId,
        now - 30 * 24 * 60 * 60 * 1000
      );
      const limits = await loadSafetyLimits(ctx, args.accountId);
      capUsd = limits.monthlyCostLimitUsd;
      break;
    }
    case "research-job": {
      if (!args.researchJobId) {
        throw new Error("checkCostCap(research-job) requires researchJobId");
      }
      const job = await loadResearchJob(ctx, args.researchJobId);
      if (job.accountId !== args.accountId) {
        throw new Error(
          "checkCostCap(research-job) job does not belong to account"
        );
      }
      currentSpendUsd = job.spentUsd;
      capUsd = job.budgetUsd;
      break;
    }
  }

  const status = evaluateCostCap({
    scope: args.scope,
    currentSpendUsd,
    capUsd,
    nextCostUsd: args.nextCostUsd,
  });

  if (!status.allowed && override.active) {
    return {
      ...status,
      allowed: true,
      reason: `override active: ${override.reason}`,
      overrideActive: true,
    };
  }

  return status;
}

/**
 * Preflight against all caps that apply to the request. Returns the first
 * blocking cap (caller need not iterate). Override env honored uniformly.
 */
export async function checkAllCostCaps(
  ctx: Pick<QueryCtx, "db">,
  args: {
    accountId: Id<"creators">;
    nextCostUsd: number;
    researchJobId?: Id<"gtmResearchJobs">;
    now?: number;
  }
): Promise<CostCapStatus> {
  const scopes: CostCapScope[] = ["hour", "day", "month"];
  if (args.researchJobId) scopes.push("research-job");
  for (const scope of scopes) {
    const status = await checkCostCap(ctx, { ...args, scope });
    if (!status.allowed) return status;
  }
  return {
    scope: scopes[scopes.length - 1],
    allowed: true,
    currentSpendUsd: 0,
    capUsd: 0,
    nextCostUsd: round4(args.nextCostUsd),
    overrideActive: isOverrideActive().active,
  };
}

/**
 * Throwing variant for actions: aborts the calling action if any cap would
 * be crossed. Callers that need the full status object should use
 * checkAllCostCaps directly.
 */
export async function assertCostCapNotExceeded(
  ctx: Pick<QueryCtx, "db">,
  args: {
    accountId: Id<"creators">;
    nextCostUsd: number;
    researchJobId?: Id<"gtmResearchJobs">;
    now?: number;
  }
): Promise<void> {
  const status = await checkAllCostCaps(ctx, args);
  if (!status.allowed) {
    throw new Error(`cost cap blocked: ${status.reason ?? "unknown"}`);
  }
}

/**
 * Internal query for Convex actions to preflight before making external API
 * calls. Returns the structured status so the caller can branch on the cap
 * type that would have blocked.
 */
export const checkCostCapPreflight = internalQuery({
  args: {
    accountId: v.id("creators"),
    nextCostUsd: v.number(),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
  },
  handler: async (ctx, args): Promise<CostCapStatus> => {
    return await checkAllCostCaps(ctx, args);
  },
});

/**
 * Public query for the L4 smoke scripts (operator-authenticated). Resolves
 * the current signed-in user's GTM account and reports the cost-cap status
 * for the requested scope. Used by `scripts/gtm-sprint-13-smoke.ts` to
 * verify the kill switch is wired before the smoke proceeds.
 */
export const getMyCostCapStatus = query({
  args: {
    scope: SCOPE,
    nextCostUsd: v.number(),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
  },
  handler: async (ctx, args): Promise<CostCapStatus | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    return await checkCostCap(ctx, {
      accountId: creator._id,
      scope: args.scope,
      nextCostUsd: args.nextCostUsd,
      researchJobId: args.researchJobId,
    });
  },
});

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
