/**
 * maya-transcribe — pure-logic wrapper around the pinned
 * `theplasmak/faster-whisper@1.5.1` ClawHub skill.
 *
 * Sprint 5. Owns:
 *   1. Building the faster-whisper invocation args (model size by duration).
 *   2. Defensive parsing of faster-whisper's JSON output (zod schema).
 *   3. Best-effort intent extraction from the transcript.
 *   4. Format-for-creator framing for the messenger surface.
 *
 * No Convex imports. The calling Convex action handles plan-tier gating,
 * the actual ClawHub invocation, and persistence. This file is only the
 * orchestration + post-processing logic.
 */
import { z } from "zod";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type FasterWhisperModel = "tiny" | "base" | "small" | "medium" | "large-v3";

export type FormatHint = "m4a" | "mp3" | "wav" | "mp4" | "mov";

export interface TranscribeInput {
  readonly source: string;
  readonly formatHint?: FormatHint | null;
  readonly durationSec?: number | null;
  readonly languageHint?: string | null;
  readonly vadFilter?: boolean | null;
}

export interface FasterWhisperInvocation {
  readonly skill: "theplasmak/faster-whisper";
  readonly version: "1.5.1";
  readonly args: {
    readonly source: string;
    readonly model: FasterWhisperModel;
    readonly language: string | null;
    readonly vadFilter: boolean;
    readonly wordTimestamps: true;
    readonly formatHint: FormatHint | null;
  };
  readonly routedReason: string;
}

export interface WordTimestamp {
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface TranscribeResult {
  readonly text: string;
  readonly srt: string;
  readonly vtt: string;
  readonly wordTimestamps: ReadonlyArray<WordTimestamp>;
}

export type CreatorIntent =
  | "schedule_post"
  | "reschedule"
  | "cancel"
  | "note"
  | "unknown";

export interface IntentResult {
  readonly intent: CreatorIntent;
  readonly confidence: number;
}

// -----------------------------------------------------------------------------
// Model-size heuristic
// -----------------------------------------------------------------------------

const SHORT_THRESHOLD_SEC = 120;
const MEDIUM_THRESHOLD_SEC = 600;

export function pickFasterWhisperModel(
  durationSec: number | null | undefined
): FasterWhisperModel {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec < 0) {
    // Unknown duration → safe middle ground.
    return "medium";
  }
  if (durationSec <= SHORT_THRESHOLD_SEC) return "small";
  if (durationSec <= MEDIUM_THRESHOLD_SEC) return "medium";
  return "large-v3";
}

// -----------------------------------------------------------------------------
// Invocation builder
// -----------------------------------------------------------------------------

export function buildFasterWhisperInvocation(
  input: TranscribeInput
): FasterWhisperInvocation {
  const model = pickFasterWhisperModel(input.durationSec);
  // VAD default = true unless caller explicitly disables it. Very short clips
  // (<5s) skip VAD because the overhead exceeds the savings.
  const explicitVad = input.vadFilter;
  const inferredVad =
    typeof input.durationSec === "number" && input.durationSec < 5
      ? false
      : true;
  const vadFilter = explicitVad == null ? inferredVad : explicitVad;

  const reason =
    input.durationSec == null
      ? `unknown duration → ${model}`
      : `duration=${Math.round(input.durationSec)}s → ${model}`;

  return {
    skill: "theplasmak/faster-whisper",
    version: "1.5.1",
    args: {
      source: input.source,
      model,
      language: input.languageHint ?? null,
      vadFilter,
      wordTimestamps: true,
      formatHint: input.formatHint ?? null,
    },
    routedReason: reason,
  };
}

// -----------------------------------------------------------------------------
// Defensive parser
// -----------------------------------------------------------------------------

// faster-whisper's JSON shape. All fields optional at the parse layer — we
// fail open to an empty result rather than throw.
const wordSchema = z.object({
  word: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});

