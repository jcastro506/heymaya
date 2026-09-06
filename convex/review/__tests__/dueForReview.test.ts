import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { MIN_DAYS_BEFORE_REVIEW } from "../weekly";

// A Sunday, 10:00 in New York (14:00 UTC), 2026-09-06.
const SUNDAY_10AM_NY = Date.UTC(2026, 8, 6, 14, 0);

describe("no review before there is a week to review (live 2026-09-06)", () => {
  it("a creator paired this morning is not due; one paired ten days ago is", async () => {
    const t = convexTest(schema, modules);
    const fresh = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "America/New_York", channel: { paired: true } }));
    const old = await t.run((ctx) => seedCreator(ctx, "b", { timezone: "America/New_York", channel: { paired: true } }));
    await t.run(async (ctx) => {
      await ctx.db.patch(fresh, { createdAt: SUNDAY_10AM_NY - 3 * 3_600_000 });
      await ctx.db.patch(old, { createdAt: SUNDAY_10AM_NY - 10 * 86_400_000 });
    });
    const due = await t.query(internal.review.weekly.dueForReview, { now: SUNDAY_10AM_NY });
    expect(due).not.toContain(fresh);
    expect(due).toContain(old);
    expect(MIN_DAYS_BEFORE_REVIEW).toBeGreaterThanOrEqual(5);
  });
});
