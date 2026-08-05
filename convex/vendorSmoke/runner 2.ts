/**
 * Vendor smoke suite — the Convex shell (§18.0.5).
 *
 * Thin on purpose. All the policy lives in `execute.ts`, which is pure and
 * exhaustively tested without a single vendor key. This file does three
 * things: pick the checks, run them, write the rows.
 *
 * Cadence (wired in `convex/crons.ts`):
 *   tier 1 — hourly, free
 *   tier 2 — daily, cents
 *   tier 3 — weekly, and before any deploy touching that vendor
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { executeChecks } from "./execute";
import { checksForTier } from "./registry";
import type { CheckOutcome, Tier } from "./types";

/**
 * Suite-wide budget per invocation, by tier. A smoke suite that can run away
 * with spend is just another incident source, so this is a hard cap enforced
 * the same way every other spend gate is.
 */
const TIER_BUDGET_USD: Record<Tier, number> = {
  1: 0.05,
  2: 2.0,
  3: 10.0,
};

const OUTCOME_STATUS = v.union(
  v.literal("pass"),
  v.literal("fail"),
  v.literal("skipped")
);

export const recordRun = internalMutation({
  args: {
    runId: v.string(),
    ranAt: v.number(),
    outcomes: v.array(
      v.object({
        vendor: v.string(),
        tier: v.number(),
        check: v.string(),
        status: OUTCOME_STATUS,
        detail: v.optional(v.string()),
        drifts: v.optional(v.array(v.string())),
        latencyMs: v.optional(v.number()),
        costUsd: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ recorded: number }> => {
    for (const outcome of args.outcomes) {
      await ctx.db.insert("vendorHealth", {
        // The action builds these from the registry's own literal unions, so
        // the narrowing here is restating what the types already guarantee.
        vendor: outcome.vendor as "zernio",
        tier: outcome.tier as 1,
        check: outcome.check,
        status: outcome.status,
        detail: outcome.detail,
        drifts: outcome.drifts,
        latencyMs: outcome.latencyMs,
        costUsd: outcome.costUsd,
        runId: args.runId,
        ranAt: args.ranAt,
      });
    }
    return { recorded: args.outcomes.length };
  },
});

/**
 * Run one tier and record it.
 *
 * Returns the summary so a pre-deploy gate can read it directly instead of
 * polling the table — a red tier 2 blocks any deploy touching that vendor.
 */
export const runTier = internalAction({
  args: {
    tier: v.union(v.literal(1), v.literal(2), v.literal(3)),
    /** Narrow to one vendor — what the pre-deploy gate uses. */
    vendor: v.optional(v.string()),
    budgetUsd: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    runId: string;
    passed: number;
    failed: number;
    skipped: number;
    spentUsd: number;
    budgetExhausted: boolean;
    failures: string[];
  }> => {
    const ranAt = Date.now();
    const runId = `smoke_${args.tier}_${ranAt}`;
    const checks = checksForTier(args.tier).filter(
      (check) => !args.vendor || check.vendor === args.vendor
    );

    const summary = await executeChecks(checks, {
      runId,
      budgetUsd: args.budgetUsd ?? TIER_BUDGET_USD[args.tier],
      getEnv: (key) => process.env[key],
    });

    await ctx.runMutation(internal.vendorSmoke.runner.recordRun, {
      runId,
      ranAt,
      outcomes: summary.outcomes.map((outcome: CheckOutcome) => ({
        vendor: outcome.vendor,
        tier: outcome.tier,
        check: outcome.check,
        status: outcome.status,
        detail: outcome.detail,
        drifts: outcome.drifts,
        latencyMs: outcome.latencyMs,
        costUsd: outcome.costUsd,
      })),
    });

    const failures = summary.outcomes
      .filter((outcome: CheckOutcome) => outcome.status === "fail")
      .map((outcome: CheckOutcome) => `${outcome.check}: ${outcome.detail ?? "failed"}`);

    if (failures.length > 0) {
      // Shape drift is an incident, not a test failure someone notices on
      // Monday. Loud in the logs is the floor; the operator view reads the rows.
      console.error(
        `[vendorSmoke] tier ${args.tier} — ${failures.length} FAILED: ${failures.join(" | ")}`
      );
    }

    return {
      runId,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      spentUsd: summary.spentUsd,
      budgetExhausted: summary.budgetExhausted,
      failures,
    };
  },
});

export const runTier1 = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    await ctx.runAction(internal.vendorSmoke.runner.runTier, { tier: 1 });
    return null;
  },
});

export const runTier2 = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    await ctx.runAction(internal.vendorSmoke.runner.runTier, { tier: 2 });
    return null;
  },
});

export const runTier3 = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    await ctx.runAction(internal.vendorSmoke.runner.runTier, { tier: 3 });
    return null;
  },
});
