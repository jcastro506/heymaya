---
name: maya-tiktok-format-researcher
description: Find what's working in the operator's niche on TikTok RIGHT NOW. Identify the format that clearly recurs across the strongest recent videos in the niche (tiktok.md § 7).
---

# maya-tiktok-format-researcher

## Purpose

TikTok rewards format-remix, not content-copy. This skill mines the operator's niche on TikTok to find the dominant winning format — hook structure, length, on-screen-text style, music, CTA pattern — and certifies it by identifying clear recurrence across the strongest recent videos in the niche (tiktok.md § 7). Demo-strategist consumes the output to pick faceless / talking-head / slideshow with confidence.

A format that goes viral but pulls the wrong audience is actively harmful. The goal is buyer-pull: formats that produce comments like "where do I get this", "does it do X", or "finally" from people who look like your target buyer. Raw view count is a vanity metric; retention momentum (the algorithm continuing to push a video after the first day) + buyer-language in comments together tell you whether a format converts audience into pipeline.

## When to invoke

- IF `maya-tiktok-demo-strategist` returned `formatResearchNeeded: true` THEN run.
- IF channel-judge is weighing TikTok and `formatConfidence` is unknown THEN run.
- IF results-reviewer detects operator's current TikTok format underperforming THEN re-run.
- NEVER from heartbeat; most ScrapeCreators-intensive skill (cap 12 calls).

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 1-3, § 7.
3. **playbook/tiktok.md — MANDATORY § 7 (niche-format mining), § 2 (hook catalog), § 3-5 (format anatomies).**
4. MEMORY.md.

## Decision rules

1. **Format recurrence (tiktok.md § 7).** A format is "winning" when it clearly recurs across a meaningful share of the strongest recent videos in the niche — not because it hits an arbitrary count threshold, but because you can see the same hook structure, visual rhythm, and CTA pattern playing out independently across multiple creators. One viral outlier is noise; convergent behavior across creators is signal.
2. **Retention + watch-momentum over raw views.** Prefer formats that show signs of sustained algorithmic push (high share-to-view ratio, comments arriving days after publish, reuse by multiple creators) over formats with a single spike. A moderate-reach format that keeps getting distributed beats a flash-in-the-pan hit.
3. **Top-by-keyword sampling + deep pagination.** For each candidate keyword, pull the top batch via `/v1/tiktok/search/top`. If the niche signal is thin (few results, dominated by one creator, or mostly ads), paginate deeper and try adjacent keywords before concluding `insufficient_evidence`. Don't let a shallow first-page pull misrepresent a niche that does have signal.
4. **Recency judgment.** Prefer recent videos — algorithm drift is real. How recent "recent enough" is depends on how fast-moving the niche is: a trend-driven niche goes stale in weeks; a utility/tool niche has slower drift. Use judgment; don't mechanically discard by calendar date.
5. **Diversity check.** If the top results are dominated by 1-2 accounts, surface `nicheCreatorConcentration: "high"`. Convergent behavior across many independent creators is a more reliable signal than one prolific account.
6. **Format taxonomy.** Tag each video: `faceless_screen_record`, `founder_talking_head`, `slideshow_photo_mode`, `mixed`. Aggregate.
7. **Hook taxonomy.** Tag each hook against tiktok.md § 2 catalog (pattern-interrupt, outcome-promise, question, demo-cold-open, pain-validation, proof-first, POV, contrarian, before/after, comment-bait).
8. **Length sampling.** Median + p25/p75 per niche.
9. **Sound velocity.** Flag audio that appears to be accelerating — spreading fast across multiple unrelated accounts in the niche — as a potential early-adoption opportunity (tiktok.md § 10 — 12-24h sweet spot). Also flag sounds you see spreading to competitor products: if a sound already has market saturation in the niche, its uplift window may be closing.
10. **CTA pattern.** Aggregate: search-by-name / pinned-comment / DM-keyword. Refuse "link in bio" recommendations.
11. **Buyer-language comment mining.** For the top confirming videos in the identified format, pull comments and scan for buyer-language signals: intent phrases ("where do I get this", "how do I sign up", "does it work with X"), problem-validation phrases ("I've been looking for this", "finally"), and objection phrases ("is it free", "how much"). A format with strong buyer-language in comments ranks above a format with the same reach and no buyer-language. Surface the best-signal comment excerpts verbatim in `buyerLanguageExamples`.
12. **No recommendation without clear evidence.** If no format shows clear recurrence across independent creators, `confidence: "insufficient_evidence"`. Do not force a recommendation from thin data.

## Output schema

```ts
interface TikTokFormatResearch {
  confidence: "high" | "medium" | "low" | "insufficient_evidence";
  primaryFormat?: {
    label: "faceless_screen_record" | "founder_talking_head" | "slideshow_photo_mode";
    confirmingVideoCount: number;
    dominantHookPattern: string;
    medianLengthSec: number;
    p25LengthSec: number;
    p75LengthSec: number;
    nicheCreatorConcentration: "low" | "medium" | "high";
    retentionMomentumSignal: string; // qualitative description of sustained-push evidence
    buyerPullRating: "strong" | "moderate" | "weak" | "unknown"; // based on comment mining
  };
  hookPatternCounts: Record<string, number>;
  formatCounts: Record<string, number>;
  acceleratingSounds: Array<{
    soundId: string;
    title: string;
    artist?: string;
    usageLast7d: number;
    firstSeenHoursAgo: number;
    velocityVerdict: "pre_peak_0_24h" | "early_24_72h" | "post_peak_skip" | "competitor_saturated";
  }>;
  exampleVideos: Array<{ url: string; handle: string; views: number; likes: number; durationSec: number; format: string; hookPattern: string; ctaPattern: string; soundId?: string; excerpt?: string }>;
  buyerLanguageExamples: Array<{ videoUrl: string; comment: string; signalType: "intent" | "problem_validation" | "objection" | "buyer_adjacent" }>;
  ctaTaxonomy: Record<"search_by_name" | "pinned_comment" | "dm_keyword" | "other", number>;
  searchQueriesUsed: string[];
  paginationDepth: string; // describe how many pages / adjacent keywords were tried
  rulesCited: string[];
}
```

## Failure modes

- **Niche has no English-language TikTok activity.** `confidence: "insufficient_evidence"`. Recommend channel-judge demote TikTok.
- **ScrapeCreators returns zero results.** Check param shape (tiktok.md § 7). If still empty, request operator-narrowed keywords.
- **All top videos are paid ads.** `topResultsAreAds: true`. Recommend broader keyword.
- **A single creator is behind most of the winning examples.** `nicheCreatorConcentration: "high"` — remix risky (you'd be copying one person, not a format the niche has converged on).

## Cost discipline

Max 12 ScrapeCreators calls: 3-5 keywords × 1 `/search/top` + 2-3 `/search/hashtag` + 1 `/hashtags/popular` + 1-2 `/profile/videos`. 1 hard_research_beta keyword expansion + 1 main_maya. Timeout 20 min. No heartbeat spend.

## Anti-slop check

Structured taxonomy output, slop-critic NOT invoked. `excerpt` strings from real videos are verbatim — do not paraphrase.
