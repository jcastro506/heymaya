/**
 * generateDreaming — shared DREAMING.md generator for service-product Maya.
 *
 * Mirror of creator-side `generateDreamingMd.ts`. Per OpenClaw spec, the
 * `memory-core` plugin runs Light → REM → Deep dream sweeps that promote
 * WORKING.md learnings into MEMORY.md. We do not run dream loops in
 * Convex; we just author the guidance prose Maya consults during the sweep.
 *
 * Per-service-type heuristics are referenced by name; the actual priors
 * live in `memorySeeds/<serviceType>.md` — DREAMING.md is the meta-guidance
 * for promotion / demotion / speculation rules, not the priors themselves.
 *
 * Pure, deterministic, shared across businesses. The prose is the same for
 * every Maya — dream discipline is universal.
 */

export function generateDreaming(): string {
  return [
    "# DREAMING.md",
    "",
    "Guidance for the nightly dreaming sweep. The `memory-core` plugin runs Light → REM → Deep at ~3am op-tz. This file tells Maya what to promote, demote, and avoid during the sweep. The sweep mutates `MEMORY.md` in place using the section anchors there as deterministic edit targets.",
    "",
    "## Promote",
    "",
    "- **Operator voice fingerprint refinements.** If `maya-service-brand-voice-applier` consistently rewrote drafts toward a specific signature phrase, sentence shape, or sign-off over the past 7 days, promote to `MEMORY.md > Voice anchors` with citations to source posts/replies.",
    "- **Local positioning updates.** New named neighborhoods, new local hooks, new named competitors surfaced in operator chat or onboarding refinements get promoted to `MEMORY.md > Local positioning`.",
    "- **Customer sentiment patterns.** If reviews surface a recurring praise or complaint pattern (>3 reviews in 30d on the same theme), promote to `MEMORY.md > Customer sentiment`.",
    "- **Service-type domain priors.** New seasonal demand patterns confirmed by 2+ years of historical `serviceJobs` data (e.g. 'June AC tune-up demand 3× March baseline for HVAC in zone 5b') graduate from heuristic to memory.",
    "- **Brand-safety preferences.** Operator's explicit 'never quote pricing without me' or 'always credit Carlos on installs' get promoted permanently.",
    "",
    "## Demote",
    "",
    "- **Contradicted patterns.** If the last 6 weeks contradict a 'reviews spike on Mondays' memory claim, strike and replace with the new pattern.",
    "- **Stale local positioning.** A named competitor that closed, a neighborhood the operator stopped serving, a local event no longer happening — remove with a `<!-- demoted_at: ${unix_ms} -->` comment.",
    "- **Closed approval rules.** If `approvalRules.review-request-auto-send` toggled OFF in the last week, demote any 'auto-send is on' notes from MEMORY.md.",
    "",
    "## Do not speculate",
    "",
    "- **No 1-data-point patterns.** A single 5-star review is anecdote, not pattern. A single missed lead is anecdote. Wait for 2+ confirming data points before promoting.",
    "- **No inferred operator preferences.** If the operator has not stated a preference in chat / onboarding / dashboard, do not infer one from behavior. Inferences live in `WORKING.md` as hypotheses; MEMORY.md is for confirmed facts.",
    "- **No fabricated local hooks.** Recurring local hooks in `localPositioning.recurringLocalHooks` come from operator input or verified ScrapeCreators data — never from Maya's general knowledge of the city.",
    "- **No tone drift.** Voice anchors must cite source posts/replies. A candidate phrase from a single chat exchange does not promote.",
    "- **No customer name inference.** Customer names enter MEMORY.md only when sourced from `serviceCustomers` — never from review text, never from operator chat unless explicitly confirmed.",
    "",
    "## Operator-voice consolidation rule",
    "",
    "After 30 days of operator-approved drafts, lock the voice fingerprint to a stable signature based on the highest-engagement-rate posts (review replies that got customer responses, GBP posts with engagement, FB posts with comments) plus operator's own manual edits to drafts. Subsequent dreams may refine, but no longer rewrite the core fingerprint without operator confirmation.",
    "",
    "## Sweep discipline",
    "",
    "Each dream pass writes a `<!-- promoted_at: ${unix_ms} -->` comment alongside any new MEMORY.md entry. Removed entries are commented out, not deleted, until 30 days have passed (then garbage-collected by the operator dashboard). Operators can review the dream log per-business in HQ → Profile → Memory.",
    "",
  ].join("\n");
}
