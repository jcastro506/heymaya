/**
 * The month plan: built on what they're good at, tied to their goal, at a pace they can keep, proposed
 * not imposed; agreeing keeps its goal and why; it waits for morning; it rides with the first week.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { MONTH_PLAN_SKILL, parseMonthPlan } from "../monthPlan";
import { growthSection, type GrowthPlan } from "../growth";

const NOW = Date.UTC(2026, 9, 1, 15, 0);
const json = (o: Record<string, unknown>) => JSON.stringify({ goal: "all of it lol", goalStated: true, builtOn: ["letting a scene breathe, no talking"], formats: ["night pan with one line of text"], postsPerWeek: 3, test: "a 10-second cut vs your usual 30", howItHelps: "steady posts of what already beats your normal, so you learn what hits and keep a rhythm", lane: "city at night", keywords: ["london", "night walk"], message: "you said all of it, so here's the month…", ...o });

describe("parsing (pure)", () => {
  it("keeps the goal, what it's built on and how it gets there; review in four weeks; proposed, not set", () => {
    const r = parseMonthPlan(json({}), { keywords: [], postsPerWeek: 2 }, NOW)!;
    expect(r.plan).toMatchObject({ goal: "all of it lol", goalStated: true, builtOn: ["letting a scene breathe, no talking"], status: "proposed", postsPerWeek: 3, reviewAt: NOW + 28 * 86_400_000 });
    expect(r.plan.howItHelps).toMatch(/learn what hits/);
  });
  it("holds the pace to theirs or one more, never homework", () => {
    expect(parseMonthPlan(json({ postsPerWeek: 7 }), { keywords: [], postsPerWeek: 2 }, NOW)!.plan.postsPerWeek).toBe(3);
    expect(parseMonthPlan(json({ postsPerWeek: 0 }), { keywords: [], postsPerWeek: 2 }, NOW)!.plan.postsPerWeek).toBe(2);
  });
  it("no goal, no message or no lane words means no plan (the week still goes)", () => {
    expect(parseMonthPlan(json({ goal: "" }), { keywords: [], postsPerWeek: 2 }, NOW)).toBeNull();
    expect(parseMonthPlan(json({ message: "" }), { keywords: [], postsPerWeek: 2 }, NOW)).toBeNull();
    expect(parseMonthPlan(json({ keywords: [] }), { keywords: [], postsPerWeek: 2 }, NOW)).toBeNull();
    expect(parseMonthPlan(json({ keywords: [] }), { keywords: ["london"], postsPerWeek: 2 }, NOW)?.plan.keywords).toEqual(["london"]);
    expect(parseMonthPlan("no json here", { keywords: ["x"], postsPerWeek: 2 }, NOW)).toBeNull();
  });
  it("the skill builds on strengths, never a one-off, opens with their goal and says how it reaches it", () => {
    expect(MONTH_PLAN_SKILL).toMatch(/never on the setting of a one-off/);
    expect(MONTH_PLAN_SKILL).toMatch(/Open with their goal in their words/);
    expect(MONTH_PLAN_SKILL).toMatch(/how it gets them to that goal/);
    expect(MONTH_PLAN_SKILL).toMatch(/i'm guessing you mainly want/);
  });
});

describe("on rows", () => {
  it("agreeing to the proposal sets it running and keeps its goal and why; her context says which", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "mp1"));
    const proposed = parseMonthPlan(json({}), { keywords: [], postsPerWeek: 2 }, NOW)!.plan;
    await t.mutation(internal.agent.monthPlan.store, { creatorId: c, plan: proposed });
    expect(growthSection({ standing: "new", laneConfirmed: false, plan: proposed, now: NOW, timeZone: "UTC" })).toMatch(/proposed, not agreed yet[\s\S]*Their goal: all of it lol[\s\S]*How it reaches the goal/);
    await t.mutation(internal.agent.growth.setPlan, { creatorId: c, lane: "city at night", keywords: ["london"], postsPerWeek: 2, setBy: "chat", now: NOW + 3_600_000 });
    const after = (await t.run((ctx) => ctx.db.get(c)))!.growthPlan as GrowthPlan;
    expect(after).toMatchObject({ status: "running", goal: "all of it lol", postsPerWeek: 2, howItHelps: proposed.howItHelps, reviewAt: proposed.reviewAt });
  });

  it("at night it waits for morning; it is what day one schedules after the read", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "mp2", { timezone: "UTC", channel: { paired: true, pairedAt: NOW - 86_400_000 * 3, kind: "telegram", chatId: "9" } }));
    const before = Date.now;
    Date.now = () => Date.UTC(2026, 9, 1, 23, 30);
    try {
      expect(await t.action(internal.agent.monthPlan.proposeThenWeek, { creatorId: c })).toEqual({ proposed: false, reason: "quiet hours; proposing in the morning" });
    } finally { Date.now = before; }
    expect(readFileSync(new URL("../../onboarding/firstRead.ts", import.meta.url), "utf8")).toMatch(/FIRST_PLAN_DELAY_MS, internal\.agent\.monthPlan\.proposeThenWeek/);
  });
});
