/**
 * Service-product fixture loader for `convex-test`.
 *
 * Other Sprint 1 agents (GBP integration, Zernio integration, .md skills)
 * import this file to seed a realistic businesses + reviews + jobs +
 * customers + photos + brand-voice + contracts state into a convex-test
 * harness, then run their production code unchanged against it.
 *
 * Usage:
 *   ```ts
 *   import { convexTest } from "convex-test";
 *   import schema from "../schema";
 *   import { modules } from "../../tests/_modules";
 *   import { seedSingleBusiness, seedServiceBusinesses } from "../_test/serviceFixtures";
 *
 *   const t = convexTest(schema, modules);
 *   const { businessId } = await seedSingleBusiness(t, "mike");
 *   // ... run production code that queries by businessId
 *   ```
 *
 * Why this lives at `convex/_test/`:
 *   - Convex's deploy analyzer skips paths that begin with `_` so this file
 *     never ships to production. The `tests/sprint1Acceptance.test.ts` TODO
 *     grep also excludes `_test/`.
 *   - Importing from inside `convex/__tests__/*.test.ts` resolves cleanly
 *     under vite + tsc without any path-alias gymnastics.
 *   - This file does NOT use `import.meta.glob` (which is reserved for
 *     `tests/_modules.ts` per the architectural note in that file). It
 *     accepts the convex-test instance + does data inserts only.
 *
 * What it does NOT do:
 *   - Does not provision Twilio numbers, deploy Maya, or hit external APIs.
 *   - Does not seed creator-side rows (those live in their own loader).
 *   - Does not write to `mediaAssets` (that table requires a Gemini-cataloged
 *     blob; cataloger lands Sprint 3.5). Photo fixtures land in
 *     `serviceContent` only.
 */

import type { convexTest } from "convex-test";
import type { Id } from "../_generated/dataModel";
import {
  generateAllBusinesses,
  generateAnchor,
  DEFAULT_ROOT_SEED,
} from "../../scripts/fixtures/serviceBusinesses/generate";
import type {
  FixtureBusiness,
  Persona,
} from "../../scripts/fixtures/serviceBusinesses/types";

/**
 * The actual `convex-test` instance shape. Mirrors the existing creator-side
 * pattern (e.g. `convex/agents/packs/maya/__tests__/configGeneratorMaya.test.ts`,
 * `convex/integrations/zernio/__tests__/oauth.test.ts`): every test file
 * types its `t` parameter as `ReturnType<typeof convexTest>`. Using the real
 * type lets callers pass their `convexTest(schema, modules)` result without
 * structural-narrowing TS2345 errors.
 */
type ConvexTestInstance = ReturnType<typeof convexTest>;

export interface SeededBusinessRefs {
  /** Slug used to find the fixture. Stable across runs. */
  slug: string;
  /** Persona anchor or null. */
  persona: Persona | null;
  accountId: Id<"creators">;
  businessId: Id<"businesses">;
  gbpLocationIds: Id<"gbpLocations">[];
  customerIds: Id<"serviceCustomers">[];
  jobIds: Id<"serviceJobs">[];
  reviewIds: Id<"reviews">[];
  contentIds: Id<"serviceContent">[];
  crmConnectionIds: Id<"crmConnections">[];
  /** Pointer back to the source fixture for prose-content assertions. */
  fixture: FixtureBusiness;
}

const NOW = 1_700_000_000_000;

/**
 * Load one fixture business into convex-test. Returns every Id the caller
 * might need to chain follow-up queries off of.
 */
