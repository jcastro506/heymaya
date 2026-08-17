/**
 * `make-carousel` — the constraints that must hold without a model.
 *
 * Everything asserted here is structural. Per the repo rule, nothing tests the
 * prompt prose: it changes weekly and a substring match on it is a false-alarm
 * generator. What is pinned is what the planner is *allowed to produce* —
 * because that is the boundary between "the model chose badly" (fine, the
 * critic exists) and "the model produced something we will render anyway"
 * (not fine).
 */

import { describe, expect, it } from "vitest";
import {
  LAYOUTS,
  MAX_SLIDES,
  describeTruth,
  parsePlan,
  slideTextOf,
  stripFence,
} from "../carousel";

const plan = (slides: unknown) => JSON.stringify({ slides });

describe("parsePlan", () => {
  it("keeps a well-formed set intact", () => {
    const out = parsePlan(
      plan([
        { layout: "title", headline: "the one thing" },
        { layout: "point", headline: "here's why", body: "because of this" },
        { layout: "cta", headline: "go here" },
      ]),
      []
    );
    expect(out.map((s) => s.layout)).toEqual(["title", "point", "cta"]);
    expect(out[1].content.body).toBe("because of this");
  });

  it("falls back to `point` for a layout that isn't one of the five", () => {
    // §7.5.1's set is closed. An unknown layout has no renderer, and rendering
    // nothing is worse than rendering the words plainly.
    const out = parsePlan(plan([{ layout: "hero-splash", headline: "x" }]), []);
    expect(out[0].layout).toBe("point");
    expect(LAYOUTS).not.toContain("hero-splash");
  });

  /**
   * ⭐ The one that matters most.
   *
   * §2.7 is "grounded or silent". A `screenshot` layout whose image doesn't
   * resolve would render a frame around nothing — a slide that promises a
   * product shot and shows a rectangle. The words still work as a point.
   */
  it("demotes a screenshot slide when the image doesn't resolve", () => {
    const out = parsePlan(
      plan([{ layout: "screenshot", headline: "the export screen", imageRef: 3 }]),
      [{ publicUrl: "https://example.com/a.png" }]
    );
    expect(out[0].layout).toBe("point");
    expect(out[0].content.imageUrl).toBeUndefined();
  });

  it("keeps a screenshot slide when the image does resolve", () => {
    const out = parsePlan(
      plan([{ layout: "screenshot", headline: "the export screen", imageRef: 0 }]),
      [{ publicUrl: "https://example.com/a.png" }]
    );
    expect(out[0].layout).toBe("screenshot");
    expect(out[0].content.imageUrl).toBe("https://example.com/a.png");
  });

  it("demotes a comparison that only has one side", () => {
    // Otherwise it renders a divider with nothing on the right of it.
    const out = parsePlan(
      plan([{ layout: "comparison", headline: "before and after", left: "before" }]),
      []
    );
    expect(out[0].layout).toBe("point");
  });

  it("drops a slide with no headline", () => {
    // Every layout requires one — a slide with only a body has nothing to read.
    const out = parsePlan(
      plan([{ layout: "point", body: "orphaned" }, { layout: "cta", headline: "ok" }]),
      []
    );
    expect(out).toHaveLength(1);
    expect(out[0].content.headline).toBe("ok");
  });

  it("caps the set at MAX_SLIDES", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      layout: "point",
      headline: `slide ${i}`,
    }));
    expect(parsePlan(plan(many), [])).toHaveLength(MAX_SLIDES);
  });

  it("returns nothing for output that isn't a plan", () => {
    // A refusal, a truncated response, or prose all land here. Returning [] is
    // what makes the caller's MIN_SLIDES check the single place that decides.
    expect(parsePlan("I'm sorry, I can't help with that.", [])).toEqual([]);
    expect(parsePlan("", [])).toEqual([]);
    expect(parsePlan(JSON.stringify({ slides: "nope" }), [])).toEqual([]);
  });

  it("reads a fenced code block, which is what models actually return", () => {
    const fenced = "```json\n" + plan([{ layout: "cta", headline: "go" }]) + "\n```";
    expect(parsePlan(fenced, [])).toHaveLength(1);
    expect(stripFence(fenced).startsWith("{")).toBe(true);
  });
});

