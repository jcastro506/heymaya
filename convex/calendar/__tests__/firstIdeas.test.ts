import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { multiplesHold, parseFirstIdeas } from "../firstIdeas";
import { atLocalHour } from "../postTime";

const TZ = "America/New_York";
const WEDNESDAY_3PM = atLocalHour(Date.UTC(2026, 8, 9, 12, 0), 15, TZ);

describe("the first plan has posts in it (live 2026-09-06)", () => {
  it("the parser keeps only usable ideas, capped, and invents none", () => {
    const out = parseFirstIdeas('here you go {"ideas":[{"hook":"the shoe rack list, said to camera","why":"rhymes with p1","evidencePostIds":["p1"]},{"hook":"x","why":"too short"},{"hook":"km vs miles, one take","why":"held people"}]}', 5);
    expect(out.map((i) => i.hook)).toEqual(["the shoe rack list, said to camera", "km vs miles, one take"]);
    expect(parseFirstIdeas('{"ideas":[{"hook":"Best part of walking the city","why":"Your ambient clip did 9x"}]}', 1)[0]).toEqual({ hook: "best part of walking the city", why: "your ambient clip did 9x", evidencePostIds: [] });
    expect(parseFirstIdeas("no json here", 3)).toEqual([]);
    expect(parseFirstIdeas('{"ideas":[{"hook":"a long enough hook 1"},{"hook":"a long enough hook 2"},{"hook":"a long enough hook 3"}]}', 2).length).toBe(2);
  });

  describe("with the fake model", () => {
    beforeAll(() => { process.env.MODEL_FAKE = "1"; });
    afterAll(() => { delete process.env.MODEL_FAKE; });

    it("a day-one creator with no ideas and no experiment still gets a plan, seeded from their own posts", async () => {
      const t = convexTest(schema, modules);
      const creatorId = await t.run((ctx) => seedCreator(ctx, "a", {
        timezone: TZ, channel: { paired: true }, plan: { status: "onboarding", founding: true },
        dossier: { persona: { summary: "runner" }, keywords: ["running"], cadence: { postsPerWeek: 2, filmingDays: [], bestHoursLocal: [] }, fingerprint: { medianCutSeconds: 8 } },
        experiments: [],
      }));
      const r = await t.action(internal.calendar.weekPlan.draft, { creatorId, now: WEDNESDAY_3PM, horizon: "first" });
      expect(r.sent, r.reason).toBe(true);
      const ideas = await t.run((ctx) => ctx.db.query("ideas").collect());
      expect(ideas.length).toBeGreaterThanOrEqual(1);
      expect(ideas.every((i) => i.status === "sent" && (i.produced as { skillVersion: string }).skillVersion.startsWith("first-plan-ideas"))).toBe(true);
      const plan = (await t.run((ctx) => ctx.db.query("messages").collect())).find((m) => m.kind === "plan");
      expect(plan?.body).toContain("the rest of this week");
      expect(plan?.body).toContain("shoe rack");
    });
  });
});

describe("a multiple in an idea's why belongs to the post it cites (product sim 2026-09-28)", () => {
  it("pure: cited multiples must match an evidence post's, within rounding", () => {
    expect(multiplesHold("raw pre-run check-ins hit 1.76x normal", [0.36])).toBe(false);
    expect(multiplesHold("raw pre-run check-ins hit 1.76x normal", [1.76, 0.36])).toBe(true);
    expect(multiplesHold("pulled 2× your normal", [1.98])).toBe(true);
    expect(multiplesHold("your long runs land", [])).toBe(true);
  });
  it("rows: a misattributed multiple is replaced by the cited post and its real multiple; a right one is kept", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "m"));
    const day = 86_400_000;
    await t.run(async (ctx) => {
      for (let i = 0; i < 8; i++) await ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `p${i}`, url: `https://www.tiktok.com/@m/video/${i}`, createTime: Date.now() - (5 + i) * day, contentType: "video", caption: i === 0 ? "today is 18 miles and i'm freaking out" : `run ${i}`, hashtags: [], metrics: { views: i === 0 ? 360 : 1000, likes: 1, comments: 1, shares: 1 }, metricsAsOf: Date.now(), source: "scrape" } as never);
    });
    const r = await t.mutation(internal.calendar.firstIdeas.write, { creatorId, model: "m", ideas: [
      { hook: "mile 14 where my brain leaves", why: "raw pre-run check-ins hit 1.76x normal", evidencePostIds: ["p0"] },
      { hook: "another long run check-in", why: "your runs land around 1x normal", evidencePostIds: ["p1"] },
    ] });
    const ideas = await t.run((ctx) => Promise.all(r.ideaIds.map((id) => ctx.db.get(id))));
    const whys = ideas.map((x) => (x?.version as { why: string }).why);
    expect(whys[0]).toBe('rhymes with your "today is 18 miles and i\'m freaking out" (0.36× your normal)');
    expect(whys[1]).toBe("your runs land around 1x normal");
  });
});
