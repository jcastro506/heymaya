/**
 * Composio v3 HTTP client.
 *
 * Sprint 5 — write-layer plumbing for Maya. Wraps `fetch` with:
 *   - `x-api-key` header injection from `COMPOSIO_API_KEY` (Composio v3 uses
 *     a static workspace API key plus a per-account `connectedAccountId` for
 *     OAuth-bound providers)
 *   - retry with exponential backoff + jitter (3 attempts max)
 *     - retries on 5xx and network/timeout errors
 *     - retries on 429 honoring `retry-after`
 *     - never retries 4xx (other than 429) — those are caller bugs and should
 *       surface immediately so we don't paper over a malformed action call
 *   - typed errors so callers can distinguish HTTP / timeout / rate-limit
 *
 * Caller is responsible for response shape validation (Zod parsers live in
 * `actions/*.ts`). This client only does HTTP transport.
 *
 * Why fetch + Zod and not the Composio SDK package:
 *   - Convex runs on V8 isolate (Edge runtime). Some Composio SDKs ship Node
 *     polyfills that don't load there. Direct HTTP keeps the surface narrow
 *     and the bundle small.
 */

const DEFAULT_BASE_URL = "https://backend.composio.dev";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 500;

export class ComposioHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(`Composio HTTP ${status} for ${url}: ${body.slice(0, 500)}`);
    this.name = "ComposioHttpError";
  }
}

export class ComposioTimeoutError extends Error {
  constructor(public readonly url: string, public readonly timeoutMs: number) {
    super(`Composio request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "ComposioTimeoutError";
  }
}

export class ComposioRateLimitError extends Error {
  constructor(
    public readonly url: string,
    public readonly retryAfterSec: number | null
  ) {
    super(
      `Composio rate limit for ${url}${
        retryAfterSec !== null ? ` (retry-after: ${retryAfterSec}s)` : ""
      }`
    );
    this.name = "ComposioRateLimitError";
  }
}

/**
 * Generic Composio error — wraps unexpected failures with the URL + cause so
 * action wrappers can produce useful diagnostics without leaking the API key.
 */
export class ComposioError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ComposioError";
  }
}

export interface ComposioClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  /** Test seam — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface ComposioRequestOptions {
  method?: "GET" | "POST" | "DELETE" | "PATCH";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  /** If true, throw on rate-limit instead of waiting+retrying. */
  noRetryOnRateLimit?: boolean;
  /**
   * Extra per-request headers (e.g. an OAuth bearer overlay if Composio ever
   * exposes one). The base `x-api-key` and `accept`/`content-type` headers
   * are always set by the client and cannot be overridden — fail-closed.
   */
  extraHeaders?: Record<string, string>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ComposioClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: ComposioClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      throw new ComposioError(
        "COMPOSIO_API_KEY is not set. Configure it in the Convex deployment env."
      );
    }
    this.apiKey = apiKey;
    this.baseUrl =
      options.baseUrl ??
      process.env.COMPOSIO_BASE_URL ??
      DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  async request<T = unknown>(
    path: string,
    options: ComposioRequestOptions = {}
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const method = options.method ?? "GET";

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Base headers ALWAYS overwrite extraHeaders — auth/content-type are
        // owned by the client. extraHeaders is merged first so the spread
        // overrides any conflicting key.
        const headers: Record<string, string> = {
          ...(options.extraHeaders ?? {}),
          "x-api-key": this.apiKey,
          accept: "application/json",
        };
        if (options.body !== undefined) {
          headers["content-type"] = "application/json";
        }
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 429) {
          const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
          if (options.noRetryOnRateLimit || attempt === this.maxAttempts) {
            throw new ComposioRateLimitError(url, retryAfter);
          }
          const waitMs =
            retryAfter !== null
              ? retryAfter * 1000
              : this.computeBackoff(attempt);
          await this.sleep(waitMs);
          continue;
        }

        if (res.status >= 500) {
          const body = await safeReadText(res);
          if (attempt === this.maxAttempts) {
            throw new ComposioHttpError(res.status, url, body);
          }
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }

        if (!res.ok) {
          const body = await safeReadText(res);
          throw new ComposioHttpError(res.status, url, body);
        }

        const text = await res.text();
        if (!text) {
          return undefined as T;
        }
        return JSON.parse(text) as T;
      } catch (err) {
        clearTimeout(timer);
        if (
          err instanceof ComposioHttpError ||
          err instanceof ComposioRateLimitError
        ) {
          throw err;
        }
        if (isAbortError(err)) {
          if (attempt === this.maxAttempts) {
            throw new ComposioTimeoutError(url, timeoutMs);
          }
          lastErr = new ComposioTimeoutError(url, timeoutMs);
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }
        // Network error (TypeError on fetch) — retry.
        lastErr = err;
        if (attempt === this.maxAttempts) {
          throw err;
        }
        await this.sleep(this.computeBackoff(attempt));
      }
    }
    throw lastErr ?? new ComposioError("ComposioClient: exhausted retries with no error");
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): string {
    const base = this.baseUrl.endsWith("/")
      ? this.baseUrl.slice(0, -1)
      : this.baseUrl;
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${base}${suffix}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  /**
   * Exponential backoff with full-jitter:
   *   wait = random_between(0, base * 2^(attempt - 1))
   * Attempt 1 → 0..500ms, attempt 2 → 0..1000ms, attempt 3 → 0..2000ms.
   */
  private computeBackoff(attempt: number): number {
    const ceiling = this.baseBackoffMs * Math.pow(2, attempt - 1);
    return Math.floor(this.random() * ceiling);
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const asInt = parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    const sec = Math.max(0, Math.round((asDate - Date.now()) / 1000));
    return sec;
  }
  return null;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<failed to read response body>";
  }
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (("name" in err && (err as { name?: string }).name === "AbortError") ||
      ("code" in err && (err as { code?: string }).code === "ABORT_ERR"))
  );
}

let cachedDefault: ComposioClient | null = null;
export function getDefaultComposioClient(): ComposioClient {
  if (!cachedDefault) {
    cachedDefault = new ComposioClient();
  }
  return cachedDefault;
}

export function resetDefaultComposioClient(): void {
  cachedDefault = null;
}
