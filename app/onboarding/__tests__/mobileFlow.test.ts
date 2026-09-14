import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../start/page.tsx", import.meta.url), "utf8");
const onboardingMutationSource = readFileSync(new URL("../../../convex/onboarding/start.ts", import.meta.url), "utf8");

describe("creator mobile onboarding contract", () => {
  it("has five steps, Zernio account connections, and the two completion exits", () => {
    expect(source).toContain("step ${step} of 5");
    expect(source).toContain("api.connections.zernio.startConnect");
    expect(source).toContain("Open Messages");
    expect(source).toContain("Open Mission Control");
  });

  it("does not offer deferred product surfaces in onboarding", () => {
    expect(source).not.toMatch(/youtube/i);
    expect(source).not.toMatch(/telegram/i);
    expect(source).not.toMatch(/apple calendar/i);
    expect(source).not.toMatch(/app store|download the app/i);
  });

  it("allows inspiration and calendar to be skipped without fake data", () => {
    expect(source).toContain("Find some for me later");
    expect(source).toContain("Skip for now");
    expect(source).toContain("I don’t have strong suggestions yet");
  });

  it("requires explicit messaging consent in both the screen and the server mutation", () => {
    expect(source).toContain('consent: true');
    expect(onboardingMutationSource).toContain('consent: v.literal(true)');
    expect(onboardingMutationSource).toContain('messageConsentAt: now');
  });
});
