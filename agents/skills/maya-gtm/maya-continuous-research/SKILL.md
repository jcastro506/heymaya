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

1. `sessions_spawn` per-channel target-thread workers (`reddit_continuous_worker`, `x_continuous_worker`, `hn_continuous_worker`, etc.) with task strings containing API endpoints + return-shape (must include `painQuote`, `postedAt`, `velocityScore`, `authorContext`, `commentTreeSummary`, `audienceSize`, `recommendedAction`, `draftReply`, `tier`). **Sprint 2.30 — comment-tree mining is mandatory for Reddit + HN workers.** The worker MUST descend the comment tree (Reddit: fetch the `/comments/<id>.json` endpoint via ScrapeCreators or the public JSON; HN: traverse `kids[]` on the Algolia HN item endpoint) and populate `commentTreeSummary.mineableComments[]` with at minimum the top 5 comments scored against these kinds: `buyer_intent` (someone asked a follow-up the product answers), `pain_restatement` (a comment that re-articulates OP's pain in better buyer language), `competitor_mention` (specific competitor named, with `competitorName`), `op_rejection` (OP responded "tried that, didn't work"), `high_velocity` (>20 upvotes in <2h). Workers without `mineableComments[]` on threads they tier T1/T2 get steered: "I need the comment-tree mining — re-fetch the comments endpoint, score the top 5 against the 5 mining kinds, return as `commentTreeSummary.mineableComments`."
2. Spawn `competitor_move_worker` only if foundation `competitiveMap` is non-empty.
3. Spawn `niche_pulse_worker` once per day max (rate-limited at the prompt level — Maya checks `gtmNichePulse.observedAt` before spawning).
4. `sessions_yield`. Workers run.
5. Watch via `subagents list`. Kill anything stuck longer than its task warrants in Maya's judgment. Steer anything returning thin/wrong-shape output.
6. As `gtmTargetThreads` accumulate, decide "complete enough" against the gates below.

## The questioning loop — Maya audits every thread before it surfaces

**Workers POST target threads with their own judgment of why a thread fits.** Maya doesn't trust that on its face. She reads the actual `painQuote`, `excerpt`, `currentMetrics`, `whyItFits` fields and questions:

- *"You marked this T1, but the velocityScore is 0.3 likes/hour. Why is this a hot strike vs a substance reply?"*
- *"You drafted a reply that leads with the product. Did you read OP's actual question? Lead with the answer to what they asked."*
- *"This thread was posted 6 days ago. Why are you surfacing it as a reply target now? What's the engagement window?"*
- *"Your painQuote is paraphrased, not verbatim. Pull the exact sentence from the post body."*

Maya uses `subagents action=steer` to send pointed refinements. Workers re-extract from their existing context and re-POST. Maya re-reads. If satisfied → keep the thread. If steering doesn't help → drop the thread (don't surface low-confidence work to the operator). If a worker keeps producing slop after multiple steers → kill it and ship without its lane.

The morning brief contains ONLY threads Maya has personally vetted.

## Quality gates — what Maya is checking for

Judgment, not a score:

- **Thread depth gate** — every target thread has `painQuote` populated (verbatim from post body, not from title). If a worker writes a thread with `painQuote: null` or `painQuote === title`, steer with "I need the actual buyer-pain phrase from the post body, not the title."
- **Comment-tree mining gate (Reddit + HN, Sprint 2.30)** — any T1/T2 thread MUST have `commentTreeSummary.mineableComments[]` populated with ≥1 entry. Threads where the worker only scraped OP + ignored comments are missing the most valuable intel (buyer-intent follow-ups, competitor mentions, OP rejections). If a worker tiers T1 with no mineable comments → steer: "fetch the comments tree, score top 5 against the 5 mining kinds, re-POST". If still empty after 1 steer → drop the thread to T3 (still useful as a sub signal but won't surface as a reply target).
- **Freshness gate** — `postedAt` must be within 7 days for substance plays, within 48h for engagement plays. Threads older than that → tier T3 or T4.
- **Platform-norm gate** — HN Show HNs are competitor launches, not reply targets (Tier T4 automatic). Reddit hardware-budget threads are wrong buyer stage (Tier T3 max). X analyst takes with no buyer pain (Tier T4).
- **Author-quality gate** — `authorContext.followerCount` < 50 + zero post history = likely bot. Drop.
- **Coverage gate** — Maya looks at what landed across the bet channels and decides: is this enough good signal for today to be a "strong" day, or honest to call it "thin"? Never pad with low-tier threads to look busy.

## Tier assignment (Maya's call, no hardcoded thresholds)

Each surviving thread gets a tier based on judgment, not a score formula:

- **T1 Hot Strike** — fresh (<4h), high velocity, in bet channel, draft reply lands naturally, pain quote bites. Surface to morning brief with "hit in 30 min" calendar event.
- **T2 Substance Reply** — older but active, OP still engaging, draft reply adds real value. Surface with "reply by EOD" event.
- **T3 Lurk & Learn** — pain match present but no strong reply angle, or audience too small to matter. Stored for context, not surfaced.
- **T4 Trash** — fails platform-norm or author-quality. Stored for learning purposes (so the worker doesn't re-surface it) but never shown.

Write `tier` to each row via the `/lc_gtm/target_thread` re-POST (the mutation update path preserves prior fields you don't overwrite).

## Stop-and-ship signal

Maya stops the loop when she has enough good signal for an honest morning brief, OR when every spawned worker has returned/been killed. She judges "enough" against what the operator actually needs today — not a count.

If workers are still active but the signal so far is dead and re-spawning wouldn't change that, kill them and ship a thin-day brief. Don't burn budget waiting for signal that isn't there.

## Failure modes

- **Worker scrapes raw URLs and gets rate-limited.** Steer with "use api.scrapecreators.com / api.twitterapi.io / hn.algolia.com — never raw reddit.com / x.com." Re-spawn only if steering fails.
- **All workers return T3/T4 only.** Honest thin day. Morning brief leads with warmup + content-draft task instead of replies.
- **One worker dominates the lane.** If `subagents list` shows others have wrapped but one is still grinding past its useful budget in Maya's judgment, kill it. Lane unblocks immediately — proceed to synthesis with what you have.

## Cost discipline

Maya watches call volume vs value returned via `gtmCostLedger`. Per-channel workers route through ScrapeCreators / TwitterAPI.io / Algolia HN per `TOOLS.md`. Continuous research runs before the morning brief and on event-driven hot-alerts. Maya decides when to slow down — there's no fixed cap.

## Anti-slop check

Tier rationales are Maya's notes to herself in `gtmActionLog`, but if surfaced to the operator they must be plain ("active thread, OP is replying, draft has a real hook") — no "high-velocity high-engagement opportunity."
