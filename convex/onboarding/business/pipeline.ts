/**
 * Service-business onboarding pipeline.
 *
 * Per § 5 (11-step onboarding) + § 13 Sprint 2. Mirrors the creator-side
 * `convex/onboarding/maya/` orchestrator. Functions:
 *
 *   - `startServiceOnboarding({ clerkUserId })` — idempotent: ensures the
 *     `creators` row has `accountType: "service-business"` + creates a
 *     `businesses` skeleton row pointed at it; returns the resolved ids.
 *   - `recordOnboardingStep({ accountId, step, payload })` — durable step
 *     persistence so refresh mid-flow doesn't lose progress.
 *   - `triggerBulkPull({ businessId })` — parallel Zernio reads bound by §
 *     5 step 6 limits (≤3 GBP calls, ≤1 FB, ≤1 IG, ≤1 CRM); skip platforms
 *     with zero data; never block onboarding on data we don't need.
 *   - `synthesizeBusinessPicture({ businessId, bulkPullResult })` — calls
 *     the real `generateBusinessPicture` (Gemini 3 Flash @ HIGH).
 *   - `deployServiceMaya({ businessId })` — wraps `deployServiceMaya.ts`.
 *   - `sendFirstMessage({ businessId, channel })` — first ping per § 5 step
 *     9 with ≥2 grounded data citations + the "open with the fix" pattern.
 *
 * Cross-tenant safety: every public action re-resolves the business via
 * Clerk identity → creators row → businessId. Internal actions accept
 * `businessId` only and trust the caller (the public wrappers).
 *
 * Step 11 (phone number / channel pairing) is intentionally NOT in this
 * orchestrator — it is parked pending operator re-scope (2026-04-27). The
 * deploy orchestrator now uses OpenClaw native channel pairing for v0; the
 * direct Twilio path lives parked under `convex/integrations/twilio/` as
 * documented there.
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { generateBusinessPicture } from "../../agents/packs/maya_service/generateBusinessPicture";
import type { BusinessPictureSynthResult } from "../../agents/packs/maya_service/generateBusinessPicture";
import { generateWikiInitialPages } from "../../agents/packs/maya_service/wikiInitialPages";
import type {
  WikiInitialPage,
  WikiPageKind,
} from "../../agents/packs/maya_service/wikiInitialPages";
import type { ServiceType } from "../../agents/packs/maya_service/types";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export interface StartOnboardingResult {
  accountId: Id<"creators">;
  businessId: Id<"businesses">;
}

export interface BulkPullResult {
  gbp: {
    profile: { primaryCategory: string; address: string; city: string };
    reviews: ReadonlyArray<{
      body: string;
      starRating: number;
      reviewerName: string;
    }>;
    posts: ReadonlyArray<{
      body: string;
      ctaKind?: string;
      engagement?: number;
    }>;
    photoUrls?: ReadonlyArray<string>;
    pastReviewReplies?: ReadonlyArray<string>;
  };
  socialPosts: ReadonlyArray<{
    platform: "facebook" | "instagram" | "tiktok" | "linkedin" | "x";
    caption: string;
    engagement?: number;
  }>;
  /** Diagnostic — which platforms were skipped (zero data or not connected). */
  skippedPlatforms: ReadonlyArray<string>;
  /** Total count of API calls actually performed. Bounded per § 5 step 6. */
  apiCallsUsed: number;
}

/* -------------------------------------------------------------------------- */
/* Internal mutations + queries                                                */
/* -------------------------------------------------------------------------- */

