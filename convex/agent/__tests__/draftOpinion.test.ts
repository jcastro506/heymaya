/**
 * An opinion on a DRAFT gets her lookups and their own craft to compare against (2026-09-30).
 * Before this only links and their own posts ran the lookup step, so "will this do well?" on a
 * draft could not check their history with the structure, the lane, or what they'd told her.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { LOOKUPS } from "../playbooks";

describe("the draft opinion", () => {
  it("runs the lookup step for a draft, with a smaller budget, and hands her their craft", () => {
    const src = readFileSync(new URL("../opinion.ts", import.meta.url), "utf8");
    expect(src).toMatch(/a\.mode === "link" \|\| a\.mode === "own" \|\| a\.mode === "video"/);
    expect(src).toMatch(/credits: a\.mode === "video" \? 8 : 20/);
    expect(src).toMatch(/a\.mode === "video" \? \{ theirCraft: await ctx\.runQuery\(internal\.agent\.opinion\.ownCraft/);
    expect(LOOKUPS.opinion).toMatch(/For a DRAFT they filmed/);
    expect(LOOKUPS.opinion).toMatch(/never post_info/);
    expect(LOOKUPS.opinion).toMatch(/own_rhymes/);
    expect(LOOKUPS.opinion).not.toMatch(/nothing to look up except own_rhymes/);
  });

  it("is honest that nobody can predict virality: a read and fixes, never a score or a view count", async () => {
    const { OPINION_SKILL } = await import("../opinion");
    expect(OPINION_SKILL).toMatch(/nobody can predict that, you included/);
    expect(OPINION_SKILL).toMatch(/Never a score, a percentage chance, or a view count/);
    expect(OPINION_SKILL).toMatch(/never promise a number/);
  });

  it("their craft is only what she watched: best and weakest by their own multiple, nobody else's", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "dc1"));
    const b = await t.run((ctx) => seedCreator(ctx, "dc2"));
    const produced = { skillVersion: "t", model: "m", thresholdsVersion: "t" };
    await t.run(async (ctx) => {
      for (const [i, m] of [4.2, 2.1, 1.0, 0.9, 0.6, 0.4, 0.2].entries()) {
        const id = await ctx.db.insert("ownPosts", { creatorId: a, platform: "tiktok", postId: `p${i}`, url: `https://t/${i}`, createTime: Date.now() - (i + 1) * 86_400_000, contentType: "video", caption: `post ${i}\nmore`, hashtags: [], metrics: { views: 1000, likes: 1, comments: 0, shares: 0 }, metricsAsOf: Date.now(), source: "scrape", multiple: m, durationSec: 20 } as never);
        if (i !== 2) await ctx.db.insert("ownPostReads", { creatorId: a, ownPostId: id, depth: "watch", card: { firstSecond: `opens ${i}`, hook: { secondsToHook: i === 0 ? 0.8 : 4 }, pacing: { lengthSec: 12 + i }, textOverlay: { timing: "first-second" }, sound: { type: "original-voice" } }, produced, createdAt: Date.now() } as never);
      }
      const other = await ctx.db.insert("ownPosts", { creatorId: b, platform: "tiktok", postId: "x", url: "https://t/x", createTime: Date.now(), contentType: "video", caption: "theirs", hashtags: [], metrics: { views: 1, likes: 0, comments: 0, shares: 0 }, metricsAsOf: Date.now(), source: "scrape", multiple: 9 } as never);
      await ctx.db.insert("ownPostReads", { creatorId: b, ownPostId: other, depth: "watch", card: { firstSecond: "b's" }, produced, createdAt: Date.now() } as never);
    });
    const craft = await t.query(internal.agent.opinion.ownCraft, { creatorId: a });
    expect(craft.best.map((r) => r.multiple)).toEqual([4.2, 2.1, 0.9, 0.6]); // the unwatched 1.0 post isn't here
    expect(craft.best[0]).toMatchObject({ caption: "post 0", firstSecond: "opens 0", secondsToHook: 0.8, lengthSec: 12, textTiming: "first-second", sound: "original-voice" });
    expect(craft.weakest.map((r) => r.multiple)).toEqual([0.2, 0.4, 0.6]);
    expect(JSON.stringify(craft)).not.toMatch(/b's|theirs/);
  });
});
