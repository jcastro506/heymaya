---
name: maya-reddit-demand-researcher
description: Find Reddit demand for the product's pain — score evidence, identify reply targets, return promotion-risk score. Budget-bounded.
---

# maya-reddit-demand-researcher

## Purpose

Reddit is the highest-conversion buyer-intent channel for indie products IF the operator is a real participant. This skill finds threads expressing the pain, subreddits where the buyer hangs out, reply-mining opportunities, and a hard risk score for the operator's account state. It refuses to recommend Reddit when warmup math doesn't work.

## When to invoke

- IF channel-judge is considering Reddit (primary or secondary) THEN run.
- IF `icpHypotheses[].locatableOn.channel === "reddit"` THEN run.
- IF the operator says "let me post on Reddit" THEN run BEFORE drafting.
- IF a results-reviewer flags a Reddit post got removed THEN re-run to find a different sub.
- NEVER from heartbeat. Each invocation spends up to 8 ScrapeCreators calls.

## Required reads

1. `APP.md`, `GTM.md`.
2. PLAYBOOK.md § 1, § 3 (channel tree steps 4-7), § 4 (BUILD/ENGAGE/OFFER — Reddit is 10/80/10).
3. **playbook/reddit.md — MANDATORY full read.** Every decision must trace to a numbered rule in § 8.
4. MEMORY.md for prior Reddit attempts.

## Decision rules

1. **Warmup gate (reddit.md § 8.1).** IF `operator.reddit.accountAgeDays < 30` OR no recent comment history THEN return `recommendation: "warmup_first"`. No reply targets surfaced.
2. **Karma floor (§ 8.2).** IF karma in best-fit niche sub < 10 THEN add precondition: "5-10 helpful comments in {sub} first."
3. **Domain age check (§ 8.14).** IF `app.domain` < 30 days old THEN `domainRiskElevated: true`.
4. **Subreddit selection.** 2-3 candidate subs per ICP. From reddit.md § 1 or niche subs the founder already participates in. NEVER recommend r/marketing, r/programming, r/technology, r/AskReddit for product mention (§ 8.12).
5. **Funnel-stage tagging.** Awareness / consideration / decision per reddit.md § 1. Decision-stage subs (r/Notion, r/Obsidian) are reply-only.
6. **The 5-thread floor.** A sub is only worth recommending if ≥5 buyer-intent threads in last 60 days.
7. **Reply-target quality bar.** Threads (a) <7 days old, (b) OP asked a pain-related question, (c) product is a credible answer within 1 degree of fit. § 4 + § 8.10.
8. **r/SaaS 60-day clock.** IF recommending r/SaaS main-feed THEN flag the cost and recommend weekly feedback thread unless operator's narrative is unusually strong.
9. **r/IndieHackers SHOW IH one-shot.** Only if `app.stage === "shipped"` AND operator has a metric/testimonial.
10. **Live-product check (§ 8.9).** IF `app.stage === "pre-launch"` AND only waitlist exists THEN remove r/SideProject from candidates. Substitute r/AlphaAndBetaUsers.
11. **Cross-post block (§ 8.7).** No same post in >2 subs in a week. Rewrite each for sub culture or stage 7+ days apart.
12. **First-comment URL rule (§ 8.8).** For r/SaaS / r/startups / r/Entrepreneur, URL goes in the first comment, not the post body.

## Output schema

```ts
interface RedditDemandReport {
  recommendation: "go" | "warmup_first" | "park";
  warmupPlanWeeks?: number;
  warmupActions?: string[];
  candidateSubs: Array<{
    name: string;
    funnelStage: "awareness" | "consideration" | "decision";
    rationale: string;
    rulesCited: string[];
    karmaRequired: number | "unstated";
    postFreqCap: string;
    flairRequired: string | null;
    evidenceThreadCount: number;
  }>;
  evidenceCards: Array<{ threadUrl: string; sub: string; title: string; upvotes: number; ageHours: number; painSnippet: string; productFit: "direct" | "adjacent" | "weak" }>;
  replyTargets: Array<{
    threadUrl: string;
    sub: string;
    opQuestion: string;
    suggestedFramework: "been-there-done-that" | "counterintuitive" | "tactical-playbook" | "tool-neutral-recommendation" | "quiet-authority";
    mentionRecommended: boolean;
  }>;
  promotionRiskScore: 0 | 1 | 2 | 3 | 4 | 5;
  riskFlags: string[];
  domainRiskElevated: boolean;
  parkReasons?: string[];
}
```

## Failure modes

- **No evidence threads found.** Park. Surface to channel-judge.
- **All candidate subs are decision-stage.** Return `replyTargets` only, `recommendation: "go"` constrained to reply-only.
- **ScrapeCreators Reddit endpoint fails.** Return HTTP status; do NOT degrade to training-data recommendations.
- **Domain blacklist detected.** `domainBlacklisted: true` + recommend domain change (reddit.md § 6).

## Cost discipline

Max 8 ScrapeCreators calls: 3 × subreddit/search, 2 × general search, 2 × subreddit details, 1 reserve. 1 main_maya synthesis. Timeout 20 min.

## Anti-slop check

`painSnippet` and `opQuestion` are VERBATIM from Reddit. Do not paraphrase. Quote and link.
