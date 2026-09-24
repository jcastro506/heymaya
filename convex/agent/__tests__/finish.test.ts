/**
 * B7 "finish this one". Categories: grounded or silent (a named sound needs a lookup this turn),
 * adversarial (a sound named in their own words or a made-up id is not backing), sibling coherence
 * (a drafted clip routes here; the cache keeps a sound's facts), cross-tenant (lessons and reasons
 * are per creator), fail-closed (a lesson is written once).
 */
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { backedSounds, finishText, oneOwnAudio } from "../finish";
import { soundFacts } from "../../integrations/scrapeCreators/platforms/tiktok";
import { slimForCache } from "../../reads/read";

const s = (name: string, clipId = "", source = "watched-accounts") => ({ name, clipId, platform: "tiktok", source, why: "matches the pace", howToUse: "start on the first cut" });
const info = (clipId: string, result: string) => ({ tool: "sound_info", ok: true, params: { clipId }, result });

describe("a named sound needs a lookup this turn", () => {
  it("keeps looked-up sounds and their own audio; drops the rest", () => {
    const r = backedSounds([s("Espresso by Sabrina Carpenter", "111"), s("Made Up Song by Nobody", "999"), s("your own audio", "", "their-own-audio")], [info("111", `"Espresso" by Sabrina Carpenter · 2,000,000 videos use it · a released track · NOT cleared for business accounts or sponsored posts`)]);
    expect(r.kept.map((k) => k.name)).toEqual(["Espresso by Sabrina Carpenter", "your own audio"]);
    expect(r.kept[0].licensedForBusiness).toBe(false);
    expect(r.dropped).toEqual(["Made Up Song by Nobody"]);
  });
  it("a failed lookup, or an id only in their own message, backs nothing", () => {
    const r = backedSounds([s("Espresso by Sabrina Carpenter", "111")], [{ tool: "sound_info", ok: false, params: { clipId: "111" }, result: "failed" }]);
    expect(r.kept).toEqual([]);
  });
  it("at most three sounds, and the text carries the business warning", () => {
    const r = backedSounds([s("a", "1"), s("b", "2"), s("c", "3"), s("d", "4")], ["1", "2", "3", "4"].map((id) => info(id, `"x" · business-safe library`)));
    expect(r.kept).toHaveLength(3);
    const text = finishText({ reaction: "the sizzle at the start got me", captions: [{ text: "one", shape: "their-usual", why: "" }, { text: "two", shape: "question", why: "" }, { text: "three", shape: "search", why: "" }], sounds: [{ ...s("Espresso by Sabrina Carpenter"), licensedForBusiness: false }] });
    expect(text.split("\n---\n")).toHaveLength(3);
    expect(text).toContain("1. one");
    expect(text).toContain("not on a business account");
    expect(text).not.toMatch(/\bAI\b/);
    const linked = finishText({ reaction: "x", captions: [{ text: "a", shape: "", why: "" }], sounds: [{ ...s("Espresso", "7679774266925124384") }] });
    expect(linked).toContain("https://www.tiktok.com/music/sound-7679774266925124384");
  });
  it("the song already on the clip is kept without a lookup, and is never called their own audio", () => {
    const r = backedSounds([s("keep the song that's already on it", "", "already-in-the-clip")], []);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toEqual([]);
  });
});

describe("one piece of advice once", () => {
  it("two 'keep your audio' lines collapse to the first; real sounds stay", () => {
    const out = oneOwnAudio([s("Keep audio from draft", "", "already-in-the-clip"), s("your own audio", "", "their-own-audio"), s("Espresso", "1")]);
    expect(out.map((x) => x.name)).toEqual(["Keep audio from draft", "Espresso"]);
  });
});

