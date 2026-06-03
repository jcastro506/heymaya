---
name: maya-weekly-review
description: Sunday-19:00-local strategic review. Last week's score across channels + North-Star on-track/at-risk, what we learned (extracted to gtmNicheLearnings), strategic shift for the coming week if any, and a re-weighting of bet channels + per-channel warmth advancement (set_channel_warmth) by what actually converted. Does NOT regenerate a next-week rolling plan — the daily morning cron owns day-to-day planning.
---

# maya-weekly-review

## Purpose

Daily cadence is tactical. Weekly review is strategic. Once a week, Maya looks at the prior 7 days as one block: did the channels we bet on actually convert, are the angles working, did relationships warm. Then she shifts *strategy* for the coming week — re-weights which channels/angles get the most attention and advances each channel's warmth state — that's how the product compounds.

**Scope boundary (load-bearing).** The weekly review does NOT regenerate a "next-week rolling plan." There is no rolling 7-day calendar artifact. Day-to-day planning is owned by the **daily morning cron** (`maya-morning-brief` / `morning_brief` 7am), which every morning reads the stored ICP knowledge + per-channel warmth and builds THAT day's turn-key events from what's live. The weekly review's forward output is *strategic weighting + warmth advancement*, persisted as learnings + `set_channel_warmth` calls that the daily cron then reads — not a pre-built week of events.

## When to invoke

- Fired by the deterministic `0013_weekly_review` cron (Sun 19:00 operator-local, in jobs.json). Maya never self-schedules or adds crons.
- Operator manually requests ("how'd this week go?") — re-synthesize from existing data.

## Pre-conditions

1. ≥ 7 days of `gtmActionLog` rows (skip first weekly review until 7 days have elapsed; surface a placeholder message instead).
2. ≥ 7 days of `gtmPostResults` for owned posts.
3. Foundation tables (`gtmBuyerMap`, `gtmChannelScorecard`, etc.) are populated.

## Required reads

1. **GTM.md** — current bet channels.
2. **USER.md** — operator goals (signups? eyeballs? specific deal?).
3. **SOUL.md** — voice contract.
4. Last 7 days of `gtmActionLog` (Maya reads via `get_my_action_log({ since_ms: <7d ago> })`).
5. Last 7 days of `gtmPostResults` (per-channel performance).
6. **`get_my_attribution({ windowDays: 7 })`** — the week's closed-loop conversion data: per-post `{ clicks, conversionsByKind:{signup,demo,feedback,revenue}, signups }` keyed to `draftId`/`platform`/`title`, plus `totals` (clicks/signups/demos/feedback/revenue/untiedSignups). **This is the north-star read** — it's what tells Maya which posts actually drove customers, not just engagement. Block 2's learnings and Block 4's re-weighting lead off this. The `windowDays:7` is what makes "this week"/"last 7 days" a grounded claim for these numbers — never attach a time-word to numbers from an un-windowed read.
7. Existing `gtmNicheLearnings` (don't re-extract what's already known).
8. **`maya-results-reviewer/SKILL.md` § rule 12 (positioning-vs-distribution).** Run the reviewer over the week's underperforming posts (cached reads — no fresh API spend) and read its `positioningVsDistribution` rollup. The week-level diagnosis feeds Block 3 below.

## The review structure

As tight as Maya can make it while still useful. Four blocks:

### Block 1 — Last week's score

"Week 3: 12 replies sent, 4 owned posts, 8 calendar events completed (of 14 planned). Reddit hit hardest — 47 total upvotes across replies + 2 OP responses. X is quiet — 1 reply with traction, the rest under 10 likes."

Numbers grounded in `gtmActionLog` + `gtmPostResults`. If a metric isn't available, say so — don't fabricate.

**North-Star status (always).** Read the North Star off GTM.md (the `northStarMetric` / target / deadline) and the real conversion numbers from **`get_my_attribution({ windowDays: 7 })`** (`totals.signups`/`demos`/`revenue` this week, plus `untiedSignups`) joined with the running total. State **on-track / at-risk** plainly against the target and pace-to-deadline: "North Star: 100 signups by Day 30. We're at 22 with 18 days left — at-risk; current pace lands ~37. This week drove 6 signups (windowDays:7), and the plan below leans harder into the channel that's actually converting." If attribution shows clicks but no signups this week, say so honestly ("12 clicks to the app this week but no confirmed signups — tell me how many converted so I optimize the right thing") — never pretend likes or clicks are signups. If `untiedSignups > 0`, name it ("3 signups we couldn't tie to a post — wrap every link next week so I can see what's working").

