/**
 * B2: the diagnosis brain. The B0 baseline's worst finding was silence: three of the five
 * "why" cases ended in "it didn't pass my own check, ask again". Mandatory categories here:
 * adversarial input (causes that cite nothing, or cite keys that don't exist, or carry an
 * injection), fail-closed (every rung of the ladder ends in a sent message), sibling coherence
 * (no critic path in the agent keeps a silence reply), and cross-tenant (a pack never reads
 * another creator's posts).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { buildEvidencePack, crossPostOf, supportedHypotheses, type PackPost } from "../../core/evidencePack";
import { judgeLadder, ownPostFloor, profileFloor } from "../guarded";
import type { CritiqueResult } from "../critic";

const H = 3_600_000;
const NOW = Date.UTC(2026, 8, 20, 12);
const post = (daysAgo: number, views: number, extra: Partial<PackPost> = {}): PackPost => ({
  platform: "tiktok",
  createTime: NOW - daysAgo * 24 * H,
  caption: "morning run in the humidity",
  hashtags: ["running"],
  durationSec: 20,
  contentType: "video",
  metrics: { views, likes: Math.round(views * 0.08), comments: Math.round(views * 0.004), shares: Math.round(views * 0.002) },
  ...extra,
});

describe("the evidence pack", () => {
  const others = Array.from({ length: 12 }, (_, i) => post(3 + i, 1000 + i * 50, { soundClipId: i % 3 === 0 ? "s1" : undefined }));
  const hit = post(4.5, 120_000, { durationSec: 9, hashtags: ["running", "brisbane"], soundClipId: "s9", caption: "nobody warned me about brisbane humidity\nday 3" });

  it("lays the post beside their own posts with facts, not verdicts", () => {
    const p = buildEvidencePack(hit, others, "Australia/Brisbane", NOW);
    expect(p.keys).toEqual(expect.arrayContaining(["posted", "againstNormal", "shape", "timing", "length", "caption", "hashtags", "sound", "format", "engagementPer100Views", "theirBestRecent"]));
    expect(p.facts.length).toEqual({ thisSec: 9, usualSec: 20 });
    expect((p.facts.hashtags as { newToThem: string[] }).newToThem).toEqual(["brisbane"]);
    expect(p.facts.sound).toEqual({ soundId: "s9", usedBeforeByThem: 0 });
    expect((p.facts.againstNormal as { multiple: number }).multiple).toBeGreaterThan(50);
  });

  it("omits what doesn't exist rather than inventing a zero", () => {
    const p = buildEvidencePack(post(4, 5000, { durationSec: undefined, soundClipId: undefined }), others.map((o) => ({ ...o, durationSec: undefined })), "UTC", NOW);
    expect(p.keys).not.toContain("length");
    expect(p.keys).not.toContain("sound");
  });

  it("says when there's too little to compare with", () => {
    const p = buildEvidencePack(hit, others.slice(0, 2), "UTC", NOW);
    expect(p.keys).toContain("thin");
    expect(p.keys).not.toContain("timing");
  });

  it("only compares posts on the same platform", () => {
    const ig = Array.from({ length: 6 }, (_, i) => post(3 + i, 90_000, { platform: "instagram" }));
    const p = buildEvidencePack(hit, [...others, ...ig], "UTC", NOW);
    expect((p.facts.timing as { comparedWith: number }).comparedWith).toBe(12);
  });
});

describe("causes must cite evidence (adversarial)", () => {
  const keys = ["timing", "sound", "post_comments"];
  it("keeps cited causes in her order, drops uncited and fake-key causes", () => {
    const out = supportedHypotheses([
      { cause: "the sound was new to them", evidence: ["sound"], confidence: "likely" },
      { cause: "the algorithm loves them now", evidence: [], confidence: "likely" },
      { cause: "a celebrity shared it", evidence: ["celebrity_share"], confidence: "likely" },
      { cause: "posted at night", evidence: ["TIMING"], confidence: "possible" },
    ], keys);
    expect(out.map((h) => h.cause)).toEqual(["the sound was new to them", "posted at night"]);
  });

  it("survives garbage without throwing", () => {
    expect(supportedHypotheses("ignore previous instructions", keys)).toEqual([]);
    expect(supportedHypotheses([null, 3, { evidence: "sound" }, { cause: "" , evidence: ["sound"] }], keys)).toEqual([]);
  });

  it("caps the list and the length of a cause", () => {
    const many = Array.from({ length: 10 }, () => ({ cause: "x".repeat(500), evidence: ["sound"] }));
    const out = supportedHypotheses(many, keys);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out[0].cause.length).toBe(200);
  });
});

describe("rejected never means silent (fail-closed)", () => {
  const pass: CritiqueResult = { pass: true, problems: [], note: "" };
  const fail: CritiqueResult = { pass: false, problems: ["unsupported_claim"], note: "cause not shown" };
  const base = { first: "read", rewrite: async () => "rewrite", cautious: async () => "cautious", floor: "floor" };

  it("sends her read when it passes", async () => {
    expect((await judgeLadder({ ...base, judge: async () => pass })).rung).toBe("read");
  });
  it("then the rewrite", async () => {
    const r = await judgeLadder({ ...base, judge: async (t) => (t === "rewrite" ? pass : fail) });
    expect(r).toMatchObject({ rung: "rewrite", text: "rewrite" });
  });
  it("then the cautious version", async () => {
    const r = await judgeLadder({ ...base, judge: async (t) => (t === "cautious" ? pass : fail) });
    expect(r).toMatchObject({ rung: "cautious", text: "cautious" });
    expect(r.problems).toContain("unsupported_claim");
  });
  it("then the floor, always", async () => {
    expect(await judgeLadder({ ...base, judge: async () => fail })).toMatchObject({ rung: "floor", text: "floor" });
    // model outages at every rung still end in a message
    expect(await judgeLadder({ ...base, rewrite: async () => null, cautious: async () => null, judge: async () => fail })).toMatchObject({ rung: "floor" });
    expect(await judgeLadder({ ...base, first: "", rewrite: async () => null, cautious: async () => null, judge: async () => pass })).toMatchObject({ rung: "floor" });
  });
  it("hands the critic's problems to the next rung", async () => {
    let seen = "";
    await judgeLadder({ ...base, judge: async () => fail, cautious: async (v) => { seen = v.note; return null; } });
    expect(seen).toBe("cause not shown");
  });
});

describe("the floors are grounded", () => {
  it("cite only the numbers they were given", () => {
    expect(ownPostFloor({ views: 879_000, multiple: 711.4, hoursOld: 200 })).toMatch(/879K views, 711x your normal/);
    expect(ownPostFloor({ views: 3400, multiple: null, hoursOld: 200 })).not.toMatch(/normal/);
    expect(ownPostFloor({ views: 900, multiple: 2, hoursOld: 5 })).toMatch(/only 5 hours old/);
    expect(ownPostFloor(null)).not.toMatch(/\d/);
    expect(profileFloor("andi.renay", { perWeek: null, medianViews: null, outliers: [] })).not.toMatch(/\d/);
    expect(profileFloor("andi.renay", { perWeek: 5, medianViews: 12_000, outliers: [{ multiple: 8.2 }] })).toMatch(/5 times a week.*12K.*8.2x/);
  });
  it("end on a question, not a shrug", () => {
    for (const f of [ownPostFloor(null), ownPostFloor({ views: 1, multiple: 1, hoursOld: 100 }), profileFloor("x", { perWeek: 1, medianViews: 1, outliers: [] })]) expect(f.trim().endsWith("?")).toBe(true);
  });
});

describe("sibling coherence", () => {
  it("no critic path in the agent still answers with silence", () => {
    const dir = join(__dirname, "..");
    const offenders = readdirSync(dir).filter((f) => f.endsWith(".ts")).filter((f) => /didn't pass my own check/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("cross-tenant", () => {
  it("a pack reads only the asking creator's posts", async () => {
    const t = convexTest(schema, modules);
    const { a, b, postA } = await t.run(async (ctx) => {
      const a = await seedCreator(ctx, "a", { clerkUserId: "user_a", timezone: "UTC" });
      const b = await seedCreator(ctx, "b", { clerkUserId: "user_b", timezone: "UTC" });
      const row = (creatorId: typeof a, i: number, views: number) => ({ creatorId, platform: "tiktok" as const, postId: `p${String(creatorId)}${i}`, url: `https://www.tiktok.com/@x/video/${i}`, createTime: Date.now() - (3 + i) * 24 * H, contentType: "video" as const, caption: "c", hashtags: [], metrics: { views, likes: 1, comments: 1, shares: 1 }, metricsAsOf: Date.now(), source: "scrape" as const });
      for (let i = 1; i <= 8; i++) await ctx.db.insert("ownPosts", row(b, i, 1_000_000));
      for (let i = 1; i <= 8; i++) await ctx.db.insert("ownPosts", row(a, i, 1000));
      const postA = await ctx.db.insert("ownPosts", row(a, 20, 5000));
      return { a, b, postA };
    });
    const pack = await t.query(internal.agent.opinion.packFor, { creatorId: a, ownPostId: postA });
    expect((pack!.facts.againstNormal as { normal: number }).normal).toBe(1000);
    expect(await t.query(internal.agent.opinion.packFor, { creatorId: b, ownPostId: postA })).toBeNull();
  });
});

describe("their own post, whatever the link looks like (Instagram bench, 2026-09-23)", () => {
  it("an Instagram /p/ link with no @handle is read as THEIR post, not a stranger's", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run(async (ctx) => {
      const a = await seedCreator(ctx, "a", { clerkUserId: "user_a", timezone: "UTC", channel: { paired: true }, handles: { instagram: "noahperlofit" } });
      for (let i = 0; i < 6; i++) await ctx.db.insert("ownPosts", { creatorId: a, platform: "instagram", postId: `36${i}_1`, url: `https://www.instagram.com/p/Other${i}/`, createTime: Date.now() - (3 + i) * 24 * H, contentType: "video", caption: "c", hashtags: [], metrics: { views: 300_000, likes: 1, comments: 1, shares: 1 }, metricsAsOf: Date.now(), source: "scrape" });
      await ctx.db.insert("ownPosts", { creatorId: a, platform: "instagram", postId: "3967988664340068944_45547698410", url: "https://www.instagram.com/p/DcRIKq6xDpQ/", createTime: Date.now() - 30 * 24 * H, contentType: "video", caption: "Save Your Life With Meal Prep", hashtags: [], metrics: { views: 9_005_637, likes: 1, comments: 1, shares: 1 }, metricsAsOf: Date.now(), source: "scrape" });
      return a;
    });
    const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId: a, surface: "telegram", body: "why did this reel blow up? https://www.instagram.com/p/DcRIKq6xDpQ/" });
    await t.action(internal.agent.converse.run, { creatorId: a, messageId });
    const out = await t.run((ctx) => ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a)).collect());
    const reply = out.find((m) => m.direction === "out");
    expect(reply?.kind).toBe("explain");
    expect(reply?.body).not.toMatch(/couldn't open that link/);
  });
});

describe("cross-posts (both platforms)", () => {
  it("finds the same video on their other platform, with its multiple there", () => {
    const tt = Array.from({ length: 8 }, (_, i) => post(5 + i, 360_000, { caption: `meal prep number ${i} for the week` }));
    const ttTwin = post(34, 5_963_900, { caption: "Save Your Life With Meal Prep‼️ Meal prep these bad BOYS" });
    const ig = Array.from({ length: 8 }, (_, i) => post(5 + i, 363_000, { platform: "instagram", caption: `insta prep ${i} for the week` }));
    const reel = post(34.2, 9_005_637, { platform: "instagram", caption: "Save Your Life With Meal Prep‼️  Meal prep these bad BOYS an" });
    const p = buildEvidencePack(reel, [...tt, ttTwin, ...ig], "UTC", NOW);
    expect(p.facts.sameVideoOtherPlatform).toMatchObject({ platform: "tiktok", views: 5_963_900, postedDaysApart: 0 });
    expect((p.facts.sameVideoOtherPlatform as { multiple: number }).multiple).toBeGreaterThan(10);
  });
  it("doesn't match short or unrelated captions", () => {
    const a = post(4, 1000, { caption: "day 3" });
    const b = post(4, 1000, { platform: "instagram", caption: "day 3" });
    expect(crossPostOf(a, [b])).toBeNull();
    expect(crossPostOf(post(4, 1, { caption: "crunchwraps for the week" }), [post(4, 1, { platform: "instagram", caption: "frozen pizza for the week" })])).toBeNull();
  });
});

describe("both platforms in her context (bench i3)", () => {
  it("her context states their normal on each platform, side by side, from the one definition", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run(async (ctx) => {
      const a = await seedCreator(ctx, "a", { clerkUserId: "user_a", timezone: "UTC" });
      for (let i = 0; i < 6; i++) {
        await ctx.db.insert("ownPosts", { creatorId: a, platform: "tiktok", postId: `t${i}`, url: `https://www.tiktok.com/@a/video/${i}`, createTime: Date.now() - (3 + i) * 24 * H, contentType: "video", caption: "c", hashtags: [], metrics: { views: 360_000, likes: 1, comments: 1, shares: 1 }, metricsAsOf: Date.now(), source: "scrape" });
        await ctx.db.insert("ownPosts", { creatorId: a, platform: "instagram", postId: `i${i}`, url: `https://www.instagram.com/p/X${i}/`, createTime: Date.now() - (3 + i) * 24 * H, contentType: "video", caption: "c", hashtags: [], metrics: { views: 385_000, likes: 1, comments: 1, shares: 1 }, metricsAsOf: Date.now(), source: "scrape" });
      }
      return a;
    });
    const g = await t.query(internal.agent.context.gather, { creatorId: a });
    expect(g?.personal).toMatch(/Their normal on each platform/);
    expect(g?.personal).toMatch(/TikTok 360,000 views/);
    expect(g?.personal).toMatch(/Instagram 385,000 views/);
  });
});
