/**
 * businessReadiness — Creator HQ business-readiness audit (2026-04-26).
 *
 * Covers the 5 mandatory test categories for every new mutation/query:
 *   1. Cross-tenant — A never reads / writes B's rows. Identity-resolved
 *      mutations refuse mismatched ids; secret-gated mutations refuse cross-
 *      tenant ids by checking the row owner before the write completes
 *      (where the schema makes the check meaningful).
 *   2. Plan-tier × action matrix (REVISED 2026-04-26):
 *        - opportunityScout / brandOutreach / collabMatch / monetization /
 *          competitorWatch (slots>0) are ALL UNIVERSAL across plans.
 *        - The proactiveCronAll gate (industry-intel trend source) STAYS
 *          Pro+, because that's a real cost lever (full-cron volume).
 *        - The Apollo/Hunter brand-contact-discovery gate stays Studio-only
 *          via `allowedProviders` (paid per-query lookups).
 *      The mechanism (PlanGateError throws) is preserved for future flips.
 *   3. Adversarial inputs — empty handle / brand / contact email; negative
 *      revenue; unauth identity; bad opportunity id; secret missing or wrong.
 *   4. Sibling-file scan — covered repo-wide by sprint1Acceptance.test.ts.
 *   5. TODO grep — covered repo-wide by sprint1Acceptance.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";

const NOW = 1_700_000_000_000;
const RUNTIME_SECRET = "test-runtime-secret-do-not-leak";

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: "starter" | "pro" | "studio";
  }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

beforeEach(() => {
  vi.stubEnv("MAYA_RUNTIME_SECRET", RUNTIME_SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/* -------------------------------------------------------------------------- */
/* Today extras                                                                */
/* -------------------------------------------------------------------------- */

describe("businessReadiness.latestActionLog", () => {
  it("returns recent ran/failed entries for the signed-in creator only", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("mayaActionLog", {
        creatorId: a,
        entryId: "morning_brief",
        outcome: "ran",
        detail: "wrote brief",
        ts: NOW,
      });
      await ctx.db.insert("mayaActionLog", {
        creatorId: a,
        entryId: "comment_triage",
        outcome: "skipped_condition_unmet",
        ts: NOW + 1,
      });
      await ctx.db.insert("mayaActionLog", {
        creatorId: b,
        entryId: "morning_brief",
        outcome: "ran",
        ts: NOW,
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.latestActionLog,
      {}
    );
    expect(out.length).toBe(1);
    expect(out[0].entryId).toBe("morning_brief");
    expect(out[0].creatorId).toBe(a);
  });

  it("returns empty for unauth", async () => {
    const t = convexTest(schema, modules);
    const out = await t.query(api.businessReadiness.latestActionLog, {});
    expect(out).toEqual([]);
  });
});

describe("businessReadiness.gmailWatchStatus", () => {
  it("not connected for fresh Pro creator", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const out = await asUser(t, "a").query(
      api.businessReadiness.gmailWatchStatus,
      {}
    );
    expect(out).toMatchObject({
      connected: false,
      planEnabled: true,
      lastEventAt: null,
    });
  });

  it("PLAN-TIER (REVISED): Starter shows planEnabled=true — Gmail deal desk is universal", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "starter" });
    const out = await asUser(t, "a").query(
      api.businessReadiness.gmailWatchStatus,
      {}
    );
    expect(out?.planEnabled).toBe(true);
  });

  it("connected returns latest webhook tick from own creator only", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("connectedAccounts", {
        creatorId: a,
        provider: "gmail",
        composioAccountId: "enc:xxx",
        scopes: ["GMAIL_READ"],
        scopeStatus: "active",
        connectedAt: NOW,
      });
      await ctx.db.insert("gmailWebhookEvents", {
        eventId: "evt_a_1",
        eventType: "message.received",
        composioAccountId: "raw_a",
        creatorId: a,
        status: "processed",
        receivedAt: NOW + 1000,
        rawPayload: {},
      });
      await ctx.db.insert("gmailWebhookEvents", {
        eventId: "evt_b_1",
        eventType: "message.received",
        composioAccountId: "raw_b",
        creatorId: b,
        status: "processed",
        receivedAt: NOW + 5000,
        rawPayload: {},
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.gmailWatchStatus,
      {}
    );
    expect(out?.connected).toBe(true);
    expect(out?.lastEventAt).toBe(NOW + 1000);
  });
});

