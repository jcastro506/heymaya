import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { sumLedgerForAccountSince } from "./costCap";

/**
 * Spend THROTTLE — the runaway-burn backstop that DEGRADES, never destroys.
 *
 * RULE: a cost ceiling is a SPENDING throttle, not a kill switch. When
 * rolling-window spend crosses a ceiling we stamp a 24h throttle on the agent;
 * its expensive discretionary work (the discovery/research pulse) self-pauses
 * to monitoring-only (honored by the discovery-budget gate in pulseCallbacks),
 * while the Fly machine KEEPS RUNNING INDEFINITELY and the agent still monitors
 * + answers the user. The throttle auto-clears after the window; if spend is
 * still over, the sweep re-stamps it. Machine teardown is reserved for explicit
 * cancellation (accountLifecycle) — NEVER a spend cap.
 *
 * Prevention is the real fix: the idempotent lifecycle + no-subagent-fan-out
 * loop means a true non-honoring runaway shouldn't happen. This throttle is the
 * soft backstop for an honoring agent that merely drifts over budget.
 *
 * Two rolling windows (NOT a lifetime cap — that would punish a long-lived
 * daily driver under normal ~$2/day spend):
 *   - hourly velocity: catches a spiky over-spend fast.
 *   - 24h sustained: catches a slow leak that slips under the hourly bar.
 *
 * Both sit ABOVE the costCap throttle ceilings ($1/hr, $2/day) so normal
 * operation never trips them. Env-overridable; per-agent 24h override via
 * gtmAgents.spendKillCapUsd. GTM_COST_CAP_OVERRIDE suspends the throttle.
 *
 * THREE checks (highest priority first):
 *   - actual-total wall: the TRUE 24h spend from the OpenRouter aggregate poll
 *     (research + operational + everything) vs the daily cap. The de-blind fix —
 *     the operational sums below read ~$0 live (per-turn self-report is
 *     unreliable), so a 7-day agent burned $28 with nothing firing.
 *   - hourly velocity (operational rows): catches a spiky over-spend fast.
 *   - 24h sustained (operational rows): catches a slow operational leak.
 *
 * The operational windows EXCLUDE research (bounded by the job's own budgetUsd).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** How long a throttle holds before auto-clearing (re-checked each sweep). */
const THROTTLE_WINDOW_MS = DAY_MS;

/** $/hr velocity ceiling. Normal use is <$1/hr; over-spend does $4+/hr. */
export function spendThrottleHourlyUsd(): number {
  const env = Number(process.env.GTM_AGENT_KILL_HOURLY_USD);
  return Number.isFinite(env) && env > 0 ? env : 3.0;
}

/** $/24h sustained ceiling (default; per-agent override wins). 3x the $2/day
 * throttle so a normal day never trips it. */
export function spendThrottleDailyUsd(): number {
  const env = Number(process.env.GTM_AGENT_KILL_DAILY_USD);
  return Number.isFinite(env) && env > 0 ? env : 6.0;
}

export interface SpendThrottleVerdict {
  shouldThrottle: boolean;
  reason?: string;
}

/**
 * Pure evaluator — unit-testable without a Convex ctx. A window is breached
 * when spend STRICTLY exceeds its ceiling (so a cap of $3 allows exactly $3).
 */
export function evaluateSpendThrottle(input: {
  hourSpendUsd: number;
  daySpendUsd: number;
  hourlyCapUsd: number;
  dailyCapUsd: number;
  // TRUE total 24h spend from the OpenRouter aggregate poll (the only measure
  // that isn't blind — per-turn self-report reads $0). When present, this hard
  // actual-total wall is checked FIRST: it counts research + operational +
  // everything, so it cannot be evaded by the blind-ledger gap.
  dayActualTotalUsd?: number;
}): SpendThrottleVerdict {
  if (
    input.dayActualTotalUsd !== undefined &&
    input.dayActualTotalUsd > input.dailyCapUsd
  ) {
    return {
      shouldThrottle: true,
      reason: `actual spend wall: $${input.dayActualTotalUsd.toFixed(2)} of real OpenRouter spend in the last 24h exceeds the $${input.dailyCapUsd.toFixed(2)}/24h cap (true total, incl. research)`,
    };
  }
  if (input.hourSpendUsd > input.hourlyCapUsd) {
    return {
      shouldThrottle: true,
      reason: `runaway velocity: $${input.hourSpendUsd.toFixed(2)} in the last hour exceeds the $${input.hourlyCapUsd.toFixed(2)}/hr throttle ceiling`,
    };
  }
  if (input.daySpendUsd > input.dailyCapUsd) {
    return {
      shouldThrottle: true,
      reason: `sustained burn: $${input.daySpendUsd.toFixed(2)} in the last 24h exceeds the $${input.dailyCapUsd.toFixed(2)}/24h throttle ceiling`,
    };
  }
  return { shouldThrottle: false };
}

