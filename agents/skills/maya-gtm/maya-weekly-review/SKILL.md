---
name: maya-weekly-review
description: Sunday-19:00-local strategic review. Last week's score across channels + North-Star on-track/at-risk, what we learned (extracted to gtmNicheLearnings), strategic shift for next week if any, and a regenerated next-week plan re-weighted by what actually converted.
---

# maya-weekly-review

## Purpose

Daily cadence is tactical. Weekly review is strategic. Once a week, Maya looks at the prior 7 days as one block: did the channels we bet on actually convert, are the angles working, did relationships warm. Then she shifts strategy for the coming week — that's how the product compounds.

## When to invoke

- Native cron Sunday 19:00 operator-local. Self-scheduled.
- Operator manually requests ("how'd this week go?") — re-synthesize from existing data.

## Pre-conditions

1. ≥ 7 days of `gtmActionLog` rows (skip first weekly review until 7 days have elapsed; surface a placeholder message instead).
2. ≥ 7 days of `gtmPostResults` for owned posts.
3. Foundation tables (`gtmBuyerMap`, `gtmChannelScorecard`, etc.) are populated.

## Required reads

1. **GTM.md** — current bet channels.
2. **USER.md** — operator goals (signups? eyeballs? specific deal?).
3. **SOUL.md** — voice contract.
4. Last 7 days of `gtmActionLog` (Maya reads via `/lc_gtm/get_my_action_log?since_ms=<7d ago>`).
5. Last 7 days of `gtmPostResults` (per-channel performance).
6. Existing `gtmNicheLearnings` (don't re-extract what's already known).
7. **`maya-results-reviewer/SKILL.md` § rule 12 (positioning-vs-distribution).** Run the reviewer over the week's underperforming posts (cached reads — no fresh API spend) and read its `positioningVsDistribution` rollup. The week-level diagnosis feeds Block 3 below.

## The review structure

As tight as Maya can make it while still useful. Four blocks:

### Block 1 — Last week's score

"Week 3: 12 replies sent, 4 owned posts, 8 calendar events completed (of 14 planned). Reddit hit hardest — 47 total upvotes across replies + 2 OP responses. X is quiet — 1 reply with traction, the rest under 10 likes."

Numbers grounded in `gtmActionLog` + `gtmPostResults`. If a metric isn't available, say so — don't fabricate.

**North-Star status (always).** Read the North Star off GTM.md (the `northStarMetric` / target / deadline) and the real outcome numbers from `/lc_gtm/get_my_recent_post_results` + the conversions I've recorded (`record_conversion`). State **on-track / at-risk** plainly against the target and pace-to-deadline: "North Star: 100 signups by Day 30. We're at 22 with 18 days left — at-risk; current pace lands ~37. The plan below leans harder into the channel that's actually converting." If I have clicks but no signup data, say so honestly ("12 clicks to the app this week but no signup confirmations — tell me how many converted so I optimize the right thing") — never pretend likes are signups.

### Block 2 — What we learned

3-5 bullets, each a specific pattern from the week. Examples:

- "r/LocalLLaMA Tuesday morning is your strongest window — 3 of your top 5 replies landed there."
- "Hardware-spec hooks on X are flat. Workflow-pain hooks pulled 4x the engagement."
- "Two relationship targets reciprocated this week — @alice and @bob both replied to your posts."

Each bullet that survives → `learning_extracted` POST. Don't dump every observation as a learning; only the ones strong enough to weight next week's surfacing.

### Block 3 — Strategic shift (if any)

Maya proposes a concrete shift if data warrants:

- "Shift: rotating LinkedIn out of bet-channels, X stays but we're switching from hooks to threads."
- "Hold: bet-channel mix is working — keep going."
- "Pause: niche feels slow this week — recommend a content-only week to build the back catalog."
- "Reframe (positioning, not distribution): posts are being seen but not wanted — change the message/who-it's-for next week, don't add cadence. See the positioning check below."

If no shift, say so ("Bets are working — staying the course"). Honesty.

