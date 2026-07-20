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
import { shouldOfferGraduation } from "./autonomyPolicy";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Default foundation lease window. Sessions hold the lease for ONE step then
 *  release it (mark_lifecycle release_lease) so a healthy pass never relies on
 *  the TTL — the TTL only matters when a session DIES mid-step without
 *  releasing. At 15m a dead holder used to lock the slot for 15m and, with the
 *  30m heartbeat as the only resumer, agents stalled for up to ~30m mid-onboard
 *  (foundationComplete hung at step=active). Shortened to 7m so a crashed/timed-
 *  out session frees the slot fast; the one-shot foundation-resume ladder
 *  (jobs.json, +8/+16/+24m) then re-acquires + resumes within minutes. Safe
 *  against concurrency: re-acquisition is acquire-only-when-free AND the
 *  watchdog dedup-guards re-spawn (reads get_my_foundation + subagents list,
 *  never re-spawns existing work), with FOUNDATION_MAX_LEASE_ACQUIRES as the
 *  hard backstop. A single legit step completes well under 7m. */
export const FOUNDATION_LEASE_MS = 7 * 60 * 1000;
/** Hard cap on foundation-lease acquisitions. The watchdog re-acquires the lease
 *  each tick to resume the pass; past this many, with foundation still
 *  incomplete, the lease is DENIED so a stuck agent cannot re-spawn the research
 *  fleet forever (observed live: 283 subagent sessions / ~12× re-runs). After the
 *  cap the agent surfaces an honest "still building" and the cadence crons own
 *  the rest. Generous enough that a healthy multi-tick pass never hits it. */
export const FOUNDATION_MAX_LEASE_ACQUIRES = 8;

/** Window after the onboarding handover is delivered during which a re-articulated
 *  DUPLICATE from a concurrent session — landing seconds after the first send
 *  marked foundation complete — or a later resume tick is still suppressed.
 *  Live trace (Cal AI, 2026-06-21): send #1 14:26:07 → markComplete 14:26:09 →
 *  send #2 14:26:12; the resume ladder fires up to 24min out. 30min covers both
 *  straddle + resume, while the next LEGITIMATE proactive send (morning brief) is
 *  hours later. Replies to an inbound turn bypass this gate entirely. */
export const SYNTH_HANDOVER_COOLDOWN_MS = 30 * 60 * 1000;

/** Window after the first intro/hello during which further pre-research proactive
 *  sends are suppressed as the concurrent-burst duplicate (observed: 4 hellos in
 *  17s). Short — genuine progress updates land minutes later, past this. */
