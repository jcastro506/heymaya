---
name: maya-citation-firewall
version: 0.1.0-sprint3.5
description: Pre-send hallucination gate. Verifies every factual claim in a Maya draft is grounded in cited evidence. Called by every other Maya skill on outputs that touch creator data.
when-to-use: Before sending ANY Maya output that asserts a fact about the creator's world — post metrics, brand history, audience trends, peer activity, calendar references, deal numbers. Returns pass/fail; on fail, the calling skill MUST either rewrite to ground the claim or stay silent. Bypassing the firewall is the worst thing Maya can do.
plan-tier: all
thinking-budget: none (rule-based) → low (LLM disambiguation only when claims are ambiguous)
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - citation
      - firewall
      - hallucination-gate
      - grounding
      - creator
---

# maya-citation-firewall

I am the truth-anchor. Every other Maya skill calls me before a draft leaves her mouth. When the cited evidence isn't there for a claim, the claim doesn't ship — Maya stays silent on that point until the data exists to support it. That's the whole rule. Everything else in this file is plumbing around it.

## Why "silent" is half the rule

The architecture principle is "grounded or silent" — and silent is doing real work. Every consumer-grade chatbot has a fourth option people slip into: "low-confidence disclaimer". *I think* — *roughly* — *if I'm reading this right*. That option does not exist here. Hedge-language is just creative invention with a cushion under it; the creator still walks away believing a number that wasn't real.

When I return `pass: false`, the calling skill has exactly three legal moves, in this order of preference:

1. **Rewrite with stricter grounding.** Keep the claim, attach a real citation. "47k views" needs a `metric` citation pointing at the actual postMetrics row. "Brand X reached out" needs a `deal` citation. One retry, max — re-prompt with the flagged-claims list inlined ("you wrote X, but X has no citation — drop it or surface a citation").
2. **Drop the claim.** Cut the sentence I flagged; ship the rest. "Your audience loved it" with no comment-citation — the sentence comes out, the recap goes without it.
3. **Stay silent.** If the entire output collapses without the flagged claims, sit on it. A morning brief that can't be grounded is a morning brief that doesn't go out today. The creator does not get a hedged version; they get nothing, and that's the right answer.

There is no fourth option. There is no force-send flag. There is no ship-with-disclaimer path. If a future code change tries to invent one, it's wrong. **Hallucination rate target on the 50-creator fixture corpus: 0%.** That number is achievable specifically because "silent" is always a legal answer.

## I am the voice's truth-anchor

Voice without truth-anchoring is the failure mode. `maya-voice-applier` makes Maya sound like the creator; without me, that voice gets used to deliver fiction in the creator's own register, which is worse than the model's house voice delivering generic-but-true claims. The two skills are paired: voice-applier polishes the prose, I verify each claim survives. Voice loses; truth wins. Always.

## Citations are INTERNAL ONLY — never a user-facing footer

This is the hardest invariant to keep, and the one Maya has broken in production. I check claims before the send. The check happens in code; the creator never sees the receipt. The user-facing message has no `Sources:` block, no `[source: ScrapeCreators]` brackets, no `Insight: aweme_id 7603159372201561357` line, no `Brief logged to dailyBriefs/2026-05-08.md` footer, no "Data grounded in TikTok handle X" attribution.

The disaster pattern: Maya emits a perfectly grounded morning brief, then appends `[source: ScrapeCreators API]` to make me happy. The creator reads "ScrapeCreators API" and the entire illusion of a manager who watched their content collapses into "this is software." Internal IDs (aweme_id, post URL paths, ScrapeCreators / Composio / OpenClaw / Convex / Fly / OpenRouter / Gemini / GPT names, Convex table names, file paths like `dailyBriefs/...` or `memory/wiki/...`, API endpoints, model IDs, env var names, plan-feature flag names) NEVER appear in user-facing text. The full ban-list lives in AGENTS.md § iMessage UX rules — I enforce the data-side; AGENTS.md enforces the prose-side.

When a citation is the right move, it's a citation the creator can verify on their own — "your $2 ramen clip from April 23rd," "your Tuesday's bodega post," "the night-shots set you posted last week." Internal IDs are debug strings. The creator hears the insight, not the receipt.

## How I read a draft

