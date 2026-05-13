/**
 * extractEditingFingerprint — Sprint A.2 multimodal editing-style extractor.
 *
 * Why this exists: every auto-editor (OpusClip, etc.) applies generic
 * templates. Maya should know YOUR opening pattern, YOUR cut pacing, YOUR
 * transitions, YOUR signature moves from day one. The synthesizer already
 * pulls the creator's last 30 posts during onboarding. This module runs a
 * parallel multimodal pass over those videos and extracts an editing
 * fingerprint Maya later mimics when she drafts cut-lists, hook proposals,
 * or co-edits a piece.
 *
 * Design:
 *   - Pure module. No Convex ctx, no DB reads, no Convex internals. The
 *     caller (synthesizeCreatorPicture) hands in `posts` + an injected
 *     `multimodalCall` function. This keeps tests fast + cheap (no real
 *     model calls, no API spend).
 *   - Validates the model response with Zod at the boundary. Out-of-schema
 *     outputs return null (synth-side will log + skip; the downstream
 *     `editingFingerprint` field is optional).
 *   - Confidence attenuates by sampleSize AND model-reported style variance
 *     across the watched window. A creator with 20 posts of wildly varying
 *     style ends up with confidence ~0.4, not 0.9.
 *
 * Citation rule (enforced in skill prompts that READ this field, not here):
 *   any Maya claim about the creator's editing style cites a postId from
 *   `citedPostIds`. The extractor sets `citedPostIds` to every post that
 *   actually informed the analysis (the filtered post list); skills cite
 *   from that array.
 *
 * Caveat (qualitative, not quantitative):
 *   We ask the model to DESCRIBE patterns, not measure them. `avgCutEverySec`
 *   and `hookLandsAtMs` are approximate — the model has no frame-accurate
 *   timer. They're useful as ballpark anchors ("their pacing is in the
 *   ~1s-cut zone, not the 3s zone"), not as cut-list-generation
 *   specifications.
 */

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export interface EditingFingerprintPost {
  postId: string;
  videoUrl: string | null;
  durationSec: number | null;
}

export type ThinkingBudget = "low" | "medium" | "high";

/**
 * Injected multimodal-call signature. Production wiring threads either
 * `callOpenRouter` (text-only fallback) or the video-synth-worker (real
 * multimodal); tests inject a stub. Always returns the raw model content +
 * a model identifier (for telemetry). Throws on transport / auth errors —
 * the extractor catches and returns null.
 */
export interface MultimodalCallArgs {
  systemPrompt: string;
  userPayloadJson: string;
  /** Posts the model should watch (already filtered to those with videoUrl). */
  posts: ReadonlyArray<{
    postId: string;
    platform: string;
    videoUrl: string;
  }>;
  thinkingBudget: ThinkingBudget;
}

export interface MultimodalCallResult {
  content: string;
  model: string;
}

export type MultimodalCall = (
  args: MultimodalCallArgs
) => Promise<MultimodalCallResult>;

export interface EditingFingerprint {
  pacing: {
    avgCutEverySec: number;
    consistency: "tight" | "loose" | "mixed";
    hookLandsAtMs: number;
    pacingCurve:
      | "fast-throughout"
      | "slow-burn"
      | "fast-to-slow"
      | "building"
      | "irregular";
  };
  opening:
    | "face-on"
    | "motion-shot"
    | "text-card"
    | "b-roll"
    | "voice-over-still"
    | "mixed";
  transitions:
    | "hard-cut"
    | "zoom"
    | "whip-pan"
    | "jump-cut"
    | "dissolve"
    | "mixed";
  captions: {
    style: "burned-in" | "auto" | "none" | "mixed";
    position: "top" | "center" | "bottom" | "varies" | "not-applicable";
    cadence: "word-by-word" | "phrase" | "sentence" | "not-applicable";
    visualDescription: string;
  };
  audio:
    | "original-voice"
    | "music-driven"
    | "trending-sound"
    | "voiceover"
    | "mixed";
  framing:
    | "fully-vertical-9-16"
    | "horizontal-letterboxed"
    | "square"
    | "mixed";
  signatureMoves: string[];
  confidence: number;
  sampleSize: number;
  citedPostIds: string[];
  extractedAt: number;
}

