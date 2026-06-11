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

// Hard spend kill-switch backstop. The telemetry endpoint kills a runaway
// inline on each turn, but an agent that stops POSTing telemetry while keeping
// an alive, billing machine would slip through — this sweep catches it. Every
// 15 min: sum each live agent's rolling-window spend and destroy any over the
// kill ceiling. See convex/gtmMaya/spendKill.ts.
crons.interval(
  "gtm-spend-kill-sweep",
  { minutes: 15 },
  internal.gtmMaya.spendKill.sweepSpendKill
);

// Deterministic synthesis safety-net. If an agent's foundation research is
// complete but no plan was proposed within the grace window (the LLM synthesis
// turn flaked), assemble the plan from stored research and send it directly so
// the founder is never left without one. See convex/gtmMaya/synthesisDelivery.ts.
crons.interval(
  "gtm-synthesis-safety-net",
  { minutes: 10 },
  internal.gtmMaya.synthesisDelivery.sweepSynthesisSafetyNet
);

// Liveness / dark-day watchdog. Over weeks the likely failure isn't a crash —
// it's quiet degradation: the machine dies or the LLM goes NO_REPLY for days and
// nothing notices. Every 30 min: flag any live, past-onboarding agent that
// missed a full daily cadence (dark brief) or logs zero operational spend while
// alive (blind cost — the kill-switch can't see it), and ALERT the operator.
// Never auto-kills (silence is a human-investigate signal). See livenessWatch.ts.
crons.interval(
  "gtm-liveness-watch",
  { minutes: 30 },
  internal.gtmMaya.livenessWatch.sweepLiveness
);

export default crons;
