/**
 * The watchers layer (§3.1) — Convex owns the clock.
 *
 * ```
 *   WATCHERS (deterministic, no LLM)  ← this file
 *   crons · webhooks · scrapers · metric pulls · token checks · liveness
 *                     │ writes rows
 *                     ▼
 *                 DATABASE  ← the only truth
 *                  ▲     ▲
 *              MAYA │     │ WORKERS
 *          (judgment)     (write, critique, publish)
 * ```
 *
 * ## Why the clock lives here and not in OpenClaw
 *
 * §3.1: *"every catastrophic failure in the current record is a harness
 * failure — sessions orphaning mid-run, … crons firing four hours late. Those
 * all come from putting collection and orchestration inside a long-running LLM
 * process."* The four-hours-late one was a timezone resolution inside the
 * agent harness, and a brief that lands at 11am instead of 7am is a different
 * product.
 *
 * Two more reasons the clock can't go back:
 *
 * - **OpenClaw crons are per-agent.** The sweeps read niche data identical for
 *   every customer in a niche; running them per-agent pays N times for one
 *   answer, which is the whole reason `nicheCache` exists.
 * - **A system cannot be the watchdog for itself.** If the agent owns both the
 *   clock and the liveness sweep, a machine that dies silently reports
 *   nothing — no cron fires, so no alarm fires.
 *
 * ## What this file must NOT become
 *
 * Convex decides **when** she wakes. It does not decide **what she does.**
 *
 * The wake hands her context and a question — "it's 7am, here's the overnight
 * haul, decide the day" — never a form to fill in. If a cron in this file ever
 * starts specifying her individual steps, she has become a template engine
 * wearing an employee costume, and the proactivity that justified OpenClaw is
 * gone. `planTheDay` below is the seam that keeps that honest.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { correlateFleet, evaluate, type Breach } from "./liveness";
import { allowsKind } from "./spendCeiling";

/* -------------------------------------------------------------------------- */
/* Who the loop runs for                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Customers routed to the new module.
 *
 * Migration is per-customer, not a flag day (§3.4) — v1 customers keep running
 * on the frozen `gtmMaya` agent and are untouched by anything here.
 */
export const activeV2Customers = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Id<"customers">>> => {
    const rows = (await ctx.db
      .query("customers")
      .withIndex("by_agent_version", (q) => q.eq("agentVersion", "v2"))
      .collect()) as Doc<"customers">[];
    // Paused and cancelled accounts are supposed to be quiet. Filtering here
    // rather than inside each job keeps "don't act on a paused account" in one
    // place instead of five.
    return rows.filter((c) => c.state === "active").map((c) => c._id);
  },
});

/* -------------------------------------------------------------------------- */
/* The wake — the seam where judgment happens                                  */
/* -------------------------------------------------------------------------- */

export interface DayPlan {
  plannedPosts: Array<{ channel: string; angle: string }>;
  blockedChannels: Array<{ channel: string; reason: string }>;
  /** True when this came from Maya; false when we fell back. */
  fromAgent: boolean;
}

/**
 * Ask Maya to decide the day.
 *
 * **This is a seam, and it is currently a fallback.** The OpenClaw pack for
 * `convex/maya` doesn't exist yet, so there is no session to wake. Rather than
 * pretend, this assembles a plan deterministically from connected channels and
 * the idea bank, and marks it `fromAgent: false` so nothing downstream can
 * mistake it for judgment.
 *
 * That's not a placeholder for its own sake — a deterministic fallback plan is
 * already product doctrine. The old module carries a "synthesis safety-net"
 * for exactly this: if the LLM turn flakes, assemble from stored rows and
 * deliver anyway, so the founder is never left without a plan.
 *
 * When the pack lands, this calls her instead — and the contract stays the
 * same: hand her context, get a plan back. It must never grow into a list of
 * steps for her to execute.
 */
/* -------------------------------------------------------------------------- */
/* What Convex still schedules — and what it deliberately does not             */
/* -------------------------------------------------------------------------- */

/**
 * `planTheDay`, `morningRunAll`, and `eveningRecapAll` lived here and are gone
 * (§18 Sprint 2.9).
 *
 * They were a reimplementation of OpenClaw's cron: a Convex daily cron at
 * 07:00 **UTC** composing a brief and waking the machine to deliver it. Three
 * problems, in ascending order of seriousness:
 *
 * 1. **UTC.** A 07:00 brief is a 23:00 brief in Los Angeles. v1 shipped the
 *    same double-timezone bug and everything arrived four hours late.
 * 2. **It duplicated a scheduler we already pay for.** OpenClaw's cron store
 *    persists, survives restarts, reschedules overdue jobs on startup, and
 *    evaluates in the founder's timezone.
 * 3. **It routed through a `wake_agent` job that had no handler**, so the whole
 *    path dead-lettered. The brief never actually happened.
 *
 * The cadence now lives in `/data/cron/jobs.json` (see the workspace
 * generator). What stays here is only work that must survive the machine being
 * unreachable:
 *
 * - **`drainJobs`** — message delivery. A brief written but not delivered is
 *   indistinguishable from one never written, from the founder's side.
 * - **`livenessSweep`** — the watchdog. This one stays in Convex for a reason
 *   that isn't cost or habit: **a system cannot be the watchdog for itself.**
 *   An agent that has stopped waking up cannot notice that it has stopped
 *   waking up.
 */

