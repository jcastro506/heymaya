---
name: maya-calendar-populator
description: After deep-research subagents land target threads + accounts + drafts, generate the next 14 days of calendar events on Google Calendar (provisional, status="draft") mapped to the operator's current phase of the PLAYBOOK 4-phase arc. Each event links to a target thread + draft + cites the playbook rule.
---

# maya-calendar-populator

## Purpose

The deep-research subagents (reddit_research, x_research, etc.) surface specific target threads + accounts + drafts. This skill turns those raw artifacts into a real **calendar** — 14 days of scheduled, time-blocked work the operator can actually do. Each event has a title, what-to-do, link to the target thread/draft, success metric, why-it-matters citation.

Without this skill, the target list lives in the database and nobody acts on it. With it, the operator opens Google Calendar and sees their week.

## When to invoke

- IF deep-research subagents have just completed AND `/lc_gtm/get_my_target_threads` returned >0 rows THEN run. This is the canonical first invocation, right at the end of FIRST WAKE.
- IF weekly review (`gtm_weekly_review` cron) ran AND new target threads were surfaced THEN refresh rolling next-14-days.
- IF format-market-fit detected (Phase 4 cadence change) THEN re-balance the cadence (more metric posts, fewer build updates, etc.).
- IF operator approves a draft via Telegram THEN that drafted_content's calendar event flips from `draft` → `scheduled` (and gets pushed to Google Calendar via Sprint 9).

## Required reads

1. **PLAYBOOK.md § 2** — The 4-Phase Launch Sequence (Phase 1 cold-start / Phase 2 soft launch / Phase 3 hard launch / Phase 4 compound). Determines the SHAPE of the 14 days.
2. **PLAYBOOK.md § 4** — BUILD / ENGAGE / OFFER triad ratios. Determines the MIX of event kinds per platform.
3. **APP.md + USER.md** — product context, week goal, operator constraints (canPostTikTokManually, canShowFace, etc.).
4. **GTM.md** — active channel picks. Only generates calendar events for primary + secondary channels.
5. **Per-platform playbook**: `playbook/reddit.md`, `playbook/x.md`, etc. for time-window + frequency rules per channel.
6. **Target list** via `GET /lc_gtm/get_my_target_threads` — the raw material. Top 30 by priorityScore.
7. **Optionally** `GET /lc_gtm/get_my_target_accounts` for follow-and-engage events.

## Decision rules

### 1. Phase detection — what week are we in?

Compute current phase from `(now - creator.createdAt)`:
- **Phase 1 (Day -30 to Day -1)**: account warmup + cold-start audience building. *If any active channel's Phase-1 minimum (PLAYBOOK § 2) is NOT met, stay in Phase 1 until it is.* Default 14-day plan is heavy on engagement_block + warmup_block; NO soft_launch_post events.
- **Phase 2 (Day 0 to Day 7)**: soft launch. 5-piece kit drafted, 1-2 soft_launch_post events scheduled for Tue/Wed/Thu mornings, the rest is reply_window + engagement_block.
- **Phase 3 (Day 7 to Day 14)**: hard launch. ONE Tuesday hard_launch_anchor + first_50_dms blocked the day before + reply_window events in the 2-hour engagement window after the anchor.
- **Phase 4 (Day 14+)**: weekly cadence per § 4 — 1 metric post + 2 build-update/insight + 1 demo + reply-mining 4-5 days/week.

### 2. Per-platform time windows (PLAYBOOK § 4.X channel rules)

- **Reddit**: Tue/Wed/Thu 8-11am ET for posts. Replies any weekday morning/afternoon. 2-hour engagement window MANDATORY after any post — block it explicitly. Personal-account-only; never auto-publish.
- **X / Twitter**: Tue morning operator-tz 8-10am for posts. Replies throughout the day (reply-mining is 4-5x leverage of posting).
- **LinkedIn**: Tue-Thu 8-10am operator-tz.
- **TikTok**: niche-FYP-time from format research; default 6-9pm operator-tz B2C, 12-2pm B2B. Posts ONLY scheduled if `tiktokWarmupState === "ready"` AND `canPostTikTokManually === true`.
- **Hacker News**: Tue-Thu 7am-10am PT for Show HN. Comments any weekday.
- **Instagram**: Tue-Thu late afternoon / evening for Reels. Stories any time.

### 3. Slot allocation — how many events per channel per week?

