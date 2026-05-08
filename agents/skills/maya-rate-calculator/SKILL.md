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

The first piece of leverage I give a creator who's negotiating alone.

## What I actually do when the creator asks "what should I charge?"

A brand emails with a $1,500 offer for an IG Reel + 2 Stories. The creator is staring at it on their phone trying to figure out if that's a steal, fair, or a lowball. Most creators don't have anyone to ask. They either reply too fast and quote 40% under their floor, or sit on it for a week and the budget moves to someone else.

I'm what they ask. And the answer they get isn't a number pulled from a generic CPM table — it's a number anchored against their own prior deals first, the niche-typical rate second, and named comparable creators third. In that order. Always.

In chat the conversation looks like:

> "$1,500 for the Reel + 2 Stories — that's below your range. Your last three Reel+Story bundles paid $2k, $2.4k, $1.8k."
>
> "Counter at $2,200. Lower bound $1,800 if you want to leave room; stretch $2,800 if you're feeling it."
>
> "Want me to draft the counter?"

Three texts. The number, the why (cited), the ask. No tables. No CPM reasoning unless the creator asks for it.

## Workflow — what I actually do under the hood

1. **Read the deliverables.** Format, count, exclusivity scope + duration, usage rights kind + duration. Four levers, all of them move the rate.
2. **Pull the creator's prior deals first.** Trailing 3 of the same shape. If they exist, they ARE the anchor. The CPM table is the fallback, not the primary read.
3. **Pull the niche CPM as a sanity check.** Beauty pays differently than finance, finance pays differently than gaming. The CPM table encodes the per-1K-follower rate floor for each niche × format. Used to cross-check the prior-deal anchor.
4. **If priors are far below the niche-typical** (>30% gap), I flag the gap honestly: *"Your trailing average is $1,200 but the niche-typical for that bundle is $2,400 — you've been underpaid. This is what the niche actually pays."*
5. **Pull comparable creators** (Manager tier when the audience-fingerprint cache is populated — heuristic-only otherwise). Named peer rates as the third sanity check.
6. **Return low/target/stretch** with citations and confidence.

I never silently override the creator's stated floor in soul.md. Heuristic comes in below their floor → I surface the gap explicitly: *"Heuristic says $400; your stated floor is $1,000. Either the floor is high for the format (re-anchor?) or this deal isn't for you."*

## Inputs

```ts
{
  followerCount: number;            // total or per-platform sum
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

`followerCount` semantics: pass the count for the platform the deliverable lives on. If the deliverable list spans platforms, the calling skill should split into multiple invocations and sum the suggestion ranges. Cross-platform pricing is not "add the singles together" — see `maya-platform-best-practice` for cross-platform discount conventions.

## Outputs

```ts
{
  suggestedRate: { low: number; mid: number; high: number };  // USD, rounded to nearest $50
  reasoning: string;                                            // human-readable, citation-firewall-safe
  comparableCreators?: Array<{                                  // Manager only
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

The `citations` array feeds directly into `maya-citation-firewall` — every claim in `reasoning` must be backed by an entry. If the LLM step produces a sentence that can't be backed, the calling code drops it before send.

## How the heuristic works (the part the creator never sees)

1. **Heuristic baseline (deterministic, no LLM).** `script.ts` computes a baseline using:
   - Niche-specific CPM ($/1k followers per deliverable) — see `NICHE_CPM` table
   - Deliverable format multipliers — TikTok video = 1.0, IG Reel = 1.1, IG carousel = 0.7, YT long = 2.5, LinkedIn = 1.3, etc.
   - Exclusivity premium: +5% (none) → +30% (category, 90+ days)
   - Usage-rights premium: +10% (organic-only) → +50% (full buyout)

2. **LLM reasoning layer (Pro+ only, medium thinking).** The heuristic range gets handed to me with the creator's `priorDeals` list. I anchor the heuristic against the prior deals and either tighten or widen the range. The output `reasoning` string is generated here. Starter creators skip this — they get the heuristic with a templated reasoning string.

3. **Comparable creators (Manager only, future).** Populated by a ScrapeCreators search for similar creators in the same niche/follower bracket.

The creator hears the reasoning, never the multipliers. *"Counter at $2,200 because your trailing-3 on this shape is $2k average and the brand's exclusivity ask adds ~10% on top."* Not *"NICHE_CPM × format multiplier × exclusivity premium = $2,200."*

## Plan-tier behavior

- **Assistant** — heuristic + LLM reasoning. No `comparableCreators` array. Confidence capped at `medium` when prior deals are empty.
- **Manager** — heuristic + LLM reasoning + `comparableCreators` populated when the cache has data. Confidence can hit `high` when 3+ prior deals + cited comparables align.

`planFeatures(creator)` is consulted by the calling Convex action. The action threads the result through `maya-citation-firewall` before returning.

## Honest uncertainty

- **Niche not in CPM table** → fall back to `general`, drop confidence to `low`. I tell the creator: *"Your niche isn't one I have strong rate data on — this is a gut-check range, not a comparable-anchored one. Let me know what you ended up charging and I'll start a record."*
- **No prior deals** → heuristic-only, confidence `medium`. *"No prior deals on file to anchor against — your first paid deal will set the floor."*
- **Heuristic wildly outside soul.md floor** → calling code surfaces the gap explicitly, never silent override.

## Examples

- `examples/lifestyle-creator-tiktok-video.json` — single deliverable, no exclusivity
- `examples/fitness-creator-ig-package.json` — multi-deliverable IG bundle with exclusivity premium
- `examples/no-prior-deals-low-confidence.json` — Starter creator, no priors

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § Brand email triage, § Rate suggestion
- Inventory entry: `agents/skills/maya-platform/SKILL.md` § Custom Maya skills → `maya-rate-calculator`
- Output passes through: `maya-citation-firewall` before Maya sends to the creator
