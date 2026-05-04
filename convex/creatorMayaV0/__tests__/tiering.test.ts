import { describe, expect, it } from "vitest";
import {
  brandAutonomyAllowed,
  creatorMayaTierFeatures,
  requireCreatorMayaFeature,
} from "../tiering";

describe("Creator Maya v0 tiering — coach / manager 2-tier model", () => {
  it("Coach gets every read/advisory feature including calendar scheduling", () => {
    const coach = creatorMayaTierFeatures("coach");

    expect(coach.calendarRead).toBe(true);
    expect(coach.calendarContentHolds).toBe(true);
    expect(coach.dailyImessageBrief).toBe(true);
    expect(coach.weeklyContentPlan).toBe(true);
    expect(coach.commentMining).toBe(true);
    expect(coach.peerWatch).toBe(true);
    expect(coach.mediaKitDraft).toBe(true);
    expect(coach.inboundBrandTriage).toBe(true);
  });

  it("Coach DOES NOT include any autonomous outbound brand work", () => {
    const coach = creatorMayaTierFeatures("coach");
    expect(coach.outboundBrandDiscovery).toBe(false);
    expect(coach.contactEnrichment).toBe(false);
    expect(coach.brandPitchCampaigns).toBe(false);
    expect(coach.brandCallScheduling).toBe(false);
    expect(coach.maxBrandAutonomyLevel).toBe(0);
  });

  it("Manager unlocks all autonomous brand outreach", () => {
    expect(creatorMayaTierFeatures("coach").brandPitchCampaigns).toBe(false);
    expect(creatorMayaTierFeatures("manager").brandPitchCampaigns).toBe(true);
    expect(creatorMayaTierFeatures("manager").outboundBrandDiscovery).toBe(true);
    expect(creatorMayaTierFeatures("manager").contactEnrichment).toBe(true);
    expect(creatorMayaTierFeatures("manager").brandCallScheduling).toBe(true);
  });

  it("caps brand autonomy at level 2 (draft + threshold-gated send) for Manager v0", () => {
    expect(brandAutonomyAllowed("coach", 0)).toBe(true);
    expect(brandAutonomyAllowed("coach", 1)).toBe(false);
    expect(brandAutonomyAllowed("manager", 1)).toBe(true);
    expect(brandAutonomyAllowed("manager", 2)).toBe(true);
    expect(brandAutonomyAllowed("manager", 3)).toBe(false);
  });

  it("fails closed when a tier lacks a feature", () => {
    expect(() =>
      requireCreatorMayaFeature("coach", "outboundBrandDiscovery")
    ).toThrow("tier gate failed");
    expect(() =>
      requireCreatorMayaFeature("manager", "outboundBrandDiscovery")
    ).not.toThrow();
  });
});
