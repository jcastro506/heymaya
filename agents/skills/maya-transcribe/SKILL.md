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

The creator opens iMessage, hits the voice-memo button, says "Maya I'm thinking I post the gym hook on Tuesday at 3 — also push the brand-deal call to next week," and hits send. The creator does not want to retype that. Maya transcribes it, hands the text to her own intent layer, and either acts (with confirmation) or surfaces what she heard so the creator can correct.

Same path runs when a video about to be published needs subtitles for the caption-overlay edit.

## Inputs

```ts
{
  // Path or URL to the audio. iMessage attachments arrive as local file paths;
  // web uploads arrive as R2 URLs. Either works.
  source: string;
  // Format hint. The faster-whisper skill auto-detects but the hint helps it
  // skip a probe step on slow networks.
  formatHint?: "m4a" | "mp3" | "wav" | "mp4" | "mov" | null;
  // Approximate duration in seconds, if the caller knows it (iMessage exposes
  // this; URL fetches don't). Drives model-size selection.
  durationSec?: number | null;
  // Optional language hint ("en" / "es" / etc). Skips the language-detection
  // step in faster-whisper when known. iMessage typically gives us this from
  // the creator's locale.
  languageHint?: string | null;
  // Whether voice-activity-detection should run. Default true. Disable for
  // very short clips (<5s) where VAD overhead exceeds savings.
  vadFilter?: boolean | null;
}
```

## Outputs

```ts
{
  text: string;                 // cleaned, single-paragraph transcript
  srt: string;                  // SubRip-format subtitles
  vtt: string;                  // WebVTT-format subtitles
  wordTimestamps: Array<{ word: string; startMs: number; endMs: number }>;
  // When the parser cannot extract any of the above, fields are empty
  // strings / empty arrays — never fabricated.
}
```

## Triggers

- Creator says something like "Maya, transcribe this" with an audio/video attachment in any messenger channel.
- A voice memo arrives with no caption — Maya transcribes silently and uses the text as the implicit message.
- The caption-overlay edit path (`maya-content-cross-poster` cousin in Sprint 5) auto-invokes for subtitles before pushing a video to TikTok / IG Reels / YouTube Shorts.

## Delegates to

`theplasmak/faster-whisper@1.5.1` — pinned in `convex/creatorMayaV0/pinnedClawhubSkills.ts` per Sprint 2 Slice D. That ClawHub skill ships the actual whisper.cpp + faster-whisper Python runtime; this Maya wrapper composes the invocation args, parses the output defensively, and post-processes for the messenger surface.

## Model-size heuristic

Faster-whisper exposes `tiny / base / small / medium / large-v3` model variants. We pick by duration:

| Duration             | Model        | Why                                                                 |
| -------------------- | ------------ | ------------------------------------------------------------------- |
| ≤ 120 s (≤ 2 min)    | `small`      | Voice memos. Speed > peak accuracy. Loads fast on shared Fly.       |
| 120–600 s (2–10 min) | `medium`     | Long-form thoughts. Accuracy starts to matter on rambling memos.    |
| > 600 s (> 10 min)   | `large-v3`   | Full-length video. Worth the compute; subtitles get archived.       |
| unknown duration     | `medium`     | Safe middle ground. Caller should pass `durationSec` when possible. |

This is the only mechanical gate in the skill. Everything else (cleanup, intent) defers to Maya's own judgment.

## Output shape from faster-whisper

The ClawHub skill returns JSON. The expected shape:

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

## Intent extraction

`extractIntent(text)` is best-effort pattern matching against a small library of common creator intents:

- `schedule_post` — "post X on tuesday at 3pm"
- `reschedule` — "push the X to next week"
- `cancel` — "cancel that"
- `note` — "remind me to..."
- `unknown` — anything else

Returns `{ intent, confidence }`. **Confidence < 0.5 → caller must NOT act.** The contract is explicit because acting on a misheard voice memo (e.g., transcribing "post" as "ghost") is one of the worst-feeling product failures we can ship. When confidence is low, Maya surfaces the text plus "I heard that as: '<text>' — want me to do something with this?" and waits.

The intent layer is intentionally thin. Real intent resolution lives in Maya's main reasoning loop on the OpenClaw side. This is a fast pre-filter for the obvious cases.

## formatForCreator

Two output framings:

- `intent: "show-text"` — just the cleaned paragraph. Used when the creator asked "what did I say." No prefix, no framing.
- `intent: "use-as-input"` — prepends `(I transcribed your voice memo: "<text>")` so the downstream reasoning step has provenance. Maya's own reply later does NOT include this framing line — it's metadata for the reasoning loop, not user-facing copy.

## Anti-sycophancy + voice rules

- The banned-term list in `script.ts` (BANNED_PATTERNS) covers the standard machine-framing phrases the broader product forbids. The cleanup pass strips them defensively if faster-whisper somehow surfaces them in segment text (it won't on real audio, but the parser test verifies the strip works).
- Maya never frames the transcription as a robot operation. She says "I transcribed your voice memo," not "I used a model to transcribe."
- Anti-sycophancy: when transcription quality is poor (low confidence, lots of `[inaudible]`), Maya tells the creator "I missed parts of this — re-send or type it." She does not pretend to have heard a clean transcript.

## Failure handling

- Empty audio file → `parseFasterWhisperOutput` returns `{ text: "", srt: "", vtt: "", wordTimestamps: [] }`. Caller surfaces "no audio detected, can you re-record?"
- Malformed faster-whisper output (network truncation, plugin crash) → defensive zod parse fails, returns empty result. Caller falls back to "transcription failed, can you retry?"
- Wrong format (e.g., a JPEG sent as `.mp3`) → caller catches the upstream error before invoking this skill; this skill never runs.

## Examples

- `examples/short-voice-memo.json` — 12-second iMessage voice memo, "small" model, intent `schedule_post`.
- `examples/long-video-subtitles.json` — 14-minute YouTube long-form, "large-v3" model, no intent extraction (caption-overlay path skips it).
- `examples/garbage-output.json` — malformed faster-whisper response, parser returns empty result.

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § Voice memo handling, § Caption-overlay edit
- Inventory entry: `agents/skills/maya-platform/skill.md` § Custom Maya skills → `maya-transcribe`
- Pinned ClawHub dependency: `theplasmak/faster-whisper@1.5.1` in `convex/creatorMayaV0/pinnedClawhubSkills.ts`
- Convex tables touched (write): none directly — calling action persists transcripts to `messages` / `mediaAssets` if needed.
