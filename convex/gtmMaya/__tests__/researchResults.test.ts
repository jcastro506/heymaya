import { describe, expect, it } from "vitest";
import { validateSubagentResearchResult } from "../researchResults";
import { buildResearchTaskSpecs } from "../researchTasks";

function task(kind: ReturnType<typeof buildResearchTaskSpecs>[number]["kind"]) {
  return buildResearchTaskSpecs({
    appName: "BugBrief",
    appUrl: "https://bugbrief.test",
    canRecordScreen: true,
    canShowFace: false,
    canProvideScreenshots: true,
    canPostTikTokManually: true,
    canPostInstagramManually: true,
  }).find((spec) => spec.kind === kind)!;
}

describe("GTM subagent research result gate", () => {
  it("accepts successful results only when evidence, checklist, and cost ledger are present", () => {
    const reddit = task("reddit_demand");
    const gate = validateSubagentResearchResult({
      task: reddit,
      result: {
        taskKind: "reddit_demand",
        status: "succeeded",
        summary: "Found pain threads with medium promotion risk.",
        evidenceCards: [
          { source: "reddit", url: "https://reddit.test/1", snippet: "pain" },
          { source: "reddit", url: "https://reddit.test/2", snippet: "pain" },
          { source: "reddit", url: "https://reddit.test/3", snippet: "pain" },
        ],
        completedChecklistItems: reddit.coverageChecklist,
        costLedgerWritten: true,
      },
    });

    expect(gate).toEqual({ accepted: true, nextStatus: "accepted", failures: [] });
  });

  it("escalates retryable weak evidence instead of accepting shallow research", () => {
    const reddit = task("reddit_demand");
    const gate = validateSubagentResearchResult({
      task: reddit,
      result: {
        taskKind: "reddit_demand",
        status: "succeeded",
        summary: "Only one thread found.",
        evidenceCards: [
          { source: "reddit", url: "https://reddit.test/1", snippet: "pain" },
        ],
        completedChecklistItems: ["fresh pain threads"],
        costLedgerWritten: true,
      },
    });

    expect(gate.accepted).toBe(false);
    expect(gate.nextStatus).toBe("escalate");
    expect(gate.failures.join(" ")).toContain("too few evidence cards");
    expect(gate.failures.join(" ")).toContain("missing coverage checklist");
  });

  it("rejects strategy finalization from non-judge subagents", () => {
    const x = task("x_founder_led");
    const gate = validateSubagentResearchResult({
      task: x,
      result: {
        taskKind: "x_founder_led",
        status: "succeeded",
        summary: "X looks strongest.",
        evidenceCards: [
          { source: "x", url: "https://x.test/1", snippet: "format" },
          { source: "x", url: "https://x.test/2", snippet: "conversation" },
        ],
        completedChecklistItems: x.coverageChecklist,
        costLedgerWritten: true,
        wantsToFinalizeStrategy: true,
      },
    });

    expect(gate.accepted).toBe(false);
    expect(gate.failures).toContain("only channel judge may finalize strategy");
  });

  it("parks channels when a subagent explicitly returns insufficient evidence", () => {
    const instagram = task("instagram_format_planner");
    const gate = validateSubagentResearchResult({
      task: instagram,
      result: {
        taskKind: "instagram_format_planner",
        status: "insufficient_evidence",
        summary: "Not enough current Instagram evidence.",
        evidenceCards: [
          {
            source: "instagram",
            url: "https://instagram.test/p/1",
            snippet: "weak fit",
          },
        ],
        completedChecklistItems: ["manual posting limitation"],
        costLedgerWritten: true,
        missingEvidence: ["carousel examples"],
      },
    });

    expect(gate.accepted).toBe(false);
    expect(gate.nextStatus).toBe("park_channel");
  });
});
