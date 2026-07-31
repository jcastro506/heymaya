/**
 * Vendor smoke suite — the check registry (§18.0.5).
 *
 * Tier 1 (reachability) lands here first: auth is valid, the base URL answers,
 * the credit balance is readable. Free, hourly, every vendor. It answers the
 * question you actually get paged about at 3am — "is anything reachable" —
 * before the expensive tiers even start.
 *
 * Tier 2 (shape) is per-wrapped-endpoint and grows as the perception layer
 * grows; tier 3 (round-trip) spends real money on dedicated test accounts.
 * Both are added in the sprints that build the endpoints they cover, so the
 * suite and the surface stay in step.
 *
 * Every schema here is strict at every level — see `findNonStrictObjects`, and
 * the registry test that runs it over all of them.
 */

import { z } from "zod";
import type { SmokeCheck } from "./types";

/* -------------------------------------------------------------------------- */
/* Tier 1 — reachability                                                       */
/* -------------------------------------------------------------------------- */

/**
 * ScrapeCreators credit balance. The wrapper that reads this is deliberately
 * inline rather than in `endpoints.ts`: this is fleet health, not perception,
 * and it must not go through the per-tenant caching layer.
 */
const scrapeCreatorsCredits: SmokeCheck = {
  vendor: "scrapecreators",
  tier: 1,
  check: "scrapecreators.credit-balance",
  requiredEnv: ["SCRAPE_CREATORS_API_KEY"],
  estCostUsd: 0,
  // VERIFIED LIVE 2026-07-31 against the staging key. The guessed `{credits}`
  // was wrong on every field; this is what the endpoint actually returns.
  schema: z.strictObject({
    success: z.boolean(),
    creditCount: z.number(),
    message: z.string(),
  }),
  run: async () => {
    const { getDefaultClient } = await import("../integrations/scrapeCreators/client");
    return await getDefaultClient().request<unknown>("/v1/credit-balance", {
      method: "GET",
    });
  },
};

const zernioAccountsHealth: SmokeCheck = {
  vendor: "zernio",
  tier: 1,
  check: "zernio.accounts-health",
  requiredEnv: ["ZERNIO_API_KEY"],
  estCostUsd: 0,
  // Raw shape, not our normalized `AccountHealth` — the point is to catch the
  // wire format changing, which a normalizer would hide.
  // VERIFIED LIVE 2026-07-31. Worth recording precisely, because this is one
  // of the wrappers the audit flagged `[shape-unverified-live]`: the account
  // identifier is `accountId`, NOT `id`, and the response carries a `summary`
  // block our schema never modelled. `platform` and `status` were the only two
  // fields the guess got right.
  schema: z.strictObject({
    accounts: z.array(
      z.strictObject({
        accountId: z.string(),
        platform: z.string(),
        status: z.string(),
        username: z.unknown(),
        displayName: z.unknown(),
        profileId: z.unknown(),
        canPost: z.unknown(),
        canFetchAnalytics: z.unknown(),
        analyticsSupported: z.unknown(),
        tokenValid: z.unknown(),
        tokenExpiresAt: z.unknown(),
        needsReconnect: z.unknown(),
        issues: z.unknown(),
      })
    ),
    summary: z.unknown(),
  }),
  run: async () => {
    const { ZernioClient } = await import("../integrations/zernio/client");
    // Non-null: `requiredEnv` already gated this check on the key's presence.
    const client = new ZernioClient({ apiKey: process.env.ZERNIO_API_KEY! });
    return await client.request<unknown>("/api/v1/accounts/health", {
      method: "GET",
    });
  },
};

const creatifyCredits: SmokeCheck = {
  vendor: "creatify",
  tier: 1,
  check: "creatify.remaining_credits",
  requiredEnv: ["CREATIFY_API_ID", "CREATIFY_API_KEY"],
  estCostUsd: 0,
  schema: z.strictObject({ remaining_credits: z.number() }),
  run: async () => {
    const { getRemainingCredits } = await import("../integrations/creatify/endpoints");
    return await getRemainingCredits();
  },
};

