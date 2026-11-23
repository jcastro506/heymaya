import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { isSimCreator } from "../stale";

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
});
