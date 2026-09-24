import { describe, expect, it } from "vitest";
import { availabilitySection, bestHoursLine, freeWindows } from "../availability";
import { atLocalHour } from "../postTime";

const TZ = "America/New_York";
const MON_10AM = atLocalHour(Date.UTC(2026, 8, 7, 12, 0), 10, TZ);
const MON_8PM = atLocalHour(Date.UTC(2026, 8, 7, 12, 0), 20, TZ);

describe("her calendar sense (2026-09-07: next open slot on a monday was thursday)", () => {
  it("today counts: at 10am the first window is today at their usual hour, then tomorrow", () => {
    const w = freeWindows({ now: MON_10AM, timeZone: TZ, busy: [], filmHour: 17 });
    expect(w[0].label).toBe("today 5 pm");
    expect(w[0].why).toBe("their usual filming hour"); // filmHour given
    expect(w[1].label).toBe("tomorrow 5 pm");
    expect(w.length).toBe(4);
  });

  it("after the cutoff today is skipped; a busy usual hour moves to the nearest free slot; quiet hours are never offered", () => {
    const w = freeWindows({ now: MON_8PM, timeZone: TZ, busy: [], filmHour: 17 });
    expect(w[0].label).toBe("tomorrow 5 pm");
    const tue5 = atLocalHour(MON_10AM + 86_400_000, 17, TZ);
    const busy = freeWindows({ now: MON_10AM, timeZone: TZ, busy: [{ start: tue5, end: tue5 + 3_600_000 }], filmHour: 17 });
    expect(busy[1].label).not.toBe("tomorrow 5 pm");
    expect(busy[1].why).toMatch(/nearest free slot/);
    const late = freeWindows({ now: MON_10AM, timeZone: TZ, busy: [], filmHour: 23, quiet: { start: "22:00", end: "07:00" } });
    expect(late.every((x) => !/1[01] pm|12 am/.test(x.label))).toBe(true);
  });

  it("best hours come from their numbers, or say they are a default", () => {
    expect(bestHoursLine({ hours: [], confidence: "none", defaultHour: 20 }, TZ)).toMatch(/default/);
    expect(bestHoursLine({ hours: [{ hour: 20, n: 3, medianMultiple: 1.8 }, { hour: 12, n: 2, medianMultiple: 1.1 }], confidence: "thin", defaultHour: 20 }, TZ)).toBe("8 pm (3 posts) and 12 pm (2 posts) from their own posts (thin read)");
    const section = availabilitySection(freeWindows({ now: MON_10AM, timeZone: TZ, busy: [], filmHour: 17 }), "8 pm (3 posts) from their own posts (thin read)");
    expect(section).toMatch(/next open slot" means the FIRST/);
    expect(section).toMatch(/- today 5 pm/);
  });
});
