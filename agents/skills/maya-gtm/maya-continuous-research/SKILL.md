---
name: maya-continuous-research
description: The daily research loop. Maya spawns per-channel workers for target threads, competitor moves, and niche pulse, watches them via native session tools, and stops the moment she has enough for a strong morning brief. Decides "thin day" honestly when signal is dead.
---

# maya-continuous-research

## Purpose

Foundation research builds the operating model. Continuous research feeds the daily cadence. Each cycle answers: are there new buyer-pain threads worth engaging with, did competitors ship anything important, is the niche moving (new sub, rising account, dying topic)? The skill is the framework for orchestrating + judging the continuous workers.

## When to invoke

- IF the morning-brief cron is about to fire AND last-research `observedAt` > 6h ago THEN spawn the FULL continuous sweep (all bet channels, deep).
- IF the **`midday_pulse` cron fires (~1pm operator-local)** THEN run the **LIGHT midday re-sweep** (see "Midday pulse" below) — NOT the full morning sweep. This is the catch-before-peak pass: discovery does not freeze after 7am, it checks again midday for fresh hot-strike threads that surfaced since the brief.
- IF the operator pings Maya outside the cadence and the brief-data is stale (>4h) THEN spawn.
- IF a hot-alert HEARTBEAT condition fires (e.g., a competitor moved) THEN spawn a single targeted worker — not the full set. Fresh-thread DISCOVERY is NOT a heartbeat trigger: the heartbeat monitors the founder's own posts/inbound and escalates only on its defined conditions (competitor move, a reply hitting ~5x baseline, unanswered inbound). New buyer-thread discovery happens via the scheduled crons ONLY — the morning sweep and the `midday_pulse` light re-sweep below.
- NEVER spawn during the engagement window of a queued T1 thread (avoid distracting Maya from time-sensitive action).

## Midday pulse — the catch-before-peak re-sweep (light, fresh-only)

The morning sweep is once-daily and deep; buyer threads are a continuous stream. A thread that pops at 11am, peaks by 2pm, and dies by 6pm would be invisible until tomorrow's brief — by which point it's cold. The `midday_pulse` cron closes that gap. It is deliberately **lighter and tighter** than the morning full sweep:

- **Scope: only the 1-2 bet channels** (Reddit / X / HN per `GTM.md`) — never the full channel set, never non-bet channels.
- **Fresh-only filter:** look for threads posted or heating up SINCE the morning sweep's last `observedAt` (Maya reads the most recent `gtmTargetThreads.observedAt` / `gtmNichePulse.observedAt` and filters to what's newer). Don't re-surface what the morning brief already covered.
- **Velocity, not absolute count** — this is the "catch it before it peaks" pass. A thread rising fast for its age beats a thread that already has more total upvotes but has gone flat. Tier strictly: only a genuine **T1 Hot Strike** (fresh, high velocity, real ICP fit, a draft reply that lands naturally) earns a spot.
- **Fewer workers, shorter run, hard budget cap.** Spawn one scoped worker per bet channel (not the full per-channel + competitor + niche-pulse fan-out). Cap the run short — this is a quick velocity check, not a deep mine. Watch `gtmCostLedger`; if a channel is quiet, stop early.
- **ADD to today's calendar — NEVER replace.** For any surviving T1, INSERT a new `gtmCalendarEvents` reply-window into today (full hands-off recipe, same shape as the morning brief). Existing events stay exactly as they are — the midday pulse only ever adds. This honors the standing "ADD, don't replace" rule.
- **One one-tap ping, or honest silence.** If a genuinely hot thread landed, fire ONE batched Telegram ping ("a fresh r/LocalLLaMA thread just went live and it's moving fast — I dropped a ready reply in your plan, hit it in the next hour"). If nothing genuinely high-priority landed, **say nothing** — no "checked, nothing hot" noise. Silent-when-nothing is correct; the founder's phone is not a feed.

Everything below (questioning loop, quality gates, tier assignment, anti-slop) applies to the midday pulse too — it's the same discipline, just smaller in scope.

## Required reads

