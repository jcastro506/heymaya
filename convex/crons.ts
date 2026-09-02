import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Fleet clocks (plan §6 Sprint 2, §16.2). Per-creator cadence is computed in the
 * creator's timezone inside the jobs these fire; nothing here knows a timezone.
 */
const crons = cronJobs();

// The queue backstop. Anything a creator is waiting on is drained inline by `deliverNow`.
crons.interval("drain jobs", { minutes: 1 }, internal.core.scheduler.drainJobs, {});

export default crons;
