/**
 * ⭐ The behaviour eval's own contract.
 *
 * The judging itself needs a live model, so it runs on demand rather than in
 * CI. What IS testable here is the harness's honesty: that a rule set is
 * well-formed, and that the module judges by asking a model rather than by
 * matching patterns.
 *
 * ⚠️ The no-regex rule is the point. A pattern for "attribution" or "UTM"
 * passes a sentence that leaks the same idea in other words and fails one that
 * quotes the founder saying it — and worse, it trains the writing toward
 * whatever the pattern misses.
 *
 * Proven on 2026-08-12: run against the real composers, the judge caught
 * `"render budget"` in the pre-spend gate's refusal — a phrase no denylist
 * contained, in a string whose own unit test asserted structure and passed.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RULES } from "../convex/maya/behaviourEval";

const source = readFileSync(
  path.join(__dirname, "..", "convex", "maya", "behaviourEval.ts"),
  "utf8",
);

describe("the rules handed to the judge", () => {
  it("each carries its statement and its source", () => {
    // A rule with no source cannot be argued about against the spec, and a
    // failure nobody can check is a failure nobody will act on.
    for (const [id, rule] of Object.entries(RULES)) {
      expect(rule.id, id).toBe(id);
      expect(rule.statement.length, id).toBeGreaterThan(60);
      expect(rule.source, id).toMatch(/§/);
    }
  });

  it("covers the promises that had no instrument", () => {
    // The cringe eval answers "does this sound human". These are the separate
    // promises it says nothing about.
    for (const id of [
      "plain_language",
      "no_unfounded_claims",
      "honest_about_nothing",
      "no_blame_shifting",
      "states_the_gap",
    ]) {
      expect(RULES[id], id).toBeTruthy();
    }
  });
});

describe("how it judges", () => {
  it("⚠️ asks a model — it does not match patterns", () => {
    /**
     * The standing rule is prompt-primary, no regex enforcement. If this ever
     * fails, someone has replaced judgement with a denylist and the eval has
     * started measuring the denylist instead of the writing.
     */
    expect(source).toContain("callModel");
    // No banned-phrase list anywhere in the judging path.
    expect(source).not.toMatch(/BANNED|DENYLIST|FORBIDDEN_WORDS/);
  });

  it("⭐ a missed control voids the scenario rather than passing it", () => {
    /**
     * The trap every eval falls into: a judge that says "fine" to everything
     * scores perfectly and measures nothing. Each scenario carries a
     * deliberately-bad control, and a run whose control slipped past proves
     * nothing about the real output.
     */
    expect(source).toMatch(/void:\s*!controlCaught/);
    // And void must never be folded into the pass count.
    expect(source).toMatch(/passed:\s*results\.filter\(\(r\) => !r\.void/);
  });

  it("requires the judge to quote what it objects to", () => {
    // A verdict with no span is not actionable — and is the shape a
    // hallucinated objection takes.
    expect(source).toMatch(/MUST quote the exact offending span/);
  });
});