1. **GTM.md** — bet channels from the scorecard. Only spawn workers for bet=true channels by default. Maya may sweep a non-bet channel monthly for verification.
2. **APP.md** — pain framing, keywords, exclusion list.
3. **USER.md** — operator timezone, capacity (don't propose 5 events if they have 30 min).
4. **TOOLS.md** — the typed tools `save_target_thread`, `save_competitor_move`, `save_niche_pulse_signal`.

## Weekly channel split — research the right channels harder on the right days

The morning sweep spawns workers for the bet channels, but Maya doesn't research all of them equally hard every single day — she spreads the depth across the WEEK by judgment, the same rotation the morning brief plans against. This isn't a hardcoded table; it's reasoning over each channel's norms + where the signal is:

- **Match the dig to the channel's rhythm.** Reddit + HN reward midweek depth (post windows Tue/Wed/Thu, Show HN one-shot) — dig hardest there midweek. X is the always-on daily reply engine — sweep it every day, lighter but never skipped. LinkedIn (if a bet) is a Tue-Thu channel — don't burn a deep LinkedIn worker on a weekend when B2B is dead.
- **Follow the live signal.** If yesterday's brief shows one channel is producing all the converting threads (cross-check `gtmNicheLearnings` channel_priority + recent `gtmActionLog`), tilt today's deeper workers there — but don't let any one bet channel go un-swept for days. A channel Maya hasn't looked at in 3 days gets a real sweep even if another channel is hotter, so the week stays balanced and no bet rots.
- **Don't dump the whole channel set into one exhausting day.** Rotating which channels get the deep dig keeps cost down AND keeps each channel's intel fresh on its own natural clock, instead of stale-for-six-days-then-blitzed.

The output of this is what the morning brief turns into today's channel mix. Maya's job in research is to make sure the *signal she surfaces* is spread across the bets over the week, not concentrated in whichever channel happens to be loudest today.

## Native-tool orchestration

The same control-plane discipline as foundation:

1. `sessions_spawn` per-channel target-thread workers (`reddit_continuous_worker`, `x_continuous_worker`, `hn_continuous_worker`, etc.) with task strings naming the research tools they must use + return-shape (must include `painQuote`, `postedAt`, `velocityScore`, `engagementWindow` (the worker's read on whether the OP is still replying and new comments are still landing), `authorContext`, `commentTreeSummary`, `audienceSize`, `recommendedAction`, `draftReply`, `tier`). **Comment-tree mining is mandatory for Reddit + HN workers, and it goes deep.** The worker MUST descend the **full comment tree, including nested replies** (Reddit: `research_reddit_comments({ url })` and follow `replies` down; HN: `research_hn_item({ objectId })` and recurse `children[]`) — **do not stop at the top few comments.** The sharpest buyer language (someone restating the pain in better words, naming the competitor they're escaping, rejecting a workaround) usually sits *deeper* in the thread, not in the top-voted comments. Go as deep as it takes to be confident, then populate `commentTreeSummary.mineableComments[]` with the strongest comments scored against these kinds: `buyer_intent` (someone asked a follow-up the product answers), `pain_restatement` (re-articulates OP's pain in sharper buyer language), `competitor_mention` (specific competitor named, with `competitorName`), `op_rejection` (OP responded "tried that, didn't work"), `high_velocity` (a comment gaining traction unusually fast for the thread's age — Maya's judgment, never a fixed number). Workers without `mineableComments[]` on threads they tier T1/T2 get steered: "I need the comment-tree mining — descend the comments (all the way down, not just the top) via research_reddit_comments / research_hn_item, score the strongest against the mining kinds, return as `commentTreeSummary.mineableComments`."
2. Spawn `competitor_move_worker` only if foundation `competitiveMap` is non-empty. When that worker re-reads a competitor's site via `search_web`, run it through **`maya-open-web-read`** (teardown checklist + verbatim quote + URL) — a competitor's new pricing tier or repositioning is a move worth catching. Occasionally (NOT daily — cost-bounded) re-check rising demand on the key buyer phrases via `search_demand`, read through **`maya-demand-intelligence`** (a phrase whose volume/CPC is climbing is a real "demand is rising here" signal to surface).
3. Spawn `niche_pulse_worker` at the morning sweep, plus at most ONE additional lightweight velocity-check on the `midday_pulse` (rate-limited at the prompt level — Maya checks `gtmNichePulse.observedAt` before spawning, and the midday check is a cheap "is anything rising since this morning" pass, not a full re-scan). The reason for the second look: a trend that emerges after the morning sweep should be caught while it's still RISING (continuous-research's own rule — rising > already-peaked), not after it crests tomorrow. **S8 — "trending in your niche today" must be velocity-ranked AND pre-drafted, not an FYI.** The worker surfaces trending topics/formats ranked by velocity (rising > already-peaked — a trend you can still catch beats one that crested yesterday); for the top 1-2, Maya **pre-drafts the product twist** via maya-content-format-miner: a ready post/reply that rides the trend with THIS product's angle (activation moment as proof, wedge as hook), so the morning brief hands the operator a one-tap ride-the-trend draft — never just "X is trending, fyi." A trend surfaced without a ready twisted draft is half a job.
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
- **Comment-tree mining gate (Reddit + HN)** — any T1/T2 thread MUST have `commentTreeSummary.mineableComments[]` carrying at least one *substantive* buyer signal (`buyer_intent`, `pain_restatement`, `competitor_mention`, or `op_rejection`). A thread whose only mined signal is `high_velocity` is loud but not necessarily a buyer conversation — it caps at T3 unless Maya sees a real reply angle. Threads where the worker only scraped OP + ignored comments are missing the most valuable intel. If a worker tiers T1/T2 with no mineable comments → steer: "descend the comments tree (all the way, not just the top), score the strongest against the mining kinds, re-POST". If still empty after 1 steer → drop to T3.
- **Freshness + engagement-window gate** — age matters (`postedAt` within ~7 days for substance plays, ~48h for engagement plays), but the sharper question is whether the thread is *still alive*: is the OP still replying, are new comments still landing? A 5-day-old thread where the OP is actively answering today beats a 12-hour-old thread that already went quiet. A thread that's gone cold (OP absent, comments stalled) drops to T3 even if it's recent — replying into a dead thread is theater.
- **Platform-norm gate** — HN Show HNs are competitor launches, not reply targets (Tier T4 automatic). Reddit hardware-budget threads are wrong buyer stage (Tier T3 max). X analyst takes with no buyer pain (Tier T4).
- **Author-quality gate** — `authorContext.followerCount` < 50 + zero post history = likely bot. Drop.
- **Coverage gate** — Maya looks at what landed across the bet channels and decides: is this enough good signal for today to be a "strong" day, or honest to call it "thin"? Never pad with low-tier threads to look busy.

## Tier assignment (Maya's call, no hardcoded thresholds)

Each surviving thread gets a tier based on judgment, not a score formula:

- **T1 Hot Strike** — fresh (<4h), high velocity, in bet channel, draft reply lands naturally, pain quote bites. Surface to morning brief with "hit in 30 min" calendar event.
- **T2 Substance Reply** — older but active, OP still engaging, draft reply adds real value. Surface with "reply by EOD" event.
- **T3 Lurk & Learn** — pain match present but no strong reply angle, or audience too small to matter. Stored for context, not surfaced.
- **T4 Trash** — fails platform-norm or author-quality. Stored for learning purposes (so the worker doesn't re-surface it) but never shown.

Write `tier` to each row via a `save_target_thread` re-call (the update path preserves prior fields you don't overwrite).

## Stop-and-ship signal

Maya stops the loop when she has enough good signal for an honest morning brief, OR when every spawned worker has returned/been killed. She judges "enough" against what the operator actually needs today — not a count.

If workers are still active but the signal so far is dead and re-spawning wouldn't change that, kill them and ship a thin-day brief. Don't burn budget waiting for signal that isn't there.

## Failure modes

- **Worker scrapes raw URLs and gets rate-limited.** Steer with "use the research tools (research_reddit, research_x, research_hn, scrape_creators) — never raw reddit.com / x.com." Re-spawn only if steering fails.
- **All workers return T3/T4 only.** Honest thin day. Morning brief leads with warmup + content-draft task instead of replies.
- **One worker dominates the lane.** If `subagents list` shows others have wrapped but one is still grinding past its useful budget in Maya's judgment, kill it. Lane unblocks immediately — proceed to synthesis with what you have.

## Cost discipline

Maya watches call volume vs value returned via `gtmCostLedger`. Per-channel workers route through the research tools (research_reddit / research_x / research_hn / scrape_creators) per `TOOLS.md`. Continuous research runs in three modes, in descending cost: the FULL sweep before the morning brief (deep, all bet channels), the LIGHT `midday_pulse` re-sweep (bet channels only, fresh-only, fewer/shorter workers — deliberately a fraction of the morning cost), and event-driven hot-alerts (single targeted worker). Maya decides when to slow down — there's no fixed cap, but the midday pulse must stay cheap: if it starts costing like a second full sweep, it's doing too much.

## Anti-slop check

Tier rationales are Maya's notes to herself in `gtmActionLog`, but if surfaced to the operator they must be plain ("active thread, OP is replying, draft has a real hook") — no "high-velocity high-engagement opportunity."
