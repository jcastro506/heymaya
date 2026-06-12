import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * OpenRouter aggregate-spend poll — the interim COGS-visibility fix.
 *
 * The real per-agent cost can't be seen from Convex (the LLM call happens inside
 * the OpenClaw Fly machine ↔ OpenRouter, and the runtime doesn't reliably call
 * log_turn_telemetry — observed live: ledger reads $0). The proper fix is an
 * OpenClaw after-turn auto-report hook (a plugin-runtime build).
 *
 * This is the pragmatic interim: poll OpenRouter's account-level usage endpoint
 * (one shared key), compute the spend DELTA since the last poll, and write it
 * into gtmCostLedger attributed to the live agent(s). Two wins immediately:
 *   1. COGS becomes VISIBLE — showWorkAndSpend sums an "openrouter" provider with
 *      real $. For the single-agent dogfood the delta IS that agent's cost.
 *   2. The spend kill-switch sums gtmCostLedger, so it now SEES the LLM spend it
 *      was blind to and can actually enforce the cap.
 *
 * Multi-agent caveat: with a shared key OpenRouter can't attribute per agent, so
 * the global delta is split EVENLY across live agents — an approximation until
 * the per-turn hook lands. For one live agent (the dogfood) it is exact.
 *
 * The FIRST poll only establishes a baseline (delta 0) so we never write a huge
 * retroactive spike that would trip the kill-switch on accumulated history.
 */

const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const POLL_OP = "openrouter_poll";

/** Live (deployed, not-killed) agents with their account ids. */
export const listLiveAgentsWithAccount = internalQuery({
  args: {},
  handler: async (
    ctx
  ): Promise<Array<{ agentId: Id<"gtmAgents">; accountId: Id<"creators"> }>> => {
    const agents = await ctx.db.query("gtmAgents").collect();
    return agents
      .filter((a) => a.openClawFlyAppId && !a.killedAt)
      .map((a) => ({ agentId: a._id, accountId: a.accountId }));
  },
});

/** The absolute OpenRouter total from the most recent poll (null on first run). */
export const peekLastOpenrouterTotal = internalQuery({
  args: {},
  handler: async (ctx): Promise<number | null> => {
    // Scan a bounded recent slice (newest first) for the latest poll marker.
    const recent = await ctx.db.query("gtmCostLedger").order("desc").take(400);
    for (const row of recent) {
      if (
        row.operation === POLL_OP &&
        row.metadata &&
        typeof (row.metadata as { totalUsage?: unknown }).totalUsage === "number"
      ) {
        return (row.metadata as { totalUsage: number }).totalUsage;
      }
    }
    return null;
  },
});

/** Insert one OpenRouter poll row into the cost ledger for an agent's account. */
export const recordPollLedgerRow = internalMutation({
  args: {
    accountId: v.id("creators"),
    costUsd: v.number(),
    totalUsage: v.number(),
    globalDelta: v.number(),
    agents: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.insert("gtmCostLedger", {
      accountId: args.accountId,
      provider: "openrouter",
      operation: POLL_OP,
      reason: "openrouter account-usage poll (aggregate LLM spend)",
      costUsd: args.costUsd,
      cacheStatus: "called",
      metadata: {
        totalUsage: args.totalUsage,
        globalDelta: args.globalDelta,
        agents: args.agents,
        attribution: "even-split",
      },
      createdAt: Date.now(),
    });
  },
});

export const pollOpenrouterSpend = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    ok: boolean;
    totalUsage?: number;
    delta?: number;
    agents?: number;
    reason?: string;
  }> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return { ok: false, reason: "no_openrouter_key" };

    let totalUsage: number;
    try {
      const res = await fetch(OPENROUTER_CREDITS_URL, {
        headers: { authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        return { ok: false, reason: `openrouter_http_${res.status}` };
      }
      const json = (await res.json()) as {
        data?: { total_usage?: number; total_credits?: number };
      };
      const tu = json.data?.total_usage;
      if (typeof tu !== "number" || !Number.isFinite(tu)) {
        return { ok: false, reason: "no_total_usage" };
      }
      totalUsage = tu;
    } catch (err) {
      return {
        ok: false,
        reason: `openrouter_fetch_error: ${(err as Error).message}`,
      };
    }

    const lastTotal = await ctx.runQuery(
      internal.gtmMaya.openrouterSpend.peekLastOpenrouterTotal,
      {}
    );
    const liveAgents = await ctx.runQuery(
      internal.gtmMaya.openrouterSpend.listLiveAgentsWithAccount,
      {}
    );

    // First poll → establish baseline only (no retroactive delta spike).
    if (lastTotal === null) {
      const anchor = liveAgents[0];
      if (anchor) {
        await ctx.runMutation(
          internal.gtmMaya.openrouterSpend.recordPollLedgerRow,
          {
            accountId: anchor.accountId,
            costUsd: 0,
            totalUsage,
            globalDelta: 0,
            agents: liveAgents.length,
          }
        );
      }
      console.log(
        `[openrouterSpend] baseline established: total=$${totalUsage.toFixed(4)} (${liveAgents.length} live agents)`
      );
      return { ok: true, totalUsage, delta: 0, agents: liveAgents.length };
    }

    const delta = Math.max(0, totalUsage - lastTotal);
    if (liveAgents.length === 0) {
      console.log(
        `[openrouterSpend] +$${delta.toFixed(4)} but NO live agents — not attributed; total=$${totalUsage.toFixed(4)}`
      );
      return { ok: true, totalUsage, delta, agents: 0 };
    }

    const share = delta / liveAgents.length;
    for (const a of liveAgents) {
      await ctx.runMutation(
        internal.gtmMaya.openrouterSpend.recordPollLedgerRow,
        {
          accountId: a.accountId,
          costUsd: share,
          totalUsage,
          globalDelta: delta,
          agents: liveAgents.length,
        }
      );
    }
    console.log(
      `[openrouterSpend] +$${delta.toFixed(4)} over ${liveAgents.length} agent(s) ($${share.toFixed(4)} each); total=$${totalUsage.toFixed(4)}`
    );
    return { ok: true, totalUsage, delta, agents: liveAgents.length };
  },
});
