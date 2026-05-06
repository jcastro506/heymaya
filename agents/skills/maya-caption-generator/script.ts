/**
 * maya-caption-generator — pure-logic prompt builder + per-platform validator.
 *
 * Sprint 7c. Maya orchestrates; the model router writes the caption; the
 * voice applier adjusts it to the creator's fingerprint. This module is the
 * scaffold that produces the prompt + parses + validates the output. It does
 * NOT score the caption qualitatively (per operator: trust the LLM judgement
 * on creative work).
 *
 * Pure TypeScript. No Convex imports. No network. Mechanical contracts only:
 * per-platform character cap, hashtag count cap, voice-applier pass-through.
 */

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "x";

export type CaptionLength = "short" | "medium" | "long";

export interface CreatorPicture {
  readonly voiceFingerprint: string;
  readonly niche?: string;
  readonly audience?: {
    readonly interestTags?: ReadonlyArray<string>;
  };
}

export interface CaptionPromptArgs {
  readonly topic: string;
  readonly picture: CreatorPicture;
  readonly platform: Platform;
  readonly targetLength?: CaptionLength;
}

export interface CaptionVariant {
  readonly platform: Platform;
  readonly text: string;
  readonly hashtags: ReadonlyArray<string>;
  readonly characterCount: number;
}

export interface ParsedCaption {
  readonly text: string;
  readonly hashtags: ReadonlyArray<string>;
  readonly characterCount: number;
}

/* -------------------------------------------------------------------------- */
/* Per-platform mechanical contracts                                           */
/* -------------------------------------------------------------------------- */

export interface PlatformContract {
  readonly maxCharacters: number;
  readonly maxHashtags: number;
  readonly voiceTuning: string;
}

/**
 * Per-platform contracts — the published platform constraints. These are
 * NOT a tuning surface. They are mechanical limits the platform enforces,
 * so we enforce them server-side before the creator pastes the caption.
 */
export const PLATFORM_CONTRACTS: Record<Platform, PlatformContract> = {
  tiktok: {
    maxCharacters: 2200,
    maxHashtags: 30,
    voiceTuning: "punchy, spoken, hook in line one, native short-form rhythm",
  },
  instagram: {
    maxCharacters: 2200,
    maxHashtags: 30,
    voiceTuning: "mid-length, emoji-positive, story arc OK, line breaks for skim",
  },
  youtube: {
    maxCharacters: 5000,
    maxHashtags: 15,
    voiceTuning: "keyword-front-loaded for search, longer body OK, clear CTA at the end",
  },
  linkedin: {
    maxCharacters: 3000,
    maxHashtags: 5,
    voiceTuning: "conversational, no aggressive hashtag stuffing, narrative beats reach",
  },
  x: {
    maxCharacters: 280,
    maxHashtags: 5,
    voiceTuning: "tight, hooky, one image of the thread, no link in the first tweet",
  },
};

/* -------------------------------------------------------------------------- */
/* Prompt builder                                                              */
/* -------------------------------------------------------------------------- */

function lengthGuidance(length: CaptionLength | undefined, platform: Platform): string {
  if (length === "short") return "Keep it tight — under 200 characters total.";
  if (length === "long") {
    if (platform === "x") return "X cannot go long; produce a 3-tweet thread, the first ≤ 280 chars.";
    return "Use the platform's full canvas; tell the story.";
  }
  // medium / undefined
  switch (platform) {
    case "x":
      return "Single tweet ≤ 280 chars. If it cannot fit, surface a thread.";
    case "linkedin":
      return "Aim for 600-1200 characters with 3-4 line breaks for skim.";
    case "youtube":
      return "Aim for 800-1500 characters; front-load the first sentence with the search keyword.";
    default:
      return "Aim for 300-600 characters.";
  }
}

/**
 * Compose the model prompt for a per-platform caption. The prompt:
 *   - cites the contract (max chars, max hashtags, tuning)
 *   - cites at least one anchor from the creator's voiceFingerprint
 *   - asks for explicit body / hashtag separation in the response
 *   - bans sycophancy patterns (no "this is fire", "love this", etc.)
 *
 * Returns a plain-string prompt the wrapping action passes to the model
 * router. We do NOT call the model here.
 */
