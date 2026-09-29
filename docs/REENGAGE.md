# Re-engagement: Maya reaching back out

What she does when someone goes quiet, and what she does when they come back. Built 2026-09-28 after looking at Meta's Muse (which comes back "when something changes or when it needs approval") and at Linq's Chat Health guidance (texting into silence is the fastest way to a flagged line, and that hurts every user on the number).

The principle is the product's own: **grounded or silent.** She doesn't send "it's been a while". She reaches out only when there's something true to tell them, gives one exit before she stops, and after that says nothing until they write.

## The policy (`decideReengage`, one pure function)

A **spell** starts with the message they last sent (any text, tap or reaction; or the moment they paired, if they never wrote). It ends the moment they send anything.

| Rung | When | What it needs | What it is |
|---|---|---|---|
| `nudge` | 3 days into the spell | something true (below) | one short text that leads with it and ends on something answerable in a word |
| `nudge2` | 9 days, and at least 6 after the first | something true and *new* | the same |
| `easy_out` | 15 days, and at least 6 after the last | nothing (it is the exit) | "i'll stop texting so much: say pause and i'll go quiet, or send anything and i'm right back" |
| (nothing) | after the easy-out | | until they text |

Held, with a named reason, when: they opted out (STOP); the plan is paused or past due; they're unpaired; a care pause is on; it's quiet hours; the daily cap is reached; a question is open; we texted them in the last 48 hours (20 for the easy-out); three texts are already unanswered (then only the easy-out is left, which is Linq's own ladder); or there's nothing true to say (a nudge only). Every rung is sent at most once per spell (the dedupe key names the spell by its opening message id, so it survives the sims' time-shifting).

On iMessage the same text also has to pass **Linq's rail** inside `messages.send` (`core/phoneRail`): chat health, a flagged line, and the back-off ladder. The easy-out is kind `quiet`, the one kind the rail lets through once after three unanswered texts.

## What's "true" (`agent/returnFacts`)

Only rows, and only these:

- **Ideas they haven't seen**: the existing N1 rule (`core/unseen`), so the app, the "+N more" and this can't disagree.
- **A post of theirs at 1.5x their own normal or more**, made since they last wrote and settled (48 hours). Uses `core/normal`.

A reason she already texted is never repeated (`reason:<...>` in `milestonesSaid`). Milestones stay with the morning line.

**One capability, sometimes.** Muse lists what it can do; she offers the one thing that fits what she just told them: a capability they have never used (send a draft for a caption and sound; book a film block; a media kit where deals are open; watch an account), at most one every 30 days, none repeated inside 90, and only as a plain clause attached to a real reason. Never alone.

## When they come back (`welcomeBackSection`)

If their previous message was 7+ days before this one, her reply context gets a welcome-back section: react like a friend ("hey, there you are"), never a guilt line, and catch them up in at most two lines using only the facts above. It replaces the once-only "new ideas" note on that turn (same ideas, and two instructions to mention them would fight). It's derived from the two message times, so a retried turn gets the same section and nothing is stored. Their next message has already reset the ladder.

## What controls it

They don't get a new setting. The easy-out offers the two things that already exist and are enforced by code: **pause** (stops all proactive texts; "resume" brings her back) and **STOP** on iMessage (opted out until they text). Quiet hours and the daily cap still hold.

## Where it lives

- `convex/agent/reengage.ts`: the policy, the two skills (`REENGAGE_SKILL`, `EASY_OUT_SKILL`), the rows, and `run` (called by the hourly cadence at 18:00 on their clock through `cadence.quiet`, which kept its name).
- `convex/agent/returnFacts.ts`: the reasons, the capability, the welcome-back section.
- `convex/agent/context.ts`: `gather` adds the welcome-back.
- Failure behavior: a nudge the critic rejects twice, or a writer that's down, sends **nothing** (held, named, tried again tomorrow). The easy-out never depends on a model: it falls back to a fixed line.

## How it's tested

- `agent/__tests__/reengage.test.ts`: the policy as pure functions, including a 60-day silence played out day by day (nudge 3, nudge 9, easy-out 15, then nothing); the facts and capability rules; the rows (cross-tenant, every rail, the phone rail, a new spell, the welcome-back).
- `agent/__tests__/reengageFailures.test.ts`: the writer and critic failing.
- `eval/silenceSim.ts`: nine scripted people over 22 simulated days on dev, with the real writer, critic, judge and rails, no vendor credits. `eval/__tests__/silenceSim.test.ts` pins the sim's expectation table to the policy so it can't go stale.

```sh
export CONVEX_DEPLOYMENT=dev:impressive-roadrunner-997
npx convex run eval/silenceSim:start '{}'
npx convex run eval/silenceSim:report '{}'          # add {"full":true} for every check
npx convex run eval/silenceSim:clear '{}'           # remove the run's creators afterwards
```

## Not built, on purpose

- No scheduled "it's been a while" pings, no generic feature lists, no daily nudges, no guilt.
- No per-user "how often" setting: the ladder is already about one text a week to someone who isn't answering, and pause is the control.
- App push isn't her voice (principle 1), so it isn't a re-engagement channel.
- Milestones in the nudge (the morning line already carries them).
