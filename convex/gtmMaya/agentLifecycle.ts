/**
 * Maya v2 (#15) — DURABLE agent lifecycle state + foundation lease.
 *
 * WHY THIS EXISTS
 * ---------------
 * The live PocketLog deploy exposed a "re-doing loop": the agent re-ran the
 * whole onboarding/foundation pipeline every 5 minutes forever, producing 42
 * drafts, 9 day-1 calendar events, fabricated multi-day history, and a spammed
 * invented `morning_brief_recovery` cron.
 *
 * Root cause: the lifecycle markers (hello_sent, foundation_completed,
 * last_morning_brief) lived ONLY in MEMORY.md — a file on the EPHEMERAL Fly
 * machine that the bootstrap re-extracts (wipes) on every restart. With the
 * markers gone, the heartbeat watchdog read "foundation not done" and re-entered
 * the pipeline; nothing held a lock, and blind inserts appended duplicates.
 *
 * THE FIX (this module): lifecycle markers are now durable Convex fields on
 * `gtmAgents`. `foundationComplete` is computed from durable state — both the
 * explicit `foundationCompletedAt` marker AND the actual presence of foundation
 * rows (voice profile + target threads + drafts + a day-1 event) — so even if a
 * marker write is missed, the presence of real work means "do NOT re-run."
 * `acquireFoundationLease` is a check-and-set that lets only ONE heartbeat /
 * machine run the foundation pass at a time.
 *
 * Convex = durable brain (source of truth). OpenClaw = executor that ASKS Convex
 * "state? next?" via the typed `get_agent_lifecycle` / `acquire_foundation_lease`
 * / `mark_lifecycle` tools and writes results back. MEMORY.md = scratchpad,
 * NEVER authoritative.
 */

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Default foundation lease window. A foundation pass that genuinely needs
 *  longer re-acquires on the next heartbeat tick; a crashed pass frees the slot
 *  when the lease expires. */
export const FOUNDATION_LEASE_MS = 15 * 60 * 1000;
/** Hard cap on foundation-lease acquisitions. The watchdog re-acquires the lease
 *  each tick to resume the pass; past this many, with foundation still
 *  incomplete, the lease is DENIED so a stuck agent cannot re-spawn the research
 *  fleet forever (observed live: 283 subagent sessions / ~12× re-runs). After the
 *  cap the agent surfaces an honest "still building" and the cadence crons own
 *  the rest. Generous enough that a healthy multi-tick pass never hits it. */
export const FOUNDATION_MAX_LEASE_ACQUIRES = 8;

export type AgentLifecyclePhase =
  | "fresh"
  | "hello_sent"
  | "foundation_in_progress"
  | "active";

/** The current step of the onboarding pipeline, derived from durable rows — so
 *  the watchdog spawns ONLY the current step's workers and never re-runs a step
 *  whose output already exists. `research` = the ~16-worker foundation fleet;
 *  `finalize` = research is DONE, only discovery/drafting/synthesis remain (NEVER
 *  re-spawn research); `complete` = onboarding done. */
export type FoundationStep = "research" | "finalize" | "complete";

export interface AgentLifecycle {
  phase: AgentLifecyclePhase;
  helloSent: boolean;
  helloSentAt: number | null;
  foundationStarted: boolean;
  foundationStartedAt: number | null;
  foundationComplete: boolean;
  foundationCompletedAt: number | null;
  lastMorningBriefAt: number | null;
  /** Unix-ms the foundation lease is held until (null if free). */
  leaseHeldUntil: number | null;
  /** True when a lease is currently held (not expired). */
  leaseActive: boolean;
  // ─── Evidence that real foundation work landed (durable rows) ─────────────
  hasVoiceProfile: boolean;
  targetThreadCount: number;
  draftCount: number;
  calendarEventCount: number;
  // ─── Phase-aware re-spawn control (the 283-session fix) ───────────────────
  /** Foundation RESEARCH output exists (buyer map + ≥1 competitor + ≥1 channel
   *  scorecard). Once true, the watchdog must NEVER re-spawn the research fleet. */
  researchComplete: boolean;
  /** The current onboarding step to act on — research / finalize / complete. */
  foundationStep: FoundationStep;
  /** How many times the foundation lease has been acquired (the cap counter). */
  leaseAcquireCount: number;
}

/**
 * Compute the durable lifecycle for an agent from its row + foundation rows.
 * Shared by the `getAgentLifecycle` query and `getMyFoundation` so both report
 * the same completeness.
 *
 * `foundationComplete` is true when EITHER the explicit marker is set OR enough
 * real foundation rows exist that re-running would only duplicate work:
 * a saved voice profile + ≥1 target thread + ≥1 draft + ≥1 (non-cancelled)
 * calendar event. Row-presence is the belt-and-suspenders behind the marker.
 */
