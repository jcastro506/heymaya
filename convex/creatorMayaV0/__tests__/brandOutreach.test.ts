import { describe, expect, it } from "vitest";
import { canSendBrandOutreach, scoreBrandFit } from "../brandOutreach";

describe("Creator Maya v0 brand outreach architecture", () => {
  it("scores brand fit from audience, content, timing, and values", () => {
    const fit = scoreBrandFit({
      brandId: "brand_1",
      brandName: "DeskKit",
      category: "workspace gear",
      contactProvenance: "brand website press page",
      audienceFit: 0.9,
      contentFit: 0.85,
      timingFit: 0.6,
      valuesFit: 0.8,
    });

    expect(fit.score).toBeGreaterThan(0.8);
    expect(fit.reasons).toContain("audience fit is strong");
    expect(fit.needsContactResearch).toBe(false);
  });

  it("requires Studio, approval, contact provenance, and suppression checks before send", () => {
    const allowed = {
      tier: "studio" as const,
      requestedAutonomyLevel: 2 as const,
      creatorApproved: true,
      contactHasProvenance: true,
      suppressed: false,
    };

    expect(canSendBrandOutreach(allowed)).toBe(true);
    expect(canSendBrandOutreach({ ...allowed, creatorApproved: false })).toBe(
      false
    );
    expect(canSendBrandOutreach({ ...allowed, contactHasProvenance: false })).toBe(
      false
    );
    expect(canSendBrandOutreach({ ...allowed, suppressed: true })).toBe(false);
    expect(canSendBrandOutreach({ ...allowed, requestedAutonomyLevel: 3 })).toBe(
      false
    );
  });

  it("blocks outbound brand sends below Studio", () => {
    expect(() =>
      canSendBrandOutreach({
        tier: "pro",
        requestedAutonomyLevel: 1,
        creatorApproved: true,
        contactHasProvenance: true,
        suppressed: false,
      })
    ).toThrow("tier gate failed");
  });
});
