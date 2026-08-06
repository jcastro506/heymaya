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

// Spend-throttle backstop (degrade, never destroy). The telemetry endpoint
// throttles an over-spending agent inline on each turn, but one that stops
// POSTing telemetry while keeping an alive, billing machine would slip through —
// this sweep catches it. Every 15 min: sum each live agent's rolling-window
// spend and throttle (pause discovery, machine stays alive) any over the
// ceiling. See convex/gtmMaya/spendKill.ts.
crons.interval(
  "gtm-spend-throttle-sweep",
  { minutes: 15 },
  internal.gtmMaya.spendKill.sweepSpendThrottle
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

// Deliver-on-connect backstop (the enum refactor). The agent's OWN plan is
// cached when it sends; if delivery didn't land (no channel then, or a transient
// failure), Convex re-pushes the cached text — cheap (one send, no LLM), bounded
// by planDeliveryAttempts. The telegram-pairing event is the primary trigger;
// this sweep catches the rest. See convex/gtmMaya/synthesisDelivery.ts.
crons.interval(
  "gtm-cached-plan-delivery",
  { minutes: 10 },
  internal.gtmMaya.synthesisDelivery.sweepCachedPlanDelivery
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

// OpenRouter aggregate-spend poll — interim COGS visibility. The per-turn cost
// is invisible to Convex (the LLM call lives on the Fly machine and the runtime
// doesn't reliably self-report), so every 20 min we poll OpenRouter's account
// usage, compute the delta, and write it to gtmCostLedger attributed to the live
// agent(s). For the single-agent dogfood the delta IS its cost. Visibility only —
// the spend kill-switch excludes these rows. See gtmMaya/openrouterSpend.ts.
crons.interval(
  "gtm-openrouter-spend-poll",
  { minutes: 20 },
  internal.gtmMaya.openrouterSpend.pollOpenrouterSpend
);

// 30-day cancellation-retention purge. A canceled GTM account keeps its data
// for 30 days (resumable) while its Fly machine is torn down at period end to
// stop COGS. After 30 days with the plan lapsed to `none`, this sweep hard-
// purges the account (same path as an explicit hard-delete) + destroys the Fly
// app. Never touches an active/trialing/past_due/resubscribed account. Runs
// every 6h — far below the 30-day granularity it gates on. See
// convex/gtmMaya/accountLifecycle.ts.
crons.interval(
  "gtm-canceled-retention-purge",
  { hours: 6 },
  internal.gtmMaya.accountLifecycle.sweepCanceledRetention
);

// ─── convex/maya — the watchers layer (§3.1) ──────────────────────────────
//
// Convex owns the CLOCK; OpenClaw owns the judgment. §3.1 traces every
// catastrophic failure in this product's record to a harness failure —
// orphaned sessions, a heartbeat re-spawning an 18-worker fleet, and crons
// firing FOUR HOURS LATE — all from putting orchestration inside a
// long-running LLM process. Two more reasons the clock can't go back there:
// OpenClaw crons are per-agent, so shared niche sweeps would cost N times for
// one answer; and a system cannot be the watchdog for itself.
//
// These fire for `agentVersion: "v2"` customers only. v1 keeps running on the
// frozen gtmMaya agent — migration is per-customer, not a flag day.

// ⛔ The morning brief and evening recap USED to be Convex crons here, at
// 07:00 and 19:00 UTC. They are OpenClaw cron jobs now (§18 Sprint 2.9).
//
// Two things were wrong with them beyond the duplication: they fired in UTC, so
// a "morning" brief landed at 23:00 for a Los Angeles founder — the same
// double-timezone bug v1 shipped — and they routed through a `wake_agent` job
// that had no handler, so the brief never actually reached anyone.
//
// The cadence lives in /data/cron/jobs.json with the founder's timezone on
// every expression. What remains below is only what must survive the machine
// being unreachable.

/**
 * ⭐ Re-learns a niche whose map has gone stale (§5.0.0).
 *
 * Daily check, monthly effect: `isStale` only fires past
 * `BUYER_MAP_MAX_AGE_MS`, so this is twelve searches a month per customer, not
 * a day. Cheap, and the alternative is a niche learned in July still driving
 * every keyword in December — silently, because stale keywords do not fail,
 * they return the wrong posts and everything downstream reports success.
 */
crons.interval(
  "maya-relearn-stale",
  { hours: 24 },
  internal.maya.learnBusiness.relearnIfStale,
  {}
);

/**
 * ⭐ Notices when a founder connects a channel.
 *
 * `syncChannels` had no caller, and it showed live: three channels were
 * connected and nothing updated — the scroll swept one, and a publish to
 * Instagram would have been refused as "not connected". It took a hand-run.
 *
 * Convex, not her machine: a founder connecting an account at 2am must be
 * noticed whether or not she happens to be awake, and this is collection with
 * no judgment in it (§2.3).
 */
crons.interval(
  "maya-sync-channels",
  { hours: 1 },
  internal.maya.channels.syncAllChannels,
  {}
);

/**
 * ⭐ Reads back how her posts did.
 *
 * `dailyReport` has read `metricsJson` since Sprint 2 and NOTHING EVER WROTE
 * IT — so the evening recap's "what came back" was permanently empty, and every
 * morning's idea pick was blind.
 *
 * Convex rather than her machine, deliberately: this is collection, and §2.3
 * puts collection in deterministic code. It also has to keep running while she
 * is asleep, which is most of the day under auto-stop.
 *
 * Hourly is not for freshness — a tweet's numbers barely move hour to hour —
 * it is so the evening recap always has something recent to report without
 * having to fetch anything itself.
 */
crons.interval(
  "maya-refresh-metrics",
  { hours: 1 },
  internal.maya.metrics.refreshAll,
  {}
);

// Drains the durable job queue, reaping abandoned work first so a job whose
// worker died is back in the queue before anything new is claimed.
crons.interval(
  "maya-drain-jobs",
  { minutes: 5 },
  internal.maya.scheduler.drainJobs,
  {}
);

// The liveness contract (§12), independent of every worker above.
crons.interval(
  "maya-liveness-sweep",
  { hours: 1 },
  internal.maya.scheduler.livenessSweep,
  {}
);

// Vendor smoke suite (§18.0.5). 200 OK is not enough — the Zernio publish
// failures returned 200s for six days because a lenient `.passthrough()` schema
// parsed a changed response shape "successfully" into nothing. These runs parse
// STRICTLY so a contract change is an incident the same day, not a mystery the
// next week. Results land in `vendorHealth`; a red tier 2 blocks any deploy
// touching that vendor. See convex/vendorSmoke/.
//
// Tier 1 — reachability. Free, so it runs hourly: auth valid, base URL
// answering, credit balance readable.
crons.interval(
  "vendor-smoke-tier1-reachability",
  { hours: 1 },
  internal.vendorSmoke.runner.runTier1
);

// Tier 2 — shape. Reads only, cents a day. This is the tier that would have
// caught the six-day incident.
crons.daily(
  "vendor-smoke-tier2-shape",
  { hourUTC: 8, minuteUTC: 20 },
  internal.vendorSmoke.runner.runTier2
);

// Tier 3 — round-trip. Real money (a post lands, a render completes), so it's
// weekly, off-peak, and additionally run before any deploy touching a vendor.
crons.weekly(
  "vendor-smoke-tier3-roundtrip",
  { dayOfWeek: "sunday", hourUTC: 9, minuteUTC: 40 },
  internal.vendorSmoke.runner.runTier3
);

export default crons;
