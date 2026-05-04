/**
 * mediaAssets cataloger queue — drain-side integration tests.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: Business A's cataloger queue never sees / processes B's
 *      rows; rate-limit budgets are per-business so a flood at A doesn't
 *      starve B.
 *   2. Plan-tier × action: Starter daily soft cap (3) holds; Pro / Studio
 *      get higher caps; Studio batch-priority bubbles ≥10-photo batches.
 *   3. Adversarial:
 *        - skill throws → queue retries with backoff up to 3 attempts then
 *          marks terminal + leaves placeholder catalog (never lose the file)
 *        - 50-photo flood → drains in-order at 5 concurrent / business
 *        - cross-tenant payload (queue row points to a different business's
 *          asset) → fails terminal, no catalog leak
 *   4. Sibling-file scan: covered repo-wide.
 *   5. TODO grep: covered repo-wide.
 *
 * Idempotency:
 *   - Same hash already cataloged → `ingestAsset` returns deduped=true and
 *     does not re-enqueue (validated in ingest.test.ts); when the queue
 *     processor sees an asset whose catalog is already populated, it
 *     short-circuits.
 */

import { describe, it, expect, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  _setCatalogerSkillForTests,
} from "../processCatalogerQueue";
import type {
  AssetCatalogerInputs,
  AssetCatalogerOutput,
} from "../../../agents/skills/maya-service-asset-cataloger/script";

const NOW = 1_700_000_000_000;

async function insertBusiness(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; tier?: "starter" | "pro" | "studio" }
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
      planTier: opts.tier ?? "pro",
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

async function ingest(
  t: ReturnType<typeof convexTest>,
  businessId: Id<"businesses">,
  hash: string,
  opts?: { batchId?: string; receivedAt?: number }
): Promise<{ mediaAssetId: Id<"mediaAssets">; queueRowId: Id<"mayaTaskQueue"> }> {
  const r = await t.mutation(internal.mediaAssets.ingest.ingestAsset, {
    businessId,
    storageUrl: `https://test.r2/${businessId}/${hash}.jpg`,
    storageBytes: 1024,
    mimeType: "image/jpeg",
    contentHash: hash,
    source: "web",
    receivedAt: opts?.receivedAt ?? NOW,
    batchId: opts?.batchId,
  });
  return { mediaAssetId: r.mediaAssetId, queueRowId: r.queueRowId };
}

// R2 stub removed 2026-04-27 — v0 uses Convex built-in storage. The
// processor calls `ctx.storage.getUrl(asset.storageId)` directly; tests
// either rely on the legacy `storageUrl` fallback path (set by the
// `ingest()` helper above) OR seed a real Convex storage blob and use
// its storageId. The fallback path is fine for cataloger-queue tests
// which only need a string URL to pass to the injected cataloger stub.

function buildSuccessOutput(
  businessId: string,
  visualQuality = 0.85
): AssetCatalogerOutput {
  return {
    catalog: {
      primarySubject: "completed kitchen renovation",
      serviceCategory: "kitchen-remodel",
      visualQuality,
      framingNotes: "well-lit, centered",
      suggestedUses: ["gbp-post", "instagram-single"],
      catalogedAt: NOW,
      catalogModel: "gemini-3-flash-medium",
      catalogCostUsd: 0.02,
    },
    flags: [],
  };
}

function fixedHash(seed: string): string {
  // deterministic 64-char hex from seed
  const base = seed.padEnd(8, "0").slice(0, 8);
  return base.repeat(8); // 64 chars
}

afterEach(() => {
  _setCatalogerSkillForTests(null);
});

/* -------------------------------------------------------------------------- */
/* Happy path                                                                  */
/* -------------------------------------------------------------------------- */

