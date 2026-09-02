/**
 * Zernio, the read half (plan §6 Sprint 4, §12 own-account connections). One
 * transport (bearer, retry on 429/5xx, timeouts), the endpoints a connection needs
 * (profile, connect URL, accounts, health, analytics, follower stats, delete account
 * and profile, webhook subscription) and the HMAC verifier. Adapted from the legacy
 * integration (salvage verdict ADAPT) with the 2026-06-07 bugs in mind: the webhook
 * is the authoritative path, the per-creator profile id is persisted, and accounts
 * never land on the Default profile. Publishing is deliberately absent.
 */

const DEFAULT_BASE_URL = "https://zernio.com";
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

export class ZernioError extends Error {
  constructor(public readonly status: number, public readonly url: string, public readonly body: string) {
    super(`Zernio ${status} on ${url}: ${body.slice(0, 200)}`);
    this.name = "ZernioError";
  }
}

export interface ZernioClient {
  request<T = unknown>(path: string, opts?: { method?: "GET" | "POST" | "DELETE"; query?: Record<string, string | number | boolean | undefined>; body?: unknown }): Promise<T>;
}

export function zernioClient(apiKey: string, fetchImpl: typeof fetch = fetch, baseUrl = process.env.ZERNIO_BASE_URL ?? DEFAULT_BASE_URL): ZernioClient {
  if (!apiKey) throw new ZernioError(0, baseUrl, "ZERNIO_API_KEY is not set");
  return {
    async request<T>(path: string, opts: { method?: "GET" | "POST" | "DELETE"; query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {}): Promise<T> {
      const url = new URL(path, baseUrl);
      for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
      let last: unknown = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const res = await fetchImpl(url.toString(), { method: opts.method ?? "GET", headers: { authorization: `Bearer ${apiKey}`, accept: "application/json", ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: controller.signal });
          clearTimeout(timer);
          if (res.status === 429 || res.status >= 500) {
            const text = await res.text().catch(() => "");
            if (attempt === MAX_ATTEMPTS) throw new ZernioError(res.status, url.toString(), text);
            const retryAfter = Number(res.headers.get("retry-after"));
            await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1)));
            continue;
          }
          if (!res.ok) throw new ZernioError(res.status, url.toString(), await res.text().catch(() => ""));
          const text = await res.text();
          return (text ? JSON.parse(text) : undefined) as T;
        } catch (e) {
          clearTimeout(timer);
          if (e instanceof ZernioError) throw e;
          last = e;
          if (attempt === MAX_ATTEMPTS) throw e;
          await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
        }
      }
      throw last ?? new ZernioError(0, url.toString(), "exhausted");
    },
  };
}

export type ZernioPlatform = "tiktok" | "instagram";

export interface ZernioAccount { accountId: string; platform: string; username: string | null; needsReconnect: boolean; canFetchAnalytics: boolean; raw: Record<string, unknown> }

/** Rows come back with `accountId` (health) or `_id`/`id` (list); usernames under a few names. Normalise once. */
export function normalizeAccount(row: Record<string, unknown>, hasAnalyticsAccess?: boolean): ZernioAccount | null {
  const accountId = String(row.accountId ?? row._id ?? row.id ?? "");
  if (!accountId) return null;
  const platform = String(row.platform ?? "").toLowerCase();
  const status = String(row.status ?? row.health ?? "").toLowerCase();
  return {
    accountId,
    platform,
    username: (row.username ?? row.displayName ?? row.name ?? null) as string | null,
    needsReconnect: Boolean(row.needsReconnect) || status === "needs_reconnect" || status === "error" || status === "expired",
    canFetchAnalytics: hasAnalyticsAccess ?? Boolean(row.hasAnalyticsAccess ?? row.canFetchAnalytics ?? true),
    raw: row,
  };
}

export async function createProfile(c: ZernioClient, name: string): Promise<{ id: string }> {
  const raw = await c.request<{ profile?: { _id?: string; id?: string } }>("/api/v1/profiles", { method: "POST", body: { name, description: "Maya creator" } });
  const id = raw?.profile?._id ?? raw?.profile?.id;
  if (!id) throw new ZernioError(200, "/api/v1/profiles", "no profile id in response");
  return { id };
}

/** OAuth kickoff. `x` maps to `twitter` on the wire (verified live in the old product); tiktok and instagram are themselves. */
export async function connectUrl(c: ZernioClient, platform: ZernioPlatform, profileId: string, redirectUrl: string): Promise<{ authUrl: string; state: string }> {
  const raw = await c.request<{ authUrl?: string; state?: string }>(`/api/v1/connect/${platform}`, { query: { profileId, redirect_url: redirectUrl } });
  if (!raw?.authUrl) throw new ZernioError(200, `/api/v1/connect/${platform}`, "no authUrl in response");
  return { authUrl: raw.authUrl, state: raw.state ?? "" };
}

export async function listAccounts(c: ZernioClient, profileId: string): Promise<ZernioAccount[]> {
  const raw = await c.request<{ accounts?: Array<Record<string, unknown>>; hasAnalyticsAccess?: boolean } | Array<Record<string, unknown>>>("/api/v1/accounts", { query: { profileId, limit: 50 } });
  const rows = Array.isArray(raw) ? raw : (raw?.accounts ?? []);
  const access = Array.isArray(raw) ? undefined : raw?.hasAnalyticsAccess;
  return rows.map((r) => normalizeAccount(r, access)).filter((x): x is ZernioAccount => x !== null);
}

export async function accountsHealth(c: ZernioClient, profileId: string): Promise<{ summary: Record<string, number>; accounts: ZernioAccount[] }> {
  const raw = await c.request<{ summary?: Record<string, number>; accounts?: Array<Record<string, unknown>> }>("/api/v1/accounts/health", { query: { profileId } });
  return { summary: raw?.summary ?? {}, accounts: (raw?.accounts ?? []).map((r) => normalizeAccount(r)).filter((x): x is ZernioAccount => x !== null) };
}

export async function deleteAccount(c: ZernioClient, accountId: string): Promise<void> {
  await c.request(`/api/v1/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" });
}

/** 400 while any account remains (§16.5 step 3): the caller deletes accounts first and retries. */
export async function deleteProfile(c: ZernioClient, profileId: string): Promise<void> {
  await c.request(`/api/v1/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" });
}

export async function postAnalytics(c: ZernioClient, args: { profileId?: string; accountId?: string; platform?: string; fromDate?: string; toDate?: string; limit?: number }): Promise<unknown> {
  return await c.request("/api/v1/analytics", { query: { ...args } });
}

export async function followerStats(c: ZernioClient, accountIds: string[], profileId?: string): Promise<unknown> {
  return await c.request("/api/v1/accounts/follower-stats", { query: { accountIds: accountIds.join(","), profileId } });
}

/** The events we care about for connections; publishing events are not subscribed. */
export const CONNECTION_EVENTS = ["account.connected", "account.disconnected"] as const;

export async function subscribeWebhook(c: ZernioClient, args: { name: string; url: string; secret: string; events?: string[] }): Promise<{ id: string }> {
  const raw = await c.request<{ _id?: string; id?: string }>("/api/v1/webhooks/settings", { method: "POST", body: { name: args.name, url: args.url, events: args.events ?? [...CONNECTION_EVENTS], secret: args.secret, isActive: true } });
  return { id: raw?._id ?? raw?.id ?? "" };
}

export const ZERNIO_SIGNATURE_HEADER = "x-zernio-signature";

/** HMAC-SHA256 over the raw body, hex, compared in constant time. The header may carry a `sha256=` prefix. */
export async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.replace(/^sha256=/i, "").trim().toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
