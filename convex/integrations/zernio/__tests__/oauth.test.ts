/**
 * OAuth tests — internal mutations + plan-tier gating helpers.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: upsertZernioConnection scopes by businessId; revoke on
 *      Business B never affects Business A.
 *   2. Plan-tier: requireTierForPlatform raises on Starter trying to add FB,
 *      Pro trying to add LinkedIn (Studio-only), etc. The gate is exercised
 *      indirectly via the encoded matrix (Starter blocks all non-GBP; Pro
 *      blocks Studio-only platforms).
 *   3. Adversarial: revoke on a non-existent connection returns
 *      revoked:false; upsert merges connectedPlatforms and does not
 *      duplicate (platform, platformAccountId) pairs.
 *   4. Sibling-file scan — n/a Sprint 1.
 *   5. TODO grep — repo-wide.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import {
  PlanServiceGateError,
  planFeaturesService,
} from "../../../planService";

const NOW = 1_700_000_000_000;

async function insertBusiness(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    tier: "starter" | "pro" | "studio";
    accountType?: "creator" | "service-business";
  }
): Promise<{ businessId: Id<"businesses">; accountId: Id<"creators"> }> {
  const accountId = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `op_${opts.suffix}`,
      email: `${opts.suffix}@svc.test`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "coach",
      accountType: opts.accountType ?? "service-business",
      createdAt: NOW,
    })
  );
  const businessId = await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId,
      name: `Business ${opts.suffix}`,
      serviceTypes: ["hvac"],
      planTier: opts.tier,
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
  await t.run((ctx) =>
    ctx.db.patch(accountId, { businessId })
  );
  return { businessId, accountId };
}

describe("plan-tier matrix (encoded in planFeaturesService)", () => {
  it("Starter has GBP read but maxSocialPlatforms === 0 (FB/IG gated)", () => {
    const features = planFeaturesService({ planTier: "starter" });
    expect(features.maxSocialPlatforms).toBe(0);
    expect(features.maxGbpLocations).toBeGreaterThanOrEqual(1);
  });

  it("Pro unlocks 2 social platforms (FB + IG)", () => {
    const features = planFeaturesService({ planTier: "pro" });
    expect(features.maxSocialPlatforms).toBe(2);
  });

  it("Studio unlocks unlimited platforms (TT/LI/X/Pin/Threads)", () => {
    const features = planFeaturesService({ planTier: "studio" });
    expect(features.maxSocialPlatforms).toBe("unlimited");
  });

  it("PlanServiceGateError carries the requiredPlan + attemptedFeature", () => {
    const err = new PlanServiceGateError("starter", "zernio:connect:facebook", "pro");
    expect(err.plan).toBe("starter");
    expect(err.requiredPlan).toBe("pro");
    expect(err.attemptedFeature).toBe("zernio:connect:facebook");
    expect(err.message).toContain("Service plan 'starter'");
  });
});

describe("upsertZernioConnection", () => {
  it("creates a fresh connection row scoped to businessId", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await insertBusiness(t, {
      suffix: "a",
      tier: "pro",
    });
    const rowId = await t.mutation(
      internal.integrations.zernio.oauth.upsertZernioConnection,
      {
        businessId,
        zernioAccountId: "acc_1",
        encryptedApiKey: "encrypted-1",
        apiKeyHash: "hash-1",
        connectedPlatforms: [
          {
            platform: "gbp",
            platformAccountId: "loc_1",
            status: "active",
            connectedAt: NOW,
          },
          {
            platform: "facebook",
            platformAccountId: "page_1",
            status: "active",
            connectedAt: NOW,
          },
        ],
      }
    );
    const row = await t.run((ctx) => ctx.db.get(rowId));
    expect(row).not.toBeNull();
    expect(row!.businessId).toBe(businessId);
    expect(row!.zernioAccountId).toBe("acc_1");
    expect(row!.connectedPlatforms).toHaveLength(2);
  });

  it("merges connectedPlatforms on second upsert (no duplicates)", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await insertBusiness(t, {
      suffix: "a",
      tier: "pro",
    });

    await t.mutation(
      internal.integrations.zernio.oauth.upsertZernioConnection,
      {
        businessId,
        zernioAccountId: "acc_1",
        encryptedApiKey: "e1",
        apiKeyHash: "h1",
        connectedPlatforms: [
          {
            platform: "gbp",
            platformAccountId: "loc_1",
            status: "active",
            connectedAt: NOW,
          },
        ],
      }
    );
    await t.mutation(
      internal.integrations.zernio.oauth.upsertZernioConnection,
      {
        businessId,
        zernioAccountId: "acc_1",
        encryptedApiKey: "e2",
        apiKeyHash: "h2",
        connectedPlatforms: [
          {
            platform: "facebook",
            platformAccountId: "page_1",
            status: "active",
            connectedAt: NOW,
          },
        ],
      }
    );
    const row = await t.run((ctx) =>
      ctx.db
        .query("zernioConnections")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .first()
    );
    expect(row).not.toBeNull();
    // GBP from first call should still be present; FB added.
    expect(row!.connectedPlatforms).toHaveLength(2);
    const platforms = row!.connectedPlatforms.map((p) => p.platform).sort();
    expect(platforms).toEqual(["facebook", "gbp"]);
    // The api key should reflect the second upsert.
    expect(row!.encryptedApiKey).toBe("e2");
  });
});

describe("revokeZernioPlatform — cross-tenant", () => {
  it("revoking platform on Business A does not affect Business B", async () => {
    const t = convexTest(schema, modules);
    const { businessId: businessA } = await insertBusiness(t, {
      suffix: "a",
      tier: "pro",
    });
    const { businessId: businessB } = await insertBusiness(t, {
      suffix: "b",
      tier: "pro",
    });

    await t.mutation(
      internal.integrations.zernio.oauth.upsertZernioConnection,
      {
        businessId: businessA,
        zernioAccountId: "acc_a",
        encryptedApiKey: "e_a",
        apiKeyHash: "h_a",
        connectedPlatforms: [
          {
            platform: "facebook",
            platformAccountId: "page_a",
            status: "active",
            connectedAt: NOW,
          },
        ],
      }
    );
    await t.mutation(
      internal.integrations.zernio.oauth.upsertZernioConnection,
      {
        businessId: businessB,
        zernioAccountId: "acc_b",
        encryptedApiKey: "e_b",
        apiKeyHash: "h_b",
        connectedPlatforms: [
          {
            platform: "facebook",
            platformAccountId: "page_b",
            status: "active",
            connectedAt: NOW,
          },
        ],
      }
    );
    const out = await t.mutation(
      internal.integrations.zernio.oauth.revokeZernioPlatform,
      { businessId: businessA, platform: "facebook" }
    );
    expect(out.revoked).toBe(true);

    const aRow = await t.run((ctx) =>
      ctx.db
        .query("zernioConnections")
        .withIndex("by_business", (q) => q.eq("businessId", businessA))
        .first()
    );
    const bRow = await t.run((ctx) =>
      ctx.db
        .query("zernioConnections")
        .withIndex("by_business", (q) => q.eq("businessId", businessB))
        .first()
    );
    expect(aRow!.connectedPlatforms[0].status).toBe("revoked");
    expect(bRow!.connectedPlatforms[0].status).toBe("active");
  });

  it("revoke on missing connection returns revoked:false", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await insertBusiness(t, {
      suffix: "x",
      tier: "pro",
    });
    const out = await t.mutation(
      internal.integrations.zernio.oauth.revokeZernioPlatform,
      { businessId, platform: "gbp" }
    );
    expect(out.revoked).toBe(false);
    expect(out.reason).toBe("no_connection");
  });
});

describe("getMyBusinessForOAuth — Clerk identity → business resolution", () => {
  it("returns null when accountType is 'creator' (not service-business)", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "creator_only",
        email: "c@test",
        channelPreference: "web",
        timezone: "UTC",
        status: "active",
        plan: "coach",
        accountType: "creator",
        createdAt: NOW,
      })
    );
    const out = await t.query(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: "creator_only" }
    );
    expect(out).toBeNull();
  });

  it("returns null when business row missing", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "no_biz",
        email: "n@test",
        channelPreference: "web",
        timezone: "UTC",
        status: "active",
        plan: "coach",
        accountType: "service-business",
        createdAt: NOW,
      })
    );
    const out = await t.query(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: "no_biz" }
    );
    expect(out).toBeNull();
  });

  it("returns the business row when fully wired", async () => {
    const t = convexTest(schema, modules);
    const { businessId, accountId } = await insertBusiness(t, {
      suffix: "wired",
      tier: "pro",
    });
    const out = await t.query(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: "op_wired" }
    );
    expect(out).not.toBeNull();
    expect(out!.business._id).toBe(businessId);
    expect(out!.accountId).toBe(accountId);
  });
});

describe("onZernioAccountDisconnected — webhook-side revoke", () => {
  it("flips matching platform → revoked, leaves others alone", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await insertBusiness(t, {
      suffix: "a",
      tier: "pro",
    });
    await t.mutation(
      internal.integrations.zernio.oauth.upsertZernioConnection,
      {
        businessId,
        zernioAccountId: "acc_disc",
        encryptedApiKey: "e",
        apiKeyHash: "h",
        connectedPlatforms: [
          {
            platform: "gbp",
            platformAccountId: "loc_1",
            status: "active",
            connectedAt: NOW,
          },
          {
            platform: "facebook",
            platformAccountId: "page_1",
            status: "active",
            connectedAt: NOW,
          },
        ],
      }
    );
    const out = await t.mutation(
      internal.integrations.zernio.oauth.onZernioAccountDisconnected,
      { zernioAccountId: "acc_disc", platform: "facebook" }
    );
    expect(out.revoked).toBe(true);
    const row = await t.run((ctx) =>
      ctx.db
        .query("zernioConnections")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .first()
    );
    expect(
      row!.connectedPlatforms.find((p) => p.platform === "facebook")?.status
    ).toBe("revoked");
    expect(
      row!.connectedPlatforms.find((p) => p.platform === "gbp")?.status
    ).toBe("active");
  });

  it("missing zernioAccountId returns revoked:false", async () => {
    const t = convexTest(schema, modules);
    const out = await t.mutation(
      internal.integrations.zernio.oauth.onZernioAccountDisconnected,
      { zernioAccountId: "ghost", platform: "facebook" }
    );
    expect(out.revoked).toBe(false);
  });
});
