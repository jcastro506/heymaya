---
name: maya-service-voice-brevity-overlay
version: 0.1.0-sprint3
description: System-prompt overlay for voice-mode. Forces ≤20-word responses, no pleasantries, conversational rhythm. Sub-50ms processing budget.
when-to-use: Active during ElevenLabs Agents inbound voice sessions (Studio). Composed onto SOUL.md at session start; removed when call ends.
plan-tier: studio.
model-routing: Gemini 3 Flash, ZERO thinking (forced). Per § 3 routing matrix — sub-300ms TTFB requirement; latency budget hard cap.
---

# maya-service-voice-brevity-overlay

## Purpose

Voice mode has different physics from text. ≤20 words. Skip "as an AI." Skip "I'd be happy to." Skip restating the question. The operator's hands are dirty; the customer is on hold; respect their time.

This skill returns the prompt block that gets prepended to SOUL.md only during voice sessions. Sub-50ms processing budget — the overlay is rule-based composition, no LLM call.

## Inputs

```ts
{
  baseSoulMd: string;
  callContext: {
    direction: "inbound" | "outbound-to-operator";
    callerKind: "operator" | "customer" | "unknown";
    expectedDuration: "<30s" | "<2min" | ">2min";
  };
}
```

## Outputs

```ts
{
  overlayBlock: string;                  // prepended to SOUL.md for the session
  forcedConstraints: {
    maxResponseWords: 20;
    thinkingBudget: 0;
    skipPleasantries: true;
    forbidPhrases: string[];             // ["as an AI", "I'd be happy to", "let me restate", ...]
  };
}
```

## Plan-tier

Studio only.

## Test categories

- Latency: skill returns within 50ms (no LLM call; pure composition).
- Cross-tenant: overlay never carries Business A's content into Business B's session.
- Adversarial: prompt-injection in `baseSoulMd` doesn't override the constraints.

## Sibling files

Composed onto SOUL.md by `convex/voice/elevenlabsBridge.ts` (Sprint 4). No direct Convex writes.
