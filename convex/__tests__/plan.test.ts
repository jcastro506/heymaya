/**
 * Plan queries + mutations — Sprint 5 acceptance.
 *
 * Mandatory test categories (per docs/SPRINT_PLAN_V0.md § 10):
 *   1. Cross-tenant: Creator A never reads / mutates Creator B's plans.
 *   2. Plan-tier: weekly content plan reads/mutations are unrestricted
 *      across plans (the *generation* is gated by the model router, not
 *      the read). Documented in convex/plan.ts.
 *   3. Adversarial: unauth → null/[]; mutating a non-existent / wrong-
 *      tenant plan throws cleanly.
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
  opts: { suffix: string; plan: "starter" | "pro" | "studio" }
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
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const r = await asUser(t, "a").query(api.plan.currentPlan, {});
    expect(r).toBeNull();
  });

  it("returns the most recently created plan", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertPlan(t, a, "2026-04-13", NOW - 7 * 86_400_000);
    await insertPlan(t, a, "2026-04-20", NOW);
    const r = await asUser(t, "a").query(api.plan.currentPlan, {});
    expect(r).not.toBeNull();
    expect(r?.weekStartLocal).toBe("2026-04-20");
  });

  it("CROSS-TENANT: A never sees B's plan", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await insertPlan(t, b, "2026-04-20");
    const r = await asUser(t, "a").query(api.plan.currentPlan, {});
    expect(r).toBeNull();
  });

  it("PLAN-TIER: Starter sees their own plan (read is unrestricted)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    await insertPlan(t, a, "2026-04-20");
    const r = await asUser(t, "a").query(api.plan.currentPlan, {});
    expect(r).not.toBeNull();
  });
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
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
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
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await insertPlan(t, b, "2026-04-13");
    await insertPlan(t, b, "2026-04-20");
    const r = await asUser(t, "a").query(api.plan.planHistory, {
      paginationOpts: { numItems: 12, cursor: null },
    });
    expect(r.page).toEqual([]);
  });
});

describe("plan.replanDay / approveDay", () => {
  it("approveDay marks the matching dayOffset as approved", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const planId = await insertPlan(t, a, "2026-04-20", NOW, [
      { dayOffset: 0, status: "draft" },
      { dayOffset: 1, status: "draft" },
    ]);
    await asUser(t, "a").mutation(api.plan.approveDay, {
      planId,
      dayOffset: 1,
    });
    const r = await asUser(t, "a").query(api.plan.currentPlan, {});
    expect(r?.arc[0].status).toBe("draft");
    expect(r?.arc[1].status).toBe("approved");
  });

  it("replanDay resets a previously-approved day back to draft", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
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
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
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
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
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
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const planId = await insertPlan(t, a, "2026-04-20");
    await expect(
      t.mutation(api.plan.approveDay, { planId, dayOffset: 0 })
    ).rejects.toThrow(/not authenticated/i);
  });
});
