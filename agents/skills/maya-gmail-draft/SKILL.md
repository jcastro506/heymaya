---
name: maya-gmail-draft
version: 0.1.0-sprint7-slice-a
description: Pure-logic draft helpers for the brand-deal triager. Builds 4 reply prompts (soft-accept / hold-for-info / decline-politely / ask-for-deck), validates a generated draft against voice + length + auto-send hint rules, and gates the runtime so MVP can never auto-send a reply.
when-to-use: Called by maya-brand-deal-triager after classification. Inputs are the fetched thread (via maya-gmail-read), the creator's voice fingerprint, and the requested reply tone. Outputs are 4 prompts that the Convex action layer feeds to the model, and a validator the action runs over each generated draft before it is persisted into Gmail as a draft (NEVER as a sent message).
plan-tier: pro+ (Starter has no Gmail in allowedProviders; manual deal entry only)
thinking-budget: medium (the model spend lives in the Convex action that consumes these prompts, NOT in this script)
metadata:
  openclaw:
    emoji: "📝"
    tags:
      - email
      - gmail
      - draft
      - creator
---

# maya-gmail-draft

## Hard rule (MVP)

**This skill never sends email. It only produces drafts.** The runtime
guard at the bottom of `script.ts` throws if the calling action passes
`intent: "send"`. The Convex action that consumes this skill calls
`createDraft` / `updateDraft` from
`convex/integrations/composio/actions/gmail.ts` — it does NOT call
`sendEmail` from this code path. The creator approves a draft over
iMessage; they then send it manually from Gmail.

This is a product-level guarantee, not a soft preference. If a future
slice wants to auto-send, that requires (a) an explicit operator
opt-in, (b) a separate skill, and (c) a per-creator threshold capture
flow — none of which exist in MVP.

## Purpose

`maya-brand-deal-triager` already returns 4 reply variants today, but
the variant prompts are baked into the triager's hot path. Sprint 7
factors them out so:

- the prompts are unit-testable in isolation
- the validator (length, banned phrases, auto-send hints) lives next
  to the prompt builder it constrains
- the brand-deal triager can reuse the same draft scaffolds for the
  chat-side "draft me a reply" flow without round-tripping through the
  full triage skill

## Inputs

```ts
buildDraftPrompt({
  thread: GmailThread;         // matches maya-gmail-read's GmailThread
  picture: CreatorPicture;     // niche + voiceFingerprint + tonePreference
  replyTone: "soft-accept" | "hold-for-info" | "decline-politely" | "ask-for-deck";
}): string                     // single prompt, ready for the model layer

buildAllFourVariants(args): Promise<{
  "soft-accept": string;
  "hold-for-info": string;
  "decline-politely": string;
  "ask-for-deck": string;
}>                             // convenience wrapper, calls buildDraftPrompt 4× in parallel

validateDraft(draft: string, picture: CreatorPicture): {
  ok: boolean;
  reasons?: string[];
}

runtimeGuard(intent: "draft" | "send"): void
```

`GmailThread` matches the shape from `maya-gmail-read` (re-exported
here). `CreatorPicture` carries `niche`, `voiceFingerprint`, an
optional `tonePreference` (`supportive` / `strategic` / `tough-love`),
an optional banned-terms list, and an optional `firstContact` flag —
when true, the prompt enforces a tighter ≤120-word body for first
contact.

## Outputs

`buildDraftPrompt` returns a single prompt string. The prompt is
explicit about:

- **Anti-sycophancy** — no "loved your content!" filler. The reply
  earns the relationship; it does not flatter.
- **Cite voice anchors** — the prompt asks the model to thread the
  creator's `voiceFingerprint` quote anchors into the draft so the
  validator's voice-match heuristic can detect a tone match.
- **First-contact length cap** — when `picture.firstContact` is true,
  the body must stay under 120 words (validator enforces).
- **No auto-send hints** — phrases like "I'll send this now" or
  "sending this on your behalf" are explicitly banned in the prompt
  AND tripped by the validator.

`buildAllFourVariants` is a convenience wrapper that calls
`buildDraftPrompt` 4× in parallel (they are independent — the parallel
`Promise.all` here is a wrapper for symmetry with the runtime callsite,
not because building a string is async).

`validateDraft` returns `{ ok, reasons }`. The validator runs four
checks:

1. **No banned voice terms** — the validator pulls a small set of
   banned phrases (`"I think you're amazing"`, `"reach out anytime"`,
   `"I love this opportunity"`, etc.) and any per-creator entries from
   `picture.bannedPhrases`.
2. **Voice anchor match** — the draft must contain at least one
   substring that overlaps with the `voiceFingerprint` (token overlap
   ≥1 multi-character word). This is the soft "cite the voice"
   heuristic — if the draft has zero overlap with the creator's
   recorded voice, it likely lost the voice in the model pass.
3. **First-contact length cap** — when `picture.firstContact` is true,
   the body must be ≤120 words (whitespace-tokenized).
4. **No auto-send hint phrases** — `"I'll send this now"`,
   `"sent on your behalf"`, `"sending this for you"`,
   `"let me send this"`. These are tripped because they would mislead
   the creator into thinking Maya already sent something — Maya
   never does.

`runtimeGuard("send")` throws an `Error` with the message
`"maya-gmail-draft: MVP does not auto-send. Pass intent='draft' instead."`.
The Convex action that wraps this skill calls `runtimeGuard("draft")`
at the top of its handler — the throw is the safety net for a future
slice that forgets the rule.

## Triggers

- Called by `maya-brand-deal-triager` after classification — the four
  prompts replace the inline variant-drafter prompts in the triager's
  current code path
- Called by the chat-side "draft me a reply" flow — the creator
  forwards a thread; the action picks one tone (or the default
  `hold-for-info`) and threads it through `buildDraftPrompt` →
  Gemini → `validateDraft` → `createDraft` (Gmail)

## Voice-anchor citation

The prompt instructs the model to thread voice anchors from
`voiceFingerprint`. The validator's overlap heuristic is the
mechanical backstop — if the model strips the voice, the validator
catches it and the action re-prompts with stricter instructions before
persisting any draft.

## Plan-tier (server-side, fail-closed)

The upstream gate is:

```ts
requireFeature(creator, (f) => f.gmailDealDeskEnabled, "gmail-draft", "pro");
```

Starter creators have no Gmail in their `allowedProviders`, so there
is no inbound to draft a reply to in the first place. This skill
should never be invoked for a Starter creator — and if it is (e.g. by
a misrouted call), the upstream gate throws `PlanGateError` before
this skill runs.

## What this skill does NOT do

- Does NOT call `sendEmail`. Ever. The runtime guard enforces this.
- Does NOT call any Gmail action directly. The Convex action wraps
  `createDraft` / `updateDraft` from
  `convex/integrations/composio/actions/gmail.ts`; this script just
  composes the prompts and the validator the action consumes.
- Does NOT make the model call. The prompts are returned to the
  action; the action runs the model under the `brand_email_draft`
  task tag (medium thinking).
- Does NOT classify a thread. That's `maya-brand-deal-triager`'s
  job. This skill assumes classification has already happened and the
  caller is asking for a specific tone.

## Sibling files

- Consumed by: `maya-brand-deal-triager/script.ts` (replaces the
  inline `variantDrafter.draftVariants` prompt path in Sprint 7
  Slice B refactor)
- Pairs with: `maya-gmail-read` (the read half of the email surface)
- Inventory entry: `agents/skills/maya-platform/skill.md`
- Convex tables touched (write): `brandDeals.replyVariants` — written
  by the Convex action after the validator passes
