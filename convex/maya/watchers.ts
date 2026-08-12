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
import type { FunctionReference } from "convex/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { dayKeyInZone, weekKeyInZone } from "./cadence";

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
  timezone: string,
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
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
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
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    try {
      return customer?.sweptJson ? JSON.parse(customer.sweptJson) : {};
    } catch {
      return {};
    }
  },
});

/* -------------------------------------------------------------------------- */

/**
 * ⭐ Weekly collection, claimed per WEEK rather than per day.
 *
 * ⚠️ Both of these had **zero callers** when they were written. §5.3 calls the
 * format library *"the single most differentiated capability in the product"*,
 * and it was an `internalAction` nobody invoked — which is this codebase's
 * dominant defect class (14 prior instances) and exactly what it looks like
 * from the inside: the code is right, the tests pass, and nothing happens.
 *
 * They ride the same daily cron as the sweeps above. The week key is what makes
 * them weekly — a claim that already exists for this week is skipped, so the
 * cron can fire every day and the work happens once.
 */
/**
 * ⭐ The ONE table mapping a sweep name to the function that runs it.
 *
 * ⚠️ There used to be two: a `weeklyRefs` object inside the scheduling loop
 * that was declared and NEVER READ, and a separate `refs` inside `sweepOne`
 * that did the actual dispatch. They disagreed — `refs` was missing
 * `benchmarks` and `strategy`, so both logged "no such sweep", returned
 * `ok: false`, and KEPT THEIR CLAIM. Marked done, never retried.
 *
 * Net effect: the niche medians never refreshed and the strategy review never
 * ran, every week, silently. The lists below are now derived from this map's
 * keys, so a name with no handler cannot exist.
 */
/**
 * ⭐ The ONE table mapping a sweep name to the function that runs it.
 *
 * ⚠️ There used to be two: a `weeklyRefs` object inside the scheduling loop
 * that was declared and NEVER READ, and a separate `refs` inside `sweepOne`
 * that did the actual dispatch. They disagreed — `refs` was missing
 * `benchmarks` and `strategy`, so both logged "no such sweep", returned
 * `ok: false`, and KEPT THEIR CLAIM. Marked done, never retried.
 *
 * Net effect: the niche medians never refreshed and the strategy review never
 * ran, every week, silently.
 *
 * ⚠️ A FUNCTION with an explicit return type, not a module-scope `const`. The
 * const version types itself from `internal`, which includes this module's own
 * exports — a circular inference that quietly degrades the ENTIRE codebase to
 * `any`. That is why the original built its map inside the handler.
 */
export type SweepRef = FunctionReference<
  "action",
  "internal",
  { customerId: Id<"customers">; now?: number }
>;

export function sweepRefs(): Record<string, SweepRef> {
  return {
    scroll: internal.maya.scroll.scrollNiche,
    trends: internal.maya.trends.sweepTrends,
    competitors: internal.maya.competitors.watchCompetitors,
    complaints: internal.maya.complaints.mineComplaints,
    widerWorld: internal.maya.widerWorld.sweepWiderWorld,
    formats: internal.maya.formats.watchFormats,
    hashtags: internal.maya.formats.mineHashtagSets,
    /**
     * ⚠️ After `formats`. The watch tier upgrades cards the read tier
     * produced — running it first watches last week's top videos every week,
     * which looks identical to working and is permanently a week behind.
     */
    watch: internal.maya.formats.watchTopFormats,
    /** Weekly: medians move slowly; a daily read watches a number that barely moves. */
    benchmarks: internal.maya.benchmarks.refreshBenchmarks,
    /**
     * ⚠️ Reads the ladder AND the benchmarks, so it must follow `benchmarks`.
     * Records a changelog entry and sends nothing — §16.75.05. `weeklyReport`
     * relays it.
     */
    strategy: internal.maya.strategy.reviewStrategy,
  };
}

