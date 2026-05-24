---
name: maya-linkedin-fit-researcher
description: Decide whether LinkedIn is the right channel per playbook/linkedin.md LI-1.1 - LI-1.3 + LI-10.2. Refuse if rule LI-10.2 applies.
---

# maya-linkedin-fit-researcher

## Purpose

LinkedIn is the right channel for a narrow slice of indie products (B2B SaaS, ops/marketing/HR/sales/finance buyers, $500-5000 ACV, narrative-writing founder) and the wrong channel for most. This skill runs the fit check, refuses when criteria don't hold, and — when LinkedIn is a fit — proposes the doc-carousel-first launch shape.

## When to invoke

- IF channel-judge is considering LinkedIn THEN run.
- IF operator says "I want to post on LinkedIn" AND product is consumer/dev-tool/sub-$500-ACV THEN run specifically to refuse with a cited rule.
- IF `icpHypotheses[].locatableOn.channel === "linkedin"` THEN run.
- NEVER recommend LinkedIn ads in V1 (linkedin.md LI-7.1, PLAYBOOK rule 9.21).

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 5 (LinkedIn primary conditions), § 4 (40/50/10), § 7 affinity.
3. **playbook/linkedin.md — MANDATORY full read.** Cite LI-* rules.
4. MEMORY.md.

## Decision rules

1. **LI-1.1 channel-tree gate.** Run PLAYBOOK § 3 first. LinkedIn-primary only when steps 4-5 explicitly route there.
2. **LI-10.2 hard refuse.** IF product is indie consumer / dev tool / API / sub-$500-ACV THEN `fit: "park"`, `refusalReason: "LI-10.2 — wrong audience composition"`. Do not soften.
3. **LI-10.3 writing-style gate.** IF operator cannot write 200+ words in their own voice THEN `fit: "secondary_with_caveat"` and recommend X-first.
4. **ACV band check.** Valid LinkedIn-primary band is $500-$5000. Below → LI-10.2 fires. Above → LinkedIn helps trust but doesn't ignite (enterprise outbound is the real channel).
5. **LI-10.4 launch format default.** Document carousel (10 slides) + 400-word personal narrative caption. Documents hit 6.6% engagement.
6. **LI-10.5 anti-announcement.** Reframe every launch as a "thinking-process" post per linkedin.md § 4. "Excited to announce" → rewrite.
7. **LI-10.6 engagement-bait closer ban.** No "Agree?" / "What do you think?" / "Like if this resonates."
8. **LI-10.7 follower-flip.** IF `followerCount < 500` THEN 1 original post/week + 30 min/day comment-mining on large-account niche posts.
9. **LI-10.8 comment-mining freshness.** Comment targets must be <2 hours old.
10. **LI-10.9 newsletter gate.** Only if operator already writes long-form monthly+ elsewhere.
11. **LI-10.11 60-day reweight.** IF leads but zero conversions at 60 days AND runway <6 months THEN `reweightToFasterChannel: true`.
12. **LI-10.14 link-in-first-comment.** Any draft URL moves to first comment.

## Output schema

```ts
interface LinkedInFitReport {
  fit: "primary" | "secondary" | "secondary_with_caveat" | "park";
  refusalReason?: string;
  acvBandCheck: { band: string; passes: boolean };
  writingStyleCheck: { capableOfLongForm: boolean; evidence: string };
  recommendedLaunchShape?: {
    format: "doc_carousel_10_slide_plus_400w_caption";
    caption: { type: "personal_narrative"; openingPattern: string };
    cta: "link_in_first_comment";
    nativeVideoOption: boolean;
  };
  commentTargets: Array<{
    postUrl: string;
    authorHandle: string;
    authorFollowers: number;
    postAgeMinutes: number;
    excerpt: string;
    suggestedCommentDraft: string;
  }>;
  postingCadence: { originalPostsPerWeek: number; commentMiningMinPerDay: number };
  rulesCited: string[];
  reweightFlag?: boolean;
}
```

## Failure modes

- **Operator insists LinkedIn for consumer app.** `fit: "park"` + cited refusal + one-sentence alternative. Document override but don't silently comply.
- **No comment targets fresh enough.** Empty list + recommend different posting time (8-10 AM operator-tz weekdays).
- **ScrapeCreators LinkedIn endpoints fail.** Try `/v1/linkedin/company` + `/v1/linkedin/company/posts`. If both fail, downgrade to `fit: "secondary_with_caveat"`.

## Cost discipline

Max 4 ScrapeCreators calls. 1-2 WebFetches. 1 main_maya call. Timeout 12 min.

## Anti-slop check

LinkedIn is the slop epicenter. Every `suggestedCommentDraft` and `caption.openingPattern` MUST pass `maya-slop-critic` with LinkedIn-specific bans (linkedin.md § 9): no broetry overuse, no "thrilled/excited/honored", no tagged-friend humblebrag, no engagement-bait closers, no AI-emoji bullet lists.
