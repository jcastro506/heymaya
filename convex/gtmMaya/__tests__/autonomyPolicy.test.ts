import { describe, expect, it } from "vitest";
import {
  autonomyGranted,
  isRampGraduated,
  resolvePublishMode,
  shouldOfferGraduation,
  RAMP_DAYS,
} from "../autonomyPolicy";

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("autonomyGranted", () => {
  it("autonomous → always granted", () => {
    expect(autonomyGranted("autonomous", null, null, NOW)).toBe(true);
  });

  it("confirm_each → never granted", () => {
    expect(autonomyGranted("confirm_each", NOW - 365 * DAY, 999, NOW)).toBe(
      false
    );
  });

  it("undefined / garbage policy → fail-closed to confirm", () => {
    expect(autonomyGranted(undefined, null, null, NOW)).toBe(false);
    expect(autonomyGranted(null, NOW - 365 * DAY, 50, NOW)).toBe(false);
    expect(autonomyGranted("bogus", NOW - 365 * DAY, 50, NOW)).toBe(false);
  });

  describe("confirm_first_week ramp", () => {
    it("not granted before threshold + before the window", () => {
      expect(autonomyGranted("confirm_first_week", NOW - 2 * DAY, 1, NOW)).toBe(
        false
      );
    });
    it("granted once 3 posts confirmed (even within the week)", () => {
      expect(autonomyGranted("confirm_first_week", NOW - 1 * DAY, 3, NOW)).toBe(
        true
      );
    });
    it("granted once the week elapses (even with 0 confirms)", () => {
      expect(
        autonomyGranted("confirm_first_week", NOW - (RAMP_DAYS + 1) * DAY, 0, NOW)
      ).toBe(true);
    });
    it("exactly 7 days elapsed → granted (>= boundary)", () => {
      expect(
        autonomyGranted("confirm_first_week", NOW - RAMP_DAYS * DAY, 0, NOW)
      ).toBe(true);
    });
  });
});

describe("isRampGraduated", () => {
  it("true at 3 confirms or after 7 days, false otherwise", () => {
    expect(isRampGraduated(NOW - 1 * DAY, 3, NOW)).toBe(true);
    expect(isRampGraduated(NOW - 8 * DAY, 0, NOW)).toBe(true);
    expect(isRampGraduated(NOW - 1 * DAY, 2, NOW)).toBe(false);
    expect(isRampGraduated(null, null, NOW)).toBe(false);
  });
});

describe("resolvePublishMode (toggle × ban-safety × founder-confirm)", () => {
  it("ban-safety channel stays confirm regardless of granted toggle", () => {
    // reddit/tiktok come in as manual_confirm; the toggle can NEVER auto them.
    expect(resolvePublishMode("manual_confirm", false, true)).toBe(
      "manual_confirm"
    );
    expect(resolvePublishMode("manual_confirm", false, false)).toBe(
      "manual_confirm"
    );
  });

  it("auto channel tightens to confirm when autonomy NOT granted", () => {
    expect(resolvePublishMode("auto", false, false)).toBe("manual_confirm");
  });

  it("auto channel stays auto when autonomy granted", () => {
    expect(resolvePublishMode("auto", false, true)).toBe("auto");
  });

  it("founder one-tap confirm wins everything (even a ban-safety base)", () => {
    // The human tap IS the express consent — matches the publish engine's
    // founderConfirmed override (TikTok's one-tap = content_preview_confirmed).
    expect(resolvePublishMode("manual_confirm", true, false)).toBe("auto");
    expect(resolvePublishMode("auto", true, false)).toBe("auto");
  });
});

describe("shouldOfferGraduation", () => {
  it("offers only for a graduated confirm_first_week agent", () => {
    expect(shouldOfferGraduation("confirm_first_week", NOW - 8 * DAY, 0, NOW)).toBe(
      true
    );
    // already autonomous → nothing to offer
    expect(shouldOfferGraduation("autonomous", NOW - 8 * DAY, 9, NOW)).toBe(false);
    // confirm_each never auto-offers
    expect(shouldOfferGraduation("confirm_each", NOW - 8 * DAY, 9, NOW)).toBe(
      false
    );
    // not yet graduated
    expect(shouldOfferGraduation("confirm_first_week", NOW - 1 * DAY, 1, NOW)).toBe(
      false
    );
  });
});