/**
 * OpenRouter model catalogue.
 *
 * ⭐ Price drift is a failure, not a warning. Model prices change and a silent
 * 5× increase should page someone — `/api/v1/models` is the only truth
 * (comments in our routing code rot; one already claimed $0.075 for a model
 * that cost $0.25). Tier 2 asserts our routed model IDs still exist at the
 * prices we budgeted; this tier-1 check just proves the catalogue is readable.
 */
const openRouterModels: SmokeCheck = {
  vendor: "openrouter",
  tier: 1,
  check: "openrouter.models",
  requiredEnv: ["OPENROUTER_API_KEY"],
  estCostUsd: 0,
  schema: z.looseObject({
    data: z.array(
      z.looseObject({
        id: z.string(),
        pricing: z.looseObject({
          prompt: z.string(),
          completion: z.string(),
        }),
      })
    ),
  }),
  laxReason:
    "OpenRouter's catalogue carries dozens of per-model fields we don't " +
    "consume and adds more constantly; strict here would fail weekly on " +
    "changes that can't affect us. The assertion that matters — our routed " +
    "model IDs still exist at the prices we budgeted — is a tier-2 check " +
    "against specific ids, not this catalogue read.",
  run: async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    });
    if (!response.ok) {
      throw Object.assign(new Error(response.statusText), {
        status: response.status,
      });
    }
    return await response.json();
  },
};

const r2Reachable: SmokeCheck = {
  vendor: "r2",
  tier: 1,
  check: "r2.bucket-reachable",
  requiredEnv: [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ],
  estCostUsd: 0,
  schema: z.strictObject({ reachable: z.literal(true) }),
  run: async () => {
    // A signed URL for a key that need not exist: it proves credentials and
    // bucket config are valid without a read, a write, or an egress charge.
    const { getSignedUrl } = await import("../integrations/r2/endpoints");
    const url = await getSignedUrl({
      storageKey: "vendor-smoke/reachability-probe",
      expiresInSec: 60,
    });
    return { reachable: typeof url === "string" && url.length > 0 };
  },
};

const geminiKeyValid: SmokeCheck = {
  vendor: "gemini",
  tier: 1,
  check: "gemini.models",
  requiredEnv: ["GEMINI_API_KEY"],
  estCostUsd: 0,
  schema: z.looseObject({
    models: z.array(z.looseObject({ name: z.string() })),
  }),
  laxReason:
    "Same as OpenRouter: a model catalogue we read one field from. Gemini " +
    "ships new models and per-model metadata on its own schedule.",
  run: async () => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
    );
    if (!response.ok) {
      throw Object.assign(new Error(response.statusText), {
        status: response.status,
      });
    }
    return await response.json();
  },
};

const twitterApiIoReachable: SmokeCheck = {
  vendor: "twitterapiio",
  tier: 1,
  check: "twitterapiio.advanced_search",
  requiredEnv: ["TWITTERAPI_IO_KEY"],
  // Cheapest possible query — one page, a term guaranteed to match.
  estCostUsd: 0.00015,
  schema: z.looseObject({ tweets: z.array(z.looseObject({ id: z.string() })) }),
  laxReason:
    "Tweet objects are wide and twitterapi.io mirrors X's field churn. The " +
    "tier-2 check pins the fields the search sweep actually reads.",
  run: async () => {
    const response = await fetch(
      "https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest&query=" +
        encodeURIComponent("the"),
      { headers: { "X-API-Key": process.env.TWITTERAPI_IO_KEY ?? "" } }
    );
    if (!response.ok) {
      throw Object.assign(new Error(response.statusText), {
        status: response.status,
      });
    }
    return await response.json();
  },
};

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

export const SMOKE_CHECKS: SmokeCheck[] = [
  scrapeCreatorsCredits,
  zernioAccountsHealth,
  creatifyCredits,
  openRouterModels,
  r2Reachable,
  geminiKeyValid,
  twitterApiIoReachable,
];

export function checksForTier(tier: 1 | 2 | 3): SmokeCheck[] {
  return SMOKE_CHECKS.filter((check) => check.tier === tier);
}
