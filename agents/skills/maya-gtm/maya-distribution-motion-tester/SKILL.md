---
name: maya-distribution-motion-tester
description: Design first-week experiments per PLAYBOOK § 2 Phase 2 (5-piece soft-launch kit). Define stop/double-down metrics.
---

# maya-distribution-motion-tester

## Purpose

Soft launch is not 1 post — it's a 5-piece coordinated motion (PLAYBOOK § 2 Phase 2). This skill turns the channel-judge's verdict into concrete week-1 experiments with explicit stop / double-down thresholds.

## When to invoke

- IF `channelStrategyVerdict.primaryPhase === "phase_2"` AND no `distributionExperiments` THEN run.
- IF operator is moving from Phase 1 to Phase 2 (warmup done) THEN run.
- IF results-reviewer says "Week 1 experiments inconclusive" THEN re-run with sharper metrics.
- NEVER design Phase 3 hard launch from this skill alone.

## Required reads

1. APP.md, GTM.md.
2. **PLAYBOOK.md § 2 Phase 2 (5-piece kit), § 4, § 5 failure modes (especially Mode 5 post-and-pray).**
3. playbook/{primaryChannel}.md.
4. MEMORY.md.

## Decision rules

1. **All 5 pieces of soft-launch kit (PLAYBOOK § 2 Phase 2).** Thread/long-post + demo video + carousel/document + Reddit post + 5 reply opportunities. Don't ship until all 5 designed.
2. **5-piece designs are channel-aware.** For X-primary: thread = X thread, demo = native video tweet, carousel = X image carousel, Reddit post = secondary handoff, 5 replies = reply-mining seed.
3. **CTA cap.** No "Sign up now" in Phase 2. Soft asks only.
4. **Each experiment has a hypothesis.** "If X format hits >3% engagement-to-followers, that's the FMF candidate; if <1%, void-launch risk."
5. **Day-of-week timing.** No Mondays, Fridays, weekends (rule 9.17). Tuesday/Wednesday default.
6. **First-50-DM list seeded.** Even in Phase 2 (rule 9.7). Identify 50 candidate humans pre-launch.
7. **Reply-opportunity inventory.** Reuse `XResearchReport.replyTargets` / `RedditDemandReport.replyTargets`. Pre-identified, drafted, ready-to-post.
8. **Stop signal: engagement-to-followers <1%** (rule 9.8). Halt and reposition.
9. **Skip-launch signal: >70% engagement from other founders** (rule 9.9). Recommend channel change.
10. **Phase 2 success signal: 1+ unprompted "where can I try this?" reply OR DM from non-founder >100-follower account.**
11. **No paid amplification in Phase 2** (rule 9.21).
12. **Time-bounded experiment.** 7-day window per experiment. Threshold fires or doesn't by day 7.

## Output schema

```ts
interface DistributionExperimentSet {
  softLaunchKit: {
    threadOrLongPost: { channel: string; hypothesis: string; formatPatternId: string; successMetric: string; stopMetric: string; scheduledDay: "tue" | "wed"; scheduledTimeLocal: string; draftReadyByDate: string };
    demoVideo: { /* same shape */ };
    carouselOrDocument: { /* same shape */ };
    redditPost: { /* same shape, includes targetSub + warmupSatisfied check */ };
    fiveReplyOpportunities: Array<{ threadUrl: string; channel: string; draftReady: boolean }>;
  };
  first50DmList: { targetCount: number; seedSources: string[]; populatedCount: number; populatedBy: string };
  weeklySchedule: Array<{ day: string; activity: string; channelMode: "BUILD" | "ENGAGE" | "OFFER" }>;
  stopAndDoubleDownRules: Array<{ metric: string; threshold: string; action: "stop_and_reposition" | "switch_channel" | "double_down" | "continue_observing"; playbookRule: string }>;
  estimatedOperatorHoursPerDay: number;
  rulesCited: string[];
}
```

## Failure modes

- **5-piece kit cannot be designed.** `status: "missing_inputs"` with list.
- **Operator hours/day < required.** Phase 2 typical = 60-90 min/day. Below = recommend Phase 1 continuation or lower-hours channel.
- **No Reddit warmup satisfied AND Reddit in the kit.** Substitute different secondary-channel piece.

## Cost discipline

0 new ScrapeCreators / 0 WebFetches / 1 main_maya. Timeout 10 min.

## Anti-slop check

`hypothesis` strings and any draft fragments pass `maya-slop-critic`. Specifically banned in distribution-design: "iterate", "optimize", "leverage", "supercharge". Hypothesis should sound like a bet a real operator would make.