export const HELLO_BURST_COOLDOWN_MS = 3 * 60 * 1000;

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
  /** True once the synthesis/strategy plan was actually DELIVERED to the founder
   *  (a strategic send_update succeeded). Onboarding cannot complete without it. */
  strategyDelivered: boolean;
  strategyDeliveredAt: number | null;
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
   *  scorecard) OR the durable `researchCompletedAt` marker is set. Once true, the
   *  watchdog must NEVER re-spawn the research fleet. */
  researchComplete: boolean;
  /** Unix-ms research first completed (durable). Null until research lands. */
  researchCompletedAt: number | null;
  /** Steady-state engagement may begin. = `researchComplete` — DELIBERATELY
   *  independent of `strategyDelivered`/`foundationComplete`, so a flaked
   *  synthesis send never leaves the agent idle. The engage crons + HEARTBEAT
   *  gate on THIS, not on foundationComplete. */
  engagementReady: boolean;
  /** The current onboarding step to act on — research / finalize / complete. */
  foundationStep: FoundationStep;
  /** How many times the foundation lease has been acquired (the cap counter). */
  leaseAcquireCount: number;
  /** The explicit lifecycle state — the SINGLE authority. `fresh` → `researching`
   *  → `plan_ready` (Maya's work DONE; plan generated+cached; she goes idle) →
   *  `active` (approved + ≥1 account connected). Persisted once advanced; derived
   *  from durable evidence for legacy/unset agents. */
  lifecycleState: LifecycleState;
  /** Unix-ms the synthesis plan was generated (the work-done marker — NOT
   *  delivery). foundationComplete flips on this. Null until the plan exists. */
  planGeneratedAt: number | null;
  /** True once the plan text is cached for Convex re-push (deliver-on-connect). */
  hasCachedPlan: boolean;
  /** How many times Convex has attempted to push the cached plan. */
  planDeliveryAttempts: number;
  // ─── Posting autonomy (ask-gated ramp, 2026-07-20) ────────────────────────
  /** The founder's current posting preference (confirm_each / confirm_first_week
   *  / autonomous). Only 'autonomous' auto-posts the auto channels. */
  autonomyMode: "confirm_each" | "confirm_first_week" | "autonomous";
  /** Founder taps/says-yes that landed a publish (the ramp milestone counter). */
  confirmedPostCount: number;
  /** The ramp milestone is met (3 confirms OR 7 days) AND Maya hasn't asked
   *  yet: time to OFFER autonomy ("want me to stop checking every time?") —
   *  ONCE — then mark_lifecycle({ marker: "autonomy_ask" }). The founder's yes
   *  → set_posting_mode('autonomous'). NEVER flip the mode uninvited. */
  autonomyReadyToAsk: boolean;
  /** Unix-ms Maya asked (null = not yet). Guards against re-asking. */
  autonomyAskAt: number | null;
}

/** The explicit lifecycle state machine — the single source of truth for "where
 *  is this agent." See the schema field for the full doctrine. */
export type LifecycleState = "fresh" | "researching" | "plan_ready" | "active";

/** Bounded Convex-side delivery retries of the cached plan before we stop and
 *  hold it dormant (the channel is dead / never connected). The pairing event
 *  re-pushes regardless; this only caps blind time-based retries. */
