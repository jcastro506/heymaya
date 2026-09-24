/**
 * §13.7 the rung is a computed fact · §13.6 predictions score against the 48 h sample
 * and other people's links never score · the review is due on Sunday on their clock,
 * once · the experiment ledger closes the old one and opens the new one.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { computeRung } from "../rung";
import type { Id } from "../../_generated/dataModel";

const H = 3_600_000;
const DAY = 24 * H;
const produced = { skillVersion: "t", model: "t", thresholdsVersion: "t" };
const post = (multiple: number, over: Partial<{ views: number; saves: number; shares: number; comments: number; ageHours: number }> = {}) => ({ views: 1000, multiple, likes: 10, comments: 5, shares: 5, saves: 10, ageHours: 72, ...over });
const hist = Array.from({ length: 10 }, () => ({ views: 1000, comments: 5, shares: 5, saves: 10 })); // engagement 0.02

describe("computeRung", () => {
  it("unknown below three sampled posts, and says how many", () => {
    const r = computeRung({ week: [post(1), post(1, { ageHours: 10 })], planned: null, history: hist });
    expect(r.rung).toBe("unknown");
    expect(r.why).toMatch(/only 1 post /);
  });
  it("L0 when they posted fewer than planned, before any diagnosis", () => {
    expect(computeRung({ week: [post(0.2), post(0.2), post(0.2)], planned: 5, history: hist }).rung).toBe("L0");
  });
  it("L1 when the median multiple is under 0.7: nobody saw it", () => {
    expect(computeRung({ week: [post(0.5), post(0.6), post(0.4)], planned: 3, history: hist }).rung).toBe("L1");
  });
  it("L2 when reach held but engagement per view fell under 0.7× their median", () => {
    const r = computeRung({ week: [post(1.1, { saves: 1, shares: 1, comments: 1 }), post(1.0, { saves: 1, shares: 1, comments: 1 }), post(1.2, { saves: 1, shares: 1, comments: 1 })], planned: null, history: hist });
    expect(r.rung).toBe("L2");
    expect(r.why).toMatch(/scrolled/);
  });
  it("healthy otherwise", () => {
    expect(computeRung({ week: [post(1.1), post(0.9), post(1.3)], planned: 3, history: hist }).rung).toBe("healthy");
  });
});

async function seedPost(t: ReturnType<typeof convexTest>, creatorId: Id<"creators">, createTime: number, multiple: number | undefined) {
  return await t.run((ctx) => ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `p${createTime}`, url: `https://www.tiktok.com/@a/video/${createTime}`, createTime, caption: "c", contentType: "video", hashtags: [], metrics: { views: 1000, likes: 1, comments: 1, shares: 1, saves: 1 }, metricsAsOf: Date.now(), source: "scrape", multiple }));
}

describe("prediction scoring", () => {
  it("scores an own-post prediction once the post has its 48 h sample; a link to someone else never scores", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const now = Date.now();
    const fresh = await seedPost(t, creatorId, now - 10 * H, 1.5);
    const ripe = await seedPost(t, creatorId, now - 60 * H, 2.1);
    await t.run(async (ctx) => {
      await ctx.db.insert("predictions", { creatorId, subject: { ownPostId: fresh }, confidence: "solid", expectedMultiple: 1.3, opinion: {}, produced, createdAt: now - 9 * H });
      await ctx.db.insert("predictions", { creatorId, subject: { ownPostId: ripe }, confidence: "strong", expectedMultiple: 1.8, opinion: {}, produced, createdAt: now - 59 * H });
      await ctx.db.insert("predictions", { creatorId, subject: { url: "https://www.tiktok.com/@other/video/1" }, confidence: "fine", expectedMultiple: 1, opinion: {}, produced, createdAt: now - 5 * DAY });
    });
    const r = await t.mutation(internal.review.predictions.scoreDue, { creatorId, now });
    expect(r.scored).toBe(1);
    const preds = await t.run((ctx) => ctx.db.query("predictions").collect());
    expect(preds.find((p) => p.subject.ownPostId === ripe)?.outcomeMultiple).toBe(2.1);
    expect(preds.find((p) => p.subject.ownPostId === fresh)?.scoredAt).toBeUndefined();
    expect(preds.find((p) => p.subject.url)?.scoredAt).toBeUndefined();
    const record = await t.query(internal.review.predictions.trackRecord, { creatorId });
    expect(record).toEqual([{ confidence: "strong", expected: 1.8, medianActual: 2.1, n: 1 }]);
  });

  it("a draft prediction scores against the first own post after it; an unposted draft closes after seven days", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const now = Date.now();
    const fileId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["x"])));
    const posted = await seedPost(t, creatorId, now - 3 * DAY, 0.6);
    await t.run(async (ctx) => {
      await ctx.db.insert("predictions", { creatorId, subject: { draftFileId: fileId }, confidence: "weak", expectedMultiple: 0.7, opinion: {}, produced, createdAt: now - 4 * DAY });
      await ctx.db.insert("predictions", { creatorId, subject: { draftFileId: fileId }, confidence: "fine", expectedMultiple: 1, opinion: {}, produced, createdAt: now - 20 * DAY });
    });
    const r = await t.mutation(internal.review.predictions.scoreDue, { creatorId, now });
    expect(r.scored).toBe(1);
    const preds = (await t.run((ctx) => ctx.db.query("predictions").collect())).sort((x, y) => y.createdAt - x.createdAt);
    expect(preds[0].outcomeMultiple).toBe(0.6);
    expect(preds[0].subject.ownPostId).toBe(posted);
    expect(preds[1].scoredAt).toBeTypeOf("number");
    expect(preds[1].outcomeMultiple).toBeUndefined();
  });
});

describe("the review's clock and ledger", () => {
  it("is due on Sunday morning on their clock, and not twice in a week", async () => {
    const t = convexTest(schema, modules);
    const la = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "America/Los_Angeles", channel: { paired: true } }));
    await t.run((ctx) => seedCreator(ctx, "b", { timezone: "Asia/Tokyo", channel: { paired: true }, clerkUserId: "u_b", handles: { tiktok: "tt_b" } }));
    const sundayLA10 = Date.UTC(2026, 8, 6, 17, 0); // Sun Sep 6 2026, 10:00 PDT = Mon 02:00 Tokyo
    expect(await t.query(internal.review.weekly.dueForReview, { now: sundayLA10 })).toEqual([la]);
    await t.run((ctx) => ctx.db.insert("messages", { creatorId: la, direction: "out", surface: "telegram", body: "review", ts: sundayLA10 - H, proactive: true, kind: "review" }));
    expect(await t.query(internal.review.weekly.dueForReview, { now: sundayLA10 })).toEqual([]);
    expect(await t.query(internal.review.weekly.dueForReview, { now: Date.UTC(2026, 8, 8, 17, 0) })).toEqual([]); // Tuesday
  });

  it("finish closes last week's experiment with the verdict and opens the new one", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { experiments: [{ id: "e1", text: "post at 7am", proposedAt: 1 }] }));
    await t.mutation(internal.review.weekly.finish, { creatorId, experimentVerdict: "held", newExperiment: "one post with no caption", rung: "healthy" });
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.experiments.map((e) => [e.text, e.result ?? null])).toEqual([["one post with no caption", null], ["post at 7am", "held"]]);
  });
});
