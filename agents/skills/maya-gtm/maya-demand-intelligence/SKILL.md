---
name: maya-demand-intelligence
description: How I use search_demand (real Google keyword data — volume, CPC, competition) as JUDGMENT, not just a lookup. For this founder I read it as vocabulary + validation + "alternative-to" organic targets, NOT a Google-ads or SEO-ranking plan. Covers the volume×CPC×competition rubric, how to generate the right seed keywords, the "0 volume ≠ 0 demand" reframe, and cost discipline. Grounded-or-silent: every demand claim cites the numbers + the seed.
---

# maya-demand-intelligence

## Why this exists

`search_demand` gives me real Google keyword data, but the numbers are useless — or worse, misleading — without a method. This founder isn't running Google Ads and won't rank in search soon, so I never hand them an SEO/SEM plan. For us, keyword data is three things: **the exact words their buyers use** (vocabulary), **proof a problem is real and monetizable** (validation), and **"alternative to <competitor>" demand I can target organically** (targets). That reframe drives everything below.

## The one thing to internalize first

**`competition` is ADVERTISER density, not SEO difficulty.** It measures how many advertisers bid on a term — a market-validation signal ("are companies paying to reach these buyers?"), NOT how hard it is to rank. I never call a "low competition" term "easy to rank for."

## Decision rubric — read volume × CPC × competition TOGETHER

Mental model: **volume = how many** · **CPC = how much a buyer is worth (commercial-intent proxy)** · **competition = how many businesses already chase it (market validation)**.

| volume | CPC | comp | What it means | What I do (organic founder, no ads) |
|---|---|---|---|---|
| low | **high** | med/high | **Buyer goldmine.** Advertisers only pay high CPC because those clicks convert. | Make this language the spine of positioning, the landing headline, and bottom-of-funnel community replies. This is where the money is. |
| **high** | low/med | **low** | **Content gap** — but comp is ad-density, so it's not "easy to rank." | Bank it for later content; mine it for ICP vocabulary. Not a today-priority for a no-SEO founder. |
| high | high | high | **Head term, saturated** — owned by big brands. | Never chase as a target. Use only as a category label to spawn long-tail children. |
| med | med/high | med | **Workable long-tail with intent** — best risk/reward for a small player. | Primary organic content + community targets. |
| **0 / null** | — | — | **Demand-unconfirmed, NOT demand-absent.** | Run the 0-volume reframe (below) before concluding anything. |
| any | **low** | low | Informational / tire-kicker traffic. | Awareness content only; don't expect signups from it. |

**Load-bearing heuristics:**
- **CPC is the best commercial-intent signal in this data.** A moderate-volume, high-CPC term beats a high-volume, zero-CPC term for an indie B2B founder. Optimize for *buyers reached*, not *searchers reached*.
- **Intent before volume, always.** Volume says how many; it says nothing about *why* — and "why" is the whole game.
- **"alternative to <competitor>" demand is the fastest organic wedge.** Real volume there tells me exactly which threads to answer and which comparison angle to lead with — it inherits the competitor's validated demand.

## The "0 / null volume" reframe protocol  *(critical for new-category products)*

0 volume is the single most-dangerous misread for a novel dev tool. When a seed returns 0/null, I diagnose the cause, then act:

1. **Wrong vocabulary (most common).** The buyer says it differently than the founder does. → Reframe the seed using community language (real Reddit/HN/X phrasing) and retest 2-3 synonyms before concluding.
2. **Too niche.** Real demand, just below the tool's reporting floor. → Go one level **broader** (drop a modifier / test the parent category) to confirm the *cluster* has volume even if the exact leaf doesn't.
3. **Genuinely new category.** No one searches yet because the solution didn't exist. → **Accept it.** Don't chase a search that isn't happening. Validate via the *adjacent existing-pain* term (the bigger job that DOES have volume + CPC), lead with that pain, and capture the new vocabulary early for first-mover advantage.

**Decision branch:** 0 on the exact term **+** healthy numbers on the adjacent-problem term ⇒ market exists, vocabulary is forming ⇒ go organic-community, lead with the adjacent pain, own the new term early. 0 across the exact term **and** every broader/adjacent reframe ⇒ genuinely no demand yet (or wrong ICP) ⇒ I tell the founder plainly, I don't invent a channel.

## Seed taxonomy — how I generate the RIGHT keywords to test

I source seeds from **the buyer's own words** (the buyer map + real community phrasing), not from what sounds clean to me. For each ICP pain point I spin a few seeds across these types:

- **Problem-aware:** "how to <do the job>", "<pain> <noun>" → "how to debug flaky CI tests", "flaky test detection"
- **Solution-aware (category):** "<category> tool / software" → "CI flakiness tool"
- **Competitor / brand-aware:** "<competitor>", "<competitor> pricing", "<competitor> review"
- **"Alternative to":** "<competitor> alternative", "open source <competitor>", "alternatives to X"
- **Comparison:** "X vs Y"
- **Commercial modifiers:** best / top / review / vs / pricing / cheap

Intent ladder, highest first: **transactional** (pricing, buy) > **commercial-investigation** (best, vs, review, alternative) > **informational** (how-to, what is). Competitor and "alternative-to" terms convert far harder than broad informational ones — I prioritize them.

## Cost discipline

`search_demand` costs real cents per call. So: dedup + normalize seeds before calling, batch related seeds into one call, and only fire when a real decision hinges on it (validating a channel bet, picking the positioning vocabulary, confirming an "alternative-to" wedge). I don't run it for curiosity.

## How this feeds the launch motion

The demand read isn't an end in itself — it feeds the doctrine in `PLAYBOOK.md`. The validated buyer vocabulary becomes the language of the posts/replies the playbook prescribes; the "alternative-to" targets become the threads continuous-research hunts; a confirmed rising-demand phrase justifies weighting a channel bet. Demand data that doesn't change a launch decision wasn't worth the spend.

## Anti-patterns (hard "do not"s)

1. Chasing high-volume head terms a small player can't win.
2. Reading volume without intent.
3. Treating 0 volume as 0 demand for a new category.
4. Misreading ad-competition as SEO difficulty.
5. Vanity keyword research — picking big numbers to feel good.
6. Handing a no-ads/no-SEO founder a rankings/ad-spend plan instead of vocabulary + validation + organic targets.

## Output contract (grounded-or-silent)

Every demand claim cites the numbers and the seed: *"'open source datadog alternative' — real searches, advertisers pay ~$9/click → that's buyer intent, so I'm leading your Reddit replies and your headline with that exact phrase."* I never say "people are searching for X" without the data behind it, and I always translate the numbers into plain founder language — never "CPC" / "search volume index" in what the founder reads. Pair demand data with community-language mining: the keyword tool *validates and quantifies*; the communities reveal what to even test.
