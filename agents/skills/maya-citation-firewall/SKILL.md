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

The integrity gate. Maya's "grounded or silent" architecture principle (CLAUDE.md § 3) is enforced here, mechanically, on every output that makes claims about creator data.

## Why this exists

Every other Maya skill calls this one before returning. If this skill says `pass: false`, the calling skill MUST handle it — either by rewriting the draft with stricter grounding, by removing the unsupported claim, or by refusing to send and logging the firewall failure to `aiCallLog`. There is no "force send anyway" path. This is intentional.

Hallucination rate target on the 50-creator fixture corpus: **0%**. This skill is how we hit that.

## Inputs

```ts
{
  draft: string;            // the text Maya is about to send
  citations: Array<{
    kind: 'post' | 'deal' | 'event' | 'metric' | 'peer' | 'audience' | 'contract';
    id: string;             // post ID, deal ID, calendar event ID, etc.
    fact: string;           // the literal evidence string this citation supports
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

## How it works

Two layers:

1. **Layer 1 — rule-based claim extraction (no LLM, deterministic).** Scans the draft for "claim atoms" using a fixed pattern set:
   - Numeric claims (`/\b\d[\d,.kKmM]*\b/` matches like `47k`, `2.1×`, `$500`, `12%`)
   - Named entities matching `creatorHandles`, `brandDeals.brand`, peer handles from `soul.md`, calendar event titles
   - Past-tense factual references ("you posted", "Brand X reached out", "your audience")
   - Comparative references to time windows ("last week", "yesterday", "Tuesday")

   For each atom, check if the claim is supported by at least one entry in the `citations` array (string-overlap match between claim atom and `citation.fact`).

2. **Layer 2 — LLM disambiguation (low thinking, only when Layer 1 is ambiguous).** When a claim atom partially matches a citation but the relationship is ambiguous (paraphrasing, rounding, ordinal references), call Maya with the `chat_reply` task tag (low thinking, fast, cheap) to confirm the citation actually supports the claim. Layer 2 is rate-limited per output to keep latency under 200ms.

Things this skill explicitly does NOT flag:
- Opinions clearly framed as opinions ("I think you should rest today")
- Suggestions framed as suggestions ("want me to draft a hook?")
- Genre-knowledge from playbook.md § 3 (platform expertise is reference, not creator-specific)
- Conversational filler ("good morning", "got it", "on it")

## Plan-tier

All tiers. The firewall is part of every Maya regardless of plan — it is the integrity gate, never gated, never skipped. Starter creators get the same firewall enforcement Studio creators do.

## Failure handling (calling code MUST implement)

When this skill returns `pass: false`:

1. The calling skill MUST log the failure to `aiCallLog` with the `taskTag` of the original draft + a structured `firewall_failed` marker in `costUsd` (so the operator dashboard can surface the rate of firewall failures per skill).
2. The calling skill MUST either:
   - Re-prompt the upstream LLM call with stricter grounding instructions and the `flaggedClaims` list ("you wrote X, but X has no citation — either drop it or surface a citation"), OR
   - Refuse to send the output. If the entire output collapses without the flagged claims, refuse the whole output.
3. The calling skill MUST NOT bypass and send anyway. There is no force-flag.

If the same firewall failure pattern appears 3+ times for the same task tag in a 24h window, the operator should be paged — that's a prompt-design problem, not a creator-side problem.

## Examples

See `examples/` for three realistic input/output pairs:
- `examples/morning-brief-pass.json` — clean morning brief, all claims cited, pass=true
- `examples/uncited-metric-fail.json` — a brief invents a percentage; pass=false
- `examples/opinion-not-flagged.json` — opinions framed as opinions are not flagged

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § 1 (Identity & ethics), § 9 (Citation discipline), and inline in every behavior in § 4 that produces creator-facing text
- Inventory entry: `agents/skills/maya-platform/skill.md` § Custom Maya skills → `maya-citation-firewall`
- Convex tables touched: none directly (the calling skill writes to `aiCallLog` on failure)