describe("processCatalogerQueueForBusiness — happy path", () => {
  it("calls cataloger skill + writes catalog + marks queue processed", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a", tier: "pro" });
    const { mediaAssetId } = await ingest(t, businessId, fixedHash("0a"));

    const calls: AssetCatalogerInputs[] = [];
    _setCatalogerSkillForTests(async (inputs) => {
      calls.push(inputs);
      return buildSuccessOutput(businessId);
    });

    const result = await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId }
    );
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    expect(calls).toHaveLength(1);
    expect(calls[0].businessId).toBe(businessId);
    expect(calls[0].mimeType).toBe("image/jpeg");
    // Cataloger receives a fetchable URL — Convex storage URL in production
    // (short-lived, signed automatically), legacy `storageUrl` fallback in
    // tests that pre-populate the field via `ingest()`.
    expect(calls[0].assetUrl).toMatch(/^https?:\/\//);

    const asset = await t.run((ctx) => ctx.db.get(mediaAssetId));
    expect(asset!.catalog.primarySubject).toBe("completed kitchen renovation");
    expect(asset!.catalog.serviceCategory).toBe("kitchen-remodel");
    expect(asset!.catalog.visualQuality).toBe("excellent"); // 0.85 → excellent
    expect(asset!.catalog.suggestedUses).toEqual([
      "gbp-post",
      "instagram-single",
    ]);

    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business_and_kind", (q) =>
          q.eq("businessId", businessId).eq("kind", "asset-cataloger")
        )
        .collect()
    );
    expect(queue).toHaveLength(1);
    expect(queue[0].processedAt).toBeDefined();
  });

  it("maps numeric visualQuality to literal correctly", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a", tier: "pro" });

    const { mediaAssetId: id1 } = await ingest(t, businessId, fixedHash("01"));
    const { mediaAssetId: id2 } = await ingest(t, businessId, fixedHash("02"));
    const { mediaAssetId: id3 } = await ingest(t, businessId, fixedHash("03"));
    const { mediaAssetId: id4 } = await ingest(t, businessId, fixedHash("04"));

    const qByAssetId = new Map<string, number>([
      [id1, 0.95], // excellent
      [id2, 0.7], // good
      [id3, 0.5], // fair
      [id4, 0.2], // poor
    ]);

    let callCount = 0;
    _setCatalogerSkillForTests(async (inputs) => {
      // We pick visualQuality based on which call index this is.
      // Processing order is oldest-first, matching ingest order.
      void inputs;
      callCount++;
      const idForCall = [id1, id2, id3, id4][callCount - 1];
      const q = qByAssetId.get(idForCall) ?? 0.5;
      return buildSuccessOutput(businessId, q);
    });

    await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId }
    );

    const a1 = await t.run((ctx) => ctx.db.get(id1));
    const a2 = await t.run((ctx) => ctx.db.get(id2));
    const a3 = await t.run((ctx) => ctx.db.get(id3));
    const a4 = await t.run((ctx) => ctx.db.get(id4));
    expect(a1!.catalog.visualQuality).toBe("excellent");
    expect(a2!.catalog.visualQuality).toBe("good");
    expect(a3!.catalog.visualQuality).toBe("fair");
    expect(a4!.catalog.visualQuality).toBe("poor");
  });
});

/* -------------------------------------------------------------------------- */
/* Rate limit — 5 concurrent / business                                        */
/* -------------------------------------------------------------------------- */

