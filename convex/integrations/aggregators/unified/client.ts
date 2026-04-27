/**
 * Unified.to HTTP client — accounting domain (QuickBooks Online connector).
 *
 * Sprint 5 (service product). Mirrors the design of
 * `convex/integrations/zernio/client.ts` for consistency:
 *   - Bearer auth via workspace API key (operator long-lead: create Pro
 *     workspace, set `UNIFIED_API_KEY` in Convex env).
 *   - Connection-scoped requests carry the `connection_id` in the path
 *     (Unified's REST shape: `/accounting/{connection_id}/customer`).
 *   - HMAC-SHA256 webhook signature verification (header
 *     `x-unified-signature`, hex digest of raw body).
 *   - Retry-with-backoff on 5xx/429/network with full-jitter; never on 4xx
 *     (other than 429) — those are caller bugs.
 *   - Typed error class hierarchy from `./types`.
 *   - Distinguishes token-expired (recoverable, prompts refresh) from
 *     auth-revoked (terminal, prompts re-OAuth).
 *
 * Why fetch + manual transport (not Unified's SDK):
 *   - Convex runs on V8 isolate. Some SDKs ship Node polyfills that don't
 *     load on Edge. Direct HTTP keeps the surface narrow.
 *   - Aggregator-isolation contract: the implementation behind
 *     `convex/integrations/crm/quickbooks.ts` must be swappable from
 *     Unified to Apideck under interface isolation in <1 week if Unified's
 *     QBO mapping turns out to mismatch on live-smoke.
 */

import {
  UnifiedApiError,
  UnifiedAuthError,
  UnifiedRateLimitError,
  UnifiedTimeoutError,
  UnifiedTokenExpiredError,
} from "./types";

const DEFAULT_BASE_URL = "https://api.unified.to";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 500;

