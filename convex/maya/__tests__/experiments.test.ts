/**
 * `run-experiment` (§15.3) — declare it, watch it, call it.
 *
 * The hard rules are all about discipline before data: one live experiment per
 * channel, a pre-declared window and metric, and **"inconclusive" said out
 * loud**. Choosing the metric after seeing the numbers is how you always find a
 * win — you pick the column that moved.
 */

import { describe, expect, it } from "vitest";
import {
  WINDOW_DAYS,
  callVerdict,
  dueForVerdict,
  liveOn,
  parseExperiments,
  type Experiment,
} from "../experiments";

const NOW = Date.UTC(2026, 7, 11, 12, 0, 0);

const experiment = (over: Partial<Experiment> = {}): Experiment => ({
  id: "x_1",
  channel: "x",
  hypothesis: "objection openers beat question openers",
  metric: "views",
  arms: ["objection", "question"],
  startedAt: NOW,
  endsAt: NOW + WINDOW_DAYS * 86_400_000,
  ...over,
});

describe("one live experiment per channel", () => {
  it("finds the live one", () => {
    expect(liveOn([experiment()], "x", NOW)?.id).toBe("x_1");
  });

  it("ignores a concluded one", () => {
    // A called experiment no longer blocks the channel — that's the point of
    // calling it.
    const done = experiment({
      verdict: { kind: "winner", detail: "done", calledAt: NOW },
    });
    expect(liveOn([done], "x", NOW)).toBeNull();
  });

  it("ignores one whose window has closed", () => {
    expect(liveOn([experiment({ endsAt: NOW - 1 })], "x", NOW)).toBeNull();
  });

  it("does not block a different channel", () => {
    // Two at once on the SAME surface makes both unreadable; different
    // surfaces are independent.
    expect(liveOn([experiment()], "tiktok", NOW)).toBeNull();
  });
});

describe("dueForVerdict", () => {
  /**
   * ⚠️ Closed, not "closed and successful". An experiment that ran its two
   * weeks and gathered nothing still needs its verdict called — leaving it
   * open forever is how a registry fills with things nobody concludes.
   */
  it("returns closed experiments with no verdict", () => {
    const closed = experiment({ id: "x_old", endsAt: NOW - 1 });
    expect(dueForVerdict([closed, experiment()], NOW).map((e) => e.id)).toEqual([
      "x_old",
    ]);
  });

  it("skips ones already called", () => {
    const called = experiment({
      endsAt: NOW - 1,
      verdict: { kind: "inconclusive", detail: "d", calledAt: NOW },
    });
    expect(dueForVerdict([called], NOW)).toEqual([]);
  });
});

describe("callVerdict", () => {
  /**
   * ⭐ §15.3: "'inconclusive' is a legitimate verdict and is said out loud."
   *
   * At this volume (§14.3) two weeks often genuinely cannot separate two
   * hooks. Softening that into a lean is how a system starts optimising noise.
   */
  it("says inconclusive rather than picking a leader from nothing", () => {
    const out = callVerdict(experiment(), [
      { label: "objection", trials: 3, conversions: 1 },
      { label: "question", trials: 3, conversions: 0 },
    ]);
    expect(out.kind).toBe("inconclusive");
    expect(out.detail).toMatch(/wasn't enough to tell/i);
  });

  /**
   * ⚠️ And it frames it as an open question, not a rejection. An inconclusive
   * result read as a no quietly kills ideas that were never actually tested.
   */
  it("frames inconclusive as still open, never as a no", () => {
    const out = callVerdict(experiment(), [
      { label: "objection", trials: 2, conversions: 0 },
      { label: "question", trials: 2, conversions: 0 },
    ]);
    expect(out.detail).toMatch(/open question, not a no/i);
  });

  it("names a winner when the data supports one", () => {
    const out = callVerdict(experiment(), [
      { label: "objection", trials: 200, conversions: 60 },
      { label: "question", trials: 200, conversions: 10 },
    ]);
    expect(out.kind).toBe("winner");
    expect(out.detail).toContain("objection");
  });

  it("carries the hypothesis into every verdict", () => {
    // A verdict without the question it answered is unreadable a month later.
    for (const arms of [
      [
        { label: "a", trials: 1, conversions: 0 },
        { label: "b", trials: 1, conversions: 0 },
      ],
      [
        { label: "a", trials: 300, conversions: 90 },
        { label: "b", trials: 300, conversions: 5 },
      ],
    ]) {
      expect(callVerdict(experiment(), arms).detail).toContain(
        "objection openers beat question openers"
      );
    }
  });
});

describe("parseExperiments", () => {
  it("returns an empty list rather than throwing on junk", () => {
    // A corrupt registry must not take down the weekly review.
    expect(parseExperiments(undefined)).toEqual([]);
    expect(parseExperiments("not json")).toEqual([]);
    expect(parseExperiments('{"not":"an array"}')).toEqual([]);
  });
});

describe("the window", () => {
  it("is two weeks — one hypothesis worth two weeks", () => {
    expect(WINDOW_DAYS).toBe(14);
  });
});
