---
name: maya-thumbnail-maker
version: 0.1.0-sprint7c
description: Turns a creator-supplied photo into a platform-ready thumbnail with overlay text. Maya parses the creator's overlay intent (text, color hint, weight, placement), composes the right invocation for the pinned ClawHub photo-text-overlay skill, and returns the rendered thumbnail. Maya orchestrates; the delegated skill does the rendering.
when-to-use: When the creator sends a photo attachment in iMessage / WhatsApp / web chat with thumbnail-shape prose like "make a thumbnail for this", "add big text saying X", "throw an overlay on this for the YouTube cover", or "punchy hook on top". Skip on photos sent with caption-writing intent (those route to `maya-caption-generator`). Skip on synthesized-from-scratch thumbnail asks (those defer to v0.5 — for v0 we only overlay on creator-supplied photos).
plan-tier: ungated; per-tier credit budget enforced server-side by the wrapping Convex action.
thinking-budget: medium
metadata:
  openclaw:
    tags: ["image", "thumbnail", "creator"]
    delegates_to:
      - psyduckler/instagram-photo-text-overlay@1.0.0
---

## Calls

- delegates to `psyduckler/instagram-photo-text-overlay@1.0.0` — the rendering engine. Maya does not re-implement image composition.
- consults `maya-citation-firewall` only on accompanying narrative copy ("here's the thumbnail with the hook on top — used your usual sans-serif"), never on the rendered media itself.

## Delegates to

- `psyduckler/instagram-photo-text-overlay@1.0.0` for the actual overlay render

## Why this skill exists

Thumbnails are mechanical. A photo plus a few words burned on top in the right color, weight, and position. Creators waste hours in Canva or Figma every week to ship the daily YouTube cover, the Reel cover frame, the carousel slide-zero. None of that craft requires Maya's judgement layer — it requires a renderer pointed at the right preset.

This skill is the parser + invocation composer that turns "throw a punchy hook on top of this" into a rendered PNG with the creator's voice-aware overlay text and a platform-appropriate canvas size.

For v0 we only overlay on creator-supplied photos. Fully synthesized thumbnails (Gemini multimodal generation) defer to v0.5 — the value-prop test is the overlay loop first.

## Trigger

The skill activates when:

1. The incoming message includes an image attachment, AND
2. The creator's prose carries a thumbnail / overlay intent. The intent parser recognises:
   - `thumbnail` — "make a thumbnail", "thumbnail for this", "cover for the video"
   - `text-overlay` — "add text saying X", "throw 'X' on top", "big text overlay"
   - `caption-overlay` — "burned-in caption", "hardcoded subtitle"

Bare photo uploads with no overlay intent do not trigger this skill.

## Inputs

```ts
{
  imageUrl: string;             // R2 / Convex storage / external CDN
  attachment: {
    width?: number;             // pixel width if probed
    height?: number;             // pixel height if probed
    contentType?: string;        // "image/png" | "image/jpeg" | "image/heic"
  };
  creatorPrompt: string;        // raw NL from the creator's message
  creatorPicture: CreatorPicture; // for niche-aware defaults + boundaries
  targetPlatform?: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
}
```

## Outputs

```ts
{
  outputUrl: string;            // rendered thumbnail
  format: 'png' | 'jpg';
  dimensions: { w: number; h: number };
  appliedIntent: ThumbnailIntent;
  appliedParams: ThumbnailParams;
}
```

## Validation guard (pre-render)

Before dispatching to the delegate, the skill applies two guards:

1. **Overlay text length** — capped at 10 words. Thumbnails fail when they read like sentences. Anything longer is reflected back to the creator: "that's a sentence, not a hook — give me 10 words max and I'll render it."
2. **Banned-topic check** — overlay text is screened against the creator's `creatorPicture.boundaries.banned_topics` list. The creator declared these topics off-limits during onboarding; Maya respects them in every output, including thumbnail overlays.

Both guards are mechanical contracts, hardcoded. They are not a quality judgement — they're scope boundaries the operator and creator agreed to upstream.

## Intent confidence threshold

The intent parser returns a `confidence` score in `[0, 1]`. Below 0.5 the orchestrating action treats the prompt as ambiguous and asks one clarifying question instead of guessing. Above 0.5 Maya proceeds. The threshold is hardcoded — same contract as `maya-clip-editor`, deliberately consistent so the action layer doesn't have a per-skill threshold matrix to track.

## Plan-tier gating (server-side, fail-closed)

Enforced by the Convex action wrapping this skill, not by the skill itself:

- Starter — capped at N delegated thumbnails per billing cycle (operator-set; default low).
- Pro — higher cap.
- Studio — highest cap; priority queue on delegate rate-limit.

The skill module exports a pure `validateOverlayBeforeRender(input, picture)` for the pre-render guards. Plan-tier checks live in the wrapping action.

## What this skill is NOT

- **Not auto-publish.** The creator posts.
- Not a thumbnail generator from scratch. v0 only overlays on creator-supplied photos.
- Not a typography lab. We pick the delegate's preset; we do not expose every font choice to the creator.
- Not a video editor. `maya-clip-editor` is the sibling skill for video.

## Sibling-file references

- `agents/skills/maya-platform/playbook.md` § "Post-publish reaction" notes that an inbound photo with thumbnail intent routes here.
- `agents/skills/maya-platform/skill.md` lists this skill under § "Delegated edit skills".
- `agents/skills/maya-clip-editor/SKILL.md` is the sibling skill for video; both share the 0.5 confidence threshold contract.
- `agents/skills/maya-caption-generator/SKILL.md` is the downstream caption companion when the creator wants accompanying body copy for the post.