export interface UnifiedClientOptions {
  /** Workspace API key (Bearer). Required. */
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface UnifiedRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  noRetryOnRateLimit?: boolean;
  /**
   * Extra headers. Authorization + content-type are owned by the client and
   * cannot be overridden — fail-closed against caller swapping auth.
   */
  extraHeaders?: Record<string, string>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class UnifiedClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: UnifiedClientOptions) {
    if (!options.apiKey || options.apiKey.length === 0) {
      throw new UnifiedAuthError(
        "UnifiedClient: apiKey is required. Set UNIFIED_API_KEY in Convex env."
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl =
      options.baseUrl ?? process.env.UNIFIED_BASE_URL ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  async request<T = unknown>(
    path: string,
    options: UnifiedRequestOptions = {}
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
            options.body !== undefined
              ? JSON.stringify(options.body)
              : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 401) {
          // Token-expired vs auth-revoked. Unified surfaces a distinct error
          // body for "TOKEN_EXPIRED" inside its 401 — we sniff the body to
          // distinguish so callers can handle the recoverable case. If we
          // can't read the body or the marker is absent, fall through to a
          // hard auth error (caller treats as terminal + prompts re-OAuth).
          const body = await safeReadText(res);
          if (/token[_ -]?expired|expired[_ -]?token/i.test(body)) {
            throw new UnifiedTokenExpiredError(url);
          }
          throw new UnifiedAuthError(
            `Unified.to auth failed (401) for ${url}: ${body.slice(0, 300)}`
          );
        }
        if (res.status === 403) {
          const body = await safeReadText(res);
          throw new UnifiedAuthError(
            `Unified.to forbidden (403) for ${url}: ${body.slice(0, 300)}`
          );
        }

        if (res.status === 429) {
          const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
          if (options.noRetryOnRateLimit || attempt === this.maxAttempts) {
            throw new UnifiedRateLimitError(url, retryAfter);
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
            throw new UnifiedApiError(res.status, url, body);
          }
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }

        if (!res.ok) {
          const body = await safeReadText(res);
          throw new UnifiedApiError(res.status, url, body);
        }

        const text = await res.text();
        if (!text) {
          return undefined as T;
        }
        return JSON.parse(text) as T;
      } catch (err) {
        clearTimeout(timer);
        if (
          err instanceof UnifiedApiError ||
          err instanceof UnifiedAuthError ||
          err instanceof UnifiedRateLimitError
        ) {
          throw err;
        }
        if (isAbortError(err)) {
          if (attempt === this.maxAttempts) {
            throw new UnifiedTimeoutError(url, timeoutMs);
          }
          lastErr = new UnifiedTimeoutError(url, timeoutMs);
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }
        lastErr = err;
        if (attempt === this.maxAttempts) {
          throw err;
        }
        await this.sleep(this.computeBackoff(attempt));
      }
    }
    throw (
      lastErr ??
      new UnifiedApiError(
        0,
        url,
        "UnifiedClient: exhausted retries with no error"
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
/* OAuth flow helpers — Unified's hosted-auth pattern                          */
/* -------------------------------------------------------------------------- */

/**
 * Request a hosted-auth URL for a new QBO connection.
 *
 * Unified hosts the OAuth dance: we POST to `/unified/integration/auth/{token}`
 * with provider + redirect, get back a hosted URL, redirect the operator's
 * browser, and Unified completes the flow + creates a `connection_id` we read
 * via `getConnection`.
 *
 * [unverified — exact endpoint shape; live-smoke confirms.]
 */
export async function startConnectionAuth(
  client: UnifiedClient,
  args: {
    provider: string;
    workspaceId: string;
    redirectUri: string;
    /** Free-form metadata Unified echoes back at callback. We pass businessId. */
    state?: Record<string, string>;
  }
): Promise<{ authUrl: string }> {
  const res = await client.request<{
    redirect_url?: string;
    authUrl?: string;
    url?: string;
  }>(`/unified/integration/auth/${encodeURIComponent(args.workspaceId)}`, {
    method: "POST",
    body: {
      provider: args.provider,
      redirect_uri: args.redirectUri,
      state: args.state,
    },
  });
  const authUrl = res.redirect_url ?? res.authUrl ?? res.url;
  if (!authUrl) {
    throw new UnifiedApiError(
      200,
      "/unified/integration/auth",
      "Unified did not return a hosted auth URL."
    );
  }
  return { authUrl };
}

/**
 * Read connection metadata (existence, last refresh, is_active). Used by the
 * webhook receiver to confirm a connection is still active before dispatching
 * an event, and by the QBO action layer to detect a stale connection before
 * making expensive entity reads.
 */
export async function getConnection(
  client: UnifiedClient,
  connectionId: string
): Promise<{
  id: string;
  provider: string;
  is_active?: boolean;
  refreshed_at?: string;
}> {
  return await client.request<{
    id: string;
    provider: string;
    is_active?: boolean;
    refreshed_at?: string;
  }>(`/unified/connection/${encodeURIComponent(connectionId)}`);
}

/* -------------------------------------------------------------------------- */
/* Webhook signature verification                                              */
/* -------------------------------------------------------------------------- */

/**
 * Verify Unified.to's `x-unified-signature` HMAC-SHA256 webhook signature.
 *
 * The signature is the hex-encoded HMAC-SHA256 of the raw request body using
 * the per-workspace webhook secret. Constant-time compare to defeat timing
 * attacks. Returns false on missing/malformed/mismatched signatures — caller
 * MUST treat false as a hard 401 reject.
 */
export async function verifyUnifiedSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): Promise<boolean> {
  if (!signatureHeader || signatureHeader.length === 0) return false;
  if (!secret || secret.length === 0) return false;

  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length).toLowerCase()
    : signatureHeader.toLowerCase();

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

/* -------------------------------------------------------------------------- */
/* Convenience: the env keys an operator must set                              */
/* -------------------------------------------------------------------------- */

export const UNIFIED_API_KEY_ENV = "UNIFIED_API_KEY";
export const UNIFIED_WORKSPACE_ID_ENV = "UNIFIED_WORKSPACE_ID";
export const UNIFIED_WEBHOOK_SECRET_ENV = "UNIFIED_WEBHOOK_SECRET";

export function readUnifiedApiKey(): string {
  const v = process.env[UNIFIED_API_KEY_ENV];
  if (!v) {
    throw new UnifiedAuthError(
      `Unified.to: ${UNIFIED_API_KEY_ENV} is not set. Operator must create ` +
        "a Unified.to Pro workspace, copy the workspace API key, and set it " +
        "in the Convex deployment env."
    );
  }
  return v;
}

export function readUnifiedWorkspaceId(): string {
  const v = process.env[UNIFIED_WORKSPACE_ID_ENV];
  if (!v) {
    throw new UnifiedAuthError(
      `Unified.to: ${UNIFIED_WORKSPACE_ID_ENV} is not set. Set the workspace ` +
        "id from the Unified.to dashboard."
    );
  }
  return v;
}
