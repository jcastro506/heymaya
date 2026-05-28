/**
 * Sprint 2.25 — gtmCostLedger writes for real-time cost visibility.
 *
 * Two pieces:
 *   1. `recordGtmCostInternal` — internal mutation, callable from any
 *      Convex action (no Clerk identity required). Authenticates via
 *      explicit accountId.
 *   2. `callOpenRouterAndRecordCost` — wrapper around callOpenRouter
 *      that auto-records the cost row. All Convex-side OpenRouter
 *      callers should use this instead of bare callOpenRouter.
 *
 * Why two helpers (not just one):
 *   - Some external API calls (ScrapeCreators, TwitterAPI.io, Composio)
 *     happen outside callOpenRouter — they need the bare
 *     recordGtmCostInternal.
 *   - The OpenRouter wrapper is hot enough to deserve its own helper
 *     so we don't repeat 6 lines at every callsite.
 *
 * NOT YET CAPTURED:
 *   - Fly-side OpenRouter spend (Maya's main session + her subagents
 *     running inside OpenClaw → OpenRouter). Those calls bypass our
 *     Convex wrapper. Sprint 2.25b (future) addresses this via either
 *     OpenRouter dashboard API polling OR a /lc_gtm/log_cost endpoint
 *     Maya hits after each turn.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  callOpenRouter,
  type OpenRouterCallOptions,
  type OpenRouterCompletion,
} from "../agents/modelRouter/openRouterClient";

const COST_PROVIDER = v.union(
  v.literal("scrapecreators"),
  v.literal("gemini"),
  v.literal("openrouter"),
  v.literal("composio"),
  v.literal("x_api"),
  v.literal("openclaw"),
  v.literal("other")
);

const CACHE_STATUS = v.union(
  v.literal("hit"),
  v.literal("miss"),
  v.literal("called"),
  v.literal("skipped"),
  v.literal("failed")
);

/**
 * Internal mutation for recording cost — callable from any Convex
 * action without Clerk identity. Caller passes explicit accountId.
 *
 * Doubles as the per-job spent counter: if researchJobId is set,
 * also increments gtmResearchJobs.spentUsd.
 */
export const recordGtmCostInternal = internalMutation({
  args: {
    accountId: v.id("creators"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    provider: COST_PROVIDER,
    operation: v.string(),
    reason: v.string(),
    costUsd: v.number(),
    units: v.optional(v.number()),
    cacheStatus: CACHE_STATUS,
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"gtmCostLedger">> => {
    if (args.costUsd < 0) {
      throw new Error("recordGtmCostInternal: costUsd cannot be negative");
    }
    const now = Date.now();
    const id = await ctx.db.insert("gtmCostLedger", {
      accountId: args.accountId,
      researchJobId: args.researchJobId,
      provider: args.provider,
      operation: args.operation,
      reason: args.reason,
      costUsd: args.costUsd,
      units: args.units,
      cacheStatus: args.cacheStatus,
      metadata: args.metadata,
      createdAt: now,
    });

    // Roll up onto the research job's running spend if attached.
    if (args.researchJobId) {
      const job = await ctx.db.get(args.researchJobId);
      if (job && job.accountId === args.accountId) {
        await ctx.db.patch(args.researchJobId, {
          spentUsd:
            Math.round(((job.spentUsd ?? 0) + args.costUsd) * 10000) / 10000,
          updatedAt: now,
        });
      }
    }
    return id;
  },
});

interface CallOpenRouterWithCostArgs extends OpenRouterCallOptions {
  /** Convex account id — required for cost attribution. */
  accountId: Id<"creators">;
  /** Optional research job to attribute spend to. */
  researchJobId?: Id<"gtmResearchJobs">;
  /**
   * Free-form label for the call — gets stored in gtmCostLedger.reason
   * so the operator can scan their bill ("which step cost the $0.40?").
   * Examples: "judge_channels", "mine_comment_trees", "business_picture".
   */
  reason: string;
  /**
   * Optional metadata blob — included in the ledger row for forensics.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Wrap callOpenRouter so the cost lands in gtmCostLedger automatically.
 *
 * The OpenRouter response includes `usage.costUsd` (we set
 * `usage.include: true` in the request body). When that's available
 * we record the exact cost. When OpenRouter doesn't return it (BYOK
 * pass-through), we record `costUsd: 0` with a "failed" cacheStatus
 * so the operator knows we're missing observability for that call.
 *
 * Behavior:
 *   - Successful call WITH cost data → record provider="openrouter",
 *     cacheStatus="called", costUsd=actual.
 *   - Successful call WITHOUT cost data → record costUsd=0,
 *     cacheStatus="called", metadata.note="no_cost_from_provider".
 *   - Failed call → bubble the error, do NOT insert a cost row.
 */
export async function callOpenRouterAndRecordCost(
  ctx: ActionCtx,
  opts: CallOpenRouterWithCostArgs
): Promise<OpenRouterCompletion> {
  const { accountId, researchJobId, reason, metadata, ...openRouterOpts } =
    opts;

  const completion = await callOpenRouter(openRouterOpts);
  const costUsd = completion.usage.costUsd ?? 0;
  const noCostData = completion.usage.costUsd == null;

  await ctx.runMutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
    accountId,
    researchJobId,
    provider: "openrouter",
    operation: `openrouter.${opts.model}`,
    reason,
    costUsd,
    units: completion.usage.inputTokens + completion.usage.outputTokens,
    cacheStatus: "called",
    metadata: {
      ...metadata,
      model: completion.model,
      finishReason: completion.finishReason,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      thinkingTokens: completion.usage.thinkingTokens,
      ...(noCostData ? { note: "no_cost_from_provider" } : {}),
    },
  });

  return completion;
}

/**
 * Tiny convenience wrapper for non-OpenRouter providers (ScrapeCreators,
 * TwitterAPI.io, Composio, etc.). Just records cost — caller already
 * made the API call.
 *
 * Cost values for these providers come from the caller's price table
 * (e.g. ScrapeCreators $0.005 per call) since OpenRouter's auto-cost
 * doesn't apply.
 */
export async function recordExternalApiCost(
  ctx: ActionCtx,
  args: {
    accountId: Id<"creators">;
    researchJobId?: Id<"gtmResearchJobs">;
    provider:
      | "scrapecreators"
      | "x_api"
      | "composio"
      | "gemini"
      | "openclaw"
      | "other";
    operation: string;
    reason: string;
    costUsd: number;
    cacheStatus?: "hit" | "miss" | "called" | "skipped" | "failed";
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await ctx.runMutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
    accountId: args.accountId,
    researchJobId: args.researchJobId,
    provider: args.provider,
    operation: args.operation,
    reason: args.reason,
    costUsd: args.costUsd,
    cacheStatus: args.cacheStatus ?? "called",
    metadata: args.metadata,
  });
}
