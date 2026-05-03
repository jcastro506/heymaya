/**
 * Twilio HTTP client.
 *
 * UN-PARKED Wave D (service plan § 13 Sprint 6) — voice agent re-activates
 * this client to configure the Voice webhook on the operator's already-
 * provisioned Twilio number. Number provisioning itself stays parked at
 * `provisionNumber.ts` (operator provisions out-of-band; OpenClaw owns
 * channel pairing per `feedback_openclaw_native_first.md`). What we do
 * actively use:
 *   - `configureWebhooks.ts` POSTs to `IncomingPhoneNumbers/{sid}` to
 *     point the operator's Voice URL at the Fly machine's voice-call
 *     plugin endpoint.
 *
 * Sprint 2 (service product). v0 surface: number provisioning + inbound
 * webhook configuration. We hit Twilio's REST API directly via `fetch` rather
 * than pulling in `twilio` npm — Convex runs on V8 isolate, the SDK ships a
 * Node-only HTTPS client + retries that don't load there cleanly, and the
 * surface we need (AvailablePhoneNumbers list + IncomingPhoneNumbers create)
 * is a 2-call shape that doesn't justify the polyfill burden.
 *
 * Why fetch + manual transport (mirrors zernio/client.ts rationale):
 *   - V8 isolate compatibility.
 *   - Interface-isolation: per § 13 Sprint 2, voice/SMS provider could swap
 *     to a different telephony in the future; owning HTTP keeps that <2 weeks.
 *
 * Error envelope mirrors zernio: typed class hierarchy so consumers can
 * branch on auth-failure (TwilioAuthError) vs no-numbers-available
 * (TwilioNoNumbersAvailableError) vs A2P-not-registered
 * (TwilioA2PNotRegisteredError) vs generic API failure (TwilioApiError).
 */

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 400;

export class TwilioApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly twilioCode: number | null,
    public readonly endpoint: string,
    message: string
  ) {
    super(message);
    this.name = "TwilioApiError";
  }
}

export class TwilioAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwilioAuthError";
  }
}

export class TwilioNoNumbersAvailableError extends Error {
  constructor(public readonly areaCode: string | null, message: string) {
    super(message);
    this.name = "TwilioNoNumbersAvailableError";
  }
}

export class TwilioA2PNotRegisteredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwilioA2PNotRegisteredError";
  }
}

export class TwilioTimeoutError extends Error {
  constructor(public readonly endpoint: string) {
    super(`Twilio request to ${endpoint} timed out.`);
    this.name = "TwilioTimeoutError";
  }
}

export interface TwilioClientOptions {
  /** Twilio Account SID — `TWILIO_ACCOUNT_SID` in production. */
  accountSid: string;
  /** Twilio auth token — `TWILIO_AUTH_TOKEN`. */
  authToken: string;
  /** Optional A2P 10DLC messaging-service SID. Required for SMS in production. */
  messagingServiceSid?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  /** Test seam — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface TwilioRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  /** Form-encoded body — Twilio's REST API takes application/x-www-form-urlencoded. */
  form?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

/**
 * Read Twilio creds from env. Throws a clear `TwilioAuthError` when missing.
 *
 * Operator-precondition: both `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` must
 * be set in Convex env. `TWILIO_MESSAGING_SERVICE_SID` is required in
 * production (A2P 10DLC); we surface its absence as a separate error so the
 * onboarding UI can render a specific operator message instead of a generic
 * auth fail.
 */
export function readTwilioConfigFromEnv(): TwilioClientOptions {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new TwilioAuthError(
      "Twilio: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN must be set in Convex env. " +
        "Operator-precondition: create a Twilio account, copy the credentials, " +
        "and configure both before running onboarding."
    );
  }
  return {
    accountSid,
    authToken,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function basicAuthHeader(accountSid: string, authToken: string): string {
  const raw = `${accountSid}:${authToken}`;
  // V8 isolate: btoa is latin-1-only, but Twilio creds are pure ASCII so this
  // is safe.
  return `Basic ${btoa(raw)}`;
}

function encodeForm(form: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(form)) {
    if (value === undefined) continue;
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    );
  }
  return parts.join("&");
}

export class TwilioClient {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly messagingServiceSid: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: TwilioClientOptions) {
    if (!options.accountSid) {
      throw new TwilioAuthError("Twilio: accountSid is required.");
    }
    if (!options.authToken) {
      throw new TwilioAuthError("Twilio: authToken is required.");
    }
    this.accountSid = options.accountSid;
    this.authToken = options.authToken;
    this.messagingServiceSid = options.messagingServiceSid;
    this.baseUrl = options.baseUrl ?? TWILIO_API_BASE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get sid(): string {
    return this.accountSid;
  }

  get messagingService(): string | undefined {
    return this.messagingServiceSid;
  }

  /**
   * Hit a Twilio REST endpoint scoped to the account. Path is RELATIVE — we
   * prepend `/Accounts/{sid}` for you.
   */
  async request<T>(
    path: string,
    options: TwilioRequestOptions = {}
  ): Promise<T> {
    const method = options.method ?? "GET";
    const fullPath = `/Accounts/${this.accountSid}${path}`;
    const url = new URL(`${this.baseUrl}${fullPath}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      Authorization: basicAuthHeader(this.accountSid, this.authToken),
      Accept: "application/json",
    };
    let body: string | undefined;
    if (options.form && (method === "POST" || method === "DELETE")) {
      body = encodeForm(options.form);
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer =
        controller !== null
          ? setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs)
          : null;
      try {
        const response = await this.fetchImpl(url.toString(), {
          method,
          headers,
          body,
          signal: controller?.signal,
        });
        if (timer) clearTimeout(timer);

        if (response.status === 401 || response.status === 403) {
          const text = await safeText(response);
          throw new TwilioAuthError(
            `Twilio rejected credentials (${response.status}): ${text.slice(0, 200)}`
          );
        }
        if (response.status >= 200 && response.status < 300) {
          if (response.status === 204) return {} as T;
          return (await response.json()) as T;
        }
        const text = await safeText(response);
        const twilioCode = extractTwilioCode(text);
        const retryable = response.status >= 500 && response.status < 600;
        const apiErr = new TwilioApiError(
          response.status,
          twilioCode,
          fullPath,
          `Twilio HTTP ${response.status}: ${text.slice(0, 400)}`
        );
        if (!retryable) throw apiErr;
        lastError = apiErr;
      } catch (err) {
        if (timer) clearTimeout(timer);
        if (err instanceof TwilioAuthError || err instanceof TwilioApiError) {
          if (err instanceof TwilioApiError) {
            const retryable = err.status >= 500 && err.status < 600;
            if (!retryable) throw err;
            lastError = err;
          } else {
            throw err;
          }
        } else if ((err as { name?: string }).name === "AbortError") {
          lastError = new TwilioTimeoutError(fullPath);
        } else {
          lastError = new TwilioApiError(
            0,
            null,
            fullPath,
            `Twilio network error: ${(err as Error).message}`
          );
        }
      }
      if (attempt < this.maxAttempts) {
        await this.sleep(this.baseBackoffMs * Math.pow(2, attempt - 1));
      }
    }
    throw (
      lastError ??
      new TwilioApiError(0, null, fullPath, "Twilio: exhausted retries.")
    );
  }
}

function extractTwilioCode(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as { code?: number };
    return typeof parsed.code === "number" ? parsed.code : null;
  } catch {
    return null;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
