/**
 * mediaAssets read API — integration tests under convex-test.
 *
 * Covers cross-tenant + idempotency for the four public surfaces:
 *   - listAssets (filters: serviceCategory, hasNotPostedTo, includeArchived,
 *     catalogedOnly)
 *   - getAsset (cross-tenant null-on-mismatch)
 *   - archiveAsset (cross-tenant throw, idempotent re-archive)
 *   - recordPostUsage (cross-tenant throw, idempotent on (platform, postId))
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function insertBusiness(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string }
): Promise<Id<"businesses">> {
  const accountId = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `op_${opts.suffix}`,
      email: `${opts.suffix}@svc.test`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "coach",
      accountType: "service-business",
      createdAt: NOW,
    })
  );
  return await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId,
      name: `Business ${opts.suffix}`,
      serviceTypes: ["hvac"],
      planTier: "pro",
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

async function seedCatalogedAsset(
  t: ReturnType<typeof convexTest>,
  businessId: Id<"businesses">,
  opts: {
    serviceCategory?: string;
    visualQuality?: "excellent" | "good" | "fair" | "poor";
    archived?: boolean;
    receivedAt?: number;
    usageHistory?: Array<{
      platform: "gbp" | "facebook" | "instagram" | "tiktok";
      postId?: string;
      postedAt: number;
    }>;
    placeholder?: boolean;
  }
): Promise<Id<"mediaAssets">> {
  return await t.run((ctx) =>
    ctx.db.insert("mediaAssets", {
      businessId,
      storageUrl: `https://test.r2/${businessId}/${Math.random().toString(16).slice(2)}.jpg`,
      storageBytes: 1024,
      mimeType: "image/jpeg",
      source: "web",
      receivedAt: opts.receivedAt ?? NOW,
      catalog: {
        primarySubject: opts.placeholder
          ? "[uncataloged]"
          : "kitchen remodel",
        serviceCategory: opts.serviceCategory ?? "kitchen-remodel",
        visualQuality: opts.visualQuality ?? "good",
        framingNotes: "centered",
        suggestedUses: ["gbp-post"],
        catalogedAt: NOW,
        catalogModel: "gemini-3-flash-medium",
        catalogCostUsd: 0.02,
      },
      usageHistory: opts.usageHistory ?? [],
      archivedAt: opts.archived ? NOW - 1000 : undefined,
    })
  );
}

/* -------------------------------------------------------------------------- */
/* listAssets                                                                  */
/* -------------------------------------------------------------------------- */

