/**
 * maya-clip-editor — pure-logic intent parser + invocation builder.
 *
 * Sprint 7c. Maya orchestrates; the pinned ClawHub capcut skill renders.
 * This module is the parser + invocation composer + defensive output parser
 * the wrapping Convex action calls between receiving the creator's message
 * and dispatching to capcut.
 *
 * Pure TypeScript. No Convex imports. No network. No hardcoded judgement
 * tables — the only hardcoded constants are mechanical contracts (duration
 * ceiling, capcut version pin, confidence threshold, capcut output schema).
 */

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type EditIntent = "trim" | "captions" | "speed" | "loop" | "crop";

export type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "x";

export interface EditParams {
  /** Target duration in milliseconds when the intent is `trim` or `captions+trim`. */
  readonly targetDurationMs?: number;
  /** Speed factor when the intent is `speed`. 1.0 = unchanged. 1.5 = 1.5x. */
  readonly speedFactor?: number;
  /** Caption language hint, defaults to "en" upstream when absent. */
  readonly language?: string;
  /** Aspect ratio hint when the intent is `crop`. */
  readonly aspectRatio?: "9:16" | "1:1" | "16:9" | "4:5";
  /** Loop start / end window when the intent is `loop`. */
  readonly loopWindowMs?: { readonly startMs: number; readonly endMs: number };
}

export interface ParsedIntent {
  readonly intent: EditIntent;
  /** Score in [0, 1]. < 0.5 = ambiguous; the action should ask, not guess. */
  readonly confidence: number;
  readonly params: EditParams;
}

export interface CreatorPictureForEdit {
  readonly voiceFingerprint: string;
  readonly niche?: string;
}

export interface HookExtractorMark {
  readonly atMs: number;
  readonly reason: string;
}

export interface ClipEditInput {
  readonly videoUrl: string;
  readonly durationMs: number;
  readonly creatorPrompt: string;
  readonly creatorPicture: CreatorPictureForEdit;
  readonly targetPlatform?: Platform;
  readonly hookExtractorMarks?: ReadonlyArray<HookExtractorMark>;
}

export interface CapcutInvocation {
  readonly skillSlug: "mahmoudadelbghany/ffmpeg-video-editor";
  readonly skillVersion: "1.0.0";
  readonly preset:
    | "trim"
    | "burn-captions"
    | "trim-and-caption"
    | "speed-ramp"
    | "loop"
    | "recrop";
  readonly args: {
    readonly inputUrl: string;
    readonly durationMs?: number;
    readonly speedFactor?: number;
    readonly aspectRatio?: "9:16" | "1:1" | "16:9" | "4:5";
    readonly loopWindowMs?: { readonly startMs: number; readonly endMs: number };
    readonly captionsLanguage?: string;
    readonly hookKeepWindowMs?: { readonly startMs: number; readonly endMs: number };
  };
}

export interface ClipEditResult {
  readonly outputUrl: string;
  readonly durationMs: number;
  readonly format: "mp4";
  readonly captionsUrl?: string;
}

/* -------------------------------------------------------------------------- */
/* Hardcoded mechanical contracts                                              */
/* -------------------------------------------------------------------------- */

/** Hard ceiling — capcut delegate is short-form. Operator-locked. */
export const MAX_INPUT_DURATION_MS = 10 * 60 * 1000;

/** Below this confidence the action should ask, not guess. */
export const INTENT_CONFIDENCE_THRESHOLD = 0.5;

/** Per-platform default duration ceiling for trim presets (ms). */
const PLATFORM_DURATION_CAP_MS: Record<Platform, number> = {
  tiktok: 60_000,
  instagram: 90_000,
  youtube: 60_000, // Shorts assumption; long-form deferred
  linkedin: 140_000,
  x: 140_000,
};

/* -------------------------------------------------------------------------- */
/* Intent parser                                                               */
/* -------------------------------------------------------------------------- */

const TRIM_RE =
  /\b(trim|cut|shorten|shorter|make it (?:short|\d+\s*(?:s|sec|seconds?))|under \d+|tighter)\b/i;
const CAPTIONS_RE =
  /\b(captions?|subtitles?|subs|burn(?:ed)? captions?|closed[- ]?caption(?:ed)?)\b/i;
const SPEED_RE =
  /\b(speed (?:up|it up)?|slow (?:down|it down)?|faster|slower|\d+(?:\.\d+)?\s*x|double[- ]speed|half[- ]speed)\b/i;
const LOOP_RE = /\b(loop|boomerang|repeat|seamless ?loop)\b/i;
const CROP_RE =
  /\b(crop|recrop|reframe|9:?16|1:?1|16:?9|4:?5|vertical|square|landscape)\b/i;

