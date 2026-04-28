/**
 * smokeFixtures/serviceBusiness — fixture creation + teardown helpers used
 * by the live-mode service smoke (`scripts/service-mvp-smoke.ts --live`).
 *
 * SCOPE — these are `internal*` so they're only callable with admin auth
 * via `ConvexHttpClient.setAdminAuth`. They are NOT a public surface and
 * MUST NEVER be exposed via a `query` or `action` handler. Smoke fixtures
 * write rows that look like a real business; if a non-admin path could
 * call these, every business in production would be at risk.
 *
 * Cross-tenant: the fixture writes scoped to a deterministic clerk-id
 * (`smoke_<timestamp>_<randhex>`) + creator + business + businessPicture.
 * Teardown deletes by businessId then by accountId — every row in every
 * service-side table indexed by `by_business` cascades. Sibling-file
 * scan (`tests/sprint1Acceptance.test.ts` cross-tenant suite) verifies
 * no production code accidentally reads `_test/` or `smokeFixtures/`.
 *
 * What the smoke creates here (minimum viable for `deployServiceMaya`):
 *   1. A `creators` row with `accountType: "service-business"` + a
 *      `businessId` pointer (set after step 2 via patch).
 *   2. A `businesses` row referencing the creator via `accountId`.
 *   3. A `businessPicture` row (Gemini-synthesis output stub).
 *
 * The deploy action (`deployServiceMaya`) reads these three. It does
 * NOT require gbpLocations / serviceJobs / reviews / etc. for the
 * boot path; those are runtime-populated. The smoke validates the
 * deploy contract, not the full operator journey.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalAction,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { FlyClient } from "../lib/flyClient";

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

export const createServiceFixture = internalMutation({
  args: {
    /** Optional override for deterministic re-seeding; default mints a fresh id. */
    clerkUserId: v.optional(v.string()),
    /** Defaults to 'pro' for full-surface deploy coverage. */
    planTier: v.optional(
      v.union(v.literal("starter"), v.literal("pro"), v.literal("studio"))
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    creatorId: Id<"creators">;
    businessId: Id<"businesses">;
    clerkUserId: string;
  }> => {
    const now = Date.now();
    const clerkUserId =
      args.clerkUserId ??
      `smoke_${now}_${Math.random().toString(36).slice(2, 10)}`;
    const planTier = args.planTier ?? "pro";

    // 1. creators row — service-business account.
    const creatorId = await ctx.db.insert("creators", {
      clerkUserId,
      email: `${clerkUserId}@heymaya.smoke`,
      channelPreference: "sms",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      // creator-side `plan` field is required; mirror the service tier for
      // consistency. The two enums share the same string values.
      plan: planTier,
      accountType: "service-business",
      createdAt: now,
    });

    // 2. businesses row — the smoke target.
    const businessId = await ctx.db.insert("businesses", {
      accountId: creatorId,
      name: `Smoke Business ${now}`,
      serviceTypes: ["hvac"],
      ticketSizeBucket: "500-2k",
      businessSize: "solo",
      tonePreference: "friendly-neighborhood",
      responseSpeed: "within-30-min",
      voiceEnabled: false,
      planTier,
      createdAt: now,
      updatedAt: now,
    });

    // 3. patch the creator with the business pointer (the deploy reads
    //    `creators.businessId` via getMyBusinessForOAuth in some paths).
    await ctx.db.patch(creatorId, { businessId });

    // 4. businessPicture — minimal viable synthesis output. The deploy
    //    reads brandVoice + recurringServicePatterns to build SOUL.md.
    await ctx.db.insert("businessPicture", {
      businessId,
      brandVoice:
        "warm, neighborly, no-jargon HVAC technician — explains what's happening before doing it, gives a fixed price up front, never upsells",
      customerSentiment:
        "highly positive; reviews repeatedly mention punctuality + clean work + fair pricing",
      recurringServicePatterns: [
        "summer A/C tune-ups",
        "winter furnace replacements",
        "emergency no-cool calls",
      ],
      localCompetitors: ["Acme HVAC", "BlueAir Cooling"],
      generatedAt: now,
      model: "smoke-fixture-stub",
      sourceCitations: [
        {
          platform: "gbp",
          externalId: "smoke-gbp-fixture",
          usedFor: "brandVoice",
        },
      ],
    });

    return { creatorId, businessId, clerkUserId };
  },
});

/* -------------------------------------------------------------------------- */
/* Destroy (cascade)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Cascade-delete every row a smoke fixture could have produced for one
 * businessId. Idempotent — safe to call against a partially-deleted
 * fixture or one that already had production-style rows added by a
 * smoke run (deploy result, telemetry, etc.).
 *
 * Tables we sweep, in dependency order:
 *   - businessPicture, voiceChannels, gbpLocations, serviceCustomers,
 *     serviceJobs, mediaAssets, reviews, reviewRequests, gbpPosts,
 *     inboundLeads, mayaTaskQueue, serviceTelemetry, gbpHealthScores,
 *     learningsExtractor, weeklyLearnings, wikiProjections, aiCallLog,
 *     crmConnections, crmWebhookEvents, serviceContent, contentArcs,
 *     attributionLinks, scheduledChanges
 *   - businesses (the row itself)
 *   - creators (the account-level row)
 *
 * Each table is queried via its `by_business` index (or equivalent).
 * If a table doesn't exist or doesn't index by business, this helper
 * just skips it — the goal is best-effort cascade, not bulletproof.
 */