export async function computeAgentLifecycle(
  ctx: QueryCtx | MutationCtx,
  agent: Doc<"gtmAgents">,
  now: number
): Promise<AgentLifecycle> {
  // Threads have no by_agent index; account↔agent is 1:1 in GTM, so by_account
  // (then filtered to this agent) is equivalent and cross-tenant safe.
  const threads = await ctx.db
    .query("gtmTargetThreads")
    .withIndex("by_account", (q) => q.eq("accountId", agent.accountId))
    .collect();
  const targetThreadCount = threads.filter(
    (t) => t.agentId === agent._id
  ).length;

  const drafts = await ctx.db
    .query("gtmDraftedContent")
    .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
    .collect();
  const draftCount = drafts.length;

  const events = await ctx.db
    .query("gtmCalendarEvents")
    .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
    .collect();
  const calendarEventCount = events.filter(
    (e) => e.status !== "cancelled"
  ).length;

  // Foundation RESEARCH output (the ~16-worker fleet's product): a buyer map, at
  // least one competitor, at least one channel scorecard. Once these exist the
  // research is done and must never be re-spawned.
  const buyerMap = await ctx.db
    .query("gtmBuyerMap")
    .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
    .first();
  const competitorCount = (
    await ctx.db
      .query("gtmCompetitiveMap")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect()
  ).length;
  const scorecardCount = (
    await ctx.db
      .query("gtmChannelScorecard")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect()
  ).length;
  const researchComplete =
    buyerMap !== null && competitorCount >= 1 && scorecardCount >= 1;

  const hasVoiceProfile =
    typeof agent.voiceProfileJson === "string" &&
    agent.voiceProfileJson.trim().length > 0;

  const helloSentAt = agent.helloSentAt ?? null;
  const foundationStartedAt = agent.foundationStartedAt ?? null;
  const foundationCompletedAt = agent.foundationCompletedAt ?? null;
  const leaseHeldUntil = agent.foundationLeaseUntil ?? null;
  const leaseActive = leaseHeldUntil !== null && leaseHeldUntil > now;

  // Onboarding's terminal output is: research + the strategy PITCH sent to the
  // founder ("here's the plan, I start posting tomorrow morning") — NOT a day-1
  // event today (the daily morning_brief owns each day's posting from tomorrow).
  //
  // ⚠️ Voice is NOT a completion gate. A founder with NO social handles (e.g. a
  // brand with only a website) has no posts to extract a voice from — so
  // `hasVoiceProfile` is legitimately false and a low-confidence default is used.
  // Gating completion on voice made foundation NEVER auto-complete for those
  // founders, so the heartbeat watchdog re-ran the WHOLE foundation pass every
  // tick (observed live: 283 subagent sessions / ~12× re-spawn of all 16 worker
  // types on ONE onboarding). Row-completeness is now: real research landed
  // (target threads + at least one draft). The explicit `foundationCompletedAt`
  // marker (set right after the synthesis is sent) remains the authoritative
  // signal; this is the backstop that must reliably flip so the watchdog STOPS.
  const rowsComplete = targetThreadCount >= 1 && draftCount >= 1;
  const foundationComplete = foundationCompletedAt !== null || rowsComplete;

  const helloSent = helloSentAt !== null;
  const foundationStarted = foundationStartedAt !== null || leaseActive;

  // The step the watchdog should act on — derived from rows, so a completed step
  // is NEVER re-run. research → (research not done yet, spawn the fleet);
  // finalize → (research DONE, only discovery/drafts/synthesis remain — never
  // re-spawn the research fleet); complete → onboarding done.
  const foundationStep: FoundationStep = foundationComplete
    ? "complete"
    : researchComplete
      ? "finalize"
      : "research";
  const leaseAcquireCount = agent.foundationLeaseAcquireCount ?? 0;

  let phase: AgentLifecyclePhase;
  if (foundationComplete) phase = "active";
  else if (foundationStarted) phase = "foundation_in_progress";
  else if (helloSent) phase = "hello_sent";
  else phase = "fresh";

  return {
    phase,
    helloSent,
    helloSentAt,
    foundationStarted,
    foundationStartedAt,
    foundationComplete,
    foundationCompletedAt,
    lastMorningBriefAt: agent.lastMorningBriefAt ?? null,
    leaseHeldUntil,
    leaseActive,
    hasVoiceProfile,
    targetThreadCount,
    draftCount,
    calendarEventCount,
    researchComplete,
    foundationStep,
    leaseAcquireCount,
  };
}

/** Read the durable lifecycle for an agent. The boot + heartbeat call this
 *  FIRST instead of reading MEMORY.md markers. */
export const getAgentLifecycle = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<AgentLifecycle | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    return await computeAgentLifecycle(ctx, agent, Date.now());
  },
});

