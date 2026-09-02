/**
 * ScrapeCreators HTTP client.
 *
 * Wraps `fetch` with:
 *   - `x-api-key` header injection from `SCRAPE_CREATORS_API_KEY`
 *   - configurable timeout (30s default) via AbortController
 *   - retry with exponential backoff + jitter (3 attempts)
 *     - retries on 5xx and network errors
 *     - retries on 429 (rate limit) with respect to `retry-after`
 *     - never retries on 4xx (other than 429)
 *   - typed errors so callers can distinguish HTTP failures, timeouts, and rate limits
 *
 * The caller is responsible for parsing the JSON shape (see `endpoints.ts` for Zod-validated wrappers).
 */

const DEFAULT_BASE_URL = "https://api.scrapecreators.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 500;

export class ScrapeCreatorsHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(
      `ScrapeCreators HTTP ${status} for ${url}: ${body.slice(0, 500)}`
    );
    this.name = "ScrapeCreatorsHttpError";
  }
}

export class ScrapeCreatorsTimeoutError extends Error {
  constructor(public readonly url: string, public readonly timeoutMs: number) {
    super(`ScrapeCreators request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "ScrapeCreatorsTimeoutError";
  }
}

export class ScrapeCreatorsRateLimitError extends Error {
  constructor(
    public readonly url: string,
    public readonly retryAfterSec: number | null
  ) {
    super(
      `ScrapeCreators rate limit for ${url}${
        retryAfterSec !== null ? ` (retry-after: ${retryAfterSec}s)` : ""
      }`
    );
    this.name = "ScrapeCreatorsRateLimitError";
  }
}

export interface ScrapeCreatorsClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  /**
   * Injectable fetch + sleep + random for tests. Defaults bound to the real environment.
   */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  /** If true, throw on rate-limit instead of retrying. Useful for callers that want fast-fail. */
  noRetryOnRateLimit?: boolean;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ScrapeCreatorsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: ScrapeCreatorsClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.SCRAPE_CREATORS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "SCRAPE_CREATORS_API_KEY is not set. Configure it in the Convex deployment env."
      );
    }
    this.apiKey = apiKey;
    this.baseUrl =
      options.baseUrl ??
      process.env.SCRAPE_CREATORS_BASE_URL ??
      DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    // Bind fetch to globalThis to avoid "Illegal invocation" in browser-like envs.
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  /**
   * Issue a request and return the parsed JSON. Caller validates shape.
   *
   * The path may be absolute (starts with `/`) or relative; both are appended to the base URL.
   */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const method = options.method ?? "GET";

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = {
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
            throw new ScrapeCreatorsRateLimitError(url, retryAfter);
          }
          // Honor server hint when present, else fall through to backoff.
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
            throw new ScrapeCreatorsHttpError(res.status, url, body);
          }
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }

        if (!res.ok) {
          // 4xx (other than 429) — never retry, surface immediately.
          const body = await safeReadText(res);
          throw new ScrapeCreatorsHttpError(res.status, url, body);
        }

        // OK
        const text = await res.text();
        if (!text) {
          return undefined as T;
        }
        return JSON.parse(text) as T;
      } catch (err) {
        clearTimeout(timer);
        // Surface terminal errors immediately.
        if (
          err instanceof ScrapeCreatorsHttpError ||
          err instanceof ScrapeCreatorsRateLimitError
        ) {
          throw err;
        }
        // AbortError → timeout
        if (isAbortError(err)) {
          if (attempt === this.maxAttempts) {
            throw new ScrapeCreatorsTimeoutError(url, timeoutMs);
          }
          lastErr = new ScrapeCreatorsTimeoutError(url, timeoutMs);
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
    // Should be unreachable; the loop always throws or returns.
    // If we somehow get here, surface the last error so the caller has context.
    throw lastErr ?? new Error("ScrapeCreatorsClient: exhausted retries with no error");
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
  // HTTP-date form fallback
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
    // DOMException name === "AbortError" in browsers / undici
    (("name" in err && (err as { name?: string }).name === "AbortError") ||
      ("code" in err && (err as { code?: string }).code === "ABORT_ERR"))
  );
}

/**
 * Convenience singleton lazily constructed from process.env. Tests should construct their own
 * `ScrapeCreatorsClient` instance with injected `fetchImpl` and `sleep`.
 */
let cachedDefault: ScrapeCreatorsClient | null = null;
export function getDefaultClient(): ScrapeCreatorsClient {
  if (!cachedDefault) {
    cachedDefault = new ScrapeCreatorsClient();
  }
  return cachedDefault;
}

/** Reset the singleton (for tests / Convex hot-reload). */
export function resetDefaultClient(): void {
  cachedDefault = null;
}
