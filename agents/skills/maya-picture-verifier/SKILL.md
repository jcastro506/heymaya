---
name: maya-picture-verifier
version: 0.1.0-sprint5
description: Confirmation conversation that runs after multimodal creator-picture synthesis. Surfaces every low-confidence inference as a cited yes/no question to the creator, parses their free-text reply, and applies confirmed (or corrected) values back to the picture draft before it locks in. Composes with `maya-citation-firewall` so every question carries the evidence Maya is asking about.
when-to-use: Called by the onboarding pipeline after `creatorPicture` synthesis lands, for every entry on `creatorPicture.needsVerification[]`. Maya MUST hold the draft in pending state until the verifier round-trip resolves each item — picture is not "locked" until every flagged inference is confirmed, corrected, or explicitly skipped by the creator. Also invoked on-demand when the creator says something that contradicts a picture field already locked in (e.g. "I moved to Brooklyn last month" → re-open the location verification flow).
plan-tier: all
thinking-budget: low (rule-based parsing) → medium (LLM fallback when free-text is irreducibly ambiguous, gated through the calling skill)
metadata:
  openclaw:
    emoji: "✅"
    requires:
      env: []
    tags:
      - onboarding
      - creator-picture
      - verification
      - citation-firewall
      - anti-hallucination
---

# maya-picture-verifier

The confirmation gate between Maya's synthesized creator picture and the picture going live. Sprint 5.

## Why this exists

The Sprint 4 multimodal synthesizer is high-thinking but it still infers. Some inferences are confident (the creator's last 30 TikToks are clearly cooking-niche). Some are borderline (the handle says NYC but six recent posts reference the London Tube — are they in London now?). Borderline inferences land on `creatorPicture.needsVerification[]` and Maya MUST surface them before the picture is treated as ground truth — otherwise every downstream skill (rate calculator, peer competitor watcher, brand outreach) inherits the uncertainty silently.

This skill owns that conversation. It is the iMessage-shaped "I noticed X — true?" loop, with the cited evidence inline. Every question Maya sends through this skill carries the post / metric / audience signal that triggered the inference, so the creator is never asked to confirm something out of thin air.

## Inputs

```ts
{
  // The verification item Maya is asking about right now.
  item: {
    field: string;                 // dotted path into creatorPicture, e.g. "audience.topGeos[0]" or "niche"
    inferredValue: unknown;        // what synthesis guessed (string | number | array)
    confidence: number;            // 0..1 — synthesis self-rated; this skill does NOT use it as a threshold (see note below)
    citations: Array<{
      kind: "post" | "comment" | "audience" | "bio" | "handle" | "metric";
      id: string;
      excerpt: string;             // short literal evidence, e.g. "London Tube delays again"
      platform: string;            // "tiktok" | "instagram" | etc.
    }>;
  };
  // The picture being verified (used for context — Maya phrases the question relative to what else she knows).
  picture: CreatorPicture;
  // The creator's free-text reply, if Maya is parsing a response.
  rawReply?: string;
}
```

## Outputs

Three pure functions, one in each phase of the loop:

1. `buildVerificationQuestion(item, picture) → string` — produces the iMessage-shaped question.
2. `parseVerificationAnswer(rawReply, item) → ParsedAnswer` — parses creator's free-text reply.
3. `applyAnswerToDraft(draft, item, answer) → CreatorPicture` — writes confirmed/corrected values onto the picture.

A fourth function — `citationFirewall(question, item)` — guards step 1: a verification question without cited evidence is rejected before it ever reaches the messenger. This composes with `maya-citation-firewall` for the broader hallucination check; the local firewall here is a stricter rule (questions MUST contain a literal excerpt from `item.citations`) because the verifier is the only pipeline where Maya is allowed to surface uncertain claims at all.

## Question shape — voice rules

The question is iMessage-terse, anti-sycophancy, never framed in self-referential / assistant-y / bot-y language:

- No greetings, no flattery openers, no "I'd love to confirm…" softeners.
- No description of Maya as a manager / coach / assistant. She just asks.
- Always cites at least one literal excerpt from `item.citations`. If there is no citation, the firewall rejects.
- Always frames as a question, never as a statement of fact. ("Are you in London?" not "You're in London.")
- One question per send. Do not batch multiple verification items into one message.

Example output:

> Recent tiktok posts reference "Tube delays again", "Northern line dead" — are you based in London? (your handle/bio still says NYC)

Note: the lead-in deliberately avoids numeric counts ("your last 3...") because every numeric in a creator-facing draft has to clear `maya-citation-firewall`, and "we attached 3 citations" is not itself a citation. Keeping the lead-in count-free is the cheapest way to stay grounded.

## Answer parsing — what the parser handles

`parseVerificationAnswer` returns:

```ts
{
  confirmed: boolean;        // true = creator agrees with the inferred value
  correctedValue?: unknown;  // present when creator denies AND supplies a replacement
  ambiguous: boolean;        // true = parser cannot tell — calling skill should re-prompt or escalate to LLM
}
```

Patterns the parser handles deterministically:

- Plain affirmative — "yes", "yeah", "yep", "confirmed", "yes!!", "yes 😍".
- Plain denial — "no", "nope", "not really", "wrong".
- Denial + correction — "no, I'm in Brooklyn" → `confirmed: false, correctedValue: "Brooklyn"`.
- Hedged affirmative — "I guess", "kinda", "sort of", "maybe" → `ambiguous: true`. Parser does NOT decide for the creator.
- Reluctant affirmative — "ugh fine", "if you say so" → `ambiguous: true`. Same reason — Maya re-asks plain.
- Empty / whitespace / pure punctuation — `ambiguous: true`.

The parser intentionally does not threshold-classify free text. When the reply is irreducibly ambiguous, the calling skill is responsible for either a plain re-ask ("yes or no?") or an LLM disambiguation round-trip at low thinking. This skill scaffolds; it does not invent confidence numbers.

## How `applyAnswerToDraft` mutates the picture

- `confirmed: true` — write `item.inferredValue` to `item.field` and append `{ field, source: "verifier-confirmed", at: Date.now() }` to a verification audit log on the draft. The picture row's `sourceCitations` is also extended with each `item.citations[]` entry that backed the inference (so downstream skills see the verifier's evidence chain).
- `confirmed: false, correctedValue: X` — write `X` to `item.field`. Append `{ field, source: "verifier-corrected", before: inferredValue, after: X, at: Date.now() }`.
- `ambiguous: true` — leave the draft unchanged. The verifier item stays in `needsVerification[]` and the calling skill MUST re-ask.

