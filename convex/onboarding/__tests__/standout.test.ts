/**
 * The post her opening is built on: code picks it and its numbers (grounded or silent), she says why it
 * worked. Live on dev 2026-11-03: a viral post read as "610× your usual" and she drifted to "852.42×".
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { citesStandout, compact, standout, STANDOUT_MIN_POSTS } from "../standout";

const p = (caption: string, views: number, comments = 3, multiple: number | null = null) => ({ caption, views, comments, multiple });

describe("which post, and how it's said", () => {
  it("a post well above their usual: the multiple, with both view counts", () => {
    const s = standout([p("costume build #diy", 12_400, 40, 3.1), p("bagel run", 4_000, 3, 1), p("outfit", 3_900, 2, 0.9)])!;
    expect(s.kind).toBe("multiple");
    expect(s.line).toBe(`"costume build" did about 3.1× their usual views (12.4K, against a usual 4K)`);
    expect(s.cite).toBe("12.4K");
  });
  it("a viral outlier: plain view counts, never a silly multiple", () => {
    const s = standout([p("i run so i can rot", 837_000, 900, 610), p("a", 1_400, 3, 1), p("b", 1_300, 3, 1)])!;
    expect(s.line).toBe(`"i run so i can rot" got 837K views, against a usual 1.4K`);
    expect(s.line).not.toMatch(/×/);
  });
  it("nothing above their usual: the one people talked about, then simply the most watched", () => {
    expect(standout([p("hot take", 900, 30, 1.1), p("a", 1_000, 4, 1), p("b", 1_100, 5, 1)])).toMatchObject({ kind: "comments", cite: "30" });
    const flat = standout([p("a", 900, 3), p("b", 1_000, 3), p("most watched one", 1_200, 3)])!;
    expect(flat).toMatchObject({ kind: "views", cite: "1.2K" });
    expect(flat.line).toMatch(/nothing stands far above/);
  });
  it("too few posts: nothing (she asks for the one they're proudest of instead)", () => {
    expect(standout([p("a", 100), p("b", 200)].slice(0, STANDOUT_MIN_POSTS - 1))).toBeNull();
  });
  it("numbers read the way TikTok shows them, and the check is case-blind", () => {
    expect([compact(980), compact(1_400), compact(12_400), compact(837_000), compact(5_400_000), compact(12_000_000)]).toEqual(["980", "1.4K", "12.4K", "837K", "5.4M", "12M"]);
    expect(citesStandout("it got 837k views", { cite: "837K" })).toBe(true);
    expect(citesStandout("it went viral", { cite: "837K" })).toBe(false);
  });
});

describe("on the rows", () => {
  it("their own TikTok videos only; another creator's posts never count (cross-tenant)", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "so1"));
    const b = await t.run((ctx) => seedCreator(ctx, "so2"));
    const now = Date.now();
    const post = (creatorId: typeof a, i: number, views: number, multiple: number, contentType: "video" | "photo" = "video") =>
      t.run((ctx) => ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `p${creatorId}${i}`, url: `https://www.tiktok.com/@x/video/${i}`, createTime: now - i * 86_400_000, contentType, caption: `post ${i}`, hashtags: [], metrics: { views, likes: 0, comments: 0, shares: 0 }, metricsAsOf: now, source: "scrape", multiple } as never));
    for (const i of [1, 2, 3]) await post(a, i, 1_000, 1);
    await post(a, 4, 50_000, 50, "photo");
    await post(b, 5, 9_000_000, 900);
    const s = (await t.query(internal.onboarding.standout.forCreator, { creatorId: a }))!;
    expect(s.line).not.toMatch(/post 4|post 5|9M|50K/);
  });
});
