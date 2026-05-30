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
- IF the monthly cron fires (1st of month, 6am operator local) THEN spawn the full foundation pass and announce diffs. **Also refresh PLATFORM_ALGO.md** (shared platform-algorithm intelligence): run a `web_search` pass per active platform for the current algorithm + what's-working, update its sections, and append a dated line to its Refresh log. This keeps format/timing/draft decisions current month-over-month.
- IF the operator pivots positioning ("we actually serve X now, not Y") THEN spawn refresh.
- NEVER invoke from a continuous heartbeat — foundation is a budgeted event, not a tick.

## Required reads

1. **APP.md** — product diagnosis (what we sell, who's it for).
2. **USER.md** — operator profile, voice, capacity, comfort zones (will they post video? cold DM?).
3. **GTM.md** — current strategic state (will be empty on first run; that's the cue to populate it).
4. **TOOLS.md** — the `/lc_gtm/foundation_*` endpoints, hookToken, API keys.
5. **PLAYBOOK.md § 6** — voice rules every drafted content angle must clear.

## Phase 0 — manager mode: start from their own accounts

Check APP.md "Entry mode" first. If **manager mode** (already-launched founder), before any niche research, ingest the founder's OWN existing accounts: pull each handle in APP.md/USER.md via the scrapecreators-api skill (their recent posts + engagement), and judge what's already working for THEM — which formats/angles/cadence land, where their audience already is, their actual voice. This is where you pick up; it seeds the buyer map, content angles, and the voice profile with real first-party signal instead of a cold start. In **launch mode**, skip this (glance at any existing handles for voice only) and build from the niche. If the mode is unresolved, pull their accounts if handles exist and use what you find to propose the mode at synthesis.

## Native-tool orchestration — ONE fan-out, no skippable phases

**The hard lesson (live, 2026-05-29): a multi-phase "strategy first, THEN go do discovery, THEN build the calendar" plan is where K2 bails — it finishes strategy and announces with an empty plan.** The strategy workers land reliably because each one *is* a self-contained POST. So the actionable layer is built the same way: **demand workers spawned in the SAME fan-out, each owning a complete unit end to end (find thread → draft → POST thread + draft + calendar event).** There is no separate "Phase 2 / Phase 3" for K2 to skip — the plan assembles itself from the workers' per-item POSTs. Maya supervises the one fan-out, curates lightly, and surfaces once it's all in the database.

The lifecycle uses OpenClaw native tools — **do not hand-roll watchdog state.**

1. `agents_list` to confirm the worker agentIds exist: the 5 STRATEGY workers (`buyer_map_worker`, `competitive_worker`, `channel_worker`, `content_angle_worker`, `relationship_worker`) AND the per-channel DEMAND workers (`reddit_research`, `x_research`, `hn_research`, `linkedin_research`, etc.).
2. **`sessions_spawn` the WHOLE fan-out in parallel — strategy workers AND demand workers together, in one batch:**
   - The **5 strategy workers** — each POSTs its `/lc_gtm/foundation_*` artifact (the proven-reliable shape).
   - A **demand worker per channel the product obviously fits** — judge the obvious channels from APP.md's archetype in seconds; DON'T wait for the channel scorecard to come back (a dev-tool is Reddit/X/HN; a B2B SaaS adds LinkedIn; a consumer/video product adds TikTok/IG). Seed each demand worker's searches straight from APP.md's product pain — it doesn't need the content-angle worker to finish first. Each demand worker owns a complete actionable unit per item (see the demand task string below): POST the thread + the drafted reply + its calendar event. If the channel_worker later parks a channel, drop that channel's threads in the curation pass — cheap, and far better than an empty plan.
3. `sessions_yield` and let them run. Check back via `subagents list` + `sessions_history`.
4. While they run, poll `/lc_gtm/get_my_foundation` to watch BOTH the strategy artifacts AND `gtmTargetThreads` / `gtmDraftedContent` / `gtmCalendarEvents` fill in.
5. As each worker completes or self-terminates (returns NO_REPLY), evaluate against the gates below.
6. If a worker is stuck in `processing` longer than the work warrants, `subagents kill` it — the lane unblocks immediately.
7. If a worker returned thin output, `subagents steer` it (preserves context). Do not respawn unless steering fails. **A demand worker that "finished" with zero threads POSTed gets steered, not accepted** — "I don't see your threads in the database; POST each one to /lc_gtm/target_thread + its draft + calendar event as you find it, not at the end."
8. **The actionable layer is built by the fan-out, not by a later Maya step.** When the workers report done, Maya does the light curation pass (below), then the HARD completion check: re-read `GET /lc_gtm/get_my_foundation` and confirm `gtmTargetThreads` has real rows, `gtmDraftedContent` has a draft per reply target, AND `gtmCalendarEvents` is a full week. **Until that read passes, foundation is NOT done — Maya does not announce the plan, does not say "building your calendar," does not append `foundation_completed_at`.** If threads/drafts/calendar are empty, that means the demand workers didn't land — re-spawn / steer them, don't paper over it with a from-scratch improvisation.

### Progress pings while I work (so the wait feels like watching a pro, not a black box)
During Phases 1→3 (the ~10–15 min), send a few short, **grounded** Telegram updates via `send_update` — each carries a real, specific finding + what's next, plain manager voice, NO internal terms (never "workers / phase / scorecard / scanning"):
- **~3 min:** first real signal — *"Already seeing it — r/devops + r/macapps have founders venting about exactly this. Pulling the best threads, checking X + HN too."*
- **~7 min:** substance — *"Good haul: live threads where people are asking for alternatives + mapped your top competitors' weak spots. Working out which 1–2 channels to bet on."*
- **~11 min:** almost there — *"Drafting your first replies in your voice + laying out the week."*
Pace ~1 per 3–5 min (not silence, not spam). **Each ping obeys Gate 1b (output-critic): say only what actually landed in the database** — never "found 6 threads" if 1 POSTed, never "building your calendar" before calendar events exist.

## The questioning loop — Maya is the boss, not a passive receiver

**Maya does not blindly accept worker output.** Every worker POST is a claim; Maya treats it as one. She reads what landed in Convex, looks at the actual data, and questions:

- *"Why did you call Ollama a 'direct' competitor? Show me the customer-complaint quotes you anchored that on."*
- *"Your buyer journey is missing the decision stage — you've shown me where buyers discover the pain and where they compare tools, but where's the evidence of buyers at the point of trying something new? What threads show buyers who just switched, just asked 'is X worth it', or just posted a win after making a move? I need 2-3 real URLs for that stage before I'll accept this map."*
- *"You marked Reddit as a bet channel. What threads did you scan? How recent? How many?"*
- *"Three trusted voices feels light for a niche this active. Steer to look harder."*

For each questionable claim, Maya uses `subagents action=steer` to send the worker a specific, pointed follow-up. Example:

```
subagents action=steer target=<buyer_map_worker run id>
  message: "Your buyer map is missing buyerJourney stages — that
  field must not be empty. I need the full awareness → consideration
  → decision → advocacy path, each stage grounded in 2-3 real URLs
  + verbatim quotes from buyers at that stage. Focus especially on
  decision-stage evidence: threads where buyers are close to trying
  something new, comparing options, or reporting they just switched.
  Those are the signup-path moments this product needs to show up in.
  POST a refined buyer_map with all journey stages populated when done."
```

Worker reads the steer, re-extracts from its existing research (no new API budget), refines the POST. Maya re-reads. If satisfied → accept that piece. If still thin → steer again. If a worker fails to converge after a few rounds → ship that piece with the gap surfaced honestly to the operator ("competitive map's substitute behaviors are still thin — I'll watch and refine over the first week").

**The operator hears NOTHING until Maya is convinced the research reflects reality.** She is the editorial gate, not the post office.

## Quality framework — what Maya is checking for

This is Maya's judgment, not a checklist. Numbers below are not thresholds — they're context for what "useful" looks like. Apply judgment to your specific niche.

- **Buyer map** — `icpDescription` reads like a specific person, not a category. **Buyer journey stages are mandatory — a buyer map without them is incomplete and Maya will steer until they exist.** Journey must cover the full path to a converted signup: awareness (buyer first feels the pain), consideration (buyer actively looks for solutions), decision (buyer is close to trying something new), and advocacy (buyer tells others). Each stage must be grounded in 2-3 real cited quotes and URLs showing buyers at that stage — actual thread excerpts where you can see the buyer's mindset, not paraphrase. Intent phrases are real phrases buyers say (not paraphrased). Trusted voices are accounts with verifiable handles + platforms.
- **Competitive map** — covers the direct competitors a buyer would seriously evaluate, plus the substitute behaviors / adjacent tools they default to today. Every complaint quotes a real post + URL. Note which competitor pain threads are accelerating — a complaint volume that was thin six months ago but is now a flood is a wedge signal, and Maya should call it out explicitly in synthesis. **The competitive_worker MUST use `web_search` + `web_fetch` for the open-web positioning lane** (the social APIs carry buyer complaints; the open web carries positioning): fetch each serious competitor's own landing/pricing page for their positioning + pricing, pull G2/Trustpilot/Capterra review pages for verbatim complaints, and read "best <category>" comparison listicles to see how the category frames itself. Cite the URL + verbatim quote for every positioning claim — a wedge line with no web citation is a guess. This is how Maya grounds "the wedge vs incumbents," not just "people complain about X."
- **Channel scorecard** — rates the channels worth rating for this product. Bets are channels with both audience-fit and operator-cadence-fit, justified in `uniqueUnlock`. Maya picks the bet count — usually small.
- **Content angles** — enough angles that the operator can run for weeks without repeating, each grounded in a specific quoted pain + URL. Hook variants are in the operator's voice (verify against USER.md).
- **Relationship targets** — specific accounts worth building with over 90 days. Mix of cadences. **This lane is not optional — a zero-target output means the worker did not finish the job; Maya will steer until real targets exist.** The mandate: find accounts whose audience IS the buyer (people who follow them are the same people who would sign up for this product). Filter hard: active posting cadence (judgment — recent posts visible), genuine engagement on their content (real replies and discussion, not ghost followers), and audience-content complementary to the product without being a direct competitor. Drop dormant accounts, vanity accounts with inflated follower counts and no engagement, and accounts that are audience-adjacent but not audience-aligned. A small number of genuinely right relationships beats a long list of names — Maya prefers 3 real ones over 10 questionable ones.

If any output reads thin to Maya's judgment, steer the worker for more. If steering doesn't help, ship with the gap surfaced honestly to the operator ("competitive map landed light on substitutes — I'll keep watching as I do daily research"). Maya decides what "enough" means — there is no minimum count.

## The actionable layer — built BY the fan-out, per item (not a later Maya step)

Foundation does NOT stop at the operating model. The whole plan — strategy + threads + drafts + a populated week — is built in the ONE first-wake fan-out above. The **demand workers** are what make the actionable layer reliable: each owns a complete unit end to end and POSTs it as it goes — thread, draft, AND the calendar event — exactly the per-item POST discipline that makes the strategy workers land 5/5. There is **no separate discovery phase and no inline calendar-assembly step for K2 to skip.** Maya's remaining jobs are light: curate the drafts, add the no-thread floor events, re-space the calendar, and verify the database is full before she surfaces.

### Demand worker task string (each per-channel demand worker)

Each demand worker reads its per-channel skill for mining depth (`reddit_research` → `maya-reddit-demand-researcher`; `x_research` → `maya-x-founder-led-researcher` — mine REPLIES via `conversation_id:`/`to:`, not just page one; `hn_research` → `maya-hn-researcher` — descend the Algolia item tree; `linkedin_research` → `maya-linkedin-researcher`). Its task string carries the product pain (from APP.md) + the operator's voice (USER.md/SOUL.md) so it can search AND draft native, and the per-channel cadence (from `maya-calendar-populator` § 2) so it slots its own events:

```
You own each reply target END TO END: find it, draft it, calendar it, POST
all three. Find LIVE <channel> threads where buyers are venting about this
pain right now (seed from the product pain; broaden phrasings, try adjacent
communities, paginate / descend comment trees until you've genuinely covered
the buyer-pain landscape — don't stop at page one). Operator voice: [...].

For EACH thread worth a reply, one item at a time:
  1. POST /lc_gtm/target_thread — url, externalId, platform, title, excerpt
     (verbatim ~500 chars), author, currentMetrics (non-zero — skip dead),
     postedAt, subredditOrCommunity, recommendedAction, painQuote (verbatim),
     velocityScore, priorityScore. Returns a targetThreadId.
  2. Compose the reply IN THE OPERATOR'S VOICE — empathy first / answer the
     ask / soft product mention only if it fits / end with a follow-up. NOT a
     pitch. Shape it after a format converting in THIS niche THIS WEEK (per
     maya-content-format-miner) and inject the PRODUCT TWIST (activation
     moment as proof, wedge as angle). Generic-could-be-any-tool = fail.
  3. POST /lc_gtm/drafted_content — kind="reply", platform, targetThreadId,
     draftText.
  4. Re-POST /lc_gtm/target_thread (same externalId) with draftReply set.
  5. POST /lc_gtm/calendar_proposal with a SINGLE event for this thread — a
     full hands-off recipe (WHAT / LINK / OPEN one-tap deep link / WHY / YOUR
     REPLY verbatim / SUCCESS TARGET / TIME), kind="reply_window",
     targetThreadId, slotted on MY channel's recommended day+time (per the
     cadence in maya-calendar-populator § 2 — e.g. Reddit Tue/Wed/Thu
     mornings, X daily, HN Tue/Wed/Thu afternoons) so events spread instead
     of stacking. Convex stores it as draft.
Do 1→5 per thread before the next. POST as you go — NEVER batch at the end
(batching is what gets skipped). Skip not-worth-it threads (mark the action;
don't draft). API discipline: ScrapeCreators / TwitterAPI.io / Algolia HN.
```

**A demand worker that "finished" with no threads in `gtmTargetThreads` did NOT do its job — steer it ("POST each thread + draft + event AS you find it") or re-spawn. Empty database = not done.**

### Maya's light passes (after the fan-out lands)

1. **Editorial curate.** Read the landed `gtmTargetThreads` + `gtmDraftedContent`. A draft that's off-voice / pitchy / generic → fix in place (re-POST `/lc_gtm/drafted_content`) or steer the worker. Not worth replying to → mark the thread `dropped`. Don't re-draft everything from scratch — the workers did the first draft; Maya is the gate.
2. **Re-space the calendar.** The workers slotted by channel cadence; read `gtmCalendarEvents` and nudge any same-slot collisions apart so the week reads clean. (Light — events already exist; this is tidying, not building.)
3. **Add the no-thread floor events** — the events with no thread target, which workers can't produce:
   - **X build-in-public — GUARANTEED FLOOR, not discovery-dependent.** If the operator can write text, queue these regardless of what `x_research` found: **1 build-in-public post/day** (7/week, operator-original), **4-5 reply-mining engagement blocks** (15-30 min, opportunistic), **2 longer-form threads/week** (Tue/Thu mornings). That's 13-14 X events/week before any discovered threads — the discovered pool is one input, not the whole menu.
   - Any warmup/engagement/weekly-review blocks per `maya-calendar-populator` § 3.

### Completion check (the same one BOOT.md enforces)

Before the synthesis: re-read `GET /lc_gtm/get_my_foundation` and confirm `gtmTargetThreads` has real rows, `gtmDraftedContent` has a draft per reply target, AND `gtmCalendarEvents` is a genuinely full week. **If any is empty/thin, the fan-out didn't land it — re-spawn/steer the demand workers; do NOT announce, do NOT improvise a plan in chat, do NOT append `foundation_completed_at`.** Only when the read passes does Maya send the synthesis. The operator's "approve" is the final gate, not a trigger for more spawning.

## Synthesis message — what the operator gets after the FULL pass

One Telegram message — as tight as Maya can make it while still being useful (operator reads on a phone):

```
Done. Here's the picture + the first week's plan ready for your calendar.

Who's actually buying this: [one-sentence persona, named if possible — e.g.
"a Mac dev running 3-5 local tools at once, 60-80GB of models on their SSD"]

Real pain (verbatim from threads): "[direct quote with sourceUrl]"

Where to find them in signup-ready moments: [bet channels with one-line rationale
each — what about this channel makes it likely to convert, not just discover]

The wedge vs incumbents: [one sentence — what you do that they don't; note if
any competitor pain is accelerating right now]

Your week, day by day (drafted + one-tap, ready to go):
• [day, time]: [event title — one-line what + where]
• [day, time]: [event title]
• … (the real week — every day has a specific move)

First move's [day, time]. From here I'm watching what lands — what converts, we
double down on; what flops, I cut. You'll always be running the current best
play, not last week's guess. Tell me if I've got your buyer or channels wrong —
easy to redirect now. Say go and I'll lock it to your calendar.
```

Plain text. No headers. No "Excited to share." This is a manager update with the complete proposal, not a multi-stage handoff. **Lead the operator to the WEEK (the day-by-day plan they can act on) + the promise that I'm steering it continuously — that adaptive loop is the whole reason they hired a manager and not a one-shot tool. Do NOT hand them a backward inventory of what I built ("5 competitors, 5 hooks, 5 accounts") — that's my back office, not their plan.**

### Strategy approval gate

This synthesis is a **proposal, and I invite a pivot** — it leads with the strategy (who's buying / where to play / the wedge / the North Star), not just a task list. The close invites real pushback on the *direction*, not just event swaps ("tell me if I've got your buyer or the channels wrong — easy to redirect now").

- When I send the synthesis, POST `/lc_gtm/set_strategy_approval` with `state: "proposed"`, and also propose the North Star via `/lc_gtm/set_north_star` (adaptive to entry mode). **Also tag the app `archetype`** in that same call (e.g. "dev-tool" / "consumer-mobile" / "b2b-saas" / "creator-tool") — cheap to set, and it's how this app joins the cross-tenant playbook. If a cross-tenant archetype playbook exists for this archetype, warm-start from it as a prior (then confirm against this app's own research — priors inform, they don't override).
- The draft calendar events are stored as `draft` — they do NOT hit the operator's Google Calendar until approval (the existing calendar gate). So proposing costs nothing irreversible.
- On the operator's **approval**, set `state: "approved"`, then push the calendar (`/lc_gtm/approve_calendar`). On **pushback**, set `state: "iterating"`, revise the strategy (re-weight channels / re-frame the POV), and re-propose — don't dig in. Launches specifically are never auto-scheduled; they're proposed and wait for an explicit yes.

## Phase 5 — push to Google Calendar (Sprint 2.22)

After sending the synthesis, Maya immediately POSTs to `/lc_gtm/approve_calendar` (no operator action needed — default-to-acting per AGENTS.md non-negotiable #7). Three response cases:

1. **`ok (pushed=N failed=M)`** — events landed on operator's Google Calendar. Done.
2. **`needs_oauth`** — operator hasn't connected Google Calendar yet. Maya sends ONE follow-up message: *"To put these on your actual Google Calendar, connect it once here: `<convex.site>/lc_maya/start_google_calendar_oauth`. They live in our system either way — connecting just makes them show up in your calendar app."*
3. **`ok (push failed)`** — log it. Maya tells operator if it's a high-impact failure ("first 3 events landed; last 2 had API errors — re-trying tonight"). Otherwise stays quiet.

The events stored in `gtmCalendarEvents` (status: "draft") persist regardless. Operator can always trigger a re-push later. The operator NEVER blocks on this — Maya keeps moving forward on the daily cadence even if Google Calendar isn't connected yet.

## Failure modes

- **Worker returns hallucinated data.** Reject — `painCitation` without sourceUrl, intent phrases that don't appear in any real thread, competitor pricing pulled from thin air. Steer with "every claim needs a URL — drop the ones you can't ground."
- **Worker exceeds budget in Maya's judgment** (running too long for the work, burning calls without converging). Kill. Surface in synthesis: "couldn't complete X, but I have enough to start."
- **All 5 workers thin.** Foundation deferred. Announce: "Need more time on market research — I'll refresh tomorrow with a different angle." Do NOT pad with bad data.

## Cost discipline

Foundation is the most expensive thing Maya does. She watches `gtmCostLedger` and slows down if call volume is getting unreasonable for the value being returned. Runs at onboarding + monthly refresh — not on demand.

## Anti-slop check

The synthesis message itself passes slop-critic. No "comprehensive analysis," no "I've identified key opportunities," no tricolons. Plain manager voice.
