/**
 * Plan queries + mutations — REVISED 2026-05-04 for coach / manager.
 *
 * NOTE on naming: "plan" here = a `contentPlans` row (Maya's weekly content
 * plan, generated Sun 4pm). NOT the same word as `creators.plan` (the
 * subscription tier). Don't conflate; this file tests the content-plan
 * surface, while `convex/lib/__tests__/planFeatures.test.ts` and
 * `convex/__tests__/billing.test.ts` test the tier surface.
 *
 * Mandatory test categories (per docs/SPRINT_PLAN_V0.md § 10):
 *   1. Cross-tenant: Creator A never reads / mutates Creator B's plans.
 *   2. Plan-tier × action matrix: content-plan reads + replan/approve
 *      mutations are UNGATED across tiers under the coach/manager model
 *      (both tiers run the same proactive cron set, including the weekly
 *      content plan — the boundary is autonomy on brand work, not what
 *      Maya generates for the creator). Each tier asserted explicitly.
 *   3. Adversarial: unauth → null/[]; mutating a non-existent / wrong-
 *      tenant plan throws cleanly; unknown tier fails closed downstream
 *      (covered in planFeatures.test.ts — sibling).
 *   4. Sibling-file scan + 5. TODO grep: covered repo-wide.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "coach" | "manager" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

async function insertPlan(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  weekStart: string,
  generatedAt: number = NOW,
  arc: Array<{
    dayOffset: number;
    status: "draft" | "approved" | "posted";
  }> = [{ dayOffset: 0, status: "draft" }]
) {
  return await t.run((ctx) =>
    ctx.db.insert("contentPlans", {
      creatorId,
      weekStartLocal: weekStart,
      arc: arc.map((e) => ({
        dayOffset: e.dayOffset,
        platform: "tiktok" as const,
        format: "video",
        hookOptions: ["POV: hook"],
        captionDraft: "draft caption",
        postingTimeLocal: "12:00",
        status: e.status,
      })),
      rationale: `plan ${weekStart}`,
      generatedAt,
    })
  );
}

describe("plan.currentPlan", () => {
  it("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const r = await t.query(api.plan.currentPlan, {});
    expect(r).toBeNull();
  });

  it("returns null when no plans exist (ADVERSARIAL: empty data)", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const r = await asUser(t, "a").query(api.plan.currentPlan, {});
    expect(r).toBeNull();
  });

  it("returns the most recently created plan", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await insertPlan(t, a, "2026-04-13", NOW - 7 * 86_400_000);
    await insertPlan(t, a, "2026-04-20", NOW);
    const r = await asUser(t, "a").query(api.plan.currentPlan, {});
    expect(r).not.toBeNull();
    expect(r?.weekStartLocal).toBe("2026-04-20");
  });

  it("CROSS-TENANT: A never sees B's plan", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    await insertPlan(t, b, "2026-04-20");
    const r = await asUser(t, "a").query(api.plan.currentPlan, {});
    expect(r).toBeNull();
  });

  it.each<["coach" | "manager"]>([["coach"], ["manager"]])(
    "PLAN-TIER × ACTION: %s reads its own currentPlan (content-plan reads UNGATED across both tiers)",
    async (plan) => {
      const t = convexTest(schema, modules);
      const a = await insertCreator(t, { suffix: `a_${plan}`, plan });
      await insertPlan(t, a, "2026-04-20");
      const r = await asUser(t, `a_${plan}`).query(api.plan.currentPlan, {});
      expect(r).not.toBeNull();
      expect(r?.weekStartLocal).toBe("2026-04-20");
    }
  );
});

describe("plan.planHistory", () => {
  it("returns [] when unauthenticated (ADVERSARIAL)", async () => {
    const t = convexTest(schema, modules);
    const r = await t.query(api.plan.planHistory, {
      paginationOpts: { numItems: 12, cursor: null },
    });
    expect(r.page).toEqual([]);
  });

  it("skips the most-recent (current) plan from the first page", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await insertPlan(t, a, "2026-04-13", NOW - 7 * 86_400_000);
    await insertPlan(t, a, "2026-04-20", NOW);
    const r = await asUser(t, "a").query(api.plan.planHistory, {
      paginationOpts: { numItems: 12, cursor: null },
    });
    expect(r.page).toHaveLength(1);
    expect(r.page[0].weekStartLocal).toBe("2026-04-13");
  });

  it("CROSS-TENANT: B's history is invisible to A", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    await insertPlan(t, b, "2026-04-13");
    await insertPlan(t, b, "2026-04-20");
    const r = await asUser(t, "a").query(api.plan.planHistory, {
      paginationOpts: { numItems: 12, cursor: null },
    });
    expect(r.page).toEqual([]);
  });
});

describe("plan.replanDay / approveDay", () => {
  it.each<["coach" | "manager"]>([["coach"], ["manager"]])(
    "PLAN-TIER × ACTION: %s can approveDay on its own plan (mutations UNGATED across both tiers)",
    async (plan) => {
      const t = convexTest(schema, modules);
      const a = await insertCreator(t, { suffix: `apr_${plan}`, plan });
      const planId = await insertPlan(t, a, "2026-04-20", NOW, [
        { dayOffset: 0, status: "draft" },
        { dayOffset: 1, status: "draft" },
      ]);
      await asUser(t, `apr_${plan}`).mutation(api.plan.approveDay, {
        planId,
        dayOffset: 1,
      });
      const r = await asUser(t, `apr_${plan}`).query(api.plan.currentPlan, {});
      expect(r?.arc[0].status).toBe("draft");
      expect(r?.arc[1].status).toBe("approved");
    }
  );

  it("replanDay resets a previously-approved day back to draft", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const planId = await insertPlan(t, a, "2026-04-20", NOW, [
      { dayOffset: 0, status: "approved" },
    ]);
    await asUser(t, "a").mutation(api.plan.replanDay, {
      planId,
      dayOffset: 0,
    });
    const r = await asUser(t, "a").query(api.plan.currentPlan, {});
    expect(r?.arc[0].status).toBe("draft");
  });

  it("CROSS-TENANT: A cannot approve B's plan", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    const bPlan = await insertPlan(t, b, "2026-04-20");
    await expect(
      asUser(t, "a").mutation(api.plan.approveDay, {
        planId: bPlan,
        dayOffset: 0,
      })
    ).rejects.toThrow(/does not belong/i);
  });

  it("ADVERSARIAL: replanDay on a deleted plan throws cleanly", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const planId = await insertPlan(t, a, "2026-04-20");
    await t.run((ctx) => ctx.db.delete(planId));
    await expect(
      asUser(t, "a").mutation(api.plan.replanDay, {
        planId,
        dayOffset: 0,
      })
    ).rejects.toThrow(/not found/i);
  });

  it("ADVERSARIAL: unauthenticated mutation throws", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    const planId = await insertPlan(t, a, "2026-04-20");
    await expect(
      t.mutation(api.plan.approveDay, { planId, dayOffset: 0 })
    ).rejects.toThrow(/not authenticated/i);
  });
});
