/**
 * Maya model + thinking-budget router.
 *
 * Sprint 1, per docs/SPRINT_PLAN_V0.md § 5:
 *   "Single model: Gemini 3 Flash for everything.
 *    Per-task thinking budget map.
 *    Plan-tier caps the maximum thinking budget allowed.
 *    Telemetry capture per call → aiCallLog."
 *
 * Contract:
 *   - Resolve creator → plan
 *   - Pick budget = clampThinkingBudget(creator, requestedBudget ?? defaultThinkingBudget(taskTag))
 *   - Call OpenRouter (Gemini 3 Flash)
 *   - Compute cost from token usage
 *   - Write one aiCallLog row
 *   - Return { content, usage, thinkingBudgetUsed, costUsd, latencyMs }
 *
 * The plan-tier clamp is non-negotiable. Every call clamps. There is no
 * "trust the caller" path.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  clampThinkingBudget,
  type ThinkingBudget,
} from "../../lib/planFeatures";
import {
  defaultThinkingBudget,
  isTaskTag,
  taskTagFiringKind,
  type TaskTag,
} from "./taskTags";
import {
  callOpenRouter,
  OpenRouterError,
  type ChatMessage,
  type OpenRouterUsage,
} from "./openRouterClient";

/**
 * Gemini 3 Flash pricing on OpenRouter, $/MTok.
 * Locked per docs/SPRINT_PLAN_V0.md § 3 ("~$0.50 / $3.00 per MTok").
 * Thinking tokens are billed as output tokens.
 *
 * IMPORTANT: re-verify on the OpenRouter model page before any meaningful
 * cost reporting; OpenRouter occasionally re-prices Gemini.
 */
export const GEMINI_3_FLASH_INPUT_PRICE_PER_MTOK = 0.5;
export const GEMINI_3_FLASH_OUTPUT_PRICE_PER_MTOK = 3.0;

const THINKING_BUDGET_VALIDATOR = v.union(
  v.literal("none"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high")
);

const MESSAGE_VALIDATOR = v.object({
  role: v.string(),
  content: v.string(),
});

export interface CallMayaResult {
  content: string;
  usage: OpenRouterUsage;
  thinkingBudgetUsed: ThinkingBudget;
  costUsd: number;
  latencyMs: number;
  model: string;
  finishReason: string | null;
}

/**
 * Internal query to fetch a creator. Lets the action stay action-pure and
 * read the creator's plan via Convex's transactional read path.
 */
export const getCreatorForRouter = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (
    ctx,
    args
  ): Promise<Pick<Doc<"creators">, "_id" | "plan"> | null> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) return null;
    return { _id: creator._id, plan: creator.plan };
  },
});

/**
 * Compute per-call USD cost from token usage. Thinking tokens are billed at
 * the output rate.
 */
export function computeCostUsd(usage: OpenRouterUsage): number {
  const input =
    (usage.inputTokens * GEMINI_3_FLASH_INPUT_PRICE_PER_MTOK) / 1_000_000;
  const output =
    ((usage.outputTokens + usage.thinkingTokens) *
      GEMINI_3_FLASH_OUTPUT_PRICE_PER_MTOK) /
    1_000_000;
  return roundTo(input + output, 8);
}

function roundTo(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

export const callMaya = internalAction({
  args: {
    creatorId: v.id("creators"),
    taskTag: v.string(),
    messages: v.array(MESSAGE_VALIDATOR),
    requestedBudget: v.optional(THINKING_BUDGET_VALIDATOR),
    maxOutputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CallMayaResult> => {
    if (!isTaskTag(args.taskTag)) {
      throw new Error(
        `callMaya: unknown task tag '${args.taskTag}'. See convex/agents/modelRouter/taskTags.ts.`
      );
    }
    if (args.messages.length === 0) {
      throw new Error("callMaya: messages must be non-empty.");
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "callMaya: OPENROUTER_API_KEY is not set in Convex environment."
      );
    }
    const model =
      process.env.OPENROUTER_DEFAULT_MODEL ?? "google/gemini-3-flash";

    const creator: Pick<Doc<"creators">, "_id" | "plan"> | null =
      await ctx.runQuery(internal.agents.modelRouter.maya.getCreatorForRouter, {
        creatorId: args.creatorId as Id<"creators">,
      });
    if (!creator) {
      throw new Error(`callMaya: creator ${args.creatorId} not found.`);
    }

    const requested =
      args.requestedBudget ?? defaultThinkingBudget(args.taskTag);
    const thinkingBudgetUsed = clampThinkingBudget(creator, requested);

    const messages: ChatMessage[] = args.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const start = Date.now();
    let result;
    try {
      result = await callOpenRouter({
        model,
        messages,
        thinkingBudget: thinkingBudgetUsed,
        maxOutputTokens: args.maxOutputTokens,
        apiKey,
      });
    } catch (err) {
      // Re-throw — caller decides retry / fallback. We don't log failed calls
      // to aiCallLog because we have no usage to record.
      if (err instanceof OpenRouterError) throw err;
      throw new Error(
        `callMaya: OpenRouter call failed: ${(err as Error).message}`
      );
    }
    const latencyMs = Date.now() - start;

    const costUsd = computeCostUsd(result.usage);

    await ctx.runMutation(internal.agents.modelRouter.logCall.recordAiCall, {
      creatorId: args.creatorId as Id<"creators">,
      taskTag: args.taskTag,
      model: result.model,
      thinkingBudget: thinkingBudgetUsed,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      thinkingTokens: result.usage.thinkingTokens,
      costUsd,
      latencyMs,
      ts: Date.now(),
    });

    // Creator usage analytics — cron_fired / event_fired wire-in (paths a, b,
    // and the LLM-call layer for c). The `callMaya` action is the single
    // chokepoint every Maya behavior eventually flows through; emitting from
    // here gives us "Maya ran X" for free across morning_brief, evening_recap,
    // niche_scan, weekly_review_synth, brand_email_draft, etc. Tags whose
    // firing kind is `null` (e.g. chat_reply) are handled at the chat-turn
    // wire-in instead so we don't double-count.
    const firingKind = taskTagFiringKind(args.taskTag as TaskTag);
    if (firingKind !== null) {
      await ctx.runMutation(internal.lib.usageEvents.logUsageEvent, {
        creatorId: args.creatorId as Id<"creators">,
        kind: firingKind,
        label: args.taskTag,
        meta: {
          thinkingBudget: thinkingBudgetUsed,
          latencyMs,
          costUsd,
        },
      });
    }

    return {
      content: result.content,
      usage: result.usage,
      thinkingBudgetUsed,
      costUsd,
      latencyMs,
      model: result.model,
      finishReason: result.finishReason,
    };
  },
});
