/** §6 Sprint 4 named test: the Results tab's rung equals the Sunday review's rung for the same week, because both are the same computed fact over the same rows. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

describe("results vs review", () => {
  it("agree on the rung and its reason for the same week", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a", dossier: { cadence: { postsPerWeek: 3 } } }));
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 4; i++) await ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `p${i}`, url: `https://t/${i}`, createTime: now - (i + 3) * 86_400_000, contentType: "video", hashtags: [], caption: "c", metrics: { views: 300, likes: 3, comments: 1, shares: 1, saves: 1 }, metricsAsOf: now, source: "scrape", multiple: 0.4 });
      for (let i = 0; i < 10; i++) await ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `h${i}`, url: `https://t/h${i}`, createTime: now - (20 + i) * 86_400_000, contentType: "video", hashtags: [], caption: "c", metrics: { views: 1000, likes: 10, comments: 5, shares: 5, saves: 10 }, metricsAsOf: now, source: "scrape", multiple: 1 });
    });
    const review = await t.query(internal.review.weekly.inputs, { creatorId, now });
    const results = await t.withIdentity({ subject: "user_a" }).query(api.ui.results, {});
    expect(results?.rung.rung).toBe(review!.rung.rung);
    expect(results?.rung.rung).toBe("L1");
    expect(results?.rung.why).toBe(review!.rung.why);
  });
});
