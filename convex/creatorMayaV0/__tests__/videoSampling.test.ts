import { describe, expect, it } from "vitest";
import {
  chooseWatchMode,
  selectOnboardingVideoSamples,
  type SampleReason,
  type TikTokPostCandidate,
} from "../videoSampling";

function post(
  i: number,
  overrides: Partial<TikTokPostCandidate> = {}
): TikTokPostCandidate {
  return {
    id: `post_${i}`,
    createdAt: 1_700_000_000_000 + i * 60_000,
    durationSec: 24,
    hasVideo: true,
    caption: `caption ${i}`,
    formatKey: i === 5 ? "green-screen-rant" : "talking-head",
    metrics: {
      views: i * 100,
      likes: i * 10,
      comments: i,
      shares: i,
    },
    ...overrides,
  };
}

describe("Creator Maya v0 onboarding video sampling", () => {
  it("selects at most 8 posts from the 30-post metadata pool", () => {
    const result = selectOnboardingVideoSamples(
      Array.from({ length: 30 }, (_, i) => post(i))
    );

    expect(result.selected.length).toBeLessThanOrEqual(8);
    expect(result.diagnostics.fullVideoCount).toBe(0);
  });

  it("includes top performers, weak performers, recent posts, and a format outlier", () => {
    const result = selectOnboardingVideoSamples(
      Array.from({ length: 12 }, (_, i) => post(i))
    );

    const byReason = (reason: SampleReason) =>
      result.selected.filter((sample) => sample.reasons.includes(reason));

    expect(byReason("top").map((s) => s.post.id)).toContain("post_11");
    expect(byReason("weak").map((s) => s.post.id)).toEqual(
      expect.arrayContaining(["post_0", "post_1"])
    );
    expect(byReason("recent").map((s) => s.post.id)).toEqual(
      expect.arrayContaining(["post_11", "post_10"])
    );
    expect(byReason("format_outlier").map((s) => s.post.formatKey)).toContain(
      "green-screen-rant"
    );
  });

  it("degrades cleanly when the creator has fewer than 8 posts", () => {
    const result = selectOnboardingVideoSamples([post(0), post(1), post(2)]);

    expect(result.selected).toHaveLength(3);
    expect(new Set(result.selected.map((s) => s.post.id)).size).toBe(3);
  });

  it("does not full-watch onboarding videos unless explicitly allowed", () => {
    const result = selectOnboardingVideoSamples(
      Array.from({ length: 10 }, (_, i) => post(i, { durationSec: 12 }))
    );

    expect(result.selected.every((s) => s.watchMode !== "full_video")).toBe(true);
  });

  it("chooses the cheapest sufficient watch mode", () => {
    expect(chooseWatchMode(post(1, { hasVideo: false }))).toBe("metadata_only");
    expect(chooseWatchMode(post(1, { durationSec: 25 }))).toBe("first_3_seconds");
    expect(chooseWatchMode(post(1, { durationSec: 90 }))).toBe("sampled_frames");
    expect(
      chooseWatchMode(post(1, { durationSec: 20 }), { allowFullVideo: true })
    ).toBe("full_video");
  });
});
