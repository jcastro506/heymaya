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
    });

    expect(specs.map((spec) => spec.kind)).toEqual([
      "app_inspector",
      "icp_hypothesis",
      "reddit_demand",
      "x_founder_led",
      "linkedin_fit",
      "tiktok_demo",
      "competitor_search",
      "channel_judge",
    ]);
    expect(specs.every((spec) => spec.outputSchema.mustWriteCostLedger)).toBe(
      true
    );
    expect(specs.every((spec) => spec.maxCostUsd <= 0.35)).toBe(true);
  });

  it("parks TikTok spend in the task spec when visual assets are unavailable", () => {
    const specs = buildResearchTaskSpecs({
      appName: "NoCam",
      appUrl: "https://nocam.test",
      canRecordScreen: false,
      canShowFace: false,
    });
    const tiktok = specs.find((spec) => spec.kind === "tiktok_demo");

    expect(tiktok?.maxCostUsd).toBe(0);
    expect(tiktok?.objective).toContain("Park TikTok");
    expect(tiktok?.prompt).toContain("Do not spend");
  });

  it("requires URLs, enough evidence, matching source, and cost ledger", () => {
    const task = buildResearchTaskSpecs({
      appName: "BugBrief",
      appUrl: "https://bugbrief.test",
      canRecordScreen: true,
      canShowFace: false,
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
      }).passed
    ).toBe(true);

    const failed = validateResearchTaskResult({
      task,
      evidenceCards: [
        { source: "x", url: "not-a-url", snippet: "wrong source" },
      ],
      costLedgerWritten: false,
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
  });

  it("allows only the channel judge to finalize strategy", () => {
    const specs = buildResearchTaskSpecs({
      appName: "BugBrief",
      appUrl: "https://bugbrief.test",
      canRecordScreen: true,
      canShowFace: false,
    });

    expect(specs.filter((spec) => spec.outputSchema.mayFinalizeStrategy)).toEqual([
      expect.objectContaining({ kind: "channel_judge" }),
    ]);
  });
});
