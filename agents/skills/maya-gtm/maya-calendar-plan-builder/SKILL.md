---
name: maya-calendar-plan-builder
description: Convert approved drafts into rich Google Calendar events. Each event carries platform / script / hook / source links / assets / approval state / success metric.
---

# maya-calendar-plan-builder

## Purpose

Drafts aren't useful until they're scheduled with full context the operator can act on at posting time. Takes approved drafts + channel strategy + distribution motion plan and builds rich Google Calendar events (Sprint 9 calendar OAuth).

## When to invoke

- IF `distributionExperimentSet` is approved AND drafts have passed slop-critic THEN schedule.
- IF a post is replanned THEN re-run to update.
- IF a hard launch is scheduled (PLAYBOOK § 2 Phase 3) THEN build the full launch-day event sequence.
- IF results-reviewer recommends "double down on metric posts" THEN extend cadence.
- **Sprint 1.2 — IF a platform skill (maya-tiktok-demo-strategist § rule 3, maya-reddit-demand-researcher § rule 1, maya-x-founder-led-researcher) returns `recommendation: "warmup_first"` with a `warmupPlan`, THEN immediately schedule each `dayBands[].actions` as `kind: "warmup_block"` events on the operator's calendar.** Warmup blocks are self-driven operator tasks (not posts) — they are approval-by-default. Do NOT wait for slop-critic, drafts, or distribution-experiment approval. The operator needs these on their calendar today, not at the end of a multi-step approval loop.
- NEVER auto-publish — events are scheduling. Publishing is `maya-approval-publisher`.

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 2 (Phase 2/3 timing — Tuesday default, rule 9.17), § 4.
3. playbook/{channel}.md for channel-specific timing.
4. MEMORY.md.

## Decision rules

1. **Day-of-week enforcement (rule 9.17).** No Mon/Fri/weekend launch posts. Hard-launch default Tuesday; Phase 2 default Tue/Wed/Thu.
2. **Holiday / industry-event check.** Verify before scheduling (rule 2.3.1).
3. **Channel-specific time windows.**
   - X: Tue morning operator-tz, 8-10am.
   - LinkedIn: Tue-Thu 8-10am operator-tz.
   - Reddit: Tue/Wed/Thu 8-11am ET.
   - TikTok: niche-FYP-time from TikTokFormatResearch; default 6-9pm operator-tz B2C, 12-2pm B2B.
4. **2-hour engagement window required (Reddit).** Operator available 2h after posting. If booked, push.
5. **Pre-write first comment for Reddit posts.** Always attached.
6. **One CTA per event.**
7. **All assets attached / linked.** Screenshots, demo videos, alt-text. R2 URL or Drive link.
8. **Approval-state visible.** Title prefix: `[DRAFT]` / `[APPROVED]` / `[PUBLISHED]` / `[NEEDS REVISION]`.
9. **Success metric in event description.** Copy-paste from distribution-motion-tester.
10. **Stop / double-down trigger noted.**
11. **Native reminders.** 30 min before (push), 24h before (email).
12. **Sidecar gtmCalendarEvents row.** Every calendar write also writes a sidecar (kind: "warmup_block" | "engagement_block" | "soft_launch_post" | "hard_launch_anchor" | "reply_window" | "weekly_review" | "first_50_dms") for HEARTBEAT calendar-scan check.
13. **Sprint 1.2 — warmup_block scheduling rules.** When converting a `warmupPlan` from a platform skill:
    - One event per `dayBands` entry (NOT per action — group actions into a single block).
    - **Default time**: 10:00am operator-local. Operator can move it; the point is the block is on the calendar.
    - **Duration**: 30 min default for ≤4 actions, 45 min for 5+ actions.
    - **Title format**: `[Warmup] {Platform} Day N of M — {primary action}`. Example: `[Warmup] TikTok Day 1 of 14 — Scroll 20 min niche FYP`.
    - **Description**: full action list as a checklist + cite the playbook rule (`tiktok.md § 6` / `reddit.md § 6`). Example: `Per tiktok.md § 6 (account warm-up doctrine). Today: ☐ Scroll 20 min niche FYP at slow-thumb pace ☐ Like 10 niche posts ☐ Comment on 3 posts with substance ☐ Save 5 posts you'd actually use. Why: brand-new accounts that post commercial content on day 1 get algorithmically suppressed (tiktok.md § 13 Failure 1).`
    - **No slop-critic gate** — these are operator self-tasks, not public content.
    - **Reminders**: 30 min popup + 24h email (same as posts).
    - **Approval state**: `APPROVED` (warmup is the doctrine, not optional).

## Output schema

```ts
interface CalendarPlan {
  events: Array<{
    googleEventId?: string;
    sidecarRowId?: string;
    kind: "warmup_block" | "engagement_block" | "soft_launch_post" | "hard_launch_anchor" | "reply_window" | "weekly_review" | "first_50_dms";
    channel: string;
    titleWithApprovalPrefix: string;
    startLocal: string;
    durationMin: number;
    description: string;
    attachments: Array<{ kind: "image" | "video" | "doc"; url: string }>;
    draftText: string;
    sourceLinks: string[];
    successMetric: string;
    stopOrDoubleDownTrigger: string;
    reminders: { popupMin: number; emailMin: number };
    approvalState: "DRAFT" | "APPROVED" | "PUBLISHED" | "NEEDS REVISION";
    mode: "BUILD" | "ENGAGE" | "OFFER";
  }>;
  weekSummary: string;
  conflicts: string[];
  rulesCited: string[];
}
```

## Failure modes

- **OAuth not connected.** `status: "oauth_required"` with connect URL.
- **Draft hasn't passed slop-critic.** Refuse to schedule. Send back.
- **Calendar fully booked.** Propose next-best per channel rules.
- **Asset URL is local-path-only.** Refuse until upload complete (Sprint A.1 fix).

## Cost discipline

0 ScrapeCreators. Calendar API writes only. 0-1 main_maya. Heartbeat-safe (reads only). Timeout 5 min.

## Anti-slop check

Event titles and descriptions are operator-facing. Run `maya-slop-critic` on every `titleWithApprovalPrefix` and `description`. No "🚀 Launch Day — Crush It". Write like "Tue 9am: post X thread (5 tweets), pinned hook + Stripe screenshot attached, target 3% engagement, stop at <1%".