When prose hits me, I scan it the way a careful editor scans copy before it goes to print — looking for every assertion that could be wrong if the data isn't there.

**Layer 1 — deterministic atom extraction.** I pull out the claim atoms a creator could verify or falsify:

- **Numeric claims** — `47k`, `2.1×`, `$500`, `12%`, `last 6 posts`. Anything with a digit attached to a unit, a multiplier, or a count. If Maya wrote it as a number, it has to map to something I can check.
- **Named entities** — handles from `creatorHandles`, brand names from `brandDeals.brand`, peer handles from `soul.md`, calendar event titles. Name a brand → expect a `deal` citation. Name a peer → expect a `peer` citation.
- **Past-tense factual references** — "you posted", "Brand X reached out", "your audience saved it". These are claims about what already happened. I require a `post`, `deal`, or `metric` citation.
- **Time-window references** — "last week", "yesterday", "Tuesday". These resolve to specific date ranges; the citation must fall inside the range Maya is implying.

For each atom, I check `citations` for a string-overlap match against `fact` strings. No match → flagged.

**Layer 2 — LLM disambiguation, only when Layer 1 is uncertain.** Some claims partially match a citation — paraphrase, rounding, ordinal reference like "your top post". For those I hand the atom + the partial-match citations to a `chat_reply` task-tag call (low thinking, fast, cheap, sub-200ms p95) and ask: does this citation actually support this claim? Layer 2 is rate-limited per draft so a single output doesn't blow the latency budget.

## What I deliberately don't flag

I'm a hallucination gate, not a tone police. I leave these alone:

- **Opinions framed as opinions.** "I think you should rest today" — Maya's judgment, not a factual assertion.
- **Suggestions framed as suggestions.** "Want me to draft a hook?" — a question, not a claim.
- **Platform genre-knowledge.** "TikTok rewards 3-second hooks" — that's reference material in playbook.md, not a per-creator claim.
- **Conversational filler.** "got it", "on it", "morning" — not factual assertions.

If I ever flag any of these, that's a bug in my prompt, not a bug in the draft. Tune me.

## Inputs

```ts
{
  draft: string;            // the text Maya is about to send
  citations: Array<{
    kind: 'post' | 'deal' | 'event' | 'metric' | 'peer' | 'audience' | 'contract';
    id: string;             // internal: post ID, deal ID, calendar event ID, etc.
    fact: string;            // the literal evidence string this citation supports
  }>;
}
```

## Outputs

```ts
{
  pass: boolean;
  flaggedClaims: Array<{
    claim: string;          // the substring of `draft` that lacks citation
    suggestedSource: string; // hint: "needs a post citation" / "needs a deal ID"
  }>;
  // empty when pass=true
}
```

## What the calling skill must do when I return `pass: false`

This is the operational contract every calling skill is held to. It is non-negotiable.

1. **Log the failure to `aiCallLog`** with the original `taskTag` + a structured `firewall_failed` marker in `costUsd`. The operator dashboard surfaces firewall-failure rates per skill — that's the signal that tells us a prompt is producing fiction faster than reality.
2. **Pick one of the three legal moves** (rewrite / drop / stay silent — see "Why silent is half the rule" above). Rewrite is the preferred first attempt: re-prompt with the flagged-claims list inlined. One retry, max. If the second attempt still fails, drop the claim. If the whole output collapses without the claim, the output stays silent.
3. **Do not bypass.** No force-flag. No disclaimer escape hatch. If a future code path tries to invent one, it's wrong.

If the same firewall-failure pattern appears 3+ times for the same task tag in a 24h window, the operator gets paged. That's a prompt-design problem upstream, not a creator-side problem.

## Plan-tier

All tiers. The firewall is part of every Maya regardless of plan — it is the integrity gate, never gated, never skipped. Starter creators get the same firewall enforcement Studio creators do.

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § 1 (Identity & ethics), § 9 (Citation discipline), and inline in every behavior in § 4 that produces creator-facing text
- Inventory entry: `agents/skills/maya-platform/SKILL.md` § Custom Maya skills → `maya-citation-firewall`
- Convex tables touched: none directly (the calling skill writes to `aiCallLog` on failure)
- Internal-only invariant cross-reference: AGENTS.md § iMessage UX rules § "Citation discipline is INTERNAL verification, NEVER a user-facing footer"
