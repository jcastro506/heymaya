---
name: maya-service-learnings-extractor
version: 0.1.0-waveC5
description: Weekly outcome-attributed pattern extractor. Reads the prior 7d outcome chain (gbpPosts.engagementMetrics → inboundLeads.originatingActionId → serviceJobs.originatingLeadId, plus reviewRequests.responseRating) and synthesizes "what worked" patterns ranked by JOBS BOOKED + 5-STAR REVIEWS produced. Writes memory-wiki concepts/what-works/<platform>/* pages and a `weeklyLearnings` row.
when-to-use: Sundays 10pm op-tz — invoked from prose inside the existing `competitor_watch` standing order (Sun 9am) and `revenue_snapshot` standing order (Mon 9am). Maya runs the extractor BETWEEN those two orders, so Monday's brief carries the prior week's learnings. Also on-demand via `runLearningsExtractor` action when operator asks "what did you learn this week?"
plan-tier: all (the moat — gating off is self-defeating; tier gating happens at HQ read-surface in Wave C.7).
model-routing: Gemini 3 Flash MEDIUM thinking. Per § 3 routing matrix — multi-document grounding without the HIGH cost of business-picture synthesis. Outcome data is structured numerics + short text spans; MEDIUM is sufficient.
---

# maya-service-learnings-extractor

## Purpose — outcome-attributed personalization

This is the only skill whose direct job is to make Maya **smarter about THIS specific business over time**. Per `project_competitive_differentiation.md`, "learns YOUR business" is competitive moat #4. Per `project_north_star_outcomes.md`, the only valid frame for "smarter" is **more jobs and more 5-star reviews**.

So this skill reads the chain of evidence written by the rest of the system —

```
Maya did X (gbp-post / review-request / lead-nudge / review-reply)
    │
    ▼
inboundLeads.originatingActionId  (Wave C.5 attribution.ts wired this)
    │
    ▼
serviceJobs.originatingLeadId     (Wave C.5 attribution.ts wired this)
    │
    ▼
reviewRequests.responseRating     (Wave C.5 attribution.ts wired this)
```

— and synthesizes patterns. NOT aesthetic patterns ("this post had nice photography"); **outcome-attributed patterns** ("posts framed as 'Friday freeze warning — pre-book pipe insulation' drove 4× the calls of generic posts in your service area, sample size 6").

## Inputs

```ts
{
  businessId: Id<"businesses">;
  weekStartMs: number;                  // inclusive
  weekEndMs: number;                    // exclusive
  /** Prior week (or trailing 4 weeks rollup) for diffing. */
  priorWindowStartMs: number;
  priorWindowEndMs: number;
  /** All gbpPosts in the window with engagementMetrics resolved. */
  posts: Array<{
    id: string;
    text: string;
    postedAt: number;
    engagementMetrics: {
      callsClicked: number;
      directionsClicked: number;
      websiteClicked: number;
      postViews: number;
    } | null;
    attributedLeadIds: string[];
    /** Local-hook the post claimed — feeds hook-text patterns. */
    localHookText?: string;
  }>;
  /** All inboundLeads in the window. */
  leads: Array<{
    id: string;
    capturedAt: number;
    source: string;
    originatingActionKind?:
      | "gbp-post" | "lead-nudge" | "review-request"
      | "review-reply" | "none";
    originatingActionId?: string;
    convertedJobId?: string;
    responseLatencyMs?: number;
  }>;
  /** All serviceJobs created in the window. */
  jobs: Array<{
    id: string;
    completedAt?: number;
    originatingLeadId?: string;
    serviceType?: string;
  }>;
  /** All review-requests + reviews chained. */
  reviewRequests: Array<{
    id: string;
    sentAt?: number;
    channel: "sms" | "email";
    responseRating?: number;     // 1-5; undefined if no review yet
    responseAt?: number;
  }>;
}
```

## Outputs

```ts
{
  topPatterns: Array<{
    kind: "hook-text" | "photo-style" | "time-of-day" | "response-latency"
        | "review-request-channel" | "review-reply-tone" | "local-hook";
    claim: string;                     // one-sentence, grounded
    sampleSize: number;                // ≥3 ALWAYS — phantom-pattern guard
    jobsAttributed: number;
    fiveStarsAttributed: number;
    confidence: number;                // 0..1
    wikiVaultPath: string;             // e.g. "concepts/what-works/gbp/local-hook-friday-freeze"
  }>;
  priorWeekDelta: {
    jobsAttributedDelta: number;
    fiveStarsAttributedDelta: number;
    newPatternCount: number;
    droppedPatternCount: number;
  } | null;
  /** Pages to apply via wiki_apply. */
  wikiApplies: Array<{
    vaultPath: string;
    kind: "concept";
    claim: string;
    provenance: Array<{ sourceId: string; path: string; weight?: number; note?: string }>;
    confidence: number;
  }>;
}
```

## Hard rules (the firewall is in this skill, not citation-firewall)

1. **Phantom-pattern guard.** Refuse to emit any pattern with `sampleSize < 3`. Sample size = the count of distinct attributed outcomes, NOT the count of posts examined. The test fixture verifies a 2-sample observation produces ZERO patterns.
2. **Outcome attribution required.** Every `claim` text MUST reference at least one of: jobs booked count, 5-star reviews count, calls clicked count, leads attributed count. Aesthetic claims ("nice photography") fail.
3. **Same-tenant only.** Inputs MUST already be `businessId`-filtered by the caller (`runLearningsExtractor.ts` enforces). Outputs only describe THIS business's chain — never compare to other operators (no cross-tenant leakage path).
4. **Provenance non-empty.** Every `wikiApplies[].provenance` array has ≥1 entry pointing to a concrete row id (post id, lead id, review id) — non-report wiki pages without provenance fail the citation firewall on apply (see `convex/wikiProjections.ts` `validateProvenance`).
5. **Conservative confidence calibration.** Sample size 3 → max confidence 0.5; sample size 6 → max 0.7; sample size 10+ → max 0.9. Never 1.0 (no claim is certain in v0).

## Memory-wiki integration (§ 9.5 north-star application)

Per `docs/SPRINT_PLAN_SERVICE_V0.md` § 9.5, the wiki has a `concepts/` section. We write patterns into `concepts/what-works/<platform>/<slug>` where `<platform>` is `gbp` | `fb` | `ig` | `cross` and `<slug>` is the kebab-cased pattern identifier (e.g. `local-hook-friday-freeze` or `time-of-day-mon-9am`).

The wiki page format (rendered by the Fly-side memory-wiki plugin):

```yaml
---
kind: concept
claim: "<the claim text>"
confidence: <0..1>
provenance:
  - sourceId: gbpPost:<id>
    path: outcomes-2026-w17
    note: "drove 3 calls + 1 booked job"
  - sourceId: serviceJob:<id>
    path: outcomes-2026-w17
    note: "completed; 5-star review followed"