export const MAX_PLAN_DELIVERY_ATTEMPTS = 6;

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

  // Foundation RESEARCH output. Research is "done" on the CORE signals — a buyer
  // map + ≥1 channel scorecard. Competitors ENRICH the strategy but are
  // best-effort: requiring ≥1 competitor as a HARD gate meant a single failed
  // competitor-worker (observed live on a real deploy: competitiveMapCount=0)
  // kept researchComplete FALSE forever → the watchdog re-ran the synthesis step
  // → the main brain re-wrote + re-sent "foundation complete" 6× to the founder.
  // The simplified architecture is a bounded pass that runs ONCE and STOPS; the
  // durable researchCompletedAt marker (below) makes "done" permanent. Maya notes
  // a missing competitive map in the plan rather than looping on it.
  const buyerMap = await ctx.db
    .query("gtmBuyerMap")
    .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
    .first();
  const scorecardCount = (
    await ctx.db
      .query("gtmChannelScorecard")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect()
  ).length;
  // Durable-first: once `researchCompletedAt` is stamped, research is done
  // forever (even if a row later moves); otherwise fall back to live row
  // presence. acquireFoundationLease stamps the marker on first detection.
  const researchCompletedAt = agent.researchCompletedAt ?? null;
  const researchComplete =
    researchCompletedAt !== null ||
    (buyerMap !== null && scorecardCount >= 1);

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
  // The ACTIONABLE POOL — the agent's tactical output: ≥1 buyer thread to reply
  // to AND ≥1 drafted reply. Without it, onboarding "completes" with nothing for
  // Maya to post on connect (observed live 2026-06-28: rich strategy synthesis,
  // but 0 threads + 0 drafts — the agent rushed past the discovery/draft phase).
  const rowsComplete = targetThreadCount >= 1 && draftCount >= 1;
  // WORK-DONE gate. Maya's work is done = the synthesis plan was GENERATED
  // (`planGeneratedAt`, stamped by the send_update handler when she composes +
  // sends the plan, whether or not delivery lands) AND the actionable pool is
  // built (`rowsComplete`). Gating on plan-generation (NOT delivery) is what
  // killed the $22 no-channel loop — delivery is a separate Convex push, and
  // `strategyDeliveredAt` is PURELY the "founder received it" signal. Adding
  // `rowsComplete` is what stops a THIN completion: the watchdog keeps running
  // `finalize` (discovery → drafts) until the pool exists, so she never goes idle
  // with an empty queue. Both gates are her OWN work (controllable), so no
  // founder-channel dependency → no loop; the 8-acquire lease cap bounds a
  // genuinely thread-less niche. Legacy agents pass via `foundationCompletedAt`.
  const planGeneratedAt = agent.planGeneratedAt ?? null;
  const strategyDeliveredAt = agent.strategyDeliveredAt ?? null;
  const strategyDelivered = strategyDeliveredAt !== null;
  const foundationComplete =
    foundationCompletedAt !== null ||
    (planGeneratedAt !== null && rowsComplete);

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

  const planDeliveryAttempts = agent.planDeliveryAttempts ?? 0;
  const hasCachedPlan =
    typeof agent.cachedSynthesisText === "string" &&
    agent.cachedSynthesisText.trim().length > 0;

  // Explicit lifecycle state — THE authority. `active` is only ever set
  // explicitly (markActive, on approval + a connected account), so we honor the
  // persisted value; everything below it is derivable from durable evidence, so a
  // legacy/unset agent still resolves correctly. fresh → researching (work
  // begun) → plan_ready (plan generated = work done; idle) → active.
  let lifecycleState: LifecycleState;
  if (agent.lifecycleState === "active") {
    lifecycleState = "active";
  } else if (foundationComplete) {
    lifecycleState = "plan_ready";
  } else if (foundationStarted || researchComplete) {
    lifecycleState = "researching";
  } else {
    lifecycleState = "fresh";
  }

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
    strategyDelivered,
    strategyDeliveredAt,
    lastMorningBriefAt: agent.lastMorningBriefAt ?? null,
    leaseHeldUntil,
    leaseActive,
    hasVoiceProfile,
    targetThreadCount,
    draftCount,
    calendarEventCount,
    researchComplete,
    researchCompletedAt,
    engagementReady: researchComplete,
    lifecycleState,
    planGeneratedAt,
    hasCachedPlan,
    planDeliveryAttempts,
    foundationStep,
    leaseAcquireCount,
    autonomyMode: agent.autonomousPosting ?? "confirm_first_week",
    confirmedPostCount: agent.confirmedPostCount ?? 0,
    autonomyReadyToAsk:
      agent.autonomyAskAt == null &&
      shouldOfferGraduation(
        agent.autonomousPosting ?? "confirm_first_week",
        agent.autonomousSince,
        agent.confirmedPostCount,
        now
      ),
    autonomyAskAt: agent.autonomyAskAt ?? null,
  };
}

/** Maya asked the founder about going autonomous. Idempotent — only the first
 *  ask stamps, so a retried turn can never nag. patchPostingMode clears the
 *  stamp when the founder re-enters confirm_first_week (a fresh ramp = a fresh
 *  ask later). */
export const markAutonomyAsk = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<{ askedAt: number }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("agent not found");
    if (agent.autonomyAskAt != null) return { askedAt: agent.autonomyAskAt };
    const now = Date.now();
    await ctx.db.patch(args.agentId, { autonomyAskAt: now, updatedAt: now });
    return { askedAt: now };
  },
});

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
    // Durably stamp research-done on first detection — so engagement can start
    // (engagementReady) even if the synthesis send later flakes, and so research
    // is never re-spawned. Stamped before the branches below so it persists
    // regardless of which path this tick returns on.
    if (lifecycle.researchComplete && !agent.researchCompletedAt) {
      await ctx.db.patch(args.agentId, {
        researchCompletedAt: now,
        updatedAt: now,
      });
    }
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
      // Persist the explicit state — acquiring the lease means the research pass
      // is running (only ever reached when !foundationComplete, so never a
      // downgrade). fresh → researching.
      ...(agent.lifecycleState ? {} : { lifecycleState: "researching" as const }),
      updatedAt: now,
    });
    return { acquired: true, alreadyComplete: false, leaseActive: false, leaseUntil, capped: false, ...base };
  },
});

