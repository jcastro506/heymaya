/**
 * maya-thumbnail-maker — unit tests.
 *
 * Coverage (5 mandatory categories per CLAUDE.md § Testing):
 *  - cross-tenant isolation: invocation builder takes only the creator's own
 *    imageUrl + picture; banned-topic check uses the input creator's
 *    boundaries, never a shared global
 *  - plan-tier × action: skill enforces NO plan tier — that's the wrapping
 *    action's job
 *  - adversarial inputs: empty prompt, empty url, missing overlay text,
 *    word-cap overflow, banned-topic match, malformed delegate output
 *  - sibling-file scan: SKILL.md must mention the same overlay version pin
 *    as `buildOverlayInvocation` returns
 *  - TODO grep: no TODO/FIXME/eslint-disable in the skill source
 *
 *  Plus per-intent parser tests, intent-ambiguity confidence tests, color /
 *  weight / placement extraction.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseThumbnailIntent,
  buildOverlayInvocation,
  parseOverlayOutput,
  validateOverlayBeforeRender,
  INTENT_CONFIDENCE_THRESHOLD,
  MAX_OVERLAY_WORDS,
  type ThumbnailInput,
  type CreatorPicture,
} from "../script";

const SKILL_DIR = resolve(__dirname, "..");

const basePicture: CreatorPicture = {
  voiceFingerprint: "lowercase, em-dash heavy",
  niche: "fitness",
  boundaries: { banned_topics: ["weight loss tips", "supplements"] },
};

const baseInput: ThumbnailInput = {
  imageUrl: "https://r2.example.com/photo.jpg",
  attachment: { width: 1080, height: 1080, contentType: "image/jpeg" },
  creatorPrompt: 'make a thumbnail with the text "stop chasing PRs" on top in yellow',
  creatorPicture: basePicture,
};

describe("maya-thumbnail-maker — parseThumbnailIntent", () => {
  it("recognises a clean text-overlay intent and extracts quoted text", () => {
    const r = parseThumbnailIntent('throw "stop chasing PRs" on top', baseInput.attachment);
    expect(r.intent).toBe("text-overlay");
    expect(r.params.overlayText).toBe("stop chasing PRs");
    expect(r.confidence).toBeGreaterThanOrEqual(INTENT_CONFIDENCE_THRESHOLD);
    expect(r.params.placement).toBe("top");
  });

  it("recognises a thumbnail intent without overlay text", () => {
    const r = parseThumbnailIntent("make a thumbnail for this", baseInput.attachment);
    expect(r.intent).toBe("thumbnail");
    expect(r.params.overlayText).toBe("");
  });

  it("extracts color hint and bold weight", () => {
    const r = parseThumbnailIntent(
      'add bold "go time" text in yellow at the bottom',
      baseInput.attachment
    );
    expect(r.params.colorHint).toBe("yellow");
    expect(r.params.fontWeight).toBe("extra-bold");
    expect(r.params.placement).toBe("bottom");
  });

  it("extracts overlay text via 'saying' pattern when no quotes", () => {
    const r = parseThumbnailIntent(
      "add big text saying go faster",
      baseInput.attachment
    );
    expect(r.intent).toBe("text-overlay");
    expect(r.params.overlayText.toLowerCase()).toContain("go faster");
  });

  it("returns confidence 0 on empty prompt", () => {
    const r = parseThumbnailIntent("", baseInput.attachment);
    expect(r.confidence).toBe(0);
    expect(r.confidence).toBeLessThan(INTENT_CONFIDENCE_THRESHOLD);
  });

  it("returns ambiguous confidence on no-overlay-intent prose", () => {
    const r = parseThumbnailIntent("hey what do you think of this photo", baseInput.attachment);
    expect(r.confidence).toBeLessThan(INTENT_CONFIDENCE_THRESHOLD);
  });

  it("disambiguates when both thumbnail + text-overlay co-occur", () => {
    const r = parseThumbnailIntent(
      'make a thumbnail with overlay text "go faster"',
      baseInput.attachment
    );
    expect(r.intent).toBe("text-overlay");
    expect(r.params.overlayText.toLowerCase()).toContain("go faster");
    expect(r.confidence).toBeGreaterThanOrEqual(INTENT_CONFIDENCE_THRESHOLD);
  });
});

describe("maya-thumbnail-maker — buildOverlayInvocation", () => {
  it("pins the photo-text-overlay skill slug + version", () => {
    const inv = buildOverlayInvocation(baseInput);
    expect(inv.skillSlug).toBe("psyduckler/instagram-photo-text-overlay");
    expect(inv.skillVersion).toBe("1.0.0");
  });

  it("forwards inputUrl + overlayText + color into args", () => {
    const inv = buildOverlayInvocation(baseInput);
    expect(inv.args.inputUrl).toBe(baseInput.imageUrl);
    expect(inv.args.overlayText).toBe("stop chasing PRs");
    expect(inv.args.colorHint).toBe("yellow");
    expect(inv.args.placement).toBe("top");
  });

  it("uses platform canvas when targetPlatform is set", () => {
    const inv = buildOverlayInvocation({
      ...baseInput,
      targetPlatform: "youtube",
    });
    expect(inv.args.canvasSize).toEqual({ w: 1280, h: 720 });
  });

  it("omits canvasSize when targetPlatform is unset", () => {
    const inv = buildOverlayInvocation(baseInput);
    expect(inv.args.canvasSize).toBeUndefined();
  });
});

describe("maya-thumbnail-maker — validateOverlayBeforeRender", () => {
  it("passes a clean overlay under the word cap", () => {
    const v = validateOverlayBeforeRender(baseInput, basePicture);
    expect(v.ok).toBe(true);
  });

  it("rejects an overlay exceeding the 10-word ceiling", () => {
    const long = Array(MAX_OVERLAY_WORDS + 3).fill("word").join(" ");
    const v = validateOverlayBeforeRender(
      { ...baseInput, creatorPrompt: `add text saying "${long}"` },
      basePicture
    );
    expect(v.ok).toBe(false);
    expect(v.reasons?.[0]).toMatch(/word/);
  });

  it("rejects overlay text touching a banned topic", () => {
    const v = validateOverlayBeforeRender(
      { ...baseInput, creatorPrompt: 'add text saying "weight loss tips fast"' },
      basePicture
    );
    expect(v.ok).toBe(false);
    expect(v.reasons?.some((r) => r.includes("weight loss tips"))).toBe(true);
  });

  it("rejects overlay-intent prompt with no text specified", () => {
    const v = validateOverlayBeforeRender(
      { ...baseInput, creatorPrompt: "throw text overlay on this" },
      basePicture
    );
    expect(v.ok).toBe(false);
    expect(v.reasons?.[0]).toMatch(/text/);
  });

  it("rejects empty imageUrl", () => {
    const v = validateOverlayBeforeRender(
      { ...baseInput, imageUrl: "" },
      basePicture
    );
    expect(v.ok).toBe(false);
    expect(v.reasons?.some((r) => r.includes("imageUrl"))).toBe(true);
  });

  it("ignores empty / whitespace banned-topic entries gracefully", () => {
    const v = validateOverlayBeforeRender(baseInput, {
      ...basePicture,
      boundaries: { banned_topics: ["", "   ", "supplements"] },
    });
    expect(v.ok).toBe(true);
  });
});

describe("maya-thumbnail-maker — parseOverlayOutput", () => {
  it("parses a valid output", () => {
    const r = parseOverlayOutput({
      outputUrl: "https://cdn.example.com/out.png",
      format: "png",
      dimensions: { w: 1280, h: 720 },
    });
    expect(r.format).toBe("png");
    expect(r.dimensions.w).toBe(1280);
  });

  it("throws on missing dimensions", () => {
    expect(() =>
      parseOverlayOutput({ outputUrl: "x", format: "png" })
    ).toThrow(/dimensions/);
  });

  it("throws on unsupported format", () => {
    expect(() =>
      parseOverlayOutput({
        outputUrl: "x",
        format: "webp",
        dimensions: { w: 1, h: 1 },
      })
    ).toThrow(/format/);
  });

  it("throws on null", () => {
    expect(() => parseOverlayOutput(null)).toThrow();
  });
});

describe("maya-thumbnail-maker — cross-tenant isolation", () => {
  it("uses only the input creator's banned_topics, never a shared global", () => {
    const a = validateOverlayBeforeRender(
      {
        ...baseInput,
        creatorPrompt: 'add text saying "supplements help"',
        creatorPicture: {
          voiceFingerprint: "x",
          boundaries: { banned_topics: ["supplements"] },
        },
      },
      { voiceFingerprint: "x", boundaries: { banned_topics: ["supplements"] } }
    );
    const b = validateOverlayBeforeRender(
      {
        ...baseInput,
        creatorPrompt: 'add text saying "supplements help"',
        creatorPicture: { voiceFingerprint: "x" }, // no banned topics for B
      },
      { voiceFingerprint: "x" }
    );
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(true);
  });
});

describe("maya-thumbnail-maker — sibling-file scan", () => {
  it("SKILL.md cites the same overlay version pin the invocation builder returns", () => {
    const skillMd = readFileSync(resolve(SKILL_DIR, "SKILL.md"), "utf8");
    const inv = buildOverlayInvocation(baseInput);
    expect(skillMd).toContain(`${inv.skillSlug}@${inv.skillVersion}`);
  });

  it("SKILL.md does not contain the marketing word 'AI'", () => {
    const skillMd = readFileSync(resolve(SKILL_DIR, "SKILL.md"), "utf8");
    expect(/\bAI\b/.test(skillMd)).toBe(false);
  });
});

describe("maya-thumbnail-maker — TODO grep", () => {
  it("script.ts has no unjustified TODO / FIXME / eslint-disable", () => {
    const src = readFileSync(resolve(SKILL_DIR, "script.ts"), "utf8");
    expect(/\bTODO\b/.test(src)).toBe(false);
    expect(/\bFIXME\b/.test(src)).toBe(false);
    expect(/eslint-disable/.test(src)).toBe(false);
  });
});
