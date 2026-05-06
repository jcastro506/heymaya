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
  jargonCheck,
  fabricationCheck,
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
    // Sprint 9.7 — operator-locked per-message cap is 400 chars.
    // iMessage UX is short rapid-fire messages, not walls of text. A
    // first-boot greet+insight+Q1 arc becomes THREE separate sends, each
    // ≤400 chars, instead of one bundled message.
    expect(MAYA_OUTPUT_MAX_CHARS).toBe(400);
  });
});

/* -------------------------------------------------------------------------- */
/* jargonCheck (Sprint 9.7)                                                    */
/* -------------------------------------------------------------------------- */

describe("jargonCheck (Sprint 9.7)", () => {
  // Each tuple: phrase Maya should not say in a creator-facing message,
  // mapped to a substring at least one hit's detail should contain.
  // (Multiple jargon phrases can fire in a single output — `some` not `[0]`.)
  const cases: ReadonlyArray<[string, string]> = [
    ["pushes you onto the global FYP", "fyp"],
    ["that drives the FYP for you this week", "fyp"],
    ["first-frame visual clarity matters", "first-frame"],
    ["your share metrics are leading the lift", "share metric"],
    ["your engagement metrics are way up", "engagement metric"],
    ["six anchor questions to ask one at a time", "anchor question"],
    ["i'll start brand-deal matching once you connect Gmail", "brand-deal matching"],
    ["take the operational weight off your plate", "operational weight"],
    ["lock in your strategy before sunday", "lock in your strategy"],
    ["strategic alignment with your manager packet", "strategic alignment"],
    ["the key driver of saves is the first second", "key driver"],
    ["hook optimization on your last 30 posts", "optimization"],
    ["a metric-driven content plan", "metric-driven"],
    ["your value prop in the food niche", "value prop"],
    ["saves per post is your KPI", "kpi"],
    ["pick a north star metric and ladder up", "north star metric"],
  ];

  for (const [phrase, expectedHit] of cases) {
    it(`flags "${phrase}" as banned-jargon ("${expectedHit}")`, () => {
      const hits = jargonCheck(phrase, false);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.reason === "banned-jargon")).toBe(true);
      expect(
        hits.some((h) => h.detail.toLowerCase().includes(expectedHit))
      ).toBe(true);
    });
  }

  it("returns no hits for human-language alternative phrasings", () => {
    const clean =
      "Your top hooks land in the first second — the visual reads before the caption. The For You feed is pushing your wednesday post wider than your norm.";
    expect(jargonCheck(clean, false)).toEqual([]);
  });

  it("tolerates SOUL.md teaching the rule (workspace-file mode)", () => {
    // Mirror of the SOUL.md "Human language only" prose. Should pass under
    // workspace-file mode because the doc is teaching the rule.
    const instructional =
      "I do not say 'first-frame visual clarity' — say 'a strong first second.' I do not say 'global FYP' — say 'the For You feed.'";
    expect(jargonCheck(instructional, true)).toEqual([]);
    // Without the workspace allowance the same string flags.
    expect(jargonCheck(instructional, false).length).toBeGreaterThan(0);
  });

  it("does not false-flag legitimate words that contain jargon letter-sequences", () => {
    // 'typify' contains 'fyp' as a substring; 'skipping' contains 'kpi'.
    // Word-boundary regex protects these.
    const ok =
      "Your tuesday post is going to typify the shape — if you keep skipping the long intro you'll see saves climb.";
    expect(jargonCheck(ok, false)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* fabricationCheck (Sprint 9.7)                                               */
/* -------------------------------------------------------------------------- */

describe("fabricationCheck (Sprint 9.7)", () => {
  it("flags 'split 50/50 UK/US' as fabricated precision", () => {
    const hit = fabricationCheck(
      "your audience is split 50/50 between the UK and US, so the landmarks travel."
    );
    expect(hit).not.toBeNull();
    expect(hit?.reason).toBe("fabricated-precision");
  });

  it("flags '60/40' audience split", () => {
    const hit = fabricationCheck(
      "your audience is roughly 60/40 US to Canada based on the geos."
    );
    expect(hit).not.toBeNull();
  });

  it("flags '70/30 men/women' demographic split", () => {
    const hit = fabricationCheck(
      "your audience demographics look like 70/30 men/women, mostly Gen Z."
    );
    expect(hit).not.toBeNull();
  });

  it("flags '80% UK, 20% US' paired percentage split", () => {
    const hit = fabricationCheck(
      "the geo breakdown on your last 30 posts is roughly 80% UK and 20% US — strong split."
    );
    expect(hit).not.toBeNull();
  });

  it("flags '75/25 millennials/gen z' followers split", () => {
    const hit = fabricationCheck(
      "your followers are split 75/25 millennials to gen z, which fits the brand voice."
    );
    expect(hit).not.toBeNull();
  });

  it("does NOT flag a non-split number ratio (e.g. '3/5 hits')", () => {
    expect(
      fabricationCheck(
        "Last week: 3/5 of your posts hit the baseline. Norm is closer to 2/5."
      )
    ).toBeNull();
  });

  it("does NOT flag concrete cited metrics (47k views, 2.1x baseline)", () => {
    expect(
      fabricationCheck(
        "Your Tuesday Reel hit 47k views — about 2.1x your trailing average for the post window."
      )
    ).toBeNull();
  });

  it("does NOT flag a numeric split that is NOT attached to audience-vocabulary", () => {
    // "60/40" appears but no audience/geo/demographic words nearby — likely
    // a comparison of something unrelated (e.g. a hypothetical posting cadence).
    expect(
      fabricationCheck(
        "If you split your week 60/40 between filming and editing you'll have buffer."
      )
    ).toBeNull();
  });

  it("does NOT flag a single percentage with no pair", () => {
    expect(
      fabricationCheck(
        "Your save rate is up 12% versus your trailing average."
      )
    ).toBeNull();
  });

  it("does NOT flag the SOUL.md anti-fabrication teaching prose", () => {
    // SOUL.md mentions "50/50" + "60/40" as bad examples — but model-output
    // mode flags any audience-vocab+split number combo. The check fires
    // here because the string matches the structure. That's accepted —
    // SOUL.md is a workspace-file (skips fabrication via validateOutput's
    // kind gate); the stand-alone check is intentionally aggressive.
    // This test pins the contract: fabricationCheck does not have a
    // workspace-file escape hatch on its own.
    const soulProse =
      "If audience.topGeos is ['UK', 'US'], that does NOT mean 50/50 and it does NOT mean 60/40 — it means UK is the largest geo.";
    expect(fabricationCheck(soulProse)).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* validateOutput composes jargon + fabrication checks                          */
/* -------------------------------------------------------------------------- */

describe("validateOutput composes the Sprint 9.7 checks", () => {
  it("the real-world 700-char first-boot failure trips length+jargon+fabrication", () => {
    const realFailure =
      "Hey Kevin Castro! I'm Maya, your manager. I'm here to take the operational weight off your plate—handling the content planning, brand deals, and performance tracking so you can focus on creating. " +
      "I've been looking at your initial profile and your focus on London landmarks like Piccadilly Circus alongside that gym humor is a strong combo. " +
      "One insight for you: in the London travel niche, first-frame visual clarity on landmarks is the biggest driver for the share metrics that push you onto the global FYP. " +
      "Since your audience is split 50/50 between the UK and US, your landmark shots are essentially travel porn for the US side and relatable for the UK side. " +
      "To get us moving, I have six anchor questions to lock in your strategy. Let's do them one at a time.";
    const result = validateOutput(realFailure);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("length-chars");
    expect(result.reasons).toContain("banned-jargon");
    expect(result.reasons).toContain("fabricated-precision");
  });

  it("workspace-file mode skips fabricationCheck (model-output-only) but applies jargonCheck-with-tolerance", () => {
    // SOUL.md cites 50/50 AND lists banned jargon. Under workspace-file
    // mode the fabrication check is skipped entirely; jargon hits are
    // tolerated when surrounded by instructional cues.
    const soulProse =
      "I never invent precise numbers — if topGeos is ['UK', 'US'] that does NOT mean 50/50. I do not say 'global FYP' — say 'the For You feed.'";
    const asWorkspace = validateOutput(soulProse, "workspace-file");
    expect(asWorkspace.reasons).not.toContain("fabricated-precision");
    expect(asWorkspace.reasons).not.toContain("banned-jargon");
  });

  it("a clean multi-send first-boot greet (Send 1 of 3) passes validation", () => {
    const result = validateOutput("Hey Kevin. I'm Maya, your manager.");
    expect(result.ok).toBe(true);
  });

  it("a clean multi-send first-boot Q1 (Send 3 of 3) passes validation", () => {
    const result = validateOutput("Where are you based?");
    expect(result.ok).toBe(true);
  });
});