describe("businessReadiness.pendingItemsExtended", () => {
  it("surfaces approved-but-unposted from latest plan", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("contentPlans", {
        creatorId: a,
        weekStartLocal: "2026-04-21",
        arc: [
          {
            dayOffset: 0,
            platform: "tiktok",
            format: "tiktok-post",
            hookOptions: ["hook A"],
            captionDraft: "cap",
            postingTimeLocal: "10:00",
            status: "approved",
          },
          {
            dayOffset: 1,
            platform: "instagram",
            format: "ig-reel",
            hookOptions: ["hook B"],
            captionDraft: "cap2",
            postingTimeLocal: "10:00",
            status: "draft",
          },
          {
            dayOffset: 2,
            platform: "youtube",
            format: "yt-short",
            hookOptions: ["hook C"],
            captionDraft: "cap3",
            postingTimeLocal: "10:00",
            status: "posted",
          },
        ],
        rationale: "test plan",
        generatedAt: NOW,
      })
    );
    const out = await asUser(t, "a").query(
      api.businessReadiness.pendingItemsExtended,
      {}
    );
    const approved = out.filter((i) => i.kind === "approved-content");
    expect(approved.length).toBe(1);
    expect(approved[0].title).toContain("tiktok");
  });

  it("PLAN-TIER (REVISED): Starter sees pitch followups — brand-outreach is universal", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    await t.run((ctx) =>
      ctx.db.insert("pitchOutreach", {
        creatorId: a,
        brand: "Glossier",
        contactEmail: "p@glossier.com",
        pitchAngle: "paid-content",
        status: "sent",
        sentAt: NOW - 10 * 24 * 3600 * 1000, // 10 days ago
      })
    );
    const out = await asUser(t, "a").query(
      api.businessReadiness.pendingItemsExtended,
      {}
    );
    expect(out.filter((i) => i.kind === "pitch-followup")).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Plan extras                                                                 */
/* -------------------------------------------------------------------------- */

describe("businessReadiness.markDayPosted", () => {
  it("approved → posted transition + action log", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const planId = await t.run((ctx) =>
      ctx.db.insert("contentPlans", {
        creatorId: a,
        weekStartLocal: "2026-04-21",
        arc: [
          {
            dayOffset: 0,
            platform: "tiktok",
            format: "tiktok-post",
            hookOptions: ["h"],
            captionDraft: "c",
            postingTimeLocal: "10:00",
            status: "approved",
          },
        ],
        rationale: "r",
        generatedAt: NOW,
      })
    );
    await asUser(t, "a").mutation(api.businessReadiness.markDayPosted, {
      planId,
      dayOffset: 0,
    });
    const after = await t.run((ctx) => ctx.db.get(planId));
    expect(after?.arc[0].status).toBe("posted");
    const log = await t.run((ctx) =>
      ctx.db
        .query("mayaActionLog")
        .withIndex("by_creator_and_entry", (q) =>
          q.eq("creatorId", a).eq("entryId", "plan.markPosted")
        )
        .collect()
    );
    expect(log.length).toBe(1);
  });

  it("refuses transition from draft (anti-footgun)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const planId = await t.run((ctx) =>
      ctx.db.insert("contentPlans", {
        creatorId: a,
        weekStartLocal: "2026-04-21",
        arc: [
          {
            dayOffset: 0,
            platform: "tiktok",
            format: "tiktok-post",
            hookOptions: ["h"],
            captionDraft: "c",
            postingTimeLocal: "10:00",
            status: "draft",
          },
        ],
        rationale: "r",
        generatedAt: NOW,
      })
    );
    await expect(
      asUser(t, "a").mutation(api.businessReadiness.markDayPosted, {
        planId,
        dayOffset: 0,
      })
    ).rejects.toThrow(/Approve first/);
  });

  it("cross-tenant: B cannot mark A's plan posted", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertCreator(t, { suffix: "b", plan: "pro" });
    const planId = await t.run((ctx) =>
      ctx.db.insert("contentPlans", {
        creatorId: a,
        weekStartLocal: "2026-04-21",
        arc: [
          {
            dayOffset: 0,
            platform: "tiktok",
            format: "tiktok-post",
            hookOptions: ["h"],
            captionDraft: "c",
            postingTimeLocal: "10:00",
            status: "approved",
          },
        ],
        rationale: "r",
        generatedAt: NOW,
      })
    );
    await expect(
      asUser(t, "b").mutation(api.businessReadiness.markDayPosted, {
        planId,
        dayOffset: 0,
      })
    ).rejects.toThrow(/does not belong/);
  });
});

