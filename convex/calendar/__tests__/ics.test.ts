import { describe, expect, it } from "vitest";
import { buildIcs, icsStamp } from "../ics";

describe("the calendar file", () => {
  const now = Date.UTC(2026, 8, 6, 22, 0);
  const blocks = [
    { id: "b1", kind: "film" as const, title: "film: the shoe rack list", start: Date.UTC(2026, 8, 8, 20, 0), end: Date.UTC(2026, 8, 8, 20, 45) },
    { id: "b2", kind: "post" as const, title: "post: the shoe rack list, with a; comma", start: Date.UTC(2026, 8, 8, 23, 15), end: Date.UTC(2026, 8, 8, 23, 30) },
  ];

  it("is a valid VCALENDAR with one VEVENT per block, UTC stamps, and block ids as UIDs", () => {
    const ics = buildIcs(blocks, now);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect(ics).toContain("UID:b1@heymaya");
    expect(ics).toContain("DTSTART:20260908T200000Z");
    expect(ics).toContain("DTEND:20260908T204500Z");
    expect(icsStamp(Date.UTC(2026, 0, 5, 9, 7))).toBe("20260105T090700Z");
  });

  it("escapes commas and semicolons in titles and strips the kind prefix into a label", () => {
    const ics = buildIcs(blocks, now);
    expect(ics).toContain("SUMMARY:post: the shoe rack list\\, with a\; comma");
    expect(ics).toContain("SUMMARY:film: the shoe rack list");
  });

  it("folds long lines at the RFC limit", () => {
    const long = [{ id: "x", kind: "film" as const, title: "film: " + "a very long hook ".repeat(8), start: now, end: now + 60_000 }];
    const ics = buildIcs(long, now);
    for (const line of ics.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
  });
});
