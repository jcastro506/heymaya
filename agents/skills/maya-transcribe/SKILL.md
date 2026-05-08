---
name: maya-transcribe
version: 0.1.0-sprint5
description: Voice memos and video audio in, clean text + timed captions out. Wraps the pinned faster-whisper ClawHub skill so Maya can read what a creator said over iMessage instead of what they typed.
when-to-use: Fired when (1) the creator sends an audio attachment over iMessage / WhatsApp / SMS / web with text like "transcribe this" / "what did I say" / a bare voice memo with no caption, or (2) the caption-overlay edit path needs subtitles for a video the creator is about to post. The first 3-second hook read in `maya-hook-extractor` does NOT route through here — that path stays on the Gemini multimodal frame-watch.
plan-tier: All tiers. Voice memo length cap differs (Starter ≤2min per memo / Pro ≤10min / Studio unlimited). Cap enforced server-side in the calling Convex action via `planFeatures(creator)` — this skill's pure logic does not gate.
thinking-budget: low (transcription / caption_subtitle task tags). The cleanup pass is mechanical; intent extraction is best-effort and the caller must NOT act unless confidence ≥ 0.5.
metadata:
  openclaw:
    delegates-to: theplasmak/faster-whisper@1.5.1
    tags: ["transcription", "audio", "voice", "creator"]
---

# maya-transcribe

## What I do when a voice memo lands

The creator's mid-walk, hits the iMessage voice-memo button, says "Maya I'm thinking I post the gym hook on Tuesday at 3 — also push the brand-deal call to next week," and sends. They don't want to retype that. They want me to hear it, log it, and confirm or act.

That's me. I run the audio through faster-whisper, return clean text, do a quick best-effort intent read, and hand back something the main reasoning loop can act on. Same path runs when a video about to publish needs burned-in subtitles.

## What I'm careful about — misheard voice memos are catastrophic

Acting on a misheard voice memo is one of the worst-feeling product failures I can ship. "Post the X on Tuesday" transcribed as "ghost the X on Tuesday" and Maya unsubscribes the wrong account is the disaster shape. So:

- Below 0.5 intent confidence, the caller MUST NOT act. The contract is explicit. Maya surfaces what she heard plus "I heard that as: '[text]' — want me to do something with this?" and waits for the creator to confirm.
- On low-quality audio (lots of `[inaudible]`, partial transcript), I tell the creator "I missed parts of this — re-send or type it." I do not pretend to have heard a clean transcript.
- I never frame transcription as a robot operation in user-facing text — "I transcribed your voice memo" not "I ran your audio through a model." That's a voice rule, not a tech rule.

## Inputs

```ts
{
  source: string;             // iMessage local path or R2 URL — either works
  formatHint?: "m4a" | "mp3" | "wav" | "mp4" | "mov" | null;
  durationSec?: number | null;
  languageHint?: string | null;
  vadFilter?: boolean | null; // default true; disable for <5s clips
}
```

## Outputs

```ts
{
  text: string;                 // cleaned, single-paragraph transcript
  srt: string;                  // SubRip subtitles
  vtt: string;                  // WebVTT subtitles
  wordTimestamps: Array<{ word: string; startMs: number; endMs: number }>;
  // When the parser cannot extract any of the above, fields are empty
  // strings / empty arrays — never fabricated.
}
```

## Triggers

- Creator says "Maya, transcribe this" with an audio/video attachment in any messenger channel.
- A voice memo arrives with no caption — I transcribe silently and the text becomes the implicit message.
- The caption-overlay edit path auto-invokes for subtitles before pushing a video to TikTok / IG Reels / YouTube Shorts.

## Delegates to

`theplasmak/faster-whisper@1.5.1` — pinned in `convex/creatorMayaV0/pinnedClawhubSkills.ts`. That ClawHub skill ships the actual whisper.cpp + faster-whisper Python runtime; this Maya wrapper composes the invocation args, parses the output defensively, and post-processes for the messenger surface.

## Model-size heuristic

The only mechanical gate in the skill. Pick by duration:

| Duration             | Model        | Why                                                                 |
| -------------------- | ------------ | ------------------------------------------------------------------- |
| ≤ 120 s (≤ 2 min)    | `small`      | Voice memos. Speed > peak accuracy. Loads fast on shared Fly.       |
| 120–600 s (2–10 min) | `medium`     | Long-form thoughts. Accuracy starts to matter on rambling memos.    |
| > 600 s (> 10 min)   | `large-v3`   | Full-length video. Worth the compute; subtitles get archived.       |
| unknown duration     | `medium`     | Safe middle. Pass `durationSec` when possible.                      |

Everything else (cleanup, intent) defers to Maya's own judgment in the main reasoning loop.

## Output shape from faster-whisper

The ClawHub skill returns JSON:

```json
{
  "text": "...",
  "language": "en",
  "segments": [
    { "id": 0, "start": 0.0, "end": 2.4, "text": "...", "words": [{ "word": "...", "start": 0.0, "end": 0.4 }] }
  ]
}
```

`script.ts`'s `parseFasterWhisperOutput` accepts this shape, an empty result, OR garbage. On garbage it returns the empty result rather than throwing — the caller surfaces "I couldn't transcribe that, can you re-send?" instead of crashing the messenger session.

## Intent extraction (best-effort)

`extractIntent(text)` is pattern-matching for common creator intents:

- `schedule_post` — "post X on tuesday at 3pm"
- `reschedule` — "push the X to next week"
- `cancel` — "cancel that"
- `note` — "remind me to..."
- `unknown` — anything else

Returns `{ intent, confidence }`. **Confidence < 0.5 → caller must NOT act.** Intent layer is intentionally thin. Real intent resolution lives in Maya's main reasoning loop on the OpenClaw side; this is a fast pre-filter for the obvious cases.

## formatForCreator

Two output framings:

- `intent: "show-text"` — just the cleaned paragraph. Used when the creator asked "what did I say." No prefix, no framing.
- `intent: "use-as-input"` — prepends `(I transcribed your voice memo: "<text>")` so the downstream reasoning step has provenance. Maya's own reply later does NOT include this framing line — it's metadata for the reasoning loop, not user-facing copy.

## Anti-sycophancy + voice rules

The banned-term list in `script.ts` (BANNED_PATTERNS) covers the standard machine-framing phrases the broader product forbids. The cleanup pass strips them defensively if faster-whisper somehow surfaces them in segment text.

## Failure handling

- Empty audio file → `parseFasterWhisperOutput` returns the empty result. Caller surfaces "no audio detected, can you re-record?"
- Malformed faster-whisper output (network truncation, plugin crash) → defensive zod parse fails, returns empty result. Caller falls back to "transcription failed, can you retry?"
- Wrong format (e.g., a JPEG sent as `.mp3`) → caller catches the upstream error before invoking this skill; this skill never runs.

## Examples

- `examples/short-voice-memo.json` — 12s iMessage voice memo, "small" model, intent `schedule_post`.
- `examples/long-video-subtitles.json` — 14-min YouTube long-form, "large-v3" model, no intent extraction (caption-overlay path skips it).
- `examples/garbage-output.json` — malformed response, parser returns empty result.

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § Voice memo handling, § Caption-overlay edit
- Inventory entry: `agents/skills/maya-platform/SKILL.md` § Custom Maya skills → `maya-transcribe`
- Pinned ClawHub dependency: `theplasmak/faster-whisper@1.5.1` in `convex/creatorMayaV0/pinnedClawhubSkills.ts`
- Convex tables touched (write): none directly — calling action persists transcripts to `messages` / `mediaAssets` if needed.