describe("businessReadiness.voiceFingerprint", () => {
  it("returns null when no picture", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const out = await asUser(t, "a").query(
      api.businessReadiness.voiceFingerprint,
      {}
    );
    expect(out).toBeNull();
  });

  it("returns picture voice + top hooks", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: a,
        niche: "fitness",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "warm + direct",
        topHooks: [
          {
            pattern: "POV opener",
            examplePostId: "p1",
            platform: "tiktok",
            avgPerformanceLift: 1.5,
          },
        ],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "test",
        sourceCitations: [],
      })
    );
    const out = await asUser(t, "a").query(
      api.businessReadiness.voiceFingerprint,
      {}
    );
    expect(out?.voiceFingerprint).toBe("warm + direct");
    expect(out?.topHooks.length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Deals extras                                                                */
/* -------------------------------------------------------------------------- */

describe("businessReadiness.createBrandDealManually", () => {
  it("creates a deal in 'new' status with action log", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "starter" });
    const id = await asUser(t, "a").mutation(
      api.businessReadiness.createBrandDealManually,
      {
        brand: "Glossier",
        offerAmountUsd: 1500,
        deliverables: ["1× Reel", "3× Stories"],
      }
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.brand).toBe("Glossier");
    expect(row?.status).toBe("new");
    expect(row?.deliverables).toEqual(["1× Reel", "3× Stories"]);
  });

  it("rejects empty brand", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").mutation(
        api.businessReadiness.createBrandDealManually,
        { brand: "   ", deliverables: [] }
      )
    ).rejects.toThrow(/brand is required/);
  });

  it("rejects negative offer", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").mutation(
        api.businessReadiness.createBrandDealManually,
        { brand: "X", offerAmountUsd: -1, deliverables: [] }
      )
    ).rejects.toThrow(/non-negative/);
  });

  it("rejects unauth", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.businessReadiness.createBrandDealManually, {
        brand: "X",
        deliverables: [],
      })
    ).rejects.toThrow(/Not authenticated/);
  });
});

describe("businessReadiness.markDealPaid", () => {
  it("marks paid + records revenue + action log", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const dealId = await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: a,
        brand: "X",
        status: "submitted",
        deliverables: [],
        riskFlags: [],
        replyVariants: [],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await asUser(t, "a").mutation(api.businessReadiness.markDealPaid, {
      dealId,
      paidAmountUsd: 2200,
    });
    const after = await t.run((ctx) => ctx.db.get(dealId));
    expect(after?.status).toBe("paid");
    expect(after?.paidAmountUsd).toBe(2200);
  });

  it("idempotent on already-paid", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const dealId = await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: a,
        brand: "X",
        status: "paid",
        paidAt: NOW,
        paidAmountUsd: 1000,
        deliverables: [],
        riskFlags: [],
        replyVariants: [],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const r = await asUser(t, "a").mutation(
      api.businessReadiness.markDealPaid,
      { dealId, paidAmountUsd: 1500 }
    );
    expect(r.alreadyPaid).toBe(true);
    const after = await t.run((ctx) => ctx.db.get(dealId));
    expect(after?.paidAmountUsd).toBe(1500); // amount can be corrected
  });

  it("cross-tenant: B cannot mark A's deal paid", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertCreator(t, { suffix: "b", plan: "pro" });
    const dealId = await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: a,
        brand: "X",
        status: "submitted",
        deliverables: [],
        riskFlags: [],
        replyVariants: [],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await expect(
      asUser(t, "b").mutation(api.businessReadiness.markDealPaid, {
        dealId,
        paidAmountUsd: 100,
      })
    ).rejects.toThrow(/does not belong/);
  });
});

describe("businessReadiness.attachContractToDeal", () => {
  it("attaches PDF id + clears report", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const dealId = await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: a,
        brand: "X",
        status: "negotiating",
        deliverables: [],
        riskFlags: [],
        replyVariants: [],
        redFlagReportId: "old-report",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await asUser(t, "a").mutation(
      api.businessReadiness.attachContractToDeal,
      { dealId, contractPdfId: "storage:abc123" }
    );
    const after = await t.run((ctx) => ctx.db.get(dealId));
    expect(after?.contractPdfId).toBe("storage:abc123");
    expect(after?.redFlagReportId).toBeUndefined();
  });
});

