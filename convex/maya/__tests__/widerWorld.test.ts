/**
 * The wider-world sweep (§5.2 sweep 6) — the last of the six to get a caller.
 *
 * Its whole job is refusing to pass along something it can't cite, because a
 * grounded search that returns prose with no sources is worse than one that
 * returns nothing: it reads exactly like a finding.
 */

import { describe, expect, it } from "vitest";
import { buildQueries, MIN_SOURCES } from "../widerWorld";

describe("⭐ THE QUESTIONS ARE ABOUT THE BUYER, NOT ABOUT US", () => {
  it("asks what people complain about, not what the industry is doing", () => {
    // "What is happening in <niche>" returns press releases. "What are people
    // complaining about" returns people.
    const qs = buildQueries("indie founders who can't get users");
    expect(qs.some((q) => /complaining about/.test(q))).toBe(true);
    expect(qs.some((q) => /asking for help/.test(q))).toBe(true);
  });

  it("⭐ SEARCHES THE AUDIENCE, NEVER THE PRODUCT NAME", () => {
    // Searching "HeyMaya" returns us. The point of this sweep is the world we
    // are supposed to be reading, so it takes the audience phrase.
    const qs = buildQueries("indie founders");
    expect(qs.every((q) => q.includes("indie founders"))).toBe(true);
    expect(qs.some((q) => /heymaya/i.test(q))).toBe(false);
  });
});

describe("⭐ GROUNDED OR SILENT, ENFORCED", () => {
  it("one source is not grounding", () => {
    /**
     * A single citation is one model's impression of the week. The floor is
     * two, because the failure this guards against is fluent and confident:
     *
     * live, same query, only the token budget differing —
     *   1024 → finishReason MAX_TOKENS, 0 chunks, a perfectly readable summary
     *   4000 → finishReason STOP, 7 chunks
     *
     * A too-small budget does not shorten the answer. It strips the grounding
     * and leaves the prose.
     */
    expect(MIN_SOURCES).toBeGreaterThanOrEqual(2);
  });
});