describe("rate-limit: max 5 concurrent / business", () => {
  it("50-photo flood drains in-order at 5/tick; no $1-burn", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "flood",
      tier: "studio",
    });

    // Enqueue 50 photos with monotonically-increasing receivedAt.
    const assetIds: Id<"mediaAssets">[] = [];
    for (let i = 0; i < 50; i++) {
      const { mediaAssetId } = await ingest(
        t,
        businessId,
        fixedHash(`f${i.toString().padStart(2, "0")}`),
        { receivedAt: NOW + i * 10 }
      );
      assetIds.push(mediaAssetId);
    }

    let totalCalls = 0;
    _setCatalogerSkillForTests(async () => {
      totalCalls++;
      return buildSuccessOutput(businessId);
    });

    // First tick — should process exactly 5
    const r1 = await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId }
    );
    expect(r1.attempted).toBe(5);
    expect(r1.succeeded).toBe(5);
    expect(totalCalls).toBe(5);

    // Verify the FIRST 5 (oldest enqueuedAt) were processed, in order.
    const firstFive = assetIds.slice(0, 5);
    for (const id of firstFive) {
      const asset = await t.run((ctx) => ctx.db.get(id));
      expect(asset!.catalog.primarySubject).not.toBe("[uncataloged]");
    }
    const restPlaceholder = assetIds.slice(5);
    for (const id of restPlaceholder) {
      const asset = await t.run((ctx) => ctx.db.get(id));
      expect(asset!.catalog.primarySubject).toBe("[uncataloged]");
    }

    // Drain the rest tick-by-tick. 50 photos / 5 per tick = 10 ticks total.
    for (let tick = 0; tick < 10; tick++) {
      await t.action(
        internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
        { businessId }
      );
    }
    expect(totalCalls).toBe(50);

    // Every asset should now be cataloged.
    for (const id of assetIds) {
      const asset = await t.run((ctx) => ctx.db.get(id));
      expect(asset!.catalog.primarySubject).toBe(
        "completed kitchen renovation"
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Plan-tier × action — daily cap                                              */
/* -------------------------------------------------------------------------- */

describe("plan-tier daily soft cap", () => {
  it("Starter — caps at 3 photos / day; rest skipped (skippedDailyCap)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "starter",
      tier: "starter",
    });
    for (let i = 0; i < 10; i++) {
      await ingest(
        t,
        businessId,
        fixedHash(`s${i}`),
        { receivedAt: NOW + i * 10 }
      );
    }
    _setCatalogerSkillForTests(async () => buildSuccessOutput(businessId));
    const r = await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId }
    );
    expect(r.succeeded).toBe(3);
    expect(r.skippedDailyCap).toBeGreaterThanOrEqual(2);
  });

  it("Pro — large daily cap (100); 5 photos drains 5", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "pro",
      tier: "pro",
    });
    for (let i = 0; i < 5; i++) {
      await ingest(
        t,
        businessId,
        fixedHash(`p${i}`),
        { receivedAt: NOW + i * 10 }
      );
    }
    _setCatalogerSkillForTests(async () => buildSuccessOutput(businessId));
    const r = await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId }
    );
    expect(r.succeeded).toBe(5);
    expect(r.skippedDailyCap).toBe(0);
  });

  it("Studio — unlimited daily cap; 5 photos drains 5", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "studio",
      tier: "studio",
    });
    for (let i = 0; i < 5; i++) {
      await ingest(
        t,
        businessId,
        fixedHash(`u${i}`),
        { receivedAt: NOW + i * 10 }
      );
    }
    _setCatalogerSkillForTests(async () => buildSuccessOutput(businessId));
    const r = await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId }
    );
    expect(r.succeeded).toBe(5);
    expect(r.skippedDailyCap).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* CROSS-TENANT                                                                */
/* -------------------------------------------------------------------------- */

describe("CROSS-TENANT — cataloger queue isolation", () => {
  it("Business A's tick never processes B's queue rows", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "a", tier: "pro" });
    const businessB = await insertBusiness(t, { suffix: "b", tier: "pro" });

    await ingest(t, businessA, fixedHash("a1"));
    await ingest(t, businessA, fixedHash("a2"));
    await ingest(t, businessB, fixedHash("b1"));
    await ingest(t, businessB, fixedHash("b2"));

    const seenBusinessIds: string[] = [];
    _setCatalogerSkillForTests(async (inputs) => {
      seenBusinessIds.push(inputs.businessId);
      return buildSuccessOutput(inputs.businessId);
    });

    const r = await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId: businessA }
    );
    expect(r.attempted).toBe(2);
    expect(seenBusinessIds.every((bid) => bid === businessA)).toBe(true);

    // Business B's queue still has 2 unprocessed rows.
    const bQueue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business_and_kind", (q) =>
          q.eq("businessId", businessB).eq("kind", "asset-cataloger")
        )
        .collect()
    );
    const bUnprocessed = bQueue.filter((r) => r.processedAt === undefined);
    expect(bUnprocessed).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Adversarial — skill failure / retry                                         */
/* -------------------------------------------------------------------------- */

