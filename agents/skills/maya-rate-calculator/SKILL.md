---
name: maya-rate-calculator
version: 0.1.0-sprint3.5
description: Brand-deal rate suggestion engine. Hybrid heuristic floor (niche CPM × deliverable multipliers × exclusivity premium × usage-rights premium) plus an LLM reasoning layer that anchors against the creator's prior deals. Returns a low/mid/high range with citations.
when-to-use: When a brand inbound is detected (called inside `maya-brand-deal-triager`) or when the creator asks "what should I charge for X?" in chat. Always pair with `maya-citation-firewall` on the output — every rate cited must point to a deliverable or a comparable.
plan-tier: all (Starter gets heuristic-only; Pro+ gets full LLM reasoning + comparable creator data points)
thinking-budget: medium (rate_suggestion task tag)
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - rate-calculator
      - brand-deal
      - pricing
      - creator
---

# maya-rate-calculator

The first piece of leverage I give a creator who's alone in negotiations.

## How I think about this

When a brand emails with a $1,500 offer for an IG Reel + 2 Stories, my job is to know — within thirty seconds — whether that's a steal, a fair deal, or a lowball. Most creators don't have anyone in their corner who can answer that. I do.

I don't pull rates out of thin air. I anchor against three things, in order:
1. **The creator's own prior deals.** If they've been paid $2,000 for an IG Reel three times in the last 90 days, anything below $1,500 is a step backward.
2. **Niche CPM tables.** Beauty pays differently than finance, which pays differently than gaming. The CPM table encodes the per-1K-follower rate floor for each niche x format.
3. **Comparable creators in the same niche/size band** (Manager tier when the audience-fingerprint cache is populated — heuristic-only otherwise).

Every output is a low/target/stretch range with citations. If I can't cite, I can't claim. The firewall enforces it.

## Workflow — what I actually do

1. **Read the deliverables.** Format, count, exclusivity scope + duration, usage rights kind + duration. These are the four levers that move the rate.
2. **Pull the niche CPM.** From the creator's primary niche → format-specific CPM. If niche isn't indexed, fall back to `general` and drop confidence to `low`.
3. **Compute the heuristic floor.** Deterministic baseline, rounded to nearest $50.
4. **Anchor against prior deals** (LLM reasoning pass). If trailing average is meaningfully different (>30% gap), I bias toward the prior pattern and explain why. If they're far below the heuristic, I flag the gap honestly: "you've been underpaid; here's what the niche actually pays."
5. **Pull comparable creators** (Manager tier, when cache populated). Named peer rates as a sanity check.
6. **Return low/target/stretch** with citations and a confidence level.

I never silently override the creator's stated floor in soul.md. Heuristic comes in below their floor → calling code surfaces the gap explicitly.

## Inputs

```ts
{
  followerCount: number;            // total or per-platform sum, see notes below
  niche: string;                    // free-form, mapped to NICHE_CPM table
  deliverables: Array<{
    format: 'tiktok-video' | 'ig-reel' | 'ig-carousel' | 'ig-story' | 'yt-short' | 'yt-long' | 'linkedin-post' | 'x-thread' | 'x-post';
    count: number;
    exclusivity?: { scope: 'category' | 'brand-list' | 'none'; durationDays: number };
    usageRights?: { kind: 'organic-only' | 'paid-amplification' | 'whitelisting' | 'full-buyout'; durationDays: number };
  }>;
  priorDeals?: Array<{
    brand: string;
    amount: number;                 // USD
    format: string;                 // free-form
  }>;
}
```

`followerCount` semantics: pass the count for the platform the deliverable lives on. If the deliverable list spans platforms, the calling skill should split into multiple invocations and sum the suggestion ranges. Cross-platform deal pricing is not just "add the singles together" — see `maya-platform-best-practice` for cross-platform discount conventions; this skill stays single-platform per call to keep its math honest.

## Outputs

```ts
{
  suggestedRate: { low: number; mid: number; high: number };  // USD, all rounded to nearest $50
  reasoning: string;                                            // human-readable explanation, citation-firewall-safe
  comparableCreators?: Array<{                                  // Pro+ only
    handle: string;
    platform: string;
    estRate: number;
    similarityReason: string;
  }>;
  citations: Array<{
    kind: 'deliverable' | 'comparable' | 'prior-deal' | 'heuristic-table';
    id: string;
    fact: string;
  }>;
  confidence: 'low' | 'medium' | 'high';
}
```

The `citations` array feeds directly into `maya-citation-firewall` — every claim in `reasoning` must be backed by an entry here. If the LLM reasoning step produces a sentence that can't be backed, the calling code must drop it before send.

## How it works

1. **Heuristic baseline (deterministic, no LLM).** `script.ts` computes a baseline using:
   - Niche-specific CPM ($/1k followers per deliverable) — see `NICHE_CPM` table
   - Deliverable format multipliers — TikTok video = 1.0, IG Reel = 1.1, IG carousel = 0.7, YT long = 2.5, LinkedIn = 1.3, etc.
   - Exclusivity premium: +5% (none) → +30% (category, 90+ days)
   - Usage-rights premium: +10% (organic-only) → +50% (full buyout)

2. **LLM reasoning layer (Pro+ only, medium thinking).** The heuristic range gets handed to Maya with the creator's `priorDeals` list. Maya is instructed to anchor the heuristic against the prior deals and either tighten or widen the range. The output `reasoning` string is generated here. Starter creators skip this step — they get the heuristic range with a templated reasoning string.

3. **Comparable creators (Studio only, future).** The `comparableCreators` array is populated by a ScrapeCreators search for similar creators in the same niche/follower bracket. Stubbed in this skill — TODO(s3.5): wire to ScrapeCreators in Sprint 4 when the cache table is fully populated.

## Plan-tier behavior

- **Assistant** — heuristic + LLM reasoning. No `comparableCreators` array (Apollo/Hunter discovery is Manager-only, but the heuristic CPM tables are the same). Confidence capped at `medium` when prior deals are empty.
- **Manager** — heuristic + LLM reasoning + `comparableCreators` populated when ScrapeCreators audience-fingerprint cache has data. Confidence can hit `high` when 3+ prior deals + cited comparables align.

`planFeatures(creator)` is consulted by the calling Convex action (this script.ts is pure logic). The action determines which mode to invoke and threads the result through `maya-citation-firewall` before returning.

## Honest uncertainty

- **Niche not in CPM table** → fall back to `general`, drop confidence to `low`. I tell the creator: *"Your niche isn't one I have strong CPM data on — this is a gut-check range, not a comparable-anchored one. Let me know what you ended up charging and I'll start a record."*
- **No prior deals** → heuristic-only, confidence `medium`. *"Heuristic says $800-$1,200, but I've got no prior deals to anchor against — your first paid deal will set the floor."*
- **Heuristic wildly outside soul.md floor** → calling code surfaces the gap explicitly, never silent override. *"Heuristic says $400; your stated floor is $1,000. Either the floor is high for the format (re-anchor?) or this deal isn't for you."*

## Examples

- `examples/lifestyle-creator-tiktok-video.json` — single deliverable, no exclusivity
- `examples/fitness-creator-ig-package.json` — multi-deliverable IG bundle with exclusivity premium
- `examples/no-prior-deals-low-confidence.json` — Starter creator, no priors

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § Brand email triage, § Rate suggestion
- Inventory entry: `agents/skills/maya-platform/SKILL.md` § Custom Maya skills → `maya-rate-calculator`
- Convex tables touched (read): `creators`, `creatorHandles`, `brandDeals` (for `priorDeals`)
- Output passes through: `maya-citation-firewall` before Maya sends to the creator
