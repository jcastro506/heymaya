/**
 * Onboarding's Connect step shows Instagram's switch-to-Creator steps before anything is connected
 * (it can't know their account type yet), from the same one definition the Analytics screen uses.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { setupAdvice } from "../setup";

describe("setup advice for onboarding", () => {
  it("the query is the one definition: Instagram personal needs the switch, with steps; nothing to do for creator", async () => {
    const t = convexTest(schema, modules);
    const ig = await t.query(api.account.setup.advice, { platform: "instagram", accountType: "personal" });
    expect(ig).toEqual(setupAdvice("instagram", "personal"));
    expect(ig?.needed).toBe(true);
    expect(ig?.steps.length).toBeGreaterThanOrEqual(3);
    expect(await t.query(api.account.setup.advice, { platform: "instagram", accountType: "creator" })).toBeNull();
    expect((await t.query(api.account.setup.advice, { platform: "tiktok", accountType: "business" }))?.needed, "TikTok stays personal; business is optional advice, never a blocker").toBe(false);
  });

  it("Connect shows the hint on Instagram and opens the steps when Instagram didn't attach", () => {
    const src = readFileSync(new URL("../../../apps/ios/Maya/Features/Onboarding/OnboardingFlow.swift", import.meta.url), "utf8");
    expect(src).toMatch(/Live<AccountSetup\?>\("account\/setup:advice", args: \["platform": "instagram", "accountType": "personal"\]\)/);
    expect(src).toMatch(/Needs a Creator account/);
    expect(src).toMatch(/Instagram didn't connect\. It needs a Creator account first/);
    expect(src).toMatch(/AccountSetupSheet\(platform: "instagram", setup: setup\)/);
  });
});
