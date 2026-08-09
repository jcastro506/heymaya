/**
 * The niche screen — batching, indexing, and which way it fails.
 *
 * The judgment itself belongs to the model and isn't asserted here. What is
 * asserted is everything around it, because an off-by-one in the indexing would
 * silently keep the wrong posts and look exactly like a working filter.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_CAPTION_CHARS,
  SCREEN_BATCH,
  buildScreenPrompt,
  parseKeepSet,
} from "../relevance";

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ key: `k${i}`, text: `post ${i}` }));

describe("buildScreenPrompt", () => {
  it("numbers from 1, which is what the verdict refers back to", () => {
    const prompt = buildScreenPrompt(["saas"], items(3));
    expect(prompt).toContain("1. post 0");
    expect(prompt).toContain("3. post 2");
    expect(prompt).not.toContain("0. ");
  });

  it("truncates a long caption — the first line decides the topic", () => {
    const long = "x".repeat(1000);
    const prompt = buildScreenPrompt(["saas"], [{ key: "a", text: long }]);
    expect(prompt).not.toContain("x".repeat(MAX_CAPTION_CHARS + 1));
  });

  it("collapses whitespace so one post stays one line", () => {
    // A caption with newlines would otherwise look like several numbered items.
    const prompt = buildScreenPrompt(["saas"], [{ key: "a", text: "one\n\ntwo" }]);
    expect(prompt).toContain("1. one two");
  });

  it("marks an empty caption rather than emitting a bare number", () => {
    const prompt = buildScreenPrompt(["saas"], [{ key: "a", text: "   " }]);
    expect(prompt).toContain("1. (no caption)");
  });

  it("states the niche it's judging against", () => {
    expect(buildScreenPrompt(["indie hacker"], items(1))).toContain("indie hacker");
  });
});

describe("parseKeepSet", () => {
  it("converts the 1-indexed verdict to 0-indexed positions", () => {
    const keep = parseKeepSet(JSON.stringify({ keep: [1, 3] }), 4);
    expect([...keep].sort()).toEqual([0, 2]);
  });

  it("ignores a number outside the batch", () => {
    // A hallucinated index must not shift which real post is kept.
    const keep = parseKeepSet(JSON.stringify({ keep: [1, 99, 0, -2] }), 3);
    expect([...keep]).toEqual([0]);
  });

  it("accepts numeric strings, which models return often enough to matter", () => {
    expect([...parseKeepSet(JSON.stringify({ keep: ["2"] }), 3)]).toEqual([1]);
  });

  it("keeps nothing when the model kept nothing", () => {
    // A genuinely empty verdict is a real answer and must not be read as junk.
    expect(parseKeepSet(JSON.stringify({ keep: [] }), 3).size).toBe(0);
  });

  /**
   * ⚠️ Unparseable output keeps EVERYTHING, and that asymmetry is deliberate.
   *
   * This is a quality filter, not a safety gate. A safety gate that can't reach
   * its model must block; a quality filter that can't must not silently empty
   * the niche — "she saw nothing today" is indistinguishable from a dead
   * account, which is a far worse failure than a few off-topic rows.
   */
  it("fails OPEN on junk, a refusal, or the wrong shape", () => {
    for (const bad of [
      "not json at all",
      "",
      JSON.stringify({ keep: "everything" }),
      JSON.stringify({ nope: [1] }),
    ]) {
      expect(parseKeepSet(bad, 3).size, `should keep all for: ${bad}`).toBe(3);
    }
  });

  it("reads a fenced block, which is what models actually return", () => {
    const fenced = "```json\n" + JSON.stringify({ keep: [2] }) + "\n```";
    expect([...parseKeepSet(fenced, 3)]).toEqual([1]);
  });
});

describe("batching", () => {
  it("stays small enough that one bad response costs a batch, not the sweep", () => {
    expect(SCREEN_BATCH).toBeGreaterThan(1);
    expect(SCREEN_BATCH).toBeLessThanOrEqual(100);
  });
});
