import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";

import type { MissionBoardData } from "@/convex/gtmMaya/missionBoard";

let mockBoard: MissionBoardData | null | undefined = undefined;

vi.mock("convex/react", () => ({
  useQuery: () => mockBoard,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, className }, children),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { gtmMaya: { missionBoard: { getMyMissionBoard: "missionBoard" } } },
}));

describe("ClawLaunch Mission Board page", () => {
  afterEach(() => {
    vi.resetModules();
    mockBoard = undefined;
  });

  it("renders loading skeleton", async () => {
    mockBoard = undefined;
    const Page = (await import("../mission-board/page")).default;
    const html = renderToString(createElement(Page));

    expect(html).toContain("gtm-mission-board-skeleton");
    expect(html).toContain("animate-pulse");
  });

  it("renders empty onboarding state", async () => {
    mockBoard = null;
    const Page = (await import("../mission-board/page")).default;
    const html = renderToString(createElement(Page));

    expect(html).toContain("Finish onboarding");
    expect(html).toContain("/onboarding/gtm");
  });

  it("renders populated board without required user-maintained fields", async () => {
    mockBoard = {
      appName: "BugBrief",
      appUrl: "https://bugbrief.test",
      stage: "live-beta",
      weekGoal: "signups",
      progress: [
        {
          label: "Research",
          detail: "complete / ready_for_review",
          state: "done",
        },
      ],
      diagnosis: [
        {
          label: "audience",
          detail: "founders with broken bug reports",
          state: "done",
        },
      ],
      evidenceCards: [
        {
          source: "reddit",
          title: "First users",
          snippet: "founders asking for feedback",
          url: "https://reddit.test/thread",
          use: "reply",
        },
      ],
      channelDecisions: [
        {
          channel: "reddit",
          decision: "primary",
          confidence: "high",
          reasons: ["Fresh demand"],
          risks: ["Promotion rules"],
          firstWeekTest: "Reply to 10 qualified threads.",
        },
      ],
      todayTasks: [
        {
          label: "reddit test",
          detail: "Reply to 10 qualified threads.",
          state: "active",
        },
      ],
      pendingApprovals: [],
      results: [
        {
          label: "Customer movement",
          detail: "1 signups, 0 demos, 1 useful feedback items.",
          state: "done",
        },
      ],
      learnings: [
        {
          label: "Signal read",
          detail: "Strong signal: 1 signup and useful feedback.",
          state: "done",
        },
      ],
      nextTests: [
        {
          label: "Double down",
          detail: "Reuse the same demo moment with a new hook.",
          state: "done",
        },
      ],
      cost: { budgetUsd: 3, spentUsd: 0.25 },
    };
    const Page = (await import("../mission-board/page")).default;
    const html = renderToString(createElement(Page));

    expect(html).toContain("BugBrief");
    expect(html).toContain("Channel Decisions");
    expect(html).toContain("What Maya Learned");
    expect(html).toContain("Next Tests");
    expect(html).toContain("Evidence Cards");
    expect(html).toContain("No drafts are waiting on the user right now.");
    expect(html).not.toContain("Required field");
  });
});