export function buildCaptionPrompt(args: CaptionPromptArgs): string {
  const contract = PLATFORM_CONTRACTS[args.platform];
  const niche = args.picture.niche ? `Creator niche: ${args.picture.niche}.` : "";
  const interests =
    args.picture.audience?.interestTags && args.picture.audience.interestTags.length > 0
      ? `Audience interests: ${args.picture.audience.interestTags.slice(0, 5).join(", ")}.`
      : "";

  return [
    `You are drafting a ${args.platform} caption for a creator.`,
    `Topic: ${args.topic}`,
    niche,
    interests,
    `Creator voice fingerprint (anchor at least one of these patterns into the caption — em-dash habit, lowercase rules, signature phrases, emoji posture):`,
    args.picture.voiceFingerprint,
    `Platform contract: max ${contract.maxCharacters} characters total (caption body + hashtags). Max ${contract.maxHashtags} hashtags.`,
    `Tuning: ${contract.voiceTuning}.`,
    lengthGuidance(args.targetLength, args.platform),
    `Anti-sycophancy: do not write phrases like "this is fire", "loving this", "absolutely insane", "you crushed it". Do not promise virality. Do not fabricate audience reactions.`,
    `Output format (verbatim):`,
    `BODY:`,
    `<caption body, no hashtags>`,
    `HASHTAGS:`,
    `<space-separated hashtag tokens, each starting with # — or "(none)" if you'd skip them>`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* Response parser                                                             */
/* -------------------------------------------------------------------------- */

const BODY_HEADER_RE = /^BODY:\s*$/im;
const HASHTAGS_HEADER_RE = /^HASHTAGS:\s*$/im;
const HASHTAG_TOKEN_RE = /#[A-Za-z0-9_]+/g;

/**
 * Parse the model's structured response into a typed caption. Defensive:
 * tolerates extra whitespace, missing HASHTAGS section ("(none)" or absent),
 * but requires the BODY section. Throws if the BODY is empty.
 */
export function parseCaptionResponse(modelOutput: string, platform: Platform): ParsedCaption {
  const text = modelOutput ?? "";
  const bodyMatch = text.match(BODY_HEADER_RE);
  if (!bodyMatch) {
    throw new Error(
      `maya-caption-generator: model output missing BODY: header for platform ${platform}`
    );
  }
  const bodyStart = bodyMatch.index! + bodyMatch[0].length;
  const hashtagsMatch = text.match(HASHTAGS_HEADER_RE);
  const bodyEnd = hashtagsMatch ? hashtagsMatch.index! : text.length;
  const body = text.slice(bodyStart, bodyEnd).trim();

  if (body.length === 0) {
    throw new Error(
      `maya-caption-generator: BODY section is empty for platform ${platform}`
    );
  }

  let hashtags: string[] = [];
  if (hashtagsMatch) {
    const hashStart = hashtagsMatch.index! + hashtagsMatch[0].length;
    const hashSegment = text.slice(hashStart).trim();
    if (hashSegment.toLowerCase() !== "(none)" && hashSegment.length > 0) {
      hashtags = hashSegment.match(HASHTAG_TOKEN_RE) ?? [];
    }
  }

  // Character count includes body + a single space + hashtags joined by spaces
  // (matches what creators paste into the platform composer).
  const hashBlock = hashtags.length > 0 ? " " + hashtags.join(" ") : "";
  const characterCount = body.length + hashBlock.length;

  return { text: body, hashtags, characterCount };
}

/* -------------------------------------------------------------------------- */
/* Per-platform validator                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Mechanical post-render check: does the caption fit the platform contract?
 * Returns ok-or-not + a single reason string. The wrapping action either
 * trims (heuristic) or asks the model to retry with a tighter target.
 */
export function validateCaptionForPlatform(
  caption: { text: string; hashtags: ReadonlyArray<string> } | string,
  platform: Platform
): { ok: boolean; reason?: string } {
  const contract = PLATFORM_CONTRACTS[platform];
  const text = typeof caption === "string" ? caption : caption.text;
  const hashtags = typeof caption === "string"
    ? (text.match(HASHTAG_TOKEN_RE) ?? [])
    : Array.from(caption.hashtags);

  const hashBlock = hashtags.length > 0 ? " " + hashtags.join(" ") : "";
  const totalChars = (typeof caption === "string" ? text.length : text.length + hashBlock.length);

  if (totalChars > contract.maxCharacters) {
    return {
      ok: false,
      reason: `caption is ${totalChars} chars, over the ${platform} ceiling of ${contract.maxCharacters}`,
    };
  }
  if (hashtags.length > contract.maxHashtags) {
    return {
      ok: false,
      reason: `caption has ${hashtags.length} hashtags, over the ${platform} ceiling of ${contract.maxHashtags}`,
    };
  }
  if (text.trim().length === 0) {
    return { ok: false, reason: "caption body is empty" };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Voice-applier pass-through                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Voice-applier hook. Real Convex action wires this to
 * `convex/agents/skills/voiceApplier` (which calls the model router). In test
 * / offline contexts the dependency is missing — we pass the input unchanged
 * and let the caller decide whether to surface the unvoiced caption or block.
 *
 * Sync (not async): the wrapping action handles the async voicing call and
 * passes the resolved string in; this function is here to mark the contract
 * boundary in the skill module.
 */
export interface VoiceApplierFn {
  (caption: string, picture: CreatorPicture): string;
}

/**
 * Compose the caption with the voice applier. When `voiceApplier` is
 * undefined or returns empty, returns the input unchanged.
 *
 * The signature is sync because the skill module is pure logic — async
 * voice-applier calls live in the wrapping Convex action which awaits the
 * applier and then calls this function to pin the result.
 */
export function composeWithVoiceApplier(
  caption: string,
  picture: CreatorPicture,
  voiceApplier?: VoiceApplierFn
): string {
  if (caption.trim().length === 0) return caption;
  if (!voiceApplier) return caption;
  if (picture.voiceFingerprint.trim().length === 0) return caption;
  const out = voiceApplier(caption, picture);
  if (typeof out !== "string" || out.trim().length === 0) return caption;
  return out;
}
