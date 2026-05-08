---
name: maya-pitch-strategy
version: 0.1.0-sprint3.5b
description: Stage-aware free / gifted / paid / decline decision engine for brand pitches. Pure-logic rules anchored in creator size, monthly revenue, and prior brand-deal history. Consumed by maya-brand-outreach to set pitch tone + asked rate, and by maya-rate-calculator to anchor the suggested range when no offer dollars are attached.
when-to-use: Before drafting any outbound pitch (scout-discovered or manually added) and before replying to inbound emails with no proposed dollars. Output consumed by maya-brand-outreach and optionally maya-rate-calculator.
plan-tier: ungated (pure decision logic; no LLM, no external calls).
thinking-budget: none
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - pitch
      - strategy
      - brand-deal
      - decision-engine
      - creator
---

## Calls

- `maya-citation-firewall` — output `reasoning` carries claims about creator size + revenue + prior deals; firewall runs in the wrapping action


# maya-pitch-strategy

## What I actually do when I'm picking the pitch shape

A new creator with 8k followers takes every "free product for a post" deal that crosses their inbox and burns out before they monetize. A 30k creator leaves money on the table by pitching paid when the brand needed a portfolio piece, or pitching free when the work would have commanded $3k. A real manager doesn't pitch the same way at every stage — she reads where the creator actually is right now, and picks the kind of ask that fits.

That's the whole job here. The creator hands me a brand they want to pitch; I read four things — their size, their last 30 days of revenue, their prior deals on file, what they told me they want in soul.md — and I tell them which kind of pitch to send. Pitch paid. Pitch free for the portfolio. Pitch gifted. Or skip this one.

The conversation in chat sounds like:

> "Lululemon pitch — at 8k you're below their usual paid floor, but a Lulu logo on your deck is worth more than three $200 pitches that go nowhere. Pitch this one for free, frame it portfolio-build."
>
> "Want me to draft it that way, or push paid anyway?"

That's the pattern: my read, the why, an ask. Never a command.

## What I'm looking at

- **Creator size.** Primary platform follower count. Sets the floor for what brands typically pay them.
- **Monthly revenue.** Last 30d net to the creator (brand deals + affiliate + everything). Tells me whether they're still building a base or already at scale.
- **Prior deal pattern.** Have they been paid for a similar ask before? At what rate? One $2k Lululemon deal in the last 90 days changes the answer for the next Lululemon-tier brand entirely.
- **The opportunity itself.** Brand's tier, deliverable shape, urgency.
- **Stated goals from soul.md.** Does this pitch actually serve what the creator says they want? "Grow long-form YouTube" + "IG-only deliverable" = misalignment, surface the gap.

## Inputs

```ts
{
  creatorPicture: {
    followerCount: number;
    monthlyRevenueUsd: number;
    brandDealHistory: Array<{ amountUsd: number; date: string }>;
  };
  opportunity: {
    brandName: string;
    estimatedRateRange?: { low: number; high: number };
    deliverables: string;
    urgency: 'low' | 'medium' | 'high';
  };
  creatorGoals: string;
}
```

## Outputs

```ts
{
  recommendation: 'pitch-paid' | 'pitch-free-build-book' | 'pitch-gifted' | 'decline';
  reasoning: string;                    // human-readable, citation-firewall-safe
  suggestedRateUsd?: number;
  expectedConversionLikelihood: number; // 0..1
  riskOfMisaligningCreator: 'low' | 'medium' | 'high';
  citations: Array<{ kind: 'metric' | 'deal'; id: string; fact: string }>;
}
```

`citations` feeds the firewall. Every numeric / past-tense reference in `reasoning` is backed by a citation.

## How I read the four creator stages

### Stage A — Hobbyist (< 10K followers OR < $2K/mo revenue)

**Default: `pitch-free-build-book`** for portfolio brands the creator would proudly show in a manager-readiness packet 6 months from now. Building the book is the highest-leverage move at this stage. One Lululemon-logo case study beats three $200 pitches that go nowhere.

**`pitch-gifted`** when the brand sells a product the creator would already buy (real product fit). I do NOT recommend taking generic-skincare gifts when the creator is finance-niche — that's how a feed turns into a dollar store.

**`pitch-paid`** is permitted ONLY when prior deal history shows the creator has been paid by a similarly-sized brand before (at least one prior deal ≥ $500 in the last 90 days). Cold-pitching paid from a hobbyist with zero deal history → ghost guaranteed. The brand has nothing to anchor against.

