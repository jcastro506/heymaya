---
name: maya-continuous-research
description: The daily research loop. Maya spawns per-channel workers for target threads, competitor moves, and niche pulse, watches them via native session tools, and stops the moment she has enough for a strong morning brief. Decides "thin day" honestly when signal is dead.
---

# maya-continuous-research

## Purpose

Foundation research builds the operating model. Continuous research feeds the daily cadence. Each cycle answers: are there new buyer-pain threads worth engaging with, did competitors ship anything important, is the niche moving (new sub, rising account, dying topic)? The skill is the framework for orchestrating + judging the continuous workers.

## When to invoke

- IF the morning-brief cron is about to fire AND last-research `observedAt` > 6h ago THEN spawn continuous workers.
- IF the operator pings Maya outside the cadence and the brief-data is stale (>4h) THEN spawn.
- IF a hot-alert HEARTBEAT condition fires (e.g., a competitor moved) THEN spawn targeted worker — not the full set.
- NEVER spawn during the engagement window of a queued T1 thread (avoid distracting Maya from time-sensitive action).

## Required reads

1. **GTM.md** — bet channels from the scorecard. Only spawn workers for bet=true channels by default. Maya may sweep a non-bet channel monthly for verification.
2. **APP.md** — pain framing, keywords, exclusion list.
3. **USER.md** — operator timezone, capacity (don't propose 5 events if they have 30 min).
4. **TOOLS.md** — `/lc_gtm/target_thread`, `/lc_gtm/competitor_move`, `/lc_gtm/niche_pulse_signal`.

## Native-tool orchestration

The same control-plane discipline as foundation:

1. `sessions_spawn` per-channel target-thread workers (`reddit_continuous_worker`, `x_continuous_worker`, `hn_continuous_worker`, etc.) with task strings containing API endpoints + return-shape (must include `painQuote`, `postedAt`, `velocityScore`, `authorContext`, `commentTreeSummary`, `audienceSize`, `recommendedAction`, `draftReply`, `tier`).
2. Spawn `competitor_move_worker` only if foundation `competitiveMap` is non-empty.
3. Spawn `niche_pulse_worker` once per day max (rate-limited at the prompt level — Maya checks `gtmNichePulse.observedAt` before spawning).
4. `sessions_yield`. Workers run.
5. Watch via `subagents list`. Kill anything in `processing` for >4 min. Steer anything returning thin/wrong-shape output.
6. As `gtmTargetThreads` accumulate, decide "complete enough" against the gates below.

## Quality gates — when continuous research is "done"

Judgment, not a score:

- **Thread depth gate** — every target thread has `painQuote` populated (verbatim from post body, not from title). If a worker writes a thread with `painQuote: null` or `painQuote === title`, steer with "I need the actual buyer-pain phrase from the post body, not the title."
- **Freshness gate** — `postedAt` must be within 7 days for substance plays, within 48h for engagement plays. Threads older than that → tier T3 or T4.
- **Platform-norm gate** — HN Show HNs are competitor launches, not reply targets (Tier T4 automatic). Reddit hardware-budget threads are wrong buyer stage (Tier T3 max). X analyst takes with no buyer pain (Tier T4).
- **Author-quality gate** — `authorContext.followerCount` < 50 + zero post history = likely bot. Drop.
- **Coverage gate** — at least 1 T1 OR 2 T2 across the bet channels. If not, the day is a thin day. Do not pad.

## Tier assignment (Maya's call, no hardcoded thresholds)

Each surviving thread gets a tier based on judgment, not a score formula:

- **T1 Hot Strike** — fresh (<4h), high velocity, in bet channel, draft reply lands naturally, pain quote bites. Surface to morning brief with "hit in 30 min" calendar event.
- **T2 Substance Reply** — older but active, OP still engaging, draft reply adds real value. Surface with "reply by EOD" event.
- **T3 Lurk & Learn** — pain match present but no strong reply angle, or audience too small to matter. Stored for context, not surfaced.
- **T4 Trash** — fails platform-norm or author-quality. Stored for learning purposes (so the worker doesn't re-surface it) but never shown.

Write `tier` to each row via the `/lc_gtm/target_thread` re-POST (the mutation update path preserves prior fields you don't overwrite).

## Stop-and-ship signal

Once Maya has either (a) 5+ T1/T2 threads or (b) every spawned worker has returned or been killed, she stops the loop and hands off to `maya-morning-brief`.

If after 8 min the loop has 0 T1/T2 threads and 2+ workers are still active, **kill them and ship a thin-day brief.** Don't wait for signal that isn't there.

## Failure modes

- **Worker scrapes raw URLs and gets rate-limited.** Steer with "use api.scrapecreators.com / api.twitterapi.io / hn.algolia.com — never raw reddit.com / x.com." Re-spawn only if steering fails.
- **All workers return T3/T4 only.** Honest thin day. Morning brief leads with warmup + content-draft task instead of replies.
- **One worker dominates the lane.** If `subagents list` shows a worker has been processing for 4 min and the others have wrapped, kill it. The lane unblocks immediately — Maya can proceed to synthesis.

## Cost discipline

Typical day: 3-4 workers × 8 min × ~15 ScrapeCreators / TwitterAPI calls each = ~50 calls per cycle. Cycle runs once before the morning brief and again before the evening recap if a hot-alert needs verification. Hard cap at 4 cycles/day.

## Anti-slop check

Tier rationales are Maya's notes to herself in `gtmActionLog`, but if surfaced to the operator they must be plain ("active thread, OP is replying, draft has a real hook") — no "high-velocity high-engagement opportunity."
