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
6. If a worker stalls (>5 min in `processing` state per `subagents list`), `subagents kill` it. The lane unblocks immediately — verified from OpenClaw source.
7. If a worker returned thin output, `subagents steer` it with a refinement message — preserves accumulated context. Do not respawn unless steering fails.
8. Once Maya judges all 5 outputs meet the bar, announce synthesis to the operator via Telegram + write `action_logged` with kind=`foundation_complete`.

## Quality gates — when foundation is "complete enough"

Not a procedural checklist. A judgment framework. For each output:

- **Buyer map** — `icpDescription` reads like a specific person, not a category. At least 3 buyer-journey stages with cited locations + intent phrases. At least 5 intent phrases. At least 3 trusted voices with handles + platforms.
- **Competitive map** — at least 3 direct competitors with positioning + complaints (each complaint quotes a real post + URL). Plus at least 2 adjacent or substitute behaviors.
- **Channel scorecard** — all viable channels rated. Exactly 2-3 channels marked `bet: true`. Bets justified in `uniqueUnlock`.
- **Content angles** — at least 15 angles, each with a grounded `painCitation` (quote + sourceUrl). Each with 3+ hook variants that pass voice gate against USER.md.
- **Relationship targets** — at least 20 specific accounts with platform + handle + `whyThem` + `engagementPlan`. Mix of cadences.

If any output is thin, steer the worker. If steering fails twice, ship anyway with the gap surfaced to the operator ("competitive map is thin — only 2 direct comps; I'll keep watching").

## Synthesis message — what the operator gets

One Telegram message (≤200 words):

```
Foundation done. Here's what I learned about your market:

ICP: [one-line icpDescription]
Top 3 channels to bet on: [bet=true list with one-line reason each]
Top 3 buyer-pain angles: [angle names]
Direct competitors worth watching: [names]

Next: [if first run] starting daily research. First brief lands tomorrow 7am.
       [if monthly] here's what shifted vs last month: [3 bullets]
```

Plain text. No headers. No "Excited to share." This is a manager update, not a launch.

## Failure modes

- **Worker returns hallucinated data.** Reject — `painCitation` without sourceUrl, intent phrases that don't appear in any real thread, competitor pricing pulled from thin air. Steer with "every claim needs a URL — drop the ones you can't ground."
- **Worker exceeds budget** (>10 min and 50+ ScrapeCreators calls). Kill. Surface in synthesis: "couldn't complete X, but I have enough to start."
- **All 5 workers thin.** Foundation deferred. Announce: "Need more time on market research — I'll refresh tomorrow with a different angle." Do NOT pad with bad data.

## Cost discipline

5 parallel workers × ~10 min × ~30 ScrapeCreators calls each = budget ~150 calls. If `gtmCostLedger` shows ≥250 in the last hour, slow down. Foundation pass is the most expensive thing Maya does — should not run more than once at onboarding + once monthly.

## Anti-slop check

The synthesis message itself passes slop-critic. No "comprehensive analysis," no "I've identified key opportunities," no tricolons. Plain manager voice.