describe("listAssets", () => {
  it("returns all non-archived for a business", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await seedCatalogedAsset(t, businessId, {});
    await seedCatalogedAsset(t, businessId, {});

    const result = await t.query(api.mediaAssets.listAssets.listAssets, {
      businessId,
    });
    expect(result.rows).toHaveLength(2);
  });

  it("excludes archived rows by default; includes when includeArchived=true", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await seedCatalogedAsset(t, businessId, {});
    await seedCatalogedAsset(t, businessId, { archived: true });

    const defaultList = await t.query(api.mediaAssets.listAssets.listAssets, {
      businessId,
    });
    expect(defaultList.rows).toHaveLength(1);

    const withArchived = await t.query(
      api.mediaAssets.listAssets.listAssets,
      { businessId, includeArchived: true }
    );
    expect(withArchived.rows).toHaveLength(2);
  });

  it("filters by serviceCategory", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await seedCatalogedAsset(t, businessId, {
      serviceCategory: "kitchen-remodel",
    });
    await seedCatalogedAsset(t, businessId, {
      serviceCategory: "hvac-install",
    });

    const result = await t.query(api.mediaAssets.listAssets.listAssets, {
      businessId,
      serviceCategory: "hvac-install",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].catalog.serviceCategory).toBe("hvac-install");
  });

  it("hasNotPostedTo: excludes assets that already hit the platform", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await seedCatalogedAsset(t, businessId, {
      usageHistory: [{ platform: "gbp", postId: "p_1", postedAt: NOW }],
    });
    await seedCatalogedAsset(t, businessId, {
      usageHistory: [
        { platform: "facebook", postId: "p_2", postedAt: NOW },
      ],
    });

    const notOnGbp = await t.query(api.mediaAssets.listAssets.listAssets, {
      businessId,
      hasNotPostedTo: "gbp",
    });
    expect(notOnGbp.rows).toHaveLength(1);
    expect(notOnGbp.rows[0].usageHistory[0].platform).toBe("facebook");
  });

  it("catalogedOnly: excludes placeholder-catalog rows", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await seedCatalogedAsset(t, businessId, {});
    await seedCatalogedAsset(t, businessId, { placeholder: true });

    const result = await t.query(api.mediaAssets.listAssets.listAssets, {
      businessId,
      catalogedOnly: true,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].catalog.primarySubject).toBe("kitchen remodel");
  });

  it("CROSS-TENANT: never returns Business B's rows", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "a" });
    const businessB = await insertBusiness(t, { suffix: "b" });
    await seedCatalogedAsset(t, businessA, {});
    await seedCatalogedAsset(t, businessA, {});
    await seedCatalogedAsset(t, businessB, {});

    const a = await t.query(api.mediaAssets.listAssets.listAssets, {
      businessId: businessA,
    });
    expect(a.rows).toHaveLength(2);

    const b = await t.query(api.mediaAssets.listAssets.listAssets, {
      businessId: businessB,
    });
    expect(b.rows).toHaveLength(1);
    // Defense-in-depth: every returned row's businessId-scoped via internal twin.
    const aInternal = await t.query(
      internal.mediaAssets.listAssets.listAssetsInternal,
      { businessId: businessA }
    );
    expect(aInternal.rows).toHaveLength(2);
  });

  it("internal twin returns same shape as public", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await seedCatalogedAsset(t, businessId, {});

    const result = await t.query(
      internal.mediaAssets.listAssets.listAssetsInternal,
      { businessId }
    );
    expect(result.rows).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* getAsset                                                                    */
/* -------------------------------------------------------------------------- */

describe("getAsset", () => {
  it("returns the row when business owns it", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const id = await seedCatalogedAsset(t, businessId, {});
    const row = await t.query(api.mediaAssets.listAssets.getAsset, {
      businessId,
      assetId: id,
    });
    expect(row).not.toBeNull();
    expect(row!._id).toBe(id);
  });

  it("CROSS-TENANT: returns null when querying with wrong businessId", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "a" });
    const businessB = await insertBusiness(t, { suffix: "b" });
    const idA = await seedCatalogedAsset(t, businessA, {});

    const row = await t.query(api.mediaAssets.listAssets.getAsset, {
      businessId: businessB,
      assetId: idA,
    });
    expect(row).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* archiveAsset                                                                */
/* -------------------------------------------------------------------------- */

describe("archiveAsset", () => {
  it("sets archivedAt", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const id = await seedCatalogedAsset(t, businessId, {});

    await t.mutation(api.mediaAssets.listAssets.archiveAsset, {
      businessId,
      assetId: id,
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row!.archivedAt).toBeDefined();
  });

  it("idempotent — second archive doesn't bump archivedAt", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const id = await seedCatalogedAsset(t, businessId, {});

    await t.mutation(api.mediaAssets.listAssets.archiveAsset, {
      businessId,
      assetId: id,
    });
    const after1 = await t.run((ctx) => ctx.db.get(id));
    const ts1 = after1!.archivedAt;
    expect(ts1).toBeDefined();

    await t.mutation(api.mediaAssets.listAssets.archiveAsset, {
      businessId,
      assetId: id,
    });
    const after2 = await t.run((ctx) => ctx.db.get(id));
    expect(after2!.archivedAt).toBe(ts1);
  });

  it("CROSS-TENANT: throws when caller's businessId doesn't own the asset", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "a" });
    const businessB = await insertBusiness(t, { suffix: "b" });
    const idA = await seedCatalogedAsset(t, businessA, {});

    await expect(
      t.mutation(api.mediaAssets.listAssets.archiveAsset, {
        businessId: businessB,
        assetId: idA,
      })
    ).rejects.toThrow(/cross-tenant/);
  });
});

/* -------------------------------------------------------------------------- */
/* recordPostUsage                                                             */
/* -------------------------------------------------------------------------- */

describe("recordPostUsage", () => {
  it("appends a usage record", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const id = await seedCatalogedAsset(t, businessId, {});

    await t.mutation(api.mediaAssets.listAssets.recordPostUsage, {
      businessId,
      assetId: id,
      platform: "gbp",
      postId: "post_1",
      postedAt: NOW,
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row!.usageHistory).toEqual([
      { platform: "gbp", postId: "post_1", postedAt: NOW },
    ]);
  });

  it("idempotent on (platform, postId)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const id = await seedCatalogedAsset(t, businessId, {});

    const first = await t.mutation(
      api.mediaAssets.listAssets.recordPostUsage,
      { businessId, assetId: id, platform: "gbp", postId: "post_1" }
    );
    const second = await t.mutation(
      api.mediaAssets.listAssets.recordPostUsage,
      { businessId, assetId: id, platform: "gbp", postId: "post_1" }
    );
    expect(first.appended).toBe(true);
    expect(second.appended).toBe(false);
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row!.usageHistory).toHaveLength(1);
  });

  it("appends new platform even when other platform already used", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const id = await seedCatalogedAsset(t, businessId, {});

    await t.mutation(api.mediaAssets.listAssets.recordPostUsage, {
      businessId,
      assetId: id,
      platform: "gbp",
      postId: "p1",
    });
    await t.mutation(api.mediaAssets.listAssets.recordPostUsage, {
      businessId,
      assetId: id,
      platform: "facebook",
      postId: "p2",
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row!.usageHistory).toHaveLength(2);
  });

  it("CROSS-TENANT: throws when caller's businessId doesn't own the asset", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "a" });
    const businessB = await insertBusiness(t, { suffix: "b" });
    const idA = await seedCatalogedAsset(t, businessA, {});

    await expect(
      t.mutation(api.mediaAssets.listAssets.recordPostUsage, {
        businessId: businessB,
        assetId: idA,
        platform: "gbp",
        postId: "p1",
      })
    ).rejects.toThrow(/cross-tenant/);
  });
});
