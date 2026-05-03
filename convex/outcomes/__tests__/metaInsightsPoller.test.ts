/**
 * Wave C.5 — metaInsightsPoller tests.
 *
 * Per the v0 scope (no new tables except `weeklyLearnings`), the meta poller
 * surfaces counts via the action return shape; persistence to a per-FB-post
 * insights table lands in Wave D. Tests here exercise:
 *
 *   1. Cross-tenant: getZernioFbConnection only returns connections for the
 *      asked business.
 *   2. Plan-tier: poll runs at every tier (no gating in the connection lookup).
 *   3. Adversarial: missing connection returns null cleanly; no FB connection
 *      returns null cleanly.
 *   4. Sibling-file scan: separate file.
 *   5. TODO grep: separate file.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function seedBusiness(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  plan: "starter" | "pro" | "studio" = "pro"
): Promise<Id<"businesses">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `clerk_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "sms",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "pro",
      accountType: "service-business",
      createdAt: NOW,
    });
    const businessId = await ctx.db.insert("businesses", {
      accountId,
      name: `Biz ${suffix}`,
      serviceTypes: ["hvac"],
      serviceAreaPolygon: [],
      ticketSizeBucket: "200-500",
      businessSize: "solo",
      tonePreference: "friendly-neighborhood",
      responseSpeed: "within-30-min",
      voiceEnabled: false,
      planTier: plan,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.patch(accountId, { businessId });
    return businessId as Id<"businesses">;
  });
}

async function seedZernioFbConn(
  t: ReturnType<typeof convexTest>,
  businessId: Id<"businesses">,
  pageId: string
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("zernioConnections", {
      businessId,
      zernioAccountId: `zern_${pageId}`,
      encryptedApiKey: "encrypted-test-key",
      connectedPlatforms: [
        {
          platform: "facebook",
          platformAccountId: pageId,
          status: "active",
          connectedAt: NOW,
          displayName: "Test Page",
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Cross-tenant                                                                */
/* -------------------------------------------------------------------------- */

describe("metaInsightsPoller — cross-tenant", () => {
  it("getZernioFbConnection scopes by businessId", async () => {
    const t = convexTest(schema, modules);
    const a = await seedBusiness(t, "A");
    const b = await seedBusiness(t, "B");
    await seedZernioFbConn(t, a, "page_A");
    await seedZernioFbConn(t, b, "page_B");

    const connA = await t.query(
      internal.outcomes.metaInsightsPoller.getZernioFbConnection,
      { businessId: a }
    );
    expect(connA?.fbPageId).toBe("page_A");

    const connB = await t.query(
      internal.outcomes.metaInsightsPoller.getZernioFbConnection,
      { businessId: b }
    );
    expect(connB?.fbPageId).toBe("page_B");
  });
});

/* -------------------------------------------------------------------------- */
/* Plan-tier (no gating in connection lookup)                                  */
/* -------------------------------------------------------------------------- */

describe("metaInsightsPoller — plan-tier (no gating)", () => {
  for (const plan of ["starter", "pro", "studio"] as const) {
    it(`getZernioFbConnection works at ${plan}`, async () => {
      const t = convexTest(schema, modules);
      const businessId = await seedBusiness(t, `tier_${plan}`, plan);
      await seedZernioFbConn(t, businessId, `page_${plan}`);
      const conn = await t.query(
        internal.outcomes.metaInsightsPoller.getZernioFbConnection,
        { businessId }
      );
      expect(conn).not.toBeNull();
      expect(conn!.fbPageId).toBe(`page_${plan}`);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Adversarial                                                                 */
/* -------------------------------------------------------------------------- */

describe("metaInsightsPoller — adversarial", () => {
  it("missing connection returns null", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "no_conn");
    const conn = await t.query(
      internal.outcomes.metaInsightsPoller.getZernioFbConnection,
      { businessId }
    );
    expect(conn).toBeNull();
  });

  it("connection without facebook platform returns null", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "gbp_only");
    await t.run(async (ctx) => {
      await ctx.db.insert("zernioConnections", {
        businessId,
        zernioAccountId: "z1",
        encryptedApiKey: "x",
        connectedPlatforms: [
          {
            platform: "gbp",
            platformAccountId: "loc1",
            status: "active",
            connectedAt: NOW,
          },
        ],
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    const conn = await t.query(
      internal.outcomes.metaInsightsPoller.getZernioFbConnection,
      { businessId }
    );
    expect(conn).toBeNull();
  });

  it("revoked facebook platform returns null", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, "revoked");
    await t.run(async (ctx) => {
      await ctx.db.insert("zernioConnections", {
        businessId,
        zernioAccountId: "z1",
        encryptedApiKey: "x",
        connectedPlatforms: [
          {
            platform: "facebook",
            platformAccountId: "page_revoked",
            status: "revoked",
            connectedAt: NOW,
            revokedAt: NOW + 1000,
          },
        ],
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    const conn = await t.query(
      internal.outcomes.metaInsightsPoller.getZernioFbConnection,
      { businessId }
    );
    expect(conn).toBeNull();
  });
});