/**
 * §6 — atomically CLAIM the right to send the founder's onboarding synthesis
 * handover, so only ONE main turn delivers it no matter how many sessions race
 * to "research done → send the plan." (The live demo had TWO main Kimi-K2
 * sessions send it 3× total: one sent the handover twice as `tactical`, another
 * sent a re-articulated `strategic` copy.)
 *
 * Class-INDEPENDENT by design: the demo proved the agent labels the handover
 * inconsistently (tactical vs strategic), so keying on messageClass is wrong.
 * We key on lifecycle state instead:
 *   - work done (plan generated) → normal proactive sends flow ("allow"); the
 *     immediate concurrent handover dup is still suppressed within the cooldown.
 *   - research not done yet       → progress updates flow ("allow") + hello-once.
 *   - synthesis window (research done, plan not yet generated) → the FIRST send
 *     CLAIMS it: stamps `planGeneratedAt` (the work-done marker + claim token)
 *     and moves to `plan_ready` → "send"; every later send is a dup ("suppress").
 *
 * Atomic: Convex mutations are serializable, so two concurrent claims can never
 * both win — this is what defeats the multi-session race. THE ENUM REFACTOR: the
 * claim token is now `planGeneratedAt`, NOT `strategyDeliveredAt`. Claim ≠
 * delivery — a failed send no longer un-claims (no releaseFounderSynthesisClaim
 * loop) and no longer re-generates the plan; the cached plan is re-pushed by
 * Convex on connect. `strategyDeliveredAt` is set ONLY on a successful send.
 */