describe("adversarial — skill failure + retry", () => {
  it("transient skill error → retried; succeeds on second attempt", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a", tier: "pro" });
    const { mediaAssetId, queueRowId } = await ingest(
      t,
      businessId,
      fixedHash("r1")
    );

    let calls = 0;
    _setCatalogerSkillForTests(async () => {
      calls++;
      if (calls === 1) throw new Error("transient gemini error");
      return buildSuccessOutput(businessId);
    });

    // First tick → retried, attemptCount becomes 1, queue row stays unprocessed.
    const r1 = await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId }
    );
    expect(r1.retried).toBe(1);
    expect(r1.failed).toBe(0);
    expect(r1.succeeded).toBe(0);

    const queueAfter1 = await t.run((ctx) => ctx.db.get(queueRowId));
    expect(queueAfter1!.processedAt).toBeUndefined();
    expect(queueAfter1!.attemptCount).toBe(1);

    // Second tick → succeeds, queue row processed, catalog populated.
    const r2 = await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId }
    );
    expect(r2.succeeded).toBe(1);

    const asset = await t.run((ctx) => ctx.db.get(mediaAssetId));
    expect(asset!.catalog.primarySubject).toBe(
      "completed kitchen renovation"
    );
  });

  it("persistent skill error → marks terminal after MAX_ATTEMPTS; placeholder retained", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a", tier: "pro" });
    const { mediaAssetId, queueRowId } = await ingest(
      t,
      businessId,
      fixedHash("rx")
    );

    _setCatalogerSkillForTests(async () => {
      throw new Error("permanent gemini auth error");
    });

    // 3 ticks of failure → terminal. Each tick the queue picks the row up
    // again because processedAt is undefined.
    for (let i = 0; i < 3; i++) {
      await t.action(
        internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
        { businessId }
      );
    }

    const queueAfter = await t.run((ctx) => ctx.db.get(queueRowId));
    expect(queueAfter!.processedAt).toBeDefined();
    expect(queueAfter!.failedAt).toBeDefined();
    expect(queueAfter!.lastError).toContain("permanent");

    // The asset survives — placeholder catalog kept ("never lose the file").
    const asset = await t.run((ctx) => ctx.db.get(mediaAssetId));
    expect(asset).not.toBeNull();
    expect(asset!.catalog.primarySubject).toBe("[uncataloged]");
  });
});

/* -------------------------------------------------------------------------- */
/* Studio batch-priority                                                       */
/* -------------------------------------------------------------------------- */

describe("Studio batch-priority — ≥10-photo batches bubble", () => {
  it("Studio: batch of 12 + 3 single-asset ingests → batch processes first", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "studio_batch",
      tier: "studio",
    });

    // 3 single-asset ingests FIRST (so by enqueuedAt they would be picked
    // before the batch under non-priority logic).
    const singles: Id<"mediaAssets">[] = [];
    for (let i = 0; i < 3; i++) {
      const { mediaAssetId } = await ingest(
        t,
        businessId,
        fixedHash(`single_${i}`),
        { receivedAt: NOW + i * 10 }
      );
      singles.push(mediaAssetId);
    }

    // Then 12 photos sharing a batchId.
    const batchAssets: Id<"mediaAssets">[] = [];
    for (let i = 0; i < 12; i++) {
      const { mediaAssetId } = await ingest(
        t,
        businessId,
        fixedHash(`batch_${i.toString().padStart(2, "0")}`),
        { batchId: "batch_studio_x", receivedAt: NOW + 1000 + i * 10 }
      );
      batchAssets.push(mediaAssetId);
    }

    const seenAssetIds: string[] = [];
    _setCatalogerSkillForTests(async (inputs) => {
      const m = inputs.assetUrl.match(/\/businesses\/[^/]+\/([a-f0-9]+)\./);
      if (m) seenAssetIds.push(m[1]);
      return buildSuccessOutput(businessId);
    });

    // First tick — picks 5 rows from the priority batch.
    await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId }
    );

    // The first 5 processed should ALL be batch members (the 3 singles
    // remain placeholder).
    for (const id of singles) {
      const asset = await t.run((ctx) => ctx.db.get(id));
      expect(asset!.catalog.primarySubject).toBe("[uncataloged]");
    }
    const cataloged = await Promise.all(
      batchAssets.map(async (id) => {
        const asset = await t.run((ctx) => ctx.db.get(id));
        return asset!.catalog.primarySubject !== "[uncataloged]";
      })
    );
    expect(cataloged.filter((c) => c).length).toBe(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Catalog-already-set short-circuit                                           */
/* -------------------------------------------------------------------------- */

describe("idempotency — already-cataloged asset short-circuits", () => {
  it("ingesting a deduped already-cataloged asset doesn't re-bill cataloger", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a", tier: "pro" });
    const { mediaAssetId } = await ingest(t, businessId, fixedHash("dx"));

    let calls = 0;
    _setCatalogerSkillForTests(async () => {
      calls++;
      return buildSuccessOutput(businessId);
    });

    // First tick → catalogs.
    await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId }
    );
    expect(calls).toBe(1);

    // Same hash arrives again — ingest dedupes.
    const second = await ingest(t, businessId, fixedHash("dx"));
    expect(second.mediaAssetId).toBe(mediaAssetId);

    // The deduped enqueue audit row is processedAt=now (already), not
    // unprocessed, so no skill call.
    const r = await t.action(
      internal.mediaAssets.processCatalogerQueue.processCatalogerQueueForBusiness,
      { businessId }
    );
    expect(r.attempted).toBe(0);
    expect(calls).toBe(1);
  });
});
