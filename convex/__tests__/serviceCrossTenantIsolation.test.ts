/**
 * Service product Sprint 0 — cross-tenant isolation acceptance test.
 *
 * Source of truth: docs/SPRINT_PLAN_SERVICE_V0.md § 8 + § 13 Sprint 0.
 *
 * What this test enforces:
 *   - Every business-scoped service-side table indexed `by_business` returns
 *     ONLY rows scoped to the queried `businessId`. Business A's rows must
 *     never be visible from a Business B context.
 *   - The `accountType` discriminator on the `creators` table coexists with
 *     the existing creator-side rows (additive — does not break creator
 *     queries that don't filter on accountType).
 *
 * Five mandatory test categories per
 *   /Users/joshcastro/.claude/projects/.../memory/feedback_validation_gap_prevention.md:
 *   1. Cross-tenant — THIS FILE.
 *   2. Plan-tier × action matrix — convex/__tests__/planService.test.ts.
 *   3. Adversarial — convex/__tests__/serviceAdversarial.test.ts +
 *      planService.test.ts adversarial section.
 *   4. Sibling-file scan — convex/__tests__/serviceSchemaShape.test.ts (the
 *      service-side parallel to tests/sprint1Acceptance.test.ts) — Sprint 0
 *      ships the schema-shape scan; the cron/skill sibling scan kicks in at
 *      Sprint 3 when the .md layer + skills land.
 *   5. TODO grep — covered repo-wide by tests/sprint1Acceptance.test.ts.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";

const NOW = 1_700_000_000_000;

/**
 * Build two distinct service-business accounts (A and B) under separate
 * Clerk identities, with the additive `accountType: "service-business"` set.
 * Returns the two `businesses._id`s for cross-tenant assertions below.
 */
async function setupTwoBusinesses(
  t: ReturnType<typeof convexTest>
): Promise<{ a: Id<"businesses">; b: Id<"businesses"> }> {
  const accountA = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: "u_business_a",
      email: "a@business.test",
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "coach",
      accountType: "service-business",
      createdAt: NOW,
    })
  );
  const accountB = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: "u_business_b",
      email: "b@business.test",
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "coach",
      accountType: "service-business",
      createdAt: NOW,
    })
  );
  const a = await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId: accountA,
      name: "ABC HVAC",
      serviceTypes: ["hvac"],
      createdAt: NOW,
      updatedAt: NOW,
      planTier: "starter",
    })
  );
  const b = await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId: accountB,
      name: "XYZ Plumbing",
      serviceTypes: ["plumbing"],
      createdAt: NOW,
      updatedAt: NOW,
      planTier: "pro",
    })
  );
  await t.run((ctx) => ctx.db.patch(accountA, { businessId: a }));
  await t.run((ctx) => ctx.db.patch(accountB, { businessId: b }));
  return { a, b };
}

/* -------------------------------------------------------------------------- */
/* The big grid — every business-scoped table cross-tenant tested              */
/* -------------------------------------------------------------------------- */

