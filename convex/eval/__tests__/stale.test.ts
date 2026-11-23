import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { isDeletableSim, isSimCreator } from "../stale";

describe("pauseSims", () => {
  it("knows a sim creator by its id and never a real one", () => {
    expect(isSimCreator("eval-run:fw-abc:0")).toBe(true);
    expect(isSimCreator("eval:partnership:deals:1")).toBe(true);
    expect(isSimCreator("user_3K4Qj7nmK18q")).toBe(false);
    expect(isSimCreator(undefined)).toBe(false);
  });

  it("pauses sims, keeps the runs named and every real person", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => ({
      old: await seedCreator(ctx, "a", { clerkUserId: "eval-run:sim-1:x" } as never),
      running: await seedCreator(ctx, "b", { clerkUserId: "eval-run:fw-now:0" } as never),
      real: await seedCreator(ctx, "c", { clerkUserId: "user_real" } as never),
    }));
    expect(await t.mutation(internal.eval.stale.pauseSims, { keepRuns: ["fw-now"] })).toEqual({ paused: 1, kept: 1 });
    const st = async (id: typeof ids.old) => (await t.run((ctx) => ctx.db.get(id)))!.plan.status;
    expect(await st(ids.old)).toBe("paused");
    expect(await st(ids.running)).not.toBe("paused");
    expect(await st(ids.real)).not.toBe("paused");
  });

  it("deletes sims and their rows, never a real person or the operator's own dev account", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => ({
      sim: await seedCreator(ctx, "a", { clerkUserId: "eval-run:sim-1:x" } as never),
      mine: await seedCreator(ctx, "b", { clerkUserId: "devbare_1" } as never),
      real: await seedCreator(ctx, "c", { clerkUserId: "user_real" } as never),
    }));
    await t.run(async (ctx) => {
      await ctx.db.insert("trackedAccounts", { creatorId: ids.sim, platform: "tiktok", handle: "x", status: "active", addedBy: "creator", baselineN: 0, createdAt: 1 } as never);
      await ctx.db.insert("trackedAccounts", { creatorId: ids.real, platform: "tiktok", handle: "y", status: "active", addedBy: "creator", baselineN: 0, createdAt: 1 } as never);
      await ctx.db.insert("syncState", { key: "fw:fw-abc:state", value: "{}", updatedAt: 1 });
      await ctx.db.insert("syncState", { key: "eval:replay", value: "{}", updatedAt: 1 });
    });
    expect((await t.action(internal.eval.stale.deleteSims, {})).done).toBe(true);
    const left = await t.run(async (ctx) => ({ creators: (await ctx.db.query("creators").collect()).map((c) => c.clerkUserId).sort(), tracked: (await ctx.db.query("trackedAccounts").collect()).map((r) => r.handle), keys: (await ctx.db.query("syncState").collect()).map((r) => r.key) }));
    expect(left.creators).toEqual(["devbare_1", "user_real"]);
    expect(left.tracked).toEqual(["y"]);
    expect(left.keys).toEqual(["eval:replay"]);
    expect(isDeletableSim("devbare_1")).toBe(false);
  });
});
