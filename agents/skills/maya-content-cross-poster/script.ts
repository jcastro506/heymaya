/**
 * maya-content-cross-poster — pure-logic helpers.
 *
 * Sprint 3.5. The Convex action that wires this skill to the model router +
 * voice-applier + platform-best-practice + citation-firewall lives in
 * `convex/agents/skills/contentCrossPoster.ts` (lead pushes). This module is
 * the pure logic the action composes:
 *
 *   - `pickFormat`: per-platform default format choice given the source media type
 *   - `oneTapUrlFor`: best-effort deep-link URL builder
 *   - `fallbackInstructionFor`: the human-language steps when the deep link is unreliable
 *   - `recommendPostingOrder`: avoids cross-post penalty by spacing the publish times
 *
 * No Convex imports. No network. Pure TypeScript.
 */

export type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "x";

export type MediaType = "video" | "image" | "carousel" | "text";

export interface SourcePiece {
  readonly caption: string;
  readonly mediaUrl: string;
  readonly mediaType: MediaType;
}

export interface FormatChoice {
  readonly format: string;
  readonly aspectRatioGuidance: string;
  readonly durationCutSuggestion?: string;
}

/**
 * Per-platform default format given the source media type. The choice can be
 * overridden by `maya-platform-best-practice` (consulted in the wrapping
 * Convex action) when a niche pattern argues otherwise — e.g. food creators
 * on YouTube perform best as Long, not Shorts.
 */
export function pickFormat(
  sourceMediaType: MediaType,
  targetPlatform: Platform
): FormatChoice {
  switch (targetPlatform) {
    case "tiktok":
      // TikTok is always vertical; if the source isn't video, the variant
      // becomes "convert to motion-text-card video".
      if (sourceMediaType === "video") {
        return {
          format: "vertical 9:16, ≤60s",
          aspectRatioGuidance: "9:16 vertical — TikTok native",
          durationCutSuggestion: "Trim to ≤60s. Keep the hook (first 1.5s) and the payoff.",
        };
      }
      return {
        format: "motion-text card video, vertical 9:16",
        aspectRatioGuidance: "9:16 vertical — convert text/image into 8-12s motion card",
      };

    case "instagram":
      if (sourceMediaType === "video") {
        return {
          format: "Reel 9:16, ≤90s",
          aspectRatioGuidance: "9:16 vertical — Instagram Reel",
          durationCutSuggestion: "Trim to ≤90s. First frame doubles as the cover thumbnail.",
        };
      }
      if (sourceMediaType === "carousel" || sourceMediaType === "image") {
        return {
          format: "carousel 4:5, 9-10 slides",
          aspectRatioGuidance: "4:5 portrait — IG carousel",
        };
      }
      return {
        format: "carousel 4:5, 9-10 slides (text rendered to slides)",
        aspectRatioGuidance: "4:5 portrait — render text into slide cards",
      };

    case "youtube":
      if (sourceMediaType === "video") {
        // ≤60s → Shorts; longer → Long. Source carries no duration here, so
        // we default to Shorts and note the rule.
        return {
          format: "Shorts 9:16, ≤60s (or Long 16:9 if your source >60s)",
          aspectRatioGuidance: "9:16 for Shorts; 16:9 horizontal for Long",
          durationCutSuggestion: "If source ≤60s use Shorts vertical. Else re-export 16:9 horizontal as Long.",
        };
      }
      return {
        format: "Community post (text + image)",
        aspectRatioGuidance: "Square 1:1 if image attached",
      };

    case "linkedin":
      if (sourceMediaType === "video") {
        return {
          format: "native video square 1:1, captions burned in",
          aspectRatioGuidance: "1:1 square — LinkedIn native player favors square",
          durationCutSuggestion: "Trim to ≤2:20 — LinkedIn drops off hard past 2 minutes.",
        };
      }
      return {
        format: "text post + thread (3-5 comments)",
        aspectRatioGuidance: "Plain text outperforms images for reach on LinkedIn — counterintuitive but persistent",
      };

    case "x":
      if (sourceMediaType === "text") {
        return {
          format: "thread of 3-5 tweets, first as standalone hook",
          aspectRatioGuidance: "n/a — text thread",
        };
      }
      return {
        format: "thread of 3-5 tweets with media in first post",
        aspectRatioGuidance: "16:9 horizontal or 1:1 square works on timeline preview",
        durationCutSuggestion: sourceMediaType === "video" ? "Trim to ≤2:20 — X autoplay drops off." : undefined,
      };
  }
}

