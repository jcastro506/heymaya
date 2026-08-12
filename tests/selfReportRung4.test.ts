/**
 * ⭐ §14.45 rung 4 — the weekly self-report, end to end.
 *
 * ## The state this fixes
 *
 * §14.45 opens: *"This is the hardest layer in the product and **the one the
 * whole wedge rests on**."* It defines five rungs. Verified 2026-08-12:
 * **none of them were running.**
 *
 * | rung | spec | reality |
 * |---|---|---|
 * | 1 wrapped links | "none — always on" | 0 of 10 published posts carried a link, and `wrapForPlacement` had zero callers |
 * | 2 pixel | "precise" | does not exist |
 * | 4 weekly self-report | "the floor, and it runs forever" | never asked |
 *
 * So `traced` was not merely zero — it was **structurally incapable** of being
 * anything else.
 *
 * Rung 4 is the cheapest and the spec calls it universal, so it goes first.
 *
 * ## Why the parse is deliberately dumb
 *
 * §14.45 already grades this rung *"Lossy, but universal."* The first plain
 * number wins. A model call to split "like 4 or 5" would cost more than the
 * answer is worth and could hallucinate a figure the founder never said —
 * which on the retention screen is worse than being approximate.
 */

import { describe, expect, it } from "vitest";
import { parseSignupCount } from "../convex/maya/attribution";
import { composeWeekly, selfReportAsk } from "../convex/maya/weeklyReport";

const BASE = {
  placements: 4,
  views: 800,
  rung: "L2",
  rungDetail: "distribution is working",
  nicheMedian: null,
  nichePosts: 0,
  tracedPlacements: 2,
  strategy: { changed: false, detail: "" },
  conversions: { total: 0, traced: 0 },
};

describe("the ask", () => {
  it("⭐ is present every week, busy or quiet", () => {
    // "Rung 4 is the floor, and it runs forever."
    expect(composeWeekly(BASE)).toContain(selfReportAsk());
    expect(composeWeekly({ ...BASE, placements: 0 })).toContain(
      selfReportAsk(),
    );
  });

  it("asks for a rough number, and says why", () => {
    const ask = selfReportAsk();
    // Friction is the whole design constraint — "one sentence".
    expect(ask).toMatch(/roughly how many signups/i);
    expect(ask).toMatch(/rough number is fine/i);
    // ⚠️ An ask with its reason attached converts; a bare request reads as
    // admin (§6.4.2, the same pattern as the screenshot ask).
    expect(ask).toMatch(/whether any of this is landing/i);
  });

  it("comes last — she informs before she asks", () => {
    const out = composeWeekly(BASE);
    expect(out.indexOf(selfReportAsk())).toBeGreaterThan(
      out.indexOf(BASE.rungDetail),
    );
  });
});

describe("reading their answer", () => {
  it("takes a plain number", () => {
    expect(parseSignupCount("4")).toBe(4);
    expect(parseSignupCount("we got 12 this week")).toBe(12);
    expect(parseSignupCount("about 7 I think")).toBe(7);
  });

  it("understands the words people use for none", () => {
    // Far more common than typing "0".
    for (const answer of ["none", "nope", "zero", "nothing", "no"]) {
      expect(parseSignupCount(answer), answer).toBe(0);
    }
  });

  it("⚠️ records NOTHING when they didn't give a number", () => {
    /**
     * The load-bearing case. "not sure yet" is not zero. Writing a 0 for it
     * fabricates a data point on the screen §16.2 says they cancel over — and
     * a fabricated zero is indistinguishable from a real one forever after.
     */
    expect(parseSignupCount("not sure yet")).toBeNull();
    expect(parseSignupCount("I'll check and get back to you")).toBeNull();
    expect(parseSignupCount("")).toBeNull();
  });

  it("⚠️ rejects an answer about a DIFFERENT metric", () => {
    /**
     * "got 2000 impressions" would otherwise book 2000 signups and make every
     * later number meaningless.
     *
     * ⭐ Caught by the NOUN, not by magnitude. My first version capped at
     * 10,000 — which fails both ways: 2000 impressions slipped through, and a
     * founder having a genuinely huge week would have been rejected. Punishing
     * the customer we most want to keep is the worse of the two errors.
     */
    expect(parseSignupCount("2000 impressions")).toBeNull();
    expect(parseSignupCount("we hit 50000 views")).toBeNull();
    expect(parseSignupCount("about 300 clicks")).toBeNull();

    // A big but real answer still counts.
    expect(parseSignupCount("9000")).toBe(9000);
    expect(parseSignupCount("1,200")).toBe(1200);
    // And if they name both, the number is ours.
    expect(parseSignupCount("40 signups from 2000 views")).toBe(40);
  });

  it("is lossy on purpose, and predictably so", () => {
    // §14.45 grades this rung "lossy, but universal". First number wins.
    expect(parseSignupCount("like 4 or 5")).toBe(4);
  });
});
