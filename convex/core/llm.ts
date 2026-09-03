/**
 * ⭐ The one way `convex/maya` calls a model.
 *
 * Every model call in this package used to `await import(...)` the OpenRouter
 * client and call it directly — ten sites, none of which recorded what the call
 * cost. That is why `spendCeiling.spendToday` reported **$0.00** while the real
 * account had burned $2,508: nothing wrote the ledger, and an empty ledger
 * reads exactly like a free product.
 *
 * The fix is not "remember to record it". A rule that every caller must
 * remember is a rule that a new caller silently breaks — this codebase's most
 * common defect is finished machinery nobody invokes. So the recording lives on
 * the only path to the model.
 *
 * ## What it does not do
 *
 * It does not block, throttle, or consult a budget. §9.1 keeps publish-or-hold
 * in exactly one function, and the operator was explicit that per-user caps
 * which stop her talking are not the product. This measures. See `cogs.ts`.
 */

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fakeAnswer, fakeModelEnabled } from "./fakeModel";
import type {
  OpenRouterMessage,
  OpenRouterResult, OpenRouterTool } from "../integrations/openrouter/client";

export interface CallModelInput {
  /** Whose bill this lands on. Required — spend with no owner is unpriceable. */
  creatorId: Id<"creators">;
  /**
   * What the spend was FOR, in stable snake_case: `directive_gate`,
   * `idea_scoring`, `safety_critic`, `complaint_mining`.
   *
   * This is the field that makes an expensive creator *explainable* rather
   * than merely expensive, so it is required and should never be a variable —
   * a purpose computed at runtime cannot be grouped.
   */
  purpose: string;
  model: string;
  /** Fail over after this long instead of the shared default. Set it wherever a person is waiting. */
  timeoutMs?: number;
  messages: OpenRouterMessage[];
  tools?: OpenRouterTool[];
  toolChoice?: "auto" | "none" | "required";
  temperature?: number;
  maxTokens?: number;
  apiKey: string;
}

/**
 * One chat completion, with its cost recorded.
 *
 * Never throws — same contract as the client it wraps, because these run inside
 * Convex actions where an uncaught throw retries work that already cost money.
 * A failed recording never fails the call: losing a ledger row is bad, losing
 * the answer the founder is waiting on is worse.
 */
/**
 * ⚠️ Models that think before answering, and bill the thinking to `max_tokens`.
 *
 * This is the single most expensive misunderstanding in the codebase, and it
 * has now been discovered twice. `outbound.ts` records the first instance —
 * *"`maxTokens: 300` against 188 reasoning tokens"* — and fixed it locally by
 * raising one number, so the trap stayed set everywhere else.
 *
 * The second instance, measured 2026-08-09 on `make-carousel`:
 *
 * | | |
 * |---|---|
 * | `max_tokens` requested | 1200 |
 * | `reasoning_tokens` spent | **892** |
 * | left for the actual answer | ~300 |
 *
 * That call *just* fit. Add the voice excerpts and a format card to the prompt,
 * reasoning grows, and the content budget reaches zero — which surfaces as an
 * **empty completion, not an error.** The post simply doesn't get made, and the
 * failure names the wrong thing ("I couldn't get a set out of this angle").
 */
export const REASONING_MODELS = [
  "openai/gpt-5.6-luna-pro",
  // GLM 5.3 flash and DeepSeek v4 flash reason before answering; the critic fell back on every call
  // until they were listed, because a 400-token answer budget was eaten by thinking (2026-09-02).
  "z-ai/glm",
  "deepseek/",
  // Gemini 3.x flash thinks too: the first-night first reads trailed off mid-sentence and one leaked a
  // "Refining word count & voice" scratchpad line, both from a 500-token budget eaten by thinking.
  "google/gemini-3",
];

/**
 * Room to think, added on top of whatever the caller budgeted.
 *
 * ⭐ The point is that `maxTokens` keeps meaning *"how long may the answer
 * be"*. Callers reason about output length; none of them can reason about how
 * long a model will deliberate, and requiring them to would put the trap back.
 *
 * 1500 covers the observed spread on SHORT answers — the measured cases ran 188
 * and 892 reasoning tokens on a few hundred tokens of output.
 */
export const REASONING_ALLOWANCE = 1_500;

/**
 * ⚠️ The floor is not enough on its own: how long a model deliberates scales with
 * how much it is being asked to produce. The 3,000-token dossier on the first live
 * creator (2026-09-02) came back truncated mid-object TWICE — thinking ate most of
 * `3000 + 1500` and the JSON stopped at ~4,600 characters, which surfaced as
 * "dossier did not validate" and left onboarding with no dossier at all.
 *
 * So: room to think is at least the floor, and at least as much room as the answer
 * itself gets. Short calls are unchanged; long structured ones get the headroom they
 * always needed.
 */
export function reasoningAllowanceFor(maxTokens: number): number {
  return Math.max(REASONING_ALLOWANCE, maxTokens);
}

export function isReasoningModel(model: string): boolean {
  return REASONING_MODELS.some((m) => model.startsWith(m));
}

/** What to actually send, given what the caller wants back. */
export function budgetFor(model: string, maxTokens?: number): number | undefined {
  if (maxTokens === undefined) return undefined;
  return isReasoningModel(model) ? maxTokens + reasoningAllowanceFor(maxTokens) : maxTokens;
}

export async function callModel(
  ctx: ActionCtx,
  input: CallModelInput
): Promise<OpenRouterResult> {
  // Tests only (MODEL_FAKE=1): deterministic answers by purpose, no network, no spend. The deploy guard refuses this flag.
  if (fakeModelEnabled()) return fakeAnswer(input.purpose, input.messages);
  const { callOpenRouter } = await import("../integrations/openrouter/client");

  const result = await callOpenRouter({
    model: input.model,
    messages: input.messages,
    tools: input.tools,
    toolChoice: input.toolChoice,
    temperature: input.temperature,
    maxTokens: budgetFor(input.model, input.maxTokens),
    timeoutMs: input.timeoutMs,
    apiKey: input.apiKey,
  });

  /**
   * ⚠️ An empty completion from a reasoning model is almost always this bug,
   * and "openrouter returned an empty completion" sends whoever reads it
   * looking at the vendor instead of at the budget.
   */
  const timedOut = !result.ok && /timed out|abort/i.test(result.reason);
  if (timedOut) {
    // A timeout is NOT the budget bug. Saying so sent me looking at max_tokens for a
    // latency problem; the two need opposite fixes.
    console.error(`[llm] ${input.purpose}: ${input.model} timed out. This is latency, not the token budget — the fallback takes it from here.`);
  } else if (!result.ok && isReasoningModel(input.model)) {
    console.error(
      `[llm] ${input.purpose}: ${result.reason} — ${input.model} reasons before ` +
        `answering and bills it to max_tokens. Requested ${input.maxTokens ?? "default"} ` +
        `+ ${reasoningAllowanceFor(input.maxTokens ?? 0)} allowance. If this repeats, the content budget is too small.`
    );
  }

  // ⚠️ Recorded on failure too. A call that timed out mid-stream, or returned
  // an empty completion after burning reasoning tokens, still cost money —
  // and those are exactly the runaway shapes worth seeing in the ledger.
  const usage = result.ok ? result.usage : undefined;
  try {
    await ctx.runMutation(internal.core.costs.record, {
      creatorId: input.creatorId,
      vendor: "openrouter",
      resource: input.model,
      purpose: input.purpose,
      costUsd: usage?.costUsd,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
    });
  } catch (error) {
    console.error(`[llm] cost recording failed for ${input.purpose}: ${String(error)}`);
  }

  return result;
}