const DURATION_SECONDS_RE =
  /\b(?:to|under|≤|<=|in)\s*(\d+)\s*(?:s|sec|secs|seconds?)\b/i;
const DURATION_MINUTES_RE =
  /\b(?:to|under|≤|<=|in)\s*(\d+)\s*(?:m|min|mins|minutes?)\b/i;
const SPEED_FACTOR_RE = /\b(\d+(?:\.\d+)?)\s*x\b/i;

function detectAspectRatio(prompt: string): EditParams["aspectRatio"] | undefined {
  if (/9:?16|vertical/i.test(prompt)) return "9:16";
  if (/1:?1|\bsquare\b/i.test(prompt)) return "1:1";
  if (/16:?9|landscape|horizontal/i.test(prompt)) return "16:9";
  if (/4:?5/i.test(prompt)) return "4:5";
  return undefined;
}

function platformDefaultAspect(p: Platform | undefined): EditParams["aspectRatio"] | undefined {
  if (!p) return undefined;
  switch (p) {
    case "tiktok":
    case "instagram":
      return "9:16";
    case "youtube":
      return "9:16"; // Shorts default
    case "linkedin":
      return "1:1";
    case "x":
      return "16:9";
  }
}

function parseTargetDurationMs(prompt: string, fallbackPlatform?: Platform): number | undefined {
  const sec = prompt.match(DURATION_SECONDS_RE);
  if (sec) return Number(sec[1]) * 1000;
  const min = prompt.match(DURATION_MINUTES_RE);
  if (min) return Number(min[1]) * 60 * 1000;
  if (fallbackPlatform) return PLATFORM_DURATION_CAP_MS[fallbackPlatform];
  return undefined;
}

function parseSpeedFactor(prompt: string): number | undefined {
  const m = prompt.match(SPEED_FACTOR_RE);
  if (m) return Number(m[1]);
  if (/double[- ]speed/i.test(prompt)) return 2;
  if (/half[- ]speed/i.test(prompt)) return 0.5;
  if (/slow (?:down|it down)|slower/i.test(prompt)) return 0.75;
  if (/speed (?:up|it up)|faster/i.test(prompt)) return 1.5;
  return undefined;
}

/**
 * Extract the creator's edit intent + params from the natural-language prompt.
 *
 * Confidence model:
 *   - Exactly one intent regex matches → 0.85 (clear)
 *   - Multiple intent regexes match → 0.6 (ambiguous-but-actionable; pick the
 *     first that captures explicit numeric params, otherwise pick `trim`)
 *   - No intent regex matches → 0.2 (skill should not run; orchestrator asks)
 *   - Empty / whitespace prompt → 0.0
 *
 * The threshold below which the orchestrator must ask is 0.5
 * (`INTENT_CONFIDENCE_THRESHOLD`). The 0.6 multi-match score sits above the
 * threshold deliberately — when the creator says "trim this and add
 * captions" we treat that as a `captions` intent (which subsumes trim) and
 * proceed.
 */
export function parseEditIntent(text: string): ParsedIntent {
  const prompt = (text ?? "").trim();
  if (prompt.length === 0) {
    return { intent: "trim", confidence: 0, params: {} };
  }

  const matched: EditIntent[] = [];
  if (TRIM_RE.test(prompt)) matched.push("trim");
  if (CAPTIONS_RE.test(prompt)) matched.push("captions");
  if (SPEED_RE.test(prompt)) matched.push("speed");
  if (LOOP_RE.test(prompt)) matched.push("loop");
  if (CROP_RE.test(prompt)) matched.push("crop");

  if (matched.length === 0) {
    return { intent: "trim", confidence: 0.2, params: {} };
  }

  // When captions co-occur with trim, captions is the higher-stakes intent
  // (it implies a transcription delegate too); prefer captions.
  let intent: EditIntent;
  if (matched.includes("captions")) intent = "captions";
  else if (matched.includes("trim")) intent = "trim";
  else intent = matched[0];

  const params: EditParams = {};
  const targetDurationMs = parseTargetDurationMs(prompt);
  if (targetDurationMs !== undefined) (params as { targetDurationMs?: number }).targetDurationMs = targetDurationMs;
  const speedFactor = parseSpeedFactor(prompt);
  if (intent === "speed" && speedFactor !== undefined) (params as { speedFactor?: number }).speedFactor = speedFactor;
  const aspect = detectAspectRatio(prompt);
  if (aspect) (params as { aspectRatio?: EditParams["aspectRatio"] }).aspectRatio = aspect;
  if (intent === "captions") (params as { language?: string }).language = "en";

  const confidence = matched.length === 1 ? 0.85 : 0.6;
  return { intent, confidence, params };
}

/* -------------------------------------------------------------------------- */
/* Invocation builder                                                          */
/* -------------------------------------------------------------------------- */

