/**
 * Nango client — managed-OAuth aggregator for the service-product CRMs.
 *
 * Wave C (Sprint 4-5). Nango (https://docs.nango.dev) handles the OAuth dance
 * + token refresh + a normalized proxy API for Jobber + HCP. We do not store
 * provider tokens directly — Nango holds them; we hold a per-business
 * `connectionId` and call Nango's proxy endpoints with that.
 *
 * Why Nango (operator decision 2026-04-27, locked in
 * `session_handoff_wave_b_complete_2026_04_27.md`):
 *   - One vendor for both Jobber and HCP OAuth lifecycle.
 *   - Token refresh is fully managed (we never see refresh tokens).
 *   - Webhook signature verification with a per-environment shared secret.
 *
 * What this module owns:
 *   - HTTP transport against Nango's REST API (auth, init, callback, proxy).
 *   - Webhook signature verification (HMAC-SHA256 over raw body).
 *   - Connection-scoped `proxy` requests (Nango injects bearer tokens).
 *   - Typed error class hierarchy distinguishing auth/rate/upstream failures.
 *
 * What this module does NOT own:
 *   - Per-CRM payload schema (lives in `jobber.ts` / `housecallpro.ts`).
 *   - Convex DB writes (those happen in `convex/jobs.ts`).
 *   - HTTP-route surface (lives in `convex/webhooks/crm.ts`).
 *
 * Cross-tenant safety: every call carries a `connectionId` that maps 1:1 to
 * a `crmConnections` row. Nango namespaces tokens per `connectionId`, so a
 * Business A request with B's connectionId is rejected by Nango.
 *
 * Plan-tier: enforced upstream (action layer); Nango calls are not
 * plan-aware.
 */

const DEFAULT_NANGO_HOST = "https://api.nango.dev";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 500;

/** Webhook signature header per Nango docs. */
export const NANGO_SIGNATURE_HEADER = "x-nango-signature";

/* -------------------------------------------------------------------------- */
/* Error classes                                                               */
/* -------------------------------------------------------------------------- */

export class NangoAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NangoAuthError";
  }
}

export class NangoApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(`Nango HTTP ${status} for ${url}: ${body.slice(0, 300)}`);
    this.name = "NangoApiError";
  }
}

export class NangoRateLimitError extends Error {
  constructor(
    public readonly url: string,
    public readonly retryAfterSec: number | null
  ) {
    super(`Nango rate-limited ${url} (retry-after=${retryAfterSec ?? "n/a"})`);
    this.name = "NangoRateLimitError";
  }
}