export const claimFounderSynthesisSend = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    // 2026-07-13 LIFECYCLE_MESSAGING_V1 — the claim is CLASS-AWARE. The live
    // failure this fixes: the class-INDEPENDENT cooldown ate the founder's
    // replies for 30 minutes after the plan ("she's ignoring me"). Only
    // STRATEGIC proactive sends (a plan/handover re-articulation) are ever
    // dedup-eligible; tactical sends (acks, progress, one-tap pings) always
    // flow. Replies (turnId present) never reach this claim at all.
    messageClass: v.optional(
      v.union(v.literal("strategic"), v.literal("tactical"))
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ decision: "cache" | "suppress" | "allow" }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return { decision: "allow" };
    const now = Date.now();
    const strategic = args.messageClass === "strategic";
    const lifecycle = await computeAgentLifecycle(ctx, agent, now);
    // Work done (plan generated) → normal proactive sends (morning brief, weekly
    // review) flow. BUT a re-articulated STRATEGIC handover from a concurrent
    // session (or the approval-reaction turn) lands minutes after the first
    // claim (the live 2× plan), so within the handover cooldown of plan
    // generation, strategic sends still SUPPRESS — same plan, not a new
    // message. Tactical sends ALWAYS flow here.
    if (lifecycle.foundationComplete) {
      if (
        strategic &&
        agent.planGeneratedAt &&
        now - agent.planGeneratedAt < SYNTH_HANDOVER_COOLDOWN_MS
      ) {
        return { decision: "suppress" };
      }
      return { decision: "allow" };
    }
    // RESEARCH-COMPLETE GATE (the live premature-synthesis fix, hardened
    // 2026-06-30). We gate on the EXPLICIT `researchCompletedAt` stamp, NOT the
    // derived `lifecycle.researchComplete` boolean. WHY: the derived flag flips
    // true on a LOW bar (buyerMap + ≥1 scorecard), which is reached early —
    // while Maya is still mid-research and only sending holding messages
    // ("still digging, back in a bit"). Observed live (agent ws7bk96g): a
    // TACTICAL holding message won the synthesis "send" claim at T+335s, was
    // cached as "the plan", and flipped the agent to plan_ready — the REAL
    // post-research plan (composed after researchCompletedAt at T+371s) was then
    // suppressed (planGeneratedAt already set). The operator got the holding
    // message and NEVER the plan. The explicit stamp is the HIGH bar (full
    // 5-pass research done) and is what the synthesis safety-net also keys on,
    // so the first proactive send AFTER it is the genuine plan handover. Below
    // it → "allow" (still researching; honest progress flows — NEVER suppress).
    if (!agent.researchCompletedAt) {
      // A strategic re-articulation after the plan was claimed = dup; tactical
      // progress ("still digging") always flows.
      if (agent.planGeneratedAt) {
        return { decision: strategic ? "suppress" : "allow" };
      }
      // HELLO-ONCE: kill the concurrent intro burst (observed live: 4 near-
      // identical hellos in 17s from racing boot/kickstart/resume sessions). The
      // FIRST pre-research proactive send atomically claims the hello (stamps
      // helloSentAt); further proactive sends within the burst window suppress;
      // genuine later progress updates (past the window) flow. Reuses the
      // existing helloSentAt field — no schema change, idempotent with the
      // agent's own mark_lifecycle(hello_sent).
      if (agent.helloSentAt) {
        if (now - agent.helloSentAt < HELLO_BURST_COOLDOWN_MS) {
          return { decision: "suppress" };
        }
        return { decision: "allow" };
      }
      await ctx.db.patch(args.agentId, { helloSentAt: now, updatedAt: now });
      return { decision: "allow" };
    }
    // Synthesis window: research is real, plan not yet generated.
    // LIFECYCLE_MESSAGING_V1: the plan handover must be STRATEGIC — a tactical
    // holding message can no longer steal the claim (the live ws7bk96g bug:
    // "still digging" won the claim, was cached as "the plan", and the real
    // plan was suppressed). Tactical sends flow without claiming.
    if (!strategic) return { decision: "allow" };
    if (agent.planGeneratedAt) return { decision: "suppress" };
    // CLAIM it — stamp planGeneratedAt (work done) + advance to plan_ready,
    // and return "cache": the handler CACHES the plan text instead of sending;
    // Convex (pushCachedPlan — idempotent, keyed on strategyDeliveredAt)
    // delivers it exactly once. Code owns WHEN; the model owns WHAT. This is
    // what makes a duplicate plan message impossible rather than suppressed:
    // every racing session's "here's the plan" lands in the same cache slot
    // and delivery is a single-writer state transition.
    await ctx.db.patch(args.agentId, {
      planGeneratedAt: now,
      lifecycleState: "plan_ready",
      updatedAt: now,
    });
    return { decision: "cache" };
  },
});

/** DEPRECATED no-op (the enum refactor). A failed synthesis send no longer
 *  un-claims: the plan was GENERATED (planGeneratedAt stays = work done), and the
 *  cached plan is re-pushed by Convex on connect (pushCachedPlan) rather than
 *  re-generated. Un-claiming was the delivery-failure re-synthesis loop. Kept as
 *  an exported no-op so any stale caller is harmless. */
export const releaseFounderSynthesisClaim = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<void> => {
    // Intentionally does nothing — see the doc comment above.
    void args;
    return;
  },
});

/** Stamp that the synthesis/strategy plan was actually delivered to the founder.
 *  Called server-side from the send_update handler when a STRATEGIC message is
 *  successfully delivered (the synthesis is the first such message in onboarding).
 *  Idempotent first-write. Tolerant — the send path must never throw, so a missing
 *  agent is a silent no-op. This is the durable signal markFoundationComplete +
 *  the rows-complete backstop gate on, so onboarding can never finish on an
 *  undelivered plan. */
