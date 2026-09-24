/**
 * B6 signal 1: brands paying your lane. Categories: adversarial (captions that merely mention a
 * brand aren't paid; the author is never their own brand), cross-tenant (a creator only sees
 * brands from the accounts SHE watches for them), coherence (the app's Deals list and her tool
 * read the same aggregation).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { isAdCaption, mentionsIn } from "../../scout/sampler";
import { brandsPaying } from "../signals";

describe("reading a paid post (pure)", () => {
  it("detects disclosure, not mere mentions", () => {
    expect(isAdCaption("new shoes from @hoka #ad")).toBe(true);
    expect(isAdCaption("Paid partnership with @nike")).toBe(true);
    expect(isAdCaption("love my @hoka shoes")).toBe(false);
    expect(isAdCaption("#adventure time")).toBe(false);
  });
  it("tags are brands; the author isn't", () => {
    expect(mentionsIn("run with @HOKA and @me.runner #ad", "me.runner")).toEqual(["hoka"]);
  });
  it("ranks brands by how many creators they paid", () => {
    const b = brandsPaying([
      { platform: "tiktok", postId: "1", authorHandle: "a", mentions: ["hoka"], sampledAt: 1 },
      { platform: "tiktok", postId: "2", authorHandle: "b", mentions: ["hoka", "gu"], sampledAt: 2 },
      { platform: "tiktok", postId: "3", authorHandle: "a", mentions: ["gu"], sampledAt: 3 },
      { platform: "tiktok", postId: "4", authorHandle: "a", mentions: ["maurten"], sampledAt: 4 },
    ]);
    expect(b.map((x) => [x.handle, x.creators.length])).toEqual([["gu", 2], ["hoka", 2], ["maurten", 1]]);
  });
});

describe("the lane's brands, per creator", () => {
  it("A sees brands from A's watched accounts only, in the app and in her tool alike", async () => {
    const t = convexTest(schema, modules);
    const { a } = await t.run(async (ctx) => {
      const a = await seedCreator(ctx, "a", { clerkUserId: "user_a" });
      const b = await seedCreator(ctx, "b", { clerkUserId: "user_b" });
      for (const [creatorId, handle] of [[a, "runnerjane"], [b, "chefbob"]] as const) await ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle, status: "active", addedBy: "creator", baselineN: 12, createdAt: Date.now() } as never);
      const obs = (handle: string, postId: string, mentions: string[]) => ctx.db.insert("observations", { platform: "tiktok", postId, authorHandle: handle, url: "https://www.tiktok.com/x", createTime: Date.now(), sampledAt: Date.now(), ageHours: 5, views: 1000, likes: 1, comments: 1, shares: 1, keywords: [], source: "account.posts", paidPromotion: true, mentions });
      await obs("runnerjane", "p1", ["hoka"]);
      await obs("chefbob", "p2", ["hellofresh"]);
      return { a };
    });
    const tool = await t.query(internal.partnerships.signals.laneBrands, { creatorId: a });
    expect(tool.map((x) => x.handle)).toEqual(["hoka"]);
    const app = (await t.withIdentity({ subject: "user_a" }).query(api.ui.opportunities, {}))!;
    expect(app.brandsInLane.map((x) => x.handle)).toEqual(["hoka"]);
  });
});