**Activation status (the deeper truth — `maya-activation-coach` owns this).** Signups are only half the story; what grows the business is signups that **stick** (came back / reached value = `totals.activated`). Report the activation rate plainly in user words when I have the data: "12 signed up this week, 3 came back and used it — about 1 in 4 sticking." A **low activation rate is a product/onboarding problem, not a distribution one** — say so directly and DON'T prescribe more posting: "people are showing up and bouncing — more posts won't fix that; the leak is your first-run experience." If activation isn't being tracked yet, that's the concrete ask ("I can see signups but not whether they stuck — one line on your site, or just tell me how many came back, and I'll prove it"). This is the most valuable honest read I can give — see the clicks-no-signups vs signups-no-activation split in `maya-activation-coach`.

### Block 2 — What we learned

3-5 bullets, each a specific pattern from the week. **Conversions first, engagement second.** The north star is customers, so learnings are grounded in what `get_my_attribution({ windowDays: 7 })` shows actually drove clicks → signups, before any engagement-only signal.

**How to derive a learning (conversion-grounded order):**

1. **Rank the week's posts by outcome:** clicks → conversions (signups/demos/revenue) first, engagement only as a tiebreaker. The attribution read gives you `draftId`/`platform`/`title` per converting post — join each back to its draft attributes (`hookType` / `format` / `tone` / posting window) to see *what about the post* converted.
2. **Derive the learning from the converting attribute, not the post:** "hook=pain-restatement drove 4 of 5 signups this week → weight that format up." "r/X drove 30 clicks but 0 signups → demote it next week — traffic that doesn't convert isn't a win." "demo-link CTA out-converted signup-link 3:1 → lead with demo."
3. **Tie format/channel re-weighting to conversions:** a channel that converted gets weighted up; a channel that only got upvotes does not earn a weight bump on engagement alone.

Engagement-only learnings (windows, reciprocation, like-rate) still belong here — but framed as engagement, not falsely as conversion:

- "r/LocalLLaMA Tuesday morning is your strongest *engagement* window — 3 of your top 5 replies landed there (no signups tied yet)."
- "Two relationship targets reciprocated this week — @alice and @bob both replied to your posts."

**Caveats — grounded-or-silent (hard rules):**

- **One signup is not a pattern.** Don't promote a strong conversion learning ("weight pain-restatement up") off a single signup or a single post. A conversion-based learning needs enough evidence — multiple conversions pointing the same way (e.g. ≥3 signups sharing an attribute, or the same attribute converting across ≥2 posts). Below that bar it's a DREAMS.md hypothesis, not a `save_learning`.
- **Thin/empty attribution → fall back honestly.** If attribution is empty or thin this week (few/no clicks, no signups), do NOT fabricate a conversion-based learning. Fall back to engagement signals for the week's learnings — but say so plainly: "No conversions tied to posts this week, so this week's reads are engagement-only — I'll re-judge on conversions once links are landing." Never dress an engagement signal up as a conversion result.
- **Time-words are grounded only via the window.** Say "this week" / "last 7 days" only for the `windowDays:7` attribution numbers. Don't attach a time-word to any number that didn't come from a windowed read.

Each bullet that survives → a `save_learning` call (`gtmNicheLearnings`), with the draft attribute it ties to. Don't dump every observation as a learning; only the ones strong enough to weight next week's surfacing — and conversion-grounded ones outrank engagement-only ones when slots are limited.

### Block 3 — Strategic shift (if any)

Maya proposes a concrete shift if data warrants:

- "Shift: rotating LinkedIn out of bet-channels, X stays but we're switching from hooks to threads."
- "Hold: bet-channel mix is working — keep going."
- "Pause: niche feels slow this week — recommend a content-only week to build the back catalog."
- "Reframe (positioning, not distribution): posts are being seen but not wanted — change the message/who-it's-for next week, don't add cadence. See the positioning check below."

If no shift, say so ("Bets are working — staying the course"). Honesty.

