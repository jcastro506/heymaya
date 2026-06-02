---
name: maya-calendar-plan-builder
description: DEPRECATED. Superseded by maya-calendar-populator. Do not invoke. Calendar event building (typed gtmCalendarEvents + warmup_block scheduling) is now owned end-to-end by maya-calendar-populator, which builds TODAY's turn-key plan day-by-day. This skill is retained only as a deprecation pointer to avoid two competing calendar builders.
---

# maya-calendar-plan-builder — DEPRECATED

> **Do not invoke this skill.** It is superseded by **`maya-calendar-populator`**. Keeping two calendar builders alive is exactly the failure mode the ideal-product plan warns against (two week-builders that drift apart). All calendar work routes through `maya-calendar-populator`.

## Why deprecated

There is no onboarding week and no rolling 7-day calendar artifact anymore. Planning is day-scoped and lives in two places only:

- **`maya-morning-brief` / the 7am `morning_brief` cron** — owns day-to-day planning. Every morning it reads stored ICP knowledge (`get_my_foundation`) + per-channel warmth (`channelWarmthJson`), intersects that with what's live on the bet channels, and emits TODAY's turn-key events.
- **`maya-calendar-populator`** — the skill that actually builds the typed `gtmCalendarEvents` for the day (one-tap `openUrl` + verbatim `draftText`, server-validated), maps each event to the operator's PLAYBOOK warmth phase, and gates warmup vs posting per channel.

This file used to convert approved drafts into a "week" of rich calendar events and schedule warmup `dayBands` across multiple future days. That responsibility is gone. A week-scoped builder running alongside a day-scoped populator produces conflicting calendars and stale plans.

## Where its responsibilities went

Everything this skill used to do now lives in `maya-calendar-populator/SKILL.md`:

| Old responsibility here | Now owned by |
| --- | --- |
| Build typed `gtmCalendarEvents` (kinds: `warmup_block` / `engagement_block` / `soft_launch_post` / `hard_launch_anchor` / `reply_window` / `weekly_review` / `first_50_dms`) | `maya-calendar-populator` (TODAY only, not a week) |
| Schedule warmup `dayBands` from a platform skill's `warmupPlan` | `maya-calendar-populator` § warmup — schedules ONLY today's warmup block, gated on `channelWarmthJson[channel].state` (not the old hardcoded `tiktokWarmupState`, and not a multi-day band sweep) |
| Day-of-week / channel time-window enforcement, holiday checks, one-CTA-per-event, asset attachment, reminders, approval-state title prefix | `maya-calendar-populator` (applied to allocating TODAY's events) |
| `openUrl` + `draftText` + `successTarget` + `sourceNote` turn-key payload + server-side turn-key validation | `maya-calendar-populator` + `convex/gtmMaya/calendarWrite.ts` (`persistGtmCalendarEventDraft` / `propose_calendar`) |
| Anti-slop on event titles/descriptions; voice-match gate before an event reaches the calendar | `maya-calendar-populator` + `maya-voice-matcher` + the `convex/gtmMaya/approvalPublishing.ts` voice/slop server guard |

Publishing remains `maya-approval-publisher`; never auto-publish from any calendar skill.

## If something still points here

Any skill, cron, or prompt that references `maya-calendar-plan-builder` should be updated to call `maya-calendar-populator` for today's plan. This stub exists so a stale reference fails loud (pointer to the live skill) rather than silently building a redundant week.
