---
name: maya-competitor-researcher
description: Find substitutes + what their users complain about. Sources: Reddit, X, App Store, G2, LinkedIn comments.
---

# maya-competitor-researcher

## Purpose

The operator's competitors are also their best lead sources. Users complaining about competitor X are pre-qualified buyers for product Y. This skill maps the substitute landscape, mines complaint patterns, ranks by switch-intent and complaint acuteness, and feeds reply-target candidates back to platform-specific researchers.

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
5. **Channel-segmented mining.** Social via the research tools — Reddit (subreddit reviews + r/SaaSAlternatives + dedicated product subreddits), X (frustration tweets + reply mining), LinkedIn comments on competitor posts. Open-web via **`search_web`** (run through **`maya-open-web-read`** — teardown checklist + 3-star-first review-mining + verbatim-quote-and-URL output) — read each top competitor's own pricing / positioning / changelog page (the wedge) + whatever Google surfaces of their reviews/objections. (Deep structured review mining of Trustpilot / App Store / Play lands later via `read_reviews`; G2/Capterra are anti-scraped — don't promise full coverage there.) For each source, mine RECENCY-sorted first — a complaint that appeared two weeks ago is far more actionable than the "helpful" review from 2021.
5b. **Ad intelligence — what they PAY to say (`competitor_ads`).** For each top competitor, call `competitor_ads({ query: "<brand>", domain: "<their-domain>" })` → their live Meta + Google ads. A long-running ad is a *proven* hook (the market keeps paying for it); a freshly-launched ad is a bet they're making; an absent channel is an opening. Extract the angle/offer/objection-handling and feed it to content-angles as "messaging the market already pays for" — Maya grounds the founder's ORGANIC posts in it, never copies verbatim. Also `bio_funnel({ url })` on a competitor's link-in-bio to map their funnel (lead magnet → pricing → community) in one call. This is the dossier upgrade — onboarding does the read; the monthly refresh catches new ads.
6. **Complaint-quality judgment over complaint count.** Don't gate on a fixed complaint count. Judge whether each complaint cluster carries acute switch-intent: does the user express urgency, frustration with a specific workflow blocker, or active searching for alternatives? A single acute complaint thread ("I'm evaluating switching right now") outranks many low-stakes gripes ("could be a bit nicer"). Rank patterns by acuteness + switch-intent, not raw volume.
7. **Complaint velocity / trend awareness.** For each pattern, judge whether the complaint is accelerating: same subreddit or product review page seeing increasing frequency month-over-month? Trend direction matters — a pain accelerating in recency-sorted reviews is a better fishing hole than a stable old complaint. Flag `trendDirection: "rising" | "stable" | "declining" | "unknown"` per pattern based on your best judgment of the evidence.
8. **Reddit comment-tree descent.** Never stop at the top-level post. Descend into comment trees: the most actionable quotes are usually in replies where the OP explains what they tried, what broke, and what they switched to. Descend at least 2 levels. If a comment thread is visibly long and the parent post is complaint-shaped, paginate / load more until you've read the branching path where alternatives are discussed.
9. **Pricing-complaint surfacing.** "Too expensive" is the #1 switcher signal. Tag pricing complaints separately. For pricing complaints also check whether recent price changes (plan restructuring, seat-pricing shifts) have triggered a spike — that is a time-bounded wedge window.
10. **Don't name competitors in operator drafts.** reddit.md rule 8.18. Reply drafts say "the dominant tool in this space" or describe the category.
11. **Substitute → ICP feedback loop.** If substitute is "spreadsheets", ICP includes "currently using spreadsheets" — pass to icp-hypothesis.
12. **Follow the substitute chain.** If the dominant substitute is a workaround tool (Notion, spreadsheets, Airtable), don't stop at the competitor. Also mine that workaround tool's own complaints in the same niche — those users are also switchable and may not know the operator's category exists. Each link in the chain is its own complaint source.
13. **Competitor sentiment direction.** For each named competitor, form a directional read: is their NPS/review trajectory improving or worsening? Product updates that remove features, pricing restructures that anger long-term users, or viral complaint threads are all signals that sentiment is trending negative — meaning the fishing hole is actively getting better. Document what you found that supports the direction call.
14. **No fabricated complaints.** If search returns thin, `confidence: "weak"`. No training-data filling.

## Output schema

```ts
interface CompetitorReport {
  substitutes: Array<{ name: string; tier: "direct_saas" | "adjacent_tool" | "status_quo_workaround"; pricingBand?: string; channelPresence: string[] }>;
  complaintPatterns: Array<{
    pattern: string;
    competitorName?: string;
    switchIntentRank: number;           // 1 = highest. LLM judgment of switch-intent + acuteness, not raw frequency
    acutenessNote: string;              // one-sentence judgment of why this pain is acute or switchable
    trendDirection: "rising" | "stable" | "declining" | "unknown";
    trendEvidence: string;              // what you actually saw that informed the direction call
    sampleCards: Array<{ sourceUrl: string; channel: "reddit" | "x" | "appstore" | "g2" | "linkedin" | "google_search"; userQuoteVerbatim: string; ageDays: number; commentDepth?: number }>;
  }>;
  pricingComplaintCount: number;
  pricingTrendNote?: string;            // any evidence of recent pricing changes that spiked complaints
  substituteChain: Array<{ toolName: string; tier: string; chainedFrom: string; complaintSummary: string; }>;
  switcherSignals: Array<{ competitorName: string; queryProbe: string; threadsFound: number; samplePostUrls: string[]; sentimentDirection: "worsening" | "stable" | "improving" | "unknown" }>;
  workaroundsInUse: string[];
  recommendedReplyHandoffs: Array<{ channel: "reddit" | "x" | "linkedin"; threadUrl: string; handoffTo: string }>;
  icpRefinements: string[];
  confidence: "high" | "medium" | "weak";
}
```

## Failure modes

- **No competitors named, no substitutes detectable.** Run Google probe `"alternative to {productCategory}"`. If still empty, `categoryNoveltyHigh: true` — recommend HN/Show HN positioning.
- **ScrapeCreators returns zero across all channels.** Try broader category terms.
- **All complaints are 2+ years old.** Don't recommend reply targets from stale threads. Flag `dataRecencyWeak: true` and note what the freshest evidence you could find was.
- **Complaint trees are shallow.** If Reddit threads have locked comments or low reply count, supplement with App Store / G2 recency-sorted reviews for depth.

## Cost discipline

Max 15 ScrapeCreators calls to allow for comment-tree depth and substitute-chain extension: 3-4 Reddit subreddit/post searches (including comment-tree fetches), 2 X searches, 1-2 LinkedIn company-posts, 1-2 substitute-chain tool searches. Plus **2-3 `search_web` reads** (competitor pricing/positioning pages + review snippets the open web surfaces) — cited, ~$0.04 each, log via log_cost. 1 main_maya synthesis. Timeout 22 min.

## Anti-slop check

User-quotes-verbatim. Slop-critic NOT invoked on output. Pattern summary labels must be plain operator-language — not "value misalignment" / "ROI concerns" / corporate-speak. `switchIntentRank` ordering must be defensible from the verbatim quotes attached, not from abstract judgment alone.
