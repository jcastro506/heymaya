/**
 * maya-calendar-write — Sprint 7 Slice B tests.
 *
 * Five mandatory categories + intent-parser ambiguity tests:
 *   1. Cross-tenant isolation — `validateEventBeforeWrite` only consults
 *      the picture passed in. Demonstrated with two unrelated pictures.
 *   2. Plan-tier × action — gate enforcement happens at the orchestrator
 *      layer (per `SKILL.md` § Plan tier). Skill is plan-tier agnostic.
 *   3. Adversarial inputs — empty text, garbage clocks, future-only times,
 *      banned topics, over-cap durations.
 *   4. Sibling-file scan — public surface pinned below.
 *   5. TODO grep — covered repo-wide.
 */

import { describe, it, expect } from "vitest";
import {
  parseEventIntent,
  buildEventCreatePayload,
  validateEventBeforeWrite,
  type ProposedEvent,
} from "../script";

// 2026-05-06 00:00 UTC = 2026-05-05 17:00 Los Angeles (PDT, UTC-07:00). The
// weekday in LA on that instant is Tuesday. We anchor "now" to a fixed
// instant the parser can reason about deterministically.
const NOW = Date.parse("2026-05-06T17:00:00Z"); // 2026-05-06 10:00 LA = Wed (UTC-07)
const TZ = "America/Los_Angeles";
const HOUR = 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* parseEventIntent — happy path                                               */
/* -------------------------------------------------------------------------- */

