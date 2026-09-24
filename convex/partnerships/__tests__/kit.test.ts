/**
 * B6: the media kit and the weekly opportunities offer. Categories: fail-closed (non-partner
 * tiers get nothing; the offer is once a week and inside the rails), coherence (known and
 * excluded brands are never offered; the kit's numbers are the rows' numbers), cross-tenant.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { offerable, offerText, weekKey } from "../kit";

const brand = (handle: string, creators = 1) => ({ handle, platform: "tiktok", posts: creators, creators: Array.from({ length: creators }, (_, i) => `c${i}`), lastSeen: 1 });

describe("what gets offered (pure)", () => {
  it("never a brand already in the record or excluded", () => {
    const out = offerable([brand("hoka", 2), brand("gymshark"), brand("gu")], [{ brandDomain: "gymshark.co.uk", brand: "Gymshark" }], ["@GU"]);
    expect(out.map((b) => b.handle)).toEqual(["hoka"]);
  });
  it("the text names only what was seen", () => {
    expect(offerText([brand("hoka", 2)])).toBe("brands that paid creators in your lane this month: @hoka (paid 2 creators you'd know). want me to look into them? i'll check what they actually pay for and how to get in.");
  });
  it("a week is Monday to Sunday on their clock", () => {
    expect(weekKey(Date.UTC(2026, 8, 24, 12), "UTC")).toBe("2026-09-21"); // Thursday → Monday 21st
    expect(weekKey(Date.UTC(2026, 8, 21, 2), "America/Los_Angeles")).toBe("2026-09-14"); // still Sunday the 20th in LA
  });
});

async function setup(tier: "solo" | "partner") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await seedCreator(ctx, "a", { clerkUserId: "user_a", timezone: "UTC", quietHours: { start: "23:59", end: "00:00" }, channel: { paired: true }, plan: { status: "active", founding: false, tier } });
    const b = await seedCreator(ctx, "b", { clerkUserId: "user_b", channel: { paired: true }, plan: { status: "active", founding: false, tier: "partner" } });
    await ctx.db.insert("trackedAccounts", { creatorId: a, platform: "tiktok", handle: "runnerjane", status: "active", addedBy: "creator", baselineN: 12, createdAt: Date.now() } as never);
    await ctx.db.insert("observations", { platform: "tiktok", postId: "p1", authorHandle: "runnerjane", url: "https://www.tiktok.com/x", createTime: Date.now(), sampledAt: Date.now(), ageHours: 5, views: 1000, likes: 1, comments: 1, shares: 1, keywords: [], source: "account.posts", paidPromotion: true, mentions: ["hoka"] });
    for (let i = 0; i < 6; i++) await ctx.db.insert("ownPosts", { creatorId: a, platform: "tiktok", postId: `o${i}`, url: `https://www.tiktok.com/@a/video/${i}`, createTime: Date.now() - (3 + i) * 86_400_000, contentType: "video", caption: i < 2 ? `run ${i} in my @Hoka clifton @TT_a` : `run ${i}`, hashtags: [], metrics: { views: 1000 * (i + 1), likes: 1, comments: 1, shares: 1 }, metricsAsOf: Date.now(), source: "scrape" });
    await ctx.db.insert("followerSnapshots", { creatorId: a, platform: "tiktok", accountId: "x", day: "2026-09-24", followers: 12345, at: Date.now() });
    return { a, b };
  });
  return { t, ...ids };
}

describe("the weekly offer", () => {
  it("partner tier: one text naming the lane's brand, then nothing more that week", async () => {
    const s = await setup("partner");
    expect(await s.t.action(internal.partnerships.kit.offerOne, { creatorId: s.a })).toMatchObject({ sent: true });
    expect(await s.t.action(internal.partnerships.kit.offerOne, { creatorId: s.a })).toMatchObject({ sent: false });
    const texts = await s.t.run((ctx) => ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", s.a)).collect());
    expect(texts.filter((m) => m.kind === "partnership")).toHaveLength(1);
    expect(texts[0].body).toContain("@hoka");
    // B watches nobody: nothing to offer B, and nothing of A's lane leaks
    expect(await s.t.action(internal.partnerships.kit.offerOne, { creatorId: s.b })).toMatchObject({ sent: false, reason: "nothing new paying their lane" });
  });
  it("fails closed below the partner tier", async () => {
    const s = await setup("solo");
    expect(await s.t.action(internal.partnerships.kit.offerOne, { creatorId: s.a })).toMatchObject({ sent: false, reason: "partnerships not on their plan" });
  });
});

describe("the media kit", () => {
  it("is their rows: followers, normal, best posts; unknowns are null, never zero", async () => {
    const s = await setup("partner");
    const k = (await s.t.query(internal.partnerships.kit.mediaKit, { creatorId: s.a }))!;
    const tt = k.platforms.find((p) => p.platform === "tiktok")!;
    expect(tt.followers).toBe(12345);
    expect(tt.normalViews).toBeGreaterThan(0);
    expect(tt.best[0].views).toBe(6000);
    const kb = (await s.t.query(internal.partnerships.kit.mediaKit, { creatorId: s.b }))!;
    expect(kb.platforms.every((p) => p.followers === null && p.normalViews === null)).toBe(true);
  });
});

describe("signal 2 and one nudge a day", () => {
  it("the kit lists accounts they tagged themselves, never their own handle", async () => {
    const s = await setup("partner");
    const k = (await s.t.query(internal.partnerships.kit.mediaKit, { creatorId: s.a }))!;
    expect(k.taggedByThem).toEqual([{ handle: "hoka", posts: 2, example: expect.stringContaining("tiktok.com") }]);
  });
  it("after a partnerships text today, the follow-up pass waits for tomorrow", async () => {
    const s = await setup("partner");
    expect(await s.t.query(internal.partnerships.delivery.nudgedToday, { creatorId: s.a })).toBe(false);
    await s.t.action(internal.partnerships.kit.offerOne, { creatorId: s.a });
    expect(await s.t.query(internal.partnerships.delivery.nudgedToday, { creatorId: s.a })).toBe(true);
    expect(await s.t.query(internal.partnerships.delivery.nudgedToday, { creatorId: s.b })).toBe(false);
  });
});