export class NangoTimeoutError extends Error {
  constructor(
    public readonly url: string,
    public readonly timeoutMs: number
  ) {
    super(`Nango request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "NangoTimeoutError";
  }
}

/* -------------------------------------------------------------------------- */
/* Client config                                                               */
/* -------------------------------------------------------------------------- */

export interface NangoClientOptions {
  /** Nango environment secret key (Bearer). */
  secretKey: string;
  /** Nango public key (used by the FE Connect SDK; we only need it for OAuth init mirror). */
  publicKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  /** Test seam — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface NangoProxyOptions {
  /** Per-business Nango connection id (1:1 with `crmConnections.businessId`). */
  connectionId: string;
  /** Provider config key (e.g. "jobber", "housecallpro"). */
  providerConfigKey: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path on the upstream provider API (Nango proxies). */
  endpoint: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Extra headers Nango will forward to the provider. */
  providerHeaders?: Record<string, string>;
  timeoutMs?: number;
}

export interface NangoConnection {
  connectionId: string;
  providerConfigKey: string;
  /** Nango's metadata blob — opaque to us, but we read scopes if present. */
  metadata?: Record<string, unknown>;
  /** Tokens are NEVER returned by /connection — only proxy can use them. */
  credentials?: {
    type?: string;
    raw?: Record<string, unknown>;
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const asInt = parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.max(0, Math.round((asDate - Date.now()) / 1000));
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
/* Nango client                                                                */
/* -------------------------------------------------------------------------- */

export class NangoClient {
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: NangoClientOptions) {
    if (!options.secretKey || options.secretKey.length === 0) {
      throw new NangoAuthError(
        "NangoClient: secretKey is required. Set NANGO_SECRET_KEY in the Convex env."
      );
    }
    this.secretKey = options.secretKey;
    this.baseUrl =
      options.baseUrl ?? process.env.NANGO_BASE_URL ?? DEFAULT_NANGO_HOST;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  /**
   * Fetch a connection by id — used to verify the connection still exists +
   * read its provider metadata (scopes, etc.). Tokens are NEVER exposed.
   */
  async getConnection(args: {
    connectionId: string;
    providerConfigKey: string;
  }): Promise<NangoConnection> {
    const path = `/connection/${encodeURIComponent(args.connectionId)}`;
    return await this.requestRaw<NangoConnection>({
      method: "GET",
      path,
      query: { provider_config_key: args.providerConfigKey },
    });
  }

  /**
   * Delete a Nango connection (operator-initiated revoke). Idempotent — Nango
   * returns 204 on first delete and 404 on subsequent calls; we treat both as
   * success.
   */
  async deleteConnection(args: {
    connectionId: string;
    providerConfigKey: string;
  }): Promise<{ deleted: boolean }> {
    const path = `/connection/${encodeURIComponent(args.connectionId)}`;
    try {
      await this.requestRaw<unknown>({
        method: "DELETE",
        path,
        query: { provider_config_key: args.providerConfigKey },
        expectEmptyBody: true,
      });
      return { deleted: true };
    } catch (err) {
      if (err instanceof NangoApiError && err.status === 404) {
        return { deleted: false };
      }
      throw err;
    }
  }

  /**
   * Proxy a request through Nango to the upstream provider. Nango injects
   * the bearer/refresh token. Per Nango docs, the proxy endpoint path is
   * `/proxy/<endpoint>` and the provider+connection is selected via headers.
   */
  async proxy<T = unknown>(opts: NangoProxyOptions): Promise<T> {
    const endpoint = opts.endpoint.startsWith("/")
      ? opts.endpoint
      : `/${opts.endpoint}`;
    const path = `/proxy${endpoint}`;
    return await this.requestRaw<T>({
      method: opts.method ?? "GET",
      path,
      query: opts.query,
      body: opts.body,
      timeoutMs: opts.timeoutMs,
      extraHeaders: {
        "connection-id": opts.connectionId,
        "provider-config-key": opts.providerConfigKey,
        ...(opts.providerHeaders ?? {}),
      },
    });
  }

  /**
   * Low-level transport shared by `getConnection` / `deleteConnection` /
   * `proxy`. Honors retry semantics + timeout.
   */
  private async requestRaw<T>(opts: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    timeoutMs?: number;
    extraHeaders?: Record<string, string>;
    expectEmptyBody?: boolean;
  }): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Auth + content-type are owned by us; extra headers cannot override.
        const headers: Record<string, string> = {
          ...(opts.extraHeaders ?? {}),
          authorization: `Bearer ${this.secretKey}`,
          accept: "application/json",
        };
        if (opts.body !== undefined) {
          headers["content-type"] = "application/json";
        }
        const res = await this.fetchImpl(url, {
          method: opts.method,
          headers,
          body:
            opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 401 || res.status === 403) {
          const body = await safeReadText(res);
          throw new NangoAuthError(
            `Nango auth failed (HTTP ${res.status}) for ${url}: ${body.slice(0, 300)}`
          );
        }

        if (res.status === 429) {
          const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
          if (attempt === this.maxAttempts) {
            throw new NangoRateLimitError(url, retryAfter);
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
            throw new NangoApiError(res.status, url, body);
          }
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }

        if (!res.ok) {
          const body = await safeReadText(res);
          throw new NangoApiError(res.status, url, body);
        }

        if (opts.expectEmptyBody) {
          return undefined as T;
        }
        const text = await res.text();
        if (!text) return undefined as T;
        return JSON.parse(text) as T;
      } catch (err) {
        clearTimeout(timer);
        if (
          err instanceof NangoApiError ||
          err instanceof NangoAuthError ||
          err instanceof NangoRateLimitError
        ) {
          throw err;
        }
        if (isAbortError(err)) {
          if (attempt === this.maxAttempts) {
            throw new NangoTimeoutError(url, timeoutMs);
          }
          lastErr = new NangoTimeoutError(url, timeoutMs);
          await this.sleep(this.computeBackoff(attempt));
          continue;
        }
        // Network error — retry.
        lastErr = err;
        if (attempt === this.maxAttempts) throw err;
        await this.sleep(this.computeBackoff(attempt));
      }
    }
    throw (
      lastErr ??
      new NangoApiError(0, url, "NangoClient: exhausted retries with no error")
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
      for (const [k, val] of Object.entries(query)) {
        if (val === undefined) continue;
        url.searchParams.set(k, String(val));
      }
    }
    return url.toString();
  }

  /** Exponential backoff with full-jitter — same shape as zernio client. */
  private computeBackoff(attempt: number): number {
    const ceiling = this.baseBackoffMs * Math.pow(2, attempt - 1);
    return Math.floor(this.random() * ceiling);
  }
}

/* -------------------------------------------------------------------------- */
/* OAuth init / finalize helpers                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build the Nango Connect-flow URL the frontend redirects to. Nango hosts the
 * OAuth dance; on completion they redirect back to the configured callback URL
 * (configured per-provider in the Nango dashboard). The `connectionId` is the
 * stable per-business identifier we want Nango to namespace under.
 */
export function buildNangoConnectUrl(args: {
  publicKey: string;
  providerConfigKey: string;
  connectionId: string;
  baseHost?: string;
}): string {
  const host = args.baseHost ?? DEFAULT_NANGO_HOST;
  const url = new URL(`${host}/oauth/connect/${args.providerConfigKey}`);
  url.searchParams.set("public_key", args.publicKey);
  url.searchParams.set("connection_id", args.connectionId);
  return url.toString();
}

/**
 * Generate a new connectionId for a freshly-connecting business. We use
 * `${providerConfigKey}_${businessId}_${rand6}` so a re-connect attempt with
 * a fresh row doesn't collide with the prior tokenset.
 */
export function generateNangoConnectionId(
  providerConfigKey: string,
  businessId: string,
  randomFn: () => number = Math.random
): string {
  const rand = Math.floor(randomFn() * 1_000_000)
    .toString(36)
    .padStart(4, "0");
  return `${providerConfigKey}_${businessId}_${rand}`;
}

/* -------------------------------------------------------------------------- */
/* Webhook signature verification                                              */
/* -------------------------------------------------------------------------- */

/**
 * Verify a Nango webhook delivery's HMAC-SHA256 signature.
 *
 * Per Nango docs (https://docs.nango.dev/guides/webhooks/webhooks-from-nango),
 * the `X-Nango-Signature` header carries the lowercase hex HMAC-SHA256 of the
 * raw body using the per-environment `NANGO_WEBHOOK_SECRET`.
 *
 * Comparison is constant-time. Returns `false` on missing / malformed /
 * mismatched signatures — caller MUST treat false as a hard reject (HTTP 401).
 */
export async function verifyNangoSignature(
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
/* Webhook envelope shape (shared across Jobber + HCP via Nango)               */
/* -------------------------------------------------------------------------- */

/**
 * Nango's standard webhook envelope (https://docs.nango.dev/guides/webhooks).
 * Both Jobber + HCP deliveries wrap inside this shape.
 */
export interface NangoWebhookEnvelope {
  /** Stable event id — used for replay defense. */
  eventId: string;
  /** Event kind: "auth", "sync", "forward" (provider event passthrough). */
  type: "auth" | "sync" | "forward";
  /** Provider config key (e.g. "jobber", "housecallpro"). */
  providerConfigKey: string;
  /** Per-business connection id. */
  connectionId: string;
  /** Original provider event payload — only present on `forward` type. */
  payload?: Record<string, unknown>;
  /** Provider-side event name when forwarded ("JOB_COMPLETE", etc.). */
  providerEventName?: string;
  /** Timestamp (epoch ms) Nango received the upstream delivery. */
  receivedAt?: number;
}

/**
 * Parse a raw JSON object into our normalized envelope. Returns null if the
 * payload is missing the required identifying fields. Defensive against
 * adversarial inputs because the webhook route calls this AFTER signature
 * verification but BEFORE Convex arg validation.
 */
export function parseNangoWebhookEnvelope(
  raw: unknown
): NangoWebhookEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const eventId =
    typeof obj.id === "string"
      ? obj.id
      : typeof obj.eventId === "string"
        ? obj.eventId
        : undefined;
  const typeRaw = typeof obj.type === "string" ? obj.type : undefined;
  const allowedTypes = new Set(["auth", "sync", "forward"]);
  if (!eventId || !typeRaw || !allowedTypes.has(typeRaw)) return null;
  const providerConfigKey =
    typeof obj.providerConfigKey === "string"
      ? obj.providerConfigKey
      : typeof obj.provider_config_key === "string"
        ? obj.provider_config_key
        : undefined;
  const connectionId =
    typeof obj.connectionId === "string"
      ? obj.connectionId
      : typeof obj.connection_id === "string"
        ? obj.connection_id
        : undefined;
  if (!providerConfigKey || !connectionId) return null;
  const payload =
    obj.payload && typeof obj.payload === "object"
      ? (obj.payload as Record<string, unknown>)
      : undefined;
  const providerEventName =
    typeof obj.providerEventName === "string"
      ? obj.providerEventName
      : typeof obj.provider_event_name === "string"
        ? obj.provider_event_name
        : undefined;
  let receivedAt: number | undefined;
  const rawTs = obj.receivedAt ?? obj.received_at ?? obj.timestamp;
  if (typeof rawTs === "number" && Number.isFinite(rawTs)) {
    receivedAt = rawTs;
  } else if (typeof rawTs === "string") {
    const parsed = Date.parse(rawTs);
    if (Number.isFinite(parsed)) receivedAt = parsed;
  }
  return {
    eventId,
    type: typeRaw as NangoWebhookEnvelope["type"],
    providerConfigKey,
    connectionId,
    payload,
    providerEventName,
    receivedAt,
  };
}
