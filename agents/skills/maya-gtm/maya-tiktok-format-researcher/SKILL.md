---
name: maya-tiktok-format-researcher
description: Find what's working in the operator's niche on TikTok RIGHT NOW. Apply the 5-video rule from playbook/tiktok.md § 7.
---

# maya-tiktok-format-researcher

## Purpose

TikTok rewards format-remix, not content-copy. This skill mines the operator's niche on TikTok to find the dominant winning format — hook structure, length, on-screen-text style, music, CTA pattern — and certifies it via the 5-video rule (tiktok.md § 7). Demo-strategist consumes the output to pick faceless / talking-head / slideshow with confidence.

## When to invoke

- IF `maya-tiktok-demo-strategist` returned `formatResearchNeeded: true` THEN run.
- IF channel-judge is weighing TikTok and `formatConfidence` is unknown THEN run.
- IF results-reviewer detects operator's current TikTok format underperforming (<5K views over 5 posts) THEN re-run.
- NEVER from heartbeat; most ScrapeCreators-intensive skill (cap 12 calls).

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 1-3, § 7.
3. **playbook/tiktok.md — MANDATORY § 7 (niche-format mining), § 2 (hook catalog), § 3-5 (format anatomies).**
4. MEMORY.md.

## Decision rules

1. **5-video rule (tiktok.md § 7).** A format is "winning" only if ≥5 of top 20 videos for a niche keyword share a hook structure.
2. **Top-by-keyword sampling.** For each candidate keyword, pull top 20 via `/v1/tiktok/search/top`. Catalog hook + length + format + sound + CTA.
3. **Recency filter.** Discard videos >90 days old; algorithm drift makes them weak signals.
4. **Diversity check.** If top 20 are all from 1-2 accounts, surface `nicheCreatorConcentration: "high"`.
5. **Format taxonomy.** Tag each video: `faceless_screen_record`, `founder_talking_head`, `slideshow_photo_mode`, `mixed`. Aggregate.
6. **Hook taxonomy.** Tag each hook against tiktok.md § 2 catalog (pattern-interrupt, outcome-promise, question, demo-cold-open, pain-validation, proof-first, POV, contrarian, before/after, comment-bait).
7. **Length sampling.** Median + p25/p75 per niche.
8. **Sound velocity.** Flag any audio appearing in ≥3 videos in last 7 days — accelerating niche sound (tiktok.md § 10 — 12-24h sweet spot).
9. **CTA pattern.** Aggregate: search-by-name / pinned-comment / DM-keyword. Refuse "link in bio" recommendations.
10. **No recommendation without ≥5 confirming videos.** If no format hits 5, `confidence: "insufficient_evidence"`.

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
  };
  hookPatternCounts: Record<string, number>;
  formatCounts: Record<string, number>;
  acceleratingSounds: Array<{
    soundId: string;
    title: string;
    artist?: string;
    usageLast7d: number;
    firstSeenHoursAgo: number;
    velocityVerdict: "pre_peak_0_24h" | "early_24_72h" | "post_peak_skip";
  }>;
  exampleVideos: Array<{ url: string; handle: string; views: number; likes: number; durationSec: number; format: string; hookPattern: string; ctaPattern: string; soundId?: string; excerpt?: string }>;
  ctaTaxonomy: Record<"search_by_name" | "pinned_comment" | "dm_keyword" | "other", number>;
  searchQueriesUsed: string[];
  rulesCited: string[];
}
```

## Failure modes

- **Niche has no English-language TikTok activity.** `confidence: "insufficient_evidence"`. Recommend channel-judge demote TikTok.
- **ScrapeCreators returns zero results.** Check param shape (tiktok.md § 7). If still empty, request operator-narrowed keywords.
- **All top videos are paid ads.** `topResultsAreAds: true`. Recommend broader keyword.
- **Single creator dominates >50%.** `nicheCreatorConcentration: "high"` — remix risky.

## Cost discipline

Max 12 ScrapeCreators calls: 3-5 keywords × 1 `/search/top` + 2-3 `/search/hashtag` + 1 `/hashtags/popular` + 1-2 `/profile/videos`. 1 hard_research_beta keyword expansion + 1 main_maya. Timeout 20 min. No heartbeat spend.

## Anti-slop check

Structured taxonomy output, slop-critic NOT invoked. `excerpt` strings from real videos are verbatim — do not paraphrase.
