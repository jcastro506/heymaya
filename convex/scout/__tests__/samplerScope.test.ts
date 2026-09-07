import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

describe("the same-day sample after onboarding touches only that creator's roster", () => {
  it("run with a creatorId samples their accounts and nobody else's", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" }, channel: { paired: true } }));
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("trackedAccounts", { creatorId: a, platform: "tiktok", handle: "runwithcarly", addedBy: "creator", baselineN: 12, medianPace24h: 4000, status: "active", createdAt: now } as never);
      await ctx.db.insert("trackedAccounts", { creatorId: b, platform: "tiktok", handle: "stoolpresidente", addedBy: "creator", baselineN: 12, medianPace24h: 4000, status: "active", createdAt: now } as never);
    });
    const r = await t.action(internal.scout.sampler.run, { creatorId: a });
    // Scope is the claim: one account considered, the other creator's never touched. Whether the
    // fixture read succeeds is the reads suite's business, not this test's.
    expect(r.accounts).toBe(1);
    const sampled = await t.run((ctx) => ctx.db.query("trackedAccounts").collect());
    expect(sampled.find((x) => x.handle === "stoolpresidente")?.lastSampledAt).toBeUndefined();
  });
});
