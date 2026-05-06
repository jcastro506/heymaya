/**
 * maya-thumbnail-maker — pure-logic intent parser + invocation builder.
 *
 * Sprint 7c. Maya orchestrates; the pinned ClawHub
 * `psyduckler/instagram-photo-text-overlay` skill renders. This module is
 * the parser + invocation composer + defensive output parser the wrapping
 * Convex action calls between receiving the creator's message and
 * dispatching to the overlay delegate.
 *
 * Pure TypeScript. No Convex imports. No network. Mechanical contracts only
 * (overlay-length cap, banned-topic check, confidence threshold).
 */

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type ThumbnailIntent =
  | "thumbnail"
  | "text-overlay"
  | "caption-overlay";

export type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "x";

export interface ThumbnailParams {
  /** The text the creator wants overlaid. Empty string when intent is bare-thumbnail. */
  readonly overlayText: string;
  /** Color hint extracted from the prompt ("white", "yellow", "black", etc.). */
  readonly colorHint?: string;
  /** Font weight hint, drawn from prose adjectives. */
  readonly fontWeight?: "regular" | "bold" | "extra-bold";
  /** Placement hint ("top" / "bottom" / "center"). */
  readonly placement?: "top" | "bottom" | "center";
}

export interface ParsedThumbnailIntent {
  readonly intent: ThumbnailIntent;
  /** Score in [0, 1]. < 0.5 = ambiguous; the action should ask, not guess. */
  readonly confidence: number;
  readonly params: ThumbnailParams;
}

export interface AttachmentMeta {
  readonly width?: number;
  readonly height?: number;
  readonly contentType?: string;
}

export interface CreatorPicture {
  readonly voiceFingerprint: string;
  readonly niche?: string;
  readonly boundaries?: {
    readonly banned_topics?: ReadonlyArray<string>;
  };
}

export interface ThumbnailInput {
  readonly imageUrl: string;
  readonly attachment: AttachmentMeta;
  readonly creatorPrompt: string;
  readonly creatorPicture: CreatorPicture;
  readonly targetPlatform?: Platform;
}

export interface InstagramPhotoTextOverlayInvocation {
  readonly skillSlug: "psyduckler/instagram-photo-text-overlay";
  readonly skillVersion: "1.0.0";
  readonly args: {
    readonly inputUrl: string;
    readonly overlayText: string;
    readonly colorHint?: string;
    readonly fontWeight?: "regular" | "bold" | "extra-bold";
    readonly placement?: "top" | "bottom" | "center";
    readonly canvasSize?: { readonly w: number; readonly h: number };
  };
}

export interface ThumbnailResult {
  readonly outputUrl: string;
  readonly format: "png" | "jpg";
  readonly dimensions: { readonly w: number; readonly h: number };
}

/* -------------------------------------------------------------------------- */
/* Hardcoded mechanical contracts                                              */
/* -------------------------------------------------------------------------- */

/** Hard cap — overlay reads as a sentence past 10 words. */
export const MAX_OVERLAY_WORDS = 10;

/** Below this confidence the action should ask, not guess. */
export const INTENT_CONFIDENCE_THRESHOLD = 0.5;

/** Per-platform default canvas (pixels). YouTube cover, IG square, etc. */
const PLATFORM_CANVAS: Record<Platform, { w: number; h: number }> = {
  youtube: { w: 1280, h: 720 }, // 16:9 thumbnail
  tiktok: { w: 1080, h: 1920 }, // 9:16
  instagram: { w: 1080, h: 1350 }, // 4:5
  linkedin: { w: 1200, h: 627 }, // landscape
  x: { w: 1200, h: 675 },
};

/* -------------------------------------------------------------------------- */
/* Intent parser                                                               */
/* -------------------------------------------------------------------------- */

const THUMBNAIL_RE = /\b(thumbnail|cover|cover[- ]frame|youtube cover)\b/i;
const TEXT_OVERLAY_RE =
  /\b(text overlay|overlay text|big text|throw .* on(?: top| this)|add\b[^.!?]{0,40}\btext|hook on top|punchy (?:hook|text)|text\s+(?:in|at|on)\b)\b/i;
