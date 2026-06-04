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

// Sprint 8 — the compounding archetype brain. Roll up every tenant's structured,
// converting learnings into a k-anonymous (≥5 distinct tenants) per-archetype
// playbook that warm-starts the next founder of the same archetype. Cross-tenant
// by design, PII-free by construction — see convex/gtmMaya/archetypeBrain.ts.
crons.monthly(
  "archetype-brain-rollup",
  { day: 2, hourUTC: 9, minuteUTC: 0 },
  internal.gtmMaya.archetypeBrain.runArchetypeRollup
);

export default crons;
