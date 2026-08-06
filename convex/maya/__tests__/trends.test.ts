/**
 * The trend sweep (§5.2 sweep 3).
 *
 * Feeds the half of the loop §14.2.2 closed: at L1 the diagnosis is a FORMAT
 * problem, and idea scoring then prefers evidence of things that demonstrably
 * travelled. This is where that evidence comes from.
 *
 * Most of these tests are about the risk, not the feature: **trending is not
 * the same as relevant.**
 */

import { describe, expect, it } from "vitest";
import { intersectsNiche, TREND_SAMPLE } from "../trends";

const NICHE = ["organic social", "indie founder", "draft reply", "dashboard"];

describe("⭐ TRENDING IS NOT THE SAME AS RELEVANT", () => {
  it("⭐ #AEWDynamite WAS RANK 1 AND IS NOT OURS", () => {
    /**
     * Pulled live 2026-08-05. It is genuinely trending and it means nothing to
     * an indie SaaS founder. Banking it would have her chasing wrestling
     * hashtags — the same failure `learn-business` already hit once, where
     * "engagement" surfaced wedding photographers and "threads" surfaced
     * sewing.
     */
    expect(intersectsNiche("#AEWDynamite", NICHE)).toBe(false);
    expect(intersectsNiche("#広島平和記念", NICHE)).toBe(false);
  });

  it("something in the niche's own words is kept", () => {
    expect(
      intersectsNiche("how I automate my organic social as an indie founder", NICHE)
    ).toBe(true);
  });

  it("⭐ A TWO-LETTER KEYWORD MATCHES EVERYTHING, SO IT MATCHES NOTHING", () => {
    // A niche vocabulary can contain junk. A term that short would let any
    // trending post through, which is the failure this filter exists to stop.
    expect(intersectsNiche("totally unrelated wrestling news", ["ai", "x"])).toBe(false);
  });

  it("matches on a word boundary, not a substring", () => {
    // "dashboard" must not be matched by "dash" inside "dashcam footage".
    expect(intersectsNiche("best dashcam footage of 2026", ["dashboard"])).toBe(false);
    expect(intersectsNiche("my new dashboard", ["dashboard"])).toBe(true);
  });

  it("is case-insensitive, because captions are not", () => {
    expect(intersectsNiche("INDIE FOUNDER life", NICHE)).toBe(true);
  });

  it("an empty niche keeps nothing rather than everything", () => {
    // The dangerous default: a customer whose keywords haven't been worked out
    // yet must not receive the entire trending feed as "evidence".
    expect(intersectsNiche("anything at all", [])).toBe(false);
  });

  it("the sample is bounded — trending feeds are long", () => {
    expect(TREND_SAMPLE).toBeGreaterThan(0);
    expect(TREND_SAMPLE).toBeLessThanOrEqual(100);
  });
});
