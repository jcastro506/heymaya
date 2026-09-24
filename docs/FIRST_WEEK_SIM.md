# The first-week simulation

`convex/eval/firstWeek.ts` (not `scout/firstWeek.ts`, which is the product's own first-week ledger).

Brand-new creators sign up with **real** TikTok and/or Instagram handles, and each lives a whole first
week, compressed. This is the MVP path that had never run end to end:

signup → catalogue read + dossier → admired picks → pairing (texting START) → hello → first read →
first ideas → first week plan → daily cadence → first Sunday review.

## How it works

| Phase | Clock | What runs |
|---|---|---|
| Day 0 | **real** | `startCreator` (the web form's function) creates `eval-run:fw-<run>:<i>` and queues the real `ingest_catalogue` job, which the fleet's minute drain runs. The admired screen runs the real `suggestFor` and adds the top picks (`addTracked`, as `admired.add` does). At +3 min the creator "texts START": their fictional number goes on the row as `setPhone` writes it, a one-shot token is minted, and the real `claimPairingByPhone` claims it (hello or goal question, the `first_read` job), with the START text recorded by `receiveInbound`, exactly as `handleText` does. The first read then schedules its own plan (+20 min) and scout (+30 min). The creator actor answers what she sends. Day 0 ends 35 min after the first read (or at 90 min). |
| Days 1–7 | **simulated** | livingSim's technique, its helpers: every row the creator owns moves one day into the past (`ageCreatorTable`, through each table's creator index), then the per-creator functions the crons fan out to run in a fixed order (`dayPlan`): expire stale questions · sampler · sweep · morning line · scout · actor reply · (day 1) draft invitation · (Sunday, from day 5) weekly review · second scout pass · how'd-it-go · (Sunday) next week's plan · quiet check · actor reply · snapshot. |
| After | — | A judge (the critic model, as in the Expert Bench) scores the first read and the first three ideas against the creator's real posts and dossier. |

The simulated signup day is a **Monday** by default (`signupWeekday: 1`), so the first Sunday is day 6:
review first (a week's review needs five days, as `dueForReview` requires), then next week's plan.

Isolation: nothing is delivered (`messages.send` suppresses `eval-run:`), the number is fictional
(NPA-555-01xx) and never registered on the line, and every mutation in the module refuses a creator that
is not `eval-run:fw-`.

⚠️ **This branch also changes `core/schedule.ts` `pairedRows` to skip `isEval` creators.** Until now the
hourly fleet jobs (scout, cadence, review, week plan, first week, sweep, readback) ran for every paired
`eval-run:` clone at the real hour, even though the simulations' comments said they didn't. Without the
change, a sim creator would get the fleet's scout passes on top of the simulated ones. `eval-load:`
creators (the load test) are unaffected.

## Run it

```bash
cd ~/Desktop/heymaya-onboarding-sim
export CONVEX_DEPLOYMENT=dev:impressive-roadrunner-997

# deploy this branch to the dev deployment
npx convex dev --once --typecheck disable

# 0. what will it cost? (the same estimate `start` checks the balance against)
npx convex run eval/firstWeek:estimate '{}'

# 1. are the handles free? (a handle held by another creator is refused by the real signup rule)
npx convex run eval/firstWeek:preflight '{}'

# 2. start (default: the 8 subjects in DEFAULT_SUBJECTS, 7 days, Monday signup, 600-credit ceiling)
npx convex run eval/firstWeek:start '{}'
#    or your own creators and knobs:
npx convex run eval/firstWeek:start '{"handles":[{"tiktok":"somecreator"},{"instagram":"someone","timezone":"Europe/London"},{"tiktok":"both1","instagram":"both1"}],"days":7,"maxCredits":600}'

# 3. read it (partial while it runs; `phase` per creator says where each one is)
npx convex run eval/firstWeek:report '{"runId":"fw-..."}'
npx convex run eval/firstWeek:report '{"runId":"fw-...","verbose":true}'   # full judge text
npx convex run eval/firstWeek:days '{"runId":"fw-...","i":0}'              # one creator: every step, the actor, daily snapshots

# 4. free the handles for the next run (deletes the run's sim creators and their rows)
npx convex run eval/firstWeek:clear '{"runId":"fw-..."}'
```

Knobs on `start` (all optional): `days` (1–14), `watchCap` (default 2), `transcriptCap` (6), `admired`
(3), `pairAfterMs` (3 min), `day0MaxMs` (90 min), `maxCredits` (600), `signupWeekday` (1 = Monday),
`seed` (11). Per creator: `tiktok`, `instagram`, `timezone`, `note`.

`DEFAULT_SUBJECTS` is marked for swapping: 2 TikTok-only, 3 Instagram-only, 3 both; small and large;
eight lanes. The two small runners come from our recorded vendor fixtures; the others are well-known
public creators I have **not** verified live. Run `preflight` first.

Timezones: unless you give one, each creator gets a real zone where it is 09:00–16:59 **when the run
starts**. Maya's rails read the real clock, and the whole week takes a few real hours, so a creator whose
week ran at 03:00 their time would measure quiet hours, not Maya.

Needs on the deployment: `OPENROUTER_API_KEY`, `GOOGLE_API_KEY` (the watch pass), the ScrapeCreators key,
and **not** `SCRAPE_FIXTURES` (fixtures cost 0 credits but read fake accounts).

## Cost and time

**The default run's estimate: 839 credits** (8 creators: 100 each for the five single-platform
subjects, 113 each for the three on both), **bounded by the 600-credit ceiling, so the default run
needs 600.** `estimateCredits` in the module is the formula; `eval/firstWeek:estimate` prints it for any
handles and knobs.

**`start` refuses to begin, with a named reason, before creating anyone**, when a fresh
`reads/read` `vendor.credits` balance is below what the run may spend (`min(estimate, maxCredits)`), or
when the balance can't be read at all (it does not start blind). Credits are nearly exhausted right now:
check `estimate`, then lower `maxCredits`, pass fewer `handles`, or top up. For example, 3 creators
(one TikTok, one Instagram, one both) with `"days": 7` estimate 313 credits.

**ScrapeCreators credits (the ceiling: 600 for the run, checked before every step, fleet-wide).**
Catalogue reads and search pages are 1 credit; `post.info` (the watch pass, and any post she looks at
closely) is 10. The catalogue read is capped for the simulation (`watchCap` 2 watched posts, not 40;
`transcriptCap` 6, not 40) — that cap is the difference between ~60 and ~450 credits per signup.

| Per creator (defaults) | Credits |
|---|---|
| Account-type check (profile per platform) | 1–2 |
| Catalogue: posts (popular + latest per platform) | 2–4 |
| Transcripts (≤ 6) | ≤ 6 |
| Watched posts (≤ 2 × `post.info`) | ≤ 20 |
| Admired suggestions (profile/reels searches, shortlist reads) | ~15–20 |
| The week: roster samples, lane sweep (cached a day, shared), scout lookups, replies | ~25–60 |
| **Total** | **~70–110** |

So a full 8-creator week is **~550–900 credits**: the default run may reach the 600 ceiling before the
Sunday review. When it does it stops itself, says `stopped: credit ceiling …` in the report, and still
judges what happened. Each chain checks before its next step, so it can overshoot by one step per
creator (worst case a scout pass, up to 40 credits each). For a guaranteed full week either run 5
creators, or pass `"maxCredits": 1000` (at $0.00188 a credit that is ~$1.90). Reads made without a
creator (the lane sweep) are counted from the ledger's time window, which includes anything else running
on the deployment, so the ceiling is conservative.

**Model $**: a real onboarding costs ~$0.35 in model calls (the dossier, the first read, the critic);
the week adds scout passes, replies and the review. The actor and the judge are billed as `fw_*` and
reported separately (`simOverheadUsd`), never as Maya's cost.

**Time**: day 0 ~40–90 real minutes (the ingest, then the read's 35-minute settle window), then ~5–15
minutes per simulated day. **A 7-day run takes roughly 1.5–3.5 hours.** All creators run in parallel.

If the catalogue read fails and the first-read job re-queues it, the retry is the product's own,
uncapped read (up to 40 watched posts); the ceiling is what stops that.

## What each metric proves

| Metric | Proves |
|---|---|
| `catalogue.status`, `postsRead.tiktok/instagram`, `readFrom` | The real read worked for this account on each platform (Instagram is read, not skipped). |
| `dossierAtHours` | She knew them before she spoke. |
| `helloAtHours` | Pairing is never followed by silence. |
| `firstReadAtHours` (fleet: `pctFirstReadWithin1h`) | The moment the product is judged arrives while they're still looking. A `"reading your posts"` line means pairing beat the read. |
| `firstPlanAtHours`, `firstIdeaTextedAtHours`, `firstIdeaAnyAtHours` (fleet: medians, `pctIdeaWithin24h`, `pctTextedIdeaWithin24h`) | Day one is a working day: ideas within 24 h. "Any" counts the first plan (ideas seeded from their own posts); "texted" is a scout idea on its own. |
| `ideasWeek1.byInspiration` | Where her ideas came from: a TikTok or Instagram source post, or their own TikTok / Instagram post. |
| `instagram.gotIgGroundedIdea` (fleet: `instagram.pct`, `instagramOnlyWithIgGroundedIdeas`) | Instagram is not an afterthought: an Instagram creator, and especially an Instagram-only one, gets ideas grounded in Instagram. |
| `weekPlans`, `sundayReviewAtHours` | The week plan and the first Sunday review happened. |
| `failures` | Every job failure, dead job, refused signup, step error or timeout, named. Nothing fails silently. |
| `cost` (fleet: `costPerOnboardedCreator`) | Model $ + ScrapeCreators credits per onboarded creator, from the ledger's creator index. |
| `judged` (fleet: `judge.meanGrounded`, `meanSpecific`, `wrongPlatform`, `withInvented`) | The first read and first three ideas were grounded in their real posts, specific to them, and right for their platform. |

## What it cannot tell you

- **The world is frozen.** A simulated day is minutes of real time, so vendor reads are cached across
  simulated days: the same breakouts and searches all week. It measures onboarding → first ideas and the
  cadence, not a week of fresh trends (livingSim replays a lane for that).
- **The product reads the real weekday.** Sunday jobs are fired on the simulated Sunday directly, as
  livingSim does; `dueForReview` / the week-plan cron's own "is it Sunday" is not exercised.
- **They don't post during the week.** The creator is real and posting in real time, not simulated time,
  so readback, "saw it" and how'd-it-go-after-a-shoot mostly have nothing to react to.
- The admired picks are the top suggestions, not a person's choice. The dossier is built from fewer
  watched posts than a real signup (the credit cap).