/**
 * ⭐ Every job kind this build can actually execute. **The single source of
 * truth**, and the drainer refuses anything not in it.
 *
 * This is deliberately a short list, and it should stay short. An earlier
 * version of this module enqueued `wake_agent` and `publish_placement` while
 * routing neither — both dead-lettered, so the entire proactive path silently
 * did nothing while every test stayed green. The queue looked healthy because
 * failing jobs *is* a healthy queue behaviour; what was missing was anyone
 * asking whether the kinds being enqueued could ever succeed.
 *
 * A sibling test now asserts that every kind enqueued anywhere in `convex/maya`
 * appears here, so adding a producer without a consumer fails the build rather
 * than the customer.
 */
export const HANDLED_KINDS = new Set<string>([
  "deliver_message",
  "publish_placement",
]);

/** Route a claimed job to its handler. */
async function runHandler(
  ctx: { runAction: (ref: never, args: never) => Promise<unknown> },
  job: {
    kind: string;
    payloadJson?: string;
    customerId?: Id<"customers">;
    idempotencyKey: string;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (job.kind === "deliver_message") {
    let messageId: string | undefined;
    try {
      messageId = (JSON.parse(job.payloadJson ?? "{}") as { messageId?: string })
        .messageId;
    } catch {
      return { ok: false, error: "delivery job payload is not valid JSON" };
    }
    if (!messageId) return { ok: false, error: "delivery job has no messageId" };

    const result = (await (
      ctx as unknown as {
        runAction: (
          ref: typeof internal.maya.telegram.deliverMessage,
          args: { messageId: string }
        ) => Promise<{ delivered: boolean; reason?: string }>;
      }
    ).runAction(internal.maya.telegram.deliverMessage, {
      messageId,
    })) as { delivered: boolean; reason?: string };

    return result.delivered
      ? { ok: true }
      : { ok: false, error: result.reason ?? "delivery failed" };
  }
  if (job.kind === "publish_placement") {
    // The decision was made by the iron rule (§9.1) BEFORE this was enqueued.
    // Nothing here re-decides it — a second opinion at this point would be
    // exactly the silent hold that rule exists to eliminate.
    const payload = JSON.parse(job.payloadJson ?? "{}") as {
      draftId?: Id<"drafts">;
      snapshotText?: string;
    };
    if (!payload.snapshotText) {
      return { ok: false, error: "publish job carried no text" };
    }
    // Every publish belongs to somebody. A job without one can't resolve a
    // channel or a connection, so it says so rather than failing further in.
    if (!job.customerId) {
      return { ok: false, error: "publish job has no customer" };
    }
    const customerId = job.customerId;
    const result = (await (
      ctx as unknown as {
        runAction: (
          ref: typeof internal.maya.publish.publishPlacement,
          args: {
            customerId: Id<"customers">;
            snapshotText: string;
            idempotencyKey: string;
            draftId?: Id<"drafts">;
          }
        ) => Promise<{ ok: boolean; error?: string }>;
      }
    ).runAction(internal.maya.publish.publishPlacement, {
      customerId,
      snapshotText: payload.snapshotText,
      idempotencyKey: job.idempotencyKey,
      draftId: payload.draftId,
    })) as { ok: boolean; error?: string };
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? "publish failed" };
  }

  return { ok: false, error: `unrouted job kind "${job.kind}"` };
}

/**
 * Drain the queue.
 *
 * Bounded per run so one sweep can't spin forever, and the reaper runs first
 * so a job abandoned by a dead worker is back in the queue before we claim.
 */
