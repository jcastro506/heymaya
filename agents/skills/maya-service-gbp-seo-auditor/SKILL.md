---
name: maya-service-gbp-seo-auditor
version: 0.1.0-waveC6
description: GBP local-pack SEO auditor. Maya looks at the operator's GBP profile + posting history + reviews + named competitors + memory-wiki learnings holistically, judges whether they're winning the local 3-pack, scores 0-100 with reasoning, and queues 1-3 prioritized nudges. JUDGMENT-DRIVEN, not threshold-rule-driven.
when-to-use: Cron-driven via prose inside `morning_brief` (daily) and `competitor_watch` (weekly). On-demand when operator asks "how's my Google ranking?" or "what should I fix on Google?".
plan-tier: all (the auditor directly drives jobs + 5-stars — gating off self-defeating per north star).
model-routing: Gemini 3 Flash MEDIUM thinking. Multi-document grounding + nuanced judgment without the HIGH cost of business-picture synthesis. Per § 3 routing matrix.
---

# maya-service-gbp-seo-auditor

## Purpose — pull the operator into the local 3-pack, by judgment not by rules

Per `project_north_star_outcomes.md`: **the GBP local 3-pack is the highest-converting surface for home-services**. In the pack = calls. Out = invisible. Maya is, structurally, a GBP local-SEO expert.

Per the operator's 2026-04-27 directive: **no hardcoded thresholds**. Hardcoded rules calcify wrong (industry shifts; per-business patterns differ; copying Birdeye-shape products is not our differentiator). What works for THIS business is what Maya *learns* from outcomes via memory-wiki + dreaming. The auditor's job is to look at the picture holistically and judge.

## What Maya looks at

The orchestrator hands the auditor a bundle:

1. **Own GBP profile** — primary + secondary categories, services list, hours (incl. holiday), Q&A (total + unanswered), photos (counts + recency), attributes, products if present.
2. **Recent posts** — text + posted-at + engagement metrics (Insights polling result; calls / directions / website clicks / views per post).
3. **Recent reviews** — last 30 days, star rating, body, replyStatus.
4. **Named competitors** (from `businessPicture.localPositioning.namedCompetitors`) — each with their own profile + recent posts + review velocity + star rating.
5. **GBP Insights** — call/direction/message totals trailing 30d.
6. **Wiki pages** — `concepts/what-works/gbp/*` (from Wave C.5 learnings extractor). When non-empty, these encode "for THIS business, posts framed as X drove jobs Y times" with provenance. Maya's judgment on each nudge weights against these proven-for-this-operator patterns.
7. **Vertical context** — Maya's general knowledge of the operator's trade ("HVAC operators tend to post 2× weekly in winter; landscapers go quieter Nov-Mar"). This is **knowledge**, not a hardcoded threshold — see AGENTS.md GBP SEO section.

## Maya's judgment task

She produces:

- A **score 0-100** on local-pack health for THIS business at THIS moment. Higher = healthier. Not a formula — her read.
- A **reasoning sentence** (≤500 chars) explaining the score: "you're behind Joe's HVAC on review velocity and your last post was 11 days ago, but your 4.8★ + responsive replies are working in your favor." Cited, not generic.
- **1-3 prioritized nudges** — specific moves the operator (or Maya herself, via downstream skills) can take. Each nudge cites a competitor or a wiki-learned pattern when relevant.

The **score, reasoning, and nudge count** persist as a `gbpHealthScores` row. The HQ Growth tab (Wave C.7) shows score + reasoning verbatim — the operator sees the "why," not a breakdown of fake-precision sub-metrics.

## The 8 ranking-input lenses (for Maya's REASONING, not for thresholds)

Maya considers all of these holistically. None of them is a rule. She decides which ones matter most for THIS business right now:

1. **Reviews** — quantity + recency + rating (5-star bias).
2. **Profile completeness** — services, hours (incl. holiday), photos, posts, attributes, products, Q&A.
3. **Posting cadence** — fresh GBP posts.
4. **Photo cadence + quality** — Google rewards new photos.
5. **Categories** — primary match + secondary.
6. **Engagement signals** — reviews replied to, Q&A answered.
7. **Behavior signals** — clicks, calls, direction requests (loop-back ranking input).
8. **NAP / citations** — name/address/phone consistency. Lower priority for v0 (no aggregator integration here).

## Inputs (orchestrator → skill)

```ts
{
  business: {
    businessId: Id<"businesses">;
    serviceTypes: ReadonlyArray<string>;
    nameForOperator: string;                    // "Mike", "Sarah", etc.
  };
  ownProfile: {
    primaryCategory: string | null;
    secondaryCategories: ReadonlyArray<string>;
    hoursDescribed: boolean;
    sundayHoursSet: boolean;
    holidayHoursSet: boolean;
    servicesList: ReadonlyArray<string>;
    qAndA: { totalQuestions: number; unansweredQuestions: number };
    primaryPhotosSet: boolean;
    photoCount: number;
    daysSinceLatestPhoto: number | null;
    starRating: number | null;
    reviewCount: number | null;
  };
  recentPosts: ReadonlyArray<{
    postedAtIsoDate: string;
    text: string;
    callsClicked?: number;
    directionsClicked?: number;
    websiteClicked?: number;
    postViews?: number;
  }>;
  recentReviews: ReadonlyArray<{
    receivedAtIsoDate: string;
    starRating: number;
    bodyExcerpt: string;
    replied: boolean;
  }>;
  competitors: ReadonlyArray<{
    name: string;                                // verified vs localPositioning
    primaryCategory: string | null;
    servicesList: ReadonlyArray<string>;
    recentPostsCount30d: number;
    starRating: number | null;
    reviewCount: number | null;
  }>;
  insightsTotals: {
    calls30d: number;
    directions30d: number;
    messages30d: number;
  };
  /** Memory-wiki concepts/what-works/gbp/*.md content — what Maya has
   * learned drives outcomes for THIS business. Empty for new operators. */
  wikiLearnings: ReadonlyArray<{
    vaultPath: string;
    claim: string;
    sampleSize: number;
    jobsAttributed: number;
    fiveStarsAttributed: number;
  }>;
}
```

