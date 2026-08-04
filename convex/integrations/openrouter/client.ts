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

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  /** Low for extraction. Variance is a feature when writing, a bug when reading. */
  temperature?: number;
  maxTokens?: number;
  apiKey: string;
}

export type OpenRouterResult =
  | { ok: true; content: string; usage?: { promptTokens: number; completionTokens: number } }
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
        max_tokens: request.maxTokens ?? 1_200,
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, reason: `openrouter ${res.status}: ${raw.slice(0, 200)}` };
    }

    let parsed: {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "openrouter returned non-JSON" };
    }

    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      return { ok: false, reason: "openrouter returned an empty completion" };
    }

    return {
      ok: true,
      content,
      usage: parsed.usage
        ? {
            promptTokens: parsed.usage.prompt_tokens ?? 0,
            completionTokens: parsed.usage.completion_tokens ?? 0,
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