describe("Service Sprint 0 — cross-tenant isolation across all business-scoped tables", () => {
  it("businesses table — by_account scoping", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    const aBiz = await t.run((ctx) => ctx.db.get(a));
    const bBiz = await t.run((ctx) => ctx.db.get(b));
    expect(aBiz?.name).toBe("ABC HVAC");
    expect(bBiz?.name).toBe("XYZ Plumbing");
    expect(aBiz?._id).not.toBe(bBiz?._id);
  });

  it("businessPicture rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    await t.run((ctx) =>
      ctx.db.insert("businessPicture", {
        businessId: a,
        brandVoice: "voice-a",
        recurringServicePatterns: [],
        localCompetitors: [],
        generatedAt: NOW,
        model: "gemini-3-flash-preview",
        sourceCitations: [],
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("businessPicture", {
        businessId: b,
        brandVoice: "voice-b",
        recurringServicePatterns: [],
        localCompetitors: [],
        generatedAt: NOW,
        model: "gemini-3-flash-preview",
        sourceCitations: [],
      })
    );

    const aRows = await t.run((ctx) =>
      ctx.db
        .query("businessPicture")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    const bRows = await t.run((ctx) =>
      ctx.db
        .query("businessPicture")
        .withIndex("by_business", (q) => q.eq("businessId", b))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].brandVoice).toBe("voice-a");
    expect(bRows).toHaveLength(1);
    expect(bRows[0].brandVoice).toBe("voice-b");
  });

  it("gbpLocations rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    await t.run((ctx) =>
      ctx.db.insert("gbpLocations", {
        businessId: a,
        gbpLocationId: "loc-a-1",
        gbpAccountId: "acc-a",
        address: "1 Main St, Austin TX",
        createdAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("gbpLocations", {
        businessId: b,
        gbpLocationId: "loc-b-1",
        gbpAccountId: "acc-b",
        address: "2 Oak St, Dallas TX",
        createdAt: NOW,
      })
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("gbpLocations")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].address).toContain("Austin");
  });

  it("serviceCustomers rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId: a,
        name: "Alice Henderson",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId: b,
        name: "Bob Wong",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].name).toBe("Alice Henderson");
  });

  it("serviceJobs rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId: a,
        status: "completed",
        photos: [],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId: b,
        status: "scheduled",
        photos: [],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    const bRows = await t.run((ctx) =>
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business", (q) => q.eq("businessId", b))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].status).toBe("completed");
    expect(bRows).toHaveLength(1);
    expect(bRows[0].status).toBe("scheduled");
  });

  it("gbpPosts rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    const locA = await t.run((ctx) =>
      ctx.db.insert("gbpLocations", {
        businessId: a,
        gbpLocationId: "loc-a",
        gbpAccountId: "acc-a",
        address: "addr-a",
        createdAt: NOW,
      })
    );
    const locB = await t.run((ctx) =>
      ctx.db.insert("gbpLocations", {
        businessId: b,
        gbpLocationId: "loc-b",
        gbpAccountId: "acc-b",
        address: "addr-b",
        createdAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("gbpPosts", {
        businessId: a,
        gbpLocationId: locA,
        status: "draft",
        text: "post-a",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("gbpPosts", {
        businessId: b,
        gbpLocationId: locB,
        status: "draft",
        text: "post-b",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("gbpPosts")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].text).toBe("post-a");
  });

  it("reviews rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId: a,
        platform: "gbp",
        externalReviewId: "rev-a-1",
        reviewerName: "alice",
        starRating: 5,
        body: "great service from A",
        receivedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("reviews", {
        businessId: b,
        platform: "gbp",
        externalReviewId: "rev-b-1",
        reviewerName: "bob",
        starRating: 4,
        body: "good service from B",
        receivedAt: NOW,
      })
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("reviews")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].body).toContain("from A");
  });

  it("reviewRequests rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    const custA = await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId: a,
        name: "Alice",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const jobA = await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId: a,
        customerId: custA,
        status: "completed",
        photos: [],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const custB = await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId: b,
        name: "Bob",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const jobB = await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId: b,
        customerId: custB,
        status: "completed",
        photos: [],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("reviewRequests", {
        businessId: a,
        jobId: jobA,
        customerId: custA,
        channel: "sms",
        status: "queued",
        followupCount: 0,
        createdAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("reviewRequests", {
        businessId: b,
        jobId: jobB,
        customerId: custB,
        channel: "email",
        status: "sent",
        followupCount: 0,
        createdAt: NOW,
      })
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("reviewRequests")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].channel).toBe("sms");
  });

  it("serviceContent rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    await t.run((ctx) =>
      ctx.db.insert("serviceContent", {
        businessId: a,
        type: "photo",
        uploadedBy: "operator",
        originalUrl: "https://r2.example/a.jpg",
        tags: [],
        createdAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("serviceContent", {
        businessId: b,
        type: "photo",
        uploadedBy: "operator",
        originalUrl: "https://r2.example/b.jpg",
        tags: [],
        createdAt: NOW,
      })
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("serviceContent")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].originalUrl).toContain("a.jpg");
  });

  it("inboundLeads rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    await t.run((ctx) =>
      ctx.db.insert("inboundLeads", {
        businessId: a,
        source: "twilio-missed-call",
        externalId: "ext-a",
        capturedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("inboundLeads", {
        businessId: b,
        source: "fb-dm",
        externalId: "ext-b",
        capturedAt: NOW,
      })
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("inboundLeads")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].source).toBe("twilio-missed-call");
  });

  it("crmConnections rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    await t.run((ctx) =>
      ctx.db.insert("crmConnections", {
        businessId: a,
        provider: "jobber",
        scopes: [],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("crmConnections", {
        businessId: b,
        provider: "qbo",
        scopes: [],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("crmConnections")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].provider).toBe("jobber");
  });

  it("voiceChannels rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    await t.run((ctx) =>
      ctx.db.insert("voiceChannels", {
        businessId: a,
        twilioNumberSid: "PNa",
        twilioPhoneNumber: "+15551110000",
        provisionedAt: NOW,
        monthlyMinutesUsed: 0,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("voiceChannels", {
        businessId: b,
        twilioNumberSid: "PNb",
        twilioPhoneNumber: "+15552220000",
        provisionedAt: NOW,
        monthlyMinutesUsed: 0,
      })
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("voiceChannels")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].twilioPhoneNumber).toBe("+15551110000");
  });

  it("mediaAssets rows are isolated + survive a same-bytes hash collision across businesses", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    // Same content hash on both sides — but the by_business_and_content_hash
    // index scopes on (businessId, contentHash) so each business has its own
    // independent hash bucket.
    const sameHash = "deadbeefcafebabe";
    await t.run((ctx) =>
      ctx.db.insert("mediaAssets", {
        businessId: a,
        storageUrl: "https://r2/a.jpg",
        storageBytes: 1234,
        mimeType: "image/jpeg",
        source: "imessage",
        receivedAt: NOW,
        contentHash: sameHash,
        catalog: {
          primarySubject: "kitchen",
          serviceCategory: "kitchen-remodel",
          visualQuality: "good",
          framingNotes: "centered",
          suggestedUses: ["GBP showcase"],
          catalogedAt: NOW,
          catalogModel: "gemini-3-flash-preview",
          catalogCostUsd: 0.02,
        },
        usageHistory: [],
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("mediaAssets", {
        businessId: b,
        storageUrl: "https://r2/b.jpg",
        storageBytes: 5678,
        mimeType: "image/jpeg",
        source: "whatsapp",
        receivedAt: NOW,
        contentHash: sameHash,
        catalog: {
          primarySubject: "bathroom",
          serviceCategory: "bathroom-remodel",
          visualQuality: "excellent",
          framingNotes: "well-lit",
          suggestedUses: ["Instagram reel"],
          catalogedAt: NOW,
          catalogModel: "gemini-3-flash-preview",
          catalogCostUsd: 0.02,
        },
        usageHistory: [],
      })
    );

    const aHashRows = await t.run((ctx) =>
      ctx.db
        .query("mediaAssets")
        .withIndex("by_business_and_content_hash", (q) =>
          q.eq("businessId", a).eq("contentHash", sameHash)
        )
        .collect()
    );
    const bHashRows = await t.run((ctx) =>
      ctx.db
        .query("mediaAssets")
        .withIndex("by_business_and_content_hash", (q) =>
          q.eq("businessId", b).eq("contentHash", sameHash)
        )
        .collect()
    );
    expect(aHashRows).toHaveLength(1);
    expect(aHashRows[0].catalog.serviceCategory).toBe("kitchen-remodel");
    expect(bHashRows).toHaveLength(1);
    expect(bHashRows[0].catalog.serviceCategory).toBe("bathroom-remodel");
  });

  it("customSkills rows are isolated", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    await t.run((ctx) =>
      ctx.db.insert("customSkills", {
        businessId: a,
        skillName: "drone-footage-cleanup",
        source: "clawhub",
        sourceUrl: "https://clawhub.ai/drone",
        version: "1.0.0",
        installedAt: NOW,
        approvedByOperator: true,
        verified: true,
        requestedPermissions: ["read-fs"],
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("customSkills", {
        businessId: b,
        skillName: "fema-claim-helper",
        source: "skills.sh",
        sourceUrl: "https://skills.sh/fema",
        version: "0.5.0",
        installedAt: NOW,
        approvedByOperator: true,
        verified: false,
        requestedPermissions: [],
      })
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("customSkills")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0].skillName).toBe("drone-footage-cleanup");
  });

  it("approvalRules rows are isolated + by_business_and_rule_type index works", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await setupTwoBusinesses(t);
    await t.run((ctx) =>
      ctx.db.insert("approvalRules", {
        businessId: a,
        ruleType: "review-request-auto-send",
        enabled: true,
        scope: { delayHours: 24 },
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("approvalRules", {
        businessId: b,
        ruleType: "gbp-post-auto-publish",
        enabled: true,
        scope: { safeContentClasses: ["before-after"] },
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    // Lookup by composite index — Business A's rule by rule type.
    const aRule = await t.run((ctx) =>
      ctx.db
        .query("approvalRules")
        .withIndex("by_business_and_rule_type", (q) =>
          q.eq("businessId", a).eq("ruleType", "review-request-auto-send")
        )
        .collect()
    );
    expect(aRule).toHaveLength(1);
    expect(aRule[0].enabled).toBe(true);
    // Same rule-type lookup against Business A returns nothing for the rule
    // type that only Business B enabled.
    const aMissing = await t.run((ctx) =>
      ctx.db
        .query("approvalRules")
        .withIndex("by_business_and_rule_type", (q) =>
          q.eq("businessId", a).eq("ruleType", "gbp-post-auto-publish")
        )
        .collect()
    );
    expect(aMissing).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Webhook events table — provider-scoped, not business-scoped (intentional) */
/* -------------------------------------------------------------------------- */

describe("Service Sprint 0 — webhookEvents idempotency dedupe", () => {
  it("(provider, externalEventId) lookup returns matching row", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("webhookEvents", {
        provider: "jobber",
        externalEventId: "evt_abc123",
        kind: "job.completed",
        processedAt: NOW,
      })
    );
    const found = await t.run((ctx) =>
      ctx.db
        .query("webhookEvents")
        .withIndex("by_provider_and_event_id", (q) =>
          q.eq("provider", "jobber").eq("externalEventId", "evt_abc123")
        )
        .collect()
    );
    expect(found).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Additive accountType extension — creator-side rows still query cleanly     */
/* -------------------------------------------------------------------------- */

describe("Service Sprint 0 — accountType is additive, doesn't break creator queries", () => {
  it("creator-side row without accountType still loads via by_clerk_user", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_legacy",
        email: "legacy@creator.test",
        channelPreference: "imessage",
        timezone: "America/Los_Angeles",
        status: "active",
        plan: "manager",
        createdAt: NOW,
        // accountType intentionally omitted — pre-migration creator row.
      })
    );
    const found = await t.run((ctx) =>
      ctx.db
        .query("creators")
        .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", "u_legacy"))
        .first()
    );
    expect(found).not.toBeNull();
    expect(found?.email).toBe("legacy@creator.test");
    expect(found?.accountType).toBeUndefined();
    expect(found?.businessId).toBeUndefined();
  });

  it("service-business row carries accountType + businessId pointer", async () => {
    const t = convexTest(schema, modules);
    const accountId = await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_svc",
        email: "svc@business.test",
        channelPreference: "sms",
        timezone: "America/Los_Angeles",
        status: "active",
        plan: "coach",
        accountType: "service-business",
        createdAt: NOW,
      })
    );
    const businessId = await t.run((ctx) =>
      ctx.db.insert("businesses", {
        accountId,
        name: "Test Co",
        serviceTypes: ["plumbing"],
        planTier: "pro",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) => ctx.db.patch(accountId, { businessId }));
    const found = await t.run((ctx) => ctx.db.get(accountId));
    expect(found?.accountType).toBe("service-business");
    expect(found?.businessId).toBe(businessId);
  });
});