## Outputs

```ts
{
  score: number;                                 // 0-100, Maya's judgment
  reasoning: string;                             // ≤500 chars, cited
  nudges: ReadonlyArray<{
    headline: string;                            // ≤80 chars
    body: string;                                // 2-4 lines, cited
    suggestedAction: "operator-fix" | "maya-draft" | "maya-queue";
    rationale: string;                           // why this nudge ranked
  }>;
}
```

## Memory-wiki integration (§ 9.5)

- **Pre-judgment**: `wiki_get("concepts/what-works/gbp/*")` for outcome-attributed weights. When the wiki says "Friday-freeze hooks drove 3 jobs over 4 weeks," Maya weights that pattern higher than her generic prior. Empty wiki = Maya falls back to general trade knowledge from AGENTS.md.
- **Post-output (non-blocking)**: when a nudge is operator-approved AND results in a measurable outcome (job booked / 5-star tied to the change via Wave C.5 attribution), the learnings extractor promotes the pattern. This loop is what makes Maya **smarter about THIS business over time** (competitive moat #4).
- **Phantom-nudge guard**: a nudge that cites a competitor must reference a name from the verified set the orchestrator passes in (sourced from `localPositioning.namedCompetitors`). Names not in that set are dropped before drafting.

## Hard rules (the small set that genuinely IS a rule)

These are NOT thresholds — they are policy / safety / brand-quality bars that the LLM cannot reason around:

- **Never invent competitor data.** If the orchestrator's competitor bundle is empty, the auditor produces a competitor-free output. No web search inside the skill.
- **Never invent service-list gaps.** "Your competitor offers X, you don't" requires X to actually appear in the competitor's `servicesList` (caller-supplied, structured).
- **Never recommend Google-policy-violating tactics.** Keyword-stuffed business names ("Lincoln HVAC | Lincoln HVAC repair"), fake reviews, soliciting from non-customers — auto-rejected by the body-policy scrub regardless of LLM intent.
- **Cap at 3 nudges per audit run.** Operator attention is scarce.
- **Citation firewall integration**: every nudge body passes through `maya-service-citation-firewall` before queueing.

Beyond these, everything else is Maya's judgment. No "if cadence < N then nudge"; she decides.

## Suggested action semantics

- `"operator-fix"` — Maya cannot do this herself (add service, set hours, claim category). Queue as a chat task asking the operator to take 30 seconds in the GBP dashboard.
- `"maya-draft"` — Maya can draft + queue for approval (answer pending Q&A, draft a GBP post from the unused content library). Routes to the matching downstream skill.
- `"maya-queue"` — Maya can directly enqueue the next-step skill (trigger `gbp-post-optimizer` for unused photos when she judges cadence is light; trigger `review-request-drafter` for matched recent jobs when she judges velocity is below what worked before).

## Drought drafting — folded in (no separate watcher file)

Per the 2026-04-27 directive, there is no `contentDroughtWatcher.ts` thresh­hold function. When Maya judges that posting cadence is light relative to what's been working for THIS business, one of her nudges is a `"maya-queue"` action that triggers `mediaAssets.listAssets` + `gbp-post-optimizer` for 1-3 unused good-quality photos and queues the drafts. The trigger is HER judgment, not an `if` statement.

## Plan-tier

All tiers. The auditor's role is unblocking jobs + reviews — gating off would ship the product backwards.

## Test categories

1. **Cross-tenant** — script is pure; cross-tenant enforced at orchestrator (caller passes verified competitor names).
2. **Plan-tier** — runs at every tier; outputs do NOT mention tier upgrades.
3. **Adversarial** — empty competitor list, prompt-injection in competitor names, malicious LLM output (keyword stuffing, fake-review solicitation), all-target-met state, malformed wiki weights.
4. **Citation firewall integration** — generic phrasings would fail; specific phrasings pass.
5. **Sibling-file scan** — wiki-integration test allowlist updated; the auditor is referenced from prose in `morning_brief` + `competitor_watch` standing orders (no new entry; array length stays at 15).
6. **GBP audit accuracy on fixture profiles** — Maya-shaped (low cadence) and Sarah-shaped (good cadence + competitor service-list gap) produce expected output structures (we test the orchestration + safety scrub, NOT exact prose).

## Sibling files

- Calls: `maya-service-citation-firewall` (mandatory pre-queue), `maya-service-gbp-post-optimizer` (downstream when Maya queues drought drafts).
- Writes: `gbpHealthScores` row (score + reasoning + nudge count); `mayaTaskQueue` rows with `kind="gbp.seo.nudge"`.
- Reads: `wiki_get("concepts/what-works/gbp/*")` per kind; recent `gbpPosts` + `reviews` + `mediaAssets` + competitor data via the orchestrator.
- Standing orders: Folded into `morning_brief` prose (daily push) and `competitor_watch` prose (weekly digest). NOT a new standing-order entry — array length stays at 15 per Wave C.5 precedent.
