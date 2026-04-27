/**
 * generateDreamingMd — guidance prose for the 3am dreaming sweep.
 *
 * Sprint 3.7 phase A. Per OpenClaw spec, the `memory-core` plugin runs the
 * Light → REM → Deep dream sweep that promotes WORKING.md learnings into
 * MEMORY.md. We do not run dream loops in Convex; we just author the
 * guidance prose Maya consults during the sweep.
 *
 * Pure, deterministic, shared across creators. The prose tells Maya what
 * to promote, what to demote, and what to avoid speculating about — same
 * for every Maya, since dream discipline is universal.
 */

export function generateDreamingMd(): string {
  return [
    "# DREAMING.md",
    "",
    "Guidance for the nightly dreaming sweep. The `memory-core` plugin runs Light → REM → Deep at ~3am local. This file tells Maya what to promote, demote, and avoid during that sweep. The sweep mutates `MEMORY.md` in place using the section anchors there as deterministic edit targets.",
    "",
    "## Promote",
    "",
    "- **Newly-detected hook patterns.** If the past 24-72h surfaced a hook pattern via `maya-hook-extractor` that matches at least 2 top-performing posts, append it to `MEMORY.md > Voice anchors` with a citation to the source posts.",
    "- **Audience shifts.** If audience demographics (age range, top geo, interest tag) shifted by ≥10% in the last 30-day rolling window, update `MEMORY.md > Audience anchors` with the new top-3 interest tags and note the shift date.",
    "- **Brand-deal posture changes.** If the creator declined a brand category twice in a row, add the category to `MEMORY.md > Brand-deal posture > Categories the creator declines outright`.",
    "- **Voice fingerprint refinements.** If `maya-voice-applier` consistently rewrote drafts toward a specific signature phrase or sentence shape over the past week, promote that as a voice anchor.",
    "",
    "## Demote",
    "",
    "- **Contradicted learnings.** If a memory claim is contradicted by 2+ newer data points (e.g. 'audience indexes 2× on Sunday' but the last 6 Sundays underperformed), strike the old claim and replace with the new pattern.",
    "- **Stale brand-deal data.** Brand-deal floor or category preferences older than 90 days that the creator has explicitly revised in chat or Profile — replace with the new value.",
    "- **Closed commitments.** Move resolved entries out of `MEMORY.md > Open commitments`. The follow-through evidence (post URL, contract signed, etc.) lives in the `commitments` table; MEMORY.md only tracks open ones.",
    "",
    "## Do not speculate",
    "",
    "- **No 1-data-point patterns.** A single viral post is anecdote, not pattern. Wait for 2+ confirming data points before promoting.",
    "- **No inferred preferences.** If the creator has not stated a preference in chat / onboarding / Profile, do not infer one from behavior. Inferences belong in `WORKING.md` as hypotheses; MEMORY.md is for confirmed facts.",
    "- **No speculative goals.** Long-term goals come from the creator's onboarding answers and Profile updates. Do not invent goals from posting patterns.",
    "- **No tone drift.** Voice anchors must cite source posts. If a candidate phrase comes from a single chat exchange with the creator (not from their published voice), do not promote.",
    "",
    "## Sweep discipline",
    "",
    "Each dream pass writes a `<!-- promoted_at: ${unix_ms} -->` comment alongside any new MEMORY.md entry, so we can audit promotion history and roll back regressions. Removed entries are commented out, not deleted, until 30 days have passed (then garbage-collected by the operator dashboard).",
    "",
  ].join("\n");
}
