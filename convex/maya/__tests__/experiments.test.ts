/**
 * `run-experiment` (§15.3) — declare it, watch it, call it.
 *
 * The hard rules are all about discipline before data: one live experiment per
 * channel, a pre-declared window and metric, and **"inconclusive" said out
 * loud**. Choosing the metric after seeing the numbers is how you always find a
 * win — you pick the column that moved.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { minimalRow, type InsertCtx } from "../../../tests/lib/minimalRow";
import {
  WINDOW_DAYS,
  callVerdict,
  dueForVerdict,
  liveOn,
  parseExperiments,
  type Experiment,
  armsFromPlacements,
} from "../experiments";

const NOW = Date.UTC(2026, 7, 11, 12, 0, 0);

const experiment = (over: Partial<Experiment> = {}): Experiment => ({
  id: "x_1",
  channel: "x",
  hypothesis: "objection openers beat question openers",
  metric: "views",
  arms: ["objection", "question"],
  startedAt: NOW,
  endsAt: NOW + WINDOW_DAYS * 86_400_000,
  ...over,
});

describe("one live experiment per channel", () => {
  it("finds the live one", () => {
    expect(liveOn([experiment()], "x", NOW)?.id).toBe("x_1");
  });

  it("ignores a concluded one", () => {
    // A called experiment no longer blocks the channel — that's the point of
    // calling it.
    const done = experiment({
      verdict: { kind: "winner", detail: "done", calledAt: NOW },
    });
    expect(liveOn([done], "x", NOW)).toBeNull();
  });

  it("ignores one whose window has closed", () => {
    expect(liveOn([experiment({ endsAt: NOW - 1 })], "x", NOW)).toBeNull();
  });

  it("does not block a different channel", () => {
    // Two at once on the SAME surface makes both unreadable; different
    // surfaces are independent.
    expect(liveOn([experiment()], "tiktok", NOW)).toBeNull();
  });
});

describe("dueForVerdict", () => {
  /**
   * ⚠️ Closed, not "closed and successful". An experiment that ran its two
   * weeks and gathered nothing still needs its verdict called — leaving it
   * open forever is how a registry fills with things nobody concludes.
   */
  it("returns closed experiments with no verdict", () => {
    const closed = experiment({ id: "x_old", endsAt: NOW - 1 });
    expect(dueForVerdict([closed, experiment()], NOW).map((e) => e.id)).toEqual([
      "x_old",
    ]);
  });

  it("skips ones already called", () => {
    const called = experiment({
      endsAt: NOW - 1,
      verdict: { kind: "inconclusive", detail: "d", calledAt: NOW },
    });
    expect(dueForVerdict([called], NOW)).toEqual([]);
  });
});

