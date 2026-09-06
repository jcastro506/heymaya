import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { parseFirstIdeas } from "../firstIdeas";
import { atLocalHour } from "../postTime";

const TZ = "America/New_York";
const WEDNESDAY_3PM = atLocalHour(Date.UTC(2026, 8, 9, 12, 0), 15, TZ);

describe("the first plan has posts in it (live 2026-09-06)", () => {
  it("the parser keeps only usable ideas, capped, and invents none", () => {
    const out = parseFirstIdeas('here you go {"ideas":[{"hook":"the shoe rack list, said to camera","why":"rhymes with p1","evidencePostIds":["p1"]},{"hook":"x","why":"too short"},{"hook":"km vs miles, one take","why":"held people"}]}', 5);
    expect(out.map((i) => i.hook)).toEqual(["the shoe rack list, said to camera", "km vs miles, one take"]);
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
