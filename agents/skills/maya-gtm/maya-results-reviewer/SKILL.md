---
name: maya-results-reviewer
description: Review published results. Recommend double_down / iterate / do_not_overfit per PLAYBOOK format-market-fit detection. Counter-overfitting checks.
---

# maya-results-reviewer

## Purpose

Posts are useless without a feedback loop. Consumes post engagement data (T+2h / T+24h / T+7d) and feeds back recommendations: keep, iterate, drop. Also the failure-mode detector — void / skip / cringe / feature / post-and-pray spotted here.

## When to invoke

- IF a post hit a follow-up trigger (T+2h, T+24h, T+7d) THEN run.
- IF operator says "how did this perform?" THEN run.
- IF channel-strategy is being reconsidered THEN run on recent posts first.
- IF distribution-motion-tester thresholds need a check THEN run.
- HEARTBEAT-COMPATIBLE for cached/local reads only — fresh API pulls spend budget; come from explicit job triggers.

## Required reads

1. APP.md, GTM.md.
2. **PLAYBOOK.md § 2 Phase 4 (format-market-fit), § 5 (all 5 failure modes — retroactive detection), § 4.**
3. playbook/{channel}.md baselines.
4. MEMORY.md for prior reviews — counter-overfitting depends on history.

## Decision rules

1. **Failure-mode retrospective check (PLAYBOOK § 5).** For every post >24h old:
   - **Void**: <30 likes + <5 replies on <1k-follower account → rule 9.8 / Failure 1.
   - **Skip**: >70% engagement from other founders → Failure 2 / rule 9.9.
   - **Cringe**: high impressions + low engagement → Failure 3.
   - **Feature**: replies ask "but what does it do?" → Failure 4.
   - **Post-and-pray**: no follow-up within 48h → Failure 5.
2. **Format-market-fit detection (PLAYBOOK § 2 Phase 4).** After 2-3 weeks, winning format should visibly outperform. Name it. "Metric posts get 4x engagement → 2/week, reduce build updates to 1." Rule 9.23.
2b. **Content-attribute correlation (the deeper "what SPECIFICALLY worked" — Sprint C).** Don't stop at coarse format. Each draft carries `attributes` (hookType / format / tone / lengthBucket / hasFace / captionStyle / postingWindow — my own tags). Correlate those attributes against OUTCOMES — clicks → conversions FIRST (from the attribution data / `record_conversion`), then engagement — to find what specifically lands for THIS founder: "your punchy 0-3s hooks convert 4x your explainer intros," "lowercase casual captions outperform polished ones on Reddit," "Tue-morning posts beat Thu." Feed the winners into next week's drafting (which hooks/tones/lengths to favor). Same counter-overfitting discipline as #3 — an attribute pattern needs repeated signal, not one post. Optimize for the converting attribute, not the most-liked one.
3. **Counter-overfitting check.** If a single post crushes (5-10x normal), DO NOT immediately recommend "do 10 of these." Require 3+ format-confirming wins before double-down.
4. **Buyer-vs-founder analysis.** Classify each commenter/replier. If >70% founder, flag skip-launch regardless of raw count.
5. **Unprompted-demand signal.** "Where can I try this?" replies are highest-value. 1 from a non-founder >100-follower account = Phase 2 green light.
6. **Churn-confession opportunity (rule 9.24).** Recommend churn-confession post only if something actually broke. Never fabricate.
7. **Algorithm penalty detection (x.md § 11 Failure 3).** If account-level reach drops on last 5 posts despite consistent format, `algorithmPenaltyRisk: true`.
8. **No paid-amplification recommendation pre-FMF (rule 9.21).** Even if a post is performing, organic CAC > 50% LTV = refuse.
9. **Compounding-cadence check (PLAYBOOK § 2 Phase 4).** Expected: 1 metric + 2 build/insight + 1 demo/proof per week + reply-mining 4-5d/week. Surface gaps.
10. **Citation-firewall on numbers.** Every metric must come from a live API pull or be marked `staleFromCacheAt: ts`.
11. **No "we're learning a lot" sycophancy.** If verdict is "this isn't working", say so.

## Output schema

```ts
interface ResultsReview {
  perPostResults: Array<{
    liveUrl: string;
    channel: string;
    publishedAt: string;
    metrics: { likes: number; replies: number; reposts: number; impressions?: number; engagementToFollowersPct: number };
    failureModeMatch: "none" | "void" | "skip" | "cringe" | "feature" | "post_and_pray";
    buyerVsFounderEstimate: { buyer: number; founder: number; unclear: number };
    unpromptedDemandReplies: number;
    verdict: "void" | "weak" | "ok" | "strong" | "outlier";
  }>;
  formatPerformance: Array<{
    formatPatternId: string;
    sampleCount: number;
    medianEngagementPct: number;
    recommendation: "double_down" | "iterate" | "drop" | "more_data_needed";
    counterOverfittingNote?: string;
  }>;
  formatMarketFitVerdict: "not_yet" | "candidate" | "confirmed";
  channelLevelHealth: { last5PostsReach: "rising" | "flat" | "falling"; algorithmPenaltyRisk: boolean; accountSilenceRisk: boolean };
  recommendedNextActions: Array<{ action: string; rulesCited: string[]; severity: "advisory" | "blocking" }>;
  churnConfessionOpportunity?: { realChurnEvent: string };
  rulesCited: string[];
}
```

## Failure modes

- **Live engagement data unavailable.** Mark `staleFromCacheAt`.
- **Sample size too small.** N<3 per format = `more_data_needed`.
- **One viral outlier.** `counterOverfittingNote: "N=1; need 2 more confirming posts"`.
- **Operator wants validation, not review.** Return the honest verdict anyway. Anti-sycophancy is non-negotiable.

## Cost discipline

Max 4 ScrapeCreators calls (1 per platform). Cache aggressively. 1 main_maya synthesis + buyer-vs-founder classification. Heartbeat reads cached only. Timeout 12 min.

## Anti-slop check

`recommendedNextActions[].action` and `verdict` strings are operator-facing. Run `maya-slop-critic`. Must not read "let's iterate and learn from this exciting first launch!" — must read "this was a void launch by rule 9.8; the format reached only the founder circle; we change channel or sharpen the hook within 14 days." Terse, honest, cited.