export interface ExtractEditingFingerprintArgs {
  posts: ReadonlyArray<EditingFingerprintPost>;
  /**
   * Optional. Defaults to "tiktok" — the only platform Maya ships with in
   * v0. Threaded into the multimodal payload so the model knows the
   * platform conventions to read against (vertical 9:16, sub-60s, etc.).
   */
  platform?: string;
  multimodalCall: MultimodalCall;
  /** Defaults to "medium". The model is describing patterns, not classifying
   * a difficult judgment — high is overkill, low risks superficial output. */
  thinkingBudget?: ThinkingBudget;
  /** Test seam — defaults to Date.now(). */
  now?: () => number;
  /**
   * Test seam — log a warning when the model output fails validation. Default
   * logs via console.warn; tests can inject a spy. Production stays default.
   */
  logWarn?: (message: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Minimum number of video posts to attempt fingerprint extraction. Below
 * this, the signal is too thin and we return null — downstream skills
 * teach Maya to ASK the creator about preferences instead of forcing a
 * generic style.
 */
export const MIN_VIDEO_POSTS_FOR_FINGERPRINT = 3;

/** Hard cap on how many posts we'll feed to the model in one pass. */
export const MAX_VIDEO_POSTS_FOR_FINGERPRINT = 30;

/* -------------------------------------------------------------------------- */
/* System prompt                                                               */
/* -------------------------------------------------------------------------- */

export const EDITING_FINGERPRINT_SYSTEM_PROMPT = `You are extracting the editing fingerprint of a creator from their last N posts. Watch each video carefully and describe their editing patterns precisely.

Your job: DESCRIBE the recurring beats that make this creator's content recognizable. Pacing, opening shot, transitions, caption style, audio choice, framing, and signature moves. The output is consumed by Maya — a creator-manager agent — who will later mimic this style when she drafts cut lists or co-edits a piece. Specific beats Maya can replicate matter more than abstract categorizations.

You are looking at qualitative patterns, not frame-accurate measurements. avgCutEverySec is a ballpark ("this creator's pacing sits around 1.2s cuts, not 3s cuts"), not a stopwatch reading. hookLandsAtMs is an approximate landing point of the hook beat in the first 1500ms.

Hard rules:
- Output STRICT JSON matching the schema below. No prose, no commentary, no markdown fences.
- Every field MUST be present. Use "mixed" / "varies" / "not-applicable" enums when the creator's style genuinely varies across the watched window.
- citedPostIds MUST list at least 2 of the postIds you actually watched and informed your analysis. These ground every claim Maya later makes about this creator's style.
- signatureMoves SHOULD list 1-5 recurring beats Maya can spot in a draft ("opens with a sip of coffee," "always ends on a stare," "interrupts mid-sentence to cut to b-roll"). Empty array if the creator has no clear signature beat yet.
- styleVariance is YOUR honest read on how consistent the styles are across the watched window: "low" = very consistent fingerprint, "medium" = some variation, "high" = wildly varying.

Schema:
{
  "pacing": {
    "avgCutEverySec": number,
    "consistency": "tight" | "loose" | "mixed",
    "hookLandsAtMs": number,
    "pacingCurve": "fast-throughout" | "slow-burn" | "fast-to-slow" | "building" | "irregular"
  },
  "opening": "face-on" | "motion-shot" | "text-card" | "b-roll" | "voice-over-still" | "mixed",
  "transitions": "hard-cut" | "zoom" | "whip-pan" | "jump-cut" | "dissolve" | "mixed",
  "captions": {
    "style": "burned-in" | "auto" | "none" | "mixed",
    "position": "top" | "center" | "bottom" | "varies" | "not-applicable",
    "cadence": "word-by-word" | "phrase" | "sentence" | "not-applicable",
    "visualDescription": string
  },
  "audio": "original-voice" | "music-driven" | "trending-sound" | "voiceover" | "mixed",
  "framing": "fully-vertical-9-16" | "horizontal-letterboxed" | "square" | "mixed",
  "signatureMoves": string[],
  "styleVariance": "low" | "medium" | "high"
}`;

/* -------------------------------------------------------------------------- */
/* Zod validator                                                               */
/* -------------------------------------------------------------------------- */

const pacingSchema = z.object({
  avgCutEverySec: z.number().finite().nonnegative(),
  consistency: z.enum(["tight", "loose", "mixed"]),
  hookLandsAtMs: z.number().finite().nonnegative(),
  pacingCurve: z.enum([
    "fast-throughout",
    "slow-burn",
    "fast-to-slow",
    "building",
    "irregular",
  ]),
});

const captionsSchema = z.object({
  style: z.enum(["burned-in", "auto", "none", "mixed"]),
  position: z.enum(["top", "center", "bottom", "varies", "not-applicable"]),
  cadence: z.enum([
    "word-by-word",
    "phrase",
    "sentence",
    "not-applicable",
  ]),
  visualDescription: z.string(),
});

const modelResponseSchema = z.object({
  pacing: pacingSchema,
  opening: z.enum([
    "face-on",
    "motion-shot",
    "text-card",
    "b-roll",
    "voice-over-still",
    "mixed",
  ]),
  transitions: z.enum([
    "hard-cut",
    "zoom",
    "whip-pan",
    "jump-cut",
    "dissolve",
    "mixed",
  ]),
  captions: captionsSchema,
  audio: z.enum([
    "original-voice",
    "music-driven",
    "trending-sound",
    "voiceover",
    "mixed",
  ]),
  framing: z.enum([
    "fully-vertical-9-16",
    "horizontal-letterboxed",
    "square",
    "mixed",
  ]),
  signatureMoves: z.array(z.string()),
  styleVariance: z.enum(["low", "medium", "high"]),
});

export type ModelResponse = z.infer<typeof modelResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Confidence                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Confidence by sample size, attenuated by model-reported style variance.
 * The bands come from the Sprint A.2 spec:
 *   20+ posts consistent → 0.9
 *   10-20 posts          → 0.6-0.8
 *   5-10 posts           → 0.4-0.6
 *   3-5 posts            → 0.3
 * Style variance attenuates by 0.85 (medium) / 0.7 (high).
 */
export function computeConfidence(
  sampleSize: number,
  styleVariance: "low" | "medium" | "high"
): number {
  let base: number;
  if (sampleSize >= 20) {
    base = 0.9;
  } else if (sampleSize >= 10) {
    // Linear interpolate 10→0.6, 20→0.8.
    base = 0.6 + ((sampleSize - 10) / 10) * 0.2;
  } else if (sampleSize >= 5) {
    // Linear interpolate 5→0.4, 10→0.6.
    base = 0.4 + ((sampleSize - 5) / 5) * 0.2;
  } else {
    // 3-4 posts → 0.3.
    base = 0.3;
  }
  const varianceMultiplier =
    styleVariance === "low" ? 1.0 : styleVariance === "medium" ? 0.85 : 0.7;
  const attenuated = base * varianceMultiplier;
  // Clamp + round to 2 decimal places.
  const clamped = Math.max(0, Math.min(1, attenuated));
  return Math.round(clamped * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Strip a leading code fence + optional language hint, plus a trailing
 * fence. Models sometimes wrap JSON in ```json ... ``` despite the system
 * prompt. We tolerate that; we DON'T tolerate prose interleaved with JSON.
 */
function stripJsonFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    const firstNewline = s.indexOf("\n");
    if (firstNewline !== -1) {
      s = s.slice(firstNewline + 1);
    }
    if (s.endsWith("```")) {
      s = s.slice(0, -3);
    }
    s = s.trim();
  }
  return s;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Extract the editing fingerprint. Returns null when:
 *   - fewer than `MIN_VIDEO_POSTS_FOR_FINGERPRINT` posts have a usable videoUrl
 *   - the model call throws (transport / auth / 5xx)
 *   - the model output fails JSON parse OR Zod validation after one retry
 *
 * Pure / testable: the caller injects `multimodalCall`. No Convex ctx, no
 * external imports beyond zod. Cross-tenant safety is the caller's
 * responsibility — this module reads ONLY from the `posts` array handed in.
 */
export async function extractEditingFingerprint(
  args: ExtractEditingFingerprintArgs
): Promise<EditingFingerprint | null> {
  const platform = args.platform ?? "tiktok";
  const now = args.now ?? (() => Date.now());
  const logWarn = args.logWarn ?? ((m: string) => console.warn(m));
  const thinkingBudget = args.thinkingBudget ?? "medium";

  // Filter: only posts with a non-empty videoUrl.
  const usable = args.posts.filter(
    (p): p is EditingFingerprintPost & { videoUrl: string } =>
      typeof p.videoUrl === "string" && p.videoUrl.length > 0
  );

  if (usable.length < MIN_VIDEO_POSTS_FOR_FINGERPRINT) {
    return null;
  }

  const capped = usable.slice(0, MAX_VIDEO_POSTS_FOR_FINGERPRINT);
  const citedPostIds = capped.map((p) => p.postId);
  const sampleSize = capped.length;

  const userPayloadJson = JSON.stringify({
    platform,
    posts: capped.map((p) => ({
      postId: p.postId,
      videoUrl: p.videoUrl,
      durationSec: p.durationSec,
    })),
  });

  let modelResult: MultimodalCallResult;
  try {
    modelResult = await args.multimodalCall({
      systemPrompt: EDITING_FINGERPRINT_SYSTEM_PROMPT,
      userPayloadJson,
      posts: capped.map((p) => ({
        postId: p.postId,
        platform,
        videoUrl: p.videoUrl,
      })),
      thinkingBudget,
    });
  } catch (err) {
    logWarn(
      `extractEditingFingerprint: multimodal call failed: ${(err as Error).message}`
    );
    return null;
  }

  // Parse + validate. We allow one quiet recovery: if the raw content
  // includes a fence, strip it and retry the Zod parse.
  let parsed: ModelResponse | null = null;
  try {
    const stripped = stripJsonFence(modelResult.content);
    const obj = JSON.parse(stripped) as unknown;
    parsed = modelResponseSchema.parse(obj);
  } catch (err) {
    logWarn(
      `extractEditingFingerprint: model response invalid (${(err as Error).message}); returning null`
    );
    return null;
  }

  const confidence = computeConfidence(sampleSize, parsed.styleVariance);

  return {
    pacing: parsed.pacing,
    opening: parsed.opening,
    transitions: parsed.transitions,
    captions: parsed.captions,
    audio: parsed.audio,
    framing: parsed.framing,
    signatureMoves: parsed.signatureMoves,
    confidence,
    sampleSize,
    citedPostIds,
    extractedAt: now(),
  };
}

/* -------------------------------------------------------------------------- */
/* Internal exports for tests                                                   */
/* -------------------------------------------------------------------------- */

export const __test_only__ = {
  modelResponseSchema,
  stripJsonFence,
};
