import { describe, expect, it } from "vitest";
import { filmingHabits, HABITS } from "../habits";
import { atLocalHour } from "../postTime";

const TZ = "America/New_York";
const NOW = atLocalHour(Date.UTC(2026, 8, 7, 12, 0), 10, TZ); // Monday 10am
const day = (offset: number, hour: number) => atLocalHour(NOW + offset * 86_400_000, hour, TZ);

describe("their filming habits come from what they did (2026-09-07)", () => {
  it("under two real blocks there is no habit; proposed-only blocks do not count", () => {
    expect(filmingHabits([{ kind: "film", start: day(-3, 17), status: "proposed" }], TZ, NOW).hour).toBeNull();
    expect(filmingHabits([{ kind: "film", start: day(-3, 19), status: "booked", consentAt: 1 }], TZ, NOW).n).toBe(1);
    expect(HABITS.minBlocks).toBe(2);
  });

  it("the mode of their block hours and the days they keep become theirs", () => {
    const h = filmingHabits([
      { kind: "film", start: day(-9, 19), status: "booked", consentAt: 1 }, // Saturday 7pm
      { kind: "film", start: day(-2, 19), status: "moved" },                 // Saturday 7pm
      { kind: "film", start: day(-6, 7), status: "booked", filmedAt: 1 },    // Tuesday 7am
      { kind: "edit", start: day(-6, 8), status: "booked", consentAt: 1 },   // not a film block
    ], TZ, NOW);
    expect(h.n).toBe(3);
    expect(h.hour).toBe(19);
    expect(h.days[0]).toBe(6); // Saturday, twice
  });
});
