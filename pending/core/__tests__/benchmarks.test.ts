/**
 * Niche benchmarks (§16.3) — "is 4.1% good? Nobody knows. Context is the
 * product."
 *
 * The arithmetic is the easy half. What's asserted here is the three ways a
 * benchmark lies — too few posts, one loud creator, and stale — because a
 * confident median drawn from noise is worse than no column at all.
 */

import { describe, expect, it } from "vitest";
import { compareToNiche, computeBenchmarks, median, type NichePost } from "../benchmarks";
import { MIN_AUTHOR_DIVERSITY, MIN_SAMPLE_SIZE } from "../quality";

const post = (over: Partial<NichePost> = {}): NichePost => ({
  channel: "tiktok",
  views: 100,
  engagements: 5,
  authorHandle: `a${Math.random()}`,
  ...over,
});

describe("median", () => {
  it("takes the middle, and averages the two middles when even", () => {
    expect(median([1, 5, 3])).toBe(3);
    expect(median([10, 20])).toBe(15);
    expect(median([])).toBe(0);
  });

  /**
   * ⭐ Median, never mean. The real corpus contains a post at 6.5M views —
   * a mean would drag the benchmark so far that every customer looks like
   * they're failing.
   */
  it("is unmoved by one viral outlier", () => {
    const normal = [100, 120, 90, 110, 95];
    expect(median([...normal, 6_500_000])).toBeLessThan(200);
  });
});

describe("computeBenchmarks", () => {
  it("reports a usable benchmark with enough diverse posts", () => {
    const posts = Array.from({ length: 12 }, () => post({ views: 500 }));
    const [tiktok] = computeBenchmarks(posts);
    expect(tiktok.usable).toBe(true);
    expect(tiktok.medianViews).toBe(500);
    expect(tiktok.posts).toBe(12);
  });

  it("refuses below the sample floor rather than quoting a number", () => {
    // A median of three is noise wearing a number's clothes.
    const posts = Array.from({ length: 3 }, () => post());
    const [tiktok] = computeBenchmarks(posts);
    expect(tiktok.usable).toBe(false);
    expect(tiktok.unusableReason).toContain("3 posts");
    expect(MIN_SAMPLE_SIZE.benchmark).toBeGreaterThan(3);
  });

  /**
   * ⭐ "A sweep that reads one account twenty times has not surveyed a niche."
   * Enough posts, too few people — the median describes that person.
   */
  it("refuses a monoculture even with plenty of posts", () => {
    const posts = Array.from({ length: 20 }, () =>
      post({ authorHandle: "@oneloudcreator" })
    );
    const [tiktok] = computeBenchmarks(posts);
    expect(tiktok.posts).toBe(20);
    expect(tiktok.usable).toBe(false);
    expect(tiktok.unusableReason).toMatch(/too few people/i);
    expect(tiktok.authorDiversity).toBeLessThan(MIN_AUTHOR_DIVERSITY);
  });

  it("separates channels — they are not comparable", () => {
    const out = computeBenchmarks([
      ...Array.from({ length: 10 }, () => post({ channel: "tiktok", views: 400 })),
      ...Array.from({ length: 10 }, () => post({ channel: "x", views: 40 })),
    ]);
    expect(out.map((c) => c.channel).sort()).toEqual(["tiktok", "x"]);
    expect(out.find((c) => c.channel === "tiktok")?.medianViews).toBe(400);
  });

  it("returns a null engagement rate rather than dividing by zero", () => {
    // A post with no view count can't produce a rate, and 0% would read as
    // "nobody engaged" rather than "we don't know".
    const posts = Array.from({ length: 10 }, () => post({ views: 0, engagements: 3 }));
    expect(computeBenchmarks(posts)[0].medianEngagementRate).toBeNull();
  });
});

describe("compareToNiche", () => {
  it("names above and below with the multiple", () => {
    expect(compareToNiche(3000, 1000).verdict).toBe("above");
    expect(compareToNiche(3000, 1000).detail).toContain("3.0×");
    expect(compareToNiche(200, 1000).verdict).toBe("below");
    expect(compareToNiche(200, 1000).detail).toContain("80%");
  });

  /**
   * ⚠️ A ±20% band counts as "at". Without it, a post 3% under the median
   * reads as underperforming — noise presented as a finding, and the fastest
   * way to make a founder stop trusting the column.
   */
  it("treats near-median as at-median", () => {
    expect(compareToNiche(970, 1000).verdict).toBe("at");
    expect(compareToNiche(1150, 1000).verdict).toBe("at");
  });

  it("says so when there is nothing to compare against", () => {
    const out = compareToNiche(500, 0);
    expect(out.verdict).toBe("at");
    expect(out.detail).toMatch(/no niche number/i);
  });
});