const segmentSchema = z.object({
  id: z.number().optional(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
  words: z.array(wordSchema).optional(),
});

const fasterWhisperOutputSchema = z.object({
  text: z.string().optional(),
  language: z.string().optional(),
  segments: z.array(segmentSchema).optional(),
});

const EMPTY_RESULT: TranscribeResult = {
  text: "",
  srt: "",
  vtt: "",
  wordTimestamps: [],
};

const BANNED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bas an? AI (?:assistant|language model)\b/gi,
  /\bI(?:'m| am) just an AI\b/gi,
  /\bas a large language model\b/gi,
];

function stripBanned(s: string): string {
  let out = s;
  for (const p of BANNED_PATTERNS) {
    out = out.replace(p, "").trim();
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

function msFromSec(sec: number): number {
  return Math.max(0, Math.round(sec * 1000));
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

function srtTimestamp(sec: number): string {
  const total = Math.max(0, sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

function vttTimestamp(sec: number): string {
  return srtTimestamp(sec).replace(",", ".");
}

interface ParsedSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly words: ReadonlyArray<WordTimestamp>;
}

function buildSrt(segments: ReadonlyArray<ParsedSegment>): string {
  if (segments.length === 0) return "";
  return segments
    .map(
      (seg, i) =>
        `${i + 1}\n${srtTimestamp(seg.start)} --> ${srtTimestamp(
          seg.end
        )}\n${seg.text.trim()}\n`
    )
    .join("\n");
}

function buildVtt(segments: ReadonlyArray<ParsedSegment>): string {
  if (segments.length === 0) return "";
  const body = segments
    .map(
      (seg) =>
        `${vttTimestamp(seg.start)} --> ${vttTimestamp(
          seg.end
        )}\n${seg.text.trim()}\n`
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

/**
 * Defensive parser. Returns the empty result on any failure rather than
 * throwing — the caller surfaces "transcription failed, retry?" instead of
 * crashing the messenger session.
 */
export function parseFasterWhisperOutput(
  rawOutput: unknown
): TranscribeResult {
  const parsed = fasterWhisperOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    return EMPTY_RESULT;
  }
  const data = parsed.data;
  const segments = data.segments ?? [];

  // Normalize and clean each segment.
  const normalized: ParsedSegment[] = segments
    .map((seg) => {
      const cleanText = stripBanned(seg.text);
      const words: WordTimestamp[] = (seg.words ?? [])
        .map((w) => ({
          word: stripBanned(w.word),
          startMs: msFromSec(w.start),
          endMs: msFromSec(w.end),
        }))
        .filter((w) => w.word.length > 0 && w.endMs >= w.startMs);
      return {
        start: seg.start,
        end: seg.end,
        text: cleanText,
        words,
      };
    })
    .filter((seg) => seg.text.length > 0 && seg.end >= seg.start);

  // Top-level text — prefer the cleaned segment join over raw `text` so
  // banned-term stripping is consistently applied.
  const segmentJoined = normalized.map((s) => s.text).join(" ").trim();
  const fallbackText = stripBanned(data.text ?? "");
  const text = segmentJoined.length > 0 ? segmentJoined : fallbackText;

  if (text.length === 0 && normalized.length === 0) {
    return EMPTY_RESULT;
  }

  const wordTimestamps: WordTimestamp[] = normalized.flatMap((s) => s.words);

  return {
    text,
    srt: buildSrt(normalized),
    vtt: buildVtt(normalized),
    wordTimestamps,
  };
}

// -----------------------------------------------------------------------------
// Format for creator
// -----------------------------------------------------------------------------

export type CreatorFormatIntent = "show-text" | "use-as-input";

export function formatForCreator(
  result: TranscribeResult,
  intent: CreatorFormatIntent
): string {
  const cleaned = result.text.trim();
  if (cleaned.length === 0) {
    if (intent === "show-text") {
      return "I couldn't pick out any words from that audio. Re-send or type it?";
    }
    return "(no audio detected)";
  }
  if (intent === "show-text") return cleaned;
  return `(I transcribed your voice memo: "${cleaned}")`;
}

// -----------------------------------------------------------------------------
// Best-effort intent extraction
// -----------------------------------------------------------------------------

interface IntentRule {
  readonly intent: CreatorIntent;
  readonly test: RegExp;
  readonly confidence: number;
}

// Order matters: cancel before reschedule before schedule, so "cancel that
// post for tuesday" classifies as cancel, not schedule_post.
const INTENT_RULES: ReadonlyArray<IntentRule> = [
  {
    intent: "cancel",
    test: /\b(?:cancel|nevermind|never mind|forget (?:that|it)|scratch that)\b/i,
    confidence: 0.85,
  },
  {
    intent: "reschedule",
    test: /\b(?:push|move|reschedule|delay|bump)\b.*\b(?:to|until|by)\b/i,
    confidence: 0.78,
  },
  {
    intent: "schedule_post",
    // "post X on tuesday" / "schedule X for 3pm" / "post the gym video tuesday"
    test:
      /\b(?:post|publish|schedule|drop|put up)\b.*\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|today|next week|this week|am|pm|\d{1,2}\s*(?::\d{2})?\s*(?:am|pm))\b/i,
    confidence: 0.8,
  },
  {
    intent: "note",
    test: /^\s*(?:remind me|note to self|don't forget|remember to)\b/i,
    confidence: 0.75,
  },
];

const HEDGE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:uh+|um+|maybe|might|i think|kind of|sort of|i guess|not sure|idk)\b/gi,
];

function hedgePenalty(text: string): number {
  let count = 0;
  for (const p of HEDGE_PATTERNS) {
    const matches = text.match(p);
    if (matches) count += matches.length;
  }
  // Each hedge token shaves 0.15 off confidence, capped at 0.6 total.
  return Math.min(0.6, count * 0.15);
}

export function extractIntent(text: string): IntentResult {
  const cleaned = text.trim();
  if (cleaned.length === 0) {
    return { intent: "unknown", confidence: 0 };
  }
  const penalty = hedgePenalty(cleaned);
  for (const rule of INTENT_RULES) {
    if (rule.test.test(cleaned)) {
      const confidence = Math.max(0, rule.confidence - penalty);
      return { intent: rule.intent, confidence: Math.round(confidence * 100) / 100 };
    }
  }
  return { intent: "unknown", confidence: 0 };
}
