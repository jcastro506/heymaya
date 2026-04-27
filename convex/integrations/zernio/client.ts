/**
 * Zernio (formerly Late, getlate.dev) HTTP client.
 *
 * Sprint 1 (service product). Wraps `fetch` with:
 *   - Bearer-token auth: every call carries `Authorization: Bearer <apiKey>`
 *     where the API key is per-business (decrypted from
 *     `zernioConnections.encryptedApiKey`).
 *     [unverified — Zernio public docs at https://docs.getlate.dev/ confirm
 *      Bearer auth; live-smoke against operator's Build-tier subscription
 *      is the gate that confirms exact header name.]
 *   - HMAC-SHA256 webhook signature verification helpers (for `webhooks.ts`).
 *     Header name: `X-Late-Signature` (Zernio retained the legacy "Late"
 *     branding in webhooks per https://docs.getlate.dev/core/webhooks).
 *   - Retry with exponential backoff + jitter (3 attempts max):
 *     - retries on 5xx and network/timeout errors
 *     - retries on 429 honoring `Retry-After` (Zernio's docs surface this
 *       header on rate limits)
 *     - never retries 4xx (other than 429) — those are caller bugs and
 *       should surface immediately
 *   - Typed error class hierarchy:
 *     - `ZernioAuthError`            — 401 / 403, missing API key
 *     - `ZernioRateLimitError`       — 429 (after max retries exceeded)
 *     - `ZernioPlatformError`        — underlying social platform rejected
 *                                       (e.g. Google `ReviewReplyState:
 *                                       REJECTED`, Meta blocked, etc.).
 *                                       Endpoint wrappers detect platform-
 *                                       errors from response shape and
 *                                       re-throw as this class — the
 *                                       transport layer here handles only
 *                                       the HTTP envelope.
 *     - `ZernioApiError`             — generic 4xx/5xx fall-through
 *     - `ZernioTimeoutError`         — abort / network timeout
 *
 * Why fetch + manual transport (not a Zernio SDK):
 *   - Convex runs on V8 isolate (Edge runtime). Some SDKs ship Node
 *     polyfills that don't load there. Direct HTTP keeps the surface narrow.
 *   - Interface-isolation contract (R1 § Verdict): the implementation
 *     behind `endpoints.ts` must be swappable to Ayrshare in <2 weeks.
 *     Owning the transport is what makes that possible.
 *
 * Caller is responsible for response shape validation (Zod parsers live in
 * `endpoints.ts`). This client only does HTTP transport + signature verify.
 */

import {
  ZernioApiError,
  ZernioAuthError,
  ZernioRateLimitError,
  ZernioTimeoutError,
} from "./types";

const DEFAULT_BASE_URL = "https://getlate.dev";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 500;

export const ZERNIO_SIGNATURE_HEADER = "x-late-signature";

export interface ZernioClientOptions {
  /** Per-business Zernio API key (Bearer). Required. */
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  /** Test seam — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface ZernioRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  /** If true, throw on rate-limit instead of waiting+retrying. */
  noRetryOnRateLimit?: boolean;
  /**
   * Extra per-request headers. Base `authorization` and `accept` /
   * `content-type` are always set by the client and cannot be overridden —
   * fail-closed against extraHeaders attempting to swap auth.
   */
  extraHeaders?: Record<string, string>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ZernioClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: ZernioClientOptions) {
    if (!options.apiKey || options.apiKey.length === 0) {
      throw new ZernioAuthError(
        "ZernioClient: apiKey is required. Pass the per-business API key " +
          "decrypted from zernioConnections.encryptedApiKey."
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl =
      options.baseUrl ??
      process.env.ZERNIO_BASE_URL ??
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
    options: ZernioRequestOptions = {}
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
        // wins on conflict.
        const headers: Record<string, string> = {
          ...(options.extraHeaders ?? {}),
          authorization: `Bearer ${this.apiKey}`,
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

        if (res.status === 401 || res.status === 403) {
          const body = await safeReadText(res);
          throw new ZernioAuthError(
            `Zernio auth failed (HTTP ${res.status}) for ${url}: ${body.slice(0, 300)}`
          );
        }

        if (res.status === 429) {
          const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
          if (options.noRetryOnRateLimit || attempt === this.maxAttempts) {
            throw new ZernioRateLimitError(url, retryAfter);
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
            throw new ZernioApiError(res.status, url, body);
          }
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }

        if (!res.ok) {
          const body = await safeReadText(res);
          throw new ZernioApiError(res.status, url, body);
        }

        const text = await res.text();
        if (!text) {
          return undefined as T;
        }
        return JSON.parse(text) as T;
      } catch (err) {
        clearTimeout(timer);
        if (
          err instanceof ZernioApiError ||
          err instanceof ZernioAuthError ||
          err instanceof ZernioRateLimitError
        ) {
          throw err;
        }
        if (isAbortError(err)) {
          if (attempt === this.maxAttempts) {
            throw new ZernioTimeoutError(url, timeoutMs);
          }
          lastErr = new ZernioTimeoutError(url, timeoutMs);
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }
        // Network error (TypeError on fetch in V8) — retry.
        lastErr = err;
        if (attempt === this.maxAttempts) {
          throw err;
        }
        await this.sleep(this.computeBackoff(attempt));
      }
    }
    throw (
      lastErr ??
      new ZernioApiError(
        0,
        url,
        "ZernioClient: exhausted retries with no error"
      )
    );
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

/* -------------------------------------------------------------------------- */
/* Webhook signature verification                                              */
/* -------------------------------------------------------------------------- */

/**
 * Verify a Zernio webhook delivery's HMAC-SHA256 signature.
 *
 * Zernio sends `X-Late-Signature: <hex>` where `<hex>` is the lowercase
 * hex-encoded HMAC-SHA256 of the raw request body using the per-webhook
 * `secret` configured by the operator at webhook creation time.
 * (https://docs.getlate.dev/core/webhooks)
 *
 * Signature comparison is constant-time to defeat timing attacks.
 *
 * Returns `true` iff the provided signature matches the computed digest.
 * Returns `false` on missing / malformed / mismatched signatures — caller
 * MUST treat false as a hard reject (HTTP 401), never log+forward.
 */
export async function verifyZernioSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): Promise<boolean> {
  if (!signatureHeader || signatureHeader.length === 0) return false;
  if (!secret || secret.length === 0) return false;

  // Some signature schemes prefix with `sha256=` — Zernio's docs show a bare
  // hex string but we accept the prefixed form too for forward-compat.
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length).toLowerCase()
    : signatureHeader.toLowerCase();

  // Hex-validate before doing crypto — non-hex chars are an immediate reject.
  if (!/^[0-9a-f]+$/.test(provided)) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = bufferToHex(new Uint8Array(digest));
  return constantTimeEqual(provided, expected);
}

function bufferToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * SHA-256 hex of a string. Used to derive `apiKeyHash` for inbound webhook
 * routing without decrypting the API key blob.
 */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return bufferToHex(new Uint8Array(buf));
}
