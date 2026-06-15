/**
 * Creatify HTTP client.
 *
 * Wraps `fetch` with:
 *   - dual-header auth injection (`X-API-ID` + `X-API-KEY`) from
 *     `CREATIFY_API_ID` / `CREATIFY_API_KEY`
 *   - configurable timeout (30s default) via AbortController
 *   - retry with exponential backoff + full-jitter (3 attempts)
 *     - retries on 5xx and network errors
 *     - retries on 429 (rate limit), honoring `retry-after`
 *     - never retries on other 4xx
 *   - typed errors so callers can distinguish HTTP failures, timeouts, rate limits
 *
 * Vendor isolation: ALL Creatify HTTP/auth lives here + `endpoints.ts`. The rest
 * of the codebase talks to `endpoints.ts` typed wrappers, never to fetch/URLs.
 * Mirrors `convex/integrations/scrapeCreators/client.ts` (single-key) — the only
 * differences are the two auth headers, the base URL, and PUT support (Links).
 *
 * NOTE: each Creatify call is fast (create returns a job id immediately; render
 * happens server-side and we poll via GET). So the default 30s timeout is right —
 * we never block a request for the multi-minute render. The durable poll loop
 * lives in the Convex orchestration layer (scheduler), not here.
 */

const DEFAULT_BASE_URL = "https://api.creatify.ai";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 500;

export class CreatifyHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(`Creatify HTTP ${status} for ${url}: ${body.slice(0, 500)}`);
    this.name = "CreatifyHttpError";
  }
}

export class CreatifyTimeoutError extends Error {
  constructor(public readonly url: string, public readonly timeoutMs: number) {
    super(`Creatify request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "CreatifyTimeoutError";
  }
}

export class CreatifyRateLimitError extends Error {
  constructor(
    public readonly url: string,
    public readonly retryAfterSec: number | null
  ) {
    super(
      `Creatify rate limit for ${url}${
        retryAfterSec !== null ? ` (retry-after: ${retryAfterSec}s)` : ""
      }`
    );
    this.name = "CreatifyRateLimitError";
  }
}

export interface CreatifyClientOptions {
  apiId?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  /** Injectable fetch + sleep + random for tests. Defaults bound to the real environment. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface CreatifyRequestOptions {
  method?: "GET" | "POST" | "PUT";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  /** If true, throw on rate-limit instead of retrying. */
  noRetryOnRateLimit?: boolean;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CreatifyClient {
  private readonly apiId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: CreatifyClientOptions = {}) {
    const apiId = options.apiId ?? process.env.CREATIFY_API_ID;
    const apiKey = options.apiKey ?? process.env.CREATIFY_API_KEY;
    if (!apiId || !apiKey) {
      throw new Error(
        "CREATIFY_API_ID / CREATIFY_API_KEY are not set. Configure them in the Convex deployment env."
      );
    }
    this.apiId = apiId;
    this.apiKey = apiKey;
    this.baseUrl =
      options.baseUrl ?? process.env.CREATIFY_BASE_URL ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  /**
   * Issue a request and return the parsed JSON. Caller validates shape.
   * The path may be absolute (starts with `/`) or relative.
   */
  async request<T = unknown>(
    path: string,
    options: CreatifyRequestOptions = {}
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const method = options.method ?? "GET";

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = {
          "X-API-ID": this.apiId,
          "X-API-KEY": this.apiKey,
          accept: "application/json",
        };
        if (options.body !== undefined) {
          headers["content-type"] = "application/json";
        }
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body:
            options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 429) {
          const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
          if (options.noRetryOnRateLimit || attempt === this.maxAttempts) {
            throw new CreatifyRateLimitError(url, retryAfter);
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
            throw new CreatifyHttpError(res.status, url, body);
          }
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }

        if (!res.ok) {
          // 4xx (other than 429) — never retry, surface immediately.
          const body = await safeReadText(res);
          throw new CreatifyHttpError(res.status, url, body);
        }

        const text = await res.text();
        if (!text) {
          return undefined as T;
        }
        return JSON.parse(text) as T;
      } catch (err) {
        clearTimeout(timer);
        if (
          err instanceof CreatifyHttpError ||
          err instanceof CreatifyRateLimitError
        ) {
          throw err;
        }
        if (isAbortError(err)) {
          if (attempt === this.maxAttempts) {
            throw new CreatifyTimeoutError(url, timeoutMs);
          }
          lastErr = new CreatifyTimeoutError(url, timeoutMs);
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
    throw lastErr ?? new Error("CreatifyClient: exhausted retries with no error");
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

/**
 * Convenience singleton lazily constructed from process.env. Tests should
 * construct their own `CreatifyClient` with injected `fetchImpl` + `sleep`.
 */
let cachedDefault: CreatifyClient | null = null;
export function getDefaultClient(): CreatifyClient {
  if (!cachedDefault) {
    cachedDefault = new CreatifyClient();
  }
  return cachedDefault;
}

/** Reset the singleton (for tests / Convex hot-reload). */
export function resetDefaultClient(): void {
  cachedDefault = null;
}

/** Whether Creatify credentials are configured (cheap gate before constructing). */
export function isCreatifyConfigured(): boolean {
  return Boolean(process.env.CREATIFY_API_ID && process.env.CREATIFY_API_KEY);
}
