---
name: maya-morning-brief
description: The 7am-local daily message + calendar populate. One Telegram, as tight as possible while useful, self-graded (Strong / Thin / Warmup), top priority named first, calendar events with full hands-off recipes. Reads gtmNicheLearnings to weight what surfaces.
---

# maya-morning-brief

## Purpose

The flagship operator-facing output. Every morning, the founder gets one Telegram message that tells them how today is going to work. They tap into the calendar, do the things, close the loop. The brief is short, graded, and prioritized. It is NOT a research dump.

## When to invoke

- Native cron schedules a daily trigger at 7am operator-local (operator timezone from USER.md). Maya self-schedules via `cron add`.
- Operator manually requests ("what's the plan today?") — re-run synthesis with existing data, don't re-spawn workers unless data is >4h stale.
- Hot-alert mid-day fires its own message via `maya-continuous-research` → not via this skill.

## Pre-conditions

1. `maya-continuous-research` has run within the last 4h.
2. `gtmActionLog` is checked for yesterday's brief — was it acknowledged? Acted on?
3. `gtmNicheLearnings` is read — which subreddits / accounts / times Maya has learned weight higher.
4. `gtmTargetThreads` filtered to tier=T1 OR T2, status=queued, sorted by `velocityScore` desc.

## Required reads

1. **GTM.md** — bet channels.
2. **USER.md** — operator capacity (today's available minutes), timezone.
3. **SOUL.md** — voice contract.

## The brief structure

A single Telegram message — as tight as Maya can make it while still being useful (operator reads on a phone, in one breath). Three blocks:

### Block 1 — Grade + lede (1-2 sentences)

Lead with Maya's grade. The grade reflects what data she has, honest:

- **Strong signal day** — Maya has enough good T1/T2 threads that today's plan is real action, not filler. Lede: top single action ("Hit this Reddit thread first — OP just posted, comments are warm").
- **Thin day** — 1-2 T1/T2 total. Lede: "Thin morning. One real target + a content draft block."
- **Warmup day** — 0 T1/T2. Lede: "No fresh buyer signal today. Today is for warmup + writing."

### Block 2 — Calendar pointer (1 sentence)

"5 events in your calendar, 75 min total" — concrete numbers. No "I've put together a comprehensive plan."

### Block 3 — Top priority callout (1-2 sentences)

The single most important thing. Always cited. "Top priority: [URL] — replying within 30 min while the thread is still ramping (47 upvotes/hr velocity)."

## Calendar events emitted alongside

Each T1/T2 thread → one `gtmCalendarEvent` written via `/lc_gtm/calendar_proposal` (or whichever route the populator skill uses). Plus 1-2 framework events:

- **Warmup block** (always, even on warmup days): 10 min — browse the bet subs, upvote a few high-signal threads.
- **Content draft block** (on thin/warmup days): 20 min — draft one post from the content-angle vault.
- **Inbound triage** (if `gtmActionLog` shows unhandled replies from yesterday): 10 min.

Calibrated to operator's available capacity (per USER.md). Maya doesn't pad to fill time or load up beyond what they can realistically do. If today's total runs heavy, she cuts the lowest-tier event.

Each event description follows the full hands-off recipe template from `maya-calendar-populator` (WHAT / LINK / WHY / YOUR REPLY / VOICE NOTES / SUCCESS TARGET / TIME / SOURCE).

## Weighting from niche learnings

Before tier-sorting, Maya does an exec curl GET to
\`$CONVEX_SITE_URL/lc_gtm/get_my_niche_learnings\` with Bearer auth.
This returns all non-retired learnings — one row per pattern Maya has
extracted from prior weeks (timing, channel_priority, voice_angle,
community_quality, format_preference, hook_pattern).

Bump threads matching active `gtmNicheLearnings`:

- Learning of kind `timing` says r/X 10am-2pm fires → if a queued T2 thread is in r/X and the time window is now, promote toward T1 (Maya's judgment, not a formula).
- Learning of kind `community_quality` says r/Y converts poorly → demote queued T2 threads in r/Y.
- Learning of kind `voice_angle` says hardware-spec hooks underperform for this founder → demote a thread whose draftReply opens with hardware specs.

These are nudges, not overrides. Maya can ignore a learning if the specific thread is exceptional.

## Quality gate

Run `maya-output-critic` over the candidate brief + every calendar event description BEFORE the Telegram send + Convex write. If critic flags:

- Grounding fail → drop the unfounded claim.
- Voice fail → re-draft using slop-critic suggestions.
- Time-box fail → cut the lowest-tier event.
- Tier-honesty fail → re-grade the day (probably from Strong to Thin).

## Action-log write

After send, POST to `/lc_gtm/action_logged`:

```json
{
  "idempotencyKey": "<uuid>",
  "kind": "morning_brief",
  "summary": "Strong day — 3 T1, 2 T2, top is [thread]. 85 min total.",
  "linkedEntities": [
    { "entityKind": "thread", "entityId": "<gtmTargetThread id>" },
    { "entityKind": "calendar_event", "entityId": "<gtmCalendarEvent id>" }
  ],
  "sentAt": <Date.now()>
}
```

## Failure modes

- **No fresh data.** If `maya-continuous-research` failed and the data is stale, send a holding message: "Pulling cleaner data — brief in 30 min" and re-trigger research. Don't ship a stale brief silently.
- **Operator hasn't acknowledged 3 briefs in a row.** Add a closing line: "I notice you haven't opened the last 3 briefs. Want me to scale back the cadence, switch tone, or pause for a few days?"
- **Calendar OAuth not connected.** Events still write to Convex `gtmCalendarEvents`. Brief notes: "5 events queued in HQ (your Google Calendar isn't connected yet — want me to walk you through it?)."

## Cost discipline

0 ScrapeCreators (research has already run). 1-2 main_maya calls (compose + critic). Sub-minute total. Runs once per cron tick.

## Anti-slop check

Brief faces slop-critic. Banned for this message: "I've put together," "comprehensive plan," "ready to crush today," "let's get after it." Manager voice = a senior colleague talking to one person.