describe("businessReadiness.opportunityMatchesV2", () => {
  it("PLAN-TIER (REVISED): Starter sees opportunities — opportunity-scout is universal", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    await t.run((ctx) =>
      ctx.db.insert("opportunitySurface", {
        creatorId: a,
        source: "aspire",
        title: "T",
        fit: 0.7,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://example.com",
        urlHash: "h1",
        surfacedAt: NOW,
        creatorActedOn: "pending",
      })
    );
    const out = await asUser(t, "a").query(
      api.businessReadiness.opportunityMatchesV2,
      {}
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("T");
  });

  it("Pro sees pending only — not dismissed/pitched", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("opportunitySurface", {
        creatorId: a,
        source: "aspire",
        title: "Pending One",
        fit: 0.7,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://a.com",
        urlHash: "h1",
        surfacedAt: NOW,
        creatorActedOn: "pending",
      });
      await ctx.db.insert("opportunitySurface", {
        creatorId: a,
        source: "grin",
        title: "Already Dismissed",
        fit: 0.6,
        suggestedAction: "monitor",
        reasoning: "r",
        url: "https://b.com",
        urlHash: "h2",
        surfacedAt: NOW,
        creatorActedOn: "dismissed",
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.opportunityMatchesV2,
      {}
    );
    expect(out.length).toBe(1);
    expect(out[0].title).toBe("Pending One");
  });

  it("cross-tenant: A's opportunities never surface for B", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertCreator(t, { suffix: "b", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("opportunitySurface", {
        creatorId: a,
        source: "aspire",
        title: "A's Opp",
        fit: 0.8,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://x.com",
        urlHash: "h1",
        surfacedAt: NOW,
        creatorActedOn: "pending",
      })
    );
    const out = await asUser(t, "b").query(
      api.businessReadiness.opportunityMatchesV2,
      {}
    );
    expect(out).toEqual([]);
  });
});

describe("businessReadiness.dismissOpportunity", () => {
  it("flips creatorActedOn to dismissed", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const oid = await t.run((ctx) =>
      ctx.db.insert("opportunitySurface", {
        creatorId: a,
        source: "aspire",
        title: "T",
        fit: 0.7,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://x.com",
        urlHash: "h",
        surfacedAt: NOW,
        creatorActedOn: "pending",
      })
    );
    await asUser(t, "a").mutation(
      api.businessReadiness.dismissOpportunity,
      { opportunityId: oid }
    );
    const after = await t.run((ctx) => ctx.db.get(oid));
    expect(after?.creatorActedOn).toBe("dismissed");
  });

  it("cross-tenant refusal", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertCreator(t, { suffix: "b", plan: "pro" });
    const oid = await t.run((ctx) =>
      ctx.db.insert("opportunitySurface", {
        creatorId: a,
        source: "aspire",
        title: "T",
        fit: 0.7,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://x.com",
        urlHash: "h",
        surfacedAt: NOW,
        creatorActedOn: "pending",
      })
    );
    await expect(
      asUser(t, "b").mutation(
        api.businessReadiness.dismissOpportunity,
        { opportunityId: oid }
      )
    ).rejects.toThrow(/does not belong/);
  });
});

describe("businessReadiness.convertOpportunityToPitch", () => {
  it("creates pitchOutreach in drafted + flips opportunity to pitched", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const oid = await t.run((ctx) =>
      ctx.db.insert("opportunitySurface", {
        creatorId: a,
        source: "aspire",
        title: "Brand X",
        brandName: "Brand X",
        fit: 0.8,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://x.com",
        urlHash: "h",
        surfacedAt: NOW,
        creatorActedOn: "pending",
      })
    );
    const pid = await asUser(t, "a").mutation(
      api.businessReadiness.convertOpportunityToPitch,
      {
        opportunityId: oid,
        contactEmail: "PR@brandx.com",
        pitchAngle: "paid-content",
      }
    );
    const pitch = await t.run((ctx) => ctx.db.get(pid));
    expect(pitch?.brand).toBe("Brand X");
    expect(pitch?.contactEmail).toBe("pr@brandx.com");
    expect(pitch?.status).toBe("drafted");
    const opp = await t.run((ctx) => ctx.db.get(oid));
    expect(opp?.creatorActedOn).toBe("pitched");
  });

  it("PLAN-TIER (REVISED): Starter can convert opportunities to pitches — brand-outreach is universal", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    const oid = await t.run((ctx) =>
      ctx.db.insert("opportunitySurface", {
        creatorId: a,
        source: "aspire",
        title: "T",
        brandName: "T-Brand",
        fit: 0.7,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://x.com",
        urlHash: "h",
        surfacedAt: NOW,
        creatorActedOn: "pending",
      })
    );
    const pid = await asUser(t, "a").mutation(
      api.businessReadiness.convertOpportunityToPitch,
      {
        opportunityId: oid,
        contactEmail: "p@brand.com",
        pitchAngle: "partnership",
      }
    );
    const pitch = await t.run((ctx) => ctx.db.get(pid));
    expect(pitch?.creatorId).toBe(a);
    expect(pitch?.status).toBe("drafted");
  });

  it("rejects malformed email (adversarial)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const oid = await t.run((ctx) =>
      ctx.db.insert("opportunitySurface", {
        creatorId: a,
        source: "aspire",
        title: "T",
        fit: 0.7,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://x.com",
        urlHash: "h",
        surfacedAt: NOW,
        creatorActedOn: "pending",
      })
    );
    await expect(
      asUser(t, "a").mutation(
        api.businessReadiness.convertOpportunityToPitch,
        {
          opportunityId: oid,
          contactEmail: "not-an-email",
          pitchAngle: "partnership",
        }
      )
    ).rejects.toThrow(/valid email/);
  });
});

