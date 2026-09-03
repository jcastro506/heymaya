/**
 * The gate's arithmetic, which is the part that must not be wrong: a gate that cries wolf
 * gets ignored, and an ignored gate is worse than none.
 */
import { describe, expect, it } from "vitest";
import { compare, summarize, TOLERANCE, type Summary } from "../gate";

const base = (over: Partial<Summary> = {}): Summary => ({
  n: 10, sent: 10, passRate: 0.8, sentRate: 1, scenarios: ["a"],
  judge: { corny: 0.5, generic: 0.5, specific: 2.5, wouldSend: 2.5, soundsLikeThem: 2.5 },
  ...over,
});

describe("summarize", () => {
  it("separates how often she spoke from how good it was", () => {
    // Ten chances, four messages, three of them clean.
    const rows = [
      { pass: true, judge: undefined }, { pass: true, judge: undefined },
      { pass: true, judge: undefined }, { pass: false, judge: undefined },
    ];
    const s = summarize(rows, 10, ["a"]);
    expect(s.sentRate).toBe(0.4);
    expect(s.passRate).toBe(0.75);
  });

  it("averages only the rows a judge actually scored", () => {
    const j = { corny: 1, generic: 2, flattering: 0, toolSpeak: 0, specific: 3, wouldSend: 2, soundsLikeThem: 1, note: "", model: "m" };
    const s = summarize([{ pass: true, judge: j }, { pass: true, judge: undefined }], 2, ["a"]);
    expect(s.judge.generic).toBe(2);
    expect(s.judge.soundsLikeThem).toBe(1);
  });

  it("an older row with no voice score counts as fine, not as nobody's voice", () => {
    const j = { corny: 0, generic: 0, flattering: 0, toolSpeak: 0, specific: 3, wouldSend: 3, note: "", model: "m" } as never;
    expect(summarize([{ pass: true, judge: j }], 1, ["a"]).judge.soundsLikeThem).toBe(3);
  });

  it("no runs is zero, not a divide by zero", () => {
    const s = summarize([], 0, []);
    expect(s.passRate).toBe(0);
    expect(s.sentRate).toBe(0);
  });
});

describe("compare", () => {
  it("passes when nothing moved", () => {
    expect(compare(base(), base()).pass).toBe(true);
  });

  it("catches a real drop in pass rate", () => {
    const r = compare(base(), base({ passRate: 0.8 - TOLERANCE.passRate - 0.01 }));
    expect(r.pass).toBe(false);
    expect(r.deltas.find((d) => d.name === "passRate")?.regressed).toBe(true);
  });

  it("ignores movement inside tolerance, because that is the model breathing", () => {
    expect(compare(base(), base({ passRate: 0.8 - TOLERANCE.passRate + 0.01 })).pass).toBe(true);
  });

  it("catches her getting cornier and more generic", () => {
    const worse = base();
    worse.judge = { ...worse.judge, corny: 0.5 + TOLERANCE.judgeBad + 0.1, generic: 0.5 + TOLERANCE.judgeBad + 0.1 };
    const r = compare(base(), worse);
    expect(r.pass).toBe(false);
    expect(r.deltas.filter((d) => d.regressed).map((d) => d.name).sort()).toEqual(["corny", "generic"]);
  });

  it("catches her stopping sounding like the creator — the thing today's change was about", () => {
    const worse = base();
    worse.judge = { ...worse.judge, soundsLikeThem: 2.5 - TOLERANCE.judgeGood - 0.1 };
    expect(compare(base(), worse).pass).toBe(false);
  });

  it("improvement is never a regression", () => {
    const better = base({ passRate: 1 });
    better.judge = { corny: 0, generic: 0, specific: 3, wouldSend: 3, soundsLikeThem: 3 };
    const r = compare(base(), better);
    expect(r.pass).toBe(true);
    expect(r.deltas.every((d) => !d.regressed)).toBe(true);
  });

  it("going quiet is a regression too, not a clean sheet", () => {
    // She sends almost nothing, so everything she does send passes. That must not read as better.
    const quiet = base({ passRate: 1, sentRate: 1 - TOLERANCE.sentRate - 0.05 });
    const r = compare(base(), quiet);
    expect(r.pass).toBe(false);
    expect(r.deltas.find((d) => d.name === "sentRate")?.regressed).toBe(true);
  });
});
