/**
 * `review-strategy` (§16.75.05) — "does anything change this week? Default: no."
 *
 * The interesting assertions are all about REFUSING to change. §16.75.05:
 * *"Thrashing is worse than staleness. A strategy that changes weekly isn't a
 * strategy."* A system that finds a reason to act every week is the failure
 * mode, not the feature.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_WEEKS_FOR_METRIC,
  RUNG_STUCK_WEEKS,
  checkFeasibility,
  meetsChangeBar,
} from "../strategy";

describe("meetsChangeBar — the default is no", () => {
  it("refuses when nothing moved", () => {
    const out = meetsChangeBar({ rungHistory: [null, null] });
    expect(out.change).toBe(false);
    expect(out.trigger).toBe("no_change");
  });

  /**
   * ⭐ The most tempting trigger and the one most likely to be noise.
   * §16.75.05 sets the floor at two weeks precisely because a single week
   * always has a story.
   */
  it("refuses a metric that moved for only one week", () => {
    const out = meetsChangeBar({
      rungHistory: [null, null],
      metricMoved: { name: "saves", detail: "saves up 40%", weeks: 1 },
    });
    expect(out.change).toBe(false);
    expect(out.because).toMatch(/only for 1 week/i);
    expect(MIN_WEEKS_FOR_METRIC).toBe(2);
  });

  it("acts on a metric that held for two", () => {
    const out = meetsChangeBar({
      rungHistory: [null, null],
      metricMoved: { name: "saves", detail: "saves up 40%", weeks: 2 },
    });
    expect(out.change).toBe(true);
    expect(out.trigger).toBe("metric_moved");
  });

  it("acts when the SAME rung is stuck", () => {
    const out = meetsChangeBar({ rungHistory: ["L1", "L1"] });
    expect(out.change).toBe(true);
    expect(out.trigger).toBe("rung_stuck");
    expect(out.because).toContain(`${RUNG_STUCK_WEEKS} weeks running`);
  });

  /**
   * ⚠️ Alternating breaks are noise. Treating them as a trigger is how a
   * strategy changes every week — which §16.75.05 says is not a strategy.
   */
  it("refuses when the broken rung keeps moving", () => {
    expect(meetsChangeBar({ rungHistory: ["L1", "L2"] }).change).toBe(false);
    expect(meetsChangeBar({ rungHistory: [null, "L1"] }).change).toBe(false);
  });

  /**
   * ⭐ Precedence, not preference. The founder knows things the rows don't, and
   * a system weighing its own measurements above the person paying for it is
   * the wrong shape regardless of who turns out to be right.
   */
  it("puts the founder above every metric", () => {
    const out = meetsChangeBar({
      rungHistory: ["L1", "L1"],
      metricMoved: { name: "saves", detail: "saves up", weeks: 4 },
      founderSaid: "stop posting threads",
    });
    expect(out.trigger).toBe("founder_said");
    expect(out.because).toContain("stop posting threads");
  });

  it("always carries a because", () => {
    // A change with no number behind it is a vibe, and the changelog's whole
    // value is that every entry names the data that caused it.
    for (const input of [
      { rungHistory: [null, null] },
      { rungHistory: ["L1", "L1"] },
      { rungHistory: [], founderSaid: "x" },
    ]) {
      expect(meetsChangeBar(input).because.length).toBeGreaterThan(0);
    }
  });
});

describe("checkFeasibility — the ask comes before the announcement", () => {
  const because = "L1 has been the broken rung 2 weeks running";

  it("passes straight through when the change needs no new media", () => {
    expect(
      checkFeasibility({ needsRealMedia: false, productScreenshots: 0, hasRecording: false, because })
        .state
    ).toBe("supported");
  });

  it("is supported by a screen recording alone", () => {
    // One recording yields frames and b-roll — §6.4.2's whole argument for
    // asking for a recording rather than five screenshots.
    expect(
      checkFeasibility({ needsRealMedia: true, productScreenshots: 0, hasRecording: true, because })
        .state
    ).toBe("supported");
  });

  it("degrades to partial with a few screenshots, and says what's missing", () => {
    const out = checkFeasibility({
      needsRealMedia: true,
      productScreenshots: 1,
      hasRecording: false,
      because,
    });
    expect(out.state).toBe("partial");
    expect(out.ask).toContain("screen recording");
  });

  /**
   * ⭐ §16.75.05's case 3: "Do not announce the change. Ask first." Announcing
   * a plan you can't deliver is worse than staying put.
   */
  it("blocks — and the ask carries the number that caused it", () => {
    const out = checkFeasibility({
      needsRealMedia: true,
      productScreenshots: 0,
      hasRecording: false,
      because,
    });
    expect(out.state).toBe("blocked");
    expect(out.ask).toContain(because);
    expect(out.ask).toMatch(/want to send one\?/i);
  });
});
