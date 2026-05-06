---
name: maya-caption-generator
version: 0.1.0-sprint7c
description: Per-platform caption writer. Voice-applied, citation-firewalled, length-capped per the platform's published contract. Emits one caption per requested platform with hashtags and character count, ready for the creator to one-tap publish. Maya orchestrates; voice fidelity is delegated to `maya-voice-applier`.
when-to-use: When the creator says "write a caption for this", "draft me an IG caption", "give me 3 platform captions", or when the action layer auto-invokes after a delegated `maya-clip-editor` render so the creator gets the rendered clip + a ready caption in the same reply. Skip when the creator is asking for analysis ("how did this do") or planning ("when should I post") — those route to other skills.
plan-tier: ungated; bounded by the creator's connected-platform list (Starter 1, Pro 3, Studio 5) — enforced server-side by the wrapping action.
thinking-budget: medium
metadata:
  openclaw:
    tags: ["copy", "caption", "voice", "creator"]
---

## Calls

- `maya-voice-applier` — mandatory. Every caption variant runs through the voice applier so the IG caption sounds like the creator on IG, the X thread sounds like the creator on X, both recognisably the same person.
- `maya-citation-firewall` — mandatory if the caption references creator data (audience numbers, post IDs, brand history). Pure-creative captions skip the firewall by design.

## Why this skill exists

A caption is the second-most-skipped piece of the publishing loop, right after the thumbnail. Creators ship the visual and then stare at the empty caption box for 20 minutes. Worse, they cross-paste the same caption everywhere and watch the algorithms suppress it.

This skill does the per-platform tuning mechanically — TT punchy and spoken, LI conversational and longer, IG mid-length and emoji-positive, YT keyword-front-loaded for search, X tight and hooky — while applying the creator's voice fingerprint so every variant still reads as them, not as the model's house voice.

Anti-sycophancy is non-negotiable. Captions ground in cited evidence when they reference numbers; otherwise they keep their hands off facts. Maya doesn't promise virality, doesn't fabricate audience reactions, doesn't manufacture a celebrity tag.

## Trigger

The skill activates when:

1. The creator's message asks for caption copy ("write a caption", "give me an IG caption", "what's a good X thread for this"), OR
2. The action layer auto-invokes after a delegated `maya-clip-editor` render so the creator receives the rendered clip + a ready caption in one reply.

## Inputs

```ts
{
  topic: string;                 // what the post is about
  picture: CreatorPicture;       // for voice fingerprint + niche
  platforms: ReadonlyArray<'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x'>;
  targetLength?: 'short' | 'medium' | 'long';
  citations?: ReadonlyArray<{ kind: string; id: string; fact: string }>;
  // Optional. Pass when the caption references creator data so the firewall
  // can verify the citation chain.
}
```

## Outputs

```ts
[
  {
    platform: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
    text: string;            // voice-applied
    hashtags: string[];      // platform-appropriate count and style
    characterCount: number;  // including hashtag block
  }
]
```

## Per-platform contract (mechanical, hardcoded)

These are the platforms' published constraints. They are not a tuning surface
— they're contracts the platform enforces, so we honour them server-side
before the caption ever reaches the creator's clipboard.

| Platform   | Max characters | Max hashtags | Voice tuning                                      |
|------------|----------------|--------------|---------------------------------------------------|
| TikTok     | 2200           | 30           | Punchy, spoken, hook in line one                  |
| Instagram  | 2200           | 30           | Mid-length, emoji-positive, story arc OK          |
| YouTube    | 5000           | 15           | Keyword-front-loaded for search, longer body OK   |
| LinkedIn   | 3000           | 5            | Conversational, no aggressive hashtag stuffing    |
| X          | 280            | 5            | Tight, hooky, one image of the thread             |

The contract lives in `script.ts` as `validateCaptionForPlatform(caption, platform)`.

## Voice application

Every caption runs through `maya-voice-applier` with the creator's
voiceFingerprint. The voicing pass:

- Preserves facts (numbers, brand names, post IDs) — the diff is structured
  so the citation firewall can verify
- Adjusts cadence, vocabulary, emoji posture, capitalisation, signature phrases
- Skips entirely when `targetLength === 'short'` produces a ≤ 2-sentence
  output (the voice-applier is no-op below that threshold)

When `maya-voice-applier` is unavailable (test environments, model offline),
the script's `composeWithVoiceApplier` helper passes the input unchanged. The
caller decides whether to surface the unvoiced caption or block.

## Anti-sycophancy

The caption MUST cite at least one anchor from `picture.voiceFingerprint`
when the caption is more than two sentences and the creator has a non-empty
voice fingerprint. Anchoring is enforced by the prompt template — the model
is asked to thread one signature pattern (em-dash habit, lowercase, signature
sign-off, emoji posture) into every variant. We do not score the result in
code — we provide the scaffold and trust the model.

## Plan-tier gating (server-side, fail-closed)

Enforced by the Convex action wrapping this skill, not by the skill itself:

- Starter — captions for 1 platform max (the creator's only connected handle).
- Pro — captions for up to 3 platforms.
- Studio — captions for up to 5 platforms.

The action intersects the requested `platforms` with the creator's
`creatorHandles` rows before calling this skill. The skill never reads from
Convex directly.

## What this skill is NOT

- **Not auto-publish.** The creator posts.
- Not a hashtag research tool. We pick from the creator's recent
  high-performing tag set + niche-relevant tags surfaced by the upstream
  picture; we don't crawl trending tags live.
- Not a hook generator. `maya-hook-extractor` is the upstream skill that
  produces the hook line; this skill weaves it into the body.
- Not a translator. Single-language captions in v0 (creator-language inferred
  from soul.md). Multi-language variant deferred.

## Sibling-file references

- `agents/skills/maya-platform/playbook.md` § "Cross-post" calls this skill
  per requested platform.
- `agents/skills/maya-platform/skill.md` lists this skill under § "Delegated
  edit skills".
- `agents/skills/maya-clip-editor/SKILL.md` is the upstream sibling that
  triggers an auto-invoke for caption companion copy on a rendered clip.
- `agents/skills/maya-voice-applier/SKILL.md` is the mandatory downstream
  voicing pass.
