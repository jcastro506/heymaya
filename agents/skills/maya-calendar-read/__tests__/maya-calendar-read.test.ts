/**
 * maya-calendar-read — Sprint 7 Slice B tests.
 *
 * Five mandatory categories:
 *   1. Cross-tenant isolation — `dedupeAcrossPulls` must use only the
 *      provided `previousIds` set, never a global cache. Demonstrated by
 *      passing two unrelated id sets and verifying outputs don't bleed.
 *   2. Plan-tier × action — gate enforcement happens at the orchestrator
 *      layer (per `SKILL.md` § Plan tier). The skill itself is plan-tier
 *      agnostic; covered by sibling-file scan and the orchestrator tests.
 *   3. Adversarial inputs — malformed payloads, infinite numbers, empty
 *      ids, negative durations, all-day events, mixed shapes.
 *   4. Sibling-file scan — covered repo-wide; locally we assert the
 *      expected exports stay stable so callers don't drift.
 *   5. TODO grep — covered repo-wide.
 */

import { describe, it, expect } from "vitest";
import {
  buildEventsQuery,
  parseGoogleEvents,
  extractContentSignals,
  dedupeAcrossPulls,
  type NormalizedEvent,
} from "../script";

const NOW = new Date("2026-05-06T00:00:00Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* buildEventsQuery                                                            */
/* -------------------------------------------------------------------------- */

describe("buildEventsQuery — happy path", () => {
  it("composes a primary-calendar 14-day lookahead query", () => {
    const q = buildEventsQuery({
      calendarId: "primary",
      sinceMs: NOW,
      untilMs: NOW + 14 * DAY_MS,
    });
    expect(q.calendarId).toBe("primary");
    expect(q.singleEvents).toBe(true);
    expect(q.orderBy).toBe("startTime");
    expect(q.maxResults).toBe(100);
    expect(q.timeMin).toBe("2026-05-06T00:00:00.000Z");
    expect(q.timeMax).toBe("2026-05-20T00:00:00.000Z");
    expect(q.q).toBeUndefined();
  });

  it("passes through a non-empty `q` filter", () => {
    const q = buildEventsQuery({
      calendarId: "primary",
      sinceMs: NOW,
      untilMs: NOW + DAY_MS,
      q: "shoot",
    });
    expect(q.q).toBe("shoot");
  });

  it("drops an empty `q` filter to undefined", () => {
    const q = buildEventsQuery({
      calendarId: "primary",
      sinceMs: NOW,
      untilMs: NOW + DAY_MS,
      q: "",
    });
    expect(q.q).toBeUndefined();
  });
});

describe("buildEventsQuery — adversarial", () => {
  it("rejects an empty calendarId", () => {
    expect(() =>
      buildEventsQuery({ calendarId: "", sinceMs: NOW, untilMs: NOW + DAY_MS })
    ).toThrow(/calendarId/);
  });

  it("rejects whitespace-only calendarId", () => {
    expect(() =>
      buildEventsQuery({ calendarId: "   ", sinceMs: NOW, untilMs: NOW + DAY_MS })
    ).toThrow(/calendarId/);
  });

  it("rejects untilMs <= sinceMs", () => {
    expect(() =>
      buildEventsQuery({ calendarId: "primary", sinceMs: NOW, untilMs: NOW })
    ).toThrow(/untilMs/);
    expect(() =>
      buildEventsQuery({
        calendarId: "primary",
        sinceMs: NOW,
        untilMs: NOW - DAY_MS,
      })
    ).toThrow(/untilMs/);
  });

  it("rejects non-finite numbers", () => {
    expect(() =>
      buildEventsQuery({
        calendarId: "primary",
        sinceMs: Number.NaN,
        untilMs: NOW,
      })
    ).toThrow(/finite/);
    expect(() =>
      buildEventsQuery({
        calendarId: "primary",
        sinceMs: NOW,
        untilMs: Number.POSITIVE_INFINITY,
      })
    ).toThrow(/finite/);
  });
});

/* -------------------------------------------------------------------------- */
/* parseGoogleEvents                                                           */
/* -------------------------------------------------------------------------- */

describe("parseGoogleEvents — happy path", () => {
  it("parses a typical events.list response into NormalizedEvent[]", () => {
    const raw = {
      items: [
        {
          id: "evt-1",
          summary: "Sister's wedding",
          description: "Travel up Friday",
          location: "Vermont",
          start: { dateTime: "2026-05-15T16:00:00-04:00" },
          end: { dateTime: "2026-05-15T22:00:00-04:00" },
          attendees: [{ email: "redacted-by-caller@x.test" }, { email: "x@y" }],
        },
      ],
    };
    const events = parseGoogleEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("evt-1");
    expect(events[0].title).toBe("Sister's wedding");
    expect(events[0].description).toBe("Travel up Friday");
    expect(events[0].location).toBe("Vermont");
    // Attendees collapses to a count — never an email address.
    expect(events[0].attendees).toBe(2);
  });

  it("coerces an all-day event to UTC midnight start / end-of-day end", () => {
    const raw = {
      items: [
        {
          id: "evt-allday",
          summary: "Vacation",
          start: { date: "2026-06-01" },
          end: { date: "2026-06-01" },
        },
      ],
    };
    const events = parseGoogleEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].startMs).toBe(Date.parse("2026-06-01T00:00:00.000Z"));
    expect(events[0].endMs).toBe(
      Date.parse("2026-06-01T00:00:00.000Z") + DAY_MS - 1
    );
  });

  it("falls back to 'Untitled event' when summary is missing", () => {
    const raw = {
      items: [
        {
          id: "evt-x",
          start: { dateTime: "2026-05-12T15:00:00Z" },
          end: { dateTime: "2026-05-12T16:00:00Z" },
        },
      ],
    };
    const events = parseGoogleEvents(raw);
    expect(events[0].title).toBe("Untitled event");
  });
});