export const WEEKLY_SWEEPS = [
  "formats",
  "hashtags",
  "watch",
  "benchmarks",
  "strategy",
] as const;

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
    args,
  ): Promise<{
    due: number;
    scheduled: number;
    skipped: number;
    failed: number;
  }> => {
    const now = args.now ?? Date.now();
    const customerIds = await ctx.runQuery(
      internal.maya.scheduler.activeV2Customers,
      {},
    );

    let due = 0;
    /** ⚠️ SCHEDULED, not completed — each sweep reports its own outcome. */
    let scheduled = 0;
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

      /**
       * ⚠️ Don't spend the day's sweeps on a vendor that has no money.
       *
       * Every sweep here reads through ScrapeCreators. With the balance at
       * zero, running them costs five failed calls and five retries per
       * customer and produces nothing — and at 200 customers that is a
       * thousand pointless requests an hour against an endpoint that is
       * already refusing us.
       *
       * The breaker fails OPEN by design (never checked, or a stale reading,
       * both mean go), so this can only stop work when a recent reading
       * actually says the vendor is out.
       */
      /**
       * ⭐ Unblock her before anything else runs.
       *
       * ⚠️ An unanswered question from a previous day makes `askFounder` refuse
       * every subsequent ask — she wakes, briefs, and can offer nothing. That
       * broke the real account's cadence for two days on 2026-08-10 and left no
       * signal at all.
       *
       * First in the sweep, and outside the vendor breaker below, deliberately:
       * this costs no vendor call, and a customer whose collection is skipped
       * for a dead vendor still needs to be able to talk.
       */
      try {
        const expiry = await ctx.runMutation(
          internal.maya.messages.expireStaleQuestions,
          { customerId, now },
        );
        if (expiry.expired > 0) scheduled += 1;
      } catch (error) {
        console.error(
          `[watchers] question expiry failed for ${customerId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      /**
       * ⭐ Refresh the home screen's one row (§16.5).
       *
       * Outside the vendor breaker and before the sweeps, for the same reason
       * the question expiry is: it needs no vendor, and a customer whose
       * collection is skipped still deserves a status line that reflects
       * reality rather than yesterday's.
       */
      try {
        await ctx.runMutation(internal.maya.dashboard.refresh, {
          customerId,
          now,
        });
      } catch (error) {
        console.error(
          `[watchers] dashboard refresh failed for ${customerId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const breaker = await ctx.runQuery(internal.maya.breaker.vendorOpen, {
        vendor: "scrapecreators",
        now,
      });
      if (!breaker.open) {
        skipped += SWEEPS.length;
        console.warn(
          `[watchers] skipped ${customerId} — ${breaker.reason ?? "vendor unavailable"}`,
        );
        continue;
      }

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
        /**
         * ⚠️ SCHEDULED, not awaited. Awaiting them put every sweep for every
         * due customer inside this one action — which exceeded Convex's
         * 300-second limit for a single customer once the weekly work was
         * included. Each now gets its own action and its own budget.
         */
        await ctx.scheduler.runAfter(0, internal.maya.watchers.sweepOne, {
          customerId,
          sweep,
          now,
        });
        scheduled += 1;
      }

      /**
       * The weekly half.
       *
       * ⚠️ Runs AFTER the daily sweeps, deliberately. `watch-formats` reads the
       * observations `scroll` collects, so running it first would build this
       * week's format library out of last week's rows — which would look
       * completely normal and be quietly a week stale, forever.
       */
      const week = weekKeyInZone(now, timezone);
      // (the sweep→function map lives at module scope — see SWEEP_REFS)

      for (const sweep of WEEKLY_SWEEPS) {
        const claim = await ctx.runMutation(internal.maya.watchers.claimSweep, {
          customerId,
          sweep,
          day: week,
        });
        if (!claim.claimed) {
          skipped += 1;
          continue;
        }
        await ctx.scheduler.runAfter(0, internal.maya.watchers.sweepOne, {
          customerId,
          sweep,
          now,
        });
        scheduled += 1;
      }
    }

    return { due, scheduled, skipped, failed };
  },
});

