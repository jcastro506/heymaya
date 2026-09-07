import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { buildPrefix, planSection } from "../context";
import { PLAN_LINE, SOUL } from "../soul";

describe("what she may say about money and leaving (live 2026-09-06)", () => {
  it("the prefix carries the plan status, the trial date and the one price line", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "America/New_York", plan: { status: "trialing", founding: true, trialEndsAt: Date.UTC(2026, 8, 13, 12) } }));
    const c = (await t.run((ctx) => ctx.db.get(id)))!;
    const section = planSection(c);
    expect(section).toContain("Status: trialing (founding seat)");
    expect(section).toContain("Trial ends Sep 13");
    expect(section).toContain(PLAN_LINE);
    const prefix = buildPrefix({ creator: c, directives: [], skill: "x" });
    expect(prefix).toContain("# Their plan");
    expect(prefix.indexOf("# Their plan")).toBeGreaterThan(prefix.indexOf("# The creator"));
  });

  it("the soul forbids inventing money facts and deleting from a text", () => {
    expect(SOUL).toMatch(/Never invent a price/);
    expect(SOUL).toMatch(/typing DELETE/);
    expect(SOUL).toMatch(/never "baseline"/);
    expect(SOUL).toMatch(/Sounds like you:/);
    expect(SOUL).toMatch(/personality and it is allowed out/);
    expect(SOUL).toMatch(/capitalise however reads naturally/);
    expect(SOUL).not.toMatch(/lowercase is fine, fragments are fine/);
    expect(SOUL).toMatch(/If a sentence could sit in an email from a company/);
  });
});
