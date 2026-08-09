/**
 * ⭐ `plan-day` (Sprint 5) — the plan as a promise, not a sentence.
 *
 * §3.1 gives the agent "the daily plan" and it lived entirely in her head: the
 * morning brief said what she intended and nothing recorded it, so when the day
 * ended differently there was nothing to compare against.
 *
 * That happened twice in three days. On 2026-08-06 the brief said *"I'll shape
 * one X post… then show it to you first"* and the founder never saw one. On
 * 2026-08-08 it planned a placement and the turn produced nothing. Both times
 * the evening recap was perfectly accurate about the zero — and **silent about
 * the promise**.
 *
 * Principle 4: anything promised to the user is enforced by the server.
 */
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 8, 16, 0); // 12:00 in New York
const NY = "America/New_York";

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "telegram",
      timezone: NY,
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: NY,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function bank(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  angle: string
) {
  return await t.run((ctx) =>
    ctx.db.insert("ideas", {
      customerId,
      angle,
      status: "bank",
      sourceKind: "complaint",
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

describe("a plan is written down, in the FOUNDER's day", () => {
  it("records the intention with the idea behind it", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "plan");
    const ideaId = await bank(t, customerId, "csv to dashboard in one paste");

    const res = await t.mutation(internal.maya.dayPlan.planPost, {
      customerId,
      ideaId,
      channel: "x",
      now: NOW,
    });
    expect(res.ok).toBe(true);

    const plan = await t.query(internal.maya.dayPlan.planFor, { customerId, now: NOW });
    // 12:00 in New York is 16:00 UTC — the day must be theirs, not UTC's.
    expect(plan.day).toBe("2026-08-08");
    expect(plan.planned).toBe(1);
    expect(plan.posts[0].angle).toBe("csv to dashboard in one paste");
  });

  it("planning the same idea twice makes one promise, not two", async () => {
    // The placement cron and a mid-morning conversation can both plan it.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "idem");
    const ideaId = await bank(t, customerId, "one idea");

    const a = await t.mutation(internal.maya.dayPlan.planPost, {
      customerId, ideaId, channel: "x", now: NOW,
    });
    const b = await t.mutation(internal.maya.dayPlan.planPost, {
      customerId, ideaId, channel: "x", now: NOW,
    });
    expect(a.planId).toBe(b.planId);

    const plan = await t.query(internal.maya.dayPlan.planFor, { customerId, now: NOW });
    expect(plan.planned).toBe(1);
  });

  it("CROSS-TENANT: another account's idea can't be planned", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "tenant_a");
    const b = await seed(t, "tenant_b");
    const theirs = await bank(t, b, "not yours");

    const res = await t.mutation(internal.maya.dayPlan.planPost, {
      customerId: a, ideaId: theirs, channel: "x", now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/different account/);
  });
});

describe("⭐ THE GAP IS THE POINT", () => {
  it("an unkept plan is NAMED, with the angle", async () => {
    // The sentence that would have caught both silent days.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "unkept");
    const ideaId = await bank(t, customerId, "the post that never came");
    await t.mutation(internal.maya.dayPlan.planPost, {
      customerId, ideaId, channel: "x", now: NOW,
    });

    const plan = await t.query(internal.maya.dayPlan.planFor, { customerId, now: NOW });
    expect(plan.outstanding).toHaveLength(1);
    expect(plan.detail).toContain("the post that never came");
    expect(plan.detail).toMatch(/still open/);
  });

  it("a kept plan says so plainly", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "kept");
    const ideaId = await bank(t, customerId, "the one that shipped");
    await t.mutation(internal.maya.dayPlan.planPost, {
      customerId, ideaId, channel: "x", now: NOW,
    });
    const placementId = await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId, kind: "post", channel: "x", linkStatus: "live",
        publishedAt: NOW, snapshotText: "shipped", idempotencyKey: "k1",
      })
    );
    await t.mutation(internal.maya.dayPlan.markDoneByIdea, {
      customerId, ideaId, placementId, now: NOW,
    });

    const plan = await t.query(internal.maya.dayPlan.planFor, { customerId, now: NOW });
    expect(plan.done).toBe(1);
    expect(plan.outstanding).toHaveLength(0);
    expect(plan.detail).toMatch(/everything planned went out/);
  });

  it("⚠️ dropping requires a REASON — silence is not one", async () => {
    // §12: honest silence beats fake activity. A plan that vanishes with no
    // explanation is indistinguishable from one never made, which is exactly
    // the state this table exists to end.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "noreason");
    const ideaId = await bank(t, customerId, "abandoned");
    const res = await t.mutation(internal.maya.dayPlan.planPost, {
      customerId, ideaId, channel: "x", now: NOW,
    });

    const empty = await t.mutation(internal.maya.dayPlan.dropPlan, {
      planId: res.planId!, reason: "  ", now: NOW,
    });
    expect(empty.dropped).toBe(false);

    const real = await t.mutation(internal.maya.dayPlan.dropPlan, {
      planId: res.planId!, reason: "the niche went quiet, nothing worth answering",
      now: NOW,
    });
    expect(real.dropped).toBe(true);
  });

  it("a dropped plan reports the reason, not just the drop", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "dropped");
    const ideaId = await bank(t, customerId, "shelved for today");
    const res = await t.mutation(internal.maya.dayPlan.planPost, {
      customerId, ideaId, channel: "x", now: NOW,
    });
    await t.mutation(internal.maya.dayPlan.dropPlan, {
      planId: res.planId!, reason: "you asked me to hold off until the launch",
      now: NOW,
    });

    const plan = await t.query(internal.maya.dayPlan.planFor, { customerId, now: NOW });
    expect(plan.detail).toContain("hold off until the launch");
  });

  it("no plan at all is a real answer, not an empty one", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "noplan");
    const plan = await t.query(internal.maya.dayPlan.planFor, { customerId, now: NOW });
    expect(plan.detail).toBe("nothing was planned today");
  });

  it("yesterday's plan doesn't leak into today", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "yesterday");
    const ideaId = await bank(t, customerId, "yesterday's angle");
    await t.mutation(internal.maya.dayPlan.planPost, {
      customerId, ideaId, channel: "x", now: NOW - 86_400_000,
    });

    const today = await t.query(internal.maya.dayPlan.planFor, { customerId, now: NOW });
    expect(today.planned).toBe(0);
  });
});
