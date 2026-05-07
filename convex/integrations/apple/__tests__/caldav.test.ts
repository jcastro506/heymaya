/**
 * Apple CalDAV wrapper tests (Sprint 9.8 Workstream B).
 *
 * Pure-function coverage — buildEventIcs + escapeIcsText. The
 * network-touching wrappers (validateAndListCalendars, createEvent) are
 * exercised end-to-end against a real iCloud account in the smoke harness;
 * unit-mocking tsdav's internal request shape is brittle and would test
 * the mock more than the wrapper.
 */

import { describe, expect, it } from "vitest";
import { _internal, AppleCaldavError, buildEventIcs } from "../caldav";

describe("buildEventIcs", () => {
  it("produces a VCALENDAR + VEVENT envelope with all required fields", () => {
    const ics = buildEventIcs(
      {
        calendarUrl: "https://caldav.icloud.com/123/calendars/home/",
        summary: "Film batch",
        startIso: "2026-05-12T15:00:00-04:00",
        endIso: "2026-05-12T17:00:00-04:00",
      },
      "test-uid-1@heymaya.ai"
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:test-uid-1@heymaya.ai");
    expect(ics).toContain("SUMMARY:Film batch");
    // Times normalized to UTC: 15:00-04:00 → 19:00Z
    expect(ics).toContain("DTSTART:20260512T190000Z");
    expect(ics).toContain("DTEND:20260512T210000Z");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("includes optional DESCRIPTION + LOCATION when provided", () => {
    const ics = buildEventIcs(
      {
        calendarUrl: "https://x/",
        summary: "Lunch",
        startIso: "2026-05-12T12:00:00-04:00",
        endIso: "2026-05-12T13:00:00-04:00",
        description: "Catch up with team",
        location: "Cafe X, NYC",
      },
      "uid-2"
    );
    expect(ics).toContain("DESCRIPTION:Catch up with team");
    expect(ics).toContain("LOCATION:Cafe X\\, NYC");
  });

  it("uses CRLF line endings (RFC 5545 requires)", () => {
    const ics = buildEventIcs(
      {
        calendarUrl: "https://x/",
        summary: "x",
        startIso: "2026-05-12T12:00:00-04:00",
        endIso: "2026-05-12T13:00:00-04:00",
      },
      "uid-3"
    );
    expect(ics).toContain("\r\n");
    const bareLf = /(?<!\r)\n/.test(ics);
    expect(bareLf).toBe(false);
  });
});

describe("escapeIcsText", () => {
  const escape = _internal.escapeIcsText;

  it("escapes commas (RFC 5545 § 3.3.11)", () => {
    expect(escape("Cafe X, NYC")).toBe("Cafe X\\, NYC");
  });

  it("escapes semicolons", () => {
    expect(escape("a;b")).toBe("a\\;b");
  });

  it("escapes backslashes BEFORE other escapes (avoid double-escaping)", () => {
    expect(escape("a\\b")).toBe("a\\\\b");
    // A literal backslash followed by comma must produce backslash-backslash
    // followed by escaped-comma, not a single escaped pair.
    expect(escape("\\,")).toBe("\\\\\\,");
  });

  it("escapes newlines as literal \\n", () => {
    expect(escape("line1\nline2")).toBe("line1\\nline2");
    expect(escape("line1\r\nline2")).toBe("line1\\nline2");
  });
});

describe("AppleCaldavError", () => {
  it("preserves cause + status fields", () => {
    const inner = new Error("network");
    const err = new AppleCaldavError("auth-failed", inner, 401);
    expect(err.name).toBe("AppleCaldavError");
    expect(err.message).toBe("auth-failed");
    expect(err.cause).toBe(inner);
    expect(err.status).toBe(401);
  });
});

describe("constants", () => {
  it("targets iCloud's CalDAV server", () => {
    expect(_internal.ICLOUD_CALDAV_SERVER).toBe("https://caldav.icloud.com");
  });
});
