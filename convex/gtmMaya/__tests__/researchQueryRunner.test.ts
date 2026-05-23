import { describe, expect, it } from "vitest";
import {
  buildScrapeCreatorsQueryPlan,
  validateScrapeCreatorsQueryPlan,
} from "../researchQueryRunner";
import { buildResearchTaskSpecs } from "../researchTasks";

function specs() {
  return buildResearchTaskSpecs({
    appName: "BugBrief",
    appUrl: "https://bugbrief.test",
    canRecordScreen: true,
    canShowFace: false,
    canProvideScreenshots: true,
    canPostTikTokManually: true,
    canPostInstagramManually: true,
  });
}

describe("GTM ScrapeCreators query runner", () => {
  it("builds bounded TikTok research calls for videos, slideshows, UGC hooks, and comments", () => {
    const task = specs().find((spec) => spec.kind === "tiktok_format_research")!;
    const plan = buildScrapeCreatorsQueryPlan({
      task,
      mode: "onboarding_research",
      seed: {
        appName: "BugBrief",
        primaryQuery: "bug reports for indie hackers",
        alternateQueries: ["qa feedback app"],
      },
    });

    expect(plan.calls.length).toBe(task.maxScrapeCreatorsCalls);
    expect(plan.totalEstimatedCostUsd).toBeLessThanOrEqual(task.maxCostUsd);
    expect(plan.calls.map((call) => call.query).join(" ")).toContain(
      "slideshow photo mode"
    );
    expect(plan.calls.every((call) => call.cacheKey.startsWith("sc:tiktok:"))).toBe(
      true
    );
    expect(validateScrapeCreatorsQueryPlan({ task, plan }).passed).toBe(true);
  });

  it("plans Instagram as a manual reuse lane without exceeding its smaller budget", () => {
    const task = specs().find(
      (spec) => spec.kind === "instagram_format_planner"
    )!;
    const plan = buildScrapeCreatorsQueryPlan({
      task,
      mode: "onboarding_research",
      seed: {
        appName: "BugBrief",
        primaryQuery: "bug report app demo",
      },
    });

    expect(plan.calls.length).toBeLessThanOrEqual(task.maxScrapeCreatorsCalls);
    expect(plan.totalEstimatedCostUsd).toBeLessThanOrEqual(task.maxCostUsd);
    expect(plan.calls.map((call) => call.query).join(" ")).toContain(
      "reels format"
    );
    expect(validateScrapeCreatorsQueryPlan({ task, plan }).passed).toBe(true);
  });

  it("never plans ScrapeCreators calls from heartbeat", () => {
    const task = specs().find((spec) => spec.kind === "reddit_demand")!;
    const plan = buildScrapeCreatorsQueryPlan({
      task,
      mode: "heartbeat",
      seed: {
        appName: "BugBrief",
        primaryQuery: "bugs in user feedback",
      },
    });

    expect(plan.calls).toEqual([]);
    expect(plan.skippedReason).toContain("heartbeat");
    expect(validateScrapeCreatorsQueryPlan({ task, plan }).passed).toBe(true);
  });

  it("rejects plans that bypass cache keys or cost caps", () => {
    const task = specs().find((spec) => spec.kind === "reddit_demand")!;
    const valid = buildScrapeCreatorsQueryPlan({
      task,
      mode: "onboarding_research",
      seed: {
        appName: "BugBrief",
        primaryQuery: "bugs in user feedback",
      },
    });
    const invalid = {
      ...valid,
      totalEstimatedCostUsd: task.maxCostUsd + 0.01,
      calls: [
        ...valid.calls,
        {
          ...valid.calls[0],
          cacheKey: "missing-cache-prefix",
          reason: "",
        },
      ],
    };

    expect(validateScrapeCreatorsQueryPlan({ task, plan: invalid }).failures)
      .toEqual(
        expect.arrayContaining([
          "plan exceeds ScrapeCreators call cap",
          "plan exceeds ScrapeCreators cost cap",
          "every ScrapeCreators call needs a cache key",
          "every ScrapeCreators call needs a reason",
        ])
      );
  });
});
