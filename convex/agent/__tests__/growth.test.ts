import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { growthFacts, growthSection, GROWTH, GROWTH_PLAYBOOK, type GrowthPlan } from "../growth";

const NOW = Date.UTC(2026, 8, 6, 12);
const plan = (over: Partial<GrowthPlan> = {}): GrowthPlan => ({ lane: "london runs", keywords: ["running", "london"], formats: [], postsPerWeek: 3, hypothesis: "h", startedAt: NOW - 7 * 86_400_000, reviewAt: NOW + 21 * 86_400_000, status: "running", setBy: "tap", ...over });

describe("growth expertise rides only while it earns its place (Sprint 4f)", () => {
  it("absent when she knows them well, the lane is confirmed and no plan runs; present when new, unconfirmed, or running; DUE at the review date", () => {
    expect(growthSection({ standing: "solid", laneConfirmed: true, plan: null, now: NOW, timeZone: "UTC" })).toBeNull();
    expect(growthSection({ standing: "new", laneConfirmed: true, plan: null, now: NOW, timeZone: "UTC" })).toContain("How growing actually works");
    expect(growthSection({ standing: "solid", laneConfirmed: false, plan: null, now: NOW, timeZone: "UTC" })).toContain("None yet");
    const running = growthSection({ standing: "solid", laneConfirmed: true, plan: plan(), now: NOW, timeZone: "UTC" });
    expect(running).toContain("london runs");
    expect(running).not.toContain("DUE");
    expect(growthSection({ standing: "solid", laneConfirmed: true, plan: plan({ reviewAt: NOW - 1 }), now: NOW, timeZone: "UTC" })).toContain("DUE");
  });

  it("the playbook never states a ratio as a fact", () => {
    expect(GROWTH_PLAYBOOK).toMatch(/must not state as fact/);
    expect(GROWTH_PLAYBOOK).toMatch(/nobody has a number/);
  });

  it("growth facts: in-lane by keyword, medians per side, follows and the follower delta from rows", () => {
    const f = growthFacts({
      plan: plan(),
      week: [
        { caption: "sunday long run", hashtags: ["running"], multiple: 2.1, follows: 4 },
        { caption: "piccadilly at night", hashtags: ["london"], multiple: 0.7, follows: 0 },
        { caption: "csv dashboard demo", hashtags: ["buildinpublic"], multiple: 0.4, follows: null },
      ],
      followers: [{ day: "2026-09-01", followers: 100 }, { day: "2026-09-05", followers: 112 }],
    });
    expect(f?.inLane).toBe(2);
    expect(f?.outOfLane).toBe(1);
    expect(f?.inLaneMedianMultiple).toBe(2.1); // upper median of two
    expect(f?.outOfLaneMedianMultiple).toBe(0.4);
    expect(f?.follows).toBe(4);
    expect(f?.followerDelta).toBe(12);
    expect(growthFacts({ plan: null, week: [], followers: [] })).toBeNull();
  });
});

describe("the plan row", () => {
  it("set takes the cadence from the dossier, cleans keywords, and reviews in four weeks; drop marks it dropped", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    await t.run(async (ctx) => { await ctx.db.patch(creatorId, { dossier: { cadence: { postsPerWeek: 4 } } }); });
    const r = await t.mutation(internal.agent.growth.setPlan, { creatorId, lane: "london runs", keywords: ["#Running", "london", "ab"], setBy: "chat", now: NOW });
    expect(r.ok).toBe(true);
    expect(r.plan?.postsPerWeek).toBe(4);
    expect(r.plan?.keywords).toEqual(["running", "london"]);
    expect(r.plan?.reviewAt).toBe(NOW + GROWTH.planWeeks * 7 * 86_400_000);
    expect((await t.mutation(internal.agent.growth.setPlan, { creatorId, lane: "", keywords: [], setBy: "chat" })).ok, "a plan needs a lane").toBe(false);
    expect((await t.mutation(internal.agent.growth.dropPlan, { creatorId })).ok).toBe(true);
    expect((await t.query(internal.agent.growth.readPlan, { creatorId }))?.status).toBe("dropped");
  });

  it("a tap on a candidate writes the lane, repoints the keywords, starts the plan; another creator's token is not found", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const b = await t.run((ctx) => seedCreator(ctx, "b", {}));
    await t.mutation(internal.onboarding.lane.stashRead, { creatorId: a, token: "pick-running-travel", keywords: ["running"], candidates: [{ label: "london runs", keywords: ["running", "london"] }, { label: "travel days", keywords: ["travel"] }] });
    expect((await t.mutation(internal.onboarding.lane.pick, { creatorId: b, token: "pick-running-travel", index: 0 })).ok, "cross-tenant").toBe(false);
    const r = await t.mutation(internal.onboarding.lane.pick, { creatorId: a, token: "pick-running-travel", index: 1 });
    expect(r.ok).toBe(true);
    expect(r.label).toBe("travel days");
    const c = await t.run(async (ctx) => await ctx.db.get(a));
    expect(c?.laneConfirmedAt).toBeTruthy();
    expect((c?.dossier as { keywords?: string[] }).keywords).toEqual(["travel"]);
    expect((c?.growthPlan as GrowthPlan).lane).toBe("travel days");
    expect((c?.growthPlan as GrowthPlan).status).toBe("running");
    expect((await t.mutation(internal.onboarding.lane.pick, { creatorId: a, token: "pick-running-travel", index: 7 })).ok, "no such candidate").toBe(false);
  });

  it("the week plan takes its cadence from a running plan before the dossier", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    await t.run(async (ctx) => { await ctx.db.patch(creatorId, { dossier: { cadence: { postsPerWeek: 2 } }, growthPlan: plan({ postsPerWeek: 4 }) }); });
    const inp = await t.query(internal.calendar.weekPlan.inputsFor, { creatorId, now: NOW });
    expect(inp?.postsPerWeek).toBe(4);
    await t.run(async (ctx) => { await ctx.db.patch(creatorId, { growthPlan: plan({ postsPerWeek: 4, status: "dropped" }) }); });
    expect((await t.query(internal.calendar.weekPlan.inputsFor, { creatorId, now: NOW }))?.postsPerWeek, "a dropped plan does not set the cadence").toBe(2);
  });

  it("at most two lane questions in a week are counted from the rows", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    await t.run(async (ctx) => {
      for (const id of ["lane:a:yes", "lanepick:b:0"]) await ctx.db.insert("messages", { creatorId, direction: "out", surface: "telegram", body: "q", ts: Date.now() - 3_600_000, buttons: [{ id, label: "x" }] });
      await ctx.db.insert("messages", { creatorId, direction: "out", surface: "telegram", body: "old", ts: Date.now() - 9 * 86_400_000, buttons: [{ id: "lane:c:yes", label: "x" }] });
    });
    const li = await t.query(internal.onboarding.lane.inputsFor, { creatorId });
    expect(li?.laneQuestionsThisWeek).toBe(2);
  });
});

describe("who they admire reaches the proposal on day one", () => {
  it("the roster's words from the cluster read are merged into admiredKeywords", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    await t.run(async (ctx) => { await ctx.db.patch(creatorId, { lanes: { readAt: 1, posts: 0, scatter: 0, state: "none", clusters: [], admiredKeywords: ["travel", "backpacking"] } }); });
    const li = await t.query(internal.onboarding.lane.inputsFor, { creatorId });
    expect(li?.admiredKeywords).toEqual(expect.arrayContaining(["travel", "backpacking"]));
  });
});
