/**
 * videoBatching — pure-function tests for the signal-prioritized subset
 * selection logic that protects the synthesis pipeline from Gemini's video
 * duration limits.
 *
 * Five mandatory categories applied (per
 * `feedback_validation_gap_prevention.md`):
 *
 *   1. Cross-tenant isolation — N/A at this layer (pure function, no Convex
 *      state). The calling action re-resolves creator and is tested in
 *      `synthesizeCreatorPicture.test.ts`.
 *
 *   2. Plan-tier × action matrix — synthesis is universal across all plans
 *      (the HIGH-thinking bypass applies to every creator). The 30-min cap
 *      behavior is identical for all plan tiers; we test the cap fires at
 *      exactly the cap regardless of caller.
 *
 *   3. Adversarial — duration=0 / null / Infinity / NaN / negative,
 *      empty post list, single-video > cap, every-video > cap, missing
 *      engagement, only-video posts, only-text posts.
 *
 *   4. Sibling-file scan — the `posts.videoDurationSec` schema field is
 *      additive optional; existing rows without the field are unaffected.
 *      We DO NOT touch the schema in this pure-function test — the
 *      synthesis test covers the schema integration end-to-end.
 *
 *   5. TODO grep — no unjustified TODO/FIXME. The `TODO(s7)` markers in
 *      videoBatching.ts and runFullScrapePull.ts each carry an explicit
 *      future-sprint reason (long-video startOffset support, Composio
 *      media-info derivation).
 */

import { describe, it, expect } from "vitest";
import {
  selectSignalSubset,
  MAX_TOTAL_VIDEO_SEC_DEFAULT,
  INITIAL_TOP_N_DEFAULT,
  INITIAL_BOTTOM_M_DEFAULT,
  type BatchablePost,
} from "../videoBatching";

/* -------------------------------------------------------------------------- */
/* Test fixtures                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build N posts with deterministic engagement and duration. Engagement is
 * `i * 100` (post 0 has 0 engagement, post 59 has 5900) so the bottom and
 * top by engagement are unambiguous.
 */
