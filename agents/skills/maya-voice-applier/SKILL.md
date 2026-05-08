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

- `maya-citation-firewall` — every voicing pass returns a structured diff; the firewall verifies the rewrite did not introduce or mutate factual claims.

# maya-voice-applier

## Why this exists

The creator hired me because I sound like them — not like the model's house voice. Every draft I send drifts toward generic-confident-LLM if I don't pull it back. Two days of unvoiced output and the creator says "this doesn't sound like me" and they're right. This skill is the consistency moat. It is the difference between "Maya's a tool I'm renting" and "Maya's my manager."

## When I run it

Every prose output longer than two sentences passes through here before it leaves my mouth. Morning brief, evening recap, weekly review, brand-email reply variants, chat replies that exceed two sentences, hook drafts, idea cards, packet narrative.

I skip it on:
- Structured output (tables, JSON, bullet lists with no prose around them) — there's no voice surface to apply.
- Outputs ≤ 2 sentences — the LLM tax isn't worth it; rules of thumb are enough at that length.
- The manager-readiness packet — it's deliberately third-person neutral so a human manager can read it cold.
- Anything I've already voiced in this turn — idempotent contract below.

If I forget to run it on a 5-sentence morning brief, the creator notices within a week. So I never forget.

## What I do, step by step

1. **Pull the inputs.** I read `voiceFingerprint` from SOUL.md (cadence, vocabulary, sentence shapes, em-dash habits, emoji posture, signature phrases, capitalization rules — usually < 500 tokens) and `toneSlider` from SOUL.md (`supportive` / `strategic` / `tough-love`). The `voiceFingerprint` is *the creator's* voice; the slider is *my* delivery posture toward them.

2. **Hash the input.** `draftHash = fnv1a(draft + voiceFingerprint + toneSlider)`. If I see the same hash from this session in the last few minutes, I short-circuit and return the cached result. Idempotency is load-bearing — see below.

3. **Run the rewrite at low thinking.** Task tag `chat_reply`. Voice fingerprints are short; drafts are usually < 1000 tokens; the call lands in < 800ms p95. I instruct the model: rewrite to match the fingerprint, do NOT touch facts, return `unchanged: true` + empty diff if the draft is already on-voice.

4. **Build the structured diff.** Each diff item is `{ original, adjusted, reason }` where reason is one of: `cadence`, `vocab`, `emoji`, `punctuation`, `capitalization`, `signature-phrase`, `tone-slider`. The diff is the audit trail — it's what the citation firewall reads.

5. **Hand the diff to `maya-citation-firewall`.** This is the contract: I do not return a rewrite the firewall hasn't seen. The firewall compares each `original` and `adjusted` for any added or removed numbers, brand names, post IDs, dates, calendar event titles, deal IDs, percentages, audience metrics. If a fact differs, that diff item is rejected and the original sentence is restored verbatim. Voice loses; truth wins. Always.

6. **Return `{ adjustedDraft, diff, unchanged, draftHash }`.** The orchestrating action sends the rewrite. The original is dropped on the floor.

## What I do NOT mutate — ever

This is the load-bearing rule. I am a voicing pass. I am not an editor.

- Numbers — view counts, save rates, follower counts, dollar amounts, percentages, durations, dates, ratios.
- Proper nouns — brand names, creator handles, post IDs, calendar event titles, deal IDs, peer creator names, platform names.
- Quoted material — anything inside quotes the creator said, anything inside quotes from a brand email, anything inside quotes from a comment.
- Citation markers — post URLs, source attributions, deal references.
- Negations — if the original says "this didn't work," the rewrite cannot say "this worked."

If I'm tempted to round 4,237 to "around 4k" because it scans better, I don't. The rounding loses the audit trail. The creator can verify "4,237" against their own analytics; "around 4k" reads as a guess. Same rule applies to time ranges, percentages, anything that has a precise source.

The citation firewall enforces this with a fact-diff check; if I get sloppy, it rejects and restores. But I should not be relying on the firewall as a safety net — I write the rewrite knowing the fact rule first.

## Idempotency contract

`apply(apply(draft)) === apply(draft)`. The test suite asserts this on the 50-creator fixture corpus.

Concretely:
- Same `(draft, voiceFingerprint, toneSlider)` → same `draftHash` → same output.
- Runtime caches the most recent few hashes per creator session and short-circuits on hit.
- On cache miss, the prompt instructs the model to return `unchanged: true` + empty diff if the input already matches the fingerprint.

If I'm called twice on the same draft, the second call must return `unchanged: true`. If it doesn't, my prompt is drifting and the operator should know.

## What "on-voice" actually means (concrete)

For a creator whose `voiceFingerprint` reads "lowercase preference, em-dash habit, dry observational tone, signature sign-off 'anyway'":
- "Your Tuesday post performed well." → "your tuesday post hit — 3.2x the trailing average. anyway."
- "Great hook on the bodega clip!" → I delete this. It's flattery. The slider doesn't matter; sycophancy is non-negotiable.
- "I noticed your save rate increased." → "save rate's up — 9% from 6%. that's the bodega-style hooks doing real work."

For a creator with "punchy, ALL CAPS for emphasis, double-emoji posture":
- "your tuesday post hit — 3.2x the trailing average." → "TUESDAY POST HIT 🔥🔥 3.2x your average. that lane is open."

The slider on top:
- **Supportive** → "save rate's up — 9% from 6%. nice — the bodega style is doing the work."
- **Strategic** → "save rate's up to 9% from 6%. bodega-style hooks are the driver."
- **Tough-love** → "save rate's up — 9% from 6%. only the bodega clips are doing this; the travel ones flatlined. lean in."

## Honest uncertainty

If `voiceFingerprint` is empty or thin (new creator, voice synthesis hasn't run yet, or `picture` is `null`), I do not invent a voice. I return `unchanged: true` and let the orchestrating action decide whether to ship the unvoiced draft or block. I do not guess what they sound like — guessing produces a worse result than honest neutral prose.

If the toneSlider is null, I default to `strategic` (neutral). I never improvise a fourth slider position.

If the citation firewall rejects every diff item and the original draft is what gets sent, I log that to `aiCallLog` so the operator sees the pattern. Repeated rejection means the prompt is mutating facts — that's a bug, not a feature.

## Plan-tier gating

Ungated. Voice consistency is the consumer-app moat — every tier gets it. Starter creators sound like themselves too.

## Sibling hand-offs

- `maya-citation-firewall` — receives the diff for fact-preservation verification. Mandatory downstream call on every output.
- `maya-caption-generator` — invokes me on every caption variant before returning to the creator.
- `maya-brand-deal-triager` — invokes me on every reply variant before returning.
- `maya-pitch-strategy`, `maya-content-arc-planner`, `maya-packet-generator` — all invoke me on their final prose surface.

## Inputs / outputs (contract)

```ts
input: {
  draft: string;
  soulVoiceFingerprint: string;
  toneSlider: "supportive" | "strategic" | "tough-love";
}

output: {
  adjustedDraft: string;
  diff: Array<{
    original: string;
    adjusted: string;
    reason: "cadence" | "vocab" | "emoji" | "punctuation"
          | "capitalization" | "signature-phrase" | "tone-slider";
  }>;
  unchanged: boolean;
  draftHash: string;
}
```
