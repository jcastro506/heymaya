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

- `vcarolxhberger/free-video-generator-capcut@1.0.0` — the rendering engine. I do not re-implement video editing.
- `theplasmak/faster-whisper@1.5.1` — when the parsed intent is `captions` or `captioned-trim` and the capcut output didn't include a captions track.
- `maya-citation-firewall` — only on the narrative copy I send back ("here's your trimmed clip — kept the 0:08 hook because…"), never on the rendered media.

# maya-clip-editor

## Why this exists

The creator films, the manager packages. When they drop raw footage in the iMessage thread with "trim this to 30 seconds and slap captions on it," they expect the clip back ready to one-tap publish — not a list of suggestions and a homework assignment.

That packaging work is mechanical: trim to a duration, burn captions, change tempo, loop a section, recrop the aspect ratio. None of it is intelligence I should reinvent. The pinned ClawHub capcut skill renders. My job is to read the creator's prose, route it to the right preset, and return the result.

I never publish. The creator posts. Always.

## When I run

The skill activates when both hold:

1. The incoming message includes a video attachment (R2 URL, Convex storage, or platform CDN).
2. The creator's prose carries a clear edit intent.

Skip if:
- The video has no edit intent attached — that's a hook-extractor / pre-post-scorer flow, not me.
- The clip is already edited and they just want it cross-posted — route to `maya-content-cross-poster`.
- The video is > 10 minutes — see runtime guard below.

## What I do, step by step

1. **Parse the intent.** Five named intents — that's the whole grammar:
   - `trim` — "trim this", "cut this down", "make it 30 seconds", "shorter"
   - `captions` — "add captions", "subtitle this", "burn captions"
   - `speed` — "speed this up", "slow this down", "1.5x", "double-speed"
   - `loop` — "loop the chorus", "boomerang it", "make it repeat"
   - `crop` — "crop to vertical", "make it 9:16", "square it for IG"

2. **Score the parse.** The parser returns `confidence ∈ [0, 1]`. Below 0.5, the prose is ambiguous and I do NOT guess — the wrapping action asks one clarifying question instead. Above 0.5 I proceed. The threshold is a hardcoded contract between the parser and the action; same value as `maya-thumbnail-maker` so the action layer doesn't carry a per-skill matrix.

3. **Run the runtime guard.** If `durationMs > 10 * 60 * 1000`, I refuse mechanically and reply in plain language: "this clip is 14 minutes — drop me a rough trim window and I'll cut from there." Long-form rendering is a different pipeline (deferred to v0.5). Operator-locked, not a tuning surface.

4. **Honor upstream hook marks if they're present.** If `hookExtractorMarks` is set, the strongest 1.5s window is already flagged. On a `trim` intent, the preset preserves that window — I never trim through the hook. On TikTok, the rule sharpens: if the trimmed clip's first 1.5 seconds doesn't open on a face or visible motion, I cut a different opening. First-1.5 is the entire post on TikTok; opening on a static frame is a 0.4x post.

5. **Compose the capcut invocation.** Map intent + params + `targetPlatform` to the capcut preset. Vertical 9:16 for TikTok / IG Reels / YT Shorts; 16:9 for YouTube long-form; square 1:1 only when explicitly asked. Bias duration caps to platform contract (TikTok ≤ 60s for the safe distribution lane, ≤ 90s for the longer lane; IG Reels ≤ 90s; X ≤ 140s).

6. **Delegate. Wait for the rendered URL.**

7. **If captions intent and capcut didn't include a captions track**, call `theplasmak/faster-whisper@1.5.1` with the rendered clip and burn or sidecar the captions per the platform (TikTok prefers burned-in for autoplay-muted; YouTube prefers sidecar VTT for accessibility).

8. **Return** `{ outputUrl, durationMs, format: 'mp4', captionsUrl?, appliedIntent, appliedParams }`. The narrative copy I send alongside ("kept the bodega-cat reaction at 0:08, that was your strongest beat") goes through `maya-voice-applier` and `maya-citation-firewall` like any other prose.

## Honest uncertainty

If the parser hits 0.4 confidence — "do something with this video" — I do NOT pick a default and render. I ask one specific question: "trim, captions, or speed up? give me one and I'll cut." Asking is cheaper than rendering wrong and re-rendering.

If the source video is corrupted, mis-typed, or not a video at all, I surface plainly: "couldn't open this — can you re-send?" I do not retry silently and I do not pretend a render failed mid-pipeline.

If capcut rate-limits or returns 5xx, I say so honestly — "the renderer's having a moment, I'll try once more in a minute" — and retry once with backoff. After that, I surface the failure and stop. No fake-busy.

## Runtime guard (hardcoded)

- Source duration ≤ 10 minutes. Beyond that, refuse with the plain-language ask above.
- Output duration honors the platform contract by default; the creator can override via prose ("make it 45 seconds even though that's long for TikTok").

## Plan-tier gating (server-side, fail-closed)

Enforced by the wrapping Convex action, not by me:

- Starter — capped at N delegated edits per billing cycle; default low.
- Pro — higher cap; captioned trims included.
- Studio — highest cap; priority queue when capcut is rate-limited.

The skill module exports a pure `runtimeGuard(input)` for the duration check. Plan-tier checks live in the wrapping action so they read and write `aiCallLog` directly.

## What I am NOT

- Not a publisher. Never auto-post.
- Not a video editor. Capcut renders; I route.
- Not a hook extractor. `maya-hook-extractor` runs upstream and produces the marks I consume.
- Not for long-form. The 10-minute guard exists exactly to keep this in its short-form lane.
- Not a transcription service. Whisper transcribes; I orchestrate.

## Sibling hand-offs

- `maya-hook-extractor` (upstream) — produces `hookExtractorMarks` that I honor on trim intents.
- `maya-caption-generator` (downstream) — auto-invoked by the wrapping action after I render, so the creator gets clip + caption in one reply.
- `maya-content-cross-poster` (downstream) — when the creator wants the rendered clip variant-split across platforms.
- `maya-voice-applier` + `maya-citation-firewall` — applied to my narrative copy, not to the rendered media.

## Inputs / outputs (contract)

```ts
input: {
  videoUrl: string;
  durationMs: number;
  creatorPrompt: string;
  creatorPicture: CreatorPicture;
  targetPlatform?: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
  hookExtractorMarks?: ReadonlyArray<{ atMs: number; reason: string }>;
}

output: {
  outputUrl: string;
  durationMs: number;
  format: 'mp4';
  captionsUrl?: string;
  appliedIntent: 'trim' | 'captions' | 'speed' | 'loop' | 'crop' | 'captioned-trim';
  appliedParams: Record<string, unknown>;
}
```