**Positioning-vs-distribution check (feeds the shift decision — the honest-diagnosis link).** Before proposing a *distribution* shift (new channel, more cadence, different posting window), read the `positioningVsDistribution` rollup from `maya-results-reviewer` (required read #8). The diagnosis changes the *kind* of shift, and sometimes refuses one:

- **If the week is a POSITIONING problem** (`positioningProblem: true` — posts got real reach but engagement/clicks/conversions stayed flat: people saw it and didn't want it), say it plainly and do NOT prescribe more distribution. The honest line: **"We're not going to out-post a positioning problem. 1,400 people saw your stuff this week and almost nobody engaged — that's not a reach issue, it's a 'this message isn't landing' issue. More posts of the same framing get the same shrug."** Then propose a **strategy reconsideration, not a cadence bump**: the messaging/audience reframe Maya would test next week (the reviewer's `reframeToTest` is the starting point) — e.g. "I'd test reframing from 'faster builds' to 'ship without a cofounder' and aim it at solo founders instead of agencies. One week, one channel, then we re-read." This is a Block 3 *shift* (change the angle/who-it's-for), and Block 4 then re-weights the bets + persists the reframe as learnings so the daily cron builds around the new angle rather than around 'post more.'
- **If the week is a DISTRIBUTION problem** (posts barely got seen), the shift is legitimately about channel/timing/venue — proceed normally. Note explicitly that the *message is still untested*, so we're fixing reach first and will re-judge the message once it's actually seen.
- **Tier-2 honesty carries through.** If the reviewer marked reach as a soft proxy (`reachSignalConfidence: "proxy_soft"`), carry that caveat into the review — call the positioning read a lean, not a verdict, and say what signal would harden it.

This is the *diagnosis → strategic-shift* linkage only. Do NOT duplicate Block 4's re-weighting logic here — Block 3 decides the *kind* of shift (reframe vs cadence/channel); Block 4 persists that shift as re-weighting + warmth advancement that the daily cron then acts on.

### Block 4 — Re-weight the bets + advance warmth (NOT a regenerated week)

The review doesn't just *extract* learnings — it *feeds them forward*. But it does **NOT** rebuild a rolling 7-day calendar. There is no next-week plan to regenerate — the daily morning cron builds each day fresh from stored ICP knowledge + live channel state. What the weekly review feeds forward is *strategic weighting and warmth state* that the daily cron then reads. Two outputs only:

1. **Re-weight bet channels/angles from the week's outcomes — conversions lead.** Drive the re-weight off `get_my_attribution({ windowDays: 7 })` first: channels/angles/hook-types that produced **conversions** (signups → demos → revenue) earn the most *priority* going forward; channels that drove clicks-without-conversions get demoted (traffic that doesn't convert isn't earning attention); engagement-only signals (upvotes/likes/OP-replies) are the *last* tiebreaker, not the driver. A channel that only got engagement does not out-weight a channel that converted. Persist this re-weighting as `save_learning` calls tied to the converting draft attribute (hook-type / format / channel) — these are exactly the signals `maya-morning-brief` reads each day to decide what to surface. Do NOT generate `gtmCalendarEvents` here; the daily cron owns the calendar. (If attribution is thin this week, weight on engagement but say so per Block 2's fallback rule — don't pretend the re-weight is conversion-grounded.)
2. **Advance per-channel warmth.** Review each bet channel's progress this week against its warmth arc (PLAYBOOK § 2 Phase-1 floor): an account that hit its floor (account age, baseline karma/followers, substantive engagement logged) gets advanced via **`set_channel_warmth({ channel, state })`** — e.g. `new_needs_warmup → warming`, or `warming → warm` once the floor is met. A warm channel unlocks soft/hard launch posting for the daily cron; a channel still cold stays warmup-only. This is the one durable forward-write the weekly review owns over warmth: the daily cron reads `channelWarmthJson` every morning and respects whatever state the review last set. Do NOT advance a channel that didn't actually warm — warmth is grounded in logged activity + age, not optimism.
3. **Counter-overfitting discipline (hard rule).** Do NOT swing strategy on one week or one viral post. A real re-weight needs a *repeated* signal (≥2 data points in a direction), and a big channel shift (dropping/adding a bet channel) needs the 2-week rule — flag it as a hypothesis in DREAMS.md first, act when it's confirmed. One 200-upvote thread is not a format. Likewise, don't advance warmth off a single good day.
4. **Apply the surviving learnings** from Block 2 to the stored weighting (which venues/angles the daily cron should prioritize). The morning cron consumes these — the weekly review's job is to make sure the right learnings + warmth states are persisted, not to pre-schedule the week.

The point: the *strategy* the daily cron acts on is visibly *different* next week because the data moved the weighting + warmth — not because Maya pre-built a calendar. If nothing changed, say why ("bets are working, holding the mix — warmth unchanged") — but that's a decision, not a default.

## What this review writes

Call `log_action({ kind: "weekly_review", ... })`. Plus a `save_learning` call for each surviving learning (these are what the daily morning cron reads to re-weight its surfacing). Plus a `set_channel_warmth({ channel, state })` call for every bet channel whose warmth advanced this week. The weekly review does NOT write `gtmCalendarEvents` and does NOT pre-build next week's drafts — the daily cron writes today's events + drafts each morning from this stored weighting + warmth.

## DREAMS.md write triggers (end of weekly review)

Weekly review is the canonical write window for `DREAMS.md`. After the review message ships and learnings are POSTed:

1. **Open hypotheses** — scan the week for patterns I noticed but lack ≥3 evidence points for. Each hypothesis gets one row with:
   - Date emitted.
   - Hunch in one sentence.
   - The evidence threshold I'd need before promoting it to a `save_learning` call (e.g., "2 more weeks of r/MacStudio outperforming r/LocalLLaMA at >1.5x reply rate").
2. **Drift watch** — anything I'm worried might be drifting without proof yet (operator engagement dropping, voice shifts in the niche, ROI tilts).
3. **Counter-overfitting flags** — single viral hits or one-week wins I should NOT generalize from. "r/X had a single 200-upvote thread this week — not a format, not a learning."
4. **Graduations + retirements** — when a previously-open hypothesis just met its evidence threshold, strike it from DREAMS.md and call `save_learning` for it. When a hypothesis got disconfirmed, strike with `~~~~ — disconfirmed YYYY-MM-DD`.

After each DREAMS.md write, call `record_memory_written({ target, op, triggeredBy })` so the operator UI can show "Maya updated DREAMS.md — 2 new hypotheses, 1 retired".

If a DREAMS.md write fails (filesystem error), do NOT block the weekly review — log `kind: "memory_write_failed"` to action log.

## Strategic-shift discipline

Maya only proposes shifts backed by clear week-over-week data. One bad week is not a shift signal — niches have variance. Two consecutive weeks of underperformance in a channel = shift signal. Stick with what's working until data says otherwise.

If foundation tables look stale to Maya's judgment AND a shift is proposed, Maya bundles a foundation-refresh suggestion: "Strategic shift proposed — also worth refreshing the buyer/competitive map. I can run the full foundation pass tonight if you say go."

## Quality gate

`maya-output-critic` runs over the full message:

- Grounding — every number cites action-log / post-results.
- Voice — strategic review reads like a fractional CMO, not a hype merchant.
- Tier honesty — if the week was thin, the review says so. Don't pad the "wins" section.
- Time-box — as tight as it can be while useful (operator reads on phone). Drafts are separate.

## Failure modes

- **Operator absent all week.** Review opens with: "You were quiet this week — anything I should adjust? I can pause cadence, switch tone, or just keep watching." Then the data summary, briefer.
- **Single data point in a category.** Don't generalize. "One X reply landed, four didn't — too early to call." Don't extract a learning from N=1.
- **Strategic-shift fatigue.** If Maya notices she's been proposing shifts week after week without giving the current approach time to play out, she calls it out honestly: "I keep proposing shifts. That's a sign I should hold and let the current approach run longer. Sticking with the plan." Pattern recognition, not a count.

## Cost discipline

0 ScrapeCreators (uses existing Convex data). 2-3 main_maya calls (synthesis + critic + warmth/re-weight decisions). No week-of-drafts generation (the daily cron drafts each morning). 2-3 min total. Once per week.

## Anti-slop check

Banned for this message: "Crushed it this week," "We're seeing momentum," "leveling up." Replace with concrete numbers + concrete shifts.
