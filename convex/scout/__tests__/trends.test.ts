/**
 * Trends (scout/trends, 2026-10-13): sounds many accounts are posting to right now, checked for new vs an
 * old song, counted day over day, watched, then judged per person for the Trending tab and the editor.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import type { Doc, Id } from "../../_generated/dataModel";
import { candidates, liveOrNot, momentum, momentumWords, parsePicks, parseRecipe, topAgeDays, toMs, TREND, type SeenPost } from "../trends";
import { postSound } from "../../integrations/scrapeCreators/platforms/tiktok";

const H = 3_600_000, D = 24 * H;
const T0 = Date.UTC(2026, 9, 13, 13, 0);

beforeEach(() => { vi.stubEnv("MODEL_FAKE", "1"); vi.stubEnv("OPENROUTER_API_KEY", "fake"); });
afterEach(() => { vi.unstubAllEnvs(); });

const post = (over: Partial<SeenPost> & { clip?: string | null; handle?: string }): SeenPost => ({
  sound: over.clip === undefined ? { clipId: "s1", title: "Zany Emote", author: "CsCrafty", uses: 600_000, original: true } : over.clip ? { clipId: over.clip, title: null, author: null, uses: null, original: null } : null,
  authorHandle: over.handle ?? "a", url: `https://www.tiktok.com/@${over.handle ?? "a"}/video/${Math.round(Math.random() * 1e9)}`, views: 1000, postedAt: Math.floor((T0 - D) / 1000), videoUrl: null, thumbnailUrl: null, source: "search", keywords: [], ...over,
});

describe("trends (pure)", () => {
  it("the sound comes off an untrimmed post, as a string id; a trimmed post has none", () => {
    expect(postSound({ music: { id: 7002429550756220000, id_str: "7002429550756219654", title: "Zany Emote Fortnite", user_count: 613582, is_original_sound: true } })).toEqual({ clipId: "7002429550756219654", title: "Zany Emote Fortnite", author: null, uses: 613582, original: true });
    expect(postSound({ desc: "trimmed", video: {} })).toBeNull();
    // A feed post's title sometimes comes back as an object: never shown as text.
    expect(postSound({ music: { id_str: "1", title: { 9: 1 } } })?.title).toBeNull();
  });

  it("candidates: two different accounts on a sound is a pattern; one account twice is not", () => {
    const got = candidates([post({ handle: "a" }), post({ handle: "b", source: "hashtag" }), post({ clip: "s2", handle: "c" }), post({ clip: "s2", handle: "c" }), post({ clip: null, handle: "d" })]);
    expect(got.map((c) => c.clipId)).toEqual(["s1"]);
    expect(got[0]).toMatchObject({ accounts: ["a", "b"], sources: ["search", "hashtag"], uses: 600_000 });
    // A share link's tracking is dropped, so the same video shared twice is one example.
    const shared = candidates([post({ handle: "a", url: "https://www.tiktok.com/@a/video/1?_r=1&u_code=x" }), post({ handle: "a", url: "https://www.tiktok.com/@a/video/1?_r=1&u_code=y" }), post({ handle: "b" })]);
    expect(shared[0].examples.filter((e) => e.url === "https://www.tiktok.com/@a/video/1")).toHaveLength(1);
  });

  it("new or old song: a new sound's top videos are days old; a lane on an old song is still a trend", () => {
    expect(topAgeDays([T0 - 5 * D, T0 - 12 * D, T0 - 2 * D].map((t) => t / 1000), T0)).toBe(5);
    expect(liveOrNot({ topAgeDays: 9, niche: false })).toBe("live");
    expect(liveOrNot({ topAgeDays: 600, niche: false })).toBe("evergreen");
    expect(liveOrNot({ topAgeDays: 600, niche: true })).toBe("live");
    expect(liveOrNot({ topAgeDays: null, niche: false })).toBe("evergreen");
    expect(toMs(1_700_000_000)).toBe(1_700_000_000_000);
  });

  it("momentum: climbing, steady, and stopped (the last count decides fading); words never carry a number", () => {
    expect(momentum([{ at: T0, n: 100 }])).toBe("new");
    expect(momentum([{ at: T0 - 2 * D, n: 100_000 }, { at: T0 - D, n: 130_000 }, { at: T0, n: 160_000 }])).toBe("rising");
    expect(momentum([{ at: T0 - 2 * D, n: 100_000 }, { at: T0 - D, n: 102_000 }, { at: T0, n: 104_000 }])).toBe("steady");
    expect(momentum([{ at: T0 - 2 * D, n: 100_000 }, { at: T0 - D, n: 150_000 }, { at: T0, n: 150_100 }])).toBe("fading");
    for (const m of ["new", "rising", "steady", "fading"] as const) expect(momentumWords(m, T0 - D, T0)).not.toMatch(/\d/);
  });

  it("the watcher's answer: held to a shape, and 'not a trend' is null", () => {
    const r = parseRecipe(`sure: {"isTrend": true, "kind": "dance", "what": "a two-step that cuts on the drop", "beats": ["sway 0-5s", "drop at 0:19: hip roll"], "onScreenText": "", "difficulty": "needs practice", "solo": true}`);
    expect(r).toMatchObject({ kind: "dance", difficulty: "needs practice", solo: true, beats: ["sway 0-5s", "drop at 0:19: hip roll"] });
    expect(parseRecipe(`{"isTrend": false, "what": "a song under a vlog"}`)).toBeNull();
    expect(parseRecipe("not json")).toBeNull();
    expect(parseRecipe(`{"kind": "rocket", "what": "something people do", "difficulty": "impossible"}`)).toMatchObject({ kind: "other", difficulty: "easy" });
  });

  it("her picks: only ids she was given, once each, and a hop-on needs a version", () => {
    const got = parsePicks(JSON.stringify({ picks: [{ id: "t1", verdict: "hop_on", why: "you", hook: "the switchback, on the drop" }, { id: "t1", verdict: "skip" }, { id: "nope", verdict: "hop_on", hook: "made up trend" }, { id: "t2", verdict: "borrow", hook: "" }, { id: "t3", verdict: "weird" }] }), ["t1", "t2", "t3"]);
    expect(got.map((p) => [p.id, p.verdict])).toEqual([["t1", "hop_on"], ["t3", "skip"]]);
  });
});

async function seedTrend(t: ReturnType<typeof convexTest>, over: Partial<Doc<"trends">> = {}): Promise<Id<"trends">> {
  return await t.run(async (ctx) => ctx.db.insert("trends", {
    clipId: "s1", title: "Zany Emote", status: "live", niche: [], sources: ["search"], accounts: ["a", "b"], uses: [{ at: T0 - D, n: 100_000 }, { at: T0, n: 140_000 }], topAgeDays: 6,
    examples: [{ url: "https://www.tiktok.com/@a/video/1", handle: "a", views: 50_000, postedAt: T0 - D }],
    recipe: { kind: "dance", what: "a two-step that cuts on the drop", beats: ["sway", "drop: hip roll"], onScreenText: "", difficulty: "easy", solo: true },
    firstSeenAt: T0 - D, lastSeenAt: T0, checkedAt: T0, ...over,
  }));
}

describe("trends (rows)", () => {
  it("upsert: one row per sound; a second sighting adds a count and keeps the best examples", async () => {
    const t = convexTest(schema, modules);
    const c = { clipId: "s9", title: "original sound", author: null, accounts: ["a", "b"], sources: ["search"], niche: [] };
    const ex = (n: number) => ({ url: `https://www.tiktok.com/@x/video/${n}`, handle: "x", views: n, postedAt: Math.floor(T0 / 1000), thumb: null });
    const first = await t.mutation(internal.scout.trends.upsert, { c, uses: 1000, topAgeDays: 4, status: "live", examples: [ex(5)], now: T0 });
    const again = await t.mutation(internal.scout.trends.upsert, { c: { ...c, title: "Zany Emote", accounts: ["c"] }, uses: 1500, topAgeDays: 5, status: "live", examples: [ex(9)], now: T0 + D });
    expect(first.isNew).toBe(true);
    expect(again).toEqual({ id: first.id, isNew: false });
    const row = await t.run(async (ctx) => ctx.db.get(first.id));
    expect(row).toMatchObject({ title: "Zany Emote", accounts: ["a", "b", "c"], uses: [{ at: T0, n: 1000 }, { at: T0 + D, n: 1500 }] });
    expect(row!.examples.map((e) => e.views)).toEqual([9, 5]);
    expect(row!.examples[0].postedAt).toBe(Math.floor(T0 / 1000) * 1000);
    expect(await t.run(async (ctx) => (await ctx.db.query("trends").collect()).length)).toBe(1);
  });

  it("recount: two slow counts running and it's over; past its life and not climbing, over too", async () => {
    const t = convexTest(schema, modules);
    const slowing = await seedTrend(t, { uses: [{ at: T0 - 2 * D, n: 100_000 }, { at: T0 - D, n: 100_200 }] });
    expect((await t.mutation(internal.scout.trends.recount, { id: slowing, n: 100_300, now: T0 })).status).toBe("faded");
    const old = await seedTrend(t, { clipId: "s2", firstSeenAt: T0 - TREND.lifeMs - D, uses: [{ at: T0 - D, n: 100_000 }] });
    expect((await t.mutation(internal.scout.trends.recount, { id: old, n: 103_000, now: T0 })).status).toBe("faded");
    const climbing = await seedTrend(t, { clipId: "s3" });
    expect((await t.mutation(internal.scout.trends.recount, { id: climbing, n: 200_000, now: T0 + D })).status).toBe("live");
  });

  it("watching: a trend that isn't one leaves the live list; one we couldn't fetch is tried again tomorrow", async () => {
    const t = convexTest(schema, modules);
    const notOne = await seedTrend(t, { recipe: undefined });
    const unfetched = await seedTrend(t, { clipId: "s2", recipe: undefined });
    await t.mutation(internal.scout.trends.setRecipe, { id: notOne, recipe: null, now: T0 });
    await t.mutation(internal.scout.trends.setRecipe, { id: unfetched, recipe: null, failed: "media fetch 403", now: T0 });
    expect((await t.run(async (ctx) => ctx.db.get(notOne)))!.status).toBe("evergreen");
    expect(await t.query(internal.scout.trends.toWatch, { now: T0 + H })).toEqual([]);
    expect((await t.query(internal.scout.trends.toWatch, { now: T0 + D })).map((x) => x.id)).toEqual([unfetched]);
  });

  it("judge: her read is saved per person, the best fresh one becomes the editor's candidate, nothing is judged twice", async () => {
    const t = convexTest(schema, modules);
    const lane = await seedTrend(t, { clipId: "lane", niche: ["running"] });
    const other = await seedTrend(t, { clipId: "other" });
    const a = await t.run(async (ctx) => seedCreator(ctx, "a", { channel: { paired: true, pairedAt: T0 - 10 * D }, plan: { status: "active", founding: true }, dossier: { keywords: ["running"] } }));
    const r = await t.action(internal.scout.trends.judge, { creatorId: a, now: T0 });
    expect(r).toMatchObject({ judged: 2, picked: 1, noticed: true });
    const c = await t.run(async (ctx) => ctx.db.get(a));
    // Their lane goes to her first, so the fake's first pick (a hop-on) is the lane trend.
    expect(c!.trendPicks!.find((p) => p.trendId === lane)!.verdict).toBe("hop_on");
    expect(c!.trendPicks!.find((p) => p.trendId === other)!.verdict).toBe("skip");
    expect(c!.noticed!.find((n) => n.kind === "trend")).toMatchObject({ id: `trend:${lane}`, sourceKey: "trend:lane", link: "https://www.tiktok.com/@a/video/1" });
    expect(await t.action(internal.scout.trends.judge, { creatorId: a, now: T0 + H })).toMatchObject({ judged: 0 });
  });

  it("a stale trend is not texted: older than four days stays in the app only", async () => {
    const t = convexTest(schema, modules);
    await seedTrend(t, { firstSeenAt: T0 - 5 * D });
    const a = await t.run(async (ctx) => seedCreator(ctx, "a", { channel: { paired: true, pairedAt: T0 - 10 * D }, plan: { status: "active", founding: true } }));
    expect(await t.action(internal.scout.trends.judge, { creatorId: a, now: T0 })).toMatchObject({ picked: 1, noticed: false });
  });

  it("the app: only their own picks, never skips or faded ones; saving makes one idea, once (cross-tenant)", async () => {
    const t = convexTest(schema, modules);
    const live = await seedTrend(t);
    const faded = await seedTrend(t, { clipId: "s2", status: "faded" });
    const skip = await seedTrend(t, { clipId: "s3" });
    const pick = (trendId: Id<"trends">, verdict: "hop_on" | "skip") => ({ trendId, verdict, why: "it's you", hook: "the switchback on the drop", at: T0 });
    const a = await t.run(async (ctx) => seedCreator(ctx, "a", { trendPicks: [pick(live, "hop_on"), pick(faded, "hop_on"), pick(skip, "skip")] }));
    await t.run(async (ctx) => seedCreator(ctx, "b"));
    const asA = t.withIdentity({ subject: "u_a" });
    const asB = t.withIdentity({ subject: "u_b" });
    const mine = await asA.query(api.ui.trends, {});
    expect(mine!.map((x) => x.id)).toEqual([live]);
    expect(mine![0]).toMatchObject({ verdict: "hop_on", kind: "dance", what: "a two-step that cuts on the drop", examples: [{ handle: "a" }] });
    expect(await asB.query(api.ui.trends, {})).toEqual([]);
    expect(await asB.mutation(api.ui.saveTrend, { id: live })).toEqual({ ok: false });
    const saved = await asA.mutation(api.ui.saveTrend, { id: live });
    const twice = await asA.mutation(api.ui.saveTrend, { id: live });
    expect(saved.ok).toBe(true);
    expect(twice.ideaId).toBe(saved.ideaId);
    const ideas = await t.run(async (ctx) => ctx.db.query("ideas").collect());
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({ creatorId: a, evidenceLinks: ["https://www.tiktok.com/@a/video/1"], features: { source: "trend" } });
    expect(await asA.mutation(api.ui.saveTrend, { id: skip })).toEqual({ ok: false });
  });

  it("her tool reads the same list: nothing live is an honest empty", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run(async (ctx) => seedCreator(ctx, "a"));
    expect(await t.query(internal.scout.trends.forChat, { creatorId: a, now: T0 })).toEqual([]);
  });
});
