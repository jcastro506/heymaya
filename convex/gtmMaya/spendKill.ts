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
 * Hard spend kill-switch — the runaway-burn backstop.
 *
 * The throttle caps in costCap.ts (hour/day/month) only return a 403 and trust
 * the agent to stop. A runaway loop does not stop (observed live: an old-model
 * agent burned ~$30 in 7h). This module DESTROYS the agent's Fly machine when
 * rolling-window spend crosses a kill ceiling, so billing physically stops.
 *
 * Two rolling windows (NOT a lifetime cap — that would punish a long-lived
 * daily driver under normal ~$2/day spend):
 *   - hourly velocity: catches a spiky runaway fast (killed in the first hour
 *     at ~$3 spent instead of $30).
 *   - 24h sustained: catches a slow leak that slips under the hourly bar.
 *
 * Both sit ABOVE the costCap throttle ceilings ($1/hr, $2/day) so normal
 * operation never trips them. Env-overridable; per-agent 24h override via
 * gtmAgents.spendKillCapUsd. GTM_COST_CAP_OVERRIDE (the costCap escape hatch)
 * also suspends the kill so a deliberate smoke isn't reaped mid-run.
 *
 * RESEARCH IS EXCLUDED. Research-job spend is bounded by the job's own
 * budgetUsd, so it must run as long as that budget allows — the kill-switch
 * sums only OPERATIONAL ledger rows (no researchJobId), governing the uncapped
 * loop, not research. A deep research run never trips a runaway kill.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** $/hr velocity ceiling. Normal use is <$1/hr; a runaway does $4+/hr. */
export function agentKillHourlyUsd(): number {
  const env = Number(process.env.GTM_AGENT_KILL_HOURLY_USD);
  return Number.isFinite(env) && env > 0 ? env : 3.0;
}

/** $/24h sustained ceiling (default; per-agent override wins). 3x the $2/day
 * throttle so a normal day never trips it. */
export function agentKillDailyUsd(): number {
  const env = Number(process.env.GTM_AGENT_KILL_DAILY_USD);
  return Number.isFinite(env) && env > 0 ? env : 6.0;
}

export interface SpendKillVerdict {
  shouldKill: boolean;
  reason?: string;
}

/**
 * Pure evaluator — unit-testable without a Convex ctx. A window is breached
 * when spend STRICTLY exceeds its ceiling (so a cap of $3 allows exactly $3).
 */
export function evaluateSpendKill(input: {
  hourSpendUsd: number;
  daySpendUsd: number;
  hourlyCapUsd: number;
  dailyCapUsd: number;
}): SpendKillVerdict {
  if (input.hourSpendUsd > input.hourlyCapUsd) {
    return {
      shouldKill: true,
      reason: `runaway velocity: $${input.hourSpendUsd.toFixed(2)} in the last hour exceeds the $${input.hourlyCapUsd.toFixed(2)}/hr kill ceiling`,
    };
  }
  if (input.daySpendUsd > input.dailyCapUsd) {
    return {
      shouldKill: true,
      reason: `sustained burn: $${input.daySpendUsd.toFixed(2)} in the last 24h exceeds the $${input.dailyCapUsd.toFixed(2)}/24h kill ceiling`,
    };
  }
  return { shouldKill: false };
}

function overrideActive(): boolean {
  const reason = process.env.GTM_COST_CAP_OVERRIDE;
  return Boolean(reason && reason.trim().length > 0);
}

interface AgentSpendSnapshot {
  accountId: Id<"creators">;
  openClawFlyAppId: string | null;
  alreadyKilled: boolean;
  hourSpendUsd: number;
  daySpendUsd: number;
  hourlyCapUsd: number;
  dailyCapUsd: number;
  shouldKill: boolean;
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
  // and must be free to run as long as that budget allows. The kill-switch
  // governs the uncapped loop (turns, heartbeats, posts), not research.
  // Exclude research (bounded by its own budget) AND the OpenRouter aggregate-
  // poll rows (COGS-visibility only — they conflate research + operational).
  const excludeResearch = {
    excludeResearchJobSpend: true,
    excludeOpenrouterPoll: true,
    // Studio video COGS is bounded by its own videoCreditsMonth cap; a single
    // render would otherwise trip this runaway kill. Visible in the ledger, not
    // counted here.
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
  const hourlyCapUsd = agentKillHourlyUsd();
  const dailyCapUsd = agent.spendKillCapUsd ?? agentKillDailyUsd();
  const verdict = evaluateSpendKill({
    hourSpendUsd,
    daySpendUsd,
    hourlyCapUsd,
    dailyCapUsd,
  });
  return {
    accountId: agent.accountId,
    openClawFlyAppId: agent.openClawFlyAppId ?? null,
    alreadyKilled: Boolean(agent.killedAt),
    hourSpendUsd,
    daySpendUsd,
    hourlyCapUsd,
    dailyCapUsd,
    ...verdict,
  };
}

/** Read-only spend + verdict for one agent. */
export const peekAgentSpendForKill = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<AgentSpendSnapshot | null> => {
    return await snapshotAgentSpend(ctx, args.agentId, Date.now());
  },
});