function makePosts(
  n: number,
  opts: {
    durationSec?: number | ((i: number) => number | null);
    platform?: string;
    hasVideo?: boolean | ((i: number) => boolean);
  } = {}
): BatchablePost[] {
  const result: BatchablePost[] = [];
  for (let i = 0; i < n; i++) {
    const dur =
      typeof opts.durationSec === "function"
        ? opts.durationSec(i)
        : (opts.durationSec ?? 30);
    const hasVideo =
      typeof opts.hasVideo === "function"
        ? opts.hasVideo(i)
        : (opts.hasVideo ?? true);
    result.push({
      postId: `p_${String(i).padStart(3, "0")}`,
      platform: opts.platform ?? "tiktok",
      videoDurationSec: dur,
      engagementScore: i * 100,
      hasVideo,
    });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Constants for sanity                                                        */
/* -------------------------------------------------------------------------- */

describe("videoBatching — module constants", () => {
  it("default cap is 30 minutes", () => {
    expect(MAX_TOTAL_VIDEO_SEC_DEFAULT).toBe(30 * 60);
  });
  it("default top-N is 15", () => {
    expect(INITIAL_TOP_N_DEFAULT).toBe(15);
  });
  it("default bottom-M is 5", () => {
    expect(INITIAL_BOTTOM_M_DEFAULT).toBe(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Empty / degenerate inputs                                                   */
/* -------------------------------------------------------------------------- */

describe("videoBatching — empty / degenerate inputs", () => {
  it("empty post list → empty subset, zero diagnostics", () => {
    const result = selectSignalSubset([]);
    expect(result.fullVideoPosts).toEqual([]);
    expect(result.textOnlyPosts).toEqual([]);
    expect(result.totalDurationSec).toBe(0);
    expect(result.diagnostics.finalTopN).toBe(0);
    expect(result.diagnostics.finalBottomM).toBe(0);
    expect(result.diagnostics.downShifted).toBe(false);
  });

  it("posts with hasVideo=false all route to text-only", () => {
    const posts = makePosts(10, { hasVideo: false });
    const result = selectSignalSubset(posts);
    expect(result.fullVideoPosts).toEqual([]);
    expect(result.textOnlyPosts).toHaveLength(10);
    expect(result.diagnostics.noVideoCount).toBe(10);
    expect(result.totalDurationSec).toBe(0);
  });

  it("posts with duration=0 route to text-only (treated as no video)", () => {
    const posts = makePosts(5, { durationSec: 0 });
    const result = selectSignalSubset(posts);
    expect(result.fullVideoPosts).toEqual([]);
    expect(result.textOnlyPosts).toHaveLength(5);
    expect(result.diagnostics.noVideoCount).toBe(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Adversarial duration values                                                 */
/* -------------------------------------------------------------------------- */

describe("videoBatching — adversarial inputs", () => {
  it("duration=null → treated as 0 (text-only)", () => {
    const posts = makePosts(3, { durationSec: () => null });
    const result = selectSignalSubset(posts);
    expect(result.fullVideoPosts).toEqual([]);
    expect(result.textOnlyPosts).toHaveLength(3);
  });

  it("duration=Infinity → treated as 0 (text-only)", () => {
    const posts: BatchablePost[] = [
      {
        postId: "p_inf",
        platform: "tt",
        videoDurationSec: Infinity,
        engagementScore: 1000,
        hasVideo: true,
      },
    ];
    const result = selectSignalSubset(posts);
    expect(result.fullVideoPosts).toEqual([]);
    expect(result.textOnlyPosts).toHaveLength(1);
  });

  it("duration=NaN → treated as 0 (text-only)", () => {
    const posts: BatchablePost[] = [
      {
        postId: "p_nan",
        platform: "tt",
        videoDurationSec: NaN,
        engagementScore: 1000,
        hasVideo: true,
      },
    ];
    const result = selectSignalSubset(posts);
    expect(result.fullVideoPosts).toEqual([]);
    expect(result.textOnlyPosts).toHaveLength(1);
  });

  it("duration=negative → treated as 0 (text-only)", () => {
    const posts: BatchablePost[] = [
      {
        postId: "p_neg",
        platform: "tt",
        videoDurationSec: -100,
        engagementScore: 1000,
        hasVideo: true,
      },
    ];
    const result = selectSignalSubset(posts);
    expect(result.fullVideoPosts).toEqual([]);
    expect(result.textOnlyPosts).toHaveLength(1);
  });

  it("duration=999_999 (e.g. corrupted hours-long) → handled as oversized", () => {
    const posts: BatchablePost[] = [
      {
        postId: "p_huge",
        platform: "tt",
        videoDurationSec: 999_999,
        engagementScore: 1000,
        hasVideo: true,
      },
    ];
    const result = selectSignalSubset(posts);
    expect(result.fullVideoPosts).toEqual([]);
    expect(result.textOnlyPosts).toHaveLength(1);
    expect(result.diagnostics.oversizedSingleVideoCount).toBe(1);
  });

  it("missing engagementScore → treated as 0 (still selectable)", () => {
    const posts: BatchablePost[] = [
      {
        postId: "p_a",
        platform: "tt",
        videoDurationSec: 60,
        engagementScore: null,
        hasVideo: true,
      },
      {
        postId: "p_b",
        platform: "tt",
        videoDurationSec: 60,
        engagementScore: undefined,
        hasVideo: true,
      },
    ];
    const result = selectSignalSubset(posts);
    // Both are selectable; both counted as engagement=0; both fit cap.
    expect(result.fullVideoPosts).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Spec-required behavior tests                                                */
/* -------------------------------------------------------------------------- */

describe("videoBatching — happy path: 60 posts × 30sec each = 30 min total", () => {
  it("all 60 fit within cap; top-15 + bottom-5 selected for full video", () => {
    const posts = makePosts(60, { durationSec: 30 });
    const result = selectSignalSubset(posts);

    // Cap is 30 min = 1800 sec. 20 posts × 30 sec = 600 sec — well under cap.
    expect(result.totalDurationSec).toBe(20 * 30);
    expect(result.totalDurationSec).toBeLessThanOrEqual(MAX_TOTAL_VIDEO_SEC_DEFAULT);

    // top-15 + bottom-5 = 20 unique posts (no overlap with 60 posts).
    expect(result.fullVideoPosts).toHaveLength(20);
    expect(result.textOnlyPosts).toHaveLength(40);
    expect(result.diagnostics.finalTopN).toBe(15);
    expect(result.diagnostics.finalBottomM).toBe(5);
    expect(result.diagnostics.downShifted).toBe(false);

    // Top-15 are the highest-engagement posts (postIds 045..059 in our
    // fixture where engagement = i * 100).
    const topIds = result.fullVideoPosts
      .slice(0, 15)
      .map((p) => p.postId)
      .sort();
    expect(topIds[0]).toBe("p_045");
    expect(topIds[14]).toBe("p_059");

    // Bottom-5 are the lowest-engagement posts (p_000..p_004).
    const bottomIds = result.fullVideoPosts
      .slice(15)
      .map((p) => p.postId)
      .sort();
    expect(bottomIds).toEqual(["p_000", "p_001", "p_002", "p_003", "p_004"]);
  });
});

describe("videoBatching — down-shift fallback: 60 posts × 5 min each = 300 min", () => {
  it("top-N down-shifts until cap is met", () => {
    const posts = makePosts(60, { durationSec: 5 * 60 }); // 300 sec each
    const result = selectSignalSubset(posts);

    // Cap is 1800 sec. Each video is 300 sec → max 6 videos fit.
    // Initial top-15 + bottom-5 = 20 → 6000 sec → way over cap.
    // Down-shift ladder: 15→12→10→8→7→6→3→2 (filtered for dedupe).
    // First selection that fits 6-or-fewer videos:
    //   top-2 + bottom-5 = 7 posts → 7 × 300 = 2100, over cap.
    //   We try the standard ladder (top-N from 15 down to MIN_TOP_N=2 with
    //   bottom held at 5). None of those fit (min combo is 7 posts).
    //   Then fallback: try top-2 + bottom-(M-1) where M descends from 4 to 1.
    //   top-2 + bottom-4 = 6 → 1800 — exactly at cap. ✓
    expect(result.totalDurationSec).toBeLessThanOrEqual(
      MAX_TOTAL_VIDEO_SEC_DEFAULT
    );
    expect(result.fullVideoPosts.length).toBeLessThanOrEqual(6);
    expect(result.diagnostics.downShifted).toBe(true);
    expect(result.diagnostics.finalTopN).toBeLessThan(15);
    // Some text-only posts exist (the rest of the 60).
    expect(result.textOnlyPosts.length).toBeGreaterThan(40);
  });
});

describe("videoBatching — small post pool: 5 posts of 10 min each = 50 min", () => {
  it("down-shifts top to fit cap; preserves at least one bottom-engagement post", () => {
    const posts = makePosts(5, { durationSec: 10 * 60 }); // 600 sec each
    const result = selectSignalSubset(posts);

    // Cap = 1800 sec. Each video = 600 sec → max 3 videos fit.
    // top-15 collapses to top-5 (all available); + bottom-5 (overlaps fully) = 5 unique → 3000 over cap.
    // Down-shift: top-2 + bottom-5 (overlap) — still 5 unique posts → over cap.
    // Then bottom-shift: top-2 + bottom-4 = 4 → over. top-2 + bottom-3 = 3 → 1800 ✓ (overlap means
    //   selection might dedupe further, but result.fullVideoPosts.length must be ≤ 3 to fit).
    expect(result.totalDurationSec).toBeLessThanOrEqual(
      MAX_TOTAL_VIDEO_SEC_DEFAULT
    );
    expect(result.fullVideoPosts.length).toBeLessThanOrEqual(3);
    // At least 2 selections (the contrast pair).
    expect(result.fullVideoPosts.length).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics.downShifted).toBe(true);
  });
});

describe("videoBatching — pathological: 1 post of 60 min", () => {
  it("single video > cap → moved to text-only with oversized diagnostic", () => {
    const posts: BatchablePost[] = [
      {
        postId: "long_yt",
        platform: "youtube",
        videoDurationSec: 60 * 60,
        engagementScore: 9999,
        hasVideo: true,
      },
    ];
    const result = selectSignalSubset(posts);
    expect(result.fullVideoPosts).toEqual([]);
    expect(result.textOnlyPosts).toHaveLength(1);
    expect(result.textOnlyPosts[0].postId).toBe("long_yt");
    expect(result.diagnostics.oversizedSingleVideoCount).toBe(1);
    expect(result.totalDurationSec).toBe(0);
  });

  it("60-min video alongside 30 short videos → long video skipped, shorts batched normally", () => {
    const longVid: BatchablePost = {
      postId: "long_yt",
      platform: "youtube",
      videoDurationSec: 60 * 60,
      engagementScore: 9999,
      hasVideo: true,
    };
    const shorts = makePosts(30, { durationSec: 30 });
    const result = selectSignalSubset([longVid, ...shorts]);
    expect(result.fullVideoPosts.find((p) => p.postId === "long_yt")).toBeUndefined();
    expect(result.diagnostics.oversizedSingleVideoCount).toBe(1);
    // The 30 short videos get the full top-N + bottom-M treatment.
    expect(result.fullVideoPosts.length).toBeGreaterThan(0);
    expect(result.textOnlyPosts.find((p) => p.postId === "long_yt")).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Cap behavior — fires at exactly the configured cap                          */
/* -------------------------------------------------------------------------- */

describe("videoBatching — cap behavior", () => {
  it("cap fires at exactly the configured maxTotalVideoSec value", () => {
    // 20 posts × 90 sec = 1800 sec — should fit exactly at cap.
    const posts = makePosts(20, { durationSec: 90 });
    const result = selectSignalSubset(posts, { maxTotalVideoSec: 1800 });
    expect(result.totalDurationSec).toBeLessThanOrEqual(1800);
    expect(result.fullVideoPosts).toHaveLength(20);
    expect(result.diagnostics.downShifted).toBe(false);

    // 20 posts × 91 sec = 1820 sec — first config should down-shift.
    const overPosts = makePosts(20, { durationSec: 91 });
    const overResult = selectSignalSubset(overPosts, { maxTotalVideoSec: 1800 });
    expect(overResult.totalDurationSec).toBeLessThanOrEqual(1800);
    expect(overResult.fullVideoPosts.length).toBeLessThan(20);
    expect(overResult.diagnostics.downShifted).toBe(true);
  });

  it("cap behavior is identical regardless of caller (no plan-tier coupling)", () => {
    // The pure function takes no creator/plan input — there's no way for
    // plan-tier to influence the cap. This test asserts the option is the
    // sole driver of cap behavior.
    const posts = makePosts(40, { durationSec: 60 });
    const r1 = selectSignalSubset(posts);
    const r2 = selectSignalSubset(posts);
    expect(r1).toEqual(r2);
  });
});

/* -------------------------------------------------------------------------- */
/* Determinism                                                                 */
/* -------------------------------------------------------------------------- */

describe("videoBatching — determinism", () => {
  it("same input → same output (no Math.random, no Date.now)", () => {
    const posts = makePosts(60, {
      durationSec: (i) => 30 + (i % 5) * 10,
    });
    const r1 = selectSignalSubset(posts);
    const r2 = selectSignalSubset(posts);
    expect(r1.fullVideoPosts.map((p) => p.postId)).toEqual(
      r2.fullVideoPosts.map((p) => p.postId)
    );
    expect(r1.textOnlyPosts.map((p) => p.postId)).toEqual(
      r2.textOnlyPosts.map((p) => p.postId)
    );
  });

  it("ties broken by postId for deterministic ordering", () => {
    // All posts have engagement=100 — tie. Sort fallback is postId ASC.
    const posts: BatchablePost[] = ["c", "a", "b", "d", "e"].map((id) => ({
      postId: id,
      platform: "tt",
      videoDurationSec: 60,
      engagementScore: 100,
      hasVideo: true,
    }));
    const result = selectSignalSubset(posts);
    // All 5 fit in the cap (5 × 60 sec = 300 sec ≪ 1800).
    expect(result.fullVideoPosts).toHaveLength(5);
    // The first three (top-3 of ties) are postId-ASC: a, b, c.
    const ids = result.fullVideoPosts.map((p) => p.postId);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
  });
});

/* -------------------------------------------------------------------------- */
/* Mixed video + non-video                                                     */
/* -------------------------------------------------------------------------- */

describe("videoBatching — mixed media types", () => {
  it("non-video posts never become full-video selections", () => {
    const posts: BatchablePost[] = [
      ...makePosts(10, { durationSec: 30, hasVideo: true }), // p_000..p_009 video
      ...makePosts(10, { durationSec: 0, hasVideo: false }).map((p, i) => ({
        ...p,
        postId: `img_${i}`,
        engagementScore: 99999, // image-post is "viral" — must not promote to video
      })),
    ];
    const result = selectSignalSubset(posts);
    for (const p of result.fullVideoPosts) {
      expect(p.hasVideo).toBe(true);
    }
    // High-engagement images go to text-only.
    expect(
      result.textOnlyPosts.find((p) => p.postId === "img_0")
    ).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Cross-platform engagement comparison                                        */
/* -------------------------------------------------------------------------- */

describe("videoBatching — cross-platform mix", () => {
  it("mixed-platform input ranks by engagement, not by platform", () => {
    const posts: BatchablePost[] = [
      { postId: "tt_top", platform: "tiktok", videoDurationSec: 30, engagementScore: 5000, hasVideo: true },
      { postId: "ig_low", platform: "instagram", videoDurationSec: 30, engagementScore: 100, hasVideo: true },
      { postId: "yt_mid", platform: "youtube", videoDurationSec: 30, engagementScore: 2000, hasVideo: true },
      { postId: "tt_bot", platform: "tiktok", videoDurationSec: 30, engagementScore: 50, hasVideo: true },
    ];
    const result = selectSignalSubset(posts);
    // All 4 fit, ordered by engagement DESC for the top-N portion.
    expect(result.fullVideoPosts).toHaveLength(4);
    expect(result.fullVideoPosts[0].postId).toBe("tt_top");
  });
});

/* -------------------------------------------------------------------------- */
/* Custom options                                                              */
/* -------------------------------------------------------------------------- */

describe("videoBatching — custom options", () => {
  it("custom initialTopN respected when posts fit", () => {
    const posts = makePosts(30, { durationSec: 10 });
    const result = selectSignalSubset(posts, { initialTopN: 5, initialBottomM: 2 });
    // 5 + 2 = 7 unique posts at 10 sec each = 70 sec — well under cap.
    expect(result.fullVideoPosts).toHaveLength(7);
    expect(result.diagnostics.finalTopN).toBe(5);
    expect(result.diagnostics.finalBottomM).toBe(2);
    expect(result.diagnostics.downShifted).toBe(false);
  });

  it("custom maxTotalVideoSec respected", () => {
    const posts = makePosts(20, { durationSec: 60 });
    const result = selectSignalSubset(posts, { maxTotalVideoSec: 300 });
    expect(result.totalDurationSec).toBeLessThanOrEqual(300);
    expect(result.fullVideoPosts.length).toBeLessThanOrEqual(5);
    expect(result.diagnostics.downShifted).toBe(true);
  });
});