export async function loadFixture(
  t: ConvexTestInstance,
  fixture: FixtureBusiness
): Promise<SeededBusinessRefs> {
  const refs = await t.run(async (ctx) => {
    // 1) account row (creators table)
    const accountId = (await ctx.db.insert("creators", {
      clerkUserId: fixture.clerkUserId,
      email: fixture.email,
      channelPreference: fixture.channelPreference,
      timezone: fixture.timezone,
      status: "active",
      plan: fixture.plan,
      accountType: "service-business",
      createdAt: NOW,
    })) as Id<"creators">;

    // 2) business row — link via accountId
    const businessId = (await ctx.db.insert("businesses", {
      accountId,
      name: fixture.businessName,
      serviceTypes: fixture.serviceTypes,
      serviceAreaPolygon: fixture.serviceAreaPolygon,
      ticketSizeBucket: fixture.ticketSizeBucket,
      businessSize: fixture.businessSize,
      tonePreference: fixture.tonePreference,
      responseSpeed: fixture.responseSpeed,
      voiceEnabled: fixture.voiceEnabled,
      twilioNumber: fixture.twilioNumber,
      planTier: fixture.planTier,
      trialEndsAt: fixture.trialEndsAt,
      createdAt: NOW,
      updatedAt: NOW,
    })) as Id<"businesses">;

    // 3) patch the back-pointer on creators
    await ctx.db.patch(accountId, { businessId });

    // 4) businessPicture (one row)
    await ctx.db.insert("businessPicture", {
      businessId,
      brandVoice: fixture.businessPicture.brandVoice,
      customerSentiment: fixture.businessPicture.customerSentiment,
      recurringServicePatterns: fixture.businessPicture.recurringServicePatterns,
      localCompetitors: fixture.businessPicture.localCompetitors,
      generatedAt: NOW,
      model: "gemini-3-flash-preview",
      sourceCitations: [
        {
          platform: "gbp",
          externalId: `${fixture.slug}-summary`,
          usedFor: "businessPicture-summary",
        },
      ],
    });

    // 5) gbpLocations rows
    const gbpLocationIds: Id<"gbpLocations">[] = [];
    for (const loc of fixture.gbpLocations) {
      const id = (await ctx.db.insert("gbpLocations", {
        businessId,
        gbpLocationId: loc.gbpLocationId,
        gbpAccountId: loc.gbpAccountId,
        address: loc.address,
        primaryCategory: loc.primaryCategory,
        verifiedAt: loc.verifiedAt,
        ownerEmail: loc.ownerEmail,
        createdAt: NOW,
      })) as Id<"gbpLocations">;
      gbpLocationIds.push(id);
    }

    // 6) crmConnections rows
    const crmConnectionIds: Id<"crmConnections">[] = [];
    for (const conn of fixture.crmConnections) {
      const id = (await ctx.db.insert("crmConnections", {
        businessId,
        provider: conn.provider,
        scopes: conn.scopes,
        lastSyncAt: conn.lastSyncAt ?? undefined,
        planTierWarning: conn.planTierWarning ?? undefined,
        createdAt: NOW,
        updatedAt: NOW,
      })) as Id<"crmConnections">;
      crmConnectionIds.push(id);
    }

    // 7) serviceCustomers rows — slug → Id map for job/review wiring
    const customerSlugToId = new Map<string, Id<"serviceCustomers">>();
    const customerIds: Id<"serviceCustomers">[] = [];
    for (const c of fixture.customers) {
      const id = (await ctx.db.insert("serviceCustomers", {
        businessId,
        crmCustomerId: c.crmCustomerId ?? undefined,
        name: c.name,
        phone: c.phone,
        email: c.email,
        address: c.address,
        lifetimeValueUsd: c.lifetimeValueUsd,
        lastJobAt: c.lastJobAt,
        reviewStatus: c.reviewStatus,
        createdAt: NOW,
        updatedAt: NOW,
      })) as Id<"serviceCustomers">;
      customerSlugToId.set(c.slug, id);
      customerIds.push(id);
    }

    // 8) serviceJobs rows — resolve customerSlug → Id
    const jobIds: Id<"serviceJobs">[] = [];
    for (const j of fixture.jobs) {
      const customerId = customerSlugToId.get(j.customerSlug);
      const id = (await ctx.db.insert("serviceJobs", {
        businessId,
        customerId,
        crmJobId: j.crmJobId ?? undefined,
        status: j.status,
        scheduledAt: j.scheduledAt,
        completedAt: j.completedAt,
        technicianName: j.technicianName,
        serviceType: j.serviceType,
        ticketAmountUsd: j.ticketAmountUsd,
        photos: [],
        notes: j.notes,
        createdAt: NOW,
        updatedAt: NOW,
      })) as Id<"serviceJobs">;
      jobIds.push(id);
    }

    // 9) reviews rows
    const reviewIds: Id<"reviews">[] = [];
    for (const r of fixture.reviews) {
      const id = (await ctx.db.insert("reviews", {
        businessId,
        gbpLocationId: r.platform === "gbp" ? gbpLocationIds[0] : undefined,
        platform: r.platform,
        externalReviewId: r.externalReviewId,
        reviewerName: r.reviewerName,
        starRating: r.starRating,
        body: r.body,
        sentiment: r.sentiment,
        receivedAt: r.receivedAt,
      })) as Id<"reviews">;
      reviewIds.push(id);
    }

    // 10) serviceContent rows (5 photos per fixture)
    const contentIds: Id<"serviceContent">[] = [];
    for (const p of fixture.photos) {
      const id = (await ctx.db.insert("serviceContent", {
        businessId,
        type: "photo",
        uploadedBy: "operator",
        originalUrl: p.url,
        jobId: p.jobIdx !== undefined ? jobIds[p.jobIdx] : undefined,
        tags: p.tags,
        createdAt: NOW,
      })) as Id<"serviceContent">;
      contentIds.push(id);
    }

    return {
      accountId,
      businessId,
      gbpLocationIds,
      customerIds,
      jobIds,
      reviewIds,
      contentIds,
      crmConnectionIds,
    };
  });

  return {
    slug: fixture.slug,
    persona: fixture.persona,
    fixture,
    ...refs,
  };
}

/**
 * Seed all 50 fixtures (or the first `count`). Returns a SeededBusinessRefs[]
 * sorted by fixture slug — stable iteration order means tests can rely on
 * `refs[0]` always being the same fixture across runs.
 *
 * Default `count` is the full corpus. The acceptance budget for the full
 * load is <5s on a developer laptop (verified by serviceFixtures.test.ts).
 */
export async function seedServiceBusinesses(
  t: ConvexTestInstance,
  count?: number,
  rootSeed: number | string = DEFAULT_ROOT_SEED
): Promise<SeededBusinessRefs[]> {
  const all = generateAllBusinesses(rootSeed);
  const fixtures = count !== undefined ? all.slice(0, count) : all;
  const out: SeededBusinessRefs[] = [];
  for (const f of fixtures) {
    out.push(await loadFixture(t, f));
  }
  return out;
}

/**
 * Seed a single anchor persona. Lightweight entry point that other agents'
 * tests use:
 *
 *   ```ts
 *   const { businessId, fixture } = await seedSingleBusiness(t, "mike");
 *   ```
 */
export async function seedSingleBusiness(
  t: ConvexTestInstance,
  persona: Persona,
  rootSeed: number | string = DEFAULT_ROOT_SEED
): Promise<SeededBusinessRefs> {
  const fixture = generateAnchor(persona, rootSeed);
  return loadFixture(t, fixture);
}