function preferredHookWindowMs(
  marks: ReadonlyArray<HookExtractorMark> | undefined,
  durationMs: number
): { startMs: number; endMs: number } | undefined {
  if (!marks || marks.length === 0) return undefined;
  const top = marks[0];
  const start = Math.max(0, top.atMs - 500);
  const end = Math.min(durationMs, top.atMs + 1500);
  return { startMs: start, endMs: end };
}

/**
 * Compose the args for the pinned capcut skill. The preset is selected from
 * the parsed intent + whether captions co-occur with a trim. Hook-extractor
 * marks (when present) are forwarded so capcut's keep-window biases toward
 * the strongest hook.
 *
 * Anti-sycophancy / trust-LLM-judgement: we do NOT score the input or weight
 * any qualitative property here. Mechanical args only.
 */
export function buildCapcutInvocation(input: ClipEditInput): CapcutInvocation {
  const parsed = parseEditIntent(input.creatorPrompt);

  const intentToPreset: Record<EditIntent, CapcutInvocation["preset"]> = {
    trim: "trim",
    captions: parsed.params.targetDurationMs !== undefined ? "trim-and-caption" : "burn-captions",
    speed: "speed-ramp",
    loop: "loop",
    crop: "recrop",
  };

  const preset = intentToPreset[parsed.intent];

  // Resolve duration: explicit prompt value first, else platform cap, else
  // leave undefined (capcut keeps the source duration).
  const durationMs =
    parsed.params.targetDurationMs ??
    (input.targetPlatform && (parsed.intent === "trim" || parsed.intent === "captions")
      ? PLATFORM_DURATION_CAP_MS[input.targetPlatform]
      : undefined);

  const aspectRatio = parsed.params.aspectRatio ?? platformDefaultAspect(input.targetPlatform);
  const hookKeepWindowMs = preferredHookWindowMs(input.hookExtractorMarks, input.durationMs);

  const args: CapcutInvocation["args"] = {
    inputUrl: input.videoUrl,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(parsed.params.speedFactor !== undefined ? { speedFactor: parsed.params.speedFactor } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(parsed.params.loopWindowMs ? { loopWindowMs: parsed.params.loopWindowMs } : {}),
    ...(parsed.intent === "captions"
      ? { captionsLanguage: parsed.params.language ?? "en" }
      : {}),
    ...(hookKeepWindowMs ? { hookKeepWindowMs } : {}),
  };

  return {
    skillSlug: "mahmoudadelbghany/ffmpeg-video-editor",
    skillVersion: "1.0.0",
    preset,
    args,
  };
}

/* -------------------------------------------------------------------------- */
/* Output parser (defensive zod schema)                                        */
/* -------------------------------------------------------------------------- */

const capcutOutputSchema = z.object({
  outputUrl: z.string().min(1),
  durationMs: z.number().nonnegative(),
  format: z.literal("mp4").optional(),
  captionsUrl: z.string().min(1).optional(),
});

/**
 * Parse the capcut delegate's raw output into a typed `ClipEditResult`.
 * Defensive: missing optional fields are tolerated; missing required fields
 * throw with a message naming the field. No silent defaults for required
 * data — the wrapping action surfaces the failure to the creator instead of
 * pretending the render succeeded.
 */
export function parseCapcutOutput(rawOutput: unknown): ClipEditResult {
  const parsed = capcutOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "<root>";
    throw new Error(
      `maya-clip-editor: capcut output failed schema validation at "${path}": ${issue?.message ?? "unknown"}`
    );
  }
  const data = parsed.data;
  const result: ClipEditResult = {
    outputUrl: data.outputUrl,
    durationMs: data.durationMs,
    format: "mp4",
    ...(data.captionsUrl ? { captionsUrl: data.captionsUrl } : {}),
  };
  return result;
}

/* -------------------------------------------------------------------------- */
/* Runtime guard                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Throws if the input video duration exceeds the operator-locked ceiling.
 * The wrapping Convex action calls this BEFORE invoking the capcut delegate
 * so over-long inputs never spend credits.
 */
export function runtimeGuard(input: ClipEditInput): void {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
    throw new Error(
      `maya-clip-editor: durationMs must be a non-negative finite number, got ${input.durationMs}`
    );
  }
  if (input.durationMs > MAX_INPUT_DURATION_MS) {
    const minutes = Math.round(input.durationMs / 60_000);
    throw new Error(
      `maya-clip-editor: source video is ${minutes} min — over the ${MAX_INPUT_DURATION_MS / 60_000}-min ceiling. Ask the creator for a rough trim window first.`
    );
  }
  if (input.videoUrl.trim().length === 0) {
    throw new Error("maya-clip-editor: videoUrl is empty.");
  }
}
