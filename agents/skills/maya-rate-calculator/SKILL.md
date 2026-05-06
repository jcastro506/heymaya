---
name: maya-rate-calculator
version: 0.1.0-sprint3.5
description: Brand-deal rate suggestion engine. Hybrid heuristic floor (niche CPM × deliverable multipliers × exclusivity premium × usage-rights premium) plus an LLM reasoning layer that anchors against the creator's prior deals. Returns a low/mid/high range with citations.
when-to-use: When a brand inbound is detected (called inside `maya-brand-deal-triager`) or when the creator asks "what should I charge for X?" in chat. Always pair with `maya-citation-firewall` on the output — every rate cited must point to a deliverable or a comparable.
plan-tier: all (Starter gets heuristic-only; Pro+ gets full LLM reasoning + comparable creator data points)
thinking-budget: medium (rate_suggestion task tag)
---

# maya-rate-calculator

Brand-deal rate suggestion. The first piece of leverage Maya gives a creator who is alone in negotiations.

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

## Plan-tier

- **Starter** — heuristic baseline only. `reasoning` is templated. No `comparableCreators`. Confidence is capped at `medium`.
- **Pro** — full heuristic + LLM reasoning. No `comparableCreators` (Apollo/Hunter is Studio-only).
- **Studio** — full heuristic + LLM reasoning + `comparableCreators` populated.

The `planFeatures(creator)` helper is consulted by the calling Convex action (this script.ts is pure logic). The action determines which mode to invoke and threads the result through `maya-citation-firewall` before returning to Maya.

## Failure handling

- If `niche` is not in the CPM table, fall back to `general` and lower confidence to `low`. Maya tells the creator: "Your niche isn't one I have strong CPM data on — this is a gut-check range, not a comparable-anchored one."
- If `priorDeals` is empty, use heuristic-only and mark confidence `medium` (no anchor).
- If the heuristic range is wildly outside the creator's stated floor in `soul.md`, the calling code should surface the gap explicitly, not silently override.

## Examples

- `examples/lifestyle-creator-tiktok-video.json` — single deliverable, no exclusivity
- `examples/fitness-creator-ig-package.json` — multi-deliverable IG bundle with exclusivity premium
- `examples/no-prior-deals-low-confidence.json` — Starter creator, no priors

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § Brand email triage, § Rate suggestion
- Inventory entry: `agents/skills/maya-platform/SKILL.md` § Custom Maya skills → `maya-rate-calculator`
- Convex tables touched (read): `creators`, `creatorHandles`, `brandDeals` (for `priorDeals`)
- Output passes through: `maya-citation-firewall` before Maya sends to the creator
