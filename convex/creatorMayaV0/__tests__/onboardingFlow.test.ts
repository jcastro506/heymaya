import { describe, expect, it } from "vitest";
import {
  canDeployCreatorMaya,
  nextOnboardingStep,
  onboardingProgressPercent,
  type CreatorMayaOnboardingState,
} from "../onboardingFlow";

const complete: CreatorMayaOnboardingState = {
  signedUp: true,
  tiktokConnected: true,
  metadataPulled: true,
  videoSamplesAnalyzed: true,
  calendarConnected: true,
  interviewComplete: true,
  readbackConfirmed: true,
  creatorPictureReady: true,
  imessagePaired: true,
  mayaDeployed: true,
};

describe("Creator Maya v0 onboarding flow", () => {
  it("orders onboarding around creator-first TikTok, calendar, and iMessage requirements", () => {
    expect(nextOnboardingStep({ ...complete, signedUp: false })).toBe("signup");
    expect(nextOnboardingStep({ ...complete, tiktokConnected: false })).toBe(
      "connect_tiktok"
    );
    expect(nextOnboardingStep({ ...complete, metadataPulled: false })).toBe(
      "pull_metadata"
    );
    expect(nextOnboardingStep({ ...complete, videoSamplesAnalyzed: false })).toBe(
      "sample_videos"
    );
    expect(nextOnboardingStep({ ...complete, calendarConnected: false })).toBe(
      "connect_calendar"
    );
    expect(nextOnboardingStep({ ...complete, imessagePaired: false })).toBe(
      "pair_imessage"
    );
    expect(nextOnboardingStep({ ...complete, readbackConfirmed: false })).toBe(
      "maya_readback"
    );
  });

  it("does not allow deploy until calendar, creator picture, and iMessage are ready", () => {
    expect(canDeployCreatorMaya({ ...complete, calendarConnected: false })).toBe(
      false
    );
    expect(canDeployCreatorMaya({ ...complete, imessagePaired: false })).toBe(
      false
    );
    expect(canDeployCreatorMaya({ ...complete, readbackConfirmed: false })).toBe(
      false
    );
    expect(canDeployCreatorMaya({ ...complete, mayaDeployed: false })).toBe(true);
    expect(canDeployCreatorMaya(complete)).toBe(false);
  });

  it("reports active as 100 percent complete", () => {
    expect(onboardingProgressPercent(complete)).toBe(100);
    expect(
      onboardingProgressPercent({ ...complete, metadataPulled: false })
    ).toBeLessThan(100);
  });
});
