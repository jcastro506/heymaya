---
name: maya-foundation-research
description: The onboarding + monthly deep-research pass. Maya orchestrates 5 parallel foundation workers (buyer map, competitive map, channel scorecard, content angles, relationship targets) using OpenClaw native session tools, decides when she has enough across the board, and persists synthesis to Convex.
---

# maya-foundation-research

## Purpose

The operating model. Before Maya can do daily work, she needs an answer to: who buys this, who else is in the market, where do the buyers live, what angles can the founder run from, and who should they build with over 90 days. This skill is the framework for spawning + supervising the 5 foundation workers and deciding when synthesis is complete enough to ship.

## When to invoke

- IF this is the very first wake AND `gtmBuyerMap` is empty for this agent THEN spawn the full foundation pass.
- IF a `/lc_gtm/get_my_foundation` GET returns `buyerMap: null` THEN spawn the full foundation pass.
- IF the monthly cron fires (1st of month, 6am operator local) THEN spawn the full foundation pass and announce diffs.
- IF the operator pivots positioning ("we actually serve X now, not Y") THEN spawn refresh.
- NEVER invoke from a continuous heartbeat — foundation is a budgeted event, not a tick.

## Required reads

1. **APP.md** — product diagnosis (what we sell, who's it for).
2. **USER.md** — operator profile, voice, capacity, comfort zones (will they post video? cold DM?).
3. **GTM.md** — current strategic state (will be empty on first run; that's the cue to populate it).
4. **TOOLS.md** — the `/lc_gtm/foundation_*` endpoints, hookToken, API keys.
5. **PLAYBOOK.md § 6** — voice rules every drafted content angle must clear.

## Native-tool orchestration

The lifecycle uses OpenClaw native tools — **do not hand-roll watchdog state.**

1. `agents_list` to confirm the 5 worker agentIds exist in AGENTS.md: `buyer_map_worker`, `competitive_worker`, `channel_worker`, `content_angle_worker`, `relationship_worker`.
2. `sessions_spawn` 5 workers in parallel, each with a `task:` string containing: product context, API endpoint mandates (ScrapeCreators / TwitterAPI.io / Algolia HN — never raw curl on platform domains), and the specific `/lc_gtm/foundation_*` POST shape they must use.
3. `sessions_yield` and let them run. Check back via `subagents list` + `sessions_history`.
4. While they run, poll `/lc_gtm/get_my_foundation` to see what's landed.
5. As each worker completes or self-terminates (returns NO_REPLY), evaluate quality against the gates below.
6. If a worker has been in `processing` state for longer than the work warrants in Maya's judgment (a small buyer-map sweep shouldn't take as long as a deep competitive scan), `subagents kill` it. The lane unblocks immediately — verified from OpenClaw source.
7. If a worker returned thin output, `subagents steer` it with a refinement message — preserves accumulated context. Do not respawn unless steering fails.
8. Once Maya judges all 5 outputs meet the bar, announce synthesis to the operator via Telegram + write `action_logged` with kind=`foundation_complete`.

## The questioning loop — Maya is the boss, not a passive receiver

**Maya does not blindly accept worker output.** Every worker POST is a claim; Maya treats it as one. She reads what landed in Convex, looks at the actual data, and questions:

- *"Why did you call Ollama a 'direct' competitor? Show me the customer-complaint quotes you anchored that on."*
- *"This buyer journey says 'evaluating' is the second stage — what evidence? Which threads have you seen buyers in that stage?"*
- *"You marked Reddit as a bet channel. What threads did you scan? How recent? How many?"*
- *"Three trusted voices feels light for a niche this active. Steer to look harder."*

For each questionable claim, Maya uses `subagents action=steer` to send the worker a specific, pointed follow-up. Example:

```
subagents action=steer target=<buyer_map_worker run id>
  message: "Your buyer journey has 3 stages but I can't see what
  anchors stage 2 ('evaluating'). What specific subreddits / X
  threads showed you buyers at that stage? Pull 2-3 example URLs +
  the exact phrases buyers used. POST a refined buyer_map when done."
```

Worker reads the steer, re-extracts from its existing research (no new API budget), refines the POST. Maya re-reads. If satisfied → accept that piece. If still thin → steer again. If a worker fails to converge after a few rounds → ship that piece with the gap surfaced honestly to the operator ("competitive map's substitute behaviors are still thin — I'll watch and refine over the first week").

**The operator hears NOTHING until Maya is convinced the research reflects reality.** She is the editorial gate, not the post office.

## Quality framework — what Maya is checking for

This is Maya's judgment, not a checklist. Numbers below are not thresholds — they're context for what "useful" looks like. Apply judgment to your specific niche.

- **Buyer map** — `icpDescription` reads like a specific person, not a category. Buyer journey stages should cover the path the buyer actually walks; each stage cites where the buyer hangs out and the language they use. Intent phrases are real phrases buyers say (not paraphrased). Trusted voices are accounts with verifiable handles + platforms.
- **Competitive map** — covers the direct competitors a buyer would seriously evaluate, plus the substitute behaviors / adjacent tools they default to today. Every complaint quotes a real post + URL.
- **Channel scorecard** — rates the channels worth rating for this product. Bets are channels with both audience-fit and operator-cadence-fit, justified in `uniqueUnlock`. Maya picks the bet count — usually small.
- **Content angles** — enough angles that the operator can run for weeks without repeating, each grounded in a specific quoted pain + URL. Hook variants are in the operator's voice (verify against USER.md).
- **Relationship targets** — specific accounts worth building with over 90 days. Mix of cadences. Skip the obvious follower-count plays — focus on accounts whose audience IS the buyer.

If any output reads thin to Maya's judgment, steer the worker for more. If steering doesn't help, ship with the gap surfaced honestly to the operator ("competitive map landed light on substitutes — I'll keep watching as I do daily research"). Maya decides what "enough" means — there is no minimum count.

## Phase 2 — turn the operating model into a first-week action plan (same pass, no second wait)

Foundation does NOT stop at the operating model. The operator already waited ~10-15 min for the research; making them wait another 8-10 min after they say "yes find threads and draft replies" is a broken UX. **In the same pass, before sending the synthesis message, Maya extends foundation into actionable specifics.**

After the 5 operating-model workers have written enough for Maya to judge complete, she does NOT immediately send synthesis. Instead:

1. **Spawn per-bet-channel "live thread" workers.** For each channel marked `bet: true` in `gtmChannelScorecard` (typically reddit + x, sometimes hn), spawn the matching continuous worker (`reddit_research`, `x_research`, `hn_research`). Task: "Using these intent phrases [from gtmBuyerMap.intentPhrases] and these content angles [from gtmContentAngles], find 5-10 LIVE threads in this channel where buyers are venting about this pain RIGHT NOW. POST each to `/lc_gtm/target_thread` with painQuote (verbatim from post body), postedAt, velocityScore, audienceSize, and a draftReply field with a real reply in the operator's voice." Workers do the find + draft in a single pass.

2. **`sessions_yield`, then watch via `subagents action=list`** the same way as Phase 1. Kill stuck, steer thin.

3. **Build the 7-day calendar.** Once Maya has the target_threads + drafts, she reads `maya-calendar-populator/SKILL.md` and assembles 5-10 `gtmCalendarEvents` for the coming week. Each event MUST contain the full hands-off recipe per the calendar-populator template — URL, drafted reply text, voice notes, success target, time box, source citation. POST each event to `/lc_gtm/calendar_proposal`.

4. **Only THEN send the synthesis message** (below). The message includes the calendar preview and one approve-or-edit ask. The operator's "yes" is the final gate, not a trigger for more work.

## Synthesis message — what the operator gets after the FULL pass

One Telegram message — as tight as Maya can make it while still being useful (operator reads on a phone):

```
Done. Here's the picture + the first week's plan ready for your calendar.

Who's actually buying this: [one-sentence persona, named if possible — e.g.
"a Mac dev running 3-5 local tools at once, 60-80GB of models on their SSD"]

Real pain (verbatim from threads): "[direct quote with sourceUrl]"

Where to play week one: [bet channels with one-line rationale each]

The wedge vs incumbents: [one sentence — what you do that they don't]

5 events queued for your calendar this week:
• [day, time]: [event title, one-line what + where]
• [day, time]: [event title]
• …

Approve and I'll lock them in. Or tell me which to swap.
```

Plain text. No headers. No "Excited to share." This is a manager update with the complete proposal, not a multi-stage handoff. The operator's reply is the ONLY remaining gate.

## Failure modes

- **Worker returns hallucinated data.** Reject — `painCitation` without sourceUrl, intent phrases that don't appear in any real thread, competitor pricing pulled from thin air. Steer with "every claim needs a URL — drop the ones you can't ground."
- **Worker exceeds budget in Maya's judgment** (running too long for the work, burning calls without converging). Kill. Surface in synthesis: "couldn't complete X, but I have enough to start."
- **All 5 workers thin.** Foundation deferred. Announce: "Need more time on market research — I'll refresh tomorrow with a different angle." Do NOT pad with bad data.

## Cost discipline

Foundation is the most expensive thing Maya does. She watches `gtmCostLedger` and slows down if call volume is getting unreasonable for the value being returned. Runs at onboarding + monthly refresh — not on demand.

## Anti-slop check

The synthesis message itself passes slop-critic. No "comprehensive analysis," no "I've identified key opportunities," no tricolons. Plain manager voice.