/* -------------------------------------------------------------------------- */
/* Skill-runtime writes                                                        */
/* -------------------------------------------------------------------------- */

describe("businessReadiness.skillRecordOpportunity", () => {
  it("writes a row + idempotent on (creatorId, urlHash)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const id1 = await t.mutation(
      api.businessReadiness.skillRecordOpportunity,
      {
        mayaSecret: RUNTIME_SECRET,
        creatorId: a,
        source: "aspire",
        title: "T",
        fit: 0.7,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://x.com",
        urlHash: "h1",
      }
    );
    const id2 = await t.mutation(
      api.businessReadiness.skillRecordOpportunity,
      {
        mayaSecret: RUNTIME_SECRET,
        creatorId: a,
        source: "aspire",
        title: "T (revised)",
        fit: 0.85,
        suggestedAction: "pitch",
        reasoning: "r2",
        url: "https://x.com",
        urlHash: "h1",
      }
    );
    expect(id1).toBe(id2);
    const row = await t.run((ctx) => ctx.db.get(id1));
    expect(row?.title).toBe("T (revised)");
    expect(row?.fit).toBe(0.85);
  });

  it("PLAN-TIER (REVISED): Starter can record opportunities — opportunity-scout is universal", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    const id = await t.mutation(api.businessReadiness.skillRecordOpportunity, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: a,
      source: "aspire",
      title: "T",
      fit: 0.7,
      suggestedAction: "pitch",
      reasoning: "r",
      url: "https://x.com",
      urlHash: "h1",
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.creatorId).toBe(a);
  });

  it("missing secret refuses (fail-closed)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      t.mutation(api.businessReadiness.skillRecordOpportunity, {
        mayaSecret: "wrong",
        creatorId: a,
        source: "aspire",
        title: "T",
        fit: 0.7,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://x.com",
        urlHash: "h1",
      })
    ).rejects.toThrow(/Invalid Maya runtime secret/);
  });

  it("env unset → all writes refused even with empty secret", async () => {
    vi.unstubAllEnvs();
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      t.mutation(api.businessReadiness.skillRecordOpportunity, {
        mayaSecret: "",
        creatorId: a,
        source: "aspire",
        title: "T",
        fit: 0.7,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://x.com",
        urlHash: "h1",
      })
    ).rejects.toThrow(/not configured/);
    // restore for following tests in this file
    vi.stubEnv("MAYA_RUNTIME_SECRET", RUNTIME_SECRET);
  });

  it("rejects out-of-range fit (adversarial)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      t.mutation(api.businessReadiness.skillRecordOpportunity, {
        mayaSecret: RUNTIME_SECRET,
        creatorId: a,
        source: "aspire",
        title: "T",
        fit: 1.5,
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://x.com",
        urlHash: "h1",
      })
    ).rejects.toThrow(/fit must be in/);
  });
});

describe("businessReadiness.skillRecordPostmortem", () => {
  it("rejects post belonging to a different creator (tenant-bleed guard)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    const postId = await t.run((ctx) =>
      ctx.db.insert("posts", {
        creatorId: b,
        platform: "tiktok",
        platformPostId: "pp1",
        url: "https://tt.com/x",
        caption: "c",
        mediaType: "video",
        postedAt: NOW,
      })
    );
    await expect(
      t.mutation(api.businessReadiness.skillRecordPostmortem, {
        mayaSecret: RUNTIME_SECRET,
        creatorId: a,
        postId,
        severity: "mild",
        primaryCause: "p",
        secondaryCauses: [],
        recommendedNextMove: "x",
        lessonForNextPost: "y",
      })
    ).rejects.toThrow(/does not belong/);
  });
});

describe("businessReadiness.skillRecordHook", () => {
  it("rejects example posts not belonging to the creator", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    const fooPost = await t.run((ctx) =>
      ctx.db.insert("posts", {
        creatorId: b,
        platform: "tiktok",
        platformPostId: "pp1",
        url: "https://tt.com/x",
        caption: "c",
        mediaType: "video",
        postedAt: NOW,
      })
    );
    await expect(
      t.mutation(api.businessReadiness.skillRecordHook, {
        mayaSecret: RUNTIME_SECRET,
        creatorId: a,
        pattern: "POV opener",
        firstSeconds: "POV: you wake up…",
        whyItWorked: "hook",
        examplePostIds: [fooPost],
      })
    ).rejects.toThrow(/all belong to this creator/);
  });

  it("happy path inserts hook row", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    const myPost = await t.run((ctx) =>
      ctx.db.insert("posts", {
        creatorId: a,
        platform: "tiktok",
        platformPostId: "pp1",
        url: "https://tt.com/x",
        caption: "c",
        mediaType: "video",
        postedAt: NOW,
      })
    );
    const id = await t.mutation(api.businessReadiness.skillRecordHook, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: a,
      pattern: "POV",
      firstSeconds: "POV…",
      whyItWorked: "good hook",
      examplePostIds: [myPost],
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.creatorId).toBe(a);
  });
});