/**
 * ⚠️ Give a claim back when the work didn't happen.
 *
 * `claimSweep` writes the marker BEFORE the sweep runs, which is right for
 * dedupe and wrong for failure: a sweep that claimed and then died is recorded
 * as done and never retried. On a timeout that is silent data loss — the day
 * reports a clean run and collected nothing.
 */
export const releaseSweep = internalMutation({
  args: { customerId: v.id("customers"), sweep: v.string() },
  handler: async (ctx, args): Promise<{ released: boolean }> => {
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    if (!customer) return { released: false };
    let sweeps: Record<string, string> = {};
    try {
      sweeps = customer.sweptJson ? JSON.parse(customer.sweptJson) : {};
    } catch {
      return { released: false };
    }
    if (!(args.sweep in sweeps)) return { released: false };
    delete sweeps[args.sweep];
    await ctx.db.patch(args.customerId, {
      sweptJson: JSON.stringify(sweeps),
      updatedAt: Date.now(),
    });
    return { released: true };
  },
});

/**
 * ⭐ ONE sweep, for ONE customer, in its own action.
 *
 * ⚠️ **Measured 2026-08-10: the old shape exceeded Convex's 300-second action
 * limit for a SINGLE customer.** `sweepDue` awaited every sweep for every due
 * customer inside one action — five daily plus three weekly, serially. With the
 * weekly work included (`watchFormats` reads up to 50 transcripts, each with a
 * model call; `watchTopFormats` downloads video) one customer ran 301s and the
 * action was killed.
 *
 * That is not a scale problem waiting at 200 customers. It was already broken
 * at one, and it broke in the way this codebase keeps breaking: the cron
 * reported nothing, the claims were already written, and the day looked clean.
 *
 * Each sweep now gets its own action and its own 300s. They run concurrently
 * rather than in sequence, so wall-clock is the slowest single sweep instead of
 * the sum of all of them.
 */
export const sweepOne = internalAction({
  args: {
    customerId: v.id("customers"),
    sweep: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const now = args.now ?? Date.now();
    const ref = sweepRefs()[args.sweep];
    if (!ref) {
      console.error(`[watchers] no such sweep: ${args.sweep}`);
      return { ok: false };
    }

    try {
      await ctx.runAction(ref, { customerId: args.customerId, now });

      /**
       * ⭐ The weekly report, chained to `strategy` rather than listed as its
       * own sweep.
       *
       * §16.75.05: the strategy review "records a changelog entry and sends
       * nothing — the weekly report relays it." The sweeps are scheduled with
       * `runAfter(0)` in a loop, so they run CONCURRENTLY and list order
       * guarantees nothing: as a sibling sweep the report could compose before
       * `strategy` wrote, and relay last week's verdict. Which would look
       * exactly like working.
       *
       * ⚠️ `sendWeeklyReview` had NO caller at all — the report that carries
       * the ladder, the benchmarks, the traceability line and both attribution
       * asks has never been sent to anyone. `messages.send` dedupes on the
       * week key, so a double-fire is a no-op rather than two reports.
       */
      if (args.sweep === "strategy") {
        await ctx.scheduler.runAfter(
          0,
          internal.maya.weeklyReport.sendWeeklyReview,
          { customerId: args.customerId, now },
        );
      }

      return { ok: true };
    } catch (error) {
      /**
       * ⚠️ Hand the claim back so tomorrow retries. A sweep that fails and
       * keeps its claim is recorded as done and never runs again that period —
       * which is worse than the failure, because it is invisible.
       */
      await ctx.runMutation(internal.maya.watchers.releaseSweep, {
        customerId: args.customerId,
        sweep: args.sweep,
      });
      console.error(
        `[watchers] ${args.sweep} failed for ${args.customerId}, claim released: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { ok: false };
    }
  },
});
