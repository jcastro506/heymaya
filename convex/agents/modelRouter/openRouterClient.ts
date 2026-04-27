/**
 * Thin OpenRouter HTTP client for Maya.
 *
 * v0 scope:
 * - Single model: Gemini 3 Flash (configurable via OPENROUTER_DEFAULT_MODEL)
 * - Non-streaming only (streaming added in Sprint 4 with chat UI)
 * - Reasoning/thinking budget via OpenRouter's unified `reasoning` param
 * - Retry: 2 attempts on 5xx with exponential backoff; no retry on 4xx
 *
 * Reasoning param shape uses OpenRouter's unified API
 * (https://openrouter.ai/docs/use-cases/reasoning-tokens). For Gemini, OpenRouter
 * translates `reasoning.effort` → Gemini's `thinkingBudget`. We use:
 *   none   → reasoning: { enabled: false }
 *   low    → reasoning: { effort: "low" }
 *   medium → reasoning: { effort: "medium" }
 *   high   → reasoning: { effort: "high" }
 */

import type { ThinkingBudget } from "../../lib/planFeatures";

export interface ChatMessage {
  role: string;
  content: string;
}

export interface OpenRouterUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export interface OpenRouterCompletion {
  content: string;
  usage: OpenRouterUsage;
  model: string;
  finishReason: string | null;
  raw: unknown;
}

export interface OpenRouterCallOptions {
  model: string;
  messages: ReadonlyArray<ChatMessage>;
  thinkingBudget: ThinkingBudget;
  maxOutputTokens?: number;
  apiKey: string;
  /** Test seam — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam — disable retry delays in unit tests. */
  retryDelayMs?: (attempt: number) => number;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly body: string | null,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ATTEMPTS = 3; // initial + 2 retries

function reasoningParamFor(budget: ThinkingBudget): Record<string, unknown> {
  if (budget === "none") {
    return { enabled: false };
  }
  return { effort: budget };
}

function defaultRetryDelay(attempt: number): number {
  // exponential backoff: 200ms, 800ms
  return 200 * Math.pow(4, attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface OpenRouterRawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  // OpenRouter exposes reasoning tokens via completion_tokens_details on
  // models that surface them (Gemini reasoning, OpenAI o-series, etc.)
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
  // Some providers nest under `reasoning_tokens` directly.
  reasoning_tokens?: number;
}

interface OpenRouterRawResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: OpenRouterRawUsage;
  error?: { message?: string; code?: string | number };
}

function parseUsage(usage: OpenRouterRawUsage | undefined): OpenRouterUsage {
  const inputTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const reasoningTokens =
    usage?.completion_tokens_details?.reasoning_tokens ??
    usage?.reasoning_tokens ??
    0;
  // OpenRouter's `completion_tokens` already includes reasoning tokens for
  // most providers. Subtract to get visible-output tokens; floor at 0 for
  // providers that report them separately.
  const outputTokens = Math.max(0, completionTokens - reasoningTokens);
  return {
    inputTokens,
    outputTokens,
    thinkingTokens: reasoningTokens,
  };
}

export async function callOpenRouter(
  opts: OpenRouterCallOptions
): Promise<OpenRouterCompletion> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retryDelay = opts.retryDelayMs ?? defaultRetryDelay;

  const body = {
    model: opts.model,
    messages: opts.messages,
    reasoning: reasoningParamFor(opts.thinkingBudget),
    ...(opts.maxOutputTokens !== undefined
      ? { max_tokens: opts.maxOutputTokens }
      : {}),
    stream: false,
  };

  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://heymaya.app",
    "X-Title": "HeyMaya",
  };

  let lastError: OpenRouterError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      lastError = new OpenRouterError(
        `OpenRouter network error: ${(networkErr as Error).message}`,
        null,
        null,
        true
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(retryDelay(attempt));
        continue;
      }
      throw lastError;
    }

    const status = response.status;
    if (status >= 200 && status < 300) {
      const parsed = (await response.json()) as OpenRouterRawResponse;
      if (parsed.error) {
        throw new OpenRouterError(
          `OpenRouter API error: ${parsed.error.message ?? "unknown"}`,
          status,
          JSON.stringify(parsed.error),
          false
        );
      }
      const choice = parsed.choices?.[0];
      const content = choice?.message?.content ?? "";
      return {
        content,
        usage: parseUsage(parsed.usage),
        model: parsed.model ?? opts.model,
        finishReason: choice?.finish_reason ?? null,
        raw: parsed,
      };
    }

    const text = await safeText(response);
    const retryable = status >= 500 && status < 600;
    lastError = new OpenRouterError(
      `OpenRouter HTTP ${status}: ${text.slice(0, 500)}`,
      status,
      text,
      retryable
    );
    if (!retryable) {
      throw lastError;
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(retryDelay(attempt));
    }
  }
  // Exhausted retries on retryable errors.
  throw lastError ?? new OpenRouterError("OpenRouter unknown failure", null, null, true);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
