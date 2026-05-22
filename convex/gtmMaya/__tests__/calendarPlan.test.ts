import { describe, expect, it } from "vitest";
import {
  buildSevenDayCalendarPlan,
  validateCalendarEvents,
} from "../calendarPlan";
import type { GtmStrategyPlan } from "../strategyJudge";

const PLAN: GtmStrategyPlan = {
  primaryChannel: "reddit",
  secondaryChannel: "tiktok",
  parkedChannels: ["linkedin", "x"],
  confidence: "medium",
  thesis: "Start with reddit and support it with tiktok because cited evidence shows first-user pain and visual demo potential.",
  firstWeekTests: [
    {
      channel: "reddit",
      test: "Reply to 10 qualified threads.",
      successMetric: "qualified replies and signups",
      evidenceCardIds: ["ev1", "ev2", "ev3"],
    },
    {
      channel: "tiktok",
      test: "Record 3 demo scripts.",
      successMetric: "comments asking for link and signups",
      evidenceCardIds: ["ev4", "ev5"],
    },
  ],
};

describe("GTM calendar plan", () => {
  it("builds rich 7-day events with evidence and success metrics", () => {
    const events = buildSevenDayCalendarPlan({
      plan: PLAN,
      startDateIso: "2026-05-25",
      timezone: "America/New_York",
      productName: "ClawLaunch",
    });

    expect(events).toHaveLength(3);
    expect(events[0].title).toContain("reply-first Reddit");
    expect(events[0].description).toContain("Evidence: ev1, ev2, ev3");
    expect(events[0].description).toContain("Success metric:");
    expect(events[2].title).toContain("weekly GTM review");
    expect(validateCalendarEvents(events).passed).toBe(true);
  });

  it("makes TikTok a manual recording handoff, not auto-posting", () => {
    const events = buildSevenDayCalendarPlan({
      plan: PLAN,
      startDateIso: "2026-05-25",
      timezone: "America/New_York",
      productName: "ClawLaunch",
    });
    const tiktok = events.find((event) => event.platform === "tiktok")!;

    expect(tiktok.durationMinutes).toBe(45);
    expect(tiktok.description).toContain("record and manually post");
    expect(tiktok.description).toContain("does not auto-post TikTok");
  });

  it("fails events missing evidence, success metric, or Maya ownership", () => {
    const gate = validateCalendarEvents([
      {
        owner: "maya",
        platform: "reddit",
        title: "bad",
        startsAt: "2026-05-25T09:00:00",
        durationMinutes: 30,
        description: "Task only",
        evidenceCardIds: [],
        successMetric: "",
        status: "draft",
      },
      {
        owner: "maya",
        platform: "tiktok",
        title: "bad tiktok",
        startsAt: "2026-05-25T10:00:00",
        durationMinutes: 30,
        description: "Evidence: ev1\nSuccess metric: views",
        evidenceCardIds: ["ev1"],
        successMetric: "views",
        status: "draft",
      },
    ]);

    expect(gate.passed).toBe(false);
    expect(gate.failures).toEqual(
      expect.arrayContaining([
        "bad is missing evidence section",
        "bad is missing success metric",
        "TikTok event must be a recording handoff",
      ])
    );
  });
});
