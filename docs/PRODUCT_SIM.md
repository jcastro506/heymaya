# The product simulation (zero ScrapeCreators credits)

The first-week simulation (`docs/FIRST_WEEK_SIM.md`) with two switches:

- **`replay: true`**: every public read is answered from the dev deployment's read cache, whatever its
  age. A read that was never cached is a named failure (`replay miss`), never a vendor call. The run's
  credit ceiling drops to 1, so a single paid read stops it and says so. Models still run for real
  (OpenRouter for her, the actor and the judge; Gemini for watching video): they are what the run measures.
- **`script: "product"`**: scripted moments on top of the week, each checked against rows, not prose.

## What it checks

Two roles, so both branches of every promise run: creators 0, 2, … **follow through**; 1, 3, … **flake**.

| Day | Beat | Promise checked (from rows) |
|---|---|---|
| 1 | settings | "can you not text me before 9am" changes quiet hours |
| 1 | remember | a race date and a "never pitch me dance trends" rule are kept as rows |
| 2 | book | "can we film the X one tomorrow at 5pm?" books a consented film block at 17:00 local, for that idea, with reminders scheduled (falls back to the shared calendar tool, and says so, if chat didn't book) |
| 2 | ideaActs | a save in the app and a pass by chat both land, through the one shared function |
| 3 | prep, checkin | the morning prep and the check-in (yes / push it / skip) go out; never more than two touches; the follower's "yes" marks it filmed |
| 3 | shootDone | the follower posts (a simulated post row, `sim…` in its id and URL) and texts the link; the idea is marked posted |
| 3 | after | follower: no "how'd it go" (she knows). Flaker: she asks; "ugh didn't get to it" in their own words is understood; no guilt; "didn't happen" records it; "tomorrow" rebooks |
| 4 | missedFollowUp | if the evening didn't rebook it, the morning names the missed shoot with "put it back", and that rebooks it |
| 4 | share | Send to Maya (the share extension's mutation) with a cached public post gets an answer |
| 4 | askMaya | the app's Ask Maya on an idea, then "would this work on instagram too?" gets a reply about that idea |
| 5 | care | "honestly kind of over this" gets her, not a hotline, and no 24 h pause |
| 5 | pause | "pause" stops her texting first (a scout pass is held); "resume" brings her back |
| 6 | memory | "what race am i running again?" names Chicago |
| 6 | tone | "be more blunt" changes tone (late on purpose: the week is heard in her default voice) |
| 7 | audit | never over the daily cap; no dance-trend idea after the rule; nothing proactive before 9am after day 1 |

Plus everything the first-week run already measures and judges: first read, first ideas (judged for
grounding, specificity, invention and platform), week plans, the Sunday review, cost.

## Run it

Needs a deployment with `ENVIRONMENT_NAME` set and not production (replay is refused otherwise), and a
read cache that can onboard at least two accounts.

```bash
export CONVEX_DEPLOYMENT=dev:impressive-roadrunner-997
npx convex dev --once --typecheck disable            # deploy this branch

# which accounts can a zero-credit run onboard? (profile + both post sorts cached)
npx convex run eval/replay:candidates '{}'

# start: subjects default to four free cached accounts; or name your own (each must be cached)
npx convex run eval/firstWeek:start '{"replay":true,"script":"product"}'
npx convex run eval/firstWeek:start '{"replay":true,"script":"product","handles":[{"tiktok":"..."},{"instagram":"..."}]}'

# read it (partial while it runs). fleet.promises is the product script's scorecard
npx convex run eval/firstWeek:report '{"runId":"fw-..."}'
npx convex run eval/firstWeek:days '{"runId":"fw-...","i":0}'   # every beat's checks, with what she said

# her words, in order, with what they had just said: the input to the voice rating page
npx convex run eval/firstWeek:voice '{"runId":"fw-..."}'

# what the cache could not answer, per creator
npx convex run eval/replay:missesFor '{"creatorId":"..."}'

# clean up (also disarms replay for the run)
npx convex run eval/firstWeek:clear '{"runId":"fw-..."}'
```

## Reading the result

- `fleet.promises`: one row per promise, `passed / failed / na` across creators (`na` is the other role).
- A failed check carries `detail`: the rows it saw and what she said. Read it before calling it a bug:
  a replay miss (the cache never saw that post) shows up as a failed lookup, not as Maya's fault.
- `credits.attributed` must be 0. If the run stopped with "replay run spent N credit(s)", a read path
  skipped the creator id; `eval/replay` names the only two known ones (the web form's handle check and
  the fleet format watch), and the script calls neither.

## Limits (honest)

- The simulated creator is a model with a life script, and its texts are scripted at each beat: this
  proves the promises hold for these words, not for every way a person says them.
- Google Calendar and Gmail stay unconnected: blocks are Maya's own rows, as for a creator who never
  connected a calendar. The deals world (`eval/dealsWorld`) covers email against a fake Gmail.
- The shared post must already be in the cache (`post.info`); with none, the share beat is `na`.
- Quiet hours and the check-in read the real clock: start the run in daytime for the chosen zones
  (the default subjects get daytime zones automatically).
