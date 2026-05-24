---
name: maya-competitor-researcher
description: Find substitutes + what their users complain about. Sources: Reddit, X, App Store, G2, LinkedIn comments.
---

# maya-competitor-researcher

## Purpose

The operator's competitors are also their best lead sources. Users complaining about competitor X are pre-qualified buyers for product Y. This skill maps the substitute landscape, mines complaint patterns, and feeds reply-target candidates back to platform-specific researchers.

## When to invoke

- IF `productDiagnosis.competitorMentions[]` is non-empty OR can be inferred THEN run.
- IF `maya-icp-hypothesis` flagged `buyerSpecificityWeak: true` THEN run.
- IF reddit / x researchers need "alternative to X" reply targets THEN this skill seeds them.
- NEVER from heartbeat.

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 (competitor's channel = operator's channel), § 7 affinity.
3. Relevant playbook/{platform}.md files.
4. MEMORY.md.

## Decision rules

1. **Substitute > direct-competitor.** What the operator's user does TODAY (workaround) is more important than named competitors. Mine for workaround patterns ("I just use spreadsheets", "I do it manually", "I pay Fiverr").
2. **Three substitute tiers.** Direct (named SaaS) / Adjacent (different shape, same job) / Status-quo (Excel, paper, manual, do-nothing).
3. **Pain mining must cite the user verbatim.** Every complaint card has `userQuoteVerbatim` + `sourceUrl`. No paraphrasing.
4. **"Alternative to {competitor}" is highest-intent search probe.** Always include for top 1-2 competitors.
5. **Channel-segmented mining.** Reddit (subreddit reviews + r/SaaSAlternatives), X (frustration tweets + reply mining), App Store reviews (mobile), G2/Capterra/Trustpilot (B2B), LinkedIn comments on competitor posts.
6. **3-complaint floor.** A competitor is only "actionable" with ≥3 distinct complaint patterns. Below that = brand-mention, not buyer signal.
7. **Pricing-complaint surfacing.** "Too expensive" is the #1 switcher signal. Tag pricing complaints separately.
8. **Don't name competitors in operator drafts.** reddit.md rule 8.18. Reply drafts say "the dominant tool in this space" or describe the category.
9. **Substitute → ICP feedback loop.** If substitute is "spreadsheets", ICP includes "currently using spreadsheets" — pass to icp-hypothesis.
10. **No fabricated complaints.** If search returns thin, `confidence: "weak"`. No training-data filling.

## Output schema

```ts
interface CompetitorReport {
  substitutes: Array<{ name: string; tier: "direct_saas" | "adjacent_tool" | "status_quo_workaround"; pricingBand?: string; channelPresence: string[] }>;
  complaintPatterns: Array<{
    pattern: string;
    competitorName?: string;
    frequency: number;
    sampleCards: Array<{ sourceUrl: string; channel: "reddit" | "x" | "appstore" | "g2" | "linkedin" | "google_search"; userQuoteVerbatim: string; ageDays: number }>;
  }>;
  pricingComplaintCount: number;
  switcherSignals: Array<{ competitorName: string; queryProbe: string; threadsFound: number; samplePostUrls: string[] }>;
  workaroundsInUse: string[];
  recommendedReplyHandoffs: Array<{ channel: "reddit" | "x" | "linkedin"; threadUrl: string; handoffTo: string }>;
  icpRefinements: string[];
  confidence: "high" | "medium" | "weak";
}
```

## Failure modes

- **No competitors named, no substitutes detectable.** Run Google probe `"alternative to {productCategory}"`. If still empty, `categoryNoveltyHigh: true` — recommend HN/Show HN positioning.
- **ScrapeCreators returns zero across all channels.** Try broader category terms.
- **All complaints are 2+ years old.** Don't recommend reply targets from stale threads.

## Cost discipline

Max 10 ScrapeCreators calls: 2-3 Google search probes, 2-3 Reddit subreddit searches, 2 X searches, 1-2 LinkedIn company-posts. 2-3 WebFetches. 1 hard_research_beta + 1 main_maya. Timeout 18 min.

## Anti-slop check

User-quotes-verbatim. Slop-critic NOT invoked on output. Pattern summary labels must be plain operator-language — not "value misalignment" / "ROI concerns" / corporate-speak.
