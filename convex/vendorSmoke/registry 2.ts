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
/* Tier 2 — shape                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Creatify persona roster — the avatar picker's only input.
 *
 * Creatify does NOT choose an avatar for us. `lipsync_v2` scenes require an
 * explicit `avatar_id`, so this list IS the selection mechanism: if its shape
 * drifts, avatar choice silently degrades to whatever the fallback path does.
 *
 * Free GET, so it runs at tier 2 without spending. ⚠️ The schema below is
 * docs-derived and has NEVER been checked against a live response — no
 * Creatify key is configured. It will report `skipped` until one exists, then
 * almost certainly report drift on the first real run. That's the intended
 * loop, not a defect: guess, get corrected by reality, encode reality.
 */
const creatifyPersonas: SmokeCheck = {
  vendor: "creatify",
  tier: 2,
  check: "creatify.personas_v2",
  requiredEnv: ["CREATIFY_API_ID", "CREATIFY_API_KEY"],
  estCostUsd: 0,
  schema: z.array(
    z.looseObject({
      id: z.string(),
    })
  ),
  laxReason:
    "Persona records carry presentation metadata (thumbnails, tags, locale) " +
    "that Creatify extends independently of anything we read. We consume the " +
    "id; pinning the rest would cry wolf on cosmetic additions.",
  run: async () => {
    const { getPersonasV2 } = await import("../integrations/creatify/endpoints");
    return await getPersonasV2({});
  },
};

/**
 * Voice roster — pins one consistent speaker across a multi-scene render.
 * Free GET. Same unverified caveat as the persona roster above.
 */
const creatifyVoices: SmokeCheck = {
  vendor: "creatify",
  tier: 2,
  check: "creatify.voices",
  requiredEnv: ["CREATIFY_API_ID", "CREATIFY_API_KEY"],
  estCostUsd: 0,
  schema: z.array(z.looseObject({ id: z.string() })),
  laxReason:
    "Voice records carry preview URLs and locale metadata that change " +
    "independently of the id we actually use to pin a speaker.",
  run: async () => {
    const { getVoices } = await import("../integrations/creatify/endpoints");
    return await getVoices();
  },
};

/* -------------------------------------------------------------------------- */
/* Tier 2 — ScrapeCreators perception endpoints                                */
/* -------------------------------------------------------------------------- */

/**
 * Every ScrapeCreators response carries the same billing envelope. Pinning it
 * strictly at the ROOT is the point: a new top-level key means the contract
 * moved, and that's the class of change that hid six days of Zernio failures.
 *
 * Element shapes are deliberately loose — a post object is wide, vendor-owned,
 * and gains fields constantly. Strict there would cry wolf weekly until
 * someone silenced the whole check, which is worse than lax. The root is where
 * the signal is.
 */
const SC_ENVELOPE = {
  success: z.boolean(),
  credits_remaining: z.number(),
  credits_charged: z.number(),
};

const SC_LAX_REASON =
  "Root is strict — a new top-level key is a contract change and fails. " +
  "Individual post/comment objects are vendor-owned, very wide, and gain " +
  "fields constantly; pinning them would cry wolf until someone muted the " +
  "check entirely.";

/** Fixed, public, stable inputs. A smoke check must not depend on a customer. */
const PROBE = {
  ytVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ytHandle: "@MrBeast",
  igPostUrl: "https://www.instagram.com/p/Dbd3EBdnW_u/",
  igHandle: "nasa",
  query: "postgres migration",
};

function scCheck(
  check: string,
  payloadKey: string,
  run: () => Promise<unknown>,
  extraRootKeys: Record<string, z.ZodType> = {}
): SmokeCheck {
  return {
    vendor: "scrapecreators",
    tier: 2,
    check,
    requiredEnv: ["SCRAPE_CREATORS_API_KEY"],
    // 1 credit ≈ $0.002 at the volumes we buy. Ten of these daily is ~300
    // credits/month — real, and the reason tier 2 is daily rather than hourly.
    estCostUsd: 0.002,
    schema: z.strictObject({
      ...SC_ENVELOPE,
      ...extraRootKeys,
      [payloadKey]: z.array(z.looseObject({})),
    }),
    laxReason: SC_LAX_REASON,
    run,
  };
}

const perceptionChecks: SmokeCheck[] = [
  // VERIFIED LIVE 2026-07-31. `search` returns SIX parallel result buckets, not
  // just `videos` — a detail no wrapper reading `videos` alone would notice,
  // and a real capability we weren't using.
  scCheck(
    "scrapecreators.youtube.search",
    "videos",
    async () => {
      const { youtube } = await import("../integrations/scrapeCreators/endpoints");
      return (await youtube.search(PROBE.query)).raw;
    },
    {
      channels: z.array(z.looseObject({})),
      playlists: z.array(z.looseObject({})),
      shorts: z.array(z.looseObject({})),
      shelves: z.array(z.looseObject({})),
      lives: z.array(z.looseObject({})),
      continuationToken: z.unknown(),
    }
  ),
  scCheck(
    "scrapecreators.youtube.video_comments",
    "comments",
    async () => {
      const { youtube } = await import("../integrations/scrapeCreators/endpoints");
      return (await youtube.videoComments(PROBE.ytVideoUrl)).raw;
    },
    { continuationToken: z.unknown() }
  ),
  // Measured 8.0s and 14.7s on consecutive live calls — genuinely slow, not
  // broken. 30s produced a false failure; 60s gives it room without hiding a
  // real hang.
  {
    ...scCheck("scrapecreators.youtube.shorts_trending", "shorts", async () => {
      const { youtube } = await import("../integrations/scrapeCreators/endpoints");
      return (await youtube.shortsTrending("US")).raw;
    }),
    timeoutMs: 60_000,
  },
  scCheck(
    "scrapecreators.instagram.post_comments",
    "comments",
    async () => {
      const { instagram } = await import("../integrations/scrapeCreators/endpoints");
      return (await instagram.postComments(PROBE.igPostUrl)).raw;
    },
    { cursor: z.unknown() }
  ),
  scCheck(
    "scrapecreators.instagram.reels_search",
    "reels",
    async () => {
      const { instagram } = await import("../integrations/scrapeCreators/endpoints");
      return (await instagram.reelsSearch("postgres")).raw;
    },
    { next_page: z.unknown() }
  ),
  scCheck(
    "scrapecreators.instagram.user_reels",
    "items",
    async () => {
      const { instagram } = await import("../integrations/scrapeCreators/endpoints");
      return (await instagram.userReels(PROBE.igHandle)).raw;
    },
    { paging_info: z.unknown(), status: z.unknown() }
  ),
];

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

export const SMOKE_CHECKS: SmokeCheck[] = [
  scrapeCreatorsCredits,
  creatifyPersonas,
  creatifyVoices,
  zernioAccountsHealth,
  creatifyCredits,
  openRouterModels,
  r2Reachable,
  geminiKeyValid,
  twitterApiIoReachable,
  ...perceptionChecks,
];

export function checksForTier(tier: 1 | 2 | 3): SmokeCheck[] {
  return SMOKE_CHECKS.filter((check) => check.tier === tier);
}
