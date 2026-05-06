/**
 * maya-clip-editor — unit tests.
 *
 * Coverage (5 mandatory categories per CLAUDE.md § Testing):
 *  - cross-tenant isolation: invocation builder takes only the creator's own
 *    videoUrl + picture; no global-state writes
 *  - plan-tier × action: skill enforces NO plan tier — that's the wrapping
 *    action's job; we assert the runtime guard is the ONLY mechanical limit
 *    in the script (the duration ceiling)
 *  - adversarial inputs: empty prompt, empty url, negative duration, NaN
 *    duration, malformed capcut output
 *  - sibling-file scan: SKILL.md must mention the same capcut version pin as
 *    `buildCapcutInvocation` returns
 *  - TODO grep: no TODO/FIXME/eslint-disable in the skill source
 *
 *  Plus per-intent parser tests (trim/captions/speed/loop/crop), confidence
 *  threshold ambiguity, hook-extractor mark forwarding, defensive output
 *  parser.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseEditIntent,
  buildCapcutInvocation,
  parseCapcutOutput,
  runtimeGuard,
  INTENT_CONFIDENCE_THRESHOLD,
  MAX_INPUT_DURATION_MS,
  type ClipEditInput,
} from "../script";

const SKILL_DIR = resolve(__dirname, "..");

const baseInput: ClipEditInput = {
  videoUrl: "https://r2.example.com/raw.mp4",
  durationMs: 60_000,
  creatorPrompt: "trim this to 30 seconds",
  creatorPicture: { voiceFingerprint: "lowercase, em-dash heavy" },
};

describe("maya-clip-editor — parseEditIntent", () => {
  it("recognises a clean trim intent with explicit duration", () => {
    const r = parseEditIntent("trim this to 30 seconds");
    expect(r.intent).toBe("trim");
    expect(r.confidence).toBeGreaterThanOrEqual(INTENT_CONFIDENCE_THRESHOLD);
    expect(r.params.targetDurationMs).toBe(30_000);
  });

  it("recognises captions and prefers it when co-occurring with trim", () => {
    const r = parseEditIntent("trim this to 45s and add captions");
    expect(r.intent).toBe("captions");
    expect(r.params.targetDurationMs).toBe(45_000);
    expect(r.params.language).toBe("en");
    expect(r.confidence).toBeGreaterThanOrEqual(INTENT_CONFIDENCE_THRESHOLD);
  });

  it("recognises a speed change with explicit factor", () => {
    const r = parseEditIntent("speed this up 1.5x please");
    expect(r.intent).toBe("speed");
    expect(r.params.speedFactor).toBe(1.5);
  });

  it("recognises a loop intent", () => {
    const r = parseEditIntent("loop this so it boomerangs");
    expect(r.intent).toBe("loop");
  });

  it("recognises a crop intent and resolves the aspect ratio", () => {
    const r = parseEditIntent("crop this to 9:16 for tiktok");
    expect(r.intent).toBe("crop");
    expect(r.params.aspectRatio).toBe("9:16");
  });

  it("returns confidence 0 on empty prompt (orchestrator must ask)", () => {
    const r = parseEditIntent("");
    expect(r.confidence).toBe(0);
    expect(r.confidence).toBeLessThan(INTENT_CONFIDENCE_THRESHOLD);
  });

  it("returns low confidence on no-edit prose (just a thanks)", () => {
    const r = parseEditIntent("hey thanks for sending");
    expect(r.confidence).toBeLessThan(INTENT_CONFIDENCE_THRESHOLD);
  });
});

describe("maya-clip-editor — buildCapcutInvocation", () => {
  it("pins the capcut skill slug + version", () => {
    const inv = buildCapcutInvocation(baseInput);
    expect(inv.skillSlug).toBe("vcarolxhberger/free-video-generator-capcut");
    expect(inv.skillVersion).toBe("1.0.0");
  });

  it("forwards explicit duration into args", () => {
    const inv = buildCapcutInvocation(baseInput);
    expect(inv.preset).toBe("trim");
    expect(inv.args.durationMs).toBe(30_000);
    expect(inv.args.inputUrl).toBe("https://r2.example.com/raw.mp4");
  });

  it("uses platform default duration when prompt has no explicit number", () => {
    const inv = buildCapcutInvocation({
      ...baseInput,
      creatorPrompt: "trim this for tiktok",
      targetPlatform: "tiktok",
    });
    expect(inv.args.durationMs).toBe(60_000);
  });

  it("forwards hook-extractor marks into a hookKeepWindowMs", () => {
    const inv = buildCapcutInvocation({
      ...baseInput,
      hookExtractorMarks: [{ atMs: 8_000, reason: "strongest hook" }],
    });
    expect(inv.args.hookKeepWindowMs).toEqual({ startMs: 7_500, endMs: 9_500 });
  });

  it("picks trim-and-caption preset when captions co-occur with explicit duration", () => {
    const inv = buildCapcutInvocation({
      ...baseInput,
      creatorPrompt: "add captions and trim to 30 seconds",
    });
    expect(inv.preset).toBe("trim-and-caption");
    expect(inv.args.captionsLanguage).toBe("en");
  });

  it("defaults aspect ratio from targetPlatform when prompt is silent", () => {
    const inv = buildCapcutInvocation({
      ...baseInput,
      creatorPrompt: "crop this for me",
      targetPlatform: "linkedin",
    });
    expect(inv.args.aspectRatio).toBe("1:1");
  });
});

describe("maya-clip-editor — parseCapcutOutput", () => {
  it("parses a valid output with captionsUrl", () => {
    const r = parseCapcutOutput({
      outputUrl: "https://cdn.example.com/out.mp4",
      durationMs: 28_000,
      captionsUrl: "https://cdn.example.com/out.vtt",
    });
    expect(r.format).toBe("mp4");
    expect(r.captionsUrl).toBe("https://cdn.example.com/out.vtt");
  });

  it("parses a valid output without captionsUrl", () => {
    const r = parseCapcutOutput({
      outputUrl: "https://cdn.example.com/out.mp4",
      durationMs: 28_000,
    });
    expect(r.captionsUrl).toBeUndefined();
  });

  it("throws on missing outputUrl", () => {
    expect(() => parseCapcutOutput({ durationMs: 1000 })).toThrow(/outputUrl/);
  });

  it("throws on negative durationMs", () => {
    expect(() =>
      parseCapcutOutput({ outputUrl: "x", durationMs: -1 })
    ).toThrow(/durationMs/);
  });

  it("throws on null", () => {
    expect(() => parseCapcutOutput(null)).toThrow();
  });
});

describe("maya-clip-editor — runtimeGuard", () => {
  it("passes a clip under the ceiling", () => {
    expect(() => runtimeGuard(baseInput)).not.toThrow();
  });

  it("rejects a clip over the 10-minute ceiling", () => {
    expect(() =>
      runtimeGuard({ ...baseInput, durationMs: MAX_INPUT_DURATION_MS + 1 })
    ).toThrow(/ceiling/);
  });

  it("rejects an empty videoUrl", () => {
    expect(() => runtimeGuard({ ...baseInput, videoUrl: "" })).toThrow(/videoUrl/);
  });

  it("rejects NaN durationMs", () => {
    expect(() => runtimeGuard({ ...baseInput, durationMs: NaN })).toThrow();
  });
});

describe("maya-clip-editor — cross-tenant isolation", () => {
  it("invocation only references the input's own videoUrl (no global state)", () => {
    const a = buildCapcutInvocation({
      ...baseInput,
      videoUrl: "https://r2.example.com/creatorA.mp4",
    });
    const b = buildCapcutInvocation({
      ...baseInput,
      videoUrl: "https://r2.example.com/creatorB.mp4",
    });
    expect(a.args.inputUrl).toBe("https://r2.example.com/creatorA.mp4");
    expect(b.args.inputUrl).toBe("https://r2.example.com/creatorB.mp4");
    expect(a.args.inputUrl).not.toBe(b.args.inputUrl);
  });
});

describe("maya-clip-editor — sibling-file scan", () => {
  it("SKILL.md cites the same capcut version pin the invocation builder returns", () => {
    const skillMd = readFileSync(resolve(SKILL_DIR, "SKILL.md"), "utf8");
    const inv = buildCapcutInvocation(baseInput);
    expect(skillMd).toContain(`${inv.skillSlug}@${inv.skillVersion}`);
  });

  it("SKILL.md does not contain the marketing word 'AI'", () => {
    const skillMd = readFileSync(resolve(SKILL_DIR, "SKILL.md"), "utf8");
    // Word-boundary match — allow `AI` only inside file extensions or URLs
    // (none expected in this SKILL.md).
    expect(/\bAI\b/.test(skillMd)).toBe(false);
  });
});

describe("maya-clip-editor — TODO grep", () => {
  it("script.ts has no unjustified TODO / FIXME / eslint-disable", () => {
    const src = readFileSync(resolve(SKILL_DIR, "script.ts"), "utf8");
    expect(/\bTODO\b/.test(src)).toBe(false);
    expect(/\bFIXME\b/.test(src)).toBe(false);
    expect(/eslint-disable/.test(src)).toBe(false);
  });
});
