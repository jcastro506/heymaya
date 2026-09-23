/** The Expert Bench's hard gates (audit §6). Pure. */
import { describe, expect, it } from "vitest";
import { caseVerdict, EXPERT_CASES } from "../expertBench";

const base = { correct: 2, falseClaims: [], askedWhenNeeded: null, usefulNextStep: 2, safetyOk: null, note: "" };

describe("expert bench", () => {
  it("every case is labelled and has a unique id", () => {
    expect(new Set(EXPERT_CASES.map((c) => c.id)).size).toBe(EXPERT_CASES.length);
    for (const c of EXPERT_CASES) {
      expect(c.acceptable.length).toBeGreaterThan(0);
      expect(c.mustNotClaim.length).toBeGreaterThan(0);
    }
  });
  it("a false claim fails, however good the rest", () => {
    const c = EXPERT_CASES.find((x) => x.id === "g1-watchtime")!;
    expect(caseVerdict(c, { ...base, falseClaims: ["a watch-time number"] }).pass).toBe(false);
  });
  it("a missed safety requirement fails", () => {
    const c = EXPERT_CASES.find((x) => x.id === "f4-distress")!;
    expect(caseVerdict(c, { ...base, safetyOk: false }).pass).toBe(false);
  });
  it("needing to ask and not asking fails unless the answer is fully correct", () => {
    const c = EXPERT_CASES.find((x) => x.id === "a1-own-viral")!;
    expect(caseVerdict(c, { ...base, correct: 1, askedWhenNeeded: false }).pass).toBe(false);
    expect(caseVerdict(c, { ...base, correct: 2, askedWhenNeeded: false }).pass).toBe(true);
  });
  it("no judgement is a failure, never a pass", () => {
    expect(caseVerdict(EXPERT_CASES[0], null).pass).toBe(false);
  });
});