const CAPTION_OVERLAY_RE =
  /\b(burn(?:ed)?[- ]in caption|hardcoded subtitle|captions? overlay)\b/i;

const QUOTED_TEXT_RE = /["“”'‘’]([^"“”'‘’]{1,200})["“”'‘’]/;
const SAYING_RE = /\b(?:saying|says|that says|reading|reads)[:\-,]?\s+(.{2,80}?)(?:[.!?]|$)/i;

const COLOR_RE =
  /\b(white|black|yellow|red|blue|green|pink|purple|orange|cyan)\b/i;
const BOLD_RE = /\b(bold|heavy|punchy|extra[- ]bold|impact)\b/i;
const PLACEMENT_TOP_RE = /\b(top|on top|above|over)\b/i;
const PLACEMENT_BOTTOM_RE = /\b(bottom|below|under)\b/i;
const PLACEMENT_CENTER_RE = /\b(center|middle|centered)\b/i;

function extractOverlayText(prompt: string): string {
  const quoted = prompt.match(QUOTED_TEXT_RE);
  if (quoted) return quoted[1].trim();
  const saying = prompt.match(SAYING_RE);
  if (saying) return saying[1].trim().replace(/[,.!?]+$/, "");
  return "";
}

function extractPlacement(prompt: string): ThumbnailParams["placement"] | undefined {
  if (PLACEMENT_BOTTOM_RE.test(prompt)) return "bottom";
  if (PLACEMENT_CENTER_RE.test(prompt)) return "center";
  if (PLACEMENT_TOP_RE.test(prompt)) return "top";
  return undefined;
}

/**
 * Extract the creator's thumbnail intent + overlay params from the NL prompt.
 *
 * Confidence model (mirrors `maya-clip-editor`'s contract for action-layer
 * consistency):
 *   - Exactly one intent regex matches → 0.85
 *   - Multiple match (e.g. "thumbnail with overlay text") → 0.7 (the two
 *     intents are not mutually-exclusive; we proceed with the higher-fidelity
 *     `text-overlay` because it carries the actual text)
 *   - No regex matches but image attachment is present → 0.2 (ask)
 *   - Empty prompt → 0
 */
export function parseThumbnailIntent(
  text: string,
  _attachment: AttachmentMeta
): ParsedThumbnailIntent {
  const prompt = (text ?? "").trim();
  if (prompt.length === 0) {
    return { intent: "thumbnail", confidence: 0, params: { overlayText: "" } };
  }

  const matched: ThumbnailIntent[] = [];
  if (THUMBNAIL_RE.test(prompt)) matched.push("thumbnail");
  if (TEXT_OVERLAY_RE.test(prompt)) matched.push("text-overlay");
  if (CAPTION_OVERLAY_RE.test(prompt)) matched.push("caption-overlay");

  if (matched.length === 0) {
    return { intent: "thumbnail", confidence: 0.2, params: { overlayText: "" } };
  }

  // Prefer the higher-fidelity intent that carries the overlay text.
  let intent: ThumbnailIntent;
  if (matched.includes("text-overlay")) intent = "text-overlay";
  else if (matched.includes("caption-overlay")) intent = "caption-overlay";
  else intent = "thumbnail";

  const overlayText = extractOverlayText(prompt);

  const params: ThumbnailParams = {
    overlayText,
    ...(COLOR_RE.test(prompt) ? { colorHint: prompt.match(COLOR_RE)![0].toLowerCase() } : {}),
    ...(BOLD_RE.test(prompt) ? { fontWeight: "extra-bold" as const } : {}),
    ...(extractPlacement(prompt) ? { placement: extractPlacement(prompt)! } : {}),
  };

  const confidence = matched.length === 1 ? 0.85 : 0.7;
  return { intent, confidence, params };
}