**`decline`** when the brand is wildly out of niche, or the deliverable ask is exploitative (3+ posts for product-only with full usage rights — that's a paid campaign disguised as a freebie).

### Stage B — Emerging (10K–50K followers, $2K–$10K/mo revenue)

The hybrid stage. **`pitch-paid`** for in-niche brands; **`pitch-gifted`** for stretch brands one tier above the creator's current peer set; **`pitch-free-build-book`** is reserved for *exceptional* strategic value — a dream brand whose logo on the deck would re-rate the creator's whole positioning. Document the reasoning when this fires; it should be rare.

Suggested rate floor: $500 even for product-fit pitches. The creator's time has measurable cost.

### Stage C — Established (50K–500K followers, > $10K/mo revenue)

**Paid is the default.** `pitch-gifted` only when the brand has high cultural cachet — a mid-tier indie whose mention is itself a status signal in the niche. `pitch-free` should almost never appear here; if it does, the reasoning must explicitly justify why monetary compensation would actually hurt long-term positioning.

Floor rate: at least 75% of the creator's trailing-3-deal average.

### Stage D — Pro (500K+ followers, > $50K/mo revenue)

**Paid only.** Floor rate enforced — at minimum the trailing-3-deal average; ideally the trailing-3-deal high.

If the opportunity's `estimatedRateRange.high` is below the floor, recommend `decline` with reasoning that names the floor publicly so the creator can also push back if they want.

## Conversion-likelihood — my honest reply-rate guess

`expectedConversionLikelihood` is a calibrated heuristic, not a model output. I'm not going to pretend it's a prediction.

Baselines:
- `pitch-free-build-book` → 0.40 (low-stakes ask)
- `pitch-gifted` → 0.30 (brand has to ship product)
- `pitch-paid` → 0.15 (highest friction)
- `decline` → 0.0 (not pitching)

Adjust by:
- −0.10 if creator has zero prior deals on file (cold from brand POV)
- +0.10 if creator's `monthlyRevenueUsd >= $5K` (signals professional)
- +0.05 per prior deal with the same brand (warm relationship — capped at +0.15)

Clamp to `[0, 0.95]`. I never claim certainty.

## Risk-of-misaligning-creator — does this contradict their goals?

Protects against pitching that fights what the creator told me they want in soul.md. Examples:

- Creator goal mentions "no fast fashion" but the opportunity is fast fashion → `high`
- Creator goal is "grow long-form YouTube" but pitch is for IG-only deliverables → `medium`
- Goals are silent on the brand category and deliverable type → `low`

Keyword-based against `creatorGoals` text. Conservative — when in doubt, return `medium` so the creator gets the flag and decides.

## How I write the `reasoning` string

It's what the creator reads when I surface the recommendation. Pattern:

> "Pitch paid at ~$1,200. You're at 38k and your trailing-3 avg is $1,400 — this should clear that. Brand's last campaign was @sarahfitness (35k peer), so they pitch into your size band. Misalignment risk low; the IG Reel + 1 Story shape matches what you've shipped well in the last 60 days."

Three things the reasoning always contains:
1. The recommendation + the rate (if paid)
2. The size/revenue/prior-deal anchor that drove it (cited)
3. A check against creator goals (low/medium/high alignment)

No fluff. No "I'm so excited about this opportunity!" — that's not a manager's voice.

## Decline framing — when I say no

When I recommend `decline`, I say WHY in concrete terms the creator can use:

- "Brand's last 5 collabs are all >100K. You're at 25k. Wrong tier — they'll ghost. Revisit in 6 months."
- "Your soul says no fast fashion. Brand is fast fashion. Hard pass."
- "Estimated rate ceiling ($400) is below your floor ($800). Pitching would either anchor low or get declined. Skip."

The creator should be able to read the decline and know exactly what would change my mind.

## Plan-tier gating

All tiers. Pure decision logic, no paid integration. The wrapping Convex action does not gate-check before calling — but downstream (`maya-brand-outreach`) checks `planFeatures(creator).brandOutreachEnabled` before drafting the actual email. On Assistant, the recommendation feeds drafts; on Manager, it can feed sends.

## What this skill is NOT

- Not a rate calculator. When `recommendation = 'pitch-paid'`, `suggestedRateUsd` is a starting anchor (midpoint of the opportunity's `estimatedRateRange` if provided, else null). Real rate computation is `maya-rate-calculator`'s job.
- Not a contract reviewer. Once a brand replies, `maya-contract-redflag` takes over.
- Not a brand surfacer. That's `maya-opportunity-scout`'s job. I take the brand as input and pick the angle.

## Examples

- `examples/hobbyist-portfolio-brand.json` — small fitness creator pitched to Lululemon → `pitch-free-build-book`
- `examples/emerging-paid-default.json` — 30K beauty creator, in-niche indie brand → `pitch-paid`
- `examples/established-decline-low-rate.json` — 200K finance creator, brand offer well below floor → `decline`

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Brand outreach + § Opportunity surfacing
- Listed in `agents/skills/maya-platform/SKILL.md` § Custom Maya skills
- Output consumed by: `maya-brand-outreach`, `maya-rate-calculator`