export const markStrategyDelivered = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<{ alreadyDelivered: boolean }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return { alreadyDelivered: false };
    if (agent.strategyDeliveredAt) return { alreadyDelivered: true };
    const now = Date.now();
    await ctx.db.patch(args.agentId, {
      strategyDeliveredAt: now,
      updatedAt: now,
    });
    return { alreadyDelivered: false };
  },
});

/** Mark Maya's onboarding WORK done (→ `plan_ready`) AND clear the lease. The
 *  enum refactor: the gate is now "the plan was GENERATED" (planGeneratedAt, set
 *  when the agent composed + sent the synthesis), NOT "the founder received it."
 *  Delivery is a SEPARATE Convex push (deliver-on-connect), so a missing channel
 *  can never block completion → no re-synthesis loop. We still refuse on a
 *  totally empty foundation (no plan, no rows) so completion can't fire on
 *  nothing. The `active` transition (approved + connected) is markActive, later. */
export const markFoundationComplete = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ alreadyComplete: boolean; completed: boolean; reason?: string }> => {
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
      return { alreadyComplete: true, completed: true };
    }
    // GATE: completing requires BOTH (1) the synthesis plan GENERATED + sent
    // (planGeneratedAt) AND (2) the actionable pool built — ≥1 buyer thread with
    // ≥1 drafted reply (rowsComplete). The pool requirement stops a THIN
    // completion (live 2026-06-28: rich strategy synthesis but 0 threads/drafts —
    // the agent rushed past discovery/drafting, so connect-and-go had nothing to
    // post). Both are the agent's OWN work (not the founder's channel), so this
    // is NOT the $22 delivery-loop mistake; the 8-acquire lease cap bounds a
    // genuinely thread-less niche. The Convex synthesis SAFETY-NET still
    // guarantees the founder gets a plan even while this is blocked — it now fires
    // on researchCompletedAt (NOT foundationCompletedAt, see synthesisDelivery.ts)
    // so blocking completion no longer disables it.
    const lifecycle = await computeAgentLifecycle(ctx, agent, now);
    const poolBuilt =
      lifecycle.targetThreadCount >= 1 && lifecycle.draftCount >= 1;
    if (agent.planGeneratedAt == null || !poolBuilt) {
      return {
        alreadyComplete: false,
        completed: false,
        reason:
          "not_ready: before marking done you must BOTH (1) SEND the founder the synthesis plan via send_update (works even with no channel — it's cached + delivered on connect), AND (2) build the actionable pool — at least one real buyer thread (save_target_thread) with a drafted reply (save_draft). Keep running the finalize step (discovery → drafts) until both exist.",
      };
    }
    await ctx.db.patch(args.agentId, {
      foundationCompletedAt: now,
      foundationStartedAt: agent.foundationStartedAt ?? now,
      foundationLeaseUntil: undefined,
      // Work done → plan_ready (idle, awaiting delivery/approval/connect events).
      // Never downgrade an agent already explicitly active.
      ...(agent.lifecycleState === "active"
        ? {}
        : { lifecycleState: "plan_ready" as const }),
      updatedAt: now,
    });
    return { alreadyComplete: false, completed: true };
  },
});

/** Mark the agent ACTIVE — approved AND ≥1 account connected → the daily engage
 *  loop may post. Event-driven (called from the approval + account-connect
 *  hooks). Idempotent. Requires foundation work done first (plan_ready). */
