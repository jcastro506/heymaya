/**
 * S0 #1: the fleet's "who's due" reads, and the nightly repair of the `schedule` rows.
 *
 * Every hourly job used to `.collect()` the whole creators table (full documents: dossier,
 * notes, affinities) to find the few creators due this hour. Convex stops a query at 16 MiB
 * read, so at ~1,000 creators every hourly job would have failed on the same morning. The
 * jobs now read `schedule` rows (~300 B each) and load a full creator only once it is due.
 *
 * The rows are kept in step by a trigger on every creators write (lib/functions.ts). The
 * reconcile below is the backstop for anything that bypassed it (a dashboard edit, an
 * import), and doubles as the backfill on first deploy: `npx convex run core/schedule:reconcile`.
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { INACTIVE_STATUSES, syncSchedule } from "../lib/scheduleRow";

/**
 * Paired creators, optionally without paused / canceled / deleting. One indexed read of slim rows.
 *
 * ⚠️ Never an eval creator (`eval:` / `eval-run:`). The simulations pair their clones so the rails
 * allow texting, then run each job themselves on a simulated clock. Until 2026-09-24 the hourly
 * fleet jobs (scout, cadence, review, week plan, first week, sweep, readback) ALSO ran for every
 * paired clone at the real hour, doubling their passes and spending real credits on them, while
 * the comments in the simulations said the fleet skipped them. The load test's `eval-load:`
 * creators are not `isEval` (they exist to load the fleet) and stay in.
 */
export async function pairedRows(ctx: Pick<QueryCtx, "db">, opts: { activeOnly?: boolean } = {}): Promise<Doc<"schedule">[]> {
  const rows = ((await ctx.db.query("schedule").withIndex("by_paired_status", (q) => q.eq("paired", true)).collect()) as Doc<"schedule">[]).filter((r) => !r.isEval);
  return opts.activeOnly ? rows.filter((r) => !INACTIVE_STATUSES.has(r.status)) : rows;
}

/** Every creator's row, paired or not. For the few fleet jobs that are not about texting. */
export async function allRows(ctx: Pick<QueryCtx, "db">): Promise<Doc<"schedule">[]> {
  return (await ctx.db.query("schedule").collect()) as Doc<"schedule">[];
}

const PAGE = 100;

export const reconcilePage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, a): Promise<{ cursor: string; done: boolean; fixed: number }> => {
    const page = await ctx.db.query("creators").paginate({ numItems: PAGE, cursor: a.cursor });
    let fixed = 0;
    for (const c of page.page) if ((await syncSchedule(ctx.db, c._id)) !== "unchanged") fixed += 1;
    return { cursor: page.continueCursor, done: page.isDone, fixed };
  },
});

export const pruneOrphansPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, a): Promise<{ cursor: string; done: boolean; pruned: number }> => {
    const page = await ctx.db.query("schedule").paginate({ numItems: PAGE * 5, cursor: a.cursor });
    let pruned = 0;
    for (const r of page.page) {
      if (await ctx.db.get(r.creatorId)) continue;
      await ctx.db.delete(r._id);
      pruned += 1;
    }
    return { cursor: page.continueCursor, done: page.isDone, pruned };
  },
});

/**
 * Nightly: every creator has exactly one row that matches it, and no row outlives its
 * creator. Paged, so it never reads more than a page of full creator documents at once.
 * Drift is logged by count: a non-zero number means some write path skipped the trigger.
 */
export const reconcile = internalAction({
  args: {},
  handler: async (ctx): Promise<{ fixed: number; pruned: number }> => {
    let fixed = 0, pruned = 0;
    let cursor: string | null = null;
    for (;;) {
      const r: { cursor: string; done: boolean; fixed: number } = await ctx.runMutation(internal.core.schedule.reconcilePage, { cursor });
      fixed += r.fixed;
      if (r.done) break;
      cursor = r.cursor;
    }
    cursor = null;
    for (;;) {
      const r: { cursor: string; done: boolean; pruned: number } = await ctx.runMutation(internal.core.schedule.pruneOrphansPage, { cursor });
      pruned += r.pruned;
      if (r.done) break;
      cursor = r.cursor;
    }
    if (fixed || pruned) console.warn(`[schedule] reconcile repaired ${fixed} rows and pruned ${pruned}; a write path is skipping the trigger`);
    return { fixed, pruned };
  },
});

/** Test and ops seam: the row for one creator. */
export const rowFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Doc<"schedule"> | null> =>
    (await ctx.db.query("schedule").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).first()) as Doc<"schedule"> | null,
});
