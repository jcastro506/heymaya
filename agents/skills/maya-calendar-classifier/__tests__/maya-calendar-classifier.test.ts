import { describe, it, expect } from "vitest";
import {
  classifyByHeuristic,
  buildClassifierPrompt,
  dispatch,
  PrivacyViolationError,
} from "../script";

const NOW = new Date("2026-04-26T00:00:00Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

describe("maya-calendar-classifier — heuristic happy path", () => {
  it("classifies a wedding 10 days out as creator-relevant-life-event with build-up arc", () => {
    const result = classifyByHeuristic(
      {
        title: "Sister's wedding in Vermont",
        start: NOW + 10 * DAY_MS,
        end: NOW + 10 * DAY_MS + 4 * 60 * 60 * 1000,
        attendees: 12,
        description: "Travel up Friday, ceremony Saturday 4pm.",
        isPrivate: false,
      },
      NOW
    );
    expect("classification" in result).toBe(true);
    if ("classification" in result) {
      expect(result.classification).toBe("creator-relevant-life-event");
      expect(result.contentArcShape).toBe("build-up-day-of-recap");
      expect(result.confidence).toBeGreaterThan(0.7);
    }
  });

  it("classifies a daily standup as recurring-noise", () => {
    const result = classifyByHeuristic(
      {
        title: "Daily standup",
        start: NOW + DAY_MS,
        end: NOW + DAY_MS + 15 * 60 * 1000,
        attendees: 6,
        description: "Daily team sync.",
        isPrivate: false,
      },
      NOW
    );
    if ("classification" in result) {
      expect(result.classification).toBe("recurring-noise");
      expect(result.contentArcShape).toBe("none");
    } else {
      throw new Error("Expected heuristic classification");
    }
  });

  it("classifies a 'content shoot' as creator-shoot with day-of arc", () => {
    const result = classifyByHeuristic(
      {
        title: "Content shoot at studio",
        start: NOW + 3 * DAY_MS,
        end: NOW + 3 * DAY_MS + 4 * 60 * 60 * 1000,
        attendees: 2,
        description: "B-roll for next week's drop.",
        isPrivate: false,
      },
      NOW
    );
    if ("classification" in result) {
      expect(result.classification).toBe("creator-shoot");
      expect(result.contentArcShape).toBe("day-of-only");
    }
  });

  it("classifies a private event with a 1-word title as personal-private (fast path)", () => {
    const result = classifyByHeuristic(
      {
        title: "Therapy",
        start: NOW + DAY_MS,
        end: NOW + DAY_MS + 60 * 60 * 1000,
        attendees: 0,
        description: "",
        isPrivate: true,
      },
      NOW
    );
    if ("classification" in result) {
      expect(result.classification).toBe("personal-private");
      expect(result.confidence).toBeGreaterThan(0.9);
    }
  });

  it("derives 'recap-only' arc when life event was today/yesterday", () => {
    const result = classifyByHeuristic(
      {
        title: "Wedding",
        start: NOW - DAY_MS, // yesterday
        end: NOW - DAY_MS + 60 * 60 * 1000,
        attendees: 50,
        description: "Wedding day.",
        isPrivate: false,
      },
      NOW
    );
    if ("classification" in result) {
      expect(result.classification).toBe("creator-relevant-life-event");
      expect(result.contentArcShape).toBe("recap-only");
    }
  });
});

describe("maya-calendar-classifier — privacy contract enforcement", () => {
  it("throws PrivacyViolationError when a private event has a non-blank description", () => {
    expect(() =>
      classifyByHeuristic(
        {
          title: "Therapy",
          start: NOW,
          end: NOW + 60 * 60 * 1000,
          attendees: 0,
          description: "Discussing the trip with mom",
          isPrivate: true,
        },
        NOW
      )
    ).toThrow(PrivacyViolationError);
  });

  it("throws PrivacyViolationError when a private event has non-zero attendees", () => {
    expect(() =>
      classifyByHeuristic(
        {
          title: "Therapy",
          start: NOW,
          end: NOW + 60 * 60 * 1000,
          attendees: 1,
          description: "",
          isPrivate: true,
        },
        NOW
      )
    ).toThrow(PrivacyViolationError);
  });

  it("buildClassifierPrompt enforces the same privacy contract", () => {
    expect(() =>
      buildClassifierPrompt({
        title: "Therapy",
        start: NOW,
        end: NOW + 60 * 60 * 1000,
        attendees: 1,
        description: "",
        isPrivate: true,
      })
    ).toThrow(PrivacyViolationError);
  });
});

describe("maya-calendar-classifier — adversarial / ambiguous", () => {
  it("returns 'unknown' when title matches multiple categories (forces LLM disambiguation)", () => {
    // "shoot lunch with team" matches both creator-shoot AND recurring-noise (lunch with).
    const result = classifyByHeuristic(
      {
        title: "Shoot lunch with team",
        start: NOW + DAY_MS,
        end: NOW + DAY_MS + 60 * 60 * 1000,
        attendees: 5,
        description: "",
        isPrivate: false,
      },
      NOW
    );
    expect("kind" in result && result.kind === "unknown").toBe(true);
  });

  it("dispatch returns needs-llm when heuristic is unknown", () => {
    const out = dispatch(
      {
        event: {
          title: "Some bizarre event with no obvious category markers",
          start: NOW + DAY_MS,
          end: NOW + DAY_MS + 60 * 60 * 1000,
          attendees: 3,
          description: "??",
          isPrivate: false,
        },
      },
      NOW
    );
    expect(out.kind).toBe("needs-llm");
    if (out.kind === "needs-llm") {
      expect(out.prompt).toHaveLength(2);
      // Defense-in-depth: prompt MUST instruct the model not to reason about identities.
      expect(out.prompt[0].content).toMatch(/attendee identities/i);
    }
  });

  it("dispatch returns heuristic for a clear-cut wedding", () => {
    const out = dispatch(
      {
        event: {
          title: "Wedding",
          start: NOW + 7 * DAY_MS,
          end: NOW + 7 * DAY_MS + 4 * 60 * 60 * 1000,
          attendees: 100,
          description: "",
          isPrivate: false,
        },
      },
      NOW
    );
    expect(out.kind).toBe("heuristic");
  });

  it("does not crash on empty title", () => {
    const result = classifyByHeuristic(
      {
        title: "",
        start: NOW,
        end: NOW + 60 * 60 * 1000,
        attendees: 0,
        description: "",
        isPrivate: false,
      },
      NOW
    );
    // Empty title with no patterns matched → unknown
    expect("kind" in result && result.kind === "unknown").toBe(true);
  });
});
