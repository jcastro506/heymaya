/**
 * Sprint 4c: she learns from what happened, not only from what was tapped.
 *
 * The live pilot is the argument: nine ideas sent, ONE taste event, notes empty after three
 * days of real conversation. A creator who asks questions and rarely taps teaches a
 * tap-driven system nothing. A post's multiple needs no tap.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { judgeOutcomes, OUTCOME } from "../outcomes";
import type { Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 8, 10, 12, 0);
const id = (s: string) => s as Id<"ideas">;
const pid = (s: string) => s as Id<"ownPosts">;
const row = (over: Partial<{ multiple: number | null; postedAt: number; learnedAt: number | null }> = {}) =>
  ({ ideaId: id("i1"), ownPostId: pid("p1"), multiple: 2, postedAt: NOW - 72 * 3_600_000, learnedAt: null, ...over });

describe("judging an outcome", () => {
  it("a clear win and a clear flop are learnable; normal is not", () => {
    expect(judgeOutcomes([row({ multiple: 2.4 })], NOW)[0].verdict).toBe("win");
    expect(judgeOutcomes([row({ multiple: 0.4 })], NOW)[0].verdict).toBe("flop");
    expect(judgeOutcomes([row({ multiple: 1.0 })], NOW), "a normal post teaches nothing").toHaveLength(0);
  });

  it("waits two days for the numbers, and never learns twice", () => {
    expect(judgeOutcomes([row({ postedAt: NOW - 3 * 3_600_000 })], NOW)).toHaveLength(0);
    expect(judgeOutcomes([row({ learnedAt: NOW - 1000 })], NOW)).toHaveLength(0);
    expect(judgeOutcomes([row({ multiple: null })], NOW)).toHaveLength(0);
    expect(OUTCOME.minAgeHours).toBe(48);
  });
});

describe("folding the result back", () => {
  async function posted(t: ReturnType<typeof convexTest>, features: Record<string, unknown>, over: Record<string, unknown> = {}) {
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const ideaId = await t.run((ctx) => ctx.db.insert("ideas", {
      creatorId, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: "h" }, messageText: "m",
      produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" }, features, status: "posted",
      postedAt: NOW - 72 * 3_600_000, sentAt: NOW - 96 * 3_600_000, createdAt: NOW - 96 * 3_600_000, ...over,
    } as never));
    return { creatorId, ideaId };
  }
  const FEATURES = { format: "talking-head", topics: ["running"], tone: "deadpan", lengthBucket: "15-30", sound: "none", source: "breakout" };

  it("a win raises the features of the idea they posted", async () => {
    const t = convexTest(schema, modules);
    const { creatorId, ideaId } = await posted(t, FEATURES);
    const r = await t.mutation(internal.taste.outcomes.learn, { creatorId, ideaId, verdict: "win", multiple: 3, now: NOW });
    expect(r.learned).toBe(true);
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    const fmt = c!.affinities.find((a) => a.key === "format:talking-head")!;
    expect(fmt.score).toBeGreaterThan(0);
    const ev = await t.run((ctx) => ctx.db.query("tasteEvents").collect());
    expect(ev[0].kind).toBe("outcome_win");
    expect(ev[0].weight).toBeGreaterThan(0);
  });

  it("a flop lowers them, with no tap from the creator at all", async () => {
    const t = convexTest(schema, modules);
    const { creatorId, ideaId } = await posted(t, FEATURES);
    await t.mutation(internal.taste.outcomes.learn, { creatorId, ideaId, verdict: "flop", multiple: 0.3, now: NOW });
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c!.affinities.find((a) => a.key === "format:talking-head")!.score).toBeLessThan(0);
  });

  it("a result outranks the tap before it: hearted then flopped ends up negative", async () => {
    const t = convexTest(schema, modules);
    const { creatorId, ideaId } = await posted(t, FEATURES);
    await t.mutation(internal.taste.events.record, { creatorId, ideaId, kind: "heart", reaction: "🔥" });
    const afterTap = (await t.run((ctx) => ctx.db.get(creatorId)))!.affinities.find((a) => a.key === "format:talking-head")!.score;
    expect(afterTap).toBeGreaterThan(0);
    await t.mutation(internal.taste.outcomes.learn, { creatorId, ideaId, verdict: "flop", multiple: 0.2, now: NOW });
    const after = (await t.run((ctx) => ctx.db.get(creatorId)))!.affinities.find((a) => a.key === "format:talking-head")!.score;
    expect(after, "what happened beats what they tapped").toBeLessThan(afterTap);
    expect(after).toBeLessThan(0);
  });

  it("a bigger win teaches more, but one freak post cannot rewrite their taste", async () => {
    const t = convexTest(schema, modules);
    const a = await posted(t, FEATURES);
    await t.mutation(internal.taste.outcomes.learn, { creatorId: a.creatorId, ideaId: a.ideaId, verdict: "win", multiple: 2, now: NOW });
    const small = (await t.run((ctx) => ctx.db.get(a.creatorId)))!.affinities.find((x) => x.key === "format:talking-head")!.score;
    const b = await posted(t, FEATURES);
    await t.mutation(internal.taste.outcomes.learn, { creatorId: b.creatorId, ideaId: b.ideaId, verdict: "win", multiple: 40, now: NOW });
    const huge = (await t.run((ctx) => ctx.db.get(b.creatorId)))!.affinities.find((x) => x.key === "format:talking-head")!.score;
    expect(huge).toBeGreaterThan(small);
    expect(huge, "capped").toBeLessThanOrEqual(small * 2 + 0.01);
  });

  it("learns once per idea, ever", async () => {
    const t = convexTest(schema, modules);
    const { creatorId, ideaId } = await posted(t, FEATURES);
    expect((await t.mutation(internal.taste.outcomes.learn, { creatorId, ideaId, verdict: "win", multiple: 3, now: NOW })).learned).toBe(true);
    expect((await t.mutation(internal.taste.outcomes.learn, { creatorId, ideaId, verdict: "win", multiple: 3, now: NOW })).learned).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("tasteEvents").collect())).toHaveLength(1);
  });

  it("cross-tenant: another creator's idea is not theirs to learn from", async () => {
    const t = convexTest(schema, modules);
    const { ideaId } = await posted(t, FEATURES);
    const other = await t.run((ctx) => seedCreator(ctx, "b", {}));
    expect((await t.mutation(internal.taste.outcomes.learn, { creatorId: other, ideaId, verdict: "win", multiple: 3, now: NOW })).learned).toBe(false);
  });
});

describe("the nightly sweep", () => {
  it("learns every landed outcome once, across creators, and is safe to re-run", async () => {
    const t = convexTest(schema, modules);
    const mk = async (suffix: string, multiple: number) => {
      const creatorId = await t.run((ctx) => seedCreator(ctx, suffix, { channel: { paired: true }, dossier: { persona: { summary: "x" }, keywords: ["running"] } }));
      const postId = await t.run((ctx) => ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `p_${suffix}`, url: `https://tiktok.com/@a/video/${suffix}`, createTime: NOW - 96 * 3_600_000, contentType: "video", caption: "c", hashtags: [], metrics: { views: 1000, likes: 1, comments: 1, shares: 1 }, metricsAsOf: NOW, source: "scrape", multiple } as never));
      await t.run((ctx) => ctx.db.insert("ideas", {
        creatorId, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: "h" }, messageText: "m",
        produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" },
        features: { format: "talking-head", topics: ["running"], tone: "deadpan", lengthBucket: "15-30", sound: "none", source: "breakout" },
        status: "posted", postedAt: NOW - 72 * 3_600_000, matchedPostId: postId, sentAt: NOW - 96 * 3_600_000, createdAt: NOW - 96 * 3_600_000,
      } as never));
      return creatorId;
    };
    const winner = await mk("a", 3);
    const flopper = await mk("b", 0.2);

    const first = await t.action(internal.taste.outcomes.runAll, { now: NOW });
    expect(first.learned).toBe(2);
    expect((await t.run((ctx) => ctx.db.get(winner)))!.affinities.find((x) => x.key === "format:talking-head")!.score).toBeGreaterThan(0);
    expect((await t.run((ctx) => ctx.db.get(flopper)))!.affinities.find((x) => x.key === "format:talking-head")!.score).toBeLessThan(0);

    // Idempotent: a second night learns nothing new and writes no second event.
    expect((await t.action(internal.taste.outcomes.runAll, { now: NOW + 86_400_000 })).learned).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("tasteEvents").collect())).toHaveLength(2);
  });

  it("the sweep is actually scheduled — the fourth zero-caller in this project would be careless", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(new URL("../../crons.ts", import.meta.url), "utf8")).toMatch(/taste\.outcomes\.runAll/);
  });
});
