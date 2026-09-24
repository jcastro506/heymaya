/**
 * §13.5 / §13.10: a match is a judgment; its consequences are rows. Certain/likely
 * mark the idea posted and write the strongest taste event, scaled by the post's
 * multiple; no is a negative example that leaves taste alone; a post is judged once;
 * a post matches at most one idea; nothing crosses a tenant.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { postedWeight } from "../matchPost";
import { WEIGHTS } from "../../taste/affinities";
import type { Id } from "../../_generated/dataModel";

const DAY = 86_400_000;
const produced = { skillVersion: "t", model: "t", thresholdsVersion: "t" };

async function seed(t: ReturnType<typeof convexTest>, creatorId: Id<"creators">, opts: { multiple?: number; ideaAgeDays?: number; postAgeDays?: number } = {}) {
  const now = Date.now();
  const ideaAt = now - (opts.ideaAgeDays ?? 3) * DAY;
  const ideaId = await t.run((ctx) => ctx.db.insert("ideas", { creatorId, evidenceLinks: ["https://x"], fit: "yes", fitWhy: "f", version: { hook: "the mile repeat rant" }, messageText: "do the mile repeat rant", status: "sent", produced, createdAt: ideaAt, sentAt: ideaAt, features: { format: "talking-head", topics: ["running"], tone: "deadpan", lengthBucket: "15-30", sound: "none", source: "breakout" } }));
  const postAt = now - (opts.postAgeDays ?? 1) * DAY;
  const postId = await t.run((ctx) => ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `p${postAt}`, url: "https://www.tiktok.com/@a/video/1", createTime: postAt, caption: "mile repeats are a scam", contentType: "video", hashtags: [], metrics: { views: 1000, likes: 10, comments: 1, shares: 1, saves: 0 }, metricsAsOf: now, multiple: opts.multiple, source: "scrape", durationSec: 20 }));
  return { ideaId, postId };
}

describe("postedWeight", () => {
  it("scales the strongest event by how the post did", () => {
    expect(postedWeight(null)).toBe(WEIGHTS.posted);
    expect(postedWeight(2)).toBe(WEIGHTS.posted * 1.5);
    expect(postedWeight(0.5)).toBe(WEIGHTS.posted * 0.5);
    expect(postedWeight(1)).toBe(WEIGHTS.posted);
  });
});

describe("candidates", () => {
  it("offers unmatched, unjudged posts in the window beside ideas sent in the window", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const { ideaId, postId } = await seed(t, creatorId);
    await seed(t, creatorId, { ideaAgeDays: 20, postAgeDays: 20 }); // outside the 14-day window
    const c = await t.query(internal.scout.matchPost.candidates, { creatorId, now: Date.now() });
    expect(c.posts.map((p) => p.id)).toEqual([postId]);
    expect(c.ideas.map((i) => i.id)).toEqual([ideaId]);
  });
});

describe("apply", () => {
  it("certain marks the idea posted with the post; the post is never offered again", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const { ideaId, postId } = await seed(t, creatorId, { multiple: 2 });
    expect(await t.mutation(internal.scout.matchPost.apply, { creatorId, ideaId, ownPostId: postId, confidence: "certain", why: "same hook" })).toEqual({ ok: true });
    const idea = await t.run((ctx) => ctx.db.get(ideaId));
    expect(idea?.status).toBe("posted");
    expect(idea?.matchedPostId).toBe(postId);
    expect(idea?.matchConfidence).toBe("certain");
    const c = await t.query(internal.scout.matchPost.candidates, { creatorId, now: Date.now() });
    expect(c.posts).toEqual([]);
  });

  it("no is a negative example and leaves taste alone; unsure only marks the post judged", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const { ideaId, postId } = await seed(t, creatorId);
    await t.mutation(internal.scout.matchPost.apply, { creatorId, ideaId, ownPostId: postId, confidence: "no", why: "different premise" });
    const idea = await t.run((ctx) => ctx.db.get(ideaId));
    expect(idea?.matchConfidence).toBe("no");
    expect(idea?.status).toBe("sent");
    expect(await t.run((ctx) => ctx.db.query("tasteEvents").collect())).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(postId)))?.matchCheckedAt).toBeTypeOf("number");
  });

  it("a post matches at most one idea, and never another creator's", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" } }));
    const { ideaId, postId } = await seed(t, a);
    const other = await seed(t, b);
    expect((await t.mutation(internal.scout.matchPost.apply, { creatorId: a, ideaId: other.ideaId, ownPostId: postId, confidence: "certain", why: "" })).ok).toBe(false);
    expect((await t.mutation(internal.scout.matchPost.apply, { creatorId: a, ideaId, ownPostId: other.postId, confidence: "certain", why: "" })).ok).toBe(false);
    expect((await t.mutation(internal.scout.matchPost.apply, { creatorId: a, ideaId, ownPostId: postId, confidence: "likely", why: "" })).ok).toBe(true);
    const second = await seed(t, a, { postAgeDays: 0.5 });
    expect((await t.mutation(internal.scout.matchPost.apply, { creatorId: a, ideaId, ownPostId: second.postId, confidence: "certain", why: "" })).ok).toBe(false);
  });

  it("the taste event for a match is scaled by the post's multiple", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const { ideaId, postId } = await seed(t, creatorId, { multiple: 2 });
    await t.mutation(internal.scout.matchPost.apply, { creatorId, ideaId, ownPostId: postId, confidence: "likely", why: "" });
    await t.mutation(internal.taste.events.record, { creatorId, kind: "posted", ideaId, weight: postedWeight(2) });
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.affinities.find((x) => x.key === "format:talking-head")?.score).toBe(4.5);
  });
});