/**
 * Best-effort one-tap publish URL. Returns `null` when no reliable scheme
 * exists for the platform/medium combination — caller must surface
 * `fallbackInstructionFor(...)` instead.
 *
 * IMPORTANT: these are HAND-OFF URLs. They open the platform's native app on
 * the creator's device with the prepared media; the creator still confirms
 * and posts. Maya never publishes.
 */
export function oneTapUrlFor(
  platform: Platform,
  mediaUrl: string,
  captionDraft: string
): string | null {
  const enc = encodeURIComponent;
  switch (platform) {
    case "tiktok":
      // iOS sharesheet handoff. Best-effort; TikTok occasionally rejects
      // remote-URL imports — the fallback covers it.
      return `tiktok://share?media=${enc(mediaUrl)}`;
    case "instagram":
      return `instagram://share?media=${enc(mediaUrl)}`;
    case "youtube":
      // Android-only and unreliable. Default to fallback by returning null
      // so the variant always carries the explicit instruction.
      return null;
    case "linkedin":
      // LinkedIn's deep-link scheme dropped media support; web composer URL
      // works for text/link posts only.
      if (captionDraft.length > 0) {
        return `https://www.linkedin.com/sharing/share-offsite/?url=${enc(mediaUrl)}`;
      }
      return null;
    case "x":
      // x:// scheme handles text-only intents. Media must be attached in-app.
      return `https://twitter.com/intent/tweet?text=${enc(captionDraft)}`;
  }
}

export function fallbackInstructionFor(platform: Platform): string {
  switch (platform) {
    case "tiktok":
      return "Open TikTok → tap +, import the prepared clip from your camera roll, paste the caption.";
    case "instagram":
      return "Open Instagram → tap +, choose Reel (or Post for carousel), import the prepared media, paste the caption.";
    case "youtube":
      return "Open YouTube Studio app → Upload → choose the prepared file, paste title and description.";
    case "linkedin":
      return "Open LinkedIn → Start a post, attach the prepared media, paste the post body.";
    case "x":
      return "Open X → New post, attach media (if any), paste the first tweet, then add the rest of the thread as replies.";
  }
}

/**
 * Recommend a posting order + spacing across platforms to avoid the
 * cross-post penalty (especially TikTok suppressing posts that look like
 * IG/YT cross-posts based on watermark + timing). Returns ordered platforms
 * with an offset hint in hours from the first publish.
 *
 * Rule of thumb: anchor first (the platform the source was made for), then
 * the visually-distinct platforms next (LinkedIn / X), then the
 * format-similar platforms last (IG Reel / YT Shorts) with a 12-24h gap so
 * the algorithms don't pick up the cross-post signature.
 */
export function recommendPostingOrder(
  anchorPlatform: Platform,
  targets: ReadonlyArray<Platform>
): Array<{ platform: Platform; offsetHours: number }> {
  const ordered: Array<{ platform: Platform; offsetHours: number }> = [];
  ordered.push({ platform: anchorPlatform, offsetHours: 0 });

  const distinctPriority: Platform[] = ["linkedin", "x"]; // visually distinct
  const similarPriority: Platform[] = ["tiktok", "instagram", "youtube"]; // format-similar

  let nextOffset = 2; // visually-distinct can ship soon after anchor
  for (const p of distinctPriority) {
    if (p !== anchorPlatform && targets.includes(p)) {
      ordered.push({ platform: p, offsetHours: nextOffset });
      nextOffset += 2;
    }
  }

  let similarOffset = Math.max(nextOffset, 12); // similar formats wait ≥12h
  for (const p of similarPriority) {
    if (p !== anchorPlatform && targets.includes(p)) {
      ordered.push({ platform: p, offsetHours: similarOffset });
      similarOffset += 12;
    }
  }
  return ordered;
}

/**
 * Per-platform hashtag recommendation count + style hint. The actual hashtag
 * list comes from the model call; this is the count guidance baked in.
 */
export function hashtagGuidanceFor(platform: Platform): {
  count: { min: number; max: number };
  style: string;
} {
  switch (platform) {
    case "tiktok":
      return { count: { min: 3, max: 5 }, style: "niche + 1 trending if it fits organically" };
    case "instagram":
      return { count: { min: 3, max: 5 }, style: "niche-only; hashtags are nearly dead on IG" };
    case "youtube":
      return { count: { min: 3, max: 8 }, style: "in description; first 3 weighted highest" };
    case "linkedin":
      return { count: { min: 3, max: 5 }, style: "professional-niche; #leadership / #marketing-style" };
    case "x":
      return { count: { min: 0, max: 2 }, style: "rarely useful; only when joining an active conversation" };
  }
}
