import { describe, expect, it } from "vitest";
import {
  classifyCalendarEvent,
  normalizeCalendarLookaheadEvents,
} from "../calendarLookahead";

describe("Creator Maya v0 calendar lookahead", () => {
  it("turns creator-relevant events into content arcs", () => {
    const event = {
      providerEventId: "evt_launch",
      title: "Product launch livestream",
      startMs: Date.UTC(2026, 4, 8, 15),
      endMs: Date.UTC(2026, 4, 8, 16),
    };

    expect(classifyCalendarEvent(event)).toBe("creator_relevant");
    const [normalized] = normalizeCalendarLookaheadEvents([event]);
    expect(normalized.contentArc).toHaveLength(3);
    expect(normalized.contentArc[0].title).toContain("Build-up");
  });

  it("recognizes creator shoot blocks", () => {
    expect(
      classifyCalendarEvent({
        providerEventId: "evt_film",
        title: "Film TikTok hooks",
        startMs: 1,
        endMs: 2,
      })
    ).toBe("creator_shoot");
  });

  it("redacts private appointments and creates no content arc", () => {
    const [normalized] = normalizeCalendarLookaheadEvents([
      {
        providerEventId: "evt_dentist",
        title: "Dentist appointment",
        startMs: 1,
        endMs: 2,
      },
    ]);

    expect(normalized.title).toBe("Private event");
    expect(normalized.privacyRedacted).toBe(true);
    expect(normalized.contentArc).toHaveLength(0);
  });
});
