/** Three ways a benchmark lies, all guarded: too few posts, one loud account, staleness stamped. */
import { describe, expect, it } from "vitest";
import { computeLaneBenchmark, MIN_AUTHORS, MIN_POSTS } from "../benchmarks";

const post = (author: string, views: number) => ({ authorHandle: author, views, likes: 1, comments: 1, shares: 1, saves: 1, keywords: ["running"] });

describe("lane benchmark", () => {
  it("is unusable below eight posts, and below three accounts", () => {
    expect(computeLaneBenchmark(Array.from({ length: MIN_POSTS - 1 }, (_, i) => post(`a${i}`, 100)), 1).usable).toBe(false);
    const oneVoice = computeLaneBenchmark(Array.from({ length: 20 }, () => post("loud", 5000)), 1);
    expect(oneVoice.usable).toBe(false);
    expect(oneVoice.why).toMatch(/person, not a lane/);
    expect(MIN_AUTHORS).toBe(3);
  });
  it("gives the median and the top quarter, stamped", () => {
    const obs = [...Array.from({ length: 4 }, (_, i) => post("a", 100 + i)), ...Array.from({ length: 4 }, (_, i) => post("b", 1000 + i)), ...Array.from({ length: 4 }, (_, i) => post("c", 10_000 + i))];
    const b = computeLaneBenchmark(obs, 42);
    expect(b.usable).toBe(true);
    expect(b.medianViews).toBe(1002);
    expect(b.p75Views).toBe(10_001);
    expect(b.computedAt).toBe(42);
    expect(b.keywords).toEqual(["running"]);
  });
});