export const destroyServiceFixture = internalMutation({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<{ deletedCounts: Record<string, number> }> => {
    const counts: Record<string, number> = {};

    // The sweep is dynamic over many tables; each table's schema differs.
    // We reach for a single any-cast on `ctx.db` to keep this readable;
    // strictness isn't load-bearing for an admin-only fixture cleanup.
    type AnyDb = {
      query: (table: string) => {
        withIndex: (
          n: string,
          q: (b: { eq: (k: string, v: unknown) => unknown }) => unknown
        ) => { collect: () => Promise<Array<{ _id: unknown }>> };
      };
      delete: (id: unknown) => Promise<void>;
    };
    const db = ctx.db as unknown as AnyDb;

    async function sweepBy(table: string, indexName: string): Promise<void> {
      try {
        const rows = await db
          .query(table)
          .withIndex(indexName, (q) => q.eq("businessId", args.businessId))
          .collect();
        for (const row of rows) await db.delete(row._id);
        counts[table] = rows.length;
      } catch {
        // Table missing or index missing — non-fatal for a fixture sweep.
      }
    }

    // Best-effort sweep of every service-side table that indexes by businessId.
    await sweepBy("businessPicture", "by_business");
    await sweepBy("voiceChannels", "by_business");
    await sweepBy("gbpLocations", "by_business");
    await sweepBy("serviceCustomers", "by_business");
    await sweepBy("serviceJobs", "by_business");
    await sweepBy("mediaAssets", "by_business_and_received_at");
    await sweepBy("reviews", "by_business");
    await sweepBy("reviewRequests", "by_business");
    await sweepBy("gbpPosts", "by_business");
    await sweepBy("inboundLeads", "by_business");
    await sweepBy("mayaTaskQueue", "by_business");
    await sweepBy("serviceTelemetry", "by_business");
    await sweepBy("gbpHealthScores", "by_business");
    await sweepBy("weeklyLearnings", "by_business");
    await sweepBy("wikiProjections", "by_business");
    await sweepBy("crmConnections", "by_business");
    await sweepBy("crmWebhookEvents", "by_business");
    await sweepBy("serviceContent", "by_business");
    await sweepBy("contentArcs", "by_business");
    await sweepBy("attributionLinks", "by_business");
    await sweepBy("scheduledChanges", "by_business");

    // Resolve + delete the businesses row + its owning creator.
    const business = await ctx.db.get(args.businessId);
    if (business) {
      const accountId = (business as Doc<"businesses">).accountId;
      await ctx.db.delete(args.businessId);
      counts.businesses = 1;
      try {
        await ctx.db.delete(accountId);
        counts.creators = 1;
      } catch {
        counts.creators = 0;
      }
    } else {
      counts.businesses = 0;
      counts.creators = 0;
    }

    return { deletedCounts: counts };
  },
});

/* -------------------------------------------------------------------------- */
/* Destroy + Fly app teardown                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Combined teardown — destroys the Fly app (best-effort) AND cascades the
 * Convex rows. Used by the smoke's finally-block so a single call leaves
 * no Fly machines or orphaned rows behind.
 */
export const destroyServiceFixtureWithFly = internalAction({
  args: {
    /**
     * If set, the row sweep runs against this business + cascades the
     * creator. If omitted, the smoke is using an operator-supplied real
     * business and we MUST NOT wipe its rows — only the Fly app is
     * destroyed in that case.
     */
    businessId: v.optional(v.id("businesses")),
    /** Optional — if a deploy succeeded, the smoke passes this in. */
    flyAppId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    flyAppDestroyed: boolean;
    flyError: string | null;
    deletedCounts: Record<string, number>;
  }> => {
    let flyAppDestroyed = false;
    let flyError: string | null = null;
    if (args.flyAppId) {
      try {
        const fly = new FlyClient();
        await fly.destroyApp(args.flyAppId);
        flyAppDestroyed = true;
      } catch (err) {
        flyError = err instanceof Error ? err.message : String(err);
      }
    }
    let deletedCounts: Record<string, number> = {};
    if (args.businessId) {
      const sweep = await ctx.runMutation(
        internal.smokeFixtures.serviceBusiness.destroyServiceFixture,
        { businessId: args.businessId }
      );
      deletedCounts = sweep.deletedCounts;
    }
    return {
      flyAppDestroyed,
      flyError,
      deletedCounts,
    };
  },
});
