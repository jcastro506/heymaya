/**
 * S0 live exit: how long every hourly fleet job takes, and what it did, on /ops. The crons call
 * `run` with a job name; it times the real function and keeps its last 48 runs. A job that throws
 * is recorded as failed with its message, then the error is rethrown so Convex logs it too.
 * Tiny rows in `syncState` (no new table: the schema is at its type ceiling).
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";

type Kind = "action" | "mutation";
const JOBS: Record<string, { kind: Kind; ref: unknown }> = {
  scout: { kind: "action", ref: internal.scout.scout.runAll },
  "human cadence": { kind: "action", ref: internal.agent.cadence.runAll },
  "weekly review": { kind: "action", ref: internal.review.weekly.runAll },
  "week plan": { kind: "action", ref: internal.calendar.weekPlan.runAll },
  "first week": { kind: "action", ref: internal.scout.firstWeek.runAll },
  "creator status": { kind: "action", ref: internal.core.status.run },
  "operator alerts": { kind: "action", ref: internal.core.alerts.run },
  "expire stale questions": { kind: "mutation", ref: internal.core.messages.expireStaleQuestionsAll },
  "reconcile schedule rows": { kind: "action", ref: internal.core.schedule.reconcile },
  "account insights": { kind: "action", ref: internal.connections.insightsSync.run },
};
export const TIMED_JOBS = Object.keys(JOBS);
const KEEP = 48;

export interface JobRun { at: number; ms: number; ok: boolean; summary: string }

/** Pure: a result, summarised for a table cell. */
export function summarise(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result !== "object") return String(result).slice(0, 80);
  return Object.entries(result as Record<string, unknown>).filter(([, x]) => typeof x === "number" || typeof x === "boolean").map(([k, x]) => `${k} ${x}`).join(" · ").slice(0, 120);
}

export const run = internalAction({
  args: { job: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const job = JOBS[a.job];
    if (!job) throw new Error(`no timed job named ${a.job}`);
    const started = Date.now();
    try {
      const result = job.kind === "action" ? await ctx.runAction(job.ref as never, {} as never) : await ctx.runMutation(job.ref as never, {} as never);
      await ctx.runMutation(internal.core.timedJobs.record, { job: a.job, run: { at: started, ms: Date.now() - started, ok: true, summary: summarise(result) } });
    } catch (e) {
      await ctx.runMutation(internal.core.timedJobs.record, { job: a.job, run: { at: started, ms: Date.now() - started, ok: false, summary: (e instanceof Error ? e.message : String(e)).slice(0, 160) } });
      throw e;
    }
    return null;
  },
});

export const record = internalMutation({
  args: { job: v.string(), run: v.object({ at: v.number(), ms: v.number(), ok: v.boolean(), summary: v.string() }) },
  handler: async (ctx, a): Promise<null> => {
    const key = `ops:job:${a.job}`;
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).unique();
    const runs = row ? (JSON.parse(row.value) as JobRun[]) : [];
    const value = JSON.stringify([...runs.slice(-(KEEP - 1)), a.run]);
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("syncState", { key, value, updatedAt: Date.now() });
    return null;
  },
});

/** Per job: the last run, the slowest of the last 48, and failures among them. */
export type JobStats = { job: string; last: JobRun | null; p100ms: number | null; failed: number; runs: number };

export const recent = internalQuery({ args: {}, handler: async (ctx): Promise<JobStats[]> => await readRecent(ctx) });

/** Shared by /ops (a query can't call another query without losing its types). */
export async function readRecent(ctx: QueryCtx): Promise<JobStats[]> {
    const out: JobStats[] = [];
    for (const job of TIMED_JOBS) {
      const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", `ops:job:${job}`)).unique();
      const runs = row ? (JSON.parse(row.value) as JobRun[]) : [];
      out.push({ job, last: runs[runs.length - 1] ?? null, p100ms: runs.length ? Math.max(...runs.map((r) => r.ms)) : null, failed: runs.filter((r) => !r.ok).length, runs: runs.length });
    }
    return out;
}
