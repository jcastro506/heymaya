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
import { internalAction } from "../_generated/server";
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
  /**
   * ⭐ THE AD-LIBRARY PROBE. The operator's ask, and the thing that decides
   * whether competitor ad intelligence is buildable at all.
   *
   * ⚠️ Meta's OWN Ad Library API serves political and issue ads only, and only
   * in the EU/UK — commercial ads are visible in the web UI and unavailable
   * through it anywhere. So a paid intermediary is the only route to what a
   * consumer-app founder's competitors are actually running, and these are the
   * endpoints of the one we already buy.
   *
   * ⚠️ The prior evidence was a probe dated 2026-06-04 against the FROZEN
   * product — 14 weeks stale — and TikTok Ad Library appeared in that document's
   * prose but not in its verified matrix. Half the feature may have no vendor.
   * This is how we find out before building on it, rather than after: a module
   * built against an unverified endpoint fails OPEN, returns zero ads, and
   * reports ok — which is exactly how `bankFromComplaints` produced 0 of 193
   * ideas.
   *
   * A well-known advertiser is used deliberately: a niche brand returning
   * nothing is ambiguous between "endpoint broken" and "runs no ads".
   */
  scCheck(
    "scrapecreators.facebook.adlibrary_search_companies",
    "searchResults",
    async () => {
      const { facebook } = await import(
        "../integrations/scrapeCreators/platforms/facebook"
      );
      return (await facebook.searchCompanies("Duolingo")).raw;
    }
  ),
  scCheck(
    "scrapecreators.facebook.adlibrary_search_ads",
    // ⚠️ `searchResults`, not `results` — confirmed against the live endpoint
    // 2026-08-19. Guessed wrong first, which is the reason to probe.
    "searchResults",
    async () => {
      const { facebook } = await import(
        "../integrations/scrapeCreators/platforms/facebook"
      );
      return (await facebook.searchAds("habit tracker app")).raw;
    },
    // Confirmed live 2026-08-19: the payload is paginated and self-counting.
    { searchResultsCount: z.unknown(), cursor: z.unknown() }
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

/* -------------------------------------------------------------------------- */
/* Zernio — the endpoints proved by hand on 2026-08-05, now guarded            */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ `POST /api/v1/media/presign` — the check that would have caught a wrapper
 * that was simply wrong.
 *
 * `PresignResponseSchema` expected `{ files: [...] }` for months. The real
 * response is FLAT — `{uploadUrl, publicUrl, key}` — so `presignMedia` would
 * have thrown on first contact, and the contract test asserted the invented
 * shape, so it passed forever and proved nothing.
 *
 * This is what a smoke check is for: the guess and the test agreed with each
 * other and neither had met the vendor.
 */
const zernioPresign: SmokeCheck = {
  vendor: "zernio",
  tier: 2,
  check: "zernio.media-presign",
  requiredEnv: ["ZERNIO_API_KEY"],
  // A presign mints a URL and stores nothing. Free.
  estCostUsd: 0,
  schema: z.strictObject({
    uploadUrl: z.string(),
    publicUrl: z.string(),
    key: z.string(),
    expiresIn: z.unknown().optional(),
  }),
  run: async () => {
    const { ZernioClient } = await import("../integrations/zernio/client");
    return await new ZernioClient({
      apiKey: process.env.ZERNIO_API_KEY!,
    }).request<unknown>("/api/v1/media/presign", {
      method: "POST",
      body: { filename: "smoke.png", contentType: "image/png", size: 1024 },
    });
  },
};

/**
 * ⭐ `POST /api/v1/tools/validate/post` — the preflight, and a canary for the
 * per-channel media rules.
 *
 * Verified live: X accepts text alone; Instagram, TikTok and YouTube reject it
 * and name media. That distinction is load-bearing — it is what tells a founder
 * "I can't post to Instagram without a picture" BEFORE anything is spent.
 *
 * Asserting the REJECTION is deliberate. A check that only proves the endpoint
 * answers would still pass on the day Instagram silently starts accepting text,
 * which is the day our preflight starts lying.
 */
const zernioValidatePost: SmokeCheck = {
  vendor: "zernio",
  tier: 2,
  check: "zernio.validate-post",
  requiredEnv: ["ZERNIO_API_KEY"],
  estCostUsd: 0,
  laxReason:
    "The per-error object is lax because Zernio phrases the message freely and adds hints — asserting the exact prose would fail on a copy edit. What is strict is the part that matters: `valid` must be literally false for a text-only Instagram post, so the day that starts returning true, this fails.",
  schema: z.strictObject({
    valid: z.literal(false),
    errors: z.array(
      z.object({ platform: z.string(), error: z.string() }).passthrough()
    ),
  }),
  run: async () => {
    const { ZernioClient } = await import("../integrations/zernio/client");
    return await new ZernioClient({
      apiKey: process.env.ZERNIO_API_KEY!,
    }).request<unknown>("/api/v1/tools/validate/post", {
      method: "POST",
      // Text-only to Instagram MUST be rejected. If this starts returning
      // valid:true, the strict schema fails and someone looks.
      body: { content: "smoke", platforms: [{ platform: "instagram" }] },
    });
  },
};

/**
 * ⭐ `GET /api/v1/inbox/comments` — the work queue, and `accountsQueried`.
 *
 * The field matters more than the rows. Live, this returned
 * `accountsQueried: 0` against a healthy connected account while
 * `/inbox/conversations` returned 1 — and zero is *"I didn't look"*, which was
 * indistinguishable from an empty inbox until the wrapper surfaced it.
 *
 * For a product whose job is "answer everyone", a schema change that drops
 * that field returns us to answering nobody and reporting success.
 */
const zernioInboxQueue: SmokeCheck = {
  vendor: "zernio",
  tier: 2,
  check: "zernio.inbox-comments",
  requiredEnv: ["ZERNIO_API_KEY"],
  estCostUsd: 0,
  laxReason:
    "The envelope is lax because Zernio has already added fields here mid-flight (`meta.lastUpdated` appeared without notice) and a new one is not a breakage. What is asserted is the three that must never DISAPPEAR — accountsQueried, accountsFailed, failedAccounts — because losing accountsQueried returns us to reading zero accounts and reporting an empty inbox.",
  schema: z
    .object({
      data: z.array(z.unknown()),
      pagination: z
        .object({ hasMore: z.boolean(), nextCursor: z.unknown() })
        .passthrough(),
      meta: z
        .object({
          // The three that must never silently disappear.
          accountsQueried: z.number(),
          accountsFailed: z.number(),
          failedAccounts: z.array(z.unknown()),
        })
        .passthrough(),
    })
    .passthrough(),
  run: async () => {
    const { ZernioClient } = await import("../integrations/zernio/client");
    return await new ZernioClient({
      apiKey: process.env.ZERNIO_API_KEY!,
    }).request<unknown>("/api/v1/inbox/comments", {
      method: "GET",
      query: { limit: 1 },
    });
  },
};

/**
 * ⭐ `GET /api/v1/analytics` — where every non-X metric comes from.
 *
 * `overview` is asserted and `posts` is not, because a quiet account returns an
 * empty array and that is not a failure. What must not change is the envelope:
 * `metrics.ts` matches placements to rows by `platformPostUrl`, and a rename
 * there silently stops every number arriving.
 */
const zernioAnalytics: SmokeCheck = {
  vendor: "zernio",
  tier: 2,
  check: "zernio.analytics",
  requiredEnv: ["ZERNIO_API_KEY"],
  estCostUsd: 0,
  laxReason:
    "`posts[]` is unknown because a quiet account returns an empty array and the row shape differs per platform — TikTok carries igReels fields that YouTube does not. Asserting a per-row shape would fail on whichever channel is quiet that day. The envelope and `overview` are what metrics.ts depends on, and those are asserted.",
  schema: z
    .object({
      overview: z
        .object({ totalPosts: z.number(), publishedPosts: z.number() })
        .passthrough(),
      posts: z.array(z.unknown()),
      pagination: z.unknown().optional(),
    })
    .passthrough(),
  run: async () => {
    const { ZernioClient } = await import("../integrations/zernio/client");
    return await new ZernioClient({
      apiKey: process.env.ZERNIO_API_KEY!,
    }).request<unknown>("/api/v1/analytics", {
      method: "GET",
      query: { limit: 1 },
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Tier 3 — round-trip. Real money, and the only tier that proves a WRITE works */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ THE ONLY CHECK THAT SPENDS. §18.0.5 gives Creatify's tier 3 in six words:
 * *"one cheap render weekly — not a video."*
 *
 * ⚠️ `runTier3` has been on a weekly cron since the suite was built and
 * `checksForTier(3)` returned an EMPTY ARRAY. A job that fires every Sunday and
 * tests nothing — and it is the tier that would catch the failure that actually
 * costs money: credits accepted, job queued, and nothing ever completing.
 *
 * Tier 2 proves the shape of a read. Only a write proves the account can still
 * DO anything, and §18.0.5's whole argument is that the Zernio incident returned
 * 200s for six days while publishing nothing.
 *
 * ## Why a Link and not a render
 *
 * A Link costs **1 credit** (§3.1) and exercises the call the render path
 * depends on absolutely: §7.6.2 says we ALWAYS use `link_with_params` and never
 * let Creatify scrape, so if this call breaks, every video breaks — and the
 * storyboard the founder approved would be describing frames the vendor never
 * received.
 *
 * A full render is 5–12 credits, takes minutes, and would prove the same
 * contract plus an assembly step we do not control. Weekly × 200 customers, the
 * cheap call is the one that can actually run forever.
 */
const creatifyLinkRoundTrip: SmokeCheck = {
  vendor: "creatify",
  tier: 3,
  check: "creatify.links.link_with_params",
  requiredEnv: ["CREATIFY_API_ID", "CREATIFY_API_KEY"],
  /** 1 credit at the Pro rate (§2 of the API reference). */
  estCostUsd: 0.1495,
  /**
   * ⚠️ STRICT on `id`, because the id is the entire point — every downstream
   * call takes it. Loose elsewhere: a Link carries scraped presentation fields
   * Creatify extends on its own schedule, and pinning those would cry wolf on a
   * cosmetic addition. §18.0.5's rule is that the suite fails loudly on a
   * changed field WE READ.
   */
  schema: z.looseObject({ id: z.string() }),
  laxReason:
    "A Link echoes back scraped metadata (ai_summary, ai_industry, " +
    "target_audiences) that Creatify extends independently. We consume the id " +
    "and the images we ourselves supplied; pinning their enrichment fields " +
    "would fail on a cosmetic change.",
  run: async () => {
    const { createLinkWithParams } = await import(
      "../integrations/creatify/endpoints"
    );
    /**
     * ⚠️ Supplies its own image, deliberately — never a scrape of a real
     * customer's site. This runs fleet-wide and unattended; pointing it at a
     * founder's URL would spend their vendor's time on our health check and
     * make a smoke run indistinguishable from real work in the vendor's logs.
     */
    return await createLinkWithParams({
      title: "smoke",
      description: "vendor smoke round-trip — not a customer render",
      image_urls: ["https://placehold.co/1080x1920.png"],
    });
  },
};

export const SMOKE_CHECKS: SmokeCheck[] = [
  zernioPresign,
  zernioValidatePost,
  zernioInboxQueue,
  zernioAnalytics,
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
  creatifyLinkRoundTrip,
];

export function checksForTier(tier: 1 | 2 | 3): SmokeCheck[] {
  return SMOKE_CHECKS.filter((check) => check.tier === tier);
}


/**
 * ⭐ A one-shot look at the real ad payload — specifically whether it carries a
 * START DATE. The entire competitor-ad design ranks on LONGEVITY: an ad running
 * 21+ days is one somebody pays for daily and has not killed, and existence
 * alone means nothing because anyone can boost a post for twenty dollars.
 *
 * ⭐ RUN 2026-08-19, AND THE ANSWER IS YES. The payload carries `start_date`,
 * `start_date_string`, `end_date`, `is_active` and — better than the design
 * asked for — `total_active_time`, longevity already computed. Plus
 * `collation_count`, which is the VARIANT COUNT: an advertiser running three
 * versions of one concept is scaling a winner. `spend` and `reach_estimate` are
 * there too.
 *
 * So the ranking rule is fully supported by the vendor and needs no derivation
 * of our own.
 *
 * ⚠️ NO CALLER BY DESIGN — an operator diagnostic, run by hand when the vendor
 * is suspected of drifting. Everything automated lives in the checks above.
 */
export const peekAdShape = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean; keys: string[]; sample: string }> => {
    const { facebook } = await import(
      "../integrations/scrapeCreators/platforms/facebook"
    );
    const res = (await facebook.searchAds("habit tracker app")).raw as {
      searchResults?: unknown[];
    };
    const first = (res.searchResults ?? [])[0] as Record<string, unknown> | undefined;
    if (!first) return { ok: false, keys: [], sample: "no ads returned" };
    return {
      ok: true,
      keys: Object.keys(first),
      sample: JSON.stringify(first).slice(0, 900),
    };
  },
});
