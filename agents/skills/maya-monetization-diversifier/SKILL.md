---
name: maya-monetization-diversifier
version: 0.1.0-sprint3.5b
description: Milestone- and stall-triggered advisor for stacking new revenue streams (affiliate / merch / courses / subs / ad-rev / email-list / live-events / consulting). Ships per-niche playbooks (fitness, beauty, finance, lifestyle, gaming, education) plus a generic fallback. Off-platform audience capture (email list) recommended in every niche.
when-to-use: Three triggers — milestone events (10K/50K/100K/500K folds into morning brief), revenue-flat-90d (folds into evening recap), and on-demand from chat (how do I make more money / merch yes or no).
plan-tier: ungated (monetizationAdvisorEnabled true on every tier per W1-A revised matrix). Studio adds optional cross-creator anchors when peer benchmarks opt-in.
thinking-budget: high
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - monetization
      - revenue
      - diversification
      - playbooks
      - creator
---

## Calls

- `maya-citation-firewall` — mandatory; every proposal must cite size milestone, niche playbook, or comparable creator

## Delegates to

- model router `callMaya` for synthesis


# maya-monetization-diversifier

## How I think about this

Most creators accidentally trap themselves in single-stream income (brand deals, full-stop) and are vulnerable to one bad quarter. The strategic job of a manager is to build a portfolio: brand deals + affiliate + email list + merch + course + subscription, layered in over time as the audience grows and the leverage of each stream changes.

I don't wait for the creator to ask. I watch for the trigger events — milestone hits at 10K/50K/100K/500K, or 90 days of flat revenue — and push a proposal into the morning brief or evening recap with specific first steps and named comparable creators. The proposal cites the niche playbook; the creator decides yes or no.

The single most important recommendation, every cycle, regardless of niche: **build the email list.** Platform algorithms can change overnight; an owned email list cannot. If the creator doesn't have one yet, that's the lead recommendation. If they do, every other proposal gets a "your X is ~3x more profitable when launched into your own email list" reinforcement note attached.

## Inputs

```ts
{
  creatorPicture: {
    followerCount: number;
    niche: string;                       // mapped to per-niche playbook below
    monthlyRevenueUsd: number;
    currentRevenueStreams: Array<
      'brand-deals' | 'affiliate' | 'merch' | 'courses' | 'subs' | 'ad-rev' | 'email-list' | 'live-events' | 'consulting'
    >;
  };
  recentRevenueTrend: 'growing' | 'flat' | 'shrinking';
  stallTrigger?:
    | 'milestone-10k' | 'milestone-50k' | 'milestone-100k' | 'milestone-500k'
    | 'revenue-flat-90d'
    | 'on-demand';
}
```

## Outputs

```ts
{
  proposals: Array<{
    stream: 'affiliate' | 'merch' | 'courses' | 'subs' | 'ad-rev' | 'email-list' | 'live-events' | 'consulting';
    why: string;                          // 1-2 sentences, citation-grounded
    expectedAddedRevenueRange: { low: number; high: number };  // USD/mo, honest range
    effortToLaunch: 'days' | 'weeks' | 'months';
    firstSteps: string[];                 // 3-5 concrete actions
    comparableCreators: string[];         // named peer examples (Studio populated; Pro hint-only)
  }>;
  antiPatterns: string[];                 // patterns to avoid for this creator's size + niche
  citations: Array<{ kind: 'metric' | 'peer'; id: string; fact: string }>;
}
```

## Per-niche playbooks (mirrored in `script.ts` as `NICHE_PLAYBOOKS`)

Each niche has milestone-anchored recommendations. The `maya-monetization-diversifier`
script consults the playbook for the creator's niche; if the niche isn't
indexed, the generic fallback applies.

### Fitness
- 10K → affiliate (Gymshark, MyProtein, Bandwidth, ACV affiliate programs)
- 50K → branded merch (apparel — start lean: 1 hoodie + 1 shaker bottle) + email list
- 100K → course (1RM training program, nutrition tracker) or subscription (custom plans)

### Beauty
- 10K → affiliate (Sephora Squad, Ulta affiliate, indie-brand affiliate codes)
- 50K → branded merch (lip kit, brush set — ship via a fulfillment partner)
- 100K → your own line (collab with a manufacturer — multi-quarter ramp)

### Finance
- 10K → affiliate (broker referrals — Robinhood, M1 Finance, Webull affiliate)
- 50K → course + email list (the email list is non-negotiable in finance — ad/algo risk is high here)
- 100K → paid community / Substack

### Lifestyle
- 10K → affiliate (Amazon storefront, ShopMy)
- 50K → merch (apparel + 1 lifestyle item)
- 100K → ambassador deals at scale + paid Substack

### Gaming
- 10K → subscription / membership (Twitch subs, YouTube Memberships, Patreon)
- 50K → merch (apparel + a peripheral collab)
- 100K → brand partnerships at scale (esports orgs, peripheral brands)

### Education
- 10K → course (Skillshare, Teachable, Udemy)
- 50K → paid community (Discord + Circle + Skool)
- 100K → certifications + cohort programs

