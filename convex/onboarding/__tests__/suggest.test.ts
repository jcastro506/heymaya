/**
 * §27: who to watch. The pure parts decide what may reach a card; the row test proves an
 * Instagram-only creator never gets TikTok and nobody sees another creator's list.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { SUGGEST, balance, bandFor, clip, fallbackWhy, keywordsFrom, numbersGrounded, parsePicks, shortlist, statsFor } from "../suggest";
import type { DiscoveredProfile } from "../../reads/profiles";

const prof = (platform: "tiktok" | "instagram", handle: string, followerCount: number | null, extra: Partial<DiscoveredProfile> = {}): DiscoveredProfile => ({ platform, handle, displayName: null, followerCount, avatarUrl: null, bio: null, isPrivate: false, ...extra });

describe("keywords", () => {
  it("prefer the dossier, then hashtags weighted by how the post did, never the generic tags", () => {
    const own = [
      { platform: "tiktok" as const, caption: "", hashtags: ["fyp", "marathontraining", "running"], multiple: 6, views: 60000 },
      { platform: "tiktok" as const, caption: "", hashtags: ["running", "viral"], multiple: 1, views: 1000 },
      { platform: "tiktok" as const, caption: "", hashtags: ["hostel"], multiple: 0.5, views: 500 },
    ];
    expect(keywordsFrom(own, undefined, [])).toEqual(["running", "marathontraining"]);
    expect(keywordsFrom(own, undefined, ["solo travel"])[0]).toBe("solo travel");
    expect(keywordsFrom([], "I make practical style videos", [])).toEqual(["make", "practical"]);
    expect(keywordsFrom([], undefined, [])).toEqual([]);
    expect(bandFor(0)).toBe("10K-100K");
    expect(bandFor(2_500_000)).toBe("1M-10M");
  });
});

describe("the shortlist", () => {
  const exclude = new Set(["tiktok:mine", "instagram:mine", "tiktok:watched"]);
  it("fail-closed: only connected platforms; no private, own, watched or duplicate accounts", () => {
    const s = shortlist({ platforms: ["instagram"], exclude, ownFollowers: { instagram: 10_000 }, candidates: [prof("tiktok", "tt", 30_000), prof("instagram", "mine", 30_000), prof("instagram", "priv", 30_000, { isPrivate: true }), prof("instagram", "ok", 30_000), prof("instagram", "OK", 30_000), prof("tiktok", "watched", 30_000)] });
    expect(s.map((x) => `${x.platform}:${x.handle}`)).toEqual(["instagram:ok"]);
  });

  it("both platforms: split four and four, nearest a size a little above theirs, accounts they follow first", () => {
    const tt = Array.from({ length: 6 }, (_, i) => prof("tiktok", `t${i}`, 10 ** (3 + i)));
    const ig = Array.from({ length: 6 }, (_, i) => prof("instagram", `i${i}`, 10 ** (3 + i)));
    const s = shortlist({ platforms: ["tiktok", "instagram"], exclude: new Set(), ownFollowers: { tiktok: 10_000, instagram: 10_000 }, candidates: [...tt, { ...prof("tiktok", "friend", 50), following: true }, ...ig] });
    expect(s).toHaveLength(SUGGEST.single);
    expect(s.filter((x) => x.platform === "tiktok")).toHaveLength(SUGGEST.perPlatformBoth);
    expect(s[0].handle).toBe("t1"); // 10K, nearest 30K beats the followed tiny account
    const onlyIg = shortlist({ platforms: ["tiktok", "instagram"], exclude: new Set(), ownFollowers: {}, candidates: ig });
    expect(onlyIg).toHaveLength(6); // one platform short: the other tops up
  });
});

describe("what reaches a card", () => {
  it("stats read only what the posts say; TikTok seconds become milliseconds", () => {
    const now = Date.UTC(2026, 8, 14);
    const posts = [1000, 2000, 3000, 20000].map((views, i) => ({ caption: ` post ${i} `, views, postedAt: Math.floor((now - i * 86_400_000) / 1000) }));
    const s = statsFor([...posts, { caption: "old", views: null, postedAt: now - 60 * 86_400_000 }], now);
    expect(s).toMatchObject({ medianViews: 3000, bestMultiple: 6.7, postsLast30: 4 });
    expect(s.topCaptions[0]).toBe("post 3");
    expect(fallbackWhy(s)).toBe("Posts steadily, 4 times in the last month, and their best recent post did 6.7× their usual views.");
    expect(fallbackWhy({ medianViews: null, bestMultiple: null, postsLast30: 0, topCaptions: [] })).not.toMatch(/\d/);
  });

  it("adversarial model output: ids off the shortlist, duplicates, empty and giant reasons, and ungrounded numbers are dropped", () => {
    const ids = new Set(["c0", "c1"]);
    const picks = parsePicks('sure! {"picks":[{"id":"c0","why":"She opens on the finish time, like your 6x marathon post."},{"id":"c9","why":"not on the list at all"},{"id":"c0","why":"duplicate of the first pick"},{"id":"c1","why":"x"},{"id":"c1","why":"' + "y".repeat(300) + '"}]}', ids);
    expect(picks.map((p) => p.id)).toEqual(["c0"]);
    expect(parsePicks("no json here", ids)).toEqual([]);
    expect(parsePicks("{not json}", ids)).toEqual([]);
    const evidence = JSON.stringify({ bestRecentTimesTheirNormal: 6.7, postsLast30Days: 9, medianViews: 12000 });
    expect(numbersGrounded("Nine posts, one at 6.7× her normal, median 12,000 views.", evidence)).toBe(true);
    expect(numbersGrounded("Her last post did 2 million views.", evidence)).toBe(false);
  });

  it("both platforms connected and every pick on one: the other platform takes the last seat", () => {
    const pick = (platform: "tiktok" | "instagram", n: number) => Array.from({ length: n }, (_, i) => ({ platform, n: i }));
    const out = balance(pick("tiktok", 6), pick("instagram", 2), ["tiktok", "instagram"]);
    expect(out).toHaveLength(6);
    expect(out.filter((x) => x.platform === "instagram")).toHaveLength(1);
    expect(balance(pick("tiktok", 3), [], ["tiktok", "instagram"])).toHaveLength(3);
    expect(balance(pick("tiktok", 3), pick("instagram", 1), ["tiktok"])).toHaveLength(3);
  });
});

describe("text that survives the trip", () => {
  it("adversarial: an emoji at the cut point stays whole (live 2026-09-14: a split pair broke the return value)", () => {
    const caption = "a".repeat(199) + "🏃‍♀️ race day";
    const cut = clip(caption, 200);
    expect(() => JSON.parse(JSON.stringify(cut))).not.toThrow();
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut), "no lone high surrogate").toBe(false);
    expect(Array.from(cut)).toHaveLength(200);
    expect(clip("short", 200)).toBe("short");
    const own = [{ platform: "tiktok" as const, caption: "x".repeat(118) + "🔥🔥🔥", views: 10, postedAt: null }];
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(statsFor(own, 0).topCaptions[0])).toBe(false);
  });
});

describe("on rows", () => {
  it("cross-tenant: gather reads only this creator; own handles and watched accounts are excluded on both platforms", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { handles: { instagram: "ana.makes" } }));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { handles: { tiktok: "bee" } }));
    await t.run(async (ctx) => {
      await ctx.db.insert("trackedAccounts", { creatorId: a, platform: "instagram", handle: "watched.one", status: "active", addedBy: "creator", baselineN: 0, createdAt: 1 });
      await ctx.db.insert("trackedAccounts", { creatorId: b, platform: "tiktok", handle: "bees.watch", status: "active", addedBy: "creator", baselineN: 0, createdAt: 1 });
    });
    const g = await t.query(internal.onboarding.suggest.gather, { creatorId: a });
    expect(g!.exclude).toEqual(expect.arrayContaining(["instagram:watched.one", "instagram:ana.makes", "tiktok:ana.makes"]));
    expect(g!.exclude.join()).not.toContain("bee");
  });

  it("fail-closed: a creator with no connected account gets no reads and no cards", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "none", { handles: {} }));
    const r = await t.action(internal.onboarding.suggest.suggestFor, { creatorId: c, waitMs: 0 });
    expect(r.suggestions).toEqual([]);
    expect(r.trace.reason).toBe("no connected account");
  });
});
