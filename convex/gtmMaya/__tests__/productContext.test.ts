/**
 * W1.1 — updateProductContext (post-onboarding product-fact correction).
 *
 * Mandatory categories:
 *  1. Cross-tenant — founder A's edit never touches founder B's app; the
 *     mutation has no appId arg, so it can ONLY target the caller's own app.
 *  3. Adversarial — oversized strings clamped; blank/whitespace edits do not
 *     wipe an existing value; editing with no app fails closed.
 *  (edit round-trip persists to gtmApps and is readable back.)
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

function authedGtm(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
}

async function setupFounder(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{
  authed: ReturnType<typeof authedGtm>;
  appId: Id<"gtmApps">;
}> {
  const authed = authedGtm(t, subject);
  await authed.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {
    channelPreference: "telegram",
    timezone: "America/New_York",
  });
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: subject,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    differentiator: "original differentiator",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  const appId = await t.run(async (ctx) => {
    const app = await ctx.db
      .query("gtmApps")
      .filter((q) => q.eq(q.field("url"), `https://${subject}.test`))
      .first();
    if (!app) throw new Error("test setup: app not found");
    return app._id;
  });
  return { authed, appId };
}

describe("updateProductContext", () => {
  it("round-trips an edit to gtmApps", async () => {
    const t = convexTest(schema, modules);
    const { authed, appId } = await setupFounder(t, "founder_rt");
    await authed.mutation(api.gtmMaya.researchLifecycle.updateProductContext, {
      differentiator: "it's for teams, not solo founders",
      stage: "paid",
      userCountBand: "100-1k",
    });
    const app = await t.run((ctx) => ctx.db.get(appId));
    expect(app?.differentiator).toBe("it's for teams, not solo founders");
    expect(app?.stage).toBe("paid");
    expect(app?.userCountBand).toBe("100-1k");
  });

  it("clamps oversized strings (adversarial)", async () => {
    const t = convexTest(schema, modules);
    const { authed, appId } = await setupFounder(t, "founder_clamp");
    await authed.mutation(api.gtmMaya.researchLifecycle.updateProductContext, {
      differentiator: "x".repeat(5000),
    });
    const app = await t.run((ctx) => ctx.db.get(appId));
    expect((app?.differentiator ?? "").length).toBe(2000);
  });

  it("does not wipe an existing value on a blank/whitespace edit", async () => {
    const t = convexTest(schema, modules);
    const { authed, appId } = await setupFounder(t, "founder_blank");
    await authed.mutation(api.gtmMaya.researchLifecycle.updateProductContext, {
      differentiator: "   ",
    });
    const app = await t.run((ctx) => ctx.db.get(appId));
    expect(app?.differentiator).toBe("original differentiator");
  });

  it("is cross-tenant isolated — A's edit never touches B's app", async () => {
    const t = convexTest(schema, modules);
    const a = await setupFounder(t, "founder_a");
    const b = await setupFounder(t, "founder_b");
    await a.authed.mutation(
      api.gtmMaya.researchLifecycle.updateProductContext,
      { differentiator: "A only" }
    );
    const appA = await t.run((ctx) => ctx.db.get(a.appId));
    const appB = await t.run((ctx) => ctx.db.get(b.appId));
    expect(appA?.differentiator).toBe("A only");
    expect(appB?.differentiator).toBe("original differentiator");
  });

  it("fails closed when the founder has no app yet", async () => {
    const t = convexTest(schema, modules);
    const authed = authedGtm(t, "founder_noapp");
    await authed.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {
      channelPreference: "telegram",
      timezone: "America/New_York",
    });
    await expect(
      authed.mutation(api.gtmMaya.researchLifecycle.updateProductContext, {
        differentiator: "x",
      })
    ).rejects.toThrow(/no app/);
  });
});