---
```

Calls inherit MEDIUM thinking; the wiki tools themselves are local plugin calls (no LLM cost).

## Anti-overfitting note

Patterns are valid for THIS BUSINESS only. We never promote "Friday freeze posts work for HVAC operators" — only "Friday freeze posts have worked for THIS operator (sample 4 weeks, jobs attributed 6)". Cross-business synthesis lives in Phase 2 once we have a defensible privacy story.

## Plan-tier

All tiers. The learnings ARE the moat — gating them off is self-defeating. Read-surfacing in HQ (Wave C.7's Growth tab) varies by tier per § 12.

## Test categories (5 mandatory + outcome-specific)

- **Cross-tenant**: Business A's posts/leads/reviews never appear in Business B's pattern fixture.
- **Plan-tier × action**: extractor runs at all tiers; output identical regardless of `business.planTier`.
- **Adversarial**:
  - Replay (idempotent re-extraction of same week → same `weeklyLearnings` row, no duplicates).
  - Empty week (no posts, no leads) → returns `{ topPatterns: [], priorWeekDelta: null, wikiApplies: [] }` cleanly, no LLM call.
  - Phantom-pattern guard: synthetic fixture with 2 samples never emits a pattern.
- **Sibling-file scan**: this skill folder exists at `agents/skills/maya-service-learnings-extractor/` with SKILL.md + script.ts + __tests__/. The skill is a TOOL (no own standing order) — invocation lives inside `competitor_watch` + `revenue_snapshot` standing-order prose.
- **TODO grep**: clean.
- **Outcome-specific**:
  - Attribution chain integrity: a fixture where lead A → post X and job Y → lead A produces a pattern that mentions both X and Y by id.
  - **Acceptance metric**: an 8-week synthetic timeline shows `weeklyLearnings.priorWeekDelta.jobsAttributedDelta` increasing week-over-week (Maya is getting smarter at THIS business). The fixture is hand-built so this is mechanically true — the test asserts the extractor RECOGNIZES it.

## Sibling files

- Standing orders that REFERENCE this skill (no dedicated SO; embedded in prose):
  - `competitor_watch` (Sundays 9am op-tz) — its prose includes "after the competitor digest, kick off the learnings extractor for the closing 7d window"
  - `revenue_snapshot` (Mondays 9am op-tz) — its prose includes "incorporate the prior week's `weeklyLearnings.topPatterns` into the snapshot context"
- Convex action: `convex/agents/packs/maya_service/runLearningsExtractor.ts` (the orchestrator).
- Reads from: `gbpPosts.engagementMetrics` (gbpInsightsPoller writes), `inboundLeads.originatingActionId` (attribution.ts writes), `serviceJobs.originatingLeadId` (attribution.ts writes), `reviewRequests.responseRating` (attribution.ts writes).
- Writes to: `weeklyLearnings` (Convex) + memory-wiki vault under `concepts/what-works/*` via `wiki_apply` (proxied through `wikiProjections.applyProjection` for HQ reactivity).
