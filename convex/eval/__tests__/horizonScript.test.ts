/**
 * The horizon script's harness (her words are measured live). Categories: sibling coherence (the week's
 * plan, the beats, the step bounds), fail-closed (a real creator's calendar is never seeded),
 * adversarial (numbers in words, a date across the new year), and the weekly checks against rows.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { horizonBeats, horizonRole, HORIZON_STEPS, RACE_WEEK, runHorizonBeat, weeksNamed, writtenDate } from "../horizonScript";
import { dayPlan, resolveOpts } from "../firstWeek";

const D = 86_400_000;

describe("the horizon plan (sibling coherence)", () => {
  it("every step is a week with a review and next week's plan, and the beats land where the story needs them", () => {
    const plan = dayPlan(5, { signupWeekday: 1, script: "horizon" });
    expect(plan).toEqual(expect.arrayContaining(["age", "scout", "scoutAfternoon", "review", "weekPlan", "beat:h-week"]));
    expect(horizonBeats(1)).toEqual(["h-start", "h-week"]);
    expect(horizonBeats(RACE_WEEK + 1)).toContain("h-finished");
    expect([...Array(HORIZON_STEPS)].flatMap((_, k) => horizonBeats(k + 1)).filter((b) => b === "h-countdown")).toHaveLength(1);
  });

  it("a horizon run defaults to 24 weekly steps and allows up to 30; a daily run still stops at 14", () => {
    expect(resolveOpts({ script: "horizon", replay: true }).days).toBe(HORIZON_STEPS);
    expect(resolveOpts({ script: "horizon", replay: true, days: 30 }).days).toBe(30);
    expect(() => resolveOpts({ script: "horizon", replay: true, days: 31 })).toThrow(/1–30/);
    expect(() => resolveOpts({ days: 20 })).toThrow(/1–14/);
  });

  it("roles alternate: the goal, then the life", () => {
    expect([0, 1, 2].map(horizonRole)).toEqual(["goal", "life", "goal"]);
  });
});

describe("reading her answers (adversarial)", () => {
  it("finds the weeks she names, in digits or words", () => {
    expect(weeksNamed("six weeks out! taper starts soon")).toBe(6);
    expect(weeksNamed("you've got 7 full weeks left")).toBe(7);
    expect(weeksNamed("race day is close")).toBeNull();
  });
  it("writes the race date the way a person texts it", () => {
    expect(writtenDate(Date.UTC(2026, 8, 25, 18), 20, "America/Los_Angeles")).toBe("feb 12");
  });
});

describe("the weekly checks read rows", () => {
  const world = async (i: number) => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, `h${i}`, { clerkUserId: `eval-run:fw-htest:${i}`, notes: [{ id: "n1", text: "running the chicago marathon on feb 12", kind: "life", at: Date.now() }] }));
    const idea = (hook: string, ago = D) => t.run((ctx) => ctx.db.insert("ideas", { creatorId, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook }, messageText: hook, produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" }, status: "sent", createdAt: Date.now() - ago } as never));
    const env = (d: number) => ({ ctx: { runQuery: t.query, runMutation: t.mutation, runAction: t.action } as never, creatorId, i, d, timezone: "UTC", say: async () => "(stub)" });
    return { t, creatorId, idea, env };
  };

  it("the goal creator: a week with a marathon idea keeps the series; a week without it doesn't", async () => {
    const w = await world(0);
    await w.idea("18 weeks out from chicago: the first long run of the block");
    const kept = await runHorizonBeat(w.env(2), "h-week");
    expect(kept.find((c) => c.check === "the goal is still a row")?.ok).toBe(true);
    expect(kept.find((c) => c.check.startsWith("the marathon series keeps coming"))?.ok).toBe(true);

    const dry = await world(2);
    await dry.idea("my morning coffee routine");
    expect((await runHorizonBeat(dry.env(2), "h-week")).find((c) => c.check.startsWith("the marathon series keeps coming"))?.ok).toBe(false);
  });

  it("near race day the check wants race-day content; after it, recap and not 'still training'", async () => {
    const near = await world(0);
    await near.idea("race week nerves: laying out the bib and the carb load");
    expect((await runHorizonBeat(near.env(RACE_WEEK - 1), "h-week")).find((c) => c.check.startsWith("close to race day"))?.ok).toBe(true);
    const after = await world(0);
    await after.idea("training for chicago: 3 weeks out");
    expect((await runHorizonBeat(after.env(RACE_WEEK + 3), "h-week")).find((c) => c.check.startsWith("after the race"))?.ok).toBe(false);
  });

  it("the life creator: an event 1–3 weeks out has to show up in her work", async () => {
    const w = await world(1);
    await w.t.mutation(internal.eval.horizonScript.seedLife, { creatorId: w.creatorId, events: [{ title: "Boulder trip with Sam", start: Date.now() + 12 * D, allDay: true, filmable: true }] });
    const miss = await runHorizonBeat(w.env(2), "h-week");
    expect(miss.find((c) => c.check.includes("1–3 weeks out"))?.ok).toBe(false);
    await w.idea("a boulder trail day with Sam before the move");
    const hit = await runHorizonBeat(w.env(2), "h-week");
    expect(hit.find((c) => c.check.includes("1–3 weeks out"))?.ok).toBe(true);
  });

  it("never seeds a real creator's calendar (fail-closed)", async () => {
    const t = convexTest(schema, modules);
    const real = await t.run((ctx) => seedCreator(ctx, "real", { clerkUserId: "user_2real" }));
    await expect(t.mutation(internal.eval.horizonScript.seedLife, { creatorId: real, events: [{ title: "x", start: Date.now(), allDay: true, filmable: false }] })).rejects.toThrow(/simulation/);
  });
});
