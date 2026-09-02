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

// The daily readback: their own posts and numbers, and a `win` signal when one crosses 3× (§21.5).
crons.daily("readback own posts", { hourUTC: 1, minuteUTC: 15 }, internal.scout.readback.run, {});

// The scout: rails then judgment, per creator, in their daytime; the gate holds the cap and quiet hours (§13.8).
crons.hourly("scout", { minuteUTC: 5 }, internal.scout.scout.runAll, {});

// The calendar sync: every connected calendar, every 30 minutes; push channels are post-pilot (§12.5).
crons.interval("sync calendars", { minutes: 30 }, internal.calendar.sync.runAll, {});

export default crons;