/** Every live (deployed, not-yet-killed) agent — the sweep's work list. */
export const listLiveAgentsForKill = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Id<"gtmAgents">>> => {
    const agents = await ctx.db.query("gtmAgents").collect();
    return agents
      .filter((a) => a.openClawFlyAppId && !a.killedAt)
      .map((a) => a._id);
  },
});

export const markAgentKilled = internalMutation({
  args: { agentId: v.id("gtmAgents"), reason: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.killedAt) return;
    await ctx.db.patch(args.agentId, {
      killedAt: Date.now(),
      killReason: args.reason,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Destroy ONE agent's Fly machine, rotate its hookToken, and stamp the kill.
 * Idempotent: a no-op if the agent is gone or already killed.
 */
export const killAgentForSpend = internalAction({
  args: { agentId: v.id("gtmAgents"), reason: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ killed: boolean; reason: string }> => {
    const snap = await ctx.runQuery(
      internal.gtmMaya.spendKill.peekAgentSpendForKill,
      { agentId: args.agentId }
    );
    if (!snap) return { killed: false, reason: "agent not found" };
    if (snap.alreadyKilled) return { killed: false, reason: "already killed" };

    if (snap.openClawFlyAppId) {
      const { FlyClient } = await import("../lib/flyClient");
      const fly = new FlyClient();
      try {
        await fly.destroyApp(snap.openClawFlyAppId);
        console.log(
          `[spendKill] destroyed Fly app ${snap.openClawFlyAppId} — ${args.reason}`
        );
      } catch (err) {
        // The machine may already be gone; still rotate token + stamp so we
        // don't loop. Log loudly — a failed destroy means it could still bill.
        console.error(
          `[spendKill] destroyApp(${snap.openClawFlyAppId}) failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      await ctx.runMutation(
        internal._admin.realWorldDeployGtm.rotateHookTokensForDestroyedApps,
        { destroyedAppNames: [snap.openClawFlyAppId] }
      );
    }

    await ctx.runMutation(internal.gtmMaya.spendKill.markAgentKilled, {
      agentId: args.agentId,
      reason: args.reason,
    });
    return { killed: true, reason: args.reason };
  },
});

/**
 * Check one agent and kill it if over a ceiling. Safe to call on every turn
 * (via the telemetry endpoint) and from the sweep cron. Honors the override.
 */
export const enforceSpendKillForAgent = internalAction({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ killed: boolean; reason?: string }> => {
    if (overrideActive()) return { killed: false, reason: "override active" };
    const snap = await ctx.runQuery(
      internal.gtmMaya.spendKill.peekAgentSpendForKill,
      { agentId: args.agentId }
    );
    if (!snap || snap.alreadyKilled || !snap.shouldKill) {
      return { killed: false };
    }
    return await ctx.runAction(internal.gtmMaya.spendKill.killAgentForSpend, {
      agentId: args.agentId,
      reason: snap.reason ?? "spend kill ceiling exceeded",
    });
  },
});

/**
 * Backstop cron: sweep every live agent and kill any over a ceiling. Catches
 * runaways that stop POSTing telemetry (so the inline enforcer never fires) but
 * keep an alive, billing machine.
 */
export const sweepSpendKill = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ checked: number; killed: number }> => {
    if (overrideActive()) return { checked: 0, killed: 0 };
    const agentIds = await ctx.runQuery(
      internal.gtmMaya.spendKill.listLiveAgentsForKill,
      {}
    );
    let killed = 0;
    for (const agentId of agentIds) {
      const result = await ctx.runAction(
        internal.gtmMaya.spendKill.enforceSpendKillForAgent,
        { agentId }
      );
      if (result.killed) killed += 1;
    }
    if (killed > 0) {
      console.log(
        `[spendKill] sweep killed ${killed} of ${agentIds.length} live agents`
      );
    }
    return { checked: agentIds.length, killed };
  },
});
