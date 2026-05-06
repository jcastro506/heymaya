/**
 * mayaActionLog — Sprint 9 review tooling for heartbeat-tick decisions.
 *
 * The `mayaActionLog` table (defined in `schema.ts`) records every
 * heartbeat / cron entry's run outcome (`ran`, `skipped_plan_disabled`,
 * `skipped_condition_unmet`, `skipped_dependency_missing`, `retried`,
 * `failed`). This module exposes a query the operator's review tooling
 * (`scripts/review-heartbeat-decisions.ts`) consumes to summarize the
 * last 7 days for a creator.
 *
 * Cross-tenant safety: the public query takes `creatorId` and only reads
 * rows with that exact `creatorId`. There is no cross-creator aggregate
 * surface — the operator reviews one creator at a time.
 *
 * Plan-tier: read-only review tool; no plan-tier gate (the operator is
 * the caller, not the creator).
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

/** Default lookback window — 7 days in ms. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns the last 7 days of `mayaActionLog` rows for `creatorId`,
 * sorted ascending by timestamp. Each row is the raw schema row — the
 * caller (CLI script) summarizes counts.
 *
 * Bounded at 5,000 rows: a healthy creator should produce ~50-200 ticks
 * per day, so 5K covers ~25 days at the upper bound. If a creator hits
 * the cap, the cap signals "something pathological is happening" and
 * the operator should look at it manually.
 */
export const tickDecisionsLast7Days = query({
  args: {
    creatorId: v.id("creators"),
    nowMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    rows: ReadonlyArray<Doc<"mayaActionLog">>;
    windowStartMs: number;
    windowEndMs: number;
  }> => {
    const now = args.nowMs ?? Date.now();
    const windowStart = now - SEVEN_DAYS_MS;
    // Verify creator exists — cross-tenant defensive.
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      return { rows: [], windowStartMs: windowStart, windowEndMs: now };
    }
    const rows = await ctx.db
      .query("mayaActionLog")
      .withIndex("by_creator_and_ts", (q) =>
        q.eq("creatorId", args.creatorId).gte("ts", windowStart)
      )
      .take(5_000);
    // Defensive cross-tenant filter — the index pins creatorId, but
    // re-check (mirrors the wikiProjections.applyProjection pattern).
    const filtered = rows.filter((r) => r.creatorId === args.creatorId);
    // Already returned in index order (asc by ts).
    return { rows: filtered, windowStartMs: windowStart, windowEndMs: now };
  },
});

/* -------------------------------------------------------------------------- */
/* Pure summarizer — exported for the CLI script + tests                       */
/* -------------------------------------------------------------------------- */

export interface TickDecisionSummary {
  totalTicks: number;
  byOutcome: {
    ran: number;
    skipped_plan_disabled: number;
    skipped_condition_unmet: number;
    skipped_dependency_missing: number;
    retried: number;
    failed: number;
  };
  byEntry: Record<
    string,
    {
      ran: number;
      skipped: number;
      retried: number;
      failed: number;
    }
  >;
  /**
   * The number of distinct entry ids the creator's Maya touched in the
   * window. A healthy Maya hits 8-12 distinct entries; <5 means heartbeat
   * is dormant; >25 means an entry-id explosion (probably a config bug).
   */
  distinctEntries: number;
}

/**
 * Pure, exported. Summarizes a `tickDecisionsLast7Days` row payload into
 * counts. Used by:
 *   - `scripts/review-heartbeat-decisions.ts` (CLI)
 *   - tests for both the query AND the summarizer.
 */
export function summarizeTickDecisions(
  rows: ReadonlyArray<Doc<"mayaActionLog">>
): TickDecisionSummary {
  const summary: TickDecisionSummary = {
    totalTicks: rows.length,
    byOutcome: {
      ran: 0,
      skipped_plan_disabled: 0,
      skipped_condition_unmet: 0,
      skipped_dependency_missing: 0,
      retried: 0,
      failed: 0,
    },
    byEntry: {},
    distinctEntries: 0,
  };
  const entries = new Set<string>();
  for (const r of rows) {
    summary.byOutcome[r.outcome] += 1;
    entries.add(r.entryId);
    if (!summary.byEntry[r.entryId]) {
      summary.byEntry[r.entryId] = { ran: 0, skipped: 0, retried: 0, failed: 0 };
    }
    const e = summary.byEntry[r.entryId];
    if (r.outcome === "ran") e.ran += 1;
    else if (r.outcome === "retried") e.retried += 1;
    else if (r.outcome === "failed") e.failed += 1;
    else e.skipped += 1; // any of the three skipped_* outcomes
  }
  summary.distinctEntries = entries.size;
  return summary;
}
