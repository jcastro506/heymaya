/**
 * mayaVoiceValidator — unit tests for the four-check voice validator.
 *
 * Sprint 8 Slice C deliverable. Tests each check in isolation plus the
 * composed `validateOutput` entry point.
 *
 * Coverage shape:
 *   - bannedTermsCheck: every category (AI / sycophancy / scaffolding) fires
 *     on its expected phrase set; quoted-as-bad-example tolerance kicks in
 *     for workspace-file mode.
 *   - lengthCheck: triggers on word count and char count separately.
 *   - disclaimerPatternCheck: fires on leading hedge AND on hedge within
 *     opening 40 chars (after a warm "Hey —").
 *   - citationCheck: numeric claim with no citation token fails;
 *     numeric claim with a weekday/URL/post id passes; conversational
 *     short outputs are exempt.
 *   - validateOutput: empty string is flagged; clean output passes;
 *     compound output surfaces every reason.
 */

import { describe, it, expect } from "vitest";
import {
  validateOutput,
  bannedTermsCheck,
  lengthCheck,
  disclaimerPatternCheck,
  citationCheck,
  MAYA_OUTPUT_MAX_WORDS,
  MAYA_OUTPUT_MAX_CHARS,
  type ValidationFailureReason,
} from "../mayaVoiceValidator";

/* -------------------------------------------------------------------------- */
/* bannedTermsCheck                                                            */
/* -------------------------------------------------------------------------- */

