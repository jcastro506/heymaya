/** Horizon sim: dates written in words move when the world ages (a race "on oct 12" must come closer). */
import { describe, expect, it } from "vitest";
import { shiftWrittenDates, shiftTimes } from "../livingSim";

const D = 86_400_000;
const NOW = Date.UTC(2026, 8, 25);

describe("shiftWrittenDates", () => {
  it("moves the date and keeps how it was written", () => {
    expect(shiftWrittenDates("running the chicago half on oct 12", -7 * D, NOW)).toBe("running the chicago half on oct 5");
    expect(shiftWrittenDates("Chicago Marathon, October 11, 2026", -14 * D, NOW)).toBe("Chicago Marathon, September 27, 2026");
    expect(shiftWrittenDates("race on Nov. 3rd", -7 * D, NOW)).toBe("race on Oct. 27th");
    expect(shiftWrittenDates("moving Dec 1", -35 * D, NOW)).toBe("moving Oct 27");
  });
  it("leaves a verb alone and years right across the new year", () => {
    expect(shiftWrittenDates("i may 2 posts this week", -7 * D, NOW)).toBe("i may 2 posts this week");
    expect(shiftWrittenDates("race Jan 3", -7 * D, NOW)).toBe("race Dec 27");
  });
  it("ageing a note moves both its epoch and its words", () => {
    const note = { text: "running the chicago marathon on oct 11", at: NOW };
    expect(shiftTimes(note, -7 * D, NOW)).toEqual({ text: "running the chicago marathon on oct 4", at: NOW - 7 * D });
  });
});
