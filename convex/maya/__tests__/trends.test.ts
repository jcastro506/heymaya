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
import { intersectsNiche, parseShape, TREND_SAMPLE, SHAPES_JUDGED } from "../trends";

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


/**
 * ⭐ The half the first version threw away.
 *
 * The operator caught it: keeping only in-niche trends discards the case a
 * real manager uses most — riding a trend that has nothing to do with your
 * topic. The subject is useless; the SHAPE might travel.
 */
describe("⭐ A SHAPE WORTH STEALING", () => {
  it("keeps a structure that could carry any product", () => {
    const v = parseShape(
      JSON.stringify({
        keep: true,
        shape: "state the thing everyone believes, disprove it, then show the receipt",
        why: "the disproof lands before anyone scrolls",
      })
    );
    expect(v?.keep).toBe(true);
    expect(v?.shape).toMatch(/disprove/);
  });

  it("⭐ MOST TRENDS ARE NOT REUSABLE, AND FALSE IS THE COMMON ANSWER", () => {
    // A shape that depends on knowing who a wrestler is isn't a shape.
    const v = parseShape(JSON.stringify({ keep: false }));
    expect(v?.keep).toBe(false);
  });

  it("⭐ `keep: true` WITH NO SHAPE IS AGREEING, NOT ANSWERING", () => {
    // The failure mode of every judge prompt: a model that says yes because
    // yes is easier. No shape means no evidence that a shape exists.
    expect(parseShape(JSON.stringify({ keep: true, shape: "  ", why: "nice" }))).toBeNull();
  });

  it("⭐ THE SUBJECT WEARING A DISGUISE IS REJECTED", () => {
    /**
     * Measured on the first live run: 11 shapes came back and about half were
     * this. Told not to name what the post was about, the model substituted a
     * placeholder rather than answering false.
     *
     * None of these is a shape. A structure needing a celebrity, a fandom, or
     * a literal `X` cannot carry a dashboard.
     */
    for (const shape of [
      "Ranking the best X moments",
      "Showcase a signature feature of a known entity in a short video",
      "A lesser-known individual repeats a surprising action against a famous figure",
      "Showcase a personal talent or performance while using a trending hashtag",
    ]) {
      const v = parseShape(JSON.stringify({ keep: true, shape, why: "it works" }));
      expect(v?.keep, shape).toBe(false);
    }
  });

  it("⭐ AND THE GOOD ONES FROM THE SAME RUN STILL PASS", () => {
    // The guard has to be narrow enough to keep what actually worked.
    for (const shape of [
      "Time-lapse of a massive task being completed quickly, ending with an emotional payoff",
      "Document a quest to locate a rare or valuable item, showing the search process and final discovery",
      "Show an ambiguous product and ask the audience to guess its brand before revealing it",
    ]) {
      const v = parseShape(JSON.stringify({ keep: true, shape, why: "it works" }));
      expect(v?.keep, shape).toBe(true);
    }
  });

  it("a three-word 'shape' is a label, not a structure", () => {
    expect(parseShape(JSON.stringify({ keep: true, shape: "funny dog video", why: "x" }))?.keep).toBe(false);
  });

  it("survives a fenced response and rejects prose", () => {
    expect(parseShape('```json\n{"keep":false}\n```')?.keep).toBe(false);
    expect(parseShape("I think this one is reusable!")).toBeNull();
  });

  it("the judged sample is bounded — this runs weekly, not per post", () => {
    expect(SHAPES_JUDGED).toBeGreaterThan(0);
    expect(SHAPES_JUDGED).toBeLessThanOrEqual(25);
  });
});