describe("businessReadiness.skillRecordCompetitor", () => {
  it("PLAN-TIER (REVISED): Starter can record competitor observations (slots=2, not 0)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    const id = await t.mutation(api.businessReadiness.skillRecordCompetitor, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: a,
      peerHandle: "@peer",
      platform: "tiktok",
      observation: "obs",
      evidence: [],
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.peerHandle).toBe("peer");
  });

  it("Pro accepts; @ stripped", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const id = await t.mutation(
      api.businessReadiness.skillRecordCompetitor,
      {
        mayaSecret: RUNTIME_SECRET,
        creatorId: a,
        peerHandle: "@peer",
        platform: "tiktok",
        observation: "obs",
        evidence: [
          { kind: "post", ref: "tt:abc", fact: "viral 7x" },
        ],
      }
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.peerHandle).toBe("peer");
  });
});

describe("businessReadiness.skillRecordTrend", () => {
  it("niche-scan accepted on Starter; industry-intel still blocked (proactiveCronAll=false)", async () => {
    // proactiveCronAll remains a Starter cost lever — industry-intel runs on
    // the FULL cron set, not the limited Starter set, so the gate stays.
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    await t.mutation(api.businessReadiness.skillRecordTrend, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: a,
      source: "niche-scan",
      observation: "rising hashtag",
      evidence: [],
      relevanceScore: 0.6,
    });
    await expect(
      t.mutation(api.businessReadiness.skillRecordTrend, {
        mayaSecret: RUNTIME_SECRET,
        creatorId: a,
        source: "industry-intel",
        observation: "x",
        evidence: [],
        relevanceScore: 0.6,
      })
    ).rejects.toThrow(/trend:industry-intel/);
  });

  it("rejects out-of-range relevance (adversarial)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      t.mutation(api.businessReadiness.skillRecordTrend, {
        mayaSecret: RUNTIME_SECRET,
        creatorId: a,
        source: "niche-scan",
        observation: "x",
        evidence: [],
        relevanceScore: 1.7,
      })
    ).rejects.toThrow(/relevanceScore/);
  });
});

describe("businessReadiness.skillCreatePitchDraft", () => {
  it("Pro accepts + lowercases email", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const id = await t.mutation(
      api.businessReadiness.skillCreatePitchDraft,
      {
        mayaSecret: RUNTIME_SECRET,
        creatorId: a,
        brand: "X",
        contactEmail: "P@X.com",
        pitchAngle: "partnership",
      }
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.contactEmail).toBe("p@x.com");
    expect(row?.status).toBe("drafted");
  });

  it("PLAN-TIER (REVISED): Starter can create pitch drafts — brand-outreach is universal", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    const id = await t.mutation(api.businessReadiness.skillCreatePitchDraft, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: a,
      brand: "X",
      contactEmail: "p@x.com",
      pitchAngle: "partnership",
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.brand).toBe("X");
    expect(row?.status).toBe("drafted");
  });
});

describe("businessReadiness.skillRecordCollabMatch", () => {
  it("PLAN-TIER (REVISED): Starter and Pro both write collab-match rows — collabMatch is universal", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    const aId = await t.mutation(
      api.businessReadiness.skillRecordCollabMatch,
      {
        mayaSecret: RUNTIME_SECRET,
        creatorId: a,
        peerHandle: "@warm",
        platform: "tiktok",
      }
    );
    const aRow = await t.run((ctx) => ctx.db.get(aId));
    expect(aRow?.peerHandle).toBe("warm");

    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    const id = await t.mutation(
      api.businessReadiness.skillRecordCollabMatch,
      {
        mayaSecret: RUNTIME_SECRET,
        creatorId: b,
        peerHandle: "@cool",
        platform: "instagram",
      }
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.peerHandle).toBe("cool");
  });
});

