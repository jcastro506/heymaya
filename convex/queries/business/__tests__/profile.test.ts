/**
 * Service-business Profile / Approval rules / Connections / Billing —
 * 5 mandatory categories with explicit plan-tier × ruleType matrix
 * (mirrors the server-side plan helper).
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function seed(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: "starter" | "pro" | "studio";
  }
): Promise<{ accountId: Id<"creators">; businessId: Id<"businesses"> }> {
  const accountId = (await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      accountType: "service-business",
      createdAt: NOW,
    })
  )) as Id<"creators">;
  const businessId = (await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId,
      name: `${opts.suffix} biz`,
      serviceTypes: ["plumbing"],
      planTier: opts.plan,
      createdAt: NOW,
      updatedAt: NOW,
    })
  )) as Id<"businesses">;
  await t.run((ctx) => ctx.db.patch(accountId, { businessId }));
  return { accountId, businessId };
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

describe("queries.business.profile.getProfile", () => {
  it("returns null when unauth", async () => {
    const t = convexTest(schema, modules);
    const out = await t.query(api.queries.business.profile.getProfile, {});
    expect(out).toBeNull();
  });

  it("returns profile + features matrix for the operator", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { suffix: "a", plan: "pro" });
    const out = await asUser(t, "a").query(
      api.queries.business.profile.getProfile,
      {}
    );
    expect(out).not.toBeNull();
    expect(out!.features.plan).toBe("pro");
    expect(out!.features.crmIntegration).toBe(true);
  });
});

describe("queries.business.profile.getApprovalRules — plan-tier matrix", () => {
  it("STARTER: enableable is empty (every action operator-approved)", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { suffix: "starter", plan: "starter" });
    const out = await asUser(t, "starter").query(
      api.queries.business.profile.getApprovalRules,
      {}
    );
    expect(out!.enableable).toEqual([]);
    expect(out!.forbiddenAtAllTiers).toContain(
      "review-reply-auto-publish-allowlist"
    );
    expect(out!.plan).toBe("starter");
  });

  it("PRO: enableable contains review-request + gbp-post; never review-reply", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { suffix: "pro", plan: "pro" });
    const out = await asUser(t, "pro").query(
      api.queries.business.profile.getApprovalRules,
      {}
    );
    expect(out!.enableable).toContain("review-request-auto-send");
    expect(out!.enableable).toContain("gbp-post-auto-publish");
    expect(out!.enableable).not.toContain(
      "review-reply-auto-publish-allowlist"
    );
    expect(out!.enableable).not.toContain(
      "content-rejuvenation-auto-publish"
    );
  });

  it("STUDIO: adds content-rejuvenation; review-reply still forbidden", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { suffix: "studio", plan: "studio" });
    const out = await asUser(t, "studio").query(
      api.queries.business.profile.getApprovalRules,
      {}
    );
    expect(out!.enableable).toContain("content-rejuvenation-auto-publish");
    expect(out!.enableable).not.toContain(
      "review-reply-auto-publish-allowlist"
    );
  });

  it("CROSS-TENANT: business B's rules never surface for business A", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, { suffix: "a", plan: "pro" });
    await seed(t, { suffix: "b", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("approvalRules", {
        businessId: a.businessId,
        ruleType: "review-request-auto-send",
        enabled: true,
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const out = await asUser(t, "b").query(
      api.queries.business.profile.getApprovalRules,
      {}
    );
    expect(out!.rules).toEqual([]);
  });
});

describe("queries.business.profile.getConnections", () => {
  it("ADVERSARIAL: returns null for unauth", async () => {
    const t = convexTest(schema, modules);
    const out = await t.query(api.queries.business.profile.getConnections, {});
    expect(out).toBeNull();
  });

  it("surfaces canConnectVoice = true on Studio, false on Starter", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { suffix: "starter", plan: "starter" });
    const starter = await asUser(t, "starter").query(
      api.queries.business.profile.getConnections,
      {}
    );
    expect(starter!.canConnectVoice).toBe(false);

    await seed(t, { suffix: "studio", plan: "studio" });
    const studio = await asUser(t, "studio").query(
      api.queries.business.profile.getConnections,
      {}
    );
    expect(studio!.canConnectVoice).toBe(true);
  });
});

describe("queries.business.profile.getBilling", () => {
  it("voice block reflects plan-tier inclusion", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { suffix: "studio", plan: "studio" });
    const out = await asUser(t, "studio").query(
      api.queries.business.profile.getBilling,
      {}
    );
    expect(out!.voice.minutesIncluded).toBe(100);
    expect(out!.voice.hardCap).toBe(500);
    expect(out!.plan).toBe("studio");
  });

  it("ADVERSARIAL: starter shows zero inclusion + null hardCap", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { suffix: "starter", plan: "starter" });
    const out = await asUser(t, "starter").query(
      api.queries.business.profile.getBilling,
      {}
    );
    expect(out!.voice.minutesIncluded).toBe(0);
    expect(out!.voice.hardCap).toBeNull();
  });
});