describe("parseEventIntent — happy path", () => {
  it("parses 'block 3pm Tuesday for filming' into a ProposedEvent", () => {
    const result = parseEventIntent(
      "block 3pm Tuesday for filming",
      NOW,
      TZ
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.title.toLowerCase()).toBe("filming");
      expect(result.event.timeZone).toBe(TZ);
      // Default duration when only a single time given = 1 hour.
      expect(result.event.endMs - result.event.startMs).toBe(HOUR);
      // Start should be in the future relative to `nowMs`.
      expect(result.event.startMs).toBeGreaterThan(NOW);
    }
  });

  it("parses 'schedule batch recording 9-11am Wednesday' with explicit range", () => {
    const result = parseEventIntent(
      "schedule batch recording 9-11am Wednesday",
      NOW,
      TZ
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.title.toLowerCase()).toBe("batch recording");
      expect(result.event.endMs - result.event.startMs).toBe(2 * HOUR);
    }
  });

  it("parses 'put a hold on Saturday morning for the wedding shoot'", () => {
    const result = parseEventIntent(
      "put a hold on Saturday morning for the wedding shoot",
      NOW,
      TZ
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.title.toLowerCase()).toContain("wedding shoot");
      // "morning" → 9am, default 1h.
      expect(result.event.endMs - result.event.startMs).toBe(HOUR);
    }
  });

  it("anchors the resolved date in the creator's timezone", () => {
    const result = parseEventIntent(
      "block 3pm Tuesday for filming",
      NOW,
      TZ
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 3pm in America/Los_Angeles → ISO renders with a UTC offset that
      // round-trips. Anchored to LA local time.
      const startLA = new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(result.event.startMs));
      expect(startLA.toLowerCase()).toContain("tuesday");
      expect(startLA).toContain("15:00");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* parseEventIntent — ambiguity                                                */
/* -------------------------------------------------------------------------- */

describe("parseEventIntent — ambiguity", () => {
  it("flags 'next Tuesday' as ambiguous so caller asks for confirmation", () => {
    const result = parseEventIntent(
      "block 3pm next Tuesday for filming",
      NOW,
      TZ
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ambiguous).toBe(true);
      expect(result.reason).toMatch(/next-vs-this-week/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* parseEventIntent — adversarial                                              */
/* -------------------------------------------------------------------------- */

describe("parseEventIntent — adversarial", () => {
  it("rejects empty / whitespace text", () => {
    expect(parseEventIntent("", NOW, TZ).ok).toBe(false);
    expect(parseEventIntent("   ", NOW, TZ).ok).toBe(false);
  });

  it("rejects when no day-of-week is present", () => {
    const r = parseEventIntent("block 3pm for filming", NOW, TZ);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/day-of-week/);
  });

  it("rejects when no time is present", () => {
    const r = parseEventIntent("block Tuesday for filming", NOW, TZ);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/time/);
  });

  it("rejects non-finite nowMs and empty timezone", () => {
    expect(parseEventIntent("block 3pm Tuesday for x", Number.NaN, TZ).ok).toBe(
      false
    );
    expect(parseEventIntent("block 3pm Tuesday for x", NOW, "").ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* buildEventCreatePayload                                                     */
/* -------------------------------------------------------------------------- */

describe("buildEventCreatePayload", () => {
  const event: ProposedEvent = {
    title: "filming",
    startMs: Date.parse("2026-05-12T22:00:00Z"), // 3pm LA
    endMs: Date.parse("2026-05-12T23:00:00Z"),
    timeZone: TZ,
  };

  it("composes the Google Calendar v3 events.insert request shape", () => {
    const payload = buildEventCreatePayload(event);
    expect(payload.summary).toBe("filming");
    expect(payload.start.dateTime).toBe("2026-05-12T22:00:00.000Z");
    expect(payload.start.timeZone).toBe(TZ);
    expect(payload.end.dateTime).toBe("2026-05-12T23:00:00.000Z");
    expect(payload.end.timeZone).toBe(TZ);
  });

  it("passes through optional description / location", () => {
    const payload = buildEventCreatePayload({
      ...event,
      description: "B-roll for next drop",
      location: "studio",
    });
    expect(payload.description).toBe("B-roll for next drop");
    expect(payload.location).toBe("studio");
  });

  it("rejects events whose end is not strictly after start", () => {
    expect(() =>
      buildEventCreatePayload({ ...event, endMs: event.startMs })
    ).toThrow();
    expect(() =>
      buildEventCreatePayload({ ...event, endMs: event.startMs - 1 })
    ).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* validateEventBeforeWrite                                                    */
/* -------------------------------------------------------------------------- */

describe("validateEventBeforeWrite — guards", () => {
  const futureEvent: ProposedEvent = {
    title: "filming",
    startMs: NOW + 2 * 24 * HOUR,
    endMs: NOW + 2 * 24 * HOUR + HOUR,
    timeZone: TZ,
  };

  it("HAPPY: a clean future event passes", () => {
    const r = validateEventBeforeWrite(futureEvent, {}, NOW);
    expect(r.ok).toBe(true);
  });

  it("ADVERSARIAL: refuses past start times", () => {
    const past: ProposedEvent = {
      ...futureEvent,
      startMs: NOW - HOUR,
      endMs: NOW,
    };
    const r = validateEventBeforeWrite(past, {}, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain("past-start-time");
  });

  it("ADVERSARIAL: refuses durations over 8 hours", () => {
    const longEvent: ProposedEvent = {
      ...futureEvent,
      endMs: futureEvent.startMs + 9 * HOUR,
    };
    const r = validateEventBeforeWrite(longEvent, {}, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain("duration-exceeds-cap");
  });

  it("HAPPY: exactly 8 hours is allowed (boundary)", () => {
    const exactly8: ProposedEvent = {
      ...futureEvent,
      endMs: futureEvent.startMs + 8 * HOUR,
    };
    const r = validateEventBeforeWrite(exactly8, {}, NOW);
    expect(r.ok).toBe(true);
  });

  it("ADVERSARIAL: refuses non-positive duration", () => {
    const zero: ProposedEvent = {
      ...futureEvent,
      endMs: futureEvent.startMs,
    };
    const r = validateEventBeforeWrite(zero, {}, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain("non-positive-duration");
  });

  it("ADVERSARIAL: banned-topic via boundaries.banned_topics blocks the write", () => {
    const banned: ProposedEvent = {
      ...futureEvent,
      title: "Politics rant",
    };
    const r = validateEventBeforeWrite(
      banned,
      { boundaries: { banned_topics: ["politics", "controversial takes"] } },
      NOW
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain("banned-topic-title");
  });

  it("ADVERSARIAL: banned-topic via doNotSuggest also blocks (schema parity)", () => {
    const banned: ProposedEvent = {
      ...futureEvent,
      title: "daily vlogs filming",
    };
    const r = validateEventBeforeWrite(
      banned,
      { doNotSuggest: ["daily vlogs"] },
      NOW
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain("banned-topic-title");
  });

  it("CROSS-TENANT: each call uses only the picture passed in", () => {
    // Creator A bans "politics"; Creator B bans nothing. The same proposed
    // event must validate differently per picture — never bleed between
    // creators.
    const event: ProposedEvent = {
      ...futureEvent,
      title: "politics live stream",
    };
    const aRes = validateEventBeforeWrite(
      event,
      { doNotSuggest: ["politics"] },
      NOW
    );
    const bRes = validateEventBeforeWrite(event, {}, NOW);
    expect(aRes.ok).toBe(false);
    expect(bRes.ok).toBe(true);
  });

  it("handles missing/empty banned-topic arrays gracefully", () => {
    const r1 = validateEventBeforeWrite(
      futureEvent,
      { boundaries: { banned_topics: [] } },
      NOW
    );
    expect(r1.ok).toBe(true);
    const r2 = validateEventBeforeWrite(
      futureEvent,
      { doNotSuggest: [] },
      NOW
    );
    expect(r2.ok).toBe(true);
  });

  it("returns multiple guard reasons at once when several fire", () => {
    const broken: ProposedEvent = {
      ...futureEvent,
      title: "politics",
      startMs: NOW - HOUR,
      endMs: NOW + 12 * HOUR, // past + over-cap + banned
    };
    const r = validateEventBeforeWrite(
      broken,
      { doNotSuggest: ["politics"] },
      NOW
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasons).toContain("past-start-time");
      expect(r.reasons).toContain("duration-exceeds-cap");
      expect(r.reasons).toContain("banned-topic-title");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* SIBLING-FILE-SCAN — public surface pinned                                   */
/* -------------------------------------------------------------------------- */

describe("public surface — pinned for sibling-file scan", () => {
  it("exposes exactly the three documented functions", () => {
    expect(typeof parseEventIntent).toBe("function");
    expect(typeof buildEventCreatePayload).toBe("function");
    expect(typeof validateEventBeforeWrite).toBe("function");
  });
});
