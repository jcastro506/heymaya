---
name: maya-pitch-strategy
version: 0.1.0-sprint3.5b
description: Stage-aware free / gifted / paid / decline decision engine for brand pitches. Pure-logic rules anchored in creator size, monthly revenue, and prior brand-deal history. Consumed by maya-brand-outreach to set pitch tone + asked rate, and by maya-rate-calculator to anchor the suggested range when no offer dollars are attached.
when-to-use: Before drafting any outbound pitch (scout-discovered or manually added) and before replying to inbound emails with no proposed dollars. Output consumed by maya-brand-outreach and optionally maya-rate-calculator.
plan-tier: ungated (pure decision logic; no LLM, no external calls).
thinking-budget: none
---

## Calls

- `maya-citation-firewall` — output `reasoning` carries claims about creator size + revenue + prior deals; firewall runs in the wrapping action


# maya-pitch-strategy

## Why this exists

Most beginner creators take every "free product for a post" deal that
crosses their inbox and burn out before they monetize. Most mid-tier
creators leave money on the table by either (a) pitching paid when the
brand needs a portfolio piece, or (b) pitching free when their work would
have commanded $3k. This skill is the cold-blooded triage layer: given the
creator's size and the opportunity, what kind of ask actually fits.

The rules are intentionally encoded as PROSE in this file (so the operator
can audit and tune them) and mirrored in `script.ts` as deterministic
TypeScript (so the runtime is reproducible). Any rule change updates both.

## Inputs

```ts
{
  creatorPicture: {
    followerCount: number;            // total or primary-platform — caller decides
    monthlyRevenueUsd: number;        // last 30d net to the creator (brand deals + affiliate + etc.)
    brandDealHistory: Array<{ amountUsd: number; date: string }>; // ISO date
  };
  opportunity: {
    brandName: string;
    estimatedRateRange?: { low: number; high: number };  // when the scout has a guess
    deliverables: string;             // free-form: "1× IG Reel + 2× Story"
    urgency: 'low' | 'medium' | 'high';
  };
  creatorGoals: string;               // free-form from soul.md ("grow YT long-form", "land 4 deals this Q")
}
```

## Outputs

```ts
{
  recommendation: 'pitch-paid' | 'pitch-free-build-book' | 'pitch-gifted' | 'decline';
  reasoning: string;                  // human-readable, citation-firewall-safe
  suggestedRateUsd?: number;          // populated when recommendation = 'pitch-paid'
  expectedConversionLikelihood: number; // 0..1 — Maya's honest guess at reply rate for this size+brand mix
  riskOfMisaligningCreator: 'low' | 'medium' | 'high'; // does this pitch contradict stated goals?
  citations: Array<{ kind: 'metric' | 'deal'; id: string; fact: string }>;
}
```

`citations` feeds the firewall. Every numeric / past-tense reference in
`reasoning` is backed by a citation entry.

## Decision rules (locked, mirrored in `script.ts`)

The matrix is `(creator-size-bucket × revenue-bucket × prior-deal-signal)
→ recommendation`. The four buckets:

### Bucket A — Hobbyist (< 10K followers OR < $2K/mo revenue)

- **Default:** `pitch-free-build-book` for portfolio brands the creator
  would proudly show in a manager-readiness packet 6 months from now.
- **`pitch-gifted`:** the brand sells a product the creator would already
  buy (true product fit). Don't take generic-skincare gifts when the
  creator is a finance niche.
- **`pitch-paid`** is permitted ONLY when prior deal history shows the
  creator has been paid by a similarly-sized brand before (anchor: at
  least one prior deal ≥ $500 in the last 90 days). Never recommend `paid`
  on a cold pitch from a hobbyist with zero deal history — the brand will
  ghost.
- **`decline`** when the brand is wildly out of niche or the deliverable
  ask is exploitative (3+ posts for product-only with full usage rights).

### Bucket B — Emerging (10K–50K followers, $2K–$10K/mo revenue)

