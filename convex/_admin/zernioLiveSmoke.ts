/**
 * S1 — Zernio live-smoke de-risk harness (operator-run, 2026-06-02).
 *
 * This is THE GATE for the Maya v2 auto-post build. It proves the
 * `convex/integrations/zernio` scaffold works against the REAL
 * `https://zernio.com/api/v1` with the confirmed `sk_` key BEFORE any
 * UI / schema / route is built on top of it.
 *
 * It deliberately makes RAW `client.request` calls with the DOCUMENTED live
 * body shapes (NOT the existing endpoints.ts wrappers, whose request/response
 * shapes are still `[unverified]` and pre-date the getlate.dev->zernio.com
 * rebrand). The whole point is to OBSERVE what the live API actually returns,
 * then fix every divergence in endpoints.ts/types.ts.
 *
 * Interactive flow (operator taps an OAuth link mid-way), so it is split into
 * ordered steps run from the CLI:
 *
 *   1. step1_createProfileAndConnectUrl '{"platform":"x"}'
 *        -> creates the founder's Zernio profile, returns {profileId, connectUrl}.
 *        OPERATOR taps connectUrl, completes OAuth for a throwaway X account.
 *   2. step2_listAccounts '{"profileId":"<id>"}'
 *        -> confirms the X account connected; returns the zernio accountId.
 *   3. step3_publishNow '{"profileId":"<id>","accountId":"<acct>","text":"...","url":"https://..."}'
 *        -> publishes a real text post carrying a wrapped URL (records the real
 *           $0.20-with-URL X charge). Returns the raw post response + postId.
 *   4. step4_getAnalytics '{"profileId":"<id>","postId":"<id>"}'
 *   5. step5_getHealth '{"profileId":"<id>"}'
 *   6. step6_scheduleProbe '{"profileId":"<id>","accountId":"<acct>","text":"...","scheduledForIso":"...","timezone":"America/New_York"}'
 *        -> verifies Zernio-side scheduling (scheduledFor) reliability.
 *
 * Every step returns the RAW response envelope { ok, httpStatus?, raw, error? }
 * so shapes can be read straight from the CLI output. Nothing here writes to
 * Convex tables — it is pure observation.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { ZernioClient } from "../integrations/zernio/client";
import {
  ZernioApiError,
  ZernioAuthError,
  ZernioRateLimitError,
  ZernioTimeoutError,
} from "../integrations/zernio/types";

interface SmokeResult {
  ok: boolean;
  step: string;
  request?: unknown;
  raw?: unknown;
  errorKind?: string;
  error?: string;
}

function makeClient(): ZernioClient {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ZERNIO_API_KEY is not set on this deployment. Set it before running the S1 smoke."
    );
  }
  // Allow ZERNIO_BASE_URL override; default is https://zernio.com (host only —
  // endpoints prepend /api/v1). Generous timeout for the live round-trip.
  return new ZernioClient({ apiKey, timeoutMs: 45_000 });
}

/** Run a raw request and normalize success/error into a SmokeResult. */
async function probe(
  step: string,
  request: unknown,
  fn: () => Promise<unknown>
): Promise<SmokeResult> {
  try {
    const raw = await fn();
    return { ok: true, step, request, raw };
  } catch (err) {
    let errorKind = "unknown";
    if (err instanceof ZernioAuthError) errorKind = "auth";
    else if (err instanceof ZernioRateLimitError) errorKind = "rate-limit";
    else if (err instanceof ZernioTimeoutError) errorKind = "timeout";
    else if (err instanceof ZernioApiError) errorKind = `api(${err.status})`;
    return {
      ok: false,
      step,
      request,
      errorKind,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Step 1 — create a profile + mint the connect URL for the chosen platform.   */
/* -------------------------------------------------------------------------- */

export const step1_createProfileAndConnectUrl = internalAction({
  args: {
    platform: v.string(),
    profileName: v.optional(v.string()),
    redirectUrl: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<{ profile: SmokeResult; connect: SmokeResult }> => {
    const client = makeClient();

    // POST /api/v1/profiles  — documented body shape (verify live).
    const profileBody = {
      name: args.profileName ?? "Maya S1 smoke profile",
      description: "S1 live-smoke de-risk (delete after).",
    };
    const profile = await probe("createProfile", profileBody, () =>
      client.request("/api/v1/profiles", { method: "POST", body: profileBody })
    );

    // Try to extract the profileId from whatever shape came back.
    const profileId = extractId(profile.raw, ["_id", "id", "profileId"]);

    // GET /api/v1/connect/{platform}?profileId&redirect_url
    const connectQuery: Record<string, string> = {};
    if (profileId) connectQuery.profileId = profileId;
    if (args.redirectUrl) connectQuery.redirect_url = args.redirectUrl;
    const connect = await probe(
      `connect:${args.platform}`,
      { path: `/api/v1/connect/${args.platform}`, query: connectQuery },
      () =>
        client.request(`/api/v1/connect/${args.platform}`, {
          method: "GET",
          query: connectQuery,
        })
    );

    return { profile, connect };
  },
});

/**
 * Standalone connect-URL probe against an EXISTING profile (no new profile
 * created). Use this once step1 has minted a profileId you want to reuse.
 *
 * Live finding (2026-06-02): the X platform slug is `twitter` (not `x`), and
 * `profileId` is a REQUIRED query param. PLATFORM_SLUG maps our internal
 * platform names to Zernio's connect slugs.
 */
const PLATFORM_SLUG: Record<string, string> = {
  x: "twitter",
  twitter: "twitter",
  reddit: "reddit",
  linkedin: "linkedin",
  instagram: "instagram",
  tiktok: "tiktok",
  youtube: "youtube",
};

export const stepConnectUrl = internalAction({
  args: {
    profileId: v.string(),
    platform: v.string(),
    redirectUrl: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<SmokeResult> => {
    const client = makeClient();
    const slug = PLATFORM_SLUG[args.platform] ?? args.platform;
    const query: Record<string, string> = { profileId: args.profileId };
    if (args.redirectUrl) query.redirect_url = args.redirectUrl;
    return probe(
      `connect:${slug}`,
      { path: `/api/v1/connect/${slug}`, query },
      () =>
        client.request(`/api/v1/connect/${slug}`, { method: "GET", query })
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Step 2 — list connected accounts (confirm the OAuth landed, get accountId). */
/* -------------------------------------------------------------------------- */

export const step2_listAccounts = internalAction({
  args: { profileId: v.optional(v.string()) },
  handler: async (_ctx, args): Promise<SmokeResult> => {
    const client = makeClient();
    const query: Record<string, string> = {};
    if (args.profileId) query.profileId = args.profileId;
    return probe("listAccounts", { path: "/api/v1/accounts", query }, () =>
      client.request("/api/v1/accounts", { method: "GET", query })
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Step 3 — publish a real text post carrying a wrapped URL (the $0.20 line).  */
/* -------------------------------------------------------------------------- */

export const step3_publishNow = internalAction({
  args: {
    accountId: v.string(),
    text: v.string(),
    url: v.optional(v.string()),
    profileId: v.optional(v.string()),
    firstComment: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<SmokeResult> => {
    const client = makeClient();
    // Documented live POST /v1/posts shape:
    // {content, platforms:[{platform,accountId}], publishNow|scheduledFor+timezone,
    //  mediaItems:[{url,type}], customContent, firstComment, threadItems}
    const content =
      args.url && args.url.length > 0 ? `${args.text} ${args.url}` : args.text;
    const body: Record<string, unknown> = {
      content,
      platforms: [{ platform: "x", accountId: args.accountId }],
      publishNow: true,
    };
    if (args.firstComment) body.firstComment = args.firstComment;
    const query: Record<string, string> = {};
    if (args.profileId) query.profileId = args.profileId;
    return probe("publishNow", { body, query }, () =>
      client.request("/api/v1/posts", { method: "POST", body, query })
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Step 4 — read analytics for the post (or account).                          */
/* -------------------------------------------------------------------------- */

export const step4_getAnalytics = internalAction({
  args: { profileId: v.optional(v.string()), postId: v.optional(v.string()) },
  handler: async (_ctx, args): Promise<SmokeResult> => {
    const client = makeClient();
    const query: Record<string, string> = {};
    if (args.profileId) query.profileId = args.profileId;
    if (args.postId) query.postId = args.postId;
    return probe("analytics", { path: "/api/v1/analytics", query }, () =>
      client.request("/api/v1/analytics", { method: "GET", query })
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Step 5 — account health (canPost, needsReconnect).                          */
/* -------------------------------------------------------------------------- */

export const step5_getHealth = internalAction({
  args: { profileId: v.optional(v.string()) },
  handler: async (_ctx, args): Promise<SmokeResult> => {
    const client = makeClient();
    const query: Record<string, string> = {};
    if (args.profileId) query.profileId = args.profileId;
    return probe("health", { path: "/api/v1/accounts/health", query }, () =>
      client.request("/api/v1/accounts/health", { method: "GET", query })
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Step 6 — scheduled-post reliability probe (scheduledFor + timezone).        */
/* -------------------------------------------------------------------------- */

export const step6_scheduleProbe = internalAction({
  args: {
    accountId: v.string(),
    text: v.string(),
    scheduledForIso: v.string(),
    timezone: v.string(),
    profileId: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<SmokeResult> => {
    const client = makeClient();
    const body: Record<string, unknown> = {
      content: args.text,
      platforms: [{ platform: "x", accountId: args.accountId }],
      scheduledFor: args.scheduledForIso,
      timezone: args.timezone,
    };
    const query: Record<string, string> = {};
    if (args.profileId) query.profileId = args.profileId;
    return probe("scheduleProbe", { body, query }, () =>
      client.request("/api/v1/posts", { method: "POST", body, query })
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Teardown — delete the smoke profile/accounts after the run (COGS hygiene).  */
/* -------------------------------------------------------------------------- */

export const teardown_deleteProfile = internalAction({
  args: { profileId: v.string() },
  handler: async (_ctx, args): Promise<SmokeResult> => {
    const client = makeClient();
    return probe(
      "deleteProfile",
      { path: `/api/v1/profiles/${args.profileId}` },
      () =>
        client.request(`/api/v1/profiles/${encodeURIComponent(args.profileId)}`, {
          method: "DELETE",
        })
    );
  },
});

/**
 * Generic raw GET probe for ad-hoc S1 diagnosis (e.g. /v1/connect/pending-data,
 * /v1/profiles, /v1/accounts/{id}). Path is appended after /api.
 */
export const stepRawGet = internalAction({
  args: {
    path: v.string(),
    query: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (_ctx, args): Promise<SmokeResult> => {
    const client = makeClient();
    return probe(`GET ${args.path}`, { path: args.path, query: args.query }, () =>
      client.request(args.path, { method: "GET", query: args.query })
    );
  },
});

/** Best-effort id extraction from an unknown response envelope. */
function extractId(raw: unknown, keys: string[]): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // Common nesting: { profile: {...} } or { data: {...} }
  for (const wrapper of ["profile", "data", "result"]) {
    const nested = obj[wrapper];
    if (nested && typeof nested === "object") {
      const found = extractId(nested, keys);
      if (found) return found;
    }
  }
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}
