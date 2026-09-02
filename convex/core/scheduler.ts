/**
 * The clock and the dispatcher (plan §11.4, §16.1). Convex owns when work
 * happens; skills decide what she says. Adapted from the legacy watchers layer
 * with the machine wake and the publish/render kinds removed.
 *
 * `HANDLED_KINDS` is the single source of truth for what this build can run. A
 * sibling test reads every `jobs.enqueue` call site and asserts its kind is in
 * this set, because the previous product enqueued two kinds with no handler and
 * the whole proactive path dead-lettered while every test stayed green.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

export const HANDLED_KINDS = new Set<string>([
  "deliver_message",
  "converse",
  "first_read",
  "ingest_catalogue",
]);

type Handler = (
  ctx: { runAction: (ref: never, args: never) => Promise<unknown> },
  job: { kind: string; payloadJson?: string; creatorId?: Id<"creators">; idempotencyKey: string },
) => Promise<{ ok: true } | { ok: false; error: string; defer?: number }>;

function payloadOf<T>(job: { payloadJson?: string }): T | null {
  try {
    return JSON.parse(job.payloadJson ?? "{}") as T;
  } catch {
    return null;
  }
}

const handlers: Record<string, Handler> = {
  async deliver_message(ctx, job) {
    const p = payloadOf<{ messageId?: Id<"messages"> }>(job);
    if (!p) return { ok: false, error: "delivery job payload is not valid JSON" };
    if (!p.messageId) return { ok: false, error: "delivery job has no messageId" };
    const r = (await (ctx as unknown as { runAction: (ref: typeof internal.core.telegram.deliverMessage, a: { messageId: Id<"messages"> }) => Promise<{ delivered: boolean; reason?: string }> })
      .runAction(internal.core.telegram.deliverMessage, { messageId: p.messageId }));
    if (r.delivered) return { ok: true };
    if (r.reason?.includes("no Telegram chat paired")) return { ok: false, error: r.reason, defer: 10 * 60 * 1000 };
    return { ok: false, error: r.reason ?? "delivery failed" };
  },
  async converse(ctx, job) {
    const p = payloadOf<{ messageId?: Id<"messages">; chatId?: string; kind?: string }>(job);
    if (!p?.messageId || !job.creatorId) return { ok: false, error: "converse job has no message or creator" };
    const r = (await (ctx as unknown as { runAction: (ref: typeof internal.agent.converse.run, a: { creatorId: Id<"creators">; messageId: Id<"messages"> }) => Promise<{ ok: boolean; reason?: string }> })
      .runAction(internal.agent.converse.run, { creatorId: job.creatorId, messageId: p.messageId }));
    return r.ok ? { ok: true } : { ok: false, error: r.reason ?? "turn failed" };
  },
  async first_read(ctx, job) {
    if (!job.creatorId) return { ok: false, error: "first_read job has no creator" };
    const r = (await (ctx as unknown as { runAction: (ref: typeof internal.onboarding.firstRead.run, a: { creatorId: Id<"creators"> }) => Promise<{ ok: boolean; reason?: string }> })
      .runAction(internal.onboarding.firstRead.run, { creatorId: job.creatorId }));
    return r.ok ? { ok: true } : { ok: false, error: r.reason ?? "first read failed" };
  },
  async ingest_catalogue(ctx, job) {
    if (!job.creatorId) return { ok: false, error: "ingest job has no creator" };
    const r = (await (ctx as unknown as { runAction: (ref: typeof internal.onboarding.ingest.run, a: { creatorId: Id<"creators"> }) => Promise<{ ok: boolean; reason?: string }> })
      .runAction(internal.onboarding.ingest.run, { creatorId: job.creatorId }));
    return r.ok ? { ok: true } : { ok: false, error: r.reason ?? "ingest failed" };
  },
};

/**
 * Deliver what's queued, right now, from inside an action that just wrote it.
 * For anything a creator is actively waiting on. Errors are swallowed on
 * purpose: the minute cron is the backstop, so a transient failure here costs
 * latency rather than the message.
 */
export async function deliverNow(ctx: { runAction: (ref: never, args: never) => Promise<unknown> }): Promise<void> {
  try {
    await (ctx as unknown as { runAction: (ref: typeof internal.core.scheduler.drainJobs, a: Record<string, never>) => Promise<unknown> }).runAction(internal.core.scheduler.drainJobs, {});
  } catch {
    // The cron will pick it up.
  }
}

/**
 * Drain the queue. Bounded per run; the reaper runs first so a job abandoned by
 * a dead worker is back in the queue before we claim. Budget checks (§3.5) sit
 * at the point work actually happens, once `budgets` lands with the sweeps.
 */
export const drainJobs = internalAction({
  args: { max: v.optional(v.number()), kinds: v.optional(v.array(v.string())) },
  handler: async (ctx, args): Promise<{ claimed: number; succeeded: number; failed: number }> => {
    await ctx.runMutation(internal.core.jobs.reapExpired, {});
    const max = args.max ?? 25;
    let claimed = 0, succeeded = 0, failed = 0;

    for (let i = 0; i < max; i += 1) {
      const job = await ctx.runMutation(internal.core.jobs.claimNext, { kinds: args.kinds });
      if (!job) break;
      claimed += 1;

      const handler = handlers[job.kind];
      if (!handler || !HANDLED_KINDS.has(job.kind)) {
        await ctx.runMutation(internal.core.jobs.fail, { jobId: job._id, error: `no handler for job kind "${job.kind}" in this build` });
        failed += 1;
        continue;
      }

      try {
        const outcome = await handler(ctx as never, job);
        if (outcome.ok) {
          await ctx.runMutation(internal.core.jobs.succeed, { jobId: job._id });
          succeeded += 1;
        } else if (outcome.defer) {
          await ctx.runMutation(internal.core.jobs.defer, { jobId: job._id, delayMs: outcome.defer, reason: outcome.error });
        } else {
          await ctx.runMutation(internal.core.jobs.fail, { jobId: job._id, error: outcome.error });
          failed += 1;
        }
      } catch (error) {
        // A handler that throws is a failed job, never a lost one.
        await ctx.runMutation(internal.core.jobs.fail, { jobId: job._id, error: error instanceof Error ? error.message : String(error) });
        failed += 1;
      }
    }
    return { claimed, succeeded, failed };
  },
});
