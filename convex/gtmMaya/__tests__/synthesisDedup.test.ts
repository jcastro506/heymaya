import { describe, expect, it } from "vitest";
import { isDuplicateOnboardingSynthesis } from "../agentLifecycle";

const T = 1_000;

describe("isDuplicateOnboardingSynthesis (§6 item 1 — send synthesis once)", () => {
  it("first strategic send (not yet delivered) is allowed", () => {
    expect(isDuplicateOnboardingSynthesis("strategic", null, null)).toBe(false);
    expect(isDuplicateOnboardingSynthesis("strategic", undefined, undefined)).toBe(
      false
    );
  });

  it("a SECOND strategic send during onboarding is suppressed", () => {
    // delivered already + onboarding not complete → duplicate synthesis
    expect(isDuplicateOnboardingSynthesis("strategic", T, null)).toBe(true);
    expect(isDuplicateOnboardingSynthesis("strategic", T, undefined)).toBe(true);
  });

  it("post-onboarding strategic sends are NOT suppressed (weekly review)", () => {
    // delivered + onboarding complete → legit later strategic message
    expect(isDuplicateOnboardingSynthesis("strategic", T, T + 1)).toBe(false);
  });

  it("non-strategic messages are never suppressed", () => {
    expect(isDuplicateOnboardingSynthesis("tactical", T, null)).toBe(false);
    expect(isDuplicateOnboardingSynthesis("accountability", T, null)).toBe(false);
  });
});
