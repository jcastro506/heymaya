import { describe, expect, it } from "vitest";
import {
  buildResearchTaskSpecs,
  validateResearchTaskResult,
} from "../researchTasks";

describe("GTM research task specs", () => {
  it("creates bounded subagent specs for every research role", () => {
    const specs = buildResearchTaskSpecs({
      appName: "BugBrief",
      appUrl: "https://bugbrief.test",
      canRecordScreen: true,
      canShowFace: false,
      canProvideScreenshots: true,
      canPostTikTokManually: true,
      canPostInstagramManually: true,
    });

    expect(specs.map((spec) => spec.kind)).toEqual([
      "app_inspector",
      "icp_hypothesis",
      "reddit_demand",
      "x_founder_led",
      "linkedin_fit",
      "tiktok_format_research",
      "instagram_format_planner",
      "competitor_search",
      "channel_judge",
    ]);
    expect(specs.every((spec) => spec.outputSchema.mustWriteCostLedger)).toBe(
      true
    );
    expect(specs.every((spec) => spec.maxCostUsd <= 0.35)).toBe(true);
    expect(specs.every((spec) => spec.timeoutMinutes > 0)).toBe(true);
    expect(specs.every((spec) => spec.coverageChecklist.length > 0)).toBe(true);
    expect(specs.every((spec) => spec.retryPolicy.maxAttempts >= 1)).toBe(true);
  });

  it("parks visual-channel spend when production inputs are unavailable", () => {
    const specs = buildResearchTaskSpecs({
      appName: "NoCam",
      appUrl: "https://nocam.test",
      canRecordScreen: false,
      canShowFace: false,
      canProvideScreenshots: false,
      canPostTikTokManually: true,
      canPostInstagramManually: true,
    });
    const tiktok = specs.find((spec) => spec.kind === "tiktok_format_research");
    const instagram = specs.find(
      (spec) => spec.kind === "instagram_format_planner"
    );

    expect(tiktok?.maxCostUsd).toBe(0);
    expect(tiktok?.objective).toContain("Park TikTok");
    expect(tiktok?.prompt).toContain("Do not spend");
    expect(instagram?.maxCostUsd).toBe(0);
    expect(instagram?.objective).toContain("Park Instagram");
  });

  it("keeps TikTok and Instagram parked when the user cannot manually post", () => {
    const specs = buildResearchTaskSpecs({
      appName: "HasAssets",
      appUrl: "https://hasassets.test",
      canRecordScreen: true,
      canShowFace: false,
      canProvideScreenshots: true,
      canPostTikTokManually: false,
      canPostInstagramManually: false,
    });

    expect(
      specs.find((spec) => spec.kind === "tiktok_format_research")?.maxCostUsd
    ).toBe(0);
    expect(
      specs.find((spec) => spec.kind === "instagram_format_planner")?.maxCostUsd
    ).toBe(0);
  });

  it("requires URLs, enough evidence, matching source, checklist, and cost ledger", () => {
    const task = buildResearchTaskSpecs({
      appName: "BugBrief",
      appUrl: "https://bugbrief.test",
      canRecordScreen: true,
      canShowFace: false,
      canProvideScreenshots: true,
      canPostTikTokManually: true,
      canPostInstagramManually: true,
    }).find((spec) => spec.kind === "reddit_demand")!;

    expect(
      validateResearchTaskResult({
        task,
        evidenceCards: [
          {
            source: "reddit",
            url: "https://reddit.test/thread/1",
            snippet: "first-user pain",
          },
          {
            source: "reddit",
            url: "https://reddit.test/thread/2",
            snippet: "marketing blocker",
          },
          {
            source: "reddit",
            url: "https://reddit.test/thread/3",
            snippet: "distribution question",
          },
        ],
        costLedgerWritten: true,
        completedChecklistItems: task.coverageChecklist,
      }).passed
    ).toBe(true);

    const failed = validateResearchTaskResult({
      task,
      evidenceCards: [
        { source: "x", url: "not-a-url", snippet: "wrong source" },
      ],
      costLedgerWritten: false,
      completedChecklistItems: ["fresh pain threads"],
    });

    expect(failed.passed).toBe(false);
    expect(failed.failures).toEqual(
      expect.arrayContaining([
        "too few evidence cards",
        "evidence cards must cite URLs",
        "missing required evidence source",
        "cost ledger entry required",
      ])
    );
    expect(failed.failures.join(" ")).toContain("missing coverage checklist");
  });

  it("allows only the channel judge to finalize strategy", () => {
    const specs = buildResearchTaskSpecs({
      appName: "BugBrief",
      appUrl: "https://bugbrief.test",
      canRecordScreen: true,
      canShowFace: false,
      canProvideScreenshots: true,
      canPostTikTokManually: true,
      canPostInstagramManually: true,
    });

    expect(specs.filter((spec) => spec.outputSchema.mayFinalizeStrategy)).toEqual([
      expect.objectContaining({ kind: "channel_judge" }),
    ]);
  });
});
