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
3. **memory/{today}.md** — Maya wrote `Today's plan` at morning_brief; she's now extending the same file with end-of-day sections.

## Write triggers (after send)

After Telegram delivery succeeds and `/lc_gtm/action_logged` has been posted, append these sections to `memory/{today}.md` using the OpenClaw filesystem tool:

1. **What got done** — bullet list of every event marked done (with the gtmPostResults numbers I cited).
2. **Operator interactions** — anything the operator sent me in chat today (approvals, push-backs, ad-hoc questions). One line per interaction.
3. **Notable observations** — threads that blew up unexpectedly, competitor moves I clocked, drafts that flopped vs landed.
4. **Tomorrow's adjustment** — what I'm changing for tomorrow's brief based on today's signal. THIS is the section morning_brief reads tomorrow.

If today's day-grade was Strong, also do a DREAMS.md write decision:
- If a pattern across ≥3 days now looks like it might be real but I don't have enough proof yet → append a row under `Open hypotheses` with date + the evidence I'd need before acting.
- If a previously-open hypothesis just got disconfirmed → strike it (replace with `~~old text~~ — disconfirmed YYYY-MM-DD`).

POST `/lc_gtm/memory_written` (idempotent uuid per write) after each successful write so Convex ledger tracks it.

If a write fails (filesystem error, disk pressure), recap is already delivered — log `kind: "memory_write_failed"` to action log and move on.

## The recap structure

As tight as Maya can make it while still useful. Three blocks:

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
- **Cut**: anything where the thread aged out (past peak, no realistic engagement window left) or got buried (heavy newer comments since surfacing). Mark `gtmTargetThreads.status = "expired"`. Maya judges "aged out" vs "still active."

Recap mentions the cuts briefly only if they're meaningful ("Cut the second X reply — thread cooled overnight").

## Learnings extraction

After a strong-grade day, Maya checks if a pattern emerged worth saving as a learning:

- A clear pattern across multiple owned posts in the same channel at the same time-of-day, performing meaningfully above baseline → `learning_extracted` of kind `timing`. Maya decides when she has enough evidence to call it a pattern; one or two posts isn't.
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
- Time-box — as tight as it can be while useful, operator reads on phone.

## Failure modes

- **Operator didn't act on the morning brief.** Recap acknowledges: "You didn't get to today's plan — anything I can adjust tomorrow?" Do not lecture. Do not pretend it didn't happen.
- **Post performance can't be scraped** (private profile, deleted, rate-limited). Note: "Numbers pending — will update in morning recap."
- **Multiple cuts.** If 3+ events got cut, the recap leads with that signal — "Today didn't hit. Refocusing tomorrow's plan."

## Cost discipline

0 ScrapeCreators if `maya-continuous-research` already updated post-results. 1 main_maya call (compose + critic). Sub-minute.

## Anti-slop check

Banned: "you crushed it," "great hustle today," "tomorrow we level up." Recap reads like a manager's end-of-day note to their report.
