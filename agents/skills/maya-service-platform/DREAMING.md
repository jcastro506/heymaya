# DREAMING.md — shared service-platform template

Guidance for the nightly dreaming sweep. The `memory-core` plugin runs Light → REM → Deep at ~3am op-tz. This file tells Maya what to promote, demote, and avoid during the sweep. Same for every Maya — dream discipline is universal.

## Promote

- **Operator voice fingerprint refinements.** If `maya-service-brand-voice-applier` consistently rewrote drafts toward a specific signature phrase or sign-off over the past 7 days, promote to `MEMORY.md > Voice anchors` with citations.
- **Local positioning updates.** New named neighborhoods, new local hooks, new named competitors surfaced in operator chat or onboarding refinements.
- **Customer sentiment patterns.** Recurring praise or complaint pattern (>3 reviews in 30d on the same theme).
- **Service-type domain priors.** New seasonal demand patterns confirmed by 2+ years of historical data.
- **Brand-safety preferences.** Operator's explicit "never quote pricing without me" or "always credit Carlos on installs" get permanently promoted.

## Demote

- **Contradicted patterns.** If the last 6 weeks contradict a memory claim, strike and replace.
- **Stale local positioning.** Closed competitors, dropped neighborhoods, ended local events.
- **Closed approval rules.** Toggled-off rules should not still appear as "auto-send is on" in MEMORY.md.

## Do not speculate

- **No 1-data-point patterns.** A single 5-star review is anecdote.
- **No inferred operator preferences.** Inferences live in `WORKING.md`; MEMORY.md is for confirmed facts.
- **No fabricated local hooks.** Recurring local hooks come from operator input or verified ScrapeCreators data — never from general knowledge of the city.
- **No tone drift.** Voice anchors must cite source posts/replies.
- **No customer name inference.** Customer names enter MEMORY.md only when sourced from `serviceCustomers`.

## Operator-voice consolidation rule

After 30 days of operator-approved drafts, lock the voice fingerprint to a stable signature based on the highest-engagement-rate posts (review replies that got customer responses, GBP posts with engagement, FB posts with comments) plus operator's manual edits to drafts. Subsequent dreams may refine, but no longer rewrite the core fingerprint without operator confirmation.

## Sweep discipline

Each dream pass writes a `<!-- promoted_at: ${unix_ms} -->` comment alongside any new MEMORY.md entry. Removed entries are commented out, not deleted, until 30 days have passed (then garbage-collected by the operator dashboard).
