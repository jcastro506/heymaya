---
name: maya-voice-applier
version: 0.1.0-sprint3.5
description: Applies the creator's voiceFingerprint (from soul.md) to any draft text Maya is about to send. Returns the tone-adjusted draft + a diff so the citation firewall can verify no facts were mutated. High-volume, latency-sensitive — runs at low thinking on the model router.
when-to-use: On every output more than two sentences of original prose (morning briefs, evening recaps, weekly reviews, brand-email drafts, chat replies, hook drafts, idea cards, on-demand packet narrative). Skip on structured output (tables/JSON/lists), <2-sentence outputs, the manager-readiness packet (stays neutral third-person), and never invoke twice on the same draft (idempotent but wastes latency).
plan-tier: ungated.
thinking-budget: low
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - voice
      - tone
      - voice-applier
      - draft-rewrite
      - creator
---

## Calls

- `maya-citation-firewall` — via the diff; the firewall verifies the voicing pass did not introduce or mutate factual claims


# maya-voice-applier

## Purpose

Maya holds one voice per creator. The voice lives in
`soul.md.voiceFingerprint` — a short structured description of the
creator's actual cadence, vocabulary, sentence shapes, em-dash habits,
emoji posture, signature phrases, and capitalization rules.

Without a voicing pass, every Maya output drifts toward the model's house
voice. Two days of that and the creator says "this doesn't sound like me"
and they're right. This skill is the consistency moat.

## Inputs

```ts
{
  draft: string;             // the text Maya is about to send
  soulVoiceFingerprint: string; // the voiceFingerprint section of soul.md
  toneSlider: "supportive" | "strategic" | "tough-love"; // from soul.md
}
```

## Outputs

```ts
{
  adjustedDraft: string;
  diff: VoiceDiff[];
  /** True if the input was already on-voice (no changes proposed). */
  unchanged: boolean;
  /** Hash of the input draft — used by idempotency check. */
  draftHash: string;
}

interface VoiceDiff {
  original: string;       // the original sentence/clause
  adjusted: string;       // the adjusted version
  reason: VoiceDiffReason;
}

type VoiceDiffReason =
  | "cadence"          // sentence length / pause structure
  | "vocab"            // word swap to match creator's lexicon
  | "emoji"            // emoji added / removed per creator's posture
  | "punctuation"      // em-dash, comma, semicolon habits
  | "capitalization"   // creator-specific casing rules (e.g., all-lowercase)
  | "signature-phrase" // adds a known signature phrase if natural
  | "tone-slider";     // tone modulation per creator's slider position
```

## Idempotency contract

This is load-bearing. The skill MUST be a no-op when applied twice.

Concretely:
- Compute `draftHash = fnv1a(draft + soulVoiceFingerprint + toneSlider)`.
- The skill includes a marker (an invisible-character-free hash comment is
  not used; instead, the runtime caches the most recent `draftHash` per
  creator session and short-circuits a second call with the same hash).
- If the runtime cache misses, the LLM is asked to make changes; the
  prompt instructs it to return `unchanged: true` if the draft already
  matches the fingerprint. The diff in that case is empty.

The test suite asserts: `apply(apply(draft)) === apply(draft)`.

## Fact preservation

The voicing pass MUST NOT change facts. The diff is structured so the
citation firewall can verify: every diff item has an `original` and an
`adjusted`; the firewall compares the two for any added or removed
numbers, brand names, post IDs, dates, calendar event titles, deal IDs.
If any fact differs between original and adjusted, the diff item is
rejected and the original sentence is restored.

This is why we return a structured diff instead of just an adjusted
string — the diff is the audit trail.

## Model routing

The skill calls the model router with task tag `chat_reply` (low thinking).
This is high-volume, latency-sensitive output. The voice fingerprint is
short (< 500 tokens), the draft is typically < 1000 tokens, so even at low
thinking the call lands in < 800ms p95.

If the orchestrating action wants a different task tag (e.g.
`morning_brief` so the voicing budget tracks with the parent task in
`aiCallLog`), it can override.

## Plan-tier gating

All tiers. Voice consistency is the consumer-app moat — you do not gate it.

## Examples

- `examples/brief-supportive.json` — voicing a morning brief with the
  supportive tone slider on a creator with em-dash + lowercase habits.
- `examples/brand-email-firm.json` — voicing a brand-email draft with the
  tough-love slider; no emoji, sentence trimming.
- `examples/chat-reply-strategic.json` — voicing a chat reply with the
  strategic slider on a creator with a signature sign-off.
- `examples/idempotent-no-op.json` — input is already on-voice; skill
  returns `unchanged: true`, empty diff.