describe("callVerdict", () => {
  /**
   * ⭐ §15.3: "'inconclusive' is a legitimate verdict and is said out loud."
   *
   * At this volume (§14.3) two weeks often genuinely cannot separate two
   * hooks. Softening that into a lean is how a system starts optimising noise.
   */
  it("says inconclusive rather than picking a leader from nothing", () => {
    const out = callVerdict(experiment(), [
      { label: "objection", trials: 3, conversions: 1 },
      { label: "question", trials: 3, conversions: 0 },
    ]);
    expect(out.kind).toBe("inconclusive");
    expect(out.detail).toMatch(/wasn't enough to tell/i);
  });

  /**
   * ⚠️ And it frames it as an open question, not a rejection. An inconclusive
   * result read as a no quietly kills ideas that were never actually tested.
   */
  it("frames inconclusive as still open, never as a no", () => {
    const out = callVerdict(experiment(), [
      { label: "objection", trials: 2, conversions: 0 },
      { label: "question", trials: 2, conversions: 0 },
    ]);
    expect(out.detail).toMatch(/open question, not a no/i);
  });

  it("names a winner when the data supports one", () => {
    const out = callVerdict(experiment(), [
      { label: "objection", trials: 200, conversions: 60 },
      { label: "question", trials: 200, conversions: 10 },
    ]);
    expect(out.kind).toBe("winner");
    expect(out.detail).toContain("objection");
  });

  it("carries the hypothesis into every verdict", () => {
    // A verdict without the question it answered is unreadable a month later.
    for (const arms of [
      [
        { label: "a", trials: 1, conversions: 0 },
        { label: "b", trials: 1, conversions: 0 },
      ],
      [
        { label: "a", trials: 300, conversions: 90 },
        { label: "b", trials: 300, conversions: 5 },
      ],
    ]) {
      expect(callVerdict(experiment(), arms).detail).toContain(
        "objection openers beat question openers"
      );
    }
  });
});

describe("parseExperiments", () => {
  it("returns an empty list rather than throwing on junk", () => {
    // A corrupt registry must not take down the weekly review.
    expect(parseExperiments(undefined)).toEqual([]);
    expect(parseExperiments("not json")).toEqual([]);
    expect(parseExperiments('{"not":"an array"}')).toEqual([]);
  });
});

describe("the window", () => {
  it("is two weeks — one hypothesis worth two weeks", () => {
    expect(WINDOW_DAYS).toBe(14);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * ⭐ THE LOOP, CLOSED. Sprint 8's `run-experiment`.
 *
 * ⚠️ `declare`, `dueForVerdict`, `callVerdict` and `recordVerdict` all existed,
 * and `strategy.ts` has read `latestConcluded` since it was written — with
 * nothing in between. Placements carried no arm, so a verdict had no rows to
 * read and the change trigger `meetsChangeBar` depends on could never fire.
 * The strategy review's own comment said so: "a change trigger that could never
 * fire."
 */
describe("arms from placements", () => {
  const exp = (over: Partial<Experiment> = {}): Experiment => ({
    id: "e1",
    channel: "x",
    hypothesis: "short hooks travel further",
    metric: "engagements",
    arms: ["short", "long"],
    startedAt: 0,
    endsAt: 1_000,
    ...over,
  });

  it("⭐ engagements: views are the trials, engagements the conversions", () => {
    const arms = armsFromPlacements(exp(), [
      { arm: "short", views: 1000, engagements: 50 },
      { arm: "short", views: 500, engagements: 30 },
      { arm: "long", views: 800, engagements: 8 },
    ]);
    expect(arms.find((a) => a.label === "short")).toEqual({
      label: "short",
      trials: 1500,
      conversions: 80,
    });
    expect(arms.find((a) => a.label === "long")).toEqual({
      label: "long",
      trials: 800,
      conversions: 8,
    });
  });

  it("⭐ views: a median split, because a view can't be its own denominator", () => {
    /**
     * ⚠️ `views` has no natural trial — the metric IS the count, so using it as
     * the denominator is circular. Each post either beat the week's middle or
     * it didn't, which keeps the comparison a rate the shared summariser reads.
     */
    const arms = armsFromPlacements(exp({ metric: "views" }), [
      { arm: "short", views: 900, engagements: 0 },
      { arm: "short", views: 800, engagements: 0 },
      { arm: "long", views: 100, engagements: 0 },
      { arm: "long", views: 50, engagements: 0 },
    ]);
    const short = arms.find((a) => a.label === "short")!;
    const long = arms.find((a) => a.label === "long")!;
    // Trials are POSTS here, not views.
    expect(short.trials).toBe(2);
    expect(long.trials).toBe(2);
    // Short's posts are both at or above the pooled median; long's are below.
    expect(short.conversions).toBe(2);
    expect(long.conversions).toBe(0);
  });

  it("⚠️ an arm with no posts is reported at zero, not dropped", () => {
    /**
     * A missing arm would make the summariser compare one thing against
     * nothing and call a winner. Zero trials is the honest input, and
     * `callVerdict` turns it into "inconclusive" rather than a verdict.
     */
    const arms = armsFromPlacements(exp(), [
      { arm: "short", views: 100, engagements: 5 },
    ]);
    expect(arms).toHaveLength(2);
    expect(arms.find((a) => a.label === "long")).toEqual({
      label: "long",
      trials: 0,
      conversions: 0,
    });
  });

  it("⚠️ a thin result is inconclusive, never a lean", () => {
    // §14.3: "any system claiming to optimize hooks off 40 data points is
    // fitting noise and will produce confident nonsense." The floor is what
    // protects the median split from itself.
    const verdict = callVerdict(
      exp(),
      armsFromPlacements(exp(), [
        { arm: "short", views: 10, engagements: 1 },
        { arm: "long", views: 10, engagements: 0 },
      ]),
    );
    expect(verdict.kind).toBe("inconclusive");
    // ⚠️ "Still an open question, not a no."
    expect(verdict.detail).toMatch(/open question, not a no/i);
  });
});

/* -------------------------------------------------------------------------- */

describe("declare → publish → conclude, end to end", () => {
  const NOW = 1_786_900_000_000;

  async function seed(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const c = ctx as unknown as {
        db: { insert: (table: string, value: unknown) => Promise<string> };
      };
      const creator = await c.db.insert(
        "creators",
        await minimalRow(ctx as InsertCtx, "creators", {
          clerkUserId: "exp",
          email: "exp@e.com",
          accountType: "gtm-agent",
        }),
      );
      return await c.db.insert(
        "customers",
        await minimalRow(ctx as InsertCtx, "customers", { accountId: creator }),
      );
    });
  }

  it("⭐ publishing while an experiment runs tags the post with an arm", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);

    await t.mutation(internal.maya.experiments.declare, {
      customerId: customerId as never,
      channel: "x",
      hypothesis: "short hooks travel further",
      metric: "engagements",
      arms: ["short", "long"],
      now: NOW,
    });

    await t.mutation(internal.maya.publish.recordPlacement, {
      customerId: customerId as never,
      channel: "x",
      url: "https://x.com/status/1",
      snapshotText: "one",
      idempotencyKey: "k1",
      publishedAt: NOW + 1000,
    });

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("placements").collect();
      expect(rows[0].experimentArm).toBeDefined();
      expect(["short", "long"]).toContain(rows[0].experimentArm);
    });
  });

  it("⭐ assignment balances rather than flipping a coin", async () => {
    /**
     * At two weeks and a handful of posts, a coin flip can hand one arm most of
     * the window. §14.3 already warns this volume is where confident nonsense
     * comes from — so fewest-posts-so-far goes next.
     */
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.experiments.declare, {
      customerId: customerId as never,
      channel: "x",
      hypothesis: "h",
      metric: "engagements",
      arms: ["short", "long"],
      now: NOW,
    });

    for (let i = 0; i < 4; i += 1) {
      await t.mutation(internal.maya.publish.recordPlacement, {
        customerId: customerId as never,
        channel: "x",
        url: `https://x.com/status/${i}`,
        snapshotText: `post ${i}`,
        idempotencyKey: `k${i}`,
        publishedAt: NOW + 1000 * (i + 1),
      });
    }

    await t.run(async (ctx) => {
      const rows = (await ctx.db.query("placements").collect()) as Array<{
        experimentArm?: string;
      }>;
      const short = rows.filter((r) => r.experimentArm === "short").length;
      const long = rows.filter((r) => r.experimentArm === "long").length;
      expect(short).toBe(2);
      expect(long).toBe(2);
    });
  });

  it("⭐ a closed window gets a verdict the strategy review can read", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.experiments.declare, {
      customerId: customerId as never,
      channel: "x",
      hypothesis: "short hooks travel further",
      metric: "engagements",
      arms: ["short", "long"],
      now: NOW,
    });

    // Two weeks later, with the window closed.
    const after = NOW + 15 * 86_400_000;
    const out = await t.mutation(internal.maya.experiments.concludeDue, {
      customerId: customerId as never,
      now: after,
    });
    expect(out.concluded).toBe(1);

    // ⭐ And it is now readable — the query `strategy.ts` has always called.
    const latest = await t.query(internal.maya.experiments.latestConcluded, {
      customerId: customerId as never,
      sinceDays: 7,
      now: after,
    });
    expect(latest).not.toBeNull();
  });

  it("⚠️ a verdict already called is never overwritten", async () => {
    // The first answer is the one that was true at the window's close.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.experiments.declare, {
      customerId: customerId as never,
      channel: "x",
      hypothesis: "h",
      metric: "engagements",
      arms: ["a", "b"],
      now: NOW,
    });
    const after = NOW + 15 * 86_400_000;
    await t.mutation(internal.maya.experiments.concludeDue, {
      customerId: customerId as never,
      now: after,
    });
    const second = await t.mutation(internal.maya.experiments.concludeDue, {
      customerId: customerId as never,
      now: after,
    });
    expect(second.concluded).toBe(0);
  });
});