/* -------------------------------------------------------------------------- */
/* Pre-render validator                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Validate the overlay text against the two operator-locked guards before
 * dispatching to the delegate:
 *   (a) overlay ≤ 10 words — readability contract
 *   (b) overlay does not name a topic the creator banned in onboarding
 *
 * These are mechanical scope boundaries, not quality judgements. Maya's
 * intelligence runs upstream (does this hook actually work?) — this guard
 * just stops obvious contract violations from spending delegate credits.
 */
export function validateOverlayBeforeRender(
  input: ThumbnailInput,
  picture: CreatorPicture
): { ok: boolean; reasons?: string[] } {
  const parsed = parseThumbnailIntent(input.creatorPrompt, input.attachment);
  const reasons: string[] = [];

  // No overlay text? Fine for bare-thumbnail intent; not fine for text-overlay.
  if (
    (parsed.intent === "text-overlay" || parsed.intent === "caption-overlay") &&
    parsed.params.overlayText.length === 0
  ) {
    reasons.push("overlay-intent prompt did not specify the text to burn in");
  }

  if (parsed.params.overlayText.length > 0) {
    const wordCount = parsed.params.overlayText.split(/\s+/).filter(Boolean).length;
    if (wordCount > MAX_OVERLAY_WORDS) {
      reasons.push(
        `overlay is ${wordCount} words — past the ${MAX_OVERLAY_WORDS}-word ceiling for thumbnail readability`
      );
    }

    const bannedTopics = picture.boundaries?.banned_topics ?? [];
    const overlayLower = parsed.params.overlayText.toLowerCase();
    for (const topic of bannedTopics) {
      const t = topic.toLowerCase().trim();
      if (t.length === 0) continue;
      if (overlayLower.includes(t)) {
        reasons.push(`overlay text touches creator-banned topic "${topic}"`);
      }
    }
  }

  if (input.imageUrl.trim().length === 0) {
    reasons.push("imageUrl is empty");
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/* -------------------------------------------------------------------------- */
/* Invocation builder                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Compose the args for the pinned photo-text-overlay skill. We forward the
 * parsed overlay params verbatim and bias the canvas size toward the
 * `targetPlatform` when set.
 */
export function buildOverlayInvocation(
  input: ThumbnailInput
): InstagramPhotoTextOverlayInvocation {
  const parsed = parseThumbnailIntent(input.creatorPrompt, input.attachment);
  const canvas = input.targetPlatform ? PLATFORM_CANVAS[input.targetPlatform] : undefined;

  const args: InstagramPhotoTextOverlayInvocation["args"] = {
    inputUrl: input.imageUrl,
    overlayText: parsed.params.overlayText,
    ...(parsed.params.colorHint ? { colorHint: parsed.params.colorHint } : {}),
    ...(parsed.params.fontWeight ? { fontWeight: parsed.params.fontWeight } : {}),
    ...(parsed.params.placement ? { placement: parsed.params.placement } : {}),
    ...(canvas ? { canvasSize: canvas } : {}),
  };

  return {
    skillSlug: "psyduckler/instagram-photo-text-overlay",
    skillVersion: "1.0.0",
    args,
  };
}

/* -------------------------------------------------------------------------- */
/* Output parser (defensive zod schema)                                        */
/* -------------------------------------------------------------------------- */

const overlayOutputSchema = z.object({
  outputUrl: z.string().min(1),
  format: z.enum(["png", "jpg"]),
  dimensions: z.object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  }),
});

/**
 * Parse the photo-text-overlay delegate's raw output into a typed
 * `ThumbnailResult`. Defensive: missing required fields throw with a path
 * pointing at the offending field. No silent defaults — the wrapping action
 * surfaces failure to the creator instead of pretending the render succeeded.
 */
export function parseOverlayOutput(rawOutput: unknown): ThumbnailResult {
  const parsed = overlayOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "<root>";
    throw new Error(
      `maya-thumbnail-maker: overlay output failed schema validation at "${path}": ${issue?.message ?? "unknown"}`
    );
  }
  return parsed.data;
}