Mutation is purely on the draft object passed in (no Convex calls). The pipeline writes the resulting draft to Convex when every verification item is resolved.

## Citation-firewall composition

The local `citationFirewall(question, item)` enforces ONE rule: the question must contain a literal excerpt from `item.citations[*].excerpt`. This is a stricter pre-send check than the broader `maya-citation-firewall` runs on creator-facing drafts. The two compose as follows:

1. `buildVerificationQuestion` produces a draft question.
2. Local `citationFirewall` rejects if no excerpt is present (means Maya is making an unsupported assertion).
3. The orchestrator then calls the broader `maya-citation-firewall.runFirewall` on the final question + the same citations, exactly as every other Maya output is gated. The verifier's citations are passed through as the `citations` array.

The verifier never bypasses the broader firewall. Verification questions are still creator-facing claims and still subject to the "grounded or silent" rule.

## Plan-tier

All tiers. Verification is part of every onboarding regardless of plan — picture quality is non-negotiable. Starter creators get the same verifier flow Studio creators do.

## Sibling files

- Composes with: `agents/skills/maya-citation-firewall/SKILL.md` (broader firewall, called after this skill's local firewall passes)
- Triggered from: `convex/onboarding/pipeline.ts` (post-synthesis step) and the calling skill on contradiction-driven re-verifications
- Convex tables touched: writes return through to `creatorPicture` (via the calling pipeline mutation, not directly from this skill)
- Inventory entry pending in `agents/skills/maya-platform/skill.md` once Sprint 5 lands the broader plumbing

## Testing notes

The bundled tests cover the five mandatory categories:

- **Cross-tenant isolation** — verification items from creator A never bleed into questions generated for creator B.
- **Adversarial inputs** — heavy-emoji affirmatives, hedged affirmatives, reluctant affirmatives, prompt-injection attempts inside replies, empty / whitespace replies.
- **Citation-firewall positive** — a question without a cited excerpt is rejected.
- **Citation-firewall negative** — a question with cited excerpts passes.
- **Apply** — confirmed answers write the inferred value; corrected answers replace it; ambiguous answers leave the draft untouched.
- **Sibling-file scan** — frontmatter exposes `metadata.openclaw`; the test file references the real `creatorPicture` field shape from `convex/schema.ts`.