describe("sound facts survive the read cache", () => {
  it("parses a song payload and keeps it outside raw", () => {
    const raw = { music_info: { id_str: "7679774266925124384", title: "original sound", author: "Ali Abdaal", user_count: 1234, is_original_sound: true, is_commerce_music: true, duration: 91 } };
    const f = soundFacts(raw)!;
    expect(f).toMatchObject({ clipId: "7679774266925124384", title: "original sound", videosUsingIt: 1234, licensedForBusiness: true });
    const cached = slimForCache({ query: {}, source: "tiktok_song", raw, sound: f }) as { raw?: unknown; sound: unknown };
    expect(cached.raw).toBeUndefined();
    expect(cached.sound).toEqual(f);
    expect(soundFacts({})).toBeNull();
  });
  it("a post keeps its sound's name through the cache", () => {
    const out = slimForCache([{ url: "u", raw: { music: { id_str: "1", title: "Espresso", author: "Sabrina", play_url: { huge: "x" } } } }]) as Array<{ raw: { music: Record<string, unknown> } }>;
    expect(out[0].raw.music).toMatchObject({ id_str: "1", title: "Espresso", author: "Sabrina" });
    expect(out[0].raw.music.play_url).toBeUndefined();
  });
});

describe("a drafted clip is finished, and what they post teaches her", () => {
  it("converse routes a video draft to finish", () => {
    const converse = readFileSync(new URL("../converse.ts", import.meta.url), "utf8");
    expect(converse).toMatch(/route\.media === "video"\) \{[\s\S]{0,200}internal\.agent\.finish\.run/);
  });
  it("one lesson per finish, kept as their preference, never another creator's", async () => {
    const t = convexTest(schema, modules);
    const { a, b, f, post } = await t.run(async (ctx) => {
      const a = await seedCreator(ctx, "a");
      const b = await seedCreator(ctx, "b");
      const m = await ctx.db.insert("messages", { creatorId: a, direction: "in", surface: "telegram", body: "", ts: Date.now() } as never);
      const f = await ctx.db.insert("finishes", { creatorId: a, messageId: m, card: { about: "pesto pasta" }, captions: [{ text: "pesto for the week", shape: "their-usual", why: "your usual" }], sounds: [], lookups: [], createdAt: Date.now() - 86_400_000 });
      const post = await ctx.db.insert("ownPosts", { creatorId: a, platform: "tiktok", postId: "p", url: "https://www.tiktok.com/@a/video/1", createTime: Date.now() - 3_600_000, contentType: "video", caption: "pesto for the week (again)", hashtags: [], metrics: { views: 1, likes: 1, comments: 1, shares: 1 }, metricsAsOf: Date.now(), source: "scrape" } as never);
      return { a, b, f, post };
    });
    expect((await t.query(internal.agent.finish.postedAfter, { finishId: f }))?.post.id).toBe(post);
    await t.mutation(internal.agent.finish.saveOutcome, { finishId: f, ownPostId: post, closestCaption: 1, soundUsed: null, lesson: "adds a wry aside in brackets at the end" });
    await t.mutation(internal.agent.finish.saveOutcome, { finishId: f, ownPostId: post, closestCaption: 2, soundUsed: null, lesson: "a second lesson" });
    const records = await t.run((ctx) => ctx.db.query("personalRecords").collect());
    expect(records.filter((r) => r.creatorId === a).map((r) => r.text)).toEqual(["how they write captions: adds a wry aside in brackets at the end"]);
    expect(records.filter((r) => r.creatorId === b)).toHaveLength(0);
    expect((await t.query(internal.agent.finish.recent, { creatorId: b })).length).toBe(0);
    expect((await t.query(internal.agent.finish.recent, { creatorId: a }))[0].outcome?.closestCaption).toBe(1);
  });
});