export const drainJobs = internalAction({
  // `now` is a TEST SEAM, and it exists because its absence was a time bomb:
  // the spend window is derived from the real clock, so a test seeding spend at
  // a fixed fixture date silently stopped throttling the moment UTC rolled past
  // that date. It passed all day and failed at midnight.
  args: { max: v.optional(v.number()), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    claimed: number;
    succeeded: number;
    failed: number;
    throttled: number;
  }> => {
    await ctx.runMutation(internal.maya.jobs.reapExpired, {});

    const max = args.max ?? 25;
    let claimed = 0;
    let succeeded = 0;
    let failed = 0;
    let throttled = 0;

    for (let i = 0; i < max; i += 1) {
      const job = await ctx.runMutation(internal.maya.jobs.claimNext, {});
      if (!job) break;
      claimed += 1;

      // The spend ceiling, consulted at the point work actually happens. A
      // ceiling nothing checks is decoration. Throttled work goes back to the
      // queue rather than failing — it isn't broken, it's deferred, and it
      // should run tomorrow when the budget resets.
      if (job.customerId) {
        const spend = await ctx.runQuery(
          internal.maya.spendCeiling.spendToday,
          { customerId: job.customerId, now: args.now }
        );
        if (!allowsKind(spend.state, job.kind)) {
          await ctx.runMutation(internal.maya.jobs.fail, {
            jobId: job._id,
            error: `deferred — ${spend.detail}`,
          });
          await ctx.runMutation(internal.maya.spendCeiling.alertThrottled, {
            customerId: job.customerId,
            detail: spend.detail,
          });
          throttled += 1;
          continue;
        }
      }

      if (!HANDLED_KINDS.has(job.kind)) {
        await ctx.runMutation(internal.maya.jobs.fail, {
          jobId: job._id,
          error: `no handler for job kind "${job.kind}" in this build`,
        });
        failed += 1;
        continue;
      }

      try {
        const outcome = await runHandler(ctx, job);
        if (outcome.ok) {
          await ctx.runMutation(internal.maya.jobs.succeed, { jobId: job._id });
          succeeded += 1;
        } else {
          await ctx.runMutation(internal.maya.jobs.fail, {
            jobId: job._id,
            error: outcome.error,
          });
          failed += 1;
        }
      } catch (error) {
        // A handler that throws is a failed job, never a lost one.
        await ctx.runMutation(internal.maya.jobs.fail, {
          jobId: job._id,
          error: error instanceof Error ? error.message : String(error),
        });
        failed += 1;
      }
    }
    return { claimed, succeeded, failed, throttled };
  },
});

export const recordBreaches = internalMutation({
  args: {
    customerId: v.id("customers"),
    breaches: v.array(
      v.object({ kind: v.string(), action: v.string(), detail: v.string() })
    ),
    /** True when this breach is one of many sharing a single root cause. */
    fleetIncident: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<{ recorded: number }> => {
    for (const breach of args.breaches) {
      await ctx.db.insert("gtmAuditEvents", {
        accountId: (
          (await ctx.db.get(args.customerId)) as Doc<"customers">
        ).accountId,
        actor: "system",
        eventType: `liveness.${breach.kind}`,
        severity: breach.action === "open_support_thread" ? "error" : "warn",
        message: breach.detail,
        metadata: {
          action: breach.action,
          ...(args.fleetIncident ? { fleetIncident: true } : {}),
        },
        createdAt: args.now,
      });
    }
    return { recorded: args.breaches.length };
  },
});

/**
 * The liveness sweep — hourly, and independent of everything above.
 *
 * It reads rows and judges them. It never asks a worker or the agent whether
 * they are healthy, because the failure that matters most is the one where
 * nobody is left to answer.
 */
export const livenessSweep = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ checked: number; breached: number; fleetIncident: boolean }> => {
    const now = args.now ?? Date.now();
    const customerIds = await ctx.runQuery(
      internal.maya.scheduler.activeV2Customers,
      {}
    );

    const perCustomer: Array<{
      customerId: (typeof customerIds)[number];
      breaches: Breach[];
    }> = [];

    for (const customerId of customerIds) {
      const facts = await ctx.runQuery(internal.maya.liveness.gatherFacts, {
        customerId,
        now,
      });
      if (!facts) continue;
      perCustomer.push({ customerId, breaches: evaluate(facts) });
    }

    // Is this many bad days, or one incident? A vendor outage makes every
    // customer breach identically, and 200 support threads for one root cause
    // buries the signal exactly when it matters most.
    const fleet = correlateFleet(perCustomer, perCustomer.length);

    let breached = 0;
    for (const { customerId, breaches } of perCustomer) {
      if (breaches.length === 0) continue;
      breached += 1;

      // The per-customer rows are still the record — each founder's recap
      // still tells them the truth. Only the ESCALATION is collapsed.
      await ctx.runMutation(internal.maya.scheduler.recordBreaches, {
        customerId,
        // The original action is preserved — overwriting it would erase the
        // severity signal (a support-thread breach is still an error even when
        // it's one of many). Correlation is recorded alongside it.
        breaches: breaches.map((b) => ({
          kind: b.kind,
          action: b.action,
          detail: b.detail,
        })),
        fleetIncident: fleet.correlated,
        now,
      });

      if (!fleet.correlated) {
        console.error(
          `[maya.liveness] ${customerId}: ${breaches
            .map((b) => `${b.kind} → ${b.action}`)
            .join(", ")}`
        );
      }
    }

    // One line, one incident.
    if (fleet.correlated) {
      console.error(`[maya.liveness] FLEET INCIDENT — ${fleet.detail}`);
    }

    return {
      checked: customerIds.length,
      breached,
      fleetIncident: fleet.correlated,
    };
  },
});
