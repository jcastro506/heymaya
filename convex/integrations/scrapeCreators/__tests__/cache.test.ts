/**
 * cache.ts — TTL behavior + cross-tenant isolation tests.
 *
 * Covers:
 *  - getCached returns null on miss
 *  - getCached returns the payload on hit (within TTL)
 *  - getCached returns null on expiry (now > fetchedAt + ttlSec*1000)
 *  - setCached upserts (insert then patch)
 *  - cross-tenant: creator A and B can hold the same cacheKey, neither sees the other's row
 *  - purgeCreator deletes only the requested creator's rows
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import {
  getCached,
  setCached,
  cacheKey,
  TTL_PROFILE_SEC,
} from "../cache";

import { modules } from "../../../../tests/_modules";

const NOW = 1_700_000_000_000;

async function makeCreator(t: ReturnType<typeof convexTest>, suffix: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "pro",
      createdAt: NOW,
    })
  );
}

describe("cache — TTL behavior", () => {
  it("returns null on miss", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "miss");
    const out = await t.run(async (ctx) =>
      getCached(ctx, creatorId, cacheKey("tiktok", "profile", "any"), NOW)
    );
    expect(out).toBeNull();
  });

  it("returns the payload on hit when within TTL", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "hit");
    const key = cacheKey("tiktok", "profile", "fitcreator");
    await t.run(async (ctx) =>
      setCached(ctx, creatorId, key, { x: 1 }, TTL_PROFILE_SEC, NOW)
    );
    const out = await t.run(async (ctx) =>
      getCached<{ x: number }>(ctx, creatorId, key, NOW + 1000)
    );
    expect(out).toEqual({ x: 1 });
  });

  it("returns null when payload is older than TTL", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "expired");
    const key = cacheKey("instagram", "posts", "lena");
    await t.run(async (ctx) =>
      setCached(ctx, creatorId, key, { items: [1, 2] }, 60, NOW)
    );
    // 61 seconds later — expired (TTL=60s).
    const out = await t.run(async (ctx) =>
      getCached(ctx, creatorId, key, NOW + 61_000)
    );
    expect(out).toBeNull();
  });

  it("upserts: a second setCached overwrites the prior payload", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "upsert");
    const key = cacheKey("youtube", "profile", "@codecast");
    await t.run(async (ctx) =>
      setCached(ctx, creatorId, key, { v: 1 }, 3600, NOW)
    );
    await t.run(async (ctx) =>
      setCached(ctx, creatorId, key, { v: 2 }, 3600, NOW + 100)
    );

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCache")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ v: 2 });
    expect(rows[0].fetchedAt).toBe(NOW + 100);
  });
});

describe("cache — cross-tenant isolation (CRITICAL)", () => {
  it("creator A's payload is never visible to creator B for the same cacheKey", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await makeCreator(t, "A");
    const creatorB = await makeCreator(t, "B");
    const key = cacheKey("tiktok", "profile", "shared_competitor");

    await t.run(async (ctx) =>
      setCached(ctx, creatorA, key, { secret: "A_only" }, 3600, NOW)
    );
    await t.run(async (ctx) =>
      setCached(ctx, creatorB, key, { secret: "B_only" }, 3600, NOW)
    );

    const aOut = await t.run(async (ctx) =>
      getCached<{ secret: string }>(ctx, creatorA, key, NOW + 100)
    );
    const bOut = await t.run(async (ctx) =>
      getCached<{ secret: string }>(ctx, creatorB, key, NOW + 100)
    );
    expect(aOut?.secret).toBe("A_only");
    expect(bOut?.secret).toBe("B_only");

    // Asking for B's row from A's id must miss (the row exists but is owned by B).
    const aRowsOnly = await t.run(async (ctx) =>
      ctx.db
        .query("scrapeCreatorsCache")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorA))
        .collect()
    );
    expect(aRowsOnly).toHaveLength(1);
    expect(aRowsOnly[0].creatorId).toBe(creatorA);
    for (const row of aRowsOnly) {
      expect(row.creatorId).not.toBe(creatorB);
    }
  });

  it("purgeCreator only deletes the requested creator's rows", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await makeCreator(t, "purgeA");
    const creatorB = await makeCreator(t, "purgeB");
    await t.run(async (ctx) => {
      await setCached(ctx, creatorA, cacheKey("tiktok", "profile", "x"), { z: 1 }, 3600, NOW);
      await setCached(ctx, creatorA, cacheKey("tiktok", "posts", "x"), { z: 2 }, 3600, NOW);
      await setCached(ctx, creatorB, cacheKey("tiktok", "profile", "y"), { z: 3 }, 3600, NOW);
    });

    const result = await t.mutation(
      internal.integrations.scrapeCreators.cache.purgeCreator,
      { creatorId: creatorA }
    );
    expect(result.deleted).toBe(2);

    const remaining = await t.run(async (ctx) =>
      ctx.db.query("scrapeCreatorsCache").collect()
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].creatorId).toBe(creatorB);
  });
});

describe("cache — internalQuery / internalMutation surface", () => {
  it("getCachedRow returns { payload } on hit and null on miss", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await makeCreator(t, "iq");
    const key = cacheKey("x", "profile", "saaspov");

    const miss = await t.query(
      internal.integrations.scrapeCreators.cache.getCachedRow,
      { creatorId, key }
    );
    expect(miss).toBeNull();

    await t.mutation(
      internal.integrations.scrapeCreators.cache.setCachedRow,
      { creatorId, key, payload: { hello: "world" }, ttlSec: 600 }
    );
    const hit = await t.query(
      internal.integrations.scrapeCreators.cache.getCachedRow,
      { creatorId, key }
    );
    expect(hit).toEqual({ payload: { hello: "world" } });
  });
});
