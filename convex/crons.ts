import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Fleet clocks (plan §6 Sprint 2, §16.2). Per-creator cadence is computed in the
 * creator's timezone inside the jobs these fire; nothing here knows a timezone.
 */
const crons = cronJobs();

// The queue backstop. Anything a creator is waiting on is drained inline by `deliverNow`.
crons.interval("drain jobs", { minutes: 1 }, internal.core.scheduler.drainJobs, {});

// The tracked-account sampler: one read per distinct admired account per 6 h, fleet-wide (§13.2).
crons.interval("sample tracked accounts", { hours: 6 }, internal.scout.sampler.run, {});

// The niche sweep: one search per distinct lane keyword per day, shared across creators (§3.2).
crons.daily("sweep lane keywords", { hourUTC: 11, minuteUTC: 30 }, internal.scout.sweep.run, {});

// The scout: rails then judgment, per creator, in their daytime; the gate holds the cap and quiet hours (§13.8).
crons.hourly("scout", { minuteUTC: 5 }, internal.scout.scout.runAll, {});

export default crons;