For PRIMARY channel:
- Phase 1: 4-5 reply_window events (15-30 min each), 1-2 engagement_block events (30-60 min lurking + saving posts), 0 posts.
- Phase 2: 3-4 reply_window, 1-2 soft_launch_post (drafted, status:draft until operator approves), 1-2 engagement_block.
- Phase 3: 1 hard_launch_anchor (Tuesday) + 2-3 reply_window in the engagement window + 1 first_50_dms (Monday).
- Phase 4: 1 metric_post + 2 build_or_insight_post + 1 demo_post + 4-5 reply_window/week + 1 weekly_review.

For SECONDARY channel: roughly half the cadence of primary. No hard_launch_anchor unless the secondary is X (where founder threads tied to the launch make sense).

### 4. Event linking

Every event MUST link to its source:
- reply_window events: `targetThreadId` references the gtmTargetThreads row.
- post events (soft_launch_post / hard_launch_anchor): `draftedReplyId` references the gtmDraftedContent row.
- warmup_block: cites the specific playbook section (tiktok.md § 6 / reddit.md § 6).
- engagement_block: cites the priority subreddit/community to lurk in (from gtmTargetSubreddits or per-channel playbook).

### 5. Status semantics

All events default to `status: "draft"`. They are visible to the operator but NOT yet on Google Calendar. The operator reviews via Telegram or mission board, approves, and only then does the calendar-write happen (Sprint 9 path) flipping to `status: "scheduled"`.

### 6. Voice contract (per SOUL.md)

Every event title + description is operator-facing. Apply the voice contract:
- **Allowed**: "Reply on r/LocalLLaMA hardware war thread" / "Scroll niche FYP for 20 min" / "Post your launch thread Tuesday morning"
- **BANNED**: "warmup_block event" / "priorityScore 0.87 target" / "reply_window from maya-reddit-demand-researcher" / "draftedReplyId 89234..." — these all leak internals to the operator.

The title is what the operator sees in their calendar app. Make it sound like a teammate's note, not a database row.

### 7. Holiday + industry-event check (PLAYBOOK § 2.3.1)

Maya checks before slotting hard_launch_anchor or soft_launch_post events. Skip US holidays, known industry events (re:Invent, WWDC, etc. if relevant to the niche), Black Friday week, end-of-year freeze.

### 8. Account warmup gating

If primary channel has unmet Phase-1 audience minimum (PLAYBOOK § 2):
- ALL post-kind events get pushed to Phase 1 schedule (no posts until warmup done)
- 14-day calendar is exclusively warmup_block + engagement_block + reply_window (replies allowed during warmup if they're substantive, not promotional)
- Maya signals to user: "We're in warmup. No public product mentions yet. Tomorrow's first task is X."

## Output

POST events one-at-a-time to `/lc_gtm/calendar_proposal` per the TOOLS.md spec. Each event must include:

```ts
{
  idempotencyKey: string,            // hash of (kind + startsAtMs + targetThreadId)
  researchJobId: string,             // current job
  events: [{
    title: string,                   // operator-facing, voice-contract clean
    description: string,             // includes link to target URL + draft (if any) + playbook citation
    startsAtMs: number,
    endsAtMs: number,
    kind: "warmup_block" | "engagement_block" | "reply_window" | "soft_launch_post" | "hard_launch_anchor" | "first_50_dms" | "weekly_review",
  }],
}
```

Default durations:
- reply_window: 20-30 min
- engagement_block: 30-60 min
- warmup_block: 20-30 min
- soft_launch_post: 30 min (post + immediate engagement)
- hard_launch_anchor: 2 hours (post + engagement window)
- first_50_dms: 60-90 min
- weekly_review: 30 min

## Failure modes

- **No target threads landed.** This skill is no-op. Surface to user: "Deep research found nothing usable — need to widen the search OR pick a different channel." Push retry to next research cycle.
- **Calendar OAuth not connected.** Events still get drafted (status:draft). Tell user to connect Google Calendar via onboarding so the scheduled events show up there too. The Telegram nudge cron still works without Google Calendar.
- **Phase 1 floor unmet on ALL channels.** Pure warmup mode for 14 days. Maya is explicit about this in the user message: "Your accounts need 2-4 weeks of warmup before launch. Here's the plan."
- **Operator overrides Phase 1 + insists on launching.** Document the override per AGENTS.md operating contract rule 1. Schedule the launch event anyway with a warning in the description: "Operator override — launching despite Phase 1 floor not met. Recover path: if engagement <1%, repositioning required."

## Cost discipline

0 ScrapeCreators. 0 paid external APIs. Pure synthesis of existing target list + playbook rules into calendar events. 1-2 main_maya LLM calls (no thinking budget needed; this is structured-output work). Timeout 5 min.

## Anti-slop check

Run maya-slop-critic on every event `title` and `description`. Banned phrases (PLAYBOOK § 6). Event titles must be operator-natural — not "engagement_block #4" or "Reply 1/15".
