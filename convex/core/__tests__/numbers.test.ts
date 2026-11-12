/**
 * Numbers are checked by code (2026-11-12): the season sim's wrong figures, each caught; real ones pass.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { claimsIn, numbersIn, toNumber, unbacked } from "../numbers";

describe("reading the claims", () => {
  it("finds counts and multiples, written the ways she writes them", () => {
    expect(toNumber("31.2", "K")).toBe(31200);
    const c = claimsIn("the hill one is at 31K views, 3.1× your normal. it just crossed a million, and well over double your usual. 100k followers!");
    expect(c.map((x) => [x.unit, x.value])).toEqual(expect.arrayContaining([["count", 31000], ["multiple", 3.1], ["count", 1e6], ["multiple", 2], ["count", 100000]]));
  });
  it("leaves prices, times and counts of things alone", () => {
    expect(claimsIn("the $4 jacket won. film at 5 pm, 3 posts this week, 20 countries")).toEqual([]);
  });
});

describe("what passes", () => {
  const facts = { counts: [57_298, 166_027, 508_000, 31_200, 1_150_000], multiples: [6.1, 3.1, 1.4], free: [] as number[] };
  it("catches the season's wrong figures", () => {
    expect(unbacked(claimsIn("your normal is around 400k views"), facts)).toHaveLength(1);
    expect(unbacked(claimsIn("it's at half a million, well over double your usual"), { ...facts, multiples: [6.1] }).map((c) => c.unit)).toEqual(["multiple"]);
    expect(unbacked(claimsIn("200k followers"), facts)).toHaveLength(1);
  });
  it("lets real ones through: near a figure, a milestone below one, or in the evidence", () => {
    expect(unbacked(claimsIn("31K views, 3.1× your normal"), facts)).toEqual([]);
    expect(unbacked(claimsIn("that one crossed a million"), facts)).toEqual([]);
    expect(unbacked(claimsIn("the lane's median was 37k views"), { ...facts, free: numbersIn({ lane: { median: "37,400" } }) })).toEqual([]);
  });
});

describe("their figures, from rows", () => {
  it("are theirs only: another creator's posts don't back a claim", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" } }));
    await t.run(async (ctx) => {
      await ctx.db.insert("ownPosts", { creatorId: b, platform: "tiktok", postId: "b1", url: "https://tiktok.com/@b/video/1", createTime: now - 86_400_000, contentType: "video", caption: "c", hashtags: [], metrics: { views: 400_000, likes: 1, comments: 1, shares: 1 }, metricsAsOf: now, source: "scrape" } as never);
      await ctx.db.insert("ownPosts", { creatorId: a, platform: "tiktok", postId: "a1", url: "https://tiktok.com/@a/video/1", createTime: now - 86_400_000, contentType: "video", caption: "c", hashtags: [], metrics: { views: 57_000, likes: 1, comments: 1, shares: 1 }, metricsAsOf: now, source: "scrape" } as never);
    });
    const f = await t.query(internal.core.numbers.factsFor, { creatorId: a });
    expect(unbacked(claimsIn("your normal is around 400k views"), { counts: f.counts, multiples: f.multiples, free: f.theirs })).toHaveLength(1);
    expect(unbacked(claimsIn("57k views"), { counts: f.counts, multiples: f.multiples, free: f.theirs })).toEqual([]);
  });
});