/** Mark the intro as sent. Idempotent — only writes the FIRST time, so the
 *  deploy-time hello, the boot hello, and the safety-net cron can never
 *  double-send. */
export const markHelloSent = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<{ alreadySent: boolean }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("markHelloSent: agent not found");
    if (agent.helloSentAt) return { alreadySent: true };
    await ctx.db.patch(args.agentId, {
      helloSentAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { alreadySent: false };
  },
});

/**
 * Check-and-set foundation lease. The heartbeat watchdog calls this BEFORE
 * running the foundation pass:
 *   - `alreadyComplete` → foundation is done; do NOT run (ticks silent).
 *   - `acquired:false, leaseActive:true` → another tick/machine owns it; wait.
 *   - `acquired:true` → this caller owns the pass for `leaseUntil`. Sets
 *     `foundationStartedAt` on first acquire.
 */
export const acquireFoundationLease = internalMutation({
  args: { agentId: v.id("gtmAgents"), ttlMs: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    acquired: boolean;
    alreadyComplete: boolean;
    leaseActive: boolean;
    leaseUntil: number | null;
    // Phase-aware re-spawn control. The watchdog acts ONLY on `foundationStep`:
    //   "research"  → spawn the foundation research fleet.
    //   "finalize"  → research is DONE; only discovery/drafts/synthesis remain —
    //                 NEVER re-spawn the research fleet.
    //   "complete"  → onboarding done.
    foundationStep: FoundationStep;
    researchComplete: boolean;
    // HARD CAP: true once the lease has been acquired too many times without
    // completing. The lease is denied — the agent physically cannot re-run the
    // pass again. It must surface an honest "still building" and let the crons
    // take over, rather than re-spawn the fleet forever.
    capped: boolean;
  }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("acquireFoundationLease: agent not found");
    const now = Date.now();
    const lifecycle = await computeAgentLifecycle(ctx, agent, now);
    const base = {
      foundationStep: lifecycle.foundationStep,
      researchComplete: lifecycle.researchComplete,
    };
    if (lifecycle.foundationComplete) {
      return { acquired: false, alreadyComplete: true, leaseActive: false, leaseUntil: null, capped: false, ...base };
    }
    if (lifecycle.leaseActive) {
      return { acquired: false, alreadyComplete: false, leaseActive: true, leaseUntil: lifecycle.leaseHeldUntil, capped: false, ...base };
    }
    // The hard backstop: a stuck agent that keeps re-acquiring without finishing
    // is denied past the cap, so it cannot re-spawn the research fleet forever.
    if (lifecycle.leaseAcquireCount >= FOUNDATION_MAX_LEASE_ACQUIRES) {
      return { acquired: false, alreadyComplete: false, leaseActive: false, leaseUntil: null, capped: true, ...base };
    }
    const leaseUntil = now + (args.ttlMs ?? FOUNDATION_LEASE_MS);
    await ctx.db.patch(args.agentId, {
      foundationLeaseUntil: leaseUntil,
      foundationStartedAt: agent.foundationStartedAt ?? now,
      foundationLeaseAcquireCount: lifecycle.leaseAcquireCount + 1,
      updatedAt: now,
    });
    return { acquired: true, alreadyComplete: false, leaseActive: false, leaseUntil, capped: false, ...base };
  },
});

/** Mark foundation done AND clear the lease. Called once, after the synthesis
 *  + the single day-1 move have actually landed in the DB. */
export const markFoundationComplete = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<{ alreadyComplete: boolean }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("markFoundationComplete: agent not found");
    const now = Date.now();
    if (agent.foundationCompletedAt) {
      // Idempotent — still clear any stale lease.
      if (agent.foundationLeaseUntil) {
        await ctx.db.patch(args.agentId, {
          foundationLeaseUntil: undefined,
          updatedAt: now,
        });
      }
      return { alreadyComplete: true };
    }
    await ctx.db.patch(args.agentId, {
      foundationCompletedAt: now,
      foundationStartedAt: agent.foundationStartedAt ?? now,
      foundationLeaseUntil: undefined,
      updatedAt: now,
    });
    return { alreadyComplete: false };
  },
});

/** Release the foundation lease WITHOUT marking complete — for a pass that
 *  yields mid-pipeline so the next tick can resume. */
export const releaseFoundationLease = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return;
    if (agent.foundationLeaseUntil) {
      await ctx.db.patch(args.agentId, {
        foundationLeaseUntil: undefined,
        updatedAt: Date.now(),
      });
    }
  },
});

/** Stamp the last morning-brief run, for the heartbeat missed-cadence check. */
export const markMorningBrief = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("markMorningBrief: agent not found");
    await ctx.db.patch(args.agentId, {
      lastMorningBriefAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
