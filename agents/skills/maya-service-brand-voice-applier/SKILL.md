---
name: maya-service-brand-voice-applier
version: 0.1.0-sprint3
description: Apply business brand voice to any draft. Returns rewritten draft + diff from input.
when-to-use: Called by every other content-generating skill on outputs that go to the operator's audience (review reply, GBP post, customer SMS, customer email).
plan-tier: all.
model-routing: Gemini 3 Flash, LOW thinking.
---

# maya-service-brand-voice-applier

## Purpose

Maya drafts in *her* voice (calm office tone). Customer-facing drafts must be in the *operator's* voice. This skill is the rewriter that translates between them.

## Inputs

```ts
{
  draftText: string;
  brandVoice: string;                    // businessPicture.brandVoice
  brandVoiceSamples: Array<{ source: string; text: string }>;
  channelHints: { channel: "sms" | "email" | "gbp" | "fb" | "ig"; maxLength?: number };
}
```

## Outputs

```ts
{
  rewrittenText: string;
  diffFromInput: { added: string[]; removed: string[]; toneShift: string };
  voiceConfidence: number;               // 0..1
}
```

## Rules

- Mirror operator's signature phrases + sentence shapes.
- Respect channel max-length (SMS 320, GBP 1500, etc.).
- Never invent facts during rewrite — voice is style only, not substance.

## Test categories

- Tone consistency (output sentences echo `brandVoiceSamples` cadence).
- Citation preservation (numbers, names, IDs in input survive into output unchanged).
- Cross-tenant: Business A's brandVoice never bleeds into Business B's rewrite.

## Sibling files

Called by every drafter skill. No direct Convex writes — pure transform.
