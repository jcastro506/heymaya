import { describe, expect, it } from "vitest";
import {
  parseWalkthroughDiagnosis,
  validateWalkthroughFile,
} from "../walkthrough";

describe("GTM mobile walkthrough analysis", () => {
  it("validates supported mobile walkthrough video files", () => {
    expect(() =>
      validateWalkthroughFile({ mimeType: "video/mp4", bytes: 1024 })
    ).not.toThrow();
    expect(() =>
      validateWalkthroughFile({ mimeType: "image/png", bytes: 1024 })
    ).toThrow("walkthrough must be an mp4");
    expect(() =>
      validateWalkthroughFile({ mimeType: "video/mp4", bytes: 0 })
    ).toThrow("walkthrough file is empty");
  });

  it("parses strict Gemini JSON diagnosis output", () => {
    const diagnosis = parseWalkthroughDiagnosis(`\`\`\`json
{
  "coreWorkflow": "User records a bug and shares reproduction context.",
  "userProblem": "Small teams lose context when bugs come from chat.",
  "strongestDemoMoments": ["Inbox to bug report", "One-click repro summary"],
  "beforeAfterContrast": "Before: messy messages. After: clean bug report.",
  "confusingMoments": ["Settings screen is dense"],
  "contentAssets": ["Inbox screenshot", "Generated bug report screen"],
  "facelessScreenRecordingEnough": true,
  "founderFaceOrUgcMightHelp": false,
  "shortFormFormatCandidates": ["slideshow carousel", "faceless demo"],
  "unsupportedClaimsOrMissingContext": ["No pricing shown"]
}
\`\`\``);

    expect(diagnosis.coreWorkflow).toContain("records a bug");
    expect(diagnosis.strongestDemoMoments).toHaveLength(2);
    expect(diagnosis.shortFormFormatCandidates).toContain("faceless demo");
  });

  it("rejects incomplete Gemini diagnosis output", () => {
    expect(() => parseWalkthroughDiagnosis("{}")).toThrow(
      "Gemini diagnosis missing coreWorkflow"
    );
  });

  it("rejects malformed JSON and missing boolean fields explicitly", () => {
    expect(() => parseWalkthroughDiagnosis("not json")).toThrow(
      "Gemini diagnosis returned malformed JSON"
    );
    expect(() =>
      parseWalkthroughDiagnosis(
        JSON.stringify({
          coreWorkflow: "workflow",
          userProblem: "problem",
          strongestDemoMoments: ["moment"],
          beforeAfterContrast: "before after",
          shortFormFormatCandidates: ["faceless demo"],
        })
      )
    ).toThrow("Gemini diagnosis missing facelessScreenRecordingEnough");
  });
});
