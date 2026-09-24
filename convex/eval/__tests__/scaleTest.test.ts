/** The 1,000-creator test's pure parts and its safety: skewed picks, how people ask, never delivered, clean clear. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { askText, skewedPick } from "../scaleTest";

describe("the scale test", () => {
  it("picks are skewed toward the top of the pool and deterministic", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i);
    const picks = Array.from({ length: 1000 }, (_, i) => skewedPick(xs, i, 0));
    expect(picks.filter((p) => p < 25).length).toBeGreaterThan(400);
    expect(skewedPick(xs, 7, 1)).toBe(skewedPick(xs, 7, 1));
  });
  it("Instagram asks say so; TikTok asks don't need to", () => {
    expect(askText({ platform: "instagram", handle: "x", lane: "l" }, 0)).toMatch(/insta/);
    expect(askText({ platform: "tiktok", handle: "x", lane: "l" }, 0)).toBe("watch @x");
  });
  it("a load creator's texts are never delivered, and clear removes everything it owns", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.eval.scaleTest.seed, { from: 0, count: 2 });
    const [c] = await t.query(internal.eval.scaleTest.loadCreators, { from: 0, count: 1 });
    expect(c.platforms.length).toBeGreaterThan(0);
    await t.mutation(internal.core.messages.send, { creatorId: c.id, surface: "telegram", body: "hi", dedupeKey: "k1", proactive: false, kind: "reply" });
    await t.run(async (ctx) => { await ctx.db.insert("trackedAccounts", { creatorId: c.id, platform: "instagram", handle: "someone", status: "active", addedBy: "creator", baselineN: 0, createdAt: Date.now() } as never); });
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs.filter((j) => j.kind === "deliver_message")).toHaveLength(0);
    while ((await t.mutation(internal.eval.loadTest.clear, { limit: 10 })) > 0) { /* until none */ }
    expect(await t.run((ctx) => ctx.db.query("trackedAccounts").collect())).toHaveLength(0);
    expect(await t.query(internal.eval.loadTest.count, {})).toBe(0);
  });
});