function overrideActive(): boolean {
  const reason = process.env.GTM_COST_CAP_OVERRIDE;
  return Boolean(reason && reason.trim().length > 0);
}

interface AgentSpendSnapshot {
  accountId: Id<"creators">;
  openClawFlyAppId: string | null;
  /** Cancelled agent (accountLifecycle stamped killedAt) — skip entirely. */
  alreadyKilled: boolean;
  /** Throttle window still active — skip re-stamping (idempotent + no spam). */
  alreadyThrottled: boolean;
  hourSpendUsd: number;
  daySpendUsd: number;
  dayActualTotalUsd: number;
  hourlyCapUsd: number;
  dailyCapUsd: number;
  shouldThrottle: boolean;
  reason?: string;
}

async function snapshotAgentSpend(
  ctx: Pick<QueryCtx, "db">,
  agentId: Id<"gtmAgents">,
  now: number
): Promise<AgentSpendSnapshot | null> {
  const agent = await ctx.db.get(agentId);
  if (!agent) return null;
  // Operational spend only — research is bounded by its own per-job budgetUsd
  // and must be free to run as long as that budget allows. The throttle governs
  // the uncapped loop (turns, heartbeats, posts), not research. Exclude research
  // AND the OpenRouter aggregate-poll rows (counted separately as the wall) AND
  // Studio video (bounded by its own videoCreditsMonth cap).
  const excludeResearch = {
    excludeResearchJobSpend: true,
    excludeOpenrouterPoll: true,
    excludeCreatifyVideo: true,
  } as const;
  const hourSpendUsd = await sumLedgerForAccountSince(
    ctx,
    agent.accountId,
    now - HOUR_MS,
    excludeResearch
  );
  const daySpendUsd = await sumLedgerForAccountSince(
    ctx,
    agent.accountId,
    now - DAY_MS,
    excludeResearch
  );
  // TRUE total 24h spend — the OpenRouter aggregate-poll rows ONLY (the global
  // account delta, which already subsumes research + operational). The de-blind
  // fix: the operational-only sums above read ~$0 live without it.
  const dayActualTotalUsd = await sumLedgerForAccountSince(
    ctx,
    agent.accountId,
    now - DAY_MS,
    { onlyOpenrouterPoll: true }
  );
  const hourlyCapUsd = spendThrottleHourlyUsd();
  const dailyCapUsd = agent.spendKillCapUsd ?? spendThrottleDailyUsd();
  const verdict = evaluateSpendThrottle({
    hourSpendUsd,
    daySpendUsd,
    dayActualTotalUsd,
    hourlyCapUsd,
    dailyCapUsd,
  });
  return {
    accountId: agent.accountId,
    openClawFlyAppId: agent.openClawFlyAppId ?? null,
    alreadyKilled: Boolean(agent.killedAt),
    alreadyThrottled: Boolean(
      agent.spendThrottledUntil && agent.spendThrottledUntil > now
    ),
    hourSpendUsd,
    daySpendUsd,
    dayActualTotalUsd,
    hourlyCapUsd,
    dailyCapUsd,
    ...verdict,
  };
}

/** Read-only spend + verdict for one agent. */
export const peekAgentSpendForThrottle = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<AgentSpendSnapshot | null> => {
    return await snapshotAgentSpend(ctx, args.agentId, Date.now());
  },
});

/** Is this agent currently in a spend-throttle window? (degrade gate reads this) */
export const isAgentSpendThrottled = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<boolean> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return false;
    return Boolean(
      agent.spendThrottledUntil && agent.spendThrottledUntil > Date.now()
    );
  },
});

