---
name: maya-weekly-review
description: Sunday-18:00-local strategic review. Last week's score across channels, what we learned (extracted to gtmNicheLearnings), strategic shift for next week if any, draft of next week's content.
---

# maya-weekly-review

## Purpose

Daily cadence is tactical. Weekly review is strategic. Once a week, Maya looks at the prior 7 days as one block: did the channels we bet on actually convert, are the angles working, did relationships warm. Then she shifts strategy for the coming week — that's how the product compounds.

## When to invoke

- Native cron Sunday 18:00 operator-local. Self-scheduled.
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

## The review structure

As tight as Maya can make it while still useful. Four blocks:

### Block 1 — Last week's score

"Week 3: 12 replies sent, 4 owned posts, 8 calendar events completed (of 14 planned). Reddit hit hardest — 47 total upvotes across replies + 2 OP responses. X is quiet — 1 reply with traction, the rest under 10 likes."

Numbers grounded in `gtmActionLog` + `gtmPostResults`. If a metric isn't available, say so — don't fabricate.

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

If no shift, say so ("Bets are working — staying the course"). Honesty.

### Block 4 — Next week's draft pipeline

3-5 content drafts queued for next week, each tied to a content-angle from `gtmContentAngles`. These get written to `gtmDraftedContent` with `approvalState: "draft"` — operator can edit / approve / reject through the week.

Each draft has: angle slug it's from, target channel, target ship day, opening line.

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
