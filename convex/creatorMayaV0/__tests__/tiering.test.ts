import { describe, expect, it } from "vitest";
import {
  brandAutonomyAllowed,
  creatorMayaTierFeatures,
  requireCreatorMayaFeature,
} from "../tiering";

describe("Creator Maya v0 tiering", () => {
  it("keeps calendar scheduling in Starter", () => {
    const starter = creatorMayaTierFeatures("starter");

    expect(starter.calendarRead).toBe(true);
    expect(starter.calendarContentHolds).toBe(true);
    expect(starter.dailyImessageBrief).toBe(true);
    expect(starter.weeklyContentPlan).toBe(true);
  });

  it("does not include outbound brand outreach below Studio", () => {
    expect(creatorMayaTierFeatures("starter").brandPitchCampaigns).toBe(false);
    expect(creatorMayaTierFeatures("pro").brandPitchCampaigns).toBe(false);
    expect(creatorMayaTierFeatures("studio").brandPitchCampaigns).toBe(true);
  });

  it("caps brand autonomy at approval-required send for Studio v0", () => {
    expect(brandAutonomyAllowed("starter", 0)).toBe(true);
    expect(brandAutonomyAllowed("starter", 1)).toBe(false);
    expect(brandAutonomyAllowed("pro", 1)).toBe(true);
    expect(brandAutonomyAllowed("pro", 2)).toBe(false);
    expect(brandAutonomyAllowed("studio", 2)).toBe(true);
    expect(brandAutonomyAllowed("studio", 3)).toBe(false);
  });

  it("fails closed when a tier lacks a feature", () => {
    expect(() =>
      requireCreatorMayaFeature("starter", "outboundBrandDiscovery")
    ).toThrow("tier gate failed");
    expect(() =>
      requireCreatorMayaFeature("studio", "outboundBrandDiscovery")
    ).not.toThrow();
  });
});
