/**
 * W1.2 — updateProductFact (the agent-context twin of updateProductContext,
 * hit by the `update_product_fact` OpenClaw tool via /lc_gtm/update_product_fact).
 *
 *  1. Cross-tenant — patching with A's {accountId, agentId} only ever touches
 *     A's app; B's is untouched. The mutation re-derives the app from the
 *     agent and asserts app.accountId === accountId (fail-closed).
 *  3. Adversarial — oversized strings clamped; mismatched account/agent throws.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

async function setupFounder(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{
  accountId: Id<"creators">;
  agentId: Id<"gtmAgents">;
  appId: Id<"gtmApps">;
}> {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: subject,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    differentiator: "original",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  const appId = await t.run(async (ctx) => {
    const app = await ctx.db
      .query("gtmApps")
      .filter((q) => q.eq(q.field("url"), `https://${subject}.test`))
      .first();
    if (!app) throw new Error("setup: no app");
    return app._id;
  });
  return { accountId: started.accountId, agentId: started.agentId, appId };
}

describe("updateProductFact (agent tool path)", () => {
  it("persists a chat correction to gtmApps", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId, appId } = await setupFounder(t, "fact_rt");
    await t.mutation(internal.gtmMaya.managerStore.updateProductFact, {
      accountId,
      agentId,
      differentiator: "it's for teams, not solos",
      userCountBand: "1k+",
    });
    const app = await t.run((ctx) => ctx.db.get(appId));
    expect(app?.differentiator).toBe("it's for teams, not solos");
    expect(app?.userCountBand).toBe("1k+");
  });

  it("clamps oversized strings", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId, appId } = await setupFounder(t, "fact_clamp");
    await t.mutation(internal.gtmMaya.managerStore.updateProductFact, {
      accountId,
      agentId,
      founderWhy: "y".repeat(5000),
    });
    const app = await t.run((ctx) => ctx.db.get(appId));
    expect((app?.founderWhy ?? "").length).toBe(2000);
  });

  it("is cross-tenant isolated — A's args never touch B's app", async () => {
    const t = convexTest(schema, modules);
    const a = await setupFounder(t, "fact_a");
    const b = await setupFounder(t, "fact_b");
    await t.mutation(internal.gtmMaya.managerStore.updateProductFact, {
      accountId: a.accountId,
      agentId: a.agentId,
      differentiator: "A only",
    });
    const appA = await t.run((ctx) => ctx.db.get(a.appId));
    const appB = await t.run((ctx) => ctx.db.get(b.appId));
    expect(appA?.differentiator).toBe("A only");
    expect(appB?.differentiator).toBe("original");
  });

  it("fails closed on mismatched account/agent (cross-tenant attack)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupFounder(t, "fact_atk_a");
    const b = await setupFounder(t, "fact_atk_b");
    // A's account paired with B's agent must be rejected.
    await expect(
      t.mutation(internal.gtmMaya.managerStore.updateProductFact, {
        accountId: a.accountId,
        agentId: b.agentId,
        differentiator: "hijack",
      })
    ).rejects.toThrow();
    const appB = await t.run((ctx) => ctx.db.get(b.appId));
    expect(appB?.differentiator).toBe("original");
  });
});
