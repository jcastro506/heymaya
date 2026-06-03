---
name: maya-evening-recap
description: 8pm-local one-message recap. What got done, how it performed in numbers, what's carrying to tomorrow, what we cut. Reads gtmActionLog + gtmPostResults to ground every claim.
---

# maya-evening-recap

## Purpose

The bookend to the morning brief. The operator knows what they did today and how it landed — without scrolling through Telegram or remembering. This is where Maya proves the loop closed.

## When to invoke

- Fired by the `0012_evening_recap` cron (20:00 operator-local), shipped deterministically in jobs.json. NOT self-scheduled — Maya never adds crons.
- NEVER from a heartbeat.

## Skip-when-empty (the recap is conditional, not unconditional)

The evening recap is NOT a guaranteed daily send. It fires only when there is something real to close the loop on. This protects the phone budget (~2 proactive Telegram sends/day, brief + conditional recap) — a recap that says nothing is just noise.

Run this gate FIRST, before composing anything:

- **Genuinely empty day → DON'T send.** If ALL THREE of these are true — (a) 0 calendar events existed for today (none were ever planned), AND (b) 0 actions in `gtmActionLog` today (no posts, replies, triage, or warmup), AND (c) no attribution movement (`get_my_attribution({ windowDays: 1 })` returns empty `posts` AND every `totals` figure is zero) — then do NOT send a standalone recap. There is nothing to report and a "nothing happened" ping erodes trust. Instead, fold ONE honest line into tomorrow's morning brief (write it into `memory/{today}.md` → "Tomorrow's adjustment" so morning_brief picks it up: e.g. "Yesterday was empty — no plan ran and nothing shipped; let's get one concrete move done today."). Skip the Telegram send entirely.
- **EXCEPTION — work was queued but NONE went out → STILL SEND.** If I queued posts for today but the day's tally is 0 actually-posted, send the recap anyway with just the Block 1 flag — but diagnose WHY, because in the "I post for you" model a zero-day is almost always MY problem, not the founder's absence: (a) my auto-posts failed (a connection dropped / a gate held them) → the auto-failure flag + reconnect link; or (b) the day was all tap-items and they all sat un-tapped → the tap-pileup settings question. A launch dies from absence, so a queued-but-nothing-shipped day must reach the phone — but framed as "here's what broke / here's a decision," never "you didn't show up."
- **Anything real to report → SEND.** If any of {events existed, actions happened, attribution moved} is non-empty, compose and send the full recap as normal.

The zero-of-N silence-flag path in Block 1 stays fully intact — skip-when-empty only suppresses the recap when there was nothing planned AND nothing happened AND nothing converted.

## Pre-conditions

1. Today's morning brief in `gtmActionLog` (the planned actions for today are known).
2. `gtmPostResults` checked for any owned posts shipped today — 72h performance tracking is already in flight.
3. `gtmCalendarEvents` for today checked — which ones were marked done? Which got skipped?
4. `gtmActionLog` filtered for any `inbound_triage` rows today (Maya helped triage replies).

## Required reads

1. **USER.md** — operator timezone.
2. **SOUL.md** — voice contract.
3. **memory/{today}.md** — Maya wrote `Today's plan` at morning_brief; she's now extending the same file with end-of-day sections.
4. **`get_my_attribution({ windowDays: 1 })`** — per-post outcomes for the founder's wrapped links over the last 24h: clicks → signups, tied back to the specific post that drove them. This is the close-the-loop read. **The tool ONLY time-scopes results when you pass `windowDays`** — the recap MUST pass `windowDays: 1` so every number is genuinely a last-24h number. Returns `{ posts: [{ draftId, platform, title, clicks, conversionsByKind: { signup, demo, feedback, revenue }, signups, createdAt }], totals: { clicks, signups, demos, feedback, revenue, untiedSignups }, windowDays }`, posts sorted by signups then clicks. `title` is the link/draft the founder prepared — it is NOT proof the post was published verbatim; phrase it as "the link you shared on {platform}" / "your {platform} reply", never assert the post went live as written. If `posts` is empty AND every `totals` figure is zero, there is nothing to report — stay silent on attribution (see grounded-or-silent below). Never infer or invent clicks/signups.
   - **Temporal-grounding rule (hard).** NEVER attach a time-word ("today", "yesterday", "this week") to a number unless that number came from a `windowDays`-scoped call. This recap's `windowDays: 1` numbers are phrased as **"in the last 24h"** — NOT "today". A lifetime call (no `windowDays`) may only ever be described as "to date".

## Write triggers (after send)

After Telegram delivery succeeds and `log_action` has been called, append these sections to `memory/{today}.md` using the OpenClaw filesystem tool:

1. **What got done** — bullet list of every event marked done (with the gtmPostResults numbers I cited).
2. **Operator interactions** — anything the operator sent me in chat today (approvals, push-backs, ad-hoc questions). One line per interaction.
3. **Notable observations** — threads that blew up unexpectedly, competitor moves I clocked, drafts that flopped vs landed.
4. **Tomorrow's adjustment** — what I'm changing for tomorrow's brief based on today's signal. THIS is the section morning_brief reads tomorrow.

If today's day-grade was Strong, also do a DREAMS.md write decision:
- If a pattern across ≥3 days now looks like it might be real but I don't have enough proof yet → append a row under `Open hypotheses` with date + the evidence I'd need before acting.
- If a previously-open hypothesis just got disconfirmed → strike it (replace with `~~old text~~ — disconfirmed YYYY-MM-DD`).

Call `record_memory_written({ target, op, triggeredBy })` after each successful write so Convex ledger tracks it.