describe("an Instagram post read finds its video", () => {
  it("reads the single-post envelope (the shape that hid every reel's video)", async () => {
    const { igShortcodeToItem } = await import("../../integrations/scrapeCreators/platforms/instagram");
    const item = igShortcodeToItem({ id: "1", shortcode: "DdDQgnBt3g1", is_video: true, video_url: "https://cdn.example/v.mp4", video_duration: 36.7, video_play_count: 540859, taken_at_timestamp: 1790000000, edge_media_to_caption: { edges: [{ node: { text: "Meal Prep French Toasts‼️" } }] }, edge_media_preview_like: { count: 9541 }, edge_media_to_parent_comment: { count: 29 }, owner: { username: "noahperlofit" } });
    expect(item).toMatchObject({ code: "DdDQgnBt3g1", media_type: 2, video_versions: [{ url: "https://cdn.example/v.mp4" }], play_count: 540859, caption: { text: "Meal Prep French Toasts‼️" } });
    expect(igShortcodeToItem({ shortcode: "x", is_video: false }).video_versions).toEqual([]);
  });
});

describe("sibling coherence: a tool trace fits where it's stored (living sim, day 13)", () => {
  it("the scout's investigation accepts a trace entry carrying its result", async () => {
    const t = convexTest(schema, modules);
    const sid = await t.run(async (ctx) => {
      const c = await seedCreator(ctx, "a");
      return await ctx.db.insert("signals", { creatorId: c, kind: "breakout", sourcePostIds: ["p"], score: 2, corroboration: { accounts: 0, soundRising: false }, verdict: "pending", why: "x", thresholdsVersion: "t", createdAt: Date.now() } as never);
    });
    await expect(t.mutation(internal.scout.gate.setInvestigation, { signalIds: [sid], trace: [{ tool: "sound_info", params: {}, why: "w", ms: 3, ok: true, result: "\"Espresso\" · 2M videos" }] })).resolves.toBeNull();
  });
});

describe("an overloaded watcher falls back (living sim)", () => {
  it("capacity errors fall back; file errors don't", async () => {
    const { isOverloaded } = await import("../opinion");
    expect(isOverloaded("This model is currently experiencing high demand. Spikes in demand are usually temporary.")).toBe(true);
    expect(isOverloaded("gemini returned 503")).toBe(true);
    expect(isOverloaded("media is 250MB, over the 200MB cap")).toBe(false);
    expect(isOverloaded(undefined)).toBe(false);
  });
});

describe("caption habits stay few and fresh (living sim)", () => {
  it("only the newest five stay active", async () => {
    const { CAPTION_HABITS_KEPT } = await import("../finish");
    const t = convexTest(schema, modules);
    const { a, finishes, post } = await t.run(async (ctx) => {
      const a = await seedCreator(ctx, "a");
      const m = await ctx.db.insert("messages", { creatorId: a, direction: "in", surface: "telegram", body: "", ts: Date.now() } as never);
      const post = await ctx.db.insert("ownPosts", { creatorId: a, platform: "tiktok", postId: "p", url: "https://www.tiktok.com/@a/video/1", createTime: Date.now(), contentType: "video", caption: "x", hashtags: [], metrics: { views: 1, likes: 1, comments: 1, shares: 1 }, metricsAsOf: Date.now(), source: "scrape" } as never);
      const finishes = [];
      for (let i = 0; i < 8; i++) finishes.push(await ctx.db.insert("finishes", { creatorId: a, messageId: m, card: {}, captions: [], sounds: [], lookups: [], createdAt: Date.now() - (10 - i) * 86_400_000 }));
      return { a, finishes, post };
    });
    for (const [i, f] of finishes.entries()) await t.mutation(internal.agent.finish.saveOutcome, { finishId: f, ownPostId: post, closestCaption: 0, soundUsed: null, lesson: `habit ${i}` });
    const active = await t.run((ctx) => ctx.db.query("personalRecords").collect()).then((rs) => rs.filter((r) => r.creatorId === a && r.active).map((r) => r.text));
    expect(active).toHaveLength(CAPTION_HABITS_KEPT);
    expect(active.join(" ")).toContain("habit 7");
    expect(active.join(" ")).not.toContain("habit 0");
  });
});
