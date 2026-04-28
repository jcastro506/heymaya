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
  internalQuery,
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

/* -------------------------------------------------------------------------- */
/* Soak harness — realistic data seeding + event injection                     */
/* -------------------------------------------------------------------------- */

const SOAK_FIRST_NAMES = [
  "Mike",
  "Sarah",
  "James",
  "Emily",
  "David",
  "Linda",
  "Robert",
  "Jennifer",
  "Tom",
  "Karen",
];
const SOAK_LAST_NAMES = [
  "Johnson",
  "Smith",
  "Garcia",
  "Williams",
  "Brown",
  "Davis",
  "Miller",
  "Wilson",
  "Anderson",
  "Taylor",
];
const SOAK_SERVICE_TYPES = [
  "AC tune-up",
  "AC repair",
  "furnace replacement",
  "furnace tune-up",
  "thermostat install",
  "ductwork inspection",
  "emergency no-cool",
  "heat pump repair",
];
const SOAK_REVIEW_BODIES_5 = [
  "Mike was on time and explained everything before doing anything. Fair price, fast work, no upsell. Highly recommend.",
  "Showed up exactly when he said. AC running cold again within an hour. Great experience.",
  "Honest, knowledgeable, and reasonably priced. Will use again.",
  "Best HVAC tech we've had. Cleaned up after himself and walked us through the whole repair.",
  "Mike fixed our furnace on a Sunday in January. Truly went above and beyond.",
];
const SOAK_REVIEW_BODIES_4 = [
  "Good service, slight delay getting here but the work was solid.",
  "Knew what he was doing. Took a bit longer than estimated but I'd hire again.",
];
const SOAK_REVIEW_BODIES_3 = [
  "It was OK. Got the job done but communication could be better.",
];

