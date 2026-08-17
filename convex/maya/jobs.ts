/**
 * The durable job queue (§3.4, §18 Sprint 2).
 *
 * Principle 5: nothing fails silently. Every job ends in a terminal state that
 * either succeeded or carries a named failure someone can read — never a
 * disappearance. Principle 8 in the data model says the same thing from the
 * other side: no non-terminal state may be permanent, so `running` has a
 * deadline and a reaper.
 *
 * Three properties this has to get right, because everything downstream
 * assumes them:
 *
 *   1. **Enqueue is idempotent.** The same logical work, enqueued twice, runs
 *      once. Watchers fire on overlapping schedules; retries race with crons.
 *      Dedupe belongs here, not in fifteen call sites.
 *   2. **Claiming is exclusive.** Two workers polling at the same moment must
 *      not both get the same row. Convex mutations are transactional, so the
 *      read-then-patch inside one mutation is the lock.
 *   3. **Failure is bounded and visible.** Attempts are capped; the last error
 *      is kept; exhausting attempts moves a job to `dead`, which is a state
 *      someone can query, not a silent drop.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Default ceiling on attempts before a job is declared dead. */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** How long a claimed job may run before the reaper assumes the worker died. */
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

/**
 * Exponential backoff with a ceiling. Deliberately not jittered: Convex
 * schedules these, so there's no thundering-herd of independent pollers to
 * spread out, and a predictable delay is easier to reason about in tests.
 */
export function backoffMs(attempts: number): number {
  const base = 30_000 * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(base, 30 * 60 * 1000);
}

/**
 * Enqueue work, idempotently.
 *
 * If a job with this key already exists and hasn't finished, this is a no-op
 * that returns the existing id — the caller can't tell whether it won the
 * race, and shouldn't care.
 *
 * A key whose previous job already reached a terminal state DOES enqueue
 * again. That's the intended reading of an idempotency key here: it prevents
 * concurrent duplicates, not a permanent one-time-only lock. A daily job with
 * a date-stamped key ("brief:2026-07-31") gets uniqueness from the key itself.
 */
export const enqueue = internalMutation({
  args: {
    kind: v.string(),
    idempotencyKey: v.string(),
    customerId: v.optional(v.id("customers")),
    payloadJson: v.optional(v.string()),
    runAfter: v.optional(v.number()),
    maxAttempts: v.optional(v.number()),
    leaseMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ jobId: Id<"jobs">; created: boolean }> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("jobs")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .collect();
    const live = existing.find(
      (job) => job.status === "queued" || job.status === "running"
    );
    if (live) return { jobId: live._id, created: false };

    const jobId = await ctx.db.insert("jobs", {
      customerId: args.customerId,
      kind: args.kind,
      idempotencyKey: args.idempotencyKey,
      status: "queued",
      attempts: 0,
      maxAttempts: args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      payloadJson: args.payloadJson,
      runAfter: args.runAfter ?? now,
      deadlineAt: now + (args.leaseMs ?? DEFAULT_LEASE_MS),
      createdAt: now,
      updatedAt: now,
    });
    return { jobId, created: true };
  },
});

/**
 * Claim the next eligible job of any kind, or of specific kinds.
 *
 * The read and the patch happen in ONE mutation, which is what makes the claim
 * exclusive — a second caller in the same instant sees the row already
 * `running`. Returns null when there's nothing to do.
 */