export const markActive = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ activated: boolean; reason?: string }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return { activated: false, reason: "agent_not_found" };
    if (agent.lifecycleState === "active") return { activated: true };
    const now = Date.now();
    const lifecycle = await computeAgentLifecycle(ctx, agent, now);
    if (!lifecycle.foundationComplete) {
      return { activated: false, reason: "plan_not_ready" };
    }
    await ctx.db.patch(args.agentId, {
      lifecycleState: "active",
      // Backfill the explicit completion marker if the agent never called it
      // (e.g. a no-channel onboarding that only finished once they connected).
      foundationCompletedAt: agent.foundationCompletedAt ?? now,
      foundationLeaseUntil: undefined,
      updatedAt: now,
    });
    return { activated: true };
  },
});

/** Event-driven activation gate. Called from BOTH transition events (account
 *  connected, plan approved) — whichever one COMPLETES the pair flips the agent
 *  to `active`. Re-checks the full condition from the DB each time: foundation
 *  work done (plan_ready) AND strategy approved AND ≥1 active connected account.
 *  Idempotent + cheap; a no-op until all three hold. Does NOT post — it only
 *  records the state; the agent's Phase-5 kickoff / the morning_brief cron owns
 *  the first post. */
export const tryActivateAgent = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ activated: boolean; reason?: string }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return { activated: false, reason: "agent_not_found" };
    if (agent.lifecycleState === "active") return { activated: true };
    const now = Date.now();
    const lifecycle = await computeAgentLifecycle(ctx, agent, now);
    if (!lifecycle.foundationComplete) {
      return { activated: false, reason: "plan_not_ready" };
    }
    // ≥1 active connected account (parse the JSON-on-row; schema is at the TS
    // ceiling so accounts live as a JSON string).
    let connectedActive = 0;
    try {
      const arr = JSON.parse(agent.connectedAccountsJson ?? "[]") as Array<{
        isActive?: boolean;
      }>;
      connectedActive = arr.filter((a) => a?.isActive !== false).length;
    } catch {
      connectedActive = 0;
    }
    if (connectedActive < 1) {
      return { activated: false, reason: "no_connected_account" };
    }
    // Strategy approved (on the latest research job for this app).
    let approved = false;
    if (agent.appId) {
      const jobs = await ctx.db
        .query("gtmResearchJobs")
        .withIndex("by_app", (q) => q.eq("appId", agent.appId!))
        .collect();
      const latest = jobs.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
      approved = latest?.strategyApprovalState === "approved";
    }
    if (!approved) {
      return { activated: false, reason: "not_approved" };
    }
    await ctx.db.patch(args.agentId, {
      lifecycleState: "active",
      foundationCompletedAt: agent.foundationCompletedAt ?? now,
      foundationLeaseUntil: undefined,
      updatedAt: now,
    });
    return { activated: true };
  },
});

/** Cache the synthesis plan text for Convex re-push (deliver-on-connect), and
 *  stamp planGeneratedAt as a belt-and-suspenders (the claim already did). Called
 *  server-side from the send_update handler the instant the synthesis is
 *  composed — BEFORE the Telegram attempt — so the text survives a failed send. */
export const cacheSynthesisPlan = internalMutation({
  args: { agentId: v.id("gtmAgents"), text: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return;
    const now = Date.now();
    await ctx.db.patch(args.agentId, {
      cachedSynthesisText: args.text,
      planGeneratedAt: agent.planGeneratedAt ?? now,
      ...(agent.lifecycleState === "active"
        ? {}
        : { lifecycleState: "plan_ready" as const }),
      updatedAt: now,
    });
  },
});

/** Record a Convex-side delivery attempt of the cached plan (increment the
 *  bounded counter). Returns the new count + whether we've hit the cap. */
export const bumpPlanDeliveryAttempt = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ attempts: number; capped: boolean }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return { attempts: 0, capped: true };
    const attempts = (agent.planDeliveryAttempts ?? 0) + 1;
    await ctx.db.patch(args.agentId, {
      planDeliveryAttempts: attempts,
      updatedAt: Date.now(),
    });
    return { attempts, capped: attempts >= MAX_PLAN_DELIVERY_ATTEMPTS };
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