function rng(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Seed a soak-target business with realistic data: 1 GBP location, 50
 * historical reviews, 10 customers, 20 service jobs (mix of completed +
 * scheduled). Deterministic via seed = businessId. Idempotent — safe to
 * re-run; second call detects existing rows + adds nothing.
 */
export const seedSoakData = internalMutation({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    seeded: boolean;
    counts: {
      gbpLocation: number;
      customers: number;
      jobs: number;
      reviews: number;
    };
  }> => {
    // Idempotent: if we've already seeded (>0 reviews), skip.
    const existingReview = await ctx.db
      .query("reviews")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    if (existingReview) {
      const counts = await Promise.all([
        ctx.db
          .query("gbpLocations")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId)
          )
          .collect(),
        ctx.db
          .query("serviceCustomers")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId)
          )
          .collect(),
        ctx.db
          .query("serviceJobs")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId)
          )
          .collect(),
        ctx.db
          .query("reviews")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId)
          )
          .collect(),
      ]);
      return {
        seeded: false,
        counts: {
          gbpLocation: counts[0].length,
          customers: counts[1].length,
          jobs: counts[2].length,
          reviews: counts[3].length,
        },
      };
    }

    const random = rng(String(args.businessId));
    const pick = <T>(arr: ReadonlyArray<T>): T =>
      arr[Math.floor(random() * arr.length)];
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // 1. GBP location.
    const gbpLocationId = await ctx.db.insert("gbpLocations", {
      businessId: args.businessId,
      gbpLocationId: `soak-gbp-${args.businessId}`,
      gbpAccountId: `soak-acc-${args.businessId}`,
      address: "123 Main St, Boise, ID 83702",
      primaryCategory: "HVAC contractor",
      verifiedAt: now - 547 * ONE_DAY,
      ownerEmail: "soak@heymaya.smoke",
      createdAt: now - 547 * ONE_DAY,
    });

    // 2. 10 customers.
    const customerIds: Id<"serviceCustomers">[] = [];
    for (let i = 0; i < 10; i++) {
      const first = pick(SOAK_FIRST_NAMES);
      const last = pick(SOAK_LAST_NAMES);
      const id = await ctx.db.insert("serviceCustomers", {
        businessId: args.businessId,
        name: `${first} ${last}`,
        phone: `+1-208-555-${String(1000 + i).padStart(4, "0")}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
        address: `${100 + i * 7} Oak St, Boise, ID 83702`,
        lifetimeValueUsd: Math.floor(random() * 5000) + 250,
        lastJobAt: now - Math.floor(random() * 365) * ONE_DAY,
        reviewStatus: i < 4 ? "left" : i < 7 ? "asked" : "not-yet",
        createdAt: now - Math.floor(random() * 730) * ONE_DAY,
        updatedAt: now,
      });
      customerIds.push(id);
    }

    // 3. 20 jobs — 14 completed, 4 scheduled, 2 in-progress.
    let jobCount = 0;
    for (let i = 0; i < 20; i++) {
      const customerId = customerIds[i % customerIds.length];
      const completedAgoDays = Math.floor(random() * 180);
      const status =
        i < 14 ? "completed" : i < 18 ? "scheduled" : "in-progress";
      await ctx.db.insert("serviceJobs", {
        businessId: args.businessId,
        customerId,
        status,
        scheduledAt: now - completedAgoDays * ONE_DAY,
        completedAt:
          status === "completed"
            ? now - completedAgoDays * ONE_DAY + 4 * 60 * 60 * 1000
            : undefined,
        technicianName: "Mike",
        serviceType: pick(SOAK_SERVICE_TYPES),
        ticketAmountUsd: Math.floor(random() * 2000) + 200,
        photos: [],
        notes: undefined,
        createdAt: now - (completedAgoDays + 1) * ONE_DAY,
        updatedAt: now - completedAgoDays * ONE_DAY,
      });
      jobCount++;
    }

    // 4. 50 reviews — distribution: 35 5-star, 10 4-star, 5 3-star.
    let reviewCount = 0;
    for (let i = 0; i < 50; i++) {
      const stars = i < 35 ? 5 : i < 45 ? 4 : 3;
      const body =
        stars === 5
          ? pick(SOAK_REVIEW_BODIES_5)
          : stars === 4
            ? pick(SOAK_REVIEW_BODIES_4)
            : pick(SOAK_REVIEW_BODIES_3);
      const receivedAt = now - Math.floor(random() * 547) * ONE_DAY;
      await ctx.db.insert("reviews", {
        businessId: args.businessId,
        gbpLocationId,
        platform: "gbp",
        externalReviewId: `soak-rev-${i}-${args.businessId}`,
        reviewerName: `${pick(SOAK_FIRST_NAMES)} ${pick(SOAK_LAST_NAMES)}`,
        starRating: stars,
        body,
        sentiment: stars >= 4 ? "positive" : "neutral",
        receivedAt,
      });
      reviewCount++;
    }

    return {
      seeded: true,
      counts: {
        gbpLocation: 1,
        customers: customerIds.length,
        jobs: jobCount,
        reviews: reviewCount,
      },
    };
  },
});

/**
 * Inject a synthetic job-completed event. Calls the production
 * `upsertJobFromWebhook` flow with a synthetic normalized job so the
 * downstream behaviors fire identically to a real CRM webhook.
 */
export const injectJobCompleted = internalMutation({
  args: {
    businessId: v.id("businesses"),
    /** Optional override; default picks from the pool. */
    customerName: v.optional(v.string()),
    serviceType: v.optional(v.string()),
    ticketAmountUsd: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ jobId: Id<"serviceJobs"> }> => {
    const random = rng(`${args.businessId}-${Date.now()}-${Math.random()}`);
    const pick = <T>(arr: ReadonlyArray<T>): T =>
      arr[Math.floor(random() * arr.length)];
    const first = pick(SOAK_FIRST_NAMES);
    const last = pick(SOAK_LAST_NAMES);
    const customerName = args.customerName ?? `${first} ${last}`;
    const serviceType = args.serviceType ?? pick(SOAK_SERVICE_TYPES);
    const ticketAmountUsd =
      args.ticketAmountUsd ?? Math.floor(random() * 1500) + 250;
    const externalJobId = `soak-job-${Date.now()}-${Math.floor(random() * 9999)}`;

    // Match upsertJobFromWebhook contract via direct insert (simpler than
    // round-tripping the action call from another mutation).
    const customerId = await ctx.db.insert("serviceCustomers", {
      businessId: args.businessId,
      name: customerName,
      phone: `+1-208-555-${String(Math.floor(random() * 9000) + 1000)}`,
      email: undefined,
      address: undefined,
      reviewStatus: "not-yet",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const jobId = await ctx.db.insert("serviceJobs", {
      businessId: args.businessId,
      customerId,
      crmJobId: externalJobId,
      status: "completed",
      scheduledAt: Date.now() - 4 * 60 * 60 * 1000,
      completedAt: Date.now(),
      technicianName: "Mike",
      serviceType,
      ticketAmountUsd,
      photos: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Enqueue a job-completed task for Maya's queue. The skill on the
    // Fly machine polls this queue.
    await ctx.db.insert("mayaTaskQueue", {
      businessId: args.businessId,
      kind: "job-completed",
      payload: {
        jobId,
        customerId,
        source: "crm-webhook",
        provider: "jobber",
      },
      source: "crm-webhook",
      enqueuedAt: Date.now(),
      attemptCount: 0,
    });

    return { jobId };
  },
});

/**
 * Inject a synthetic GBP review. Creates a `reviews` row + enqueues
 * review-reply task.
 */
export const injectGbpReview = internalMutation({
  args: {
    businessId: v.id("businesses"),
    starRating: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ reviewId: Id<"reviews"> }> => {
    const random = rng(`${args.businessId}-${Date.now()}-${Math.random()}`);
    const pick = <T>(arr: ReadonlyArray<T>): T =>
      arr[Math.floor(random() * arr.length)];
    const stars = args.starRating ?? (random() < 0.85 ? 5 : random() < 0.7 ? 4 : 3);
    const body =
      stars === 5
        ? pick(SOAK_REVIEW_BODIES_5)
        : stars === 4
          ? pick(SOAK_REVIEW_BODIES_4)
          : pick(SOAK_REVIEW_BODIES_3);
    const gbpLoc = await ctx.db
      .query("gbpLocations")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    const reviewId = await ctx.db.insert("reviews", {
      businessId: args.businessId,
      gbpLocationId: gbpLoc?._id,
      platform: "gbp",
      externalReviewId: `soak-rev-injected-${Date.now()}`,
      reviewerName: `${pick(SOAK_FIRST_NAMES)} ${pick(SOAK_LAST_NAMES)}`,
      starRating: stars,
      body,
      sentiment: stars >= 4 ? "positive" : "neutral",
      receivedAt: Date.now(),
    });

    await ctx.db.insert("mayaTaskQueue", {
      businessId: args.businessId,
      kind: "review-arrived",
      payload: { reviewId, stars },
      source: "manual",
      enqueuedAt: Date.now(),
      attemptCount: 0,
    });

    return { reviewId };
  },
});

/**
 * Soak snapshot — aggregated telemetry suitable for rolling dashboards.
 * Reads aiCallLog (cost + latency + token counts), serviceTelemetry
 * (counts by signal), mayaTaskQueue (work-in-flight), and behavior
 * outputs (drafted reviews/posts/replies).
 */
export const getSoakSnapshot = internalQuery({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    nowMs: number;
    business: { mayaFlyAppId: string | null; planTier: string };
    ai: {
      calls: number;
      totalCostUsd: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      latencyP50Ms: number;
      latencyP95Ms: number;
      byTaskTag: Record<string, number>;
    };
    queue: {
      enqueued: number;
      processed: number;
      failed: number;
      byKind: Record<string, number>;
    };
    telemetry: {
      total: number;
      bySignal: Record<string, number>;
    };
    behaviors: {
      reviewsTotal: number;
      reviewsDrafted: number;
      reviewsApproved: number;
      reviewsPosted: number;
      reviewRequestsTotal: number;
      reviewRequestsSent: number;
      gbpPostsTotal: number;
      gbpPostsDrafted: number;
    };
  }> => {
    const business = await ctx.db.get(args.businessId);
    if (!business) {
      throw new Error(`getSoakSnapshot: business ${args.businessId} not found`);
    }

    // AI call log — keyed by creatorId.
    const accountId = (business as Doc<"businesses">).accountId;
    const aiCalls = await ctx.db
      .query("aiCallLog")
      .withIndex("by_creator", (q) => q.eq("creatorId", accountId))
      .collect();
    const latencies = aiCalls.map((c) => c.latencyMs).sort((a, b) => a - b);
    const p = (q: number): number => {
      if (latencies.length === 0) return 0;
      const i = Math.min(
        latencies.length - 1,
        Math.floor(latencies.length * q)
      );
      return latencies[i];
    };
    const byTaskTag: Record<string, number> = {};
    for (const c of aiCalls) byTaskTag[c.taskTag] = (byTaskTag[c.taskTag] ?? 0) + 1;

    // Queue.
    const queueRows = await ctx.db
      .query("mayaTaskQueue")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const byKind: Record<string, number> = {};
    let processed = 0;
    let failed = 0;
    for (const r of queueRows) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      if (r.processedAt !== undefined) processed++;
      if (r.failedAt !== undefined) failed++;
    }

    // Telemetry.
    const telemetryRows = await ctx.db
      .query("serviceTelemetry")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const bySignal: Record<string, number> = {};
    for (const r of telemetryRows) bySignal[r.signal] = (bySignal[r.signal] ?? 0) + 1;

    // Behavior outputs.
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const reviewRequests = await ctx.db
      .query("reviewRequests")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    let gbpPosts: Doc<"gbpPosts">[] = [];
    try {
      gbpPosts = await ctx.db
        .query("gbpPosts")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .collect();
    } catch {
      /* table may not exist in this schema version */
    }

    return {
      nowMs: Date.now(),
      business: {
        mayaFlyAppId: (business as Doc<"businesses">).mayaFlyAppId ?? null,
        planTier: (business as Doc<"businesses">).planTier ?? "starter",
      },
      ai: {
        calls: aiCalls.length,
        totalCostUsd: aiCalls.reduce((s, c) => s + (c.costUsd ?? 0), 0),
        totalInputTokens: aiCalls.reduce((s, c) => s + c.inputTokens, 0),
        totalOutputTokens: aiCalls.reduce((s, c) => s + c.outputTokens, 0),
        latencyP50Ms: p(0.5),
        latencyP95Ms: p(0.95),
        byTaskTag,
      },
      queue: {
        enqueued: queueRows.length,
        processed,
        failed,
        byKind,
      },
      telemetry: {
        total: telemetryRows.length,
        bySignal,
      },
      behaviors: {
        reviewsTotal: reviews.length,
        reviewsDrafted: reviews.filter((r) => r.replyStatus === "drafted").length,
        reviewsApproved: reviews.filter((r) => r.replyStatus === "approved").length,
        reviewsPosted: reviews.filter((r) => r.replyStatus === "posted").length,
        reviewRequestsTotal: reviewRequests.length,
        reviewRequestsSent: reviewRequests.filter((r) => r.status === "sent")
          .length,
        gbpPostsTotal: gbpPosts.length,
        gbpPostsDrafted: gbpPosts.filter((p) => p.status === "draft").length,
      },
    };
  },
});
