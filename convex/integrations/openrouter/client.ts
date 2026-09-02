/**
 * OpenRouter — the vendor call, and nothing else.
 *
 * Product logic lives in `convex/maya/`; this file knows how to send a chat
 * completion and how to report when that fails. It deliberately does not know
 * what a product truth is, which model should read one, or what to do when the
 * answer is unusable.
 *
 * ## Why Convex calls a model at all
 *
 * Almost every model call in this product belongs to the agent, on her machine.
 * This one can't: the product read happens at onboarding **step 2**, before the
 * founder has paired Telegram and possibly before her machine is healthy
 * (§18.9.25a deploys at screen ①, and a boot is 20–40s). Making the first
 * visible moment of the product wait on a cold machine would be the worst
 * possible place to spend that latency.
 *
 * So: deterministic code collects the page, Convex asks a model to judge it,
 * and the result is a row she reads later — which is the standing division of
 * labour, not an exception to it.
 */

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** A model that hangs must not hold an onboarding screen open forever. */
export const OPENROUTER_TIMEOUT_MS = 45_000;

export interface OpenRouterToolCall { id: string; name: string; arguments: string }

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Assistant turn that asked for tools (echoed back verbatim on the next request). */
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  /** Tool turn: which call this answers. */
  tool_call_id?: string;
  name?: string;
}

/** A tool as OpenRouter/OpenAI expect it. */
export interface OpenRouterTool { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }

export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  /** Low for extraction. Variance is a feature when writing, a bug when reading. */
  temperature?: number;
  /**
   * ⚠️ **REASONING TOKENS COUNT AGAINST THIS.**
   *
   * `qwen/qwen3.7-flash` spent **188 reasoning tokens** answering a 21-token
   * prompt that needed 10 tokens of output. On a real prompt it will spend
   * far more — and when the budget runs out mid-reasoning the API returns
   * `finish_reason: "stop"` with **empty content**, not an error.
   *
   * That reads as "the model had nothing to say", which for a gate that fails
   * closed means blocking everything, and for one that fails open means
   * approving everything. Budget for reasoning + answer, never just the answer.
   */
  maxTokens?: number;
  apiKey: string;
  /** §13.11: the tool belt; the model may answer with tool_calls instead of content. */
  tools?: OpenRouterTool[];
  toolChoice?: "auto" | "none" | "required";
}

export type OpenRouterResult =
  | {
      ok: true;
      content: string;
      /** Present when the model asked for tools; content may then be empty. */
      toolCalls?: OpenRouterToolCall[];
      usage?: {
        promptTokens: number;
        completionTokens: number;
        /**
         * ⭐ What this call ACTUALLY cost, in USD, as reported by OpenRouter.
         *
         * Asked for rather than computed. A local price table is a second
         * source of truth that rots silently — one already claimed Lite was
         * $0.075 when it was $0.25, a 3.3× error nobody noticed because
         * nothing reconciled it against a bill. The vendor knows the real
         * number for the real model actually served, including any fallback
         * routing we didn't choose.
         *
         * Absent when OpenRouter omits it; callers must treat undefined as
         * "unknown", never as zero. A cost ledger that records 0 for unknown
         * reads as free, and this product has already shipped a ledger that
         * reported $0.025 against a $22 bill.
         */
        costUsd?: number;
      };
    }
  | { ok: false; reason: string };

/**
 * One chat completion.
 *
 * Never throws. Every failure comes back as a named reason, because the callers
 * are Convex actions where an uncaught throw becomes a retry of work that may
 * have already cost money.
 */
export async function callOpenRouter(
  request: OpenRouterRequest
): Promise<OpenRouterResult> {
  if (!request.apiKey) return { ok: false, reason: "no OpenRouter API key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 4_000,
        ...(request.tools && request.tools.length ? { tools: request.tools, tool_choice: request.toolChoice ?? "auto" } : {}),
        // Opt in to cost reporting. Without this the response carries token
        // counts and no price, which is the half that can't be budgeted.
        usage: { include: true },
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, reason: `openrouter ${res.status}: ${raw.slice(0, 200)}` };
    }

    let parsed: {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
      };
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "openrouter returned non-JSON" };
    }

    const message = parsed.choices?.[0]?.message;
    const content = message?.content;
    const toolCalls = (message?.tool_calls ?? []).filter((t) => t.function?.name).map((t, i) => ({ id: t.id ?? `call_${i}`, name: t.function!.name!, arguments: t.function!.arguments ?? "{}" }));
    if ((typeof content !== "string" || content.trim().length === 0) && toolCalls.length === 0) {
      return { ok: false, reason: "openrouter returned an empty completion" };
    }

    return {
      ok: true,
      content: typeof content === "string" ? content : "",
      ...(toolCalls.length ? { toolCalls } : {}),
      usage: parsed.usage
        ? {
            promptTokens: parsed.usage.prompt_tokens ?? 0,
            completionTokens: parsed.usage.completion_tokens ?? 0,
            // Left undefined rather than defaulted to 0 — see the field docs.
            costUsd:
              typeof parsed.usage.cost === "number" ? parsed.usage.cost : undefined,
          }
        : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: /abort/i.test(message) ? "openrouter timed out" : message,
    };
  } finally {
    clearTimeout(timer);
  }
}