describe("parseGoogleEvents — adversarial", () => {
  it("returns [] when raw is null / non-object / wrong shape", () => {
    expect(parseGoogleEvents(null)).toEqual([]);
    expect(parseGoogleEvents("not-json")).toEqual([]);
    expect(parseGoogleEvents(42)).toEqual([]);
    expect(parseGoogleEvents({ noItems: true })).toEqual([]);
  });

  it("drops malformed events silently — partial > poisoned", () => {
    const raw = {
      items: [
        // Missing id
        { summary: "no-id", start: { dateTime: "2026-05-12T15:00:00Z" } },
        // Missing start/end
        { id: "missing-times", summary: "x" },
        // Negative duration
        {
          id: "negative",
          summary: "y",
          start: { dateTime: "2026-05-12T16:00:00Z" },
          end: { dateTime: "2026-05-12T15:00:00Z" },
        },
        // Valid one we expect to survive
        {
          id: "ok",
          summary: "Recording",
          start: { dateTime: "2026-05-12T15:00:00Z" },
          end: { dateTime: "2026-05-12T16:00:00Z" },
        },
        // Junk dateTime
        {
          id: "junk",
          summary: "z",
          start: { dateTime: "not-a-date" },
          end: { dateTime: "2026-05-12T16:00:00Z" },
        },
      ],
    };
    const events = parseGoogleEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("ok");
  });

  it("survives totally bogus item shapes mixed with valid ones", () => {
    const raw = {
      items: [
        "string-item",
        42,
        null,
        {
          id: "ok",
          summary: "Survives",
          start: { dateTime: "2026-05-12T15:00:00Z" },
          end: { dateTime: "2026-05-12T16:00:00Z" },
        },
      ],
    };
    const events = parseGoogleEvents(raw);
    expect(events.map((e) => e.id)).toEqual(["ok"]);
  });
});

/* -------------------------------------------------------------------------- */
/* extractContentSignals                                                       */
/* -------------------------------------------------------------------------- */