describe("bannedTermsCheck", () => {
  // Each tuple: phrase Maya should never say + reason category.
  const cases: ReadonlyArray<[string, ValidationFailureReason]> = [
    ["As an AI manager, I think...", "banned-ai-self-reference"],
    ["I'm an AI assistant who can help.", "banned-ai-self-reference"],
    ["As a language model, I cannot watch the video.", "banned-ai-self-reference"],
    ["Note: I'm just an AI.", "banned-ai-self-reference"],
    ["I don't have feelings about this.", "banned-ai-self-reference"],
    ["Great question!", "banned-sycophancy"],
    ["Amazing work this week!", "banned-sycophancy"],
    ["You're crushing it on TikTok.", "banned-sycophancy"],
    ["Phenomenal pacing!", "banned-sycophancy"],
    ["You're absolutely killing it!", "banned-sycophancy"],
    ["Two quick things before I begin.", "banned-scaffolding"],
    ["Happy to walk you through that.", "banned-scaffolding"],
    ["Let me know if I can help with anything else.", "banned-scaffolding"],
    ["Hope this helps!", "banned-scaffolding"],
    ["Don't hesitate to ask.", "banned-scaffolding"],
  ];

  for (const [phrase, expectedReason] of cases) {
    it(`flags "${phrase}" as ${expectedReason}`, () => {
      const hits = bannedTermsCheck(phrase, false);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h) => h.reason === expectedReason)).toBe(true);
    });
  }

  it("returns no hits for clean Maya output", () => {
    const clean =
      "Your Tuesday Reel hit 47k views — about 2.1x your trailing average. Drafts waiting on the Deals tab.";
    expect(bannedTermsCheck(clean, false)).toEqual([]);
  });

  it("tolerates quoted-as-bad-example occurrences when allowQuotedAsBad=true", () => {
    // Mirrors the AGENTS.md instructional context: 'do not say "X"'.
    const instructional =
      "Anti-sycophancy rule: do not say 'Great question!' — it has no anchor.";
    expect(bannedTermsCheck(instructional, true)).toEqual([]);
    // Without the workspace-file allowance the same string should flag.
    expect(bannedTermsCheck(instructional, false).length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* lengthCheck                                                                 */
/* -------------------------------------------------------------------------- */

describe("lengthCheck", () => {
  it("does not fire for a short cited brief", () => {
    const ok =
      "Your Tuesday Reel hit 47k views — about 2.1x your trailing average. Today: tighten the bio link.";
    expect(lengthCheck(ok)).toEqual([]);
  });

  it("fires on word count above MAYA_OUTPUT_MAX_WORDS", () => {
    // Build a long-but-narrow output: each "word" is a single char so we
    // overshoot the word count without yet overshooting the char count.
    const words = MAYA_OUTPUT_MAX_WORDS + 5;
    const longByWords = "a ".repeat(words).trim();
    const hits = lengthCheck(longByWords);
    expect(hits.some((h) => h.reason === "length-words")).toBe(true);
  });

  it("fires on char count above MAYA_OUTPUT_MAX_CHARS", () => {
    const longByChars = "x".repeat(MAYA_OUTPUT_MAX_CHARS + 50);
    const hits = lengthCheck(longByChars);
    expect(hits.some((h) => h.reason === "length-chars")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* disclaimerPatternCheck                                                      */
/* -------------------------------------------------------------------------- */

describe("disclaimerPatternCheck", () => {
  it("flags a leading 'Just to be clear,' prefix", () => {
    const hit = disclaimerPatternCheck(
      "Just to be clear, your engagement is up this week."
    );
    expect(hit).not.toBeNull();
    expect(hit?.reason).toBe("disclaimer-prefix");
  });

  it("flags a leading 'I should mention,' prefix", () => {
    const hit = disclaimerPatternCheck(
      "I should mention, the platform-side data can lag."
    );
    expect(hit).not.toBeNull();
  });

  it("flags 'I'm not 100% sure but,' as a hedge prefix", () => {
    const hit = disclaimerPatternCheck(
      "I'm not 100% sure but the engagement looks lower."
    );
    expect(hit).not.toBeNull();
  });

  it("flags hedge inside opening 40 chars even after a warm opener", () => {
    const hit = disclaimerPatternCheck(
      "Hey — just to be clear, your engagement is up."
    );
    expect(hit).not.toBeNull();
  });

  it("does not fire on clean direct opener", () => {
    expect(
      disclaimerPatternCheck(
        "Your noon TikTok is at 8k views in 2h vs 22k baseline."
      )
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* citationCheck                                                               */
/* -------------------------------------------------------------------------- */

describe("citationCheck", () => {
  it("flags an uncited percentage claim in a longer output", () => {
    const uncited =
      "Your engagement is around 4.2% which might be a bit lower than usual, though I want to confirm with a fresher snapshot from the connected platforms over the next heartbeat tick when the rolling window settles in.";
    const hit = citationCheck(uncited);
    expect(hit).not.toBeNull();
    expect(hit?.reason).toBe("uncited-numeric-claim");
  });

  it("does not fire when a weekday anchor is present", () => {
    const cited =
      "Your Tuesday Reel hit 47k views, about 2.1x your trailing average. Save rate up too.";
    expect(citationCheck(cited)).toBeNull();
  });

  it("does not fire when a URL is present", () => {
    const cited =
      "A new pattern is rising on TikTok in your niche this week (https://tiktok.com/@samanthacooks/video/123) — POV-cooking with the camera at chest level. Fits your voice, want me to draft a Thursday variant?";
    expect(citationCheck(cited)).toBeNull();
  });

  it("does not fire when a 'last week' anchor is present", () => {
    const cited =
      "Last week: 3 posts, 2 hits, 1 miss. The hit had a 6-word hook. Your norm is 9. Try shorter on Wed.";
    expect(citationCheck(cited)).toBeNull();
  });

  it("does not fire on short conversational outputs (<25 words)", () => {
    // Plan-tier refusal — has a number ("Manager") but no claim — should
    // be exempt because the output is conversational, not analytical.
    expect(citationCheck("On it. 2 drafts incoming.")).toBeNull();
  });

  it("does not fire on outputs with no numeric claim at all", () => {
    expect(citationCheck("On it.")).toBeNull();
    expect(
      citationCheck(
        "Want me to draft an IG Reels variant tonight in the same hook shape?"
      )
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* validateOutput (composed)                                                   */
/* -------------------------------------------------------------------------- */

describe("validateOutput", () => {
  it("flags an empty string as suspicious", () => {
    const result = validateOutput("");
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("empty-output");
    expect(result.details[0]).toContain("empty output suspicious");
  });

  it("flags a whitespace-only string as suspicious", () => {
    const result = validateOutput("   \n\t  ");
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("empty-output");
  });

  it("returns ok=true for a clean Maya output", () => {
    const clean =
      "Your Tuesday Reel hit 47k views — about 2.1x your trailing average for the post window. Today: tighten the bio link before the audience push lands.";
    const result = validateOutput(clean);
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("composes — a compound bad output surfaces every reason", () => {
    const compound =
      "Just to be clear, as an AI assistant I think you're absolutely crushing it! Two quick things before I begin — ";
    const result = validateOutput(compound);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("disclaimer-prefix");
    expect(result.reasons).toContain("banned-ai-self-reference");
    expect(result.reasons).toContain("banned-sycophancy");
    expect(result.reasons).toContain("banned-scaffolding");
  });

  it("workspace-file kind skips length and citation checks", () => {
    // A long doc with a numeric claim but no citation tokens — would fail
    // as model-output, must pass as workspace-file.
    const longWithNumeric = "Section 1. ".repeat(300) + "47k views matter.";
    const asModel = validateOutput(longWithNumeric);
    expect(asModel.ok).toBe(false);
    const asWorkspace = validateOutput(longWithNumeric, "workspace-file");
    // The workspace path should NOT include length or citation reasons.
    // (It can still flag any banned terms — but this string has none.)
    expect(asWorkspace.reasons).not.toContain("length-words");
    expect(asWorkspace.reasons).not.toContain("length-chars");
    expect(asWorkspace.reasons).not.toContain("uncited-numeric-claim");
  });

  it("constants are exported and the documented thresholds match the spec", () => {
    // 280 words ceiling per playbook.md morning-brief target (<200 words
    // soft target → 280 hard ceiling for blowup detection).
    expect(MAYA_OUTPUT_MAX_WORDS).toBe(280);
    // 2000 chars ceiling per HEARTBEAT_SOFT_CAP_CHARS in
    // generateHeartbeatMd.ts.
    expect(MAYA_OUTPUT_MAX_CHARS).toBe(2_000);
  });
});