### Generic fallback (any niche not above)
- 10K → affiliate (any in-niche affiliate program; default Amazon storefront)
- 50K → email list + 1 niche-appropriate merch SKU
- 100K → course or subscription, whichever the creator's audience signals stronger demand for

## Off-platform audience capture (the universal recommendation)

Every cycle, regardless of niche, Maya proactively pushes email-list
growth as the most-strategic move. The reasoning is consistent: platform
algorithms can change overnight; an owned email list cannot. Maya proposes
email-list as either:

- A standalone proposal if the creator has none yet
- A reinforcement note attached to other proposals (e.g. "your course is
  ~3× more profitable when launched into your own email list, not into
  your TikTok feed")

The script enforces this — `proposals` always contains at least one
`email-list`-shaped item OR an explicit `email-list-already-active`
acknowledgement (when the creator's `currentRevenueStreams` already
includes `email-list`).

## How it works

1. **Look up the niche playbook.** `script.ts` has a deterministic
   `NICHE_PLAYBOOKS` map that returns the 10K / 50K / 100K / 500K
   recommended next streams for the creator's niche. Falls back to the
   generic playbook if the niche isn't indexed.
2. **Filter by current streams.** Drop streams the creator already has
   active. (No point recommending `affiliate` to a creator who already
   does affiliate — the right move is to optimize what's there, which is
   `maya-growth-coach`'s job.)
3. **Apply the trigger context.** Different triggers mean different
   proposal shapes:
    - Milestone trigger: focus on the new tier's recommended stream
    - Revenue-flat-90d: bias toward streams that compound (email list,
      affiliate codes, evergreen course)
    - On-demand: full menu (top 3 ranked)
4. **Always include email-list.** If the creator's current streams don't
   include `email-list`, prepend an `email-list` proposal regardless of
   the playbook recommendation.
5. **Call the model router.** Pass the filtered playbook + current streams
   + trigger context to `callMaya` with task tag `weekly_review_synth`
   (high thinking) for the `why` strings, `firstSteps` arrays,
   `expectedAddedRevenueRange`, and `comparableCreators` (Studio only).
6. **Citation firewall.** Every `why` string passes through the firewall
   with citations naming the playbook + the milestone trigger.
7. **Persist.** Caller writes the surfaced proposals to
   `monetizationProposalLog` for tracking and dedupe — same
   recommendation shouldn't re-fire on consecutive cycles unless the
   creator explicitly accepts or dismisses.

## Anti-pattern detection

The skill also surfaces anti-patterns — common mistakes for this
creator's size + niche. Examples baked into the playbook:

- "Don't launch a $500 course at 8K followers" (pricing too high pre-trust)
- "Don't try merch at 10K — fulfillment + design + launch costs eat your
  margin; affiliate codes do the same job at 0% capital risk"
- "Don't skip email list to 'just focus on the platform' — the manager who
  did this in 2024 paid for it during the 2025 algo shift"

`antiPatterns` array is empty when no high-confidence pattern applies.

## Plan-tier gating (server-side, fail-closed)

`monetizationAdvisorEnabled` is `true` on both Assistant and Manager. Both tiers get the per-niche playbook + email-list push.

- `coach`: enabled. `comparableCreators` is hint-only (1-2 anonymized peer references; full named-peer roster requires the audience-fingerprint cache).
- `manager`: enabled. `comparableCreators` populated with named peers when ScrapeCreators backfill cache has data.

## Honest uncertainty

If the creator's niche isn't in my playbook table, I fall back to `generic` and tell them: *"Your niche isn't one I've watched closely enough to have a playbook for — these recommendations are the universal lever (email list + an in-niche affiliate program), not niche-specific. Tell me what you've seen work for peers and I'll calibrate."*

If recent revenue is below the milestone threshold but climbing fast (e.g. 8K followers but 3 months of 40% MoM growth), I lean to the next-stage recommendation early rather than wait for the strict trigger. Better to set up the email list at 8K than at 12K.

I never promise a number. Every `expectedAddedRevenueRange` is a range, never a point estimate, and the model prompt blocks output that says "you'll make $X" instead of "$X-$Y is realistic."

## What this skill is NOT

- **Not a brand-deal optimizer.** Brand deals are `maya-rate-calculator` +
  `maya-brand-outreach`'s domain.
- **Not a course launch agency.** Maya proposes the move and the first
  steps; she does not ghostwrite the course or build the funnel.
- **Not a financial advisor.** All revenue ranges are honest estimates
  based on niche/size playbooks, never guarantees. The model prompt
  enforces "no promised numbers" — always ranges.

## Examples

- `examples/fitness-50k-milestone.json` — fitness creator hits 50K,
  proposal is branded-merch lean launch + email list
- `examples/finance-revenue-flat-90d.json` — finance creator with $4K/mo
  flat for 90 days, proposal is course + email list

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Monetization
  diversification (lead backfills the cron + playbook entries).
- Listed in `agents/skills/maya-platform/SKILL.md` § Custom Maya skills.
- Reads no new tables directly; writes to `monetizationProposalLog`
  (request schema add — see report).
