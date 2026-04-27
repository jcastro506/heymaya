/**
 * GoalsFocusStrip — render-only smoke test.
 *
 * Mirrors the Sparkline / ChannelPairingCard test convention: server-side
 * render via react-dom/server, no jsdom. We pass the data prop directly (the
 * component is a pure render function over its props — Today wires the
 * useQuery on top), so no Convex mocking required here.
 *
 * Coverage:
 *   - Renders all 3 columns when data is present.
 *   - Renders graceful empty states when each section is absent.
 *   - Renders calibrating-mode when hasInferredPicture is false.
 *   - Stage-aware copy varies (just-starting vs scaling).
 *   - Loading shell when data is undefined.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  GoalsFocusStrip,
  type GoalsFocusStripData,
} from "../GoalsFocusStrip";

const NOW = Date.now();

function fullData(
  overrides: Partial<GoalsFocusStripData> = {}
): GoalsFocusStripData {
  const base: GoalsFocusStripData = {
    goals: {
      free: "Quit my day job by being a fitness creator full-time.",
      oneYear: "Hit 50K and 5K monthly recurring",
      fiveYear: "Run a small studio",
      revenueStreams: ["brand-deals", "courses"],
      careerStage: "building",
    },
    focus: {
      nextMilestoneText: "Ship one paid deal in the next 6 weeks",
      focusAreas: ["Lock the hook in first 3 seconds", "Post 4x/week"],
      horizonWeeks: 6,
    },
    recentMayaActions: [
      {
        entryId: "morning_brief",
        detail: "Wrote brief; flagged Tuesday's reel for retention dip.",
        ts: NOW - 2 * 60 * 60 * 1000,
      },
      {
        entryId: "performance_check_2h",
        detail: null,
        ts: NOW - 4 * 60 * 60 * 1000,
      },
    ],
    nextScheduledCronHint: "Evening recap at 7pm local",
    hasInferredPicture: true,
  };
  return {
    ...base,
    ...overrides,
    goals: { ...base.goals, ...(overrides.goals ?? {}) },
    focus: { ...base.focus, ...(overrides.focus ?? {}) },
  };
}

function render(data: GoalsFocusStripData | null | undefined): string {
  return renderToStaticMarkup(createElement(GoalsFocusStrip, { data }));
}

describe("GoalsFocusStrip", () => {
  it("renders the loading shell when data is undefined", () => {
    const html = render(undefined);
    expect(html).toContain("goals-focus-strip-loading");
  });

  it("renders nothing when data is null (unauth)", () => {
    const html = render(null);
    expect(html).toBe("");
  });

  it("renders all three columns when data is present", () => {
    const html = render(fullData());
    expect(html).toContain("goals-focus-strip");
    expect(html).toContain("goals-focus-strip-goals");
    expect(html).toContain("goals-focus-strip-focus");
    expect(html).toContain("goals-focus-strip-maya");
  });

  it("surfaces the free-text goal + 1y/5y horizons + revenue chips + stage", () => {
    const html = render(fullData());
    expect(html).toContain("Quit my day job");
    expect(html).toContain("Hit 50K");
    expect(html).toContain("Run a small studio");
    expect(html).toContain("Brand deals");
    expect(html).toContain("Courses");
    expect(html).toContain("Building");
  });

  it("surfaces the milestone text + focus areas + horizon", () => {
    const html = render(fullData());
    expect(html).toContain("Ship one paid deal");
    expect(html).toContain("Lock the hook");
    expect(html).toContain("Post 4x/week");
    expect(html).toContain("Horizon");
    expect(html).toContain("6w");
  });

  it("surfaces recent Maya actions + the next-scheduled hint", () => {
    const html = render(fullData());
    expect(html).toContain("morning_brief");
    expect(html).toContain("performance_check_2h");
    expect(html).toContain("Evening recap at 7pm local");
  });

  it("renders calibrating-mode in the focus column when hasInferredPicture=false", () => {
    const html = render(
      fullData({
        hasInferredPicture: false,
        focus: {
          nextMilestoneText: null,
          focusAreas: [],
          horizonWeeks: null,
        },
      })
    );
    expect(html).toContain("calibrating");
    // Goals + Maya columns still render
    expect(html).toContain("Quit my day job");
    expect(html).toContain("morning_brief");
  });

  it("renders graceful empty in the goals column when goal is null", () => {
    const html = render(
      fullData({
        goals: {
          free: null,
          oneYear: null,
          fiveYear: null,
          revenueStreams: [],
          careerStage: null,
        },
      })
    );
    expect(html).toContain("No goal on file yet");
    // No 1y/5y bullets, no chips, no stage badge — they're conditional.
    expect(html).not.toContain("1y ·");
    expect(html).not.toContain("5y ·");
    expect(html).not.toContain("Stage ·");
  });

  it("renders graceful empty in the Maya column when no actions + no hint", () => {
    const html = render(
      fullData({
        recentMayaActions: [],
        nextScheduledCronHint: null,
      })
    );
    expect(html).toContain("Maya is just spinning up");
    expect(html).not.toContain("Next ·");
  });

  it("renders graceful empty in the focus column when synthesis ran but no plan", () => {
    const html = render(
      fullData({
        hasInferredPicture: true,
        focus: {
          nextMilestoneText: null,
          focusAreas: [],
          horizonWeeks: null,
        },
      })
    );
    expect(html).toContain("No milestone set yet");
  });

  it("STAGE-AWARE: just-starting stage renders 'Just starting' label", () => {
    const html = render(
      fullData({
        goals: {
          free: "Build an audience",
          oneYear: null,
          fiveYear: null,
          revenueStreams: [],
          careerStage: "just-starting",
        },
      })
    );
    expect(html).toContain("Just starting");
  });

  it("STAGE-AWARE: scaling stage renders 'Scaling' label and richer revenue chips", () => {
    const html = render(
      fullData({
        goals: {
          free: "Stay relevant + diversify",
          oneYear: null,
          fiveYear: null,
          revenueStreams: ["brand-deals", "merch", "courses", "subs"],
          careerStage: "scaling",
        },
      })
    );
    expect(html).toContain("Scaling");
    expect(html).toContain("Brand deals");
    expect(html).toContain("Merch");
    expect(html).toContain("Subs");
  });

  it("ADVERSARIAL: degrades cleanly when data is the bare minimum (all nulls/empties)", () => {
    const html = render({
      goals: {
        free: null,
        oneYear: null,
        fiveYear: null,
        revenueStreams: [],
        careerStage: null,
      },
      focus: {
        nextMilestoneText: null,
        focusAreas: [],
        horizonWeeks: null,
      },
      recentMayaActions: [],
      nextScheduledCronHint: null,
      hasInferredPicture: false,
    });
    // No crash; calibrating message + no-goal message + no-actions message all
    // render in their respective columns.
    expect(html).toContain("calibrating");
    expect(html).toContain("No goal on file yet");
    expect(html).toContain("Maya is just spinning up");
    // Strip itself is present.
    expect(html).toContain("goals-focus-strip");
  });

  it("ADVERSARIAL: tolerates an unknown revenueStream value without crashing", () => {
    const html = render(
      fullData({
        goals: {
          free: "x",
          oneYear: null,
          fiveYear: null,
          // Schema would reject this, but the component shouldn't blow up if a
          // future stream slug ships before the label table updates.
          revenueStreams: ["unknown-stream-slug"],
          careerStage: "building",
        },
      })
    );
    // Falls back to printing the raw slug.
    expect(html).toContain("unknown-stream-slug");
  });
});