export const findOrCreateAccountAndBusiness = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<StartOnboardingResult> => {
    // Step 1 — ensure `creators` row exists. Webhook should have created it,
    // but the action is idempotent so a refresh from a half-onboarded user
    // works.
    let account = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", args.clerkUserId)
      )
      .first();
    if (!account) {
      const id = await ctx.db.insert("creators", {
        clerkUserId: args.clerkUserId,
        email: args.email,
        channelPreference: "web",
        timezone: args.timezone ?? "America/Los_Angeles",
        status: "onboarding",
        plan: "starter",
        accountType: "service-business",
        createdAt: Date.now(),
      });
      account = await ctx.db.get(id);
      if (!account) throw new Error("findOrCreateAccountAndBusiness: insert lost.");
    }

    // Patch accountType if missing (legacy rows).
    if (account.accountType !== "service-business") {
      await ctx.db.patch(account._id, { accountType: "service-business" });
    }

    // Step 2 — ensure `businesses` row exists.
    let businessId = account.businessId;
    if (businessId) {
      const existing = await ctx.db.get(businessId);
      if (existing) {
        return { accountId: account._id, businessId };
      }
      // Stale pointer — drop it.
      businessId = undefined;
    }
    const newBusinessId = await ctx.db.insert("businesses", {
      accountId: account._id,
      name: "",
      serviceTypes: [],
      planTier: "starter",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(account._id, { businessId: newBusinessId });
    return { accountId: account._id, businessId: newBusinessId };
  },
});

export const recordOnboardingStepInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    step: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) {
      throw new Error(
        `recordOnboardingStepInternal: business ${args.businessId} not found.`
      );
    }
    const updates: Partial<Doc<"businesses">> = { updatedAt: Date.now() };

    // Translate well-known step kinds onto canonical fields. Unknown steps
    // are recorded as no-ops (still touch updatedAt, idempotent).
    switch (args.step) {
      case "name":
        if (typeof args.payload?.name === "string") {
          updates.name = String(args.payload.name);
        }
        break;
      case "service-types": {
        const arr = args.payload?.serviceTypes;
        if (Array.isArray(arr)) {
          updates.serviceTypes = arr
            .filter((x): x is string => typeof x === "string")
            .slice(0, 10);
        }
        break;
      }
      case "service-area":
        if (args.payload?.polygon) {
          updates.serviceAreaPolygon = args.payload.polygon;
        }
        break;
      case "ticket-size":
        if (
          ["under-200", "200-500", "500-2k", "2k-10k", "over-10k"].includes(
            args.payload?.bucket
          )
        ) {
          updates.ticketSizeBucket = args.payload.bucket;
        }
        break;
      case "business-size":
        if (
          ["solo", "2-5", "6-15", "16-50", "50-plus"].includes(
            args.payload?.size
          )
        ) {
          updates.businessSize = args.payload.size;
        }
        break;
      case "tone":
        if (
          [
            "friendly-neighborhood",
            "professional-efficient",
            "authoritative-expert",
          ].includes(args.payload?.tone)
        ) {
          updates.tonePreference = args.payload.tone;
        }
        break;
      case "response-speed":
        if (
          ["instant", "within-5-min", "within-30-min"].includes(
            args.payload?.speed
          )
        ) {
          updates.responseSpeed = args.payload.speed;
        }
        break;
      default:
        // Unknown / informational step — record nothing structured but bump
        // `updatedAt` so we still mark progress.
        break;
    }
    await ctx.db.patch(args.businessId, updates);
  },
});

