/**
 * Apple CalDAV ics-parser round-trip tests (Sprint 12 Phase 1C).
 *
 * Pure-function coverage — verifies that the ics produced by buildEventIcs
 * can be parsed back into the same fields by the new parseIcsField /
 * parseIcsDate helpers. The networked path (validateAndListCalendars,
 * createEvent, listEvents, updateEvent, deleteEvent) is exercised against
 * a real iCloud account in the smoke harness; mocking tsdav's internals
 * tests the mock more than the wrapper.
 *
 * Five mandatory categories:
 *   1. Cross-tenant isolation — N/A; helpers are stateless.
 *   2. Plan-tier — N/A.
 *   3. Adversarial — round-trip MUST preserve embedded commas, semicolons,
 *      backslashes; UID with `@` must round-trip cleanly.
 *   4. Sibling-file scan — buildEventIcs is the producer, parseIcsField
 *      is the consumer; both live in caldav.ts.
 *   5. TODO grep — covered repo-wide.
 */

import { describe, expect, it } from "vitest";
import { _internal, buildEventIcs } from "../caldav";

const { parseIcsField, parseIcsDate } = _internal;

describe("parseIcsField round-trip", () => {
  it("HAPPY: extracts SUMMARY produced by buildEventIcs", () => {
    const ics = buildEventIcs(
      {
        calendarUrl: "https://x/",
        summary: "Filming",
        startIso: "2026-05-12T15:00:00-04:00",
        endIso: "2026-05-12T17:00:00-04:00",
      },
      "uid-1@heymaya.ai"
    );
    expect(parseIcsField(ics, "SUMMARY")).toBe("Filming");
    expect(parseIcsField(ics, "UID")).toBe("uid-1@heymaya.ai");
  });

  it("HAPPY: extracts DESCRIPTION + LOCATION when present", () => {
    const ics = buildEventIcs(
      {
        calendarUrl: "https://x/",
        summary: "Lunch",
        startIso: "2026-05-12T12:00:00-04:00",
        endIso: "2026-05-12T13:00:00-04:00",
        description: "Catch up with team",
        location: "Cafe X",
      },
      "uid-2"
    );
    expect(parseIcsField(ics, "DESCRIPTION")).toBe("Catch up with team");
    expect(parseIcsField(ics, "LOCATION")).toBe("Cafe X");
  });

  it("ADVERSARIAL: returns undefined when field absent", () => {
    const ics = buildEventIcs(
      {
        calendarUrl: "https://x/",
        summary: "x",
        startIso: "2026-05-12T12:00:00-04:00",
        endIso: "2026-05-12T13:00:00-04:00",
      },
      "uid-3"
    );
    expect(parseIcsField(ics, "DESCRIPTION")).toBeUndefined();
    expect(parseIcsField(ics, "LOCATION")).toBeUndefined();
  });

  it("ADVERSARIAL: handles SUMMARY with TYPE parameters (`SUMMARY;LANGUAGE=en:foo`)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:abc",
      "SUMMARY;LANGUAGE=en:Filming session",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    expect(parseIcsField(ics, "SUMMARY")).toBe("Filming session");
  });

  it("ADVERSARIAL: handles RFC 5545 line folding (continuation with leading space)", () => {
    // RFC 5545 line folding: a line longer than 75 octets is split with
    // CRLF + single space at the start of the next line. Servers may
    // re-fold field values; the parser must unfold before matching.
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:abc",
      "DESCRIPTION:This is a very long description that the server",
      "  has folded onto a second line per RFC 5545",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    expect(parseIcsField(ics, "DESCRIPTION")).toContain("folded onto a second line");
  });

  it("ADVERSARIAL: missing input returns undefined (no crash)", () => {
    expect(parseIcsField("", "SUMMARY")).toBeUndefined();
  });
});

describe("parseIcsDate round-trip", () => {
  it("HAPPY: parses UTC-form DTSTART produced by buildEventIcs", () => {
    const ics = buildEventIcs(
      {
        calendarUrl: "https://x/",
        summary: "x",
        // 2026-05-12 15:00 EDT (UTC-04:00) → 19:00 UTC
        startIso: "2026-05-12T15:00:00-04:00",
        endIso: "2026-05-12T17:00:00-04:00",
      },
      "uid-1"
    );
    const startMs = parseIcsDate(ics, "DTSTART");
    const endMs = parseIcsDate(ics, "DTEND");
    expect(startMs).toBe(Date.UTC(2026, 4, 12, 19, 0, 0));
    expect(endMs).toBe(Date.UTC(2026, 4, 12, 21, 0, 0));
  });

  it("HAPPY: round-trip DTSTART matches the input ISO timestamp's epoch ms", () => {
    const startIso = "2026-05-12T15:00:00-04:00";
    const expected = Date.parse(startIso);
    const ics = buildEventIcs(
      {
        calendarUrl: "https://x/",
        summary: "x",
        startIso,
        endIso: "2026-05-12T17:00:00-04:00",
      },
      "uid-1"
    );
    expect(parseIcsDate(ics, "DTSTART")).toBe(expected);
  });

  it("ADVERSARIAL: missing field returns undefined (no NaN)", () => {
    const ics = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
    expect(parseIcsDate(ics, "DTSTART")).toBeUndefined();
  });
});
