import { describe, expect, it } from "vitest";
import {
  buildMorningBrief,
  nextMorningBriefLocalHour,
  type BriefCitation,
  type MorningBriefContext,
} from "../dailyBrief";

const citation: BriefCitation = {
  sourceType: "video_analysis",
  sourceId: "post_1",
  summary: "Strong posts open on the finished result.",
};

const slotStart = Date.UTC(2026, 4, 4, 19, 0, 0);

function context(
  overrides: Partial<MorningBriefContext> = {}
): MorningBriefContext {
  return {
    creatorId: "creator_1",
    timezone: "America/New_York",
    nowMs: Date.UTC(2026, 4, 4, 11, 0, 0),
    lastOutboundUnanswered: false,
    todaysAvailability: [{ startMs: slotStart, endMs: slotStart + 2 * 60 * 60 * 1000 }],
    recentSignals: [
      {
        id: "signal_1",
        summary: "Your best recent TikToks show the outcome before context.",
        citations: [citation],
        urgency: "normal",
      },
    ],
    activePlanIdeas: [
      {
        id: "idea_1",
        hook: "show the finished result before the setup",
        shotList: "Open on result, then explain the mistake.",
        caption: "Stop explaining before showing the payoff.",
        whyItFits: "It matches the result-first pattern in your strongest posts.",
        durationMin: 45,
        citations: [citation],
      },
    ],
    ...overrides,
  };
}

describe("Creator Maya v0 daily morning brief", () => {
  it("runs at 7am creator-local time", () => {
    expect(nextMorningBriefLocalHour()).toBe(7);
  });

  it("builds one grounded iMessage with a calendar-aware work block", () => {
    const result = buildMorningBrief(context());

    expect(result.shouldSend).toBe(true);
    if (!result.shouldSend) return;

    expect(result.dailyBrief.scheduledForLocalHour).toBe(7);
    expect(result.dailyBrief.proposedWorkStartMs).toBe(slotStart);
    expect(result.dailyBrief.message).toContain("Today at 3pm");
    expect(result.dailyBrief.message).toContain("Reply \"draft\"");
    expect(result.dailyBrief.message).toContain("\"schedule\"");
    expect(result.dailyBrief.citations.length).toBeGreaterThanOrEqual(2);
    expect(result.actionLog.action).toBe("send_imessage");
  });

  it("skips iMessage when no plan idea is grounded by citations", () => {
    const result = buildMorningBrief(
      context({
        activePlanIdeas: [
          {
            id: "idea_unsupported",
            hook: "make something viral",
            shotList: "Talk to camera.",
            caption: "viral",
            whyItFits: "It should work.",
            durationMin: 30,
            citations: [],
          },
        ],
      })
    );

    expect(result.shouldSend).toBe(false);
    if (result.shouldSend) return;
    expect(result.dailyBrief.noSendReason).toBe("no_grounded_action");
    expect(result.actionLog.action).toBe("skip_imessage");
  });

  it("skips iMessage when the creator has no available filming block", () => {
    const result = buildMorningBrief(
      context({
        todaysAvailability: [
          { startMs: slotStart, endMs: slotStart + 15 * 60 * 1000 },
        ],
      })
    );

    expect(result.shouldSend).toBe(false);
    if (result.shouldSend) return;
    expect(result.dailyBrief.noSendReason).toBe("no_calendar_availability");
    expect(result.dailyBrief.citations).toEqual([citation]);
  });

  it("stays quiet when the prior message is unanswered unless there is urgency", () => {
    const quiet = buildMorningBrief(context({ lastOutboundUnanswered: true }));
    expect(quiet.shouldSend).toBe(false);
    if (!quiet.shouldSend) {
      expect(quiet.dailyBrief.noSendReason).toBe("waiting_on_creator_reply");
    }

    const urgent = buildMorningBrief(
      context({
        lastOutboundUnanswered: true,
        recentSignals: [
          {
            id: "urgent",
            summary: "A new post is tracking at 1.8x baseline.",
            citations: [citation],
            urgency: "high",
          },
        ],
      })
    );
    expect(urgent.shouldSend).toBe(true);
  });
});
