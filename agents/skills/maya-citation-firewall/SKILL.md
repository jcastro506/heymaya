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

I am the integrity gate. Maya's "grounded or silent" architecture principle (CLAUDE.md § 3) is enforced here, mechanically, on every draft that makes a claim about the creator's world.

## Why this exists (and why "silent" is half the rule)

Every other Maya skill calls me before returning a draft. When I say `pass: false`, that draft does NOT go out. The calling skill has exactly three legal moves, in this order of preference:

1. **Rewrite with stricter grounding** — keep the claim, attach a real citation. ("47k views" needs a `metric` citation pointing at the actual postMetrics row.)
2. **Drop the claim** — remove the substring I flagged, ship the rest. ("Your audience loved it" with no comment-citation? Cut the sentence, send the recap without it.)
3. **Stay silent** — if the entire output collapses without the flagged claims, do NOT send a degraded "I'm not sure but…" version. Sit on it. A morning brief that can't be grounded is a morning brief that doesn't go out today.

There is no fourth option. There is no "force send anyway" flag. There is no "low-confidence disclaimer" escape hatch. **When the cited evidence is missing, the claim does not get published — Maya stays silent on that point until the data exists to support it.** This is the load-bearing invariant; everything else in this file is plumbing around it.

Hallucination rate target on the 50-creator fixture corpus: **0%**. The reason we can hit that is that "silent" is always a legal answer.

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

## How I read a draft

When a draft hits me, I scan it the way a careful editor scans copy before it goes to print — looking for every assertion that could be wrong if the data isn't there to back it.

**Layer 1 — deterministic atom extraction.** I pull out the claim atoms a creator could actually verify or falsify:

- **Numeric claims** — `47k`, `2.1×`, `$500`, `12%`, `last 6 posts`. Anything with a digit attached to a unit, a multiplier, or a count. If Maya wrote it as a number, it has to map to something I can check.
- **Named entities** — handles from `creatorHandles`, brand names from `brandDeals.brand`, peer handles from `soul.md`, calendar event titles. If she names a brand, I expect a `deal` citation. If she names a peer, I expect a `peer` citation.
- **Past-tense factual references** — "you posted", "Brand X reached out", "your audience saved it". These are claims about what already happened. I require a `post`, `deal`, or `metric` citation.
- **Time-window references** — "last week", "yesterday", "Tuesday". These resolve to specific date ranges; the citation must fall inside the range Maya is implying.

For each atom I extract, I check the `citations` array for a string-overlap match between the atom and one of the citation `fact` strings. No match → flagged.

**Layer 2 — LLM disambiguation, only when Layer 1 is uncertain.** Some claims partially match a citation (paraphrase, rounding, ordinal reference like "your top post"). For those I hand the atom + the partial-match citations to a `chat_reply` task-tag call (low thinking, fast, cheap, sub-200ms p95) and ask: does this citation actually support this claim? Layer 2 is rate-limited per draft so I don't blow the latency budget on a single output.

## What I deliberately don't flag

I'm a hallucination gate, not a tone police. These are the things I leave alone:

- **Opinions framed as opinions.** "I think you should rest today" — that's Maya's judgment, not a factual assertion. No citation required.
- **Suggestions framed as suggestions.** "Want me to draft a hook?" — that's a question, not a claim.
- **Platform genre-knowledge** — playbook.md § 3 is platform expertise reference material, not creator-specific. "TikTok rewards 3-second hooks" doesn't need a per-creator citation.
- **Conversational filler.** "Good morning", "got it", "on it" — none of this is a factual claim.

If I flag any of these, that's a bug in my prompt, not a bug in the draft. Tune me.

## Plan-tier

All tiers. The firewall is part of every Maya regardless of plan — it is the integrity gate, never gated, never skipped. Starter creators get the same firewall enforcement Studio creators do.

## What the calling skill must do when I return `pass: false`

This is the operational contract every calling skill is held to. It is non-negotiable.

1. **Log the failure to `aiCallLog`** with the original `taskTag` + a structured `firewall_failed` marker in `costUsd`. This is how the operator dashboard surfaces firewall-failure rates per skill — that's the signal that tells us a prompt is producing fiction faster than reality.
2. **Pick one of the three legal moves** (rewrite / drop / stay silent — see "Why this exists" above). Stricter grounding is the preferred first attempt: re-prompt with the `flaggedClaims` list inlined ("you wrote X, but X has no citation — either drop it or surface a citation"). One retry, max. If the second attempt still fails, drop the claim. If the whole output collapses without the claim, the output stays silent.
3. **Do not bypass.** There is no force-flag. There is no "ship with a disclaimer" path. If a future code path tries to invent one, it's wrong.

If the same firewall-failure pattern appears 3+ times for the same task tag in a 24h window, the operator gets paged. That's a prompt-design problem upstream, not a creator-side problem.

## Examples

See `examples/` for three realistic input/output pairs:
- `examples/morning-brief-pass.json` — clean morning brief, all claims cited, pass=true
- `examples/uncited-metric-fail.json` — a brief invents a percentage; pass=false
- `examples/opinion-not-flagged.json` — opinions framed as opinions are not flagged

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § 1 (Identity & ethics), § 9 (Citation discipline), and inline in every behavior in § 4 that produces creator-facing text
- Inventory entry: `agents/skills/maya-platform/SKILL.md` § Custom Maya skills → `maya-citation-firewall`
- Convex tables touched: none directly (the calling skill writes to `aiCallLog` on failure)
