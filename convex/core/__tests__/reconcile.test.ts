/** §16.4: within ten percent is fine; a missing vendor number is a failure, not a pass. */
import { describe, expect, it } from "vitest";
import { compare } from "../reconcile";

describe("reconcile", () => {
  it("passes within tolerance, fails outside, fails on no number", () => {
    expect(compare(100, 95).ok).toBe(true);
    expect(compare(100, 80).ok).toBe(false);
    expect(compare(0, 0).ok).toBe(true);
    expect(compare(null, 12).ok).toBe(false);
    expect(compare(12, 0).detail).toContain("vendor 12 vs ledger 0");
  });
});
