/**
 * ⭐ The watchers layer (§3.1) — collection that does not depend on her.
 *
 * > *"She is **not** the thing polling APIs."*
 * >
 * > What the agent never owns: **polling, scraping, retrying, rate-limiting,
 * > budget enforcement, consent enforcement, liveness.**
 *
 * Until now every sweep — scroll, trends, wider world, competitors, complaints
 * — was reachable only through `hooks.ts`, meaning it ran **only when she chose
 * to call the tool.** The OpenClaw cron prompts her to scroll each morning; if
 * that turn fails, the niche isn't watched that day and nothing notices.
 *
 * Not hypothetical. On 2026-08-08 the morning-brief turn produced nothing at
 * all. The scroll turn happened to survive — had it been the other way round,
 * the day's perception would have been silently empty and the evening recap
 * would have reported on rows nobody collected.
 *
 * §3.1 names the failure class and why the split exists:
 *
 * > *"Every catastrophic failure in the current record is a harness failure…
 * > Those all come from putting collection and orchestration inside a
 * > long-running LLM process. Move them out and the failure class disappears
 * > while the employee feel is untouched."*
 *
 * ⚠️ **This does not move her crons.** OpenClaw still owns her life —
 * heartbeat, brief, placement, memory. What moves is *collection*. She keeps
 * every tool and can still pull fresh data mid-conversation; she just no longer
 * has to remember to, and the rows are there when she wakes.
 *
 * ## Why this doesn't increase spend
 *
 * The OpenClaw cron already tells her to scroll daily, so the volume is
 * unchanged — this makes it **reliable**, not more frequent. The once-a-day
 * claim below is what holds that: a sweep already run today is skipped, whether
 * it was this cron an hour ago or her calling the tool at breakfast.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { dayKeyInZone } from "./cadence";

/** Local hour the day's collection should have happened by. */
export const SWEEP_HOUR_LOCAL = 7;

/**
 * ⭐ Jitter, because 200 customers on one cron is a thundering herd.
 *
 * Sprint 5 lists *"jitter on every cron"* and nothing implemented it. Without
 * it every customer's sweep fires in the same second: ScrapeCreators sees 200
 * simultaneous requests, rate-limits most, and the retries land together too.
 * It looks like a vendor outage and is entirely self-inflicted.
 *
 * ⚠️ Derived from the customer id, never random. A random offset would make
 * *"did today's sweep run?"* unanswerable — you could never tell late from
 * missing, which is the question this whole layer exists to answer.
 */
export function jitterMinute(customerId: string): number {
  let hash = 0;
  for (let i = 0; i < customerId.length; i += 1) {
    hash = (hash * 31 + customerId.charCodeAt(i)) >>> 0;
  }
  return hash % 60;
}

/** How often the cron fires. A slot is due if it falls inside this window. */
export const TICK_MINUTES = 10;

/** The founder's local hour and minute, right now. */
export function localHourMinute(
  now: number,
  timezone: string
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(now));
  const [hour, minute] = parts.split(":").map(Number);
  return { hour, minute };
}

/**
 * Is this customer's slot inside the tick we're in?
 *
 * Pure, so the scheduling decision is testable without a clock, a database or a
 * cron — the part most likely to be subtly wrong is the part hardest to observe
 * in production.
 */
export function isDue(input: {
  now: number;
  timezone: string;
  customerId: string;
}): boolean {
  const { hour, minute } = localHourMinute(input.now, input.timezone);
  if (hour !== SWEEP_HOUR_LOCAL) return false;
  const slot = jitterMinute(input.customerId);
  return minute >= slot && minute < slot + TICK_MINUTES;
}

/* -------------------------------------------------------------------------- */
/* The once-a-day claim                                                        */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ A day marker on the customer row, NOT a job.
 *
 * The first draft of this file claimed each sweep by enqueueing a job with
 * `kind: "deliver_message"` as a lock. That kind is *handled* — `drainJobs`
 * would have picked up every one, tried to deliver a message with no
 * `messageId`, and dead-lettered five jobs per customer per day. A dedupe lock
 * borrowed from a work queue is a work item.
 *
 * A JSON field is the right shape here and matches the existing convention for
 * small per-customer collections (the schema sits near TypeScript's
 * instantiation ceiling, so new tables are not free).
 */
export const claimSweep = internalMutation({
  args: {
    customerId: v.id("customers"),
    sweep: v.string(),
    day: v.string(),
  },
  handler: async (ctx, args): Promise<{ claimed: boolean }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { claimed: false };

    let sweeps: Record<string, string> = {};
    try {
      sweeps = customer.sweptJson ? JSON.parse(customer.sweptJson) : {};
    } catch {
      sweeps = {};
    }
    if (sweeps[args.sweep] === args.day) return { claimed: false };

    sweeps[args.sweep] = args.day;
    await ctx.db.patch(args.customerId, {
      sweptJson: JSON.stringify(sweeps),
      updatedAt: Date.now(),
    });
    return { claimed: true };
  },
});

export const sweptFor = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    try {
      return customer?.sweptJson ? JSON.parse(customer.sweptJson) : {};
    } catch {
      return {};
    }
  },
});

/* -------------------------------------------------------------------------- */

export const SWEEPS = [
  "scroll",
  "trends",
  "competitors",
  "complaints",
  "widerWorld",
] as const;

/**
 * Run the day's collection for every customer whose slot has come round.
 *
 * ⚠️ Failures are per-customer AND per-sweep. One dead handle must not stop the
 * other four sweeps, and one broken customer must not stop the other 199 — a
 * watcher whose whole point is to keep working when something else doesn't
 * cannot be a single try/catch.
 */
export const sweepDue = internalAction({
  args: { now: v.optional(v.number()), force: v.optional(v.boolean()) },
  handler: async (
    ctx,
    args
  ): Promise<{ due: number; ran: number; skipped: number; failed: number }> => {
    const now = args.now ?? Date.now();
    const customerIds = await ctx.runQuery(
      internal.maya.scheduler.activeV2Customers,
      {}
    );

    let due = 0;
    let ran = 0;
    let skipped = 0;
    let failed = 0;

    const refs = {
      scroll: internal.maya.scroll.scrollNiche,
      trends: internal.maya.trends.sweepTrends,
      competitors: internal.maya.competitors.watchCompetitors,
      complaints: internal.maya.complaints.mineComplaints,
      widerWorld: internal.maya.widerWorld.sweepWiderWorld,
    } as const;

    for (const customerId of customerIds) {
      const timezone = await ctx.runQuery(internal.maya.liveness.timezoneFor, {
        customerId,
      });
      if (!args.force && !isDue({ now, timezone, customerId })) continue;
      due += 1;

      const day = dayKeyInZone(now, timezone);

      for (const sweep of SWEEPS) {
        const claim = await ctx.runMutation(internal.maya.watchers.claimSweep, {
          customerId,
          sweep,
          day,
        });
        if (!claim.claimed) {
          skipped += 1;
          continue;
        }

        try {
          await ctx.runAction(refs[sweep], { customerId, now });
          ran += 1;
        } catch (error) {
          failed += 1;
          console.error(
            `[watchers] ${sweep} failed for ${customerId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }

    return { due, ran, skipped, failed };
  },
});