export const claimNext = internalMutation({
  args: {
    kinds: v.optional(v.array(v.string())),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"jobs"> | null> => {
    const now = Date.now();
    const candidates = await ctx.db
      .query("jobs")
      .withIndex("by_status_and_runAfter", (q) =>
        q.eq("status", "queued").lte("runAfter", now)
      )
      .take(200);

    const eligible = candidates.filter(
      (row) => !args.kinds || args.kinds.includes(row.kind)
    );
    if (eligible.length === 0) return null;

    /**
     * ⭐ FAIR-SHARE, then deadline. §18 Sprint 9 asks the render queue for
     * *"fair-share, deadline priority"*, and until now this took whatever sorted
     * first by `runAfter` — plain first-come-first-served.
     *
     * ⚠️ The failure that matters is not slowness, it is starvation. One
     * founder approving twenty videos in a burst would occupy the queue in
     * arrival order, and the other 199 would wait behind them. Nothing would
     * look broken: every job succeeds, the log is clean, and the only symptom
     * is that everyone else's placement is late — on the one day the queue is
     * under load, which is exactly when a missed slot costs the most.
     *
     * So the customer with the FEWEST jobs already running goes next. A burst
     * from one account interleaves with everyone else instead of blocking them,
     * and an idle customer is never behind a busy one.
     */
    const running = (await ctx.db
      .query("jobs")
      .withIndex("by_status_and_runAfter", (q) => q.eq("status", "running"))
      .take(200)) as Doc<"jobs">[];

    const load = new Map<string, number>();
    for (const row of running) {
      const key = row.customerId ?? "fleet";
      load.set(key, (load.get(key) ?? 0) + 1);
    }

    const job = [...eligible].sort((a, b) => {
      const la = load.get(a.customerId ?? "fleet") ?? 0;
      const lb = load.get(b.customerId ?? "fleet") ?? 0;
      // 1. Whoever has least in flight.
      if (la !== lb) return la - lb;
      /**
       * 2. Then the tightest deadline. A render due in thirty minutes beats one
       * due in six hours — §7.5.7 check 7 already refuses work that cannot
       * land before its slot, and this is the same clock seen from the queue.
       */
      if (a.deadlineAt !== b.deadlineAt) return a.deadlineAt - b.deadlineAt;
      // 3. Then arrival, so the ordering is total and a tie cannot flap.
      return a.runAfter - b.runAfter;
    })[0];

    await ctx.db.patch(job._id, {
      status: "running",
      attempts: job.attempts + 1,
      // The lease restarts on every claim, so a retry gets a full window
      // rather than inheriting the dead worker's remaining seconds.
      deadlineAt: now + (args.leaseMs ?? DEFAULT_LEASE_MS),
      updatedAt: now,
    });
    return (await ctx.db.get(job._id))!;
  },
});

export const succeed = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return { ok: false };
    await ctx.db.patch(args.jobId, {
      status: "succeeded",
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Record a failure and decide whether to retry.
 *
 * Under the cap: back to `queued` with backoff. At the cap: `dead`, with the
 * error kept. `dead` is a queryable state precisely so a human can be told —
 * a job that ran out of attempts and vanished is the silent failure this
 * whole module exists to prevent.
 */
export const fail = internalMutation({
  args: { jobId: v.id("jobs"), error: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ status: "queued" | "dead"; attempts: number }> => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return { status: "dead", attempts: 0 };
    const now = Date.now();

    if (job.attempts >= job.maxAttempts) {
      await ctx.db.patch(args.jobId, {
        status: "dead",
        lastError: args.error,
        updatedAt: now,
      });
      console.error(
        `[maya.jobs] job ${job.kind} (${job.idempotencyKey}) is DEAD after ${job.attempts} attempts: ${args.error}`
      );
      return { status: "dead", attempts: job.attempts };
    }

    await ctx.db.patch(args.jobId, {
      status: "queued",
      lastError: args.error,
      runAfter: now + backoffMs(job.attempts),
      updatedAt: now,
    });
    return { status: "queued", attempts: job.attempts };
  },
});

/**
 * Reap jobs whose lease expired — the worker crashed, the machine was stopped
 * mid-run, the action timed out.
 *
 * Without this, `running` is exactly the permanent non-terminal state
 * invariant 8 forbids: nothing else ever touches those rows again.
 */
export const reapExpired = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ requeued: number; dead: number }> => {
    const now = Date.now();
    const stuck = await ctx.db
      .query("jobs")
      .withIndex("by_status_and_deadline", (q) =>
        q.eq("status", "running").lt("deadlineAt", now)
      )
      .take(args.limit ?? 100);

    let requeued = 0;
    let dead = 0;
    for (const job of stuck) {
      if (job.attempts >= job.maxAttempts) {
        await ctx.db.patch(job._id, {
          status: "dead",
          lastError: `lease expired after ${job.attempts} attempts; worker never reported back`,
          updatedAt: now,
        });
        dead += 1;
        console.error(
          `[maya.jobs] job ${job.kind} (${job.idempotencyKey}) DEAD — lease expired, attempts exhausted`
        );
      } else {
        await ctx.db.patch(job._id, {
          status: "queued",
          lastError: "lease expired; worker never reported back",
          runAfter: now + backoffMs(job.attempts),
          updatedAt: now,
        });
        requeued += 1;
      }
    }
    return { requeued, dead };
  },
});

/**
 * Everything that died. This is what an operator view reads, and what makes
 * "nothing fails silently" true rather than aspirational.
 */
export const deadLetters = internalQuery({
  args: { customerId: v.optional(v.id("customers")), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"jobs">[]> => {
    const rows = await ctx.db
      .query("jobs")
      .withIndex("by_status_and_runAfter", (q) => q.eq("status", "dead"))
      .take(args.limit ?? 100);
    if (!args.customerId) return rows;
    return rows.filter((row) => row.customerId === args.customerId);
  },
});

/** Test seam: lets a test drive the queue without exporting internals. */
export async function countByStatus(
  ctx: MutationCtx,
  status: Doc<"jobs">["status"]
): Promise<number> {
  const rows = await ctx.db
    .query("jobs")
    .withIndex("by_status_and_runAfter", (q) => q.eq("status", status))
    .collect();
  return rows.length;
}
