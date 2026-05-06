---
name: maya-clip-editor
version: 0.1.0-sprint7c
description: Turns a creator-supplied raw video into a platform-ready clip via a delegated edit pipeline. Maya parses the creator's natural-language edit intent (trim / captions / speed / loop / crop), composes the right invocation for the pinned ClawHub video tooling, and returns the rendered clip URL plus optional captions track. Maya orchestrates; the delegated skill does the heavy lift.
when-to-use: When the creator sends a video attachment in iMessage / WhatsApp / web chat with edit-shape prose like "trim this to 30 seconds", "add captions to this", "speed this up 1.5x", "loop the second half", or "crop this to vertical for TikTok". Skip on raw uploads with no edit intent (those flow into the hook-extractor / pre-post-scorer pipeline instead). Skip on already-edited clips the creator only wants captioned for cross-post (route those through `maya-content-cross-poster`).
plan-tier: ungated; per-tier credit budget enforced server-side by the wrapping Convex action.
thinking-budget: medium
metadata:
  openclaw:
    tags: ["video", "edit", "clip", "creator"]
    delegates_to:
      - vcarolxhberger/free-video-generator-capcut@1.0.0
    optionally_uses:
      - theplasmak/faster-whisper@1.5.1
---

## Calls

- delegates to `vcarolxhberger/free-video-generator-capcut@1.0.0` — the rendering engine. Maya does not re-implement video editing.
- optionally calls `theplasmak/faster-whisper@1.5.1` when the parsed intent is `captions` or `captioned-trim` and the delegated capcut output does not include a captions track.
- consults `maya-citation-firewall` only on accompanying narrative copy ("here's your trimmed clip — kept the 0:08 hook because…"), never on the rendered media.

## Delegates to

- `vcarolxhberger/free-video-generator-capcut@1.0.0` for the actual cut / overlay / re-encode pass

## Why this skill exists

The creator films, the manager packages. A creator dropping raw footage into the iMessage thread expects Maya to come back with the clip already cut, captioned, and ready for one-tap publish — not a list of suggestions and a homework assignment.

That packaging work is mechanical: trim to a duration, burn captions, change tempo, loop a section, recrop the aspect ratio. None of it is intelligence Maya should reinvent. The pinned ClawHub capcut skill renders. Maya's job is to read the creator's prose, route it to the right capcut preset, and return the result.

Maya never publishes. Per `CLAUDE.md § What this product is NOT`, the creator posts. This skill renders the asset; the creator pushes the button.

## Trigger

The skill activates when:

1. The incoming message includes a video attachment (raw R2 URL or platform CDN), AND
2. The creator's prose carries an edit intent. The intent parser recognises:
   - `trim` — "trim this", "cut this down", "make it 30 seconds", "shorter"
   - `captions` — "add captions", "subtitle this", "burn captions"
   - `speed` — "speed this up", "slow this down", "1.5x", "double-speed"
   - `loop` — "loop the chorus", "boomerang it", "make it repeat"
   - `crop` — "crop to vertical", "make it 9:16", "square it for IG"

If neither (1) nor (2) holds, the skill is not the right entry point and the orchestrating action falls back to chat clarification.

## Inputs

```ts
{
  videoUrl: string;             // R2 / Convex storage / external CDN
  durationMs: number;           // probed by the runtime before the skill is called
  creatorPrompt: string;        // raw NL from the creator's message
  creatorPicture: CreatorPicture; // for voice-aware caption generation
  targetPlatform?: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
  // Optional. When set, the format preset (aspect ratio, duration cap)
  // is biased toward the platform's published constraints.
  hookExtractorMarks?: ReadonlyArray<{ atMs: number; reason: string }>;
  // Optional. When the source clip ran through `maya-hook-extractor` first,
  // the marks are forwarded so the trim preset preserves the strongest hook.
}
```

## Outputs

```ts
{
  outputUrl: string;            // rendered clip
  durationMs: number;           // post-edit duration
  format: 'mp4';                // capcut output is always mp4 in v0
  captionsUrl?: string;         // present when intent involved captions
  appliedIntent: EditIntent;    // for telemetry + creator-facing receipt
  appliedParams: EditParams;    // for the same
}
```

## Runtime guard

The skill enforces a hard limit: source video duration ≤ 10 minutes. Beyond that the capcut delegate eats credits without producing a more usable result for short-form. When the guard trips, Maya replies with a plain-language ask: "this clip is 14 minutes — drop me a rough trim window and I'll cut from there." This is mechanical, hardcoded, and operator-locked: long-form rendering belongs in a different pipeline (deferred to v0.5).

## Intent confidence threshold

The intent parser returns a `confidence` score in `[0, 1]`. Below 0.5 the orchestrating action treats the prompt as ambiguous and asks one clarifying question instead of guessing. Above 0.5 Maya proceeds. The threshold is hardcoded — it's a contract between the parser and the action, not a tuning surface.

## Plan-tier gating (server-side, fail-closed)

Enforced by the Convex action wrapping this skill, not by the skill itself:

- Starter — capped at N delegated edits per billing cycle (operator-set; default low).
- Pro — higher cap; captioned trims included.
- Studio — highest cap; priority queue when the capcut delegate is rate-limited.

The skill module exports a pure `runtimeGuard(input)` for the duration check. Plan-tier checks live in the wrapping action so they read and write the `aiCallLog` table directly.

## What this skill is NOT

- **Not auto-publish.** Never. The creator posts.
- Not a video editor. We delegate to capcut. The skill is a router + parser + parser, not a renderer.
- Not a hook extractor. `maya-hook-extractor` is the upstream skill that flags the strongest 1.5s window; this skill consumes those marks.
- Not for long-form. The 10-minute runtime guard exists precisely to keep this skill in its short-form lane.
- Not a transcription service. We delegate transcription to `theplasmak/faster-whisper@1.5.1` when captions are needed.

## Sibling-file references

- `agents/skills/maya-platform/playbook.md` § "Post-publish reaction" notes that an inbound video with edit intent routes here before it reaches hook-extractor.
- `agents/skills/maya-platform/skill.md` lists this skill under § "Delegated edit skills".
- `agents/skills/maya-hook-extractor/SKILL.md` is the upstream producer of `hookExtractorMarks` consumed here.
- `agents/skills/maya-content-cross-poster/SKILL.md` is the downstream consumer when the creator wants the rendered clip variant-split across platforms.
