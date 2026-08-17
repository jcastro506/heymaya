/**
 * The weekly review (§15.3's `report`).
 *
 * Its four hard rules are all about what NOT to say: never report inventory as
 * results · state a zero week plainly with its cause · lead with the rung, not
 * a number dump. Each one is a way a report can be technically accurate and
 * still mislead.
 */

import { describe, expect, it } from "vitest";
import { composeWeekly, type WeeklyInput } from "../weeklyReport";

const base: WeeklyInput = {
  placements: 6,
  views: 6000,
  rung: "healthy",
  rungDetail: "reach and engagement are both working",
  nicheMedian: 1000,
  nichePosts: 200,
  tracedPlacements: 4,
  strategy: { changed: false, detail: "" },
  conversions: { total: 0, traced: 0 },
};

describe("a zero week", () => {
  /**
   * ⭐ §12: honest silence beats fake activity. A report opening with a
   * percentage on a week that published nothing is the exact dishonesty this
   * rule exists to stop.
   */
  it("leads with the zero and gives the cause", () => {
    const out = composeWeekly({
      ...base,
      placements: 0,
      views: 0,
      rungDetail: "nothing published, so there's nothing to read",
    });
    expect(out.startsWith("nothing went out this week")).toBe(true);
    expect(out).toContain("nothing to read");
  });

  it("still carries the strategy verdict", () => {
    const out = composeWeekly({
      ...base,
      placements: 0,
      strategy: { changed: false, detail: "nothing's changing this week" },
    });
    expect(out).toContain("nothing's changing");
  });

  it("never claims views on a week with no posts", () => {
    const out = composeWeekly({ ...base, placements: 0, views: 0 });
    expect(out).not.toMatch(/views a post/);
  });
});

describe("never report inventory as results", () => {
  /**
   * §2.6: "the unit of work is a placement — something live, with a URL.
   * Drafts and found threads are inventory, not results." The composer is
   * given placements and has no way to reach a draft, which is the structural
   * version of the rule.
   */
  it("counts placements and has no notion of drafts", () => {
    const out = composeWeekly(base);
    expect(out).toContain("of 6 posts");
    expect(out.toLowerCase()).not.toContain("draft");
  });
});

describe("the rung and the benchmark can disagree", () => {
  /**
   * ⭐ Found on the first live run. The ladder is arithmetic against ABSOLUTE
   * floors, so 153 views across 9 posts read as "distribution and interest are
   * both working" while being 96% under the niche median. Printing both in
   * sequence congratulates and then contradicts.
   *
   * §16.3 resolves it: "context is the product" — the niche wins the headline.
   */
  it("lets the niche win when the floor and the niche disagree", () => {
    const out = composeWeekly({
      ...base,
      views: 150, // 25 a post, against a median of 1000
      rungDetail: "reach and engagement are both working",
    });
    expect(out).toContain("clear my floor");
    expect(out).toContain("well under what your niche does");
    // ⚠️ The complacent sentence must not also appear.
    expect(out).not.toContain("both working");
  });

  it("leads with the rung when they agree", () => {
    const out = composeWeekly(base); // 1000 a post vs a 1000 median
    expect(out.startsWith("reach and engagement are both working")).toBe(true);
  });

  it("says nothing about the niche when there is no benchmark", () => {
    const out = composeWeekly({ ...base, nicheMedian: null, nichePosts: 0 });
    expect(out).not.toMatch(/niche/);
    expect(out.startsWith(base.rungDetail)).toBe(true);
  });
});

describe("results", () => {
  it("separates the signups it can explain from the ones it can't", () => {
    const out = composeWeekly({
      ...base,
      conversions: { total: 3, traced: 1 },
    });
    expect(out).toContain("3 signups");
    expect(out).toMatch(/can't for the other 2/);
  });

  it("stays quiet when there were none", () => {
    /**
     * The intent, unchanged: reporting "0 signups" every week trains a founder
     * to stop reading.
     *
     * ⚠️ The assertion was `not.toMatch(/signup/)` until 2026-08-12, which also
     * forbade ASKING — a different act, and one §14.45 makes mandatory ("rung 4
     * is the floor, and it runs forever"). Narrowed to what the rule is
     * actually about: no CLAIMED count.
     */
    const out = composeWeekly(base);
    expect(out).not.toMatch(/\d+ signups?\b/);
    expect(out).not.toMatch(/0 signups/);
  });

  it("⭐ asks the weekly question every time — §14.45 rung 4", () => {
    /**
     * The floor of the attribution ladder, and it was never asked. Of the five
     * rungs, none were running: no post carries a wrapped link, there is no
     * pixel, and this question had no code anywhere.
     */
    expect(composeWeekly(base)).toMatch(/how many signups/i);
    expect(
      composeWeekly({ ...base, conversions: { total: 3, traced: 1 } }),
    ).toMatch(/how many signups/i);
  });

  it("asks even on a week with nothing published", () => {
    // Signups arrive from posts that went out earlier; skipping the question on
    // a quiet week loses exactly the tail that proves the work compounds.
    expect(composeWeekly({ ...base, placements: 0 })).toMatch(
      /how many signups/i,
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("one signup, traced end to end — Sprint 8's exit criterion", () => {
  /**
   * ⭐ §18 Sprint 8: **Exit: one signup traced end to end, with links.**
   *
   * ⚠️ `attribution.traceConversion` builds that chain and had NO CALLER, so
   * the report could say "I can point to the post for 3" and then never point.
   * Counting traceable signups and showing the trace are different claims, and
   * §16.2 calls Results "the reason they don't cancel".
   */
  const base = {
    placements: 4,
    views: 900,
    rung: "L1",
    rungDetail: "",
    nicheMedian: null,
    nichePosts: 0,
    tracedPlacements: 3,
    strategy: { changed: false, detail: "" },
    bioLink: undefined,
    conversions: { total: 2, traced: 1 },
  };

  it("⭐ shows the chain, with openable links", () => {
    const body = composeWeekly({
      ...base,
      tracedExample: {
        detail: "Here's one of them, all the way back:",
        hops: [
          "1 signup, reported by your site",
          "they clicked your link — https://hey-maya.ai/r/abc",
          "from this post — https://x.com/status/1",
          "which came from a complaint someone posted",
        ],
      },
    } as Parameters<typeof composeWeekly>[0]);

    expect(body).toContain("all the way back");
    // §6: a source you can't open isn't a source.
    expect(body).toContain("https://x.com/status/1");
  });

  it("⚠️ says nothing extra when nothing traced", () => {
    /**
     * The honest-silence case. A week with untraceable signups still reports
     * the count — it just doesn't manufacture a chain to go with it.
     */
    const body = composeWeekly(
      base as Parameters<typeof composeWeekly>[0]
    );
    expect(body).toContain("2 signups");
    expect(body).not.toContain("all the way back");
  });

  it("⚠️ traces exactly one, not all of them", () => {
    // A report that traces six signups is a wall of URLs nobody reads.
    // §16.75.05: lead with the finding, not a number dump.
    const body = composeWeekly({
      ...base,
      tracedExample: {
        detail: "Here's one of them, all the way back:",
        hops: ["a", "b"],
      },
    } as Parameters<typeof composeWeekly>[0]);
    expect(body.match(/all the way back/g)?.length).toBe(1);
  });
});