/** Every live (deployed, not-cancelled) agent — the sweep's work list. */
export const listLiveAgentsForThrottle = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Id<"gtmAgents">>> => {
    const agents = await ctx.db.query("gtmAgents").collect();
    return agents
      .filter((a) => a.openClawFlyAppId && !a.killedAt)
      .map((a) => a._id);
  },
});

/**
 * Stamp the spend-throttle on ONE agent. Idempotent: no-op if the agent is
 * gone, cancelled, or already in an active throttle window. NEVER destroys the
 * machine — only degrades (the discovery gate reads spendThrottledUntil).
 */
export const markAgentThrottled = internalMutation({
  args: { agentId: v.id("gtmAgents"), reason: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.killedAt) return;
    const now = Date.now();
    if (agent.spendThrottledUntil && agent.spendThrottledUntil > now) return;
    await ctx.db.patch(args.agentId, {
      spendThrottledUntil: now + THROTTLE_WINDOW_MS,
      spendThrottledAt: now,
      spendThrottleReason: args.reason,
      updatedAt: now,
    });
  },
});

/**
 * Throttle ONE agent's spend (degrade-not-destroy). Idempotent: a no-op if the
 * agent is gone, cancelled, or already throttled. The Fly machine stays ALIVE.
 */
export const throttleAgentForSpend = internalAction({
  args: { agentId: v.id("gtmAgents"), reason: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ throttled: boolean; reason: string }> => {
    const snap = await ctx.runQuery(
      internal.gtmMaya.spendKill.peekAgentSpendForThrottle,
      { agentId: args.agentId }
    );
    if (!snap) return { throttled: false, reason: "agent not found" };
    if (snap.alreadyKilled)
      return { throttled: false, reason: "agent cancelled" };
    if (snap.alreadyThrottled)
      return { throttled: false, reason: "already throttled" };

    await ctx.runMutation(internal.gtmMaya.spendKill.markAgentThrottled, {
      agentId: args.agentId,
      reason: args.reason,
    });
    // Machine is left RUNNING on purpose. The discovery gate now returns
    // monitoring_only for this agent, so expensive new work self-pauses while
    // it keeps watching + answering the user.
    console.warn(
      `[spendThrottle] throttled agent ${args.agentId} for 24h (machine ALIVE; discovery paused) — ${args.reason}`
    );
    return { throttled: true, reason: args.reason };
  },
});

/**
 * Check one agent and throttle it if over a ceiling. Safe to call on every turn
 * (via the telemetry endpoint) and from the sweep cron. Honors the override.
 */
export const enforceSpendThrottleForAgent = internalAction({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ throttled: boolean; reason?: string }> => {
    if (overrideActive()) return { throttled: false, reason: "override active" };
    const snap = await ctx.runQuery(
      internal.gtmMaya.spendKill.peekAgentSpendForThrottle,
      { agentId: args.agentId }
    );
    if (
      !snap ||
      snap.alreadyKilled ||
      snap.alreadyThrottled ||
      !snap.shouldThrottle
    ) {
      return { throttled: false };
    }
    return await ctx.runAction(
      internal.gtmMaya.spendKill.throttleAgentForSpend,
      {
        agentId: args.agentId,
        reason: snap.reason ?? "spend throttle ceiling exceeded",
      }
    );
  },
});

/**
 * Backstop cron: sweep every live agent and throttle any over a ceiling.
 * Catches an over-spending agent that stops POSTing telemetry (so the inline
 * enforcer never fires) but keeps an alive, billing machine. Re-stamps an
 * expired throttle if spend is still over.
 */
export const sweepSpendThrottle = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ checked: number; throttled: number }> => {
    if (overrideActive()) return { checked: 0, throttled: 0 };
    const agentIds = await ctx.runQuery(
      internal.gtmMaya.spendKill.listLiveAgentsForThrottle,
      {}
    );
    let throttled = 0;
    for (const agentId of agentIds) {
      const result = await ctx.runAction(
        internal.gtmMaya.spendKill.enforceSpendThrottleForAgent,
        { agentId }
      );
      if (result.throttled) throttled += 1;
    }
    if (throttled > 0) {
      console.warn(
        `[spendThrottle] sweep throttled ${throttled} of ${agentIds.length} live agents`
      );
    }
    return { checked: agentIds.length, throttled };
  },
});