describe("businessReadiness.skillRecordMonetization", () => {
  it("PLAN-TIER (REVISED): Starter and Pro both write monetization proposals — monetizationAdvisor is universal", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    const aId = await t.mutation(
      api.businessReadiness.skillRecordMonetization,
      {
        mayaSecret: RUNTIME_SECRET,
        creatorId: a,
        triggerEvent: "10k-milestone",
        proposalsSnapshot: { add: ["affiliate"] },
      }
    );
    const aRow = await t.run((ctx) => ctx.db.get(aId));
    expect(aRow?.creatorId).toBe(a);

    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    const id = await t.mutation(
      api.businessReadiness.skillRecordMonetization,
      {
        mayaSecret: RUNTIME_SECRET,
        creatorId: b,
        triggerEvent: "10k-milestone",
        proposalsSnapshot: { add: ["affiliate"] },
      }
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.creatorId).toBe(b);
  });
});

/* -------------------------------------------------------------------------- */
/* Stage resolution                                                            */
/* -------------------------------------------------------------------------- */

describe("businessReadiness.creatorStage", () => {
  it("returns null for unauth", async () => {
    const t = convexTest(schema, modules);
    const out = await t.query(api.businessReadiness.creatorStage, {});
    expect(out).toBeNull();
  });

  it("infers just-starting when no picture + no handles + no followers", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "starter" });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.stage).toBe("just-starting");
    expect(out?.stageSource).toBe("inferred");
    expect(out?.topFollowers).toBe(0);
    expect(out?.nextMilestone.label).toBe("1K");
    expect(out?.focusArea).toBe("consistency");
  });

  it("infers building from 25K followers when picture absent", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorHandles", {
        creatorId: a,
        platform: "tiktok",
        handle: "x",
        verified: true,
        followerCount: 25_000,
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.stage).toBe("building");
    expect(out?.topFollowers).toBe(25_000);
    expect(out?.nextMilestone.label).toBe("50K");
    expect(out?.focusArea).toBe("hook-craft");
  });

  it("picks max follower count across multiple handles", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorHandles", {
        creatorId: a,
        platform: "tiktok",
        handle: "small",
        verified: true,
        followerCount: 800,
      });
      await ctx.db.insert("creatorHandles", {
        creatorId: a,
        platform: "instagram",
        handle: "big",
        verified: true,
        followerCount: 120_000,
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.topFollowers).toBe(120_000);
    expect(out?.stage).toBe("monetizing");
  });

  it("creatorPicture.careerStage overrides follower-inferred stage", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.run(async (ctx) => {
      // Followers say monetizing (120K), but picture says scaling.
      await ctx.db.insert("creatorHandles", {
        creatorId: a,
        platform: "tiktok",
        handle: "x",
        verified: true,
        followerCount: 120_000,
      });
      await ctx.db.insert("creatorPicture", {
        creatorId: a,
        niche: "fitness",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "v",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "test",
        sourceCitations: [],
        careerStage: "scaling",
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.stage).toBe("scaling");
    expect(out?.stageSource).toBe("picture");
  });

  it("growthPlan.nextMilestone overrides synthetic milestone", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorHandles", {
        creatorId: a,
        platform: "tiktok",
        handle: "x",
        verified: true,
        followerCount: 25_000,
      });
      await ctx.db.insert("creatorPicture", {
        creatorId: a,
        niche: "fitness",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "v",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "test",
        sourceCitations: [],
        careerStage: "building",
        growthPlan: {
          nextMilestone: { label: "100K", targetFollowers: 100_000 },
          focusArea: "diversification",
        },
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.nextMilestone.label).toBe("100K");
    expect(out?.focusArea).toBe("diversification");
  });

  it("synthetic milestone for >1M creator falls back gracefully", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "studio" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorHandles", {
        creatorId: a,
        platform: "tiktok",
        handle: "x",
        verified: true,
        followerCount: 3_500_000,
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.stage).toBe("scaling");
    expect(out?.nextMilestone.label).toBe("5M");
  });

  it("cross-tenant: A's stage never reflects B's handles or picture", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorHandles", {
        creatorId: b,
        platform: "tiktok",
        handle: "big",
        verified: true,
        followerCount: 500_000,
      });
      await ctx.db.insert("creatorPicture", {
        creatorId: b,
        niche: "fitness",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "v",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "test",
        sourceCitations: [],
        careerStage: "scaling",
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.stage).toBe("just-starting");
    expect(out?.topFollowers).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Stage-aware adaptive product (Agent B, 2026-04-26) — creatorStage extras   */
/* -------------------------------------------------------------------------- */

describe("businessReadiness.creatorStage — stage-aware extensions", () => {
  it("surfaces gentleNudge when reconciliation.matches=false", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        creatorId: a,
        niche: "fitness",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "v",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "google/gemini-3-flash",
        sourceCitations: [],
        careerStage: "just-starting",
        careerStageReasoning: "Sparse posting, no clear niche, no monetization.",
        careerStageReconciliation: {
          selfReported: "monetizing",
          inferred: "just-starting",
          matches: false,
          evidence:
            "self-reported monetizing but $0 revenue and no brand-deal mentions in 30 posts",
          gentleNudge:
            "You're earlier in the journey than the form let you say — that's fine, we'll start where you actually are.",
        },
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.stage).toBe("just-starting");
    expect(out?.gentleNudge).toMatch(/earlier in the journey/i);
    expect(out?.reconciliation?.matches).toBe(false);
    expect(out?.careerStageReasoning).toMatch(/Sparse posting/);
    expect(out?.hasInferredPicture).toBe(true);
  });

  it("returns gentleNudge=null when reconciliation.matches=true", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        creatorId: a,
        niche: "fitness",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "v",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "google/gemini-3-flash",
        sourceCitations: [],
        careerStage: "building",
        careerStageReconciliation: {
          selfReported: "building",
          inferred: "building",
          matches: true,
          evidence: "Self-report and observed signal align.",
          gentleNudge: undefined,
        },
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.gentleNudge).toBeNull();
    expect(out?.reconciliation?.matches).toBe(true);
  });

  it("hasInferredPicture=false when picture is missing or marker model 'awaiting-synthesis'", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    // Insert the placeholder row submitOnboardingAnswers writes pre-synth.
    await t.run(async (ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: a,
        niche: "",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "awaiting-synthesis",
        sourceCitations: [],
      })
    );
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.hasInferredPicture).toBe(false);
    // gentleNudge stays null when there's no real reconciliation.
    expect(out?.gentleNudge).toBeNull();
  });

  it("hasInferredPicture=false when there is no creatorPicture row at all", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.hasInferredPicture).toBe(false);
    // Stage still resolves via the inferred-from-followers fallback.
    expect(out?.stage).toBe("just-starting");
  });

  it("surfaces richGrowthPlan with focusAreas / antiPatterns / horizon when synth populates them", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        creatorId: a,
        niche: "fitness",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "v",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "google/gemini-3-flash",
        sourceCitations: [],
        careerStage: "building",
        growthPlan: {
          nextMilestone: { label: "50K", targetFollowers: 50_000 },
          focusArea: "hook-craft",
          currentStage: "building",
          nextMilestoneText: "Close one paid brand deal at floor in 60 days.",
          focusAreas: ["Sharpen hooks", "Pitch one brand"],
          antiPatterns: ["Premature diversification", "Multi-account splits"],
          horizonWeeks: 8,
          citations: [{ platform: "tiktok", postId: "p1", usedFor: "focusAreas[0]" }],
          generatedAt: NOW,
        },
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    expect(out?.richGrowthPlan).not.toBeNull();
    expect(out?.richGrowthPlan?.currentStage).toBe("building");
    expect(out?.richGrowthPlan?.focusAreas.length).toBe(2);
    expect(out?.richGrowthPlan?.antiPatterns.length).toBe(2);
    expect(out?.richGrowthPlan?.horizonWeeks).toBe(8);
    expect(out?.richGrowthPlan?.nextMilestoneText).toMatch(/paid brand deal/);
  });

  it("cross-tenant: A's gentleNudge / richGrowthPlan never reflect B's picture", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        creatorId: b,
        niche: "B-NICHE",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "v",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "google/gemini-3-flash",
        sourceCitations: [],
        careerStage: "scaling",
        careerStageReconciliation: {
          selfReported: "building",
          inferred: "scaling",
          matches: false,
          evidence: "B-EVIDENCE-MARKER",
          gentleNudge: "B-NUDGE-MARKER",
        },
        growthPlan: {
          nextMilestone: { label: "1M", targetFollowers: 1_000_000 },
          focusArea: "scale-systems",
          currentStage: "scaling",
          nextMilestoneText: "B-PLAN-MARKER",
          focusAreas: ["B-FOCUS"],
          antiPatterns: ["B-ANTI"],
          horizonWeeks: 8,
          citations: [],
          generatedAt: NOW,
        },
      });
    });
    const out = await asUser(t, "a").query(
      api.businessReadiness.creatorStage,
      {}
    );
    // A has no picture → no gentleNudge, no richGrowthPlan.
    expect(out?.gentleNudge).toBeNull();
    expect(out?.richGrowthPlan).toBeNull();
    expect(out?.reconciliation).toBeNull();
    expect(out?.careerStageReasoning).toBeNull();
  });
});

describe("businessReadiness.skillRecordActionLog", () => {
  it("inserts a log row gated by secret", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await t.mutation(api.businessReadiness.skillRecordActionLog, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: a,
      entryId: "post_publish_reaction",
      outcome: "ran",
      detail: "annotated post p1",
    });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("mayaActionLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    expect(rows.length).toBe(1);
    expect(rows[0].entryId).toBe("post_publish_reaction");
  });
});