describe("extractContentSignals — happy path", () => {
  const wedding: NormalizedEvent = {
    id: "wedding",
    title: "Sister's wedding",
    startMs: NOW + 10 * DAY_MS,
    endMs: NOW + 10 * DAY_MS + 4 * 60 * 60 * 1000,
  };
  const shoot: NormalizedEvent = {
    id: "shoot",
    title: "Content shoot at studio",
    startMs: NOW + 3 * DAY_MS,
    endMs: NOW + 3 * DAY_MS + 4 * 60 * 60 * 1000,
  };
  const standup: NormalizedEvent = {
    id: "standup",
    title: "Daily standup",
    startMs: NOW + DAY_MS,
    endMs: NOW + DAY_MS + 15 * 60 * 1000,
  };

  it("flags wedding as a life event but not a filming day", () => {
    const sig = extractContentSignals([wedding]);
    expect(sig.lifeEvents.map((e) => e.id)).toEqual(["wedding"]);
    expect(sig.potentialFilmingDays).toEqual([]);
  });

  it("flags content shoot as a filming day but not a life event", () => {
    const sig = extractContentSignals([shoot]);
    expect(sig.potentialFilmingDays.map((e) => e.id)).toEqual(["shoot"]);
    expect(sig.lifeEvents).toEqual([]);
  });

  it("ignores recurring noise (standup, dentist, etc.)", () => {
    const sig = extractContentSignals([standup]);
    expect(sig.lifeEvents).toEqual([]);
    expect(sig.potentialFilmingDays).toEqual([]);
  });

  it("inspects description as well as title", () => {
    const event: NormalizedEvent = {
      id: "x",
      title: "Vermont weekend",
      description: "Sister's wedding ceremony Saturday afternoon",
      startMs: NOW + 5 * DAY_MS,
      endMs: NOW + 5 * DAY_MS + 6 * 60 * 60 * 1000,
    };
    const sig = extractContentSignals([event]);
    expect(sig.lifeEvents.map((e) => e.id)).toEqual(["x"]);
  });
});

/* -------------------------------------------------------------------------- */
/* dedupeAcrossPulls                                                           */
/* -------------------------------------------------------------------------- */

describe("dedupeAcrossPulls — happy path", () => {
  const a: NormalizedEvent = {
    id: "a",
    title: "A",
    startMs: NOW,
    endMs: NOW + 60_000,
  };
  const b: NormalizedEvent = { ...a, id: "b" };
  const c: NormalizedEvent = { ...a, id: "c" };

  it("removes events whose ids are in `previousIds`", () => {
    const out = dedupeAcrossPulls([a, b, c], new Set(["a", "c"]));
    expect(out.map((e) => e.id)).toEqual(["b"]);
  });

  it("returns all events when `previousIds` is empty", () => {
    const out = dedupeAcrossPulls([a, b], new Set());
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("CROSS-TENANT: dedupe state from creator A's set never bleeds into creator B's call", () => {
    // Two creators have totally independent previous-id sets. The skill's
    // signature forces the caller to pass per-creator state — there's no
    // hidden global cache. This test pins that contract.
    const creatorAPrev = new Set(["a"]);
    const creatorBPrev = new Set(["b"]);

    const outA = dedupeAcrossPulls([a, b, c], creatorAPrev);
    const outB = dedupeAcrossPulls([a, b, c], creatorBPrev);

    expect(outA.map((e) => e.id)).toEqual(["b", "c"]);
    expect(outB.map((e) => e.id)).toEqual(["a", "c"]);
    // Sets stayed unmutated.
    expect([...creatorAPrev]).toEqual(["a"]);
    expect([...creatorBPrev]).toEqual(["b"]);
  });
});

/* -------------------------------------------------------------------------- */
/* SIBLING-FILE-SCAN — exports stay stable so callers don't drift             */
/* -------------------------------------------------------------------------- */

describe("public surface — pinned for sibling-file scan", () => {
  it("exposes exactly the four documented functions", () => {
    expect(typeof buildEventsQuery).toBe("function");
    expect(typeof parseGoogleEvents).toBe("function");
    expect(typeof extractContentSignals).toBe("function");
    expect(typeof dedupeAcrossPulls).toBe("function");
  });
});
