import { describe, expect, it } from "vitest";
import {
  canRecommendVisualChannels,
  evaluateVisualProductionFit,
} from "../productionReality";

describe("GTM visual production reality", () => {
  it("recommends slideshow/carousel when screenshots and manual posting exist", () => {
    const fits = evaluateVisualProductionFit({
      canRecordScreen: false,
      canShowFace: false,
      canRecordVoice: false,
      canProvideScreenshots: true,
      canPostTikTokManually: true,
      canPostInstagramManually: true,
      openToUgcCreators: false,
      maxWeeklyVisualPosts: 3,
    });

    expect(fits.find((fit) => fit.channel === "tiktok")?.viable).toBe(true);
    expect(fits.find((fit) => fit.channel === "instagram")?.paths).toContain(
      "slideshow_carousel"
    );
  });

  it("parks visual channels when the user cannot post or provide visual assets", () => {
    const input = {
      canRecordScreen: false,
      canShowFace: false,
      canRecordVoice: false,
      canProvideScreenshots: false,
      canPostTikTokManually: false,
      canPostInstagramManually: false,
      openToUgcCreators: false,
      maxWeeklyVisualPosts: 0,
    };

    const fits = evaluateVisualProductionFit(input);

    expect(canRecommendVisualChannels(input)).toBe(false);
    expect(fits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "tiktok",
          viable: false,
          paths: ["park_visual_channels"],
        }),
        expect.objectContaining({
          channel: "instagram",
          viable: false,
          paths: ["park_visual_channels"],
        }),
      ])
    );
  });

  it("keeps UGC as a later scale path, not a substitute for V1 posting", () => {
    const fits = evaluateVisualProductionFit({
      canRecordScreen: false,
      canShowFace: false,
      canRecordVoice: false,
      canProvideScreenshots: false,
      canPostTikTokManually: false,
      canPostInstagramManually: true,
      openToUgcCreators: true,
      creatorBudgetMonthlyUsd: 500,
      maxWeeklyVisualPosts: 0,
    });

    const instagram = fits.find((fit) => fit.channel === "instagram");

    expect(instagram?.viable).toBe(false);
    expect(instagram?.paths).toEqual(["park_visual_channels"]);
    expect(instagram?.rationale.join(" ")).toContain("paid UGC");
  });
});
