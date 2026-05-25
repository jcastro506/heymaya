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
  /** Sprint 2.15.4 — exact USD cost from OpenRouter response when
   * `usage.include` is set in the request. Null if OpenRouter
   * didn't return cost (some BYOK providers don't). Cents-precision
   * preserved (e.g. 0.00000175 for a 2-token Flash Lite call).
   * Optional for backward-compat with pre-2.15.4 fixtures. */
  costUsd?: number | null;
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
const MAX_ATTEMPTS = 3; // initial + 2 retries for 5xx
const MAX_ATTEMPTS_RATE_LIMITED = 5; // 429s get more chances — typically resolved by waiting

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

/**
 * Sprint 2.14a.3 — Compute backoff for a 429 response. Honors
 * `retry-after` header when present (Telegram-style: seconds as
 * integer, or HTTP-date — we only handle the integer form which
 * is what OpenRouter actually sends). Falls back to exponential:
 * 1s, 4s, 16s, 30s, 30s. Capped at 30s so we don't wedge the
 * whole research orchestrator on a single throttled call.
 */
function rateLimitBackoff(
  attempt: number,
  retryAfterHeader: string | null
): number {
  if (retryAfterHeader) {
    const parsed = parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return Math.min(parsed * 1000, 30_000);
    }
  }
  // exponential: 1s, 4s, 16s, 30s, 30s
  return Math.min(1_000 * Math.pow(4, attempt - 1), 30_000);
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
  // Sprint 2.15.4 — exact USD cost when usage.include=true was set in
  // the request. Available on hosted providers; null on BYOK paths.
  cost?: number;
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
    costUsd: typeof usage?.cost === "number" ? usage.cost : null,
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
    // Sprint 2.15.4 — ask OpenRouter to include exact USD cost in
    // the usage block. Available on hosted providers, null on BYOK
    // paths. Captured into OpenRouterUsage.costUsd; aggregated per
    // research run on gtmResearchJobs.spentUsdLlm.
    usage: { include: true },
  };

  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://heymaya.app",
    "X-Title": "HeyMaya",
  };

  let lastError: OpenRouterError | null = null;
  // Sprint 2.14a.3 — use the larger budget so 429s get up to 5 tries.
  // The 5xx loop still exits early after MAX_ATTEMPTS (3) because the
  // retryable check below distinguishes the two.
  const totalAttempts = MAX_ATTEMPTS_RATE_LIMITED;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
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
      // Network errors get the 5xx budget (3 attempts), not the 429
      // budget. Avoids hammering a downed endpoint for 5 tries.
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
    // Sprint 2.14a.3 — 429 gets its own retry budget + retry-after
    // backoff. 5xx still uses the original 3-attempt budget. 4xx
    // (non-429) is never retried.
    const isRateLimit = status === 429;
    const isServerError = status >= 500 && status < 600;
    const retryable = isRateLimit || isServerError;
    lastError = new OpenRouterError(
      `OpenRouter HTTP ${status}: ${text.slice(0, 500)}`,
      status,
      text,
      retryable
    );
    if (!retryable) {
      throw lastError;
    }
    const budget = isRateLimit ? MAX_ATTEMPTS_RATE_LIMITED : MAX_ATTEMPTS;
    if (attempt < budget) {
      // Test seam: if caller provided retryDelayMs, honor it for
      // both 5xx and 429 (lets unit tests run with zero delay).
      // In production, 429 uses rateLimitBackoff (honors
      // retry-after header) and 5xx uses defaultRetryDelay.
      const delay = opts.retryDelayMs
        ? retryDelay(attempt)
        : isRateLimit
          ? rateLimitBackoff(attempt, response.headers.get("retry-after"))
          : retryDelay(attempt);
      await sleep(delay);
    } else {
      // Out of attempts for this status class.
      throw lastError;
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