describe("slideTextOf", () => {
  /**
   * ⚠️ Every renderable field, or the house-rule gate has a blind spot.
   *
   * The gate reads this string. A banned phrase that lives in an `eyebrow` or
   * on one side of a comparison is just as permanent in the PNG as one in the
   * headline, so omitting any field here would let it through.
   */
  it("includes every field that reaches the pixels", () => {
    const text = slideTextOf([
      {
        layout: "comparison",
        content: {
          eyebrow: "EYEBROW_TOKEN",
          headline: "HEADLINE_TOKEN",
          body: "BODY_TOKEN",
          left: "LEFT_TOKEN",
          right: "RIGHT_TOKEN",
        },
      },
    ]);
    for (const token of [
      "EYEBROW_TOKEN",
      "HEADLINE_TOKEN",
      "BODY_TOKEN",
      "LEFT_TOKEN",
      "RIGHT_TOKEN",
    ]) {
      expect(text).toContain(token);
    }
  });

  it("covers every slide, not just the first", () => {
    const text = slideTextOf([
      { layout: "title", content: { headline: "first" } },
      { layout: "cta", content: { headline: "LAST_TOKEN" } },
    ]);
    expect(text).toContain("LAST_TOKEN");
  });
});

describe("describeTruth", () => {
  it("puts the founder's own words last and marks them as outranking", () => {
    // The record itself says why: a scrape goes stale, a correction doesn't.
    // A planner that weighs them equally re-introduces what was corrected.
    const text = describeTruth({
      name: "Thing",
      whatItIs: "a thing",
      founderSays: ["it is NOT a CRM"],
    });
    expect(text.indexOf("it is NOT a CRM")).toBeGreaterThan(text.indexOf("a thing"));
    expect(text).toContain("outrank");
  });

  it("omits sections it doesn't have rather than emitting empty labels", () => {
    const text = describeTruth({ name: "Thing" });
    expect(text).toBe("Product: Thing");
  });
});

/* -------------------------------------------------------------------------- */

describe("the gate cannot authorise work nothing can build", () => {
  /**
   * ⭐ The live customer is on `mvp`, which grants `videosPerMonth: 4`. That
   * made `tierMaxRung` compute to `avatar` — and `convex/maya` has NO video
   * path: no `make_video`, no `enqueue_render`, no Creatify call. Her only
   * media tool is `make_carousel`.
   *
   * ⚠️ A gate that says yes to impossible work is worse than one that says no.
   * The founder gets told a video is coming, and §2.7 is broken by a promise
   * instead of a sentence.
   */
  it("⭐ caps a paid video allowance to what the pipeline can produce", async () => {
    const { capToBuildable } = await import("../preSpendGate");
    expect(capToBuildable("avatar")).toBe("carousel");
    expect(capToBuildable("ad_clone")).toBe("carousel");
  });

  it("leaves a rung that IS buildable alone", async () => {
    const { capToBuildable } = await import("../preSpendGate");
    expect(capToBuildable("carousel")).toBe("carousel");
    // ⚠️ Never promotes. A plan with no video allowance still gets carousels,
    // but a static stays static.
    expect(capToBuildable("static")).toBe("static");
  });

  it("⚠️ the ladder itself is unchanged — this is a build limit, not a redesign", async () => {
    /**
     * `videosPerMonth: 4` is a real commercial promise and the video rungs are
     * the product's shape. Both stay; one constant flips when the video path
     * lands. Deleting the rungs would make the eventual restore a redesign.
     */
    const { RUNGS } = await import("../preSpendGate");
    expect(RUNGS).toContain("avatar");
    expect(RUNGS).toContain("ad_clone");
  });
});
