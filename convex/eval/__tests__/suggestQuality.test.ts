/**
 * §27.1: the quality eval's own rules. A card passes only when code can prove the account is
 * real, sized, active and on a connected platform, the reason's numbers exist, and the judge
 * calls it a real, relevant creator with an accurate reason.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { QUALITY, cardPasses, hardChecks, parseJudge, type CardFacts, type Verdict } from "../suggestQuality";

const facts = (over: Partial<CardFacts> = {}): CardFacts => ({
  exists: true, followers: 24_000, verified: false, bio: "runner", postCount: 300, lastPostDaysAgo: 3, postsRead: 12,
  stats: { medianViews: 3000, bestMultiple: 4.7, postsLast30: 9, topCaptions: ["my 16-mile long run"], runawayPost: false },
  recentPosts: [{ caption: "my 16-mile long run", views: 14000, daysAgo: 3 }],
  ...over,
});
const good: Verdict = { realCreator: "yes", kind: "creator", relevance: 3, learnable: 2, reasonAccurate: "yes", note: "same lane" };

describe("hard checks", () => {
  it("prove a real, sized, active account, and a reason whose numbers exist", () => {
    const h = hardChecks(facts(), "Her 16-mile run hit 4.7x her normal, 9 posts this month.", "tiktok", ["tiktok"]);
    expect(Object.values(h).every(Boolean)).toBe(true);
    expect(cardPasses(h, good)).toBe(true);
  });

  it("fail-closed: missing account, tiny or unknown audience, dormant, thin, wrong platform, invented numbers", () => {
    const why = "Her 16-mile run hit 4.7x her normal.";
    expect(hardChecks(facts({ exists: false }), why, "tiktok", ["tiktok"]).exists).toBe(false);
    expect(hardChecks(facts({ followers: QUALITY.minFollowers - 1 }), why, "tiktok", ["tiktok"]).realAudience).toBe(false);
    expect(hardChecks(facts({ followers: null }), why, "tiktok", ["tiktok"]).realAudience, "unsized is not a real audience").toBe(false);
    expect(hardChecks(facts({ lastPostDaysAgo: 45 }), why, "tiktok", ["tiktok"]).active).toBe(false);
    expect(hardChecks(facts({ lastPostDaysAgo: null }), why, "tiktok", ["tiktok"]).active).toBe(false);
    expect(hardChecks(facts({ postsRead: 2 }), why, "tiktok", ["tiktok"]).enoughPosts).toBe(false);
    expect(hardChecks(facts(), why, "tiktok", ["instagram"]).onConnectedPlatform).toBe(false);
    expect(hardChecks(facts(), "Her last post did 2 million views.", "tiktok", ["tiktok"]).reasonNumbersMatch).toBe(false);
  });

  it("the judge's bars: not a real creator, off-lane, a wrong reason, or no verdict fails the card", () => {
    const h = hardChecks(facts(), "A strong running diary.", "tiktok", ["tiktok"]);
    expect(cardPasses(h, { ...good, realCreator: "no", kind: "repost_or_meme" })).toBe(false);
    expect(cardPasses(h, { ...good, realCreator: "unsure" })).toBe(false);
    expect(cardPasses(h, { ...good, relevance: 1 })).toBe(false);
    expect(cardPasses(h, { ...good, reasonAccurate: "no" })).toBe(false);
    expect(cardPasses(h, { ...good, reasonAccurate: "partly" })).toBe(true);
    expect(cardPasses(h, null)).toBe(false);
  });
});

describe("the judge's answer", () => {
  it("adversarial: out-of-range scores, unknown words, bad indexes and prose around the JSON", () => {
    const content = 'here you go {"cards":[{"i":0,"realCreator":"yes","kind":"creator","relevance":3,"learnable":2,"reasonAccurate":"yes","note":"ok"},{"i":1,"realCreator":"maybe","relevance":2,"learnable":1,"reasonAccurate":"yes"},{"i":2,"realCreator":"no","relevance":9,"learnable":1,"reasonAccurate":"no"},{"i":7,"realCreator":"yes","relevance":2,"learnable":2,"reasonAccurate":"yes"}],"set":{"score":2,"note":"thin on instagram"}} thanks';
    const r = parseJudge(content, 3);
    expect(r.cards[0]?.relevance).toBe(3);
    expect(r.cards[1]).toBeNull();
    expect(r.cards[2]).toBeNull();
    expect(r).toMatchObject({ setScore: 2, setNote: "thin on instagram" });
    expect(parseJudge("not json", 2)).toEqual({ cards: [null, null], setScore: null, setNote: "" });
  });
});

describe("subjects", () => {
  it("a subject gets the production start path with its catalogue job retired, so only the first read runs", async () => {
    const t = convexTest(schema, modules);
    const r = await t.mutation(internal.eval.suggestQuality.createSubject, { label: "t1", handles: { instagram: "someone.real" }, niche: "home cooking for busy parents", timezone: "America/Chicago" });
    expect(r.ok).toBe(true);
    const job = await t.run((ctx) => ctx.db.query("jobs").withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", `ingest:${r.creatorId}:v0`)).first());
    expect(job?.status).toBe("dead");
    expect(job?.lastError).toMatch(/eval subject/);
    const row = await t.run((ctx) => ctx.db.get(r.creatorId!));
    expect(row?.niche).toBe("home cooking for busy parents");
  });
});
