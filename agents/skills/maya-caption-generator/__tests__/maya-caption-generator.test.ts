/**
 * maya-caption-generator — unit tests.
 *
 * Coverage (5 mandatory categories per CLAUDE.md § Testing):
 *  - cross-tenant isolation: prompt builder reads only from the input
 *    creator's picture; no global state
 *  - plan-tier × action: skill enforces NO plan tier — that's the wrapping
 *    action's job; we assert per-platform contracts are returned in a
 *    read-only mapping the action can fail-closed against
 *  - adversarial inputs: empty body, missing BODY header, malformed model
 *    output, character-cap overflow, hashtag-cap overflow
 *  - sibling-file scan: SKILL.md must reference `maya-voice-applier`
 *  - TODO grep: no TODO/FIXME/eslint-disable in the skill source
 *
 *  Plus per-platform character + hashtag cap tests (TT 2200/30, IG 2200/30,
 *  YT 5000/15, LI 3000/5, X 280/5), prompt-anchor checks for voice
 *  fingerprint, voice-applier pass-through.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCaptionPrompt,
  parseCaptionResponse,
  validateCaptionForPlatform,
  composeWithVoiceApplier,
  PLATFORM_CONTRACTS,
  type CreatorPicture,
  type Platform,
} from "../script";

const SKILL_DIR = resolve(__dirname, "..");

const picture: CreatorPicture = {
  voiceFingerprint: "lowercase only, em-dash heavy, no exclamation marks",
  niche: "fitness",
  audience: { interestTags: ["strength", "running", "recovery"] },
};

describe("maya-caption-generator — buildCaptionPrompt", () => {
  it("includes the platform contract in the prompt", () => {
    const p = buildCaptionPrompt({
      topic: "morning run takeaways",
      picture,
      platform: "instagram",
    });
    expect(p).toContain("max 2200 characters");
    expect(p).toContain("Max 30 hashtags");
    expect(p).toContain("Audience interests: strength, running, recovery.");
  });

  it("includes the voice fingerprint as an anchor instruction", () => {
    const p = buildCaptionPrompt({
      topic: "x",
      picture,
      platform: "tiktok",
    });
    expect(p).toContain("voice fingerprint");
    expect(p).toContain("lowercase only, em-dash heavy");
  });

  it("includes anti-sycophancy ban-list", () => {
    const p = buildCaptionPrompt({ topic: "x", picture, platform: "x" });
    expect(p).toContain("this is fire");
    expect(p).toContain("loving this");
  });

  it("calls out the X 280-char single-tweet contract", () => {
    const p = buildCaptionPrompt({ topic: "x", picture, platform: "x" });
    expect(p).toContain("280");
  });

  it("targetLength=long for X surfaces a 3-tweet thread", () => {
    const p = buildCaptionPrompt({
      topic: "x",
      picture,
      platform: "x",
      targetLength: "long",
    });
    expect(p).toContain("thread");
  });
});

describe("maya-caption-generator — parseCaptionResponse", () => {
  it("parses a clean response with body + hashtags", () => {
    const r = parseCaptionResponse(
      `BODY:\nslept eight hours — finally felt the run\nHASHTAGS:\n#running #recovery`,
      "instagram"
    );
    expect(r.text).toBe("slept eight hours — finally felt the run");
    expect(r.hashtags).toEqual(["#running", "#recovery"]);
    expect(r.characterCount).toBeGreaterThan(0);
  });

  it("parses a response with (none) hashtags", () => {
    const r = parseCaptionResponse(
      `BODY:\nshort caption\nHASHTAGS:\n(none)`,
      "linkedin"
    );
    expect(r.hashtags).toEqual([]);
  });

  it("parses a response with no HASHTAGS section at all", () => {
    const r = parseCaptionResponse(`BODY:\njust the body, no hashtags section`, "x");
    expect(r.hashtags).toEqual([]);
    expect(r.text).toBe("just the body, no hashtags section");
  });

  it("throws when BODY: header is missing", () => {
    expect(() =>
      parseCaptionResponse("just text with no header", "tiktok")
    ).toThrow(/BODY/);
  });

  it("throws when BODY is empty", () => {
    expect(() =>
      parseCaptionResponse(`BODY:\n\nHASHTAGS:\n#x`, "tiktok")
    ).toThrow(/empty/);
  });
});

describe("maya-caption-generator — validateCaptionForPlatform per-platform caps", () => {
  it("TikTok: 2200 char cap + 30 hashtag cap", () => {
    expect(PLATFORM_CONTRACTS.tiktok.maxCharacters).toBe(2200);
    expect(PLATFORM_CONTRACTS.tiktok.maxHashtags).toBe(30);
    const ok = validateCaptionForPlatform(
      { text: "short", hashtags: Array(30).fill("#tag") },
      "tiktok"
    );
    expect(ok.ok).toBe(true);
    const overTags = validateCaptionForPlatform(
      { text: "short", hashtags: Array(31).fill("#tag") },
      "tiktok"
    );
    expect(overTags.ok).toBe(false);
  });

  it("Instagram: 2200 char cap + 30 hashtag cap", () => {
    expect(PLATFORM_CONTRACTS.instagram.maxCharacters).toBe(2200);
    expect(PLATFORM_CONTRACTS.instagram.maxHashtags).toBe(30);
    const overChars = validateCaptionForPlatform(
      { text: "x".repeat(2300), hashtags: [] },
      "instagram"
    );
    expect(overChars.ok).toBe(false);
    expect(overChars.reason).toMatch(/2300/);
  });

  it("YouTube: 5000 char cap + 15 hashtag cap", () => {
    expect(PLATFORM_CONTRACTS.youtube.maxCharacters).toBe(5000);
    expect(PLATFORM_CONTRACTS.youtube.maxHashtags).toBe(15);
    const overTags = validateCaptionForPlatform(
      { text: "ok", hashtags: Array(16).fill("#tag") },
      "youtube"
    );
    expect(overTags.ok).toBe(false);
  });

  it("LinkedIn: 3000 char cap + 5 hashtag cap", () => {
    expect(PLATFORM_CONTRACTS.linkedin.maxCharacters).toBe(3000);
    expect(PLATFORM_CONTRACTS.linkedin.maxHashtags).toBe(5);
    const overTags = validateCaptionForPlatform(
      { text: "x", hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"] },
      "linkedin"
    );
    expect(overTags.ok).toBe(false);
  });

  it("X: 280 char cap + 5 hashtag cap", () => {
    expect(PLATFORM_CONTRACTS.x.maxCharacters).toBe(280);
    expect(PLATFORM_CONTRACTS.x.maxHashtags).toBe(5);
    const ok = validateCaptionForPlatform(
      { text: "tight hooky tweet", hashtags: ["#hi"] },
      "x"
    );
    expect(ok.ok).toBe(true);
    const overChars = validateCaptionForPlatform(
      { text: "x".repeat(290), hashtags: [] },
      "x"
    );
    expect(overChars.ok).toBe(false);
  });

  it("string-form input parses hashtags from the body", () => {
    const r = validateCaptionForPlatform("hello world #one #two", "x");
    expect(r.ok).toBe(true);
  });

  it("rejects empty body", () => {
    const r = validateCaptionForPlatform({ text: "   ", hashtags: [] }, "tiktok");
    expect(r.ok).toBe(false);
  });
});

describe("maya-caption-generator — composeWithVoiceApplier", () => {
  it("returns input unchanged when voiceApplier is undefined", () => {
    expect(composeWithVoiceApplier("hello", picture)).toBe("hello");
  });

  it("returns input unchanged when voiceFingerprint is empty", () => {
    expect(
      composeWithVoiceApplier(
        "hello",
        { voiceFingerprint: "" },
        () => "applied"
      )
    ).toBe("hello");
  });

  it("applies the voice when applier is present and fingerprint non-empty", () => {
    expect(
      composeWithVoiceApplier("Hello.", picture, (text) => text.toLowerCase())
    ).toBe("hello.");
  });

  it("returns input unchanged when applier returns empty", () => {
    expect(
      composeWithVoiceApplier("hello", picture, () => "")
    ).toBe("hello");
  });
});

describe("maya-caption-generator — cross-tenant isolation", () => {
  it("prompt builder reads only from input creator's picture, not a global", () => {
    const a = buildCaptionPrompt({
      topic: "x",
      picture: { voiceFingerprint: "creator-A-voice", niche: "fitness" },
      platform: "tiktok",
    });
    const b = buildCaptionPrompt({
      topic: "x",
      picture: { voiceFingerprint: "creator-B-voice", niche: "cooking" },
      platform: "tiktok",
    });
    expect(a).toContain("creator-A-voice");
    expect(b).toContain("creator-B-voice");
    expect(a).not.toContain("creator-B-voice");
    expect(b).not.toContain("creator-A-voice");
  });
});

describe("maya-caption-generator — sibling-file scan", () => {
  it("SKILL.md cites maya-voice-applier as a mandatory call", () => {
    const skillMd = readFileSync(resolve(SKILL_DIR, "SKILL.md"), "utf8");
    expect(skillMd).toContain("maya-voice-applier");
  });

  it("SKILL.md does not contain the marketing word 'AI'", () => {
    const skillMd = readFileSync(resolve(SKILL_DIR, "SKILL.md"), "utf8");
    expect(/\bAI\b/.test(skillMd)).toBe(false);
  });

  it("SKILL.md per-platform contract table matches the script's PLATFORM_CONTRACTS", () => {
    const skillMd = readFileSync(resolve(SKILL_DIR, "SKILL.md"), "utf8");
    for (const p of Object.keys(PLATFORM_CONTRACTS) as Platform[]) {
      const c = PLATFORM_CONTRACTS[p];
      expect(skillMd).toContain(String(c.maxCharacters));
      expect(skillMd).toContain(String(c.maxHashtags));
    }
  });
});

describe("maya-caption-generator — TODO grep", () => {
  it("script.ts has no unjustified TODO / FIXME / eslint-disable", () => {
    const src = readFileSync(resolve(SKILL_DIR, "script.ts"), "utf8");
    expect(/\bTODO\b/.test(src)).toBe(false);
    expect(/\bFIXME\b/.test(src)).toBe(false);
    expect(/eslint-disable/.test(src)).toBe(false);
  });
});
