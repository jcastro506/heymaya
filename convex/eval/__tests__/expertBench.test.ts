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

describe("the judge sees what her tools returned", () => {
  it("each trace entry keeps a short copy of the tool's answer", async () => {
    const { runTool, DEFAULT_BUDGET, TRACE_RESULT_CAP } = await import("../../agent/tools");
    const trace: Parameters<typeof runTool>[4] = [];
    const ctx = { runQuery: async () => [], runMutation: async () => null, runAction: async () => null } as never;
    const out = await runTool(ctx, "c" as never, { name: "week_plan", args: { why: "w" } }, DEFAULT_BUDGET(), trace);
    expect(trace[0].result).toBe(out.slice(0, TRACE_RESULT_CAP));
  });
});

describe("C1: 'why it's for you' is written to them", () => {
  it("flags a third-person fitWhy, passes a second-person one", async () => {
    const { writtenAboutThem, runChecks } = await import("../checks");
    expect(writtenAboutThem("the frantic monologue mirrors her top runner-meme format (610% of her normal)")).toBe(true);
    expect(writtenAboutThem("your deadpan post-run clips are your best format, and this is one")).toBe(false);
    const checks = runChecks({ text: "the cut got me. yours to take.", evidence: { idea: { fitWhy: "matches her top format" } }, kind: "scout" });
    expect(checks.find((c) => c.name === "fit_why_to_them")?.pass).toBe(false);
  });
});