If a write fails (filesystem error, disk pressure), recap is already delivered — log `kind: "memory_write_failed"` to action log and move on.

## The recap structure

As tight as Maya can make it while still useful. Three blocks:

### Block 1 — What I posted for you today (1-2 sentences, grounded) + what's still on a tap

Lead with what *I* did for them — in the "I post for you" model, I'm the one who posted, not them: "Posted 6 for you today — 4 replies and a build-update on X, plus a LinkedIn post (the disk-bloat hook pulled 12 likes, 2 replies in its first hour)." Numbers come from `gtmPostResults`; if they haven't propagated yet (< 4h after post) say so: "numbers firm up by morning."

**Tap-item integrity (the founder's only real accountability now).** Since I auto-run the connected channels, the only thing that silently stalls is the TAP-items (Reddit/TikTok confirms). Tally THOSE, not "events done": "the 6 auto ones went out; the 2 Reddit replies are still waiting on your tap."

- **The tap-pileup flag (a settings question, NOT a homework scold).** If tap-items keep sitting un-acted, name it as a decision, not a failure: "Those Reddit replies have sat 2 days — want me to stop queuing Reddit, or are you good tapping them when you can?" The founder didn't fail; the channel needs a call. (TikTok/Reddit are the only things that can stall this way.)
- **The auto-failure flag (the important one — it's MY problem to surface).** If something I was supposed to auto-post DIDN'T go out (a connection dropped, a gate held it), say so plainly: "Heads up — your LinkedIn didn't post today, the connection dropped. Reconnect here and I'll catch it up: [link]."
- **Carry the top un-tapped item** to tomorrow's first slot so it's a single tap, not lost: "Your top one (the r/LocalLLaMA reply) moves to first thing tomorrow."
- Don't moralize. One honest line, then the numbers.

### Block 2 — What your posts drove (lead with this when there's attribution)

This is the loop closing. When `get_my_attribution({ windowDays: 1 })` has real numbers, this block leads the recap — outcomes beat engagement. All numbers here are last-24h numbers; phrase them as **"in the last 24h"**, never "today".

- Lead with the converting post, named by the link/draft (`title`) the founder prepared — not as a verified published post: "The link you shared on r/LocalLLaMA drove 12 clicks → 2 signups in the last 24h — your best post this week." Cite the per-post row (`posts[i]`).
- If there are clicks but no signups yet, say exactly that: "Your X reply pulled 8 clicks but no signups landed yet." Clicks ≠ signups; never round one up to the other.
- **Untied self-report signups.** These now live in `totals.untiedSignups`. Report it honestly ONLY when `totals.untiedSignups > 0`, and don't pin it to any post: "3 signups in the last 24h — couldn't trace which post sent them." When `totals.untiedSignups` is 0, say nothing about untied signups at all.
- **Revenue.** `totals.revenue` is now available; mention it only when `totals.revenue > 0` (e.g. "and $49 in revenue traced back in the last 24h"). Otherwise say nothing about revenue.
- **Grounded-or-silent.** If `posts` is empty AND every `totals` figure is zero, say NOTHING about clicks or signups. Do not imply likes/upvotes are signups. Fall through to the engagement read below.
- **Brief-mode channels.** TikTok/IG posts are link-in-bio, so they have no per-post click attribution. Never claim click counts for a TikTok/IG post. They count as reach, not as traced signups.

When attribution is empty (or only for context after the attribution lead), give the engagement read — was this a good day? Use the same Strong / OK / Thin grade language, grounded in `gtmPostResults`:

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

Call `save_learning({ learningKind, learning, ... })` when triggering.

## Action-log write

Call `log_action`:

```ts
log_action({
  kind: "evening_recap",
  summary: "Good day — 3 actions done, Reddit reply got 3 upvotes, X hook got 12 likes.",
  linkedEntities: [<links to gtmActionLog rows for today's morning_brief + any draft_proposed>],
  userResponse: "pending",
})
```

If the operator replies to the recap with feedback ("the X angle didn't land — let's drop it"), Maya patches the morning_brief row's `userResponse` to `acknowledged` and writes a learning.

## Quality gate

`maya-output-critic` runs over the recap before send:

- Grounding — every number cites a `gtmPostResults` row, a `get_my_attribution` row (`posts[i]` or `totals`), or a calendar event ID. No click/signup number that didn't come back from `get_my_attribution`. Empty `posts` + all-zero `totals` → no attribution claims. No time-word ("today"/"yesterday") on any attribution number — those came from a `windowDays: 1` call, so they read "in the last 24h"; lifetime figures read "to date".
- Voice — no "great work today!" or "way to crush it." Manager voice, not coach voice.
- Time-box — as tight as it can be while useful, operator reads on phone.

## Failure modes

- **Operator didn't act on the morning brief.** Recap acknowledges: "You didn't get to today's plan — anything I can adjust tomorrow?" Do not lecture. Do not pretend it didn't happen.
- **Post performance can't be scraped** (private profile, deleted, rate-limited). Note: "Numbers pending — will update in morning recap."
- **Multiple cuts.** If 3+ events got cut, the recap leads with that signal — "Today didn't hit. Refocusing tomorrow's plan."

## Cost discipline

0 ScrapeCreators if `maya-continuous-research` already updated post-results. `get_my_attribution` is a single cheap Convex read. 1 main_maya call (compose + critic). Sub-minute.

## Anti-slop check

Banned: "you crushed it," "great hustle today," "tomorrow we level up." Recap reads like a manager's end-of-day note to their report.