- **Hybrid default.** `pitch-paid` for in-niche brands; `pitch-gifted`
  for stretch brands (one tier above the creator's current peer set);
  `pitch-free-build-book` is reserved for *exceptional* strategic value
  (dream brand whose logo on the creator's deck would re-rate the
  creator's whole positioning — rare, document the reasoning).
- Suggested rate floor: $500 even for product-fit pitches; the creator's
  time has measurable cost at this size.

### Bucket C — Established (50K–500K followers, > $10K/mo revenue)

- **Paid is the default.** `pitch-gifted` only when the brand has
  high cultural cachet (mid-tier indie brand whose mention is itself a
  status signal in the niche). `pitch-free` should almost never appear
  for this bucket; if it does, the reasoning must explicitly justify why
  monetary compensation would actually hurt long-term positioning.
- Floor rate: at least 75% of the creator's trailing-3-deal average.

### Bucket D — Pro (500K+ followers, > $50K/mo revenue)

- **Paid only.** Floor rate enforced — at minimum the trailing-3-deal
  average; ideally the trailing-3-deal high.
- If the opportunity's `estimatedRateRange.high` is below the floor,
  recommend `decline` with reasoning that frames the floor publicly so
  the creator can also push back if they want to.

## Conversion likelihood heuristic (encoded in `script.ts`)

`expectedConversionLikelihood` is a rough guess to set the creator's
expectations. We don't pretend it's a model output; it's a calibrated
heuristic:

- `pitch-free-build-book` → 0.40 baseline (low-stakes ask)
- `pitch-gifted` → 0.30 baseline (brand has to ship product)
- `pitch-paid` → 0.15 baseline (highest friction)
- `decline` → 0.0 (we're not pitching)

Adjust by:
- −0.10 if creator has zero prior deals on file (cold from brand POV)
- +0.10 if creator's `monthlyRevenueUsd ≥ $5K` (signals professional)
- +0.05 per prior deal with the same brand (warm relationship)

Clamp to `[0, 0.95]` — never claim certainty.

## Risk-of-misaligning-creator heuristic

This flag protects against pitching that contradicts the creator's stated
goals in `soul.md`. Examples:

- Creator goal mentions "no fast fashion" but the opportunity is a
  fast-fashion brand → `high`
- Creator goal is "grow long-form YouTube" but pitch is for IG-only
  deliverables → `medium`
- Goals are silent on the brand category and deliverable type → `low`

The matcher is keyword-based against `creatorGoals` text. It's intentionally
conservative — when in doubt, return `medium` so the creator gets the
flag and decides.

## Plan-tier gating

All tiers. This is decision logic, not a paid integration. The wrapping
Convex action does not gate-check before calling — but downstream (e.g.
`maya-brand-outreach`) does check `planFeatures(creator).brandOutreachEnabled`
before acting on the recommendation.

## What this skill is NOT

- **Not a rate calculator.** When `recommendation = 'pitch-paid'`, the
  `suggestedRateUsd` field is a starting anchor (the midpoint of the
  opportunity's `estimatedRateRange` if provided, else null). The proper
  rate computation is `maya-rate-calculator`'s job; this skill just signals
  "go paid, here's a starting number".
- **Not a contract reviewer.** Once a brand replies, `maya-contract-redflag`
  takes over. This skill is upstream of all that.
- **Not a recommender of which brand to pitch.** Brand surfacing is
  `maya-opportunity-scout`'s job; this skill takes the brand as input and
  decides the angle.

## Examples

- `examples/hobbyist-portfolio-brand.json` — small fitness creator
  pitched to Lululemon → `pitch-free-build-book`
- `examples/emerging-paid-default.json` — 30K beauty creator, in-niche
  indie brand → `pitch-paid`
- `examples/established-decline-low-rate.json` — 200K finance creator,
  brand offer well below floor → `decline`

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Brand outreach
  + § Opportunity surfacing (lead backfills the cron + playbook entries).
- Listed in `agents/skills/maya-platform/SKILL.md` § Custom Maya skills.
- Output consumed by: `maya-brand-outreach` (sets pitch tone + ask),
  `maya-rate-calculator` (anchors paid recommendation).
- Reads no new tables; pure pass-through logic against caller-supplied
  `creatorPicture` + `opportunity`.
