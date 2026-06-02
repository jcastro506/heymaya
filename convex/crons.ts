/**
 * Convex cron jobs — CENTRAL, backend-side scheduled work (distinct from the
 * per-agent crons each deployed Maya self-schedules in OpenClaw).
 *
 * Anything SHARED across all customers belongs here, not in an OpenClaw cron:
 * a per-agent cron would run N times for N customers on identical shared data.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Shared platform-algorithm intelligence — refresh once a month, centrally, so
// every Maya grounds her format/timing/cadence choices in THIS month's reality
// without each customer's agent re-researching it. See
// convex/gtmMaya/platformAlgo.ts for why this is a Convex cron, not OpenClaw.
crons.monthly(
  "platform-algo-refresh",
  { day: 1, hourUTC: 9, minuteUTC: 0 },
  internal.gtmMaya.platformAlgo.refreshAllPlatformAlgo
);

export default crons;