**Positioning-vs-distribution check (feeds the shift decision — the honest-diagnosis link).** Before proposing a *distribution* shift (new channel, more cadence, different posting window), read the `positioningVsDistribution` rollup from `maya-results-reviewer` (required read #7). The diagnosis changes the *kind* of shift, and sometimes refuses one:

- **If the week is a POSITIONING problem** (`positioningProblem: true` — posts got real reach but engagement/clicks/conversions stayed flat: people saw it and didn't want it), say it plainly and do NOT prescribe more distribution. The honest line: **"We're not going to out-post a positioning problem. 1,400 people saw your stuff this week and almost nobody engaged — that's not a reach issue, it's a 'this message isn't landing' issue. More posts of the same framing get the same shrug."** Then propose a **strategy reconsideration, not a cadence bump**: the messaging/audience reframe Maya would test next week (the reviewer's `reframeToTest` is the starting point) — e.g. "I'd test reframing from 'faster builds' to 'ship without a cofounder' and aim it at solo founders instead of agencies. One week, one channel, then we re-read." This is a Block 3 *shift* (change the angle/who-it's-for), and Block 4 then regenerates the plan around the reframe rather than around 'post more.'
- **If the week is a DISTRIBUTION problem** (posts barely got seen), the shift is legitimately about channel/timing/venue — proceed normally. Note explicitly that the *message is still untested*, so we're fixing reach first and will re-judge the message once it's actually seen.
- **Tier-2 honesty carries through.** If the reviewer marked reach as a soft proxy (`reachSignalConfidence: "proxy_soft"`), carry that caveat into the review — call the positioning read a lean, not a verdict, and say what signal would harden it.

This is the *diagnosis → strategic-shift* linkage only. Do NOT duplicate Block 4's plan-regeneration logic here — Block 3 decides the *kind* of shift (reframe vs cadence/channel); Block 4 rebuilds the plan around whichever Block 3 chose.

### Block 4 — Regenerate next week's plan (NOT a one-way ratchet)

The review doesn't just *extract* learnings — it *feeds them forward*. Rebuild the rolling 7-day plan for the coming week, re-weighted by what actually worked:

1. **Re-weight bet channels/angles from the week's outcomes.** Channels/angles that produced real outcomes (clicks → conversions first, then OP-replies/engagement) get MORE slots next week; flat ones get fewer. Read `maya-calendar-populator/SKILL.md` and regenerate the rolling 7-day `gtmCalendarEvents` (today→Sunday) with the new weighting — don't just append to last week's stale plan.
2. **Counter-overfitting discipline (hard rule).** Do NOT swing the whole plan on one week or one viral post. A real re-weight needs a *repeated* signal (≥2 data points in a direction), and a big channel shift (dropping/adding a bet channel) needs the 2-week rule — flag it as a hypothesis in DREAMS.md first, act when it's confirmed. One 200-upvote thread is not a format.
3. **Apply the surviving learnings** from Block 2 to the surfacing (which venues/angles to prioritize) and to the drafts.
4. **Draft pipeline:** 3-5 content drafts for next week, each tied to a `gtmContentAngles` slug, written to `gtmDraftedContent` (`approvalState: "draft"`) — operator can edit/approve/reject through the week. Each draft: angle slug, target channel, ship day, opening line. **Wrap every product link via `/lc_gtm/wrap_link`** so next week's clicks are attributable.

The point: next week's plan is visibly *different* from this week's because the data moved it. If nothing changed, say why ("bets are working, holding the mix") — but that's a decision, not a default.

## What this review writes

POST to `/lc_gtm/action_logged` with kind=`weekly_review`. Plus POST for each `learning_extracted`. Plus drafts as `gtmDraftedContent` rows (via the existing drafted-content endpoint).

## DREAMS.md write triggers (end of weekly review)

Weekly review is the canonical write window for `DREAMS.md`. After the review message ships and learnings are POSTed:

1. **Open hypotheses** — scan the week for patterns I noticed but lack ≥3 evidence points for. Each hypothesis gets one row with:
   - Date emitted.
   - Hunch in one sentence.
   - The evidence threshold I'd need before promoting it to a `learning_extracted` (e.g., "2 more weeks of r/MacStudio outperforming r/LocalLLaMA at >1.5x reply rate").
2. **Drift watch** — anything I'm worried might be drifting without proof yet (operator engagement dropping, voice shifts in the niche, ROI tilts).
3. **Counter-overfitting flags** — single viral hits or one-week wins I should NOT generalize from. "r/X had a single 200-upvote thread this week — not a format, not a learning."
4. **Graduations + retirements** — when a previously-open hypothesis just met its evidence threshold, strike it from DREAMS.md and write the corresponding `learning_extracted`. When a hypothesis got disconfirmed, strike with `~~~~ — disconfirmed YYYY-MM-DD`.

After each DREAMS.md write, POST `/lc_gtm/memory_written` (idempotent uuid) so the operator UI can show "Maya updated DREAMS.md — 2 new hypotheses, 1 retired".

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

0 ScrapeCreators (uses existing Convex data). 2-3 main_maya calls (synthesis + critic + draft generation). 2-3 min total. Once per week.

## Anti-slop check

Banned for this message: "Crushed it this week," "We're seeing momentum," "leveling up." Replace with concrete numbers + concrete shifts.