export const persistBusinessPictureRow = internalMutation({
  args: {
    businessId: v.id("businesses"),
    brandVoice: v.string(),
    customerSentiment: v.optional(v.string()),
    recurringServicePatterns: v.array(v.string()),
    localCompetitors: v.array(v.string()),
    generatedAt: v.number(),
    model: v.string(),
    sourceCitations: v.array(
      v.object({
        platform: v.string(),
        externalId: v.string(),
        usedFor: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<Id<"businessPicture">> => {
    const existing = await ctx.db
      .query("businessPicture")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    const fields = {
      businessId: args.businessId,
      brandVoice: args.brandVoice,
      customerSentiment: args.customerSentiment,
      recurringServicePatterns: args.recurringServicePatterns,
      localCompetitors: args.localCompetitors,
      generatedAt: args.generatedAt,
      model: args.model,
      sourceCitations: args.sourceCitations,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("businessPicture", fields);
  },
});

export const getBusinessForPipeline = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"businesses"> | null> => {
    return await ctx.db.get(args.businessId);
  },
});

export const getZernioConnectionForBulkPull = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<{
    zernioAccountId: string;
    encryptedApiKey: string;
    platforms: ReadonlyArray<{
      platform: string;
      platformAccountId: string;
      status: string;
    }>;
  } | null> => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    if (!row) return null;
    return {
      zernioAccountId: row.zernioAccountId,
      encryptedApiKey: row.encryptedApiKey,
      platforms: row.connectedPlatforms.map((p) => ({
        platform: p.platform,
        platformAccountId: p.platformAccountId,
        status: p.status,
      })),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Public action — startServiceOnboarding                                      */
/* -------------------------------------------------------------------------- */

export const startServiceOnboarding = action({
  args: {
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<StartOnboardingResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("startServiceOnboarding: not authenticated.");
    }
    const email = identity.email ?? `${identity.subject}@unknown.heymaya`;
    return await ctx.runMutation(
      internal.onboarding.business.pipeline.findOrCreateAccountAndBusiness,
      {
        clerkUserId: identity.subject,
        email,
        timezone: args.timezone,
      }
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Public action — recordOnboardingStep (UI calls per step)                    */
/* -------------------------------------------------------------------------- */

export const recordOnboardingStep = action({
  args: {
    step: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("recordOnboardingStep: not authenticated.");
    }
    const ctxRow = await ctx.runQuery(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: identity.subject }
    );
    if (!ctxRow) {
      throw new Error(
        "recordOnboardingStep: no service-business row for signed-in user."
      );
    }
    await ctx.runMutation(
      internal.onboarding.business.pipeline.recordOnboardingStepInternal,
      {
        businessId: ctxRow.business._id,
        step: args.step,
        payload: args.payload,
      }
    );
    return { ok: true };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal action — triggerBulkPull                                           */
/* -------------------------------------------------------------------------- */

/**
 * Per § 5 step 6: bounded bulk pull.
 *   - GBP: last 10 posts + last 20 reviews + last 8 photos
 *   - FB/IG (if connected): last 10 posts each
 *   - CRM (if connected): last 14 days — currently STUBBED for Sprint 4-5
 *   - Skip platforms with zero data
 *   - Hard cap: ≤3 GBP API calls, ≤1 FB, ≤1 IG, ≤1 CRM
 *
 * Failures on individual platforms are NEVER fatal — onboarding continues
 * with whatever we got. Each failure surfaces as a `skippedPlatforms` entry
 * with a reason suffix.
 */
export const triggerBulkPull = internalAction({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<BulkPullResult> => {
    const business = await ctx.runQuery(
      internal.onboarding.business.pipeline.getBusinessForPipeline,
      { businessId: args.businessId }
    );
    if (!business) {
      throw new Error(
        `triggerBulkPull: business ${args.businessId} not found.`
      );
    }
    const conn = await ctx.runQuery(
      internal.onboarding.business.pipeline.getZernioConnectionForBulkPull,
      { businessId: args.businessId }
    );
    const skipped: string[] = [];
    let apiCallsUsed = 0;

    if (!conn) {
      // No Zernio connection — cannot pull GBP. Surface empty data; downstream
      // synthesis treats it as "no scraped data" + falls back to operator answers.
      return {
        gbp: {
          profile: {
            primaryCategory: business.serviceTypes[0] ?? "service-business",
            address: "",
            city: "",
          },
          reviews: [],
          posts: [],
          photoUrls: [],
          pastReviewReplies: [],
        },
        socialPosts: [],
        skippedPlatforms: ["gbp:no-connection", "fb:no-connection", "ig:no-connection"],
        apiCallsUsed: 0,
      };
    }

    // Defer the actual Zernio HTTP work — run by a separate worker action so
    // a slow GBP call doesn't trip the onboarding kickoff timeout. We import
    // the endpoints lazily to keep the action boundary clean.
    let result: BulkPullResult;
    try {
      result = await ctx.runAction(
        internal.onboarding.business.pipeline.zernioBulkPullWorker,
        {
          businessId: args.businessId,
          zernioAccountId: conn.zernioAccountId,
          encryptedApiKey: conn.encryptedApiKey,
          platforms: conn.platforms.map((p) => ({
            platform: p.platform,
            platformAccountId: p.platformAccountId,
            status: p.status,
          })),
        }
      );
      apiCallsUsed += result.apiCallsUsed;
      skipped.push(...result.skippedPlatforms);
    } catch (err) {
      // Zernio outage during bulk pull — graceful skip per § 5 step 6 ("Skip
      // platforms with zero data" + hard rule that onboarding never blocks
      // on optional data).
      skipped.push(`zernio:outage:${(err as Error).message.slice(0, 100)}`);
      result = {
        gbp: {
          profile: {
            primaryCategory: business.serviceTypes[0] ?? "service-business",
            address: "",
            city: "",
          },
          reviews: [],
          posts: [],
          photoUrls: [],
          pastReviewReplies: [],
        },
        socialPosts: [],
        skippedPlatforms: skipped,
        apiCallsUsed: 0,
      };
    }

    return result;
  },
});

/**
 * The worker action that actually hits Zernio. Split out so a Zernio outage
 * surfaces cleanly to `triggerBulkPull`'s try/catch above.
 *
 * NOTE: this uses dynamic-import of the zernio endpoints module so the
 * top-level pipeline file isn't a hard dep on Zernio for tests that don't
 * mock it. Import inside the handler.
 */
export const zernioBulkPullWorker = internalAction({
  args: {
    businessId: v.id("businesses"),
    zernioAccountId: v.string(),
    encryptedApiKey: v.string(),
    platforms: v.array(
      v.object({
        platform: v.string(),
        platformAccountId: v.string(),
        status: v.string(),
      })
    ),
  },
  handler: async (_ctx, args): Promise<BulkPullResult> => {
    const { decrypt } = await import("../../lib/encryption");
    const { ZernioClient } = await import("../../integrations/zernio/client");
    const endpoints = await import("../../integrations/zernio/endpoints");

    const apiKey = await decrypt(args.encryptedApiKey);
    const client = new ZernioClient({ apiKey });
    const ctx: { client: typeof client; zernioAccountId: string } = {
      client,
      zernioAccountId: args.zernioAccountId,
    };

    const skipped: string[] = [];
    let calls = 0;

    const gbpPlatform = args.platforms.find(
      (p) => p.platform === "gbp" && p.status === "active"
    );
    let gbpProfile = {
      primaryCategory: "service-business",
      address: "",
      city: "",
    };
    let reviews: BulkPullResult["gbp"]["reviews"] = [];
    let posts: BulkPullResult["gbp"]["posts"] = [];
    let photoUrls: ReadonlyArray<string> = [];
    let pastReviewReplies: ReadonlyArray<string> = [];

    if (gbpPlatform) {
      // GBP locations call (1) — picks the primary location's profile.
      try {
        const locations = await endpoints.gbpListLocations(ctx);
        calls += 1;
        const primary =
          locations.find(
            (l) => l.locationId === gbpPlatform.platformAccountId
          ) ?? locations[0];
        if (primary) {
          gbpProfile = {
            primaryCategory: primary.primaryCategory ?? "service-business",
            address: primary.address ?? "",
            city: extractCityFromAddress(primary.address ?? ""),
          };
          // Reviews call (2) — last 20.
          try {
            const rs = await endpoints.gbpListReviews(
              ctx,
              primary.locationId,
              { limit: 20 }
            );
            calls += 1;
            reviews = rs.slice(0, 20).map((r) => ({
              body: r.body ?? "",
              starRating: r.starRating ?? 5,
              reviewerName: r.reviewerName ?? "(anonymous)",
            }));
            pastReviewReplies = rs
              .map((r) => r.replyText)
              .filter(
                (t): t is string => typeof t === "string" && t.length > 0
              )
              .slice(0, 10);
          } catch (err) {
            skipped.push(
              `gbp-reviews:${(err as Error).message.slice(0, 80)}`
            );
          }
          // Local posts call (3) — last 10.
          try {
            const lp =
              "gbpListLocalPosts" in endpoints &&
              typeof (endpoints as Record<string, unknown>)[
                "gbpListLocalPosts"
              ] === "function"
                ? await (
                    endpoints as unknown as {
                      gbpListLocalPosts: (
                        ctx_: typeof ctx,
                        locationId: string,
                        opts: { limit: number }
                      ) => Promise<
                        Array<{ summary?: string; engagement?: number }>
                      >;
                    }
                  ).gbpListLocalPosts(ctx, primary.locationId, { limit: 10 })
                : [];
            calls += 1;
            posts = lp.map((p) => ({
              body: p.summary ?? "",
              engagement: p.engagement,
            }));
          } catch (err) {
            // GBP local-posts list endpoint may not be wired — silent skip.
            skipped.push(
              `gbp-posts:${(err as Error).message.slice(0, 80)}`
            );
          }
          // Photos: not pulled at onboarding (§ 5 step 6 limits photos to 8;
          // Zernio's GBP photo surface is read via the Sprint 1 cataloger
          // pipeline rather than onboarding). Leave empty.
          photoUrls = [];
        } else {
          skipped.push("gbp:no-location-found");
        }
      } catch (err) {
        skipped.push(`gbp-locations:${(err as Error).message.slice(0, 80)}`);
      }
    } else {
      skipped.push("gbp:not-connected");
    }

    // FB + IG — last 10 posts each. Bounded by the per-platform "1 call"
    // ceiling per § 5 step 6.
    const social: BulkPullResult["socialPosts"] = [];
    const fbPlatform = args.platforms.find(
      (p) => p.platform === "facebook" && p.status === "active"
    );
    if (fbPlatform) {
      // Facebook post-list endpoint not in v0 zernio surface — defer to
      // Sprint 4 cron warm-up; mark skipped so synthesis falls back to GBP.
      skipped.push("facebook:bulk-pull-deferred-to-cron");
    } else {
      skipped.push("facebook:not-connected");
    }

    const igPlatform = args.platforms.find(
      (p) => p.platform === "instagram" && p.status === "active"
    );
    if (igPlatform) {
      skipped.push("instagram:bulk-pull-deferred-to-cron");
    } else {
      skipped.push("instagram:not-connected");
    }

    return {
      gbp: {
        profile: gbpProfile,
        reviews,
        posts,
        photoUrls,
        pastReviewReplies,
      },
      socialPosts: social,
      skippedPlatforms: skipped,
      apiCallsUsed: calls,
    };
  },
});

function extractCityFromAddress(address: string): string {
  // "123 Main St, Lincoln, NE 68501, USA" → "Lincoln". Best-effort; fallback "".
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 2) return parts[1];
  return "";
}

/* -------------------------------------------------------------------------- */
/* Internal action — synthesizeBusinessPicture                                 */
/* -------------------------------------------------------------------------- */

export interface SynthesizeBusinessPictureResult {
  pictureId: Id<"businessPicture">;
  hallucinationFlagsCount: number;
  costUsd: number;
  latencyMs: number;
}

export const synthesizeBusinessPicture = internalAction({
  args: {
    businessId: v.id("businesses"),
    bulkPull: v.any(),
    onboardingLocalAnswers: v.object({
      namedCompetitors: v.array(v.string()),
      neighborhoodEmphasis: v.array(v.string()),
      operatorVolunteeredHooks: v.array(v.string()),
    }),
  },
  handler: async (
    ctx,
    args
  ): Promise<SynthesizeBusinessPictureResult> => {
    const business = await ctx.runQuery(
      internal.onboarding.business.pipeline.getBusinessForPipeline,
      { businessId: args.businessId }
    );
    if (!business) {
      throw new Error(
        `synthesizeBusinessPicture: business ${args.businessId} not found.`
      );
    }
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "synthesizeBusinessPicture: OPENROUTER_API_KEY is not set."
      );
    }
    const bulk = args.bulkPull as BulkPullResult;
    const KNOWN: ReadonlyArray<
      | "hvac"
      | "plumbing"
      | "electrical"
      | "landscaping"
      | "cleaning"
      | "roofing"
      | "pest"
      | "restoration"
      | "contracting"
      | "mobile-detailing"
    > = [
      "hvac",
      "plumbing",
      "electrical",
      "landscaping",
      "cleaning",
      "roofing",
      "pest",
      "restoration",
      "contracting",
      "mobile-detailing",
    ];
    const validatedServiceTypes = (business.serviceTypes ?? []).filter(
      (s): s is (typeof KNOWN)[number] =>
        (KNOWN as ReadonlyArray<string>).includes(s)
    );
    const result: BusinessPictureSynthResult = await generateBusinessPicture({
      business: {
        name: business.name,
        serviceTypes:
          validatedServiceTypes.length > 0
            ? validatedServiceTypes
            : (["contracting"] as const),
        serviceArea: business.serviceAreaPolygon
          ? "service-area-polygon"
          : "operator-supplied-area",
        timezone: "America/Los_Angeles",
        tonePreference: mapTonePreferenceForSynth(business.tonePreference),
        technicianNames: [],
        businessHours: "M-F",
        voiceEnabled: business.voiceEnabled ?? false,
      },
      bulkPullArtifact: {
        gbp: bulk.gbp,
        socialPosts: bulk.socialPosts,
      },
      onboardingLocalAnswers: args.onboardingLocalAnswers,
      apiKey,
    });

    const pictureId = await ctx.runMutation(
      internal.onboarding.business.pipeline.persistBusinessPictureRow,
      {
        businessId: args.businessId,
        brandVoice: result.picture.brandVoice,
        customerSentiment: result.picture.customerSentiment,
        recurringServicePatterns:
          (result.picture.recurringServicePatterns ?? []) as string[],
        localCompetitors: result.picture.localPositioning.namedCompetitors.map(
          (c) => c.name
        ),
        generatedAt: result.picture.generatedAt,
        model: result.picture.model,
        sourceCitations: result.picture.sourceCitations.map((c) => ({
          platform: c.kind,
          externalId: c.externalRef,
          usedFor: c.usedFor,
        })),
      }
    );

    return {
      pictureId,
      hallucinationFlagsCount: result.hallucinationFlags.length,
      costUsd: result.cost.usd,
      latencyMs: result.cost.latencyMs,
    };
  },
});

function mapTonePreferenceForSynth(
  tone:
    | "friendly-neighborhood"
    | "professional-efficient"
    | "authoritative-expert"
    | undefined
): "friendly-neighborhood-pro" | "professional-efficient" | "authoritative-expert" {
  if (tone === "professional-efficient") return "professional-efficient";
  if (tone === "authoritative-expert") return "authoritative-expert";
  return "friendly-neighborhood-pro";
}

/* -------------------------------------------------------------------------- */
/* Internal action — synthesizeWikiInitialPages (§ 9.5)                        */
/*                                                                             */
/* Step 8.5 of the onboarding pipeline. Runs AFTER `synthesizeBusinessPicture` */
/* succeeds. Materializes the initial memory-wiki vault contents from the     */
/* freshly synthesized `businessPicture` row + the operator's onboarding Q9-  */
/* Q11 answers + onboarding bulk-pull source counts.                          */
/*                                                                             */
/* This is a Convex projection write — the per-business wiki vault on the     */
/* Fly machine is the actual source of truth. Per § 9.5 + the OpenClaw native-*/
/* first rule, we don't reimplement the wiki; we mirror page summaries so HQ  */
/* screens can subscribe via Convex queries instead of round-tripping to the  */
/* agent runtime.                                                              */
/*                                                                             */
/* Routing per § 7: rendering downstream of HIGH-thinking businessPicture →   */
/* MEDIUM thinking budget. Tagged for telemetry; no LLM call inside this      */
/* function — it's pure render from already-synthesized inputs.               */
/* -------------------------------------------------------------------------- */

export interface SynthesizeWikiInitialPagesResult {
  pagesWritten: number;
  droppedPhantomNamesCount: number;
  perKindCount: Record<WikiPageKind, number>;
  modelTarget: "rendering";
  thinkingBudget: "medium";
  routedReason: string;
}

export const synthesizeWikiInitialPages = internalAction({
  args: {
    businessId: v.id("businesses"),
    onboardingLocalAnswers: v.object({
      namedCompetitors: v.array(v.string()),
      neighborhoodEmphasis: v.array(v.string()),
      operatorVolunteeredHooks: v.array(v.string()),
    }),
    sourceCounts: v.object({
      reviews: v.number(),
      posts: v.number(),
      hasGbpProfile: v.boolean(),
    }),
  },
  handler: async (
    ctx,
    args
  ): Promise<SynthesizeWikiInitialPagesResult> => {
    const business = await ctx.runQuery(
      internal.onboarding.business.pipeline.getBusinessForPipeline,
      { businessId: args.businessId }
    );
    if (!business) {
      throw new Error(
        `synthesizeWikiInitialPages: business ${args.businessId} not found.`
      );
    }
    const picture = await ctx.runQuery(
      internal.onboarding.business.pipeline.getBusinessPictureForFirstMessage,
      { businessId: args.businessId }
    );
    if (!picture) {
      throw new Error(
        `synthesizeWikiInitialPages: businessPicture row missing for business ${args.businessId}; run synthesizeBusinessPicture first.`
      );
    }

    // The Convex `businessPicture` projection is FLAT (no localPositioning
    // sub-object) — it intentionally projects only what HQ Today needs. To
    // render wiki pages we reconstitute the lite shape from the projection
    // + operator answers. The richer shape lives only in the wiki vault on
    // the Fly machine itself.
    const KNOWN: ReadonlyArray<ServiceType> = [
      "hvac",
      "plumbing",
      "electrical",
      "landscaping",
      "cleaning",
      "roofing",
      "pest",
      "restoration",
      "contracting",
      "mobile-detailing",
    ];
    const validatedServiceTypes = (business.serviceTypes ?? []).filter(
      (s): s is ServiceType =>
        (KNOWN as ReadonlyArray<string>).includes(s)
    );
    const pagesOutput = generateWikiInitialPages({
      businessName: business.name || "Business",
      serviceTypes:
        validatedServiceTypes.length > 0
          ? validatedServiceTypes
          : (["contracting"] as const),
      picture: {
        brandVoice: picture.brandVoice,
        brandVoiceSamples: [],
        customerSentiment: picture.customerSentiment,
        recurringServicePatterns: picture.recurringServicePatterns,
        localPositioning: {
          // Operator-named neighborhoods come straight from Q10. The synth
          // output's expanded set is held only in the vault on the Fly
          // machine; for the projection we use the operator's seeds plus
          // anything the projection captured in `localCompetitors`.
          servedZips: [],
          servedNeighborhoods: args.onboardingLocalAnswers.neighborhoodEmphasis,
          namedCompetitors: picture.localCompetitors.map((name) => ({
            name,
          })),
          recurringLocalHooks: [],
          localChoiceThesis: "",
        },
      },
      onboardingLocalAnswers: args.onboardingLocalAnswers,
      sourceCounts: args.sourceCounts,
      now: Date.now(),
    });

    if (pagesOutput.pages.length > 0) {
      await ctx.runMutation(
        internal.wikiProjections.applyInitialPages,
        {
          businessId: args.businessId,
          pages: pagesOutput.pages.map((p: WikiInitialPage) => ({
            vaultPath: p.vaultPath,
            kind: p.kind,
            claim: p.claim,
            provenance: p.provenance.map((entry) => ({
              sourceId: entry.sourceId,
              path: entry.path,
              lines: entry.lines,
              weight: entry.weight,
              note: entry.note,
            })),
            confidence: p.confidence,
          })),
        }
      );
    }

    const perKindCount: Record<WikiPageKind, number> = {
      entity: 0,
      concept: 0,
      synthesis: 0,
      source: 0,
      report: 0,
    };
    for (const p of pagesOutput.pages) {
      perKindCount[p.kind] += 1;
    }

    return {
      pagesWritten: pagesOutput.pages.length,
      droppedPhantomNamesCount: pagesOutput.droppedPhantomNames.length,
      perKindCount,
      modelTarget: "rendering",
      thinkingBudget: "medium",
      routedReason:
        "wiki-initial-pages: deterministic render downstream of HIGH-thinking businessPicture; no LLM call",
    };
  },
});

/* -------------------------------------------------------------------------- */
/* sendFirstMessage — § 5 step 9                                                */
/* -------------------------------------------------------------------------- */

/**
 * Compose the first ping. § 5 step 9 requires:
 *   - cite ≥2 specific data points from the bulk pull
 *   - "open with the fix" pattern (not "hi I'm Maya")
 *
 * v0 routes the first ping through whatever channel OpenClaw paired during
 * deploy — see § 11 channel pairing. The actual send is wired via the OpenClaw
 * gateway HTTP surface, kept here as the preview body that gets pushed.
 */
export const sendFirstMessage = internalAction({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<{ messageBody: string }> => {
    const business = await ctx.runQuery(
      internal.onboarding.business.pipeline.getBusinessForPipeline,
      { businessId: args.businessId }
    );
    if (!business) {
      throw new Error(
        `sendFirstMessage: business ${args.businessId} not found.`
      );
    }
    const picture = await ctx.runQuery(
      internal.onboarding.business.pipeline.getBusinessPictureForFirstMessage,
      { businessId: args.businessId }
    );
    const reviewCount = picture?.sourceCitations.filter(
      (c) => c.platform === "review"
    ).length ?? 0;
    const competitorCount = picture?.localCompetitors.length ?? 0;
    // Two grounded data points minimum:
    //   1. Review count from sourceCitations
    //   2. Either named competitor count OR top recurring service pattern
    const fix =
      picture?.recurringServicePatterns &&
      picture.recurringServicePatterns.length > 0
        ? `Customers consistently call out: "${picture.recurringServicePatterns[0]}".`
        : `I'm reading your review history.`;
    const competitorLine =
      competitorCount > 0
        ? `Tracking ${competitorCount} local competitor${competitorCount === 1 ? "" : "s"} you flagged.`
        : "";
    const messageBody = [
      `Read your last ${reviewCount} reviews.`,
      fix,
      competitorLine,
      `Tomorrow morning at 7am I'll text you yesterday's job summary + any pending review requests. Anything I should know before I start?`,
    ]
      .filter((s) => s.length > 0)
      .join(" ");
    return { messageBody };
  },
});

export const getBusinessPictureForFirstMessage = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"businessPicture"> | null> => {
    return await ctx.db
      .query("businessPicture")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
  },
});
