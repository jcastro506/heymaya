---
name: maya-evening-recap
description: 8pm-local one-message recap. What got done, how it performed in numbers, what's carrying to tomorrow, what we cut. Reads gtmActionLog + gtmPostResults to ground every claim.
---

# maya-evening-recap

## Purpose

The bookend to the morning brief. The operator knows what they did today and how it landed — without scrolling through Telegram or remembering. This is where Maya proves the loop closed.

## When to invoke

- Native cron at 20:00 operator-local. Self-scheduled via `cron add` after foundation completes.
- NEVER from a heartbeat.

## Pre-conditions

1. Today's morning brief in `gtmActionLog` (the planned actions for today are known).
2. `gtmPostResults` checked for any owned posts shipped today — 72h performance tracking is already in flight.
3. `gtmCalendarEvents` for today checked — which ones were marked done? Which got skipped?
4. `gtmActionLog` filtered for any `inbound_triage` rows today (Maya helped triage replies).

## Required reads

1. **USER.md** — operator timezone.
2. **SOUL.md** — voice contract.

## The recap structure

≤ 120 words, plain text. Three blocks:

### Block 1 — What got done (1-2 sentences, grounded)

"You shipped the LocalLLaMA reply (got 3 upvotes in 90 min, OP hasn't replied yet) and posted the disk-bloat hook on X (12 likes, 2 replies)."

Numbers come from `gtmPostResults`. If results haven't propagated yet (Maya is checking < 4h after post), say so: "Numbers will be more solid in the morning."

### Block 2 — Performance read (1-2 sentences)

Maya's interpretation: was this a good day? Use the same Strong / OK / Thin grade language.

- "Good day — the Reddit reply is performing better than your average reply."
- "Average — the X post is below your typical engagement; might be a timing miss."
- "Quiet day — neither post moved, niche feels slow right now."

If the day was thin/warmup, this block credits the warmup work ("you did the 10 min sub-warmup — that compounds").

### Block 3 — Tomorrow setup (1 sentence)

"Tomorrow I'm watching [X subreddit / account] — they posted a related thread tonight that should be hot by 9am."

If nothing's queued, say "Nothing queued yet — I'll scan again at 6am."

## What gets carried vs cut

For each calendar event today that wasn't marked done:

- **Carry**: T1/T2 events still in their freshness window. Push to tomorrow's morning brief with a note.
- **Cut**: anything where the thread aged out (>48h past peak) or got buried (>20 newer comments). Mark `gtmTargetThreads.status = "expired"`.

Recap mentions the cuts briefly only if they're meaningful ("Cut the second X reply — thread cooled overnight").

## Learnings extraction

After a strong-grade day, Maya checks if a pattern emerged worth saving as a learning:

- 3+ owned posts performed >2x baseline in the same channel at the same time-of-day → `learning_extracted` of kind `timing`.
- A specific community-handle keeps producing T1s → kind `community_quality`.
- A particular hook structure keeps landing → kind `hook_pattern`.

Don't manufacture learnings. One day of data is not a pattern. Maya only extracts when she has ≥3 evidence points AND the pattern is strong enough to confidently shift tomorrow's weighting.

POST to `/lc_gtm/learning_extracted` when triggering.

## Action-log write

POST to `/lc_gtm/action_logged`:

```json
{
  "idempotencyKey": "<uuid>",
  "kind": "evening_recap",
  "summary": "Good day — 3 actions done, Reddit reply got 3 upvotes, X hook got 12 likes.",
  "linkedEntities": [<links to gtmActionLog rows for today's morning_brief + any draft_proposed>],
  "sentAt": <Date.now()>,
  "userResponse": "pending"
}
```

If the operator replies to the recap with feedback ("the X angle didn't land — let's drop it"), Maya patches the morning_brief row's `userResponse` to `acknowledged` and writes a learning.

## Quality gate

`maya-output-critic` runs over the recap before send:

- Grounding — every number cites a `gtmPostResults` row or a calendar event ID.
- Voice — no "great work today!" or "way to crush it." Manager voice, not coach voice.
- Time-box — under 120 words.

## Failure modes

- **Operator didn't act on the morning brief.** Recap acknowledges: "You didn't get to today's plan — anything I can adjust tomorrow?" Do not lecture. Do not pretend it didn't happen.
- **Post performance can't be scraped** (private profile, deleted, rate-limited). Note: "Numbers pending — will update in morning recap."
- **Multiple cuts.** If 3+ events got cut, the recap leads with that signal — "Today didn't hit. Refocusing tomorrow's plan."

## Cost discipline

0 ScrapeCreators if `maya-continuous-research` already updated post-results. 1 main_maya call (compose + critic). Sub-minute.

## Anti-slop check

Banned: "you crushed it," "great hustle today," "tomorrow we level up." Recap reads like a manager's end-of-day note to their report.
