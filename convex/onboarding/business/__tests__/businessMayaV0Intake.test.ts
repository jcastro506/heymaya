import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";

function asUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({
    subject,
    email: `${subject}@example.com`,
  });
}

describe("Business Maya v0 intake", () => {
  it("persists broad business marketing context after account setup", async () => {
    const t = convexTest(schema, modules);
    const user = asUser(t, "business-v0");

    const start = await user.action(
      api.onboarding.business.pipeline.startServiceOnboarding,
      { timezone: "America/New_York" }
    );
    await user.action(api.onboarding.business.pipeline.recordOnboardingStep, {
      step: "name",
      payload: { name: "Founder's Gym" },
    });
    await user.action(api.onboarding.business.pipeline.saveBusinessMayaV0Intake, {
      businessType: "creator-led business",
      offer: "fitness templates and coaching",
      targetCustomer: "busy founders who want simple strength plans",
      market: "United States",
      topMarketingGoal: "turn TikTok attention into paid template sales",
      channels: ["TikTok", "Email"],
      phoneNumber: "+15555550123",
      timezone: "America/New_York",
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("businessMayaV0Intake")
        .withIndex("by_business", (q) => q.eq("businessId", start.businessId))
        .first()
    );

    expect(row?.offer).toBe("fitness templates and coaching");
    expect(row?.targetCustomer).toContain("busy founders");
    expect(row?.topMarketingGoal).toContain("paid template sales");
    expect(row?.channels).toEqual(["TikTok", "Email"]);
    expect(row?.phoneNumber).toBe("+15555550123");
  });

  it("rejects incomplete intake before Maya can use it", async () => {
    const t = convexTest(schema, modules);
    const user = asUser(t, "business-v0-empty");
    await user.action(api.onboarding.business.pipeline.startServiceOnboarding, {
      timezone: "America/New_York",
    });

    await expect(
      user.action(api.onboarding.business.pipeline.saveBusinessMayaV0Intake, {
        businessType: "local service business",
        offer: "",
        targetCustomer: "homeowners",
        topMarketingGoal: "more estimate calls",
        channels: ["Google Business Profile"],
        timezone: "America/New_York",
      })
    ).rejects.toThrow("offer is required");
  });
});
