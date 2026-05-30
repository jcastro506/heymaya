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

## Native-tool orchestration

The lifecycle uses OpenClaw native tools — **do not hand-roll watchdog state.**

1. `agents_list` to confirm the 5 worker agentIds exist in AGENTS.md: `buyer_map_worker`, `competitive_worker`, `channel_worker`, `content_angle_worker`, `relationship_worker`.
2. `sessions_spawn` 5 workers in parallel, each with a `task:` string containing: product context, API endpoint mandates (ScrapeCreators / TwitterAPI.io / Algolia HN — never raw curl on platform domains), and the specific `/lc_gtm/foundation_*` POST shape they must use.
3. `sessions_yield` and let them run. Check back via `subagents list` + `sessions_history`.
4. While they run, poll `/lc_gtm/get_my_foundation` to see what's landed.
5. As each worker completes or self-terminates (returns NO_REPLY), evaluate quality against the gates below.
6. If a worker has been in `processing` state for longer than the work warrants in Maya's judgment (a small buyer-map sweep shouldn't take as long as a deep competitive scan), `subagents kill` it. The lane unblocks immediately — verified from OpenClaw source.
7. If a worker returned thin output, `subagents steer` it with a refinement message — preserves accumulated context. Do not respawn unless steering fails.
8. Once Maya judges all 5 outputs meet the bar, the STRATEGY phase is done — but **do NOT announce synthesis yet, and do NOT mark foundation complete.** Write `action_logged` kind=`strategy_complete` and proceed straight into Phase 2 (discovery). **The synthesis message is Phase 4 — it goes out ONLY after threads + drafts + calendar have actually landed** (Phase 3 + the hard completion gate in BOOT.md: re-check `GET /lc_gtm/get_my_foundation` shows real `gtmTargetThreads` + `gtmDraftedContent` + `gtmCalendarEvents` before telling the operator the plan is ready). Announcing after strategy = the operator gets a plan with an empty calendar — the exact failure this guards against.

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
- **Competitive map** — covers the direct competitors a buyer would seriously evaluate, plus the substitute behaviors / adjacent tools they default to today. Every complaint quotes a real post + URL. Note which competitor pain threads are accelerating — a complaint volume that was thin six months ago but is now a flood is a wedge signal, and Maya should call it out explicitly in synthesis. Ground the competitive map in the social APIs (real complaint quotes + URLs from Reddit/X/HN). **Do NOT rely on `web_search`/`web_fetch` — they're not wired on the deployed agent yet, so a call just fails and wastes a turn; skip the open-web positioning lane until it's enabled.** (When it's available later, it's the lane for competitors' own pricing/positioning pages + G2/Trustpilot — but don't attempt it now.)
- **Channel scorecard** — rates the channels worth rating for this product. Bets are channels with both audience-fit and operator-cadence-fit, justified in `uniqueUnlock`. Maya picks the bet count — usually small.
- **Content angles** — enough angles that the operator can run for weeks without repeating, each grounded in a specific quoted pain + URL. Hook variants are in the operator's voice (verify against USER.md).
- **Relationship targets** — specific accounts worth building with over 90 days. Mix of cadences. **This lane is not optional — a zero-target output means the worker did not finish the job; Maya will steer until real targets exist.** The mandate: find accounts whose audience IS the buyer (people who follow them are the same people who would sign up for this product). Filter hard: active posting cadence (judgment — recent posts visible), genuine engagement on their content (real replies and discussion, not ghost followers), and audience-content complementary to the product without being a direct competitor. Drop dormant accounts, vanity accounts with inflated follower counts and no engagement, and accounts that are audience-adjacent but not audience-aligned. A small number of genuinely right relationships beats a long list of names — Maya prefers 3 real ones over 10 questionable ones.

If any output reads thin to Maya's judgment, steer the worker for more. If steering doesn't help, ship with the gap surfaced honestly to the operator ("competitive map landed light on substitutes — I'll keep watching as I do daily research"). Maya decides what "enough" means — there is no minimum count.

## Phases 2 / 2.5 / 3 — discovery, composition, calendar assembly (same pass)

Foundation does NOT stop at the operating model. The operator waited ~10-15 min for research; making them wait again after a "yes draft replies" is broken UX. **In the same pass, before sending synthesis, Maya extends foundation into actionable specifics.** The split: per-item **workers find AND draft** each reply target (one self-contained POST sequence per thread — the reliable shape), **Maya curates** the drafts editorially (Phase 2.5), then **Maya lays out the calendar** from the landed threads+drafts (Phase 3). Composition lives in the per-item worker loop, not a single inline end-of-run loop — that loop was what got skipped, leaving an empty calendar.

### Phase 2 — DISCOVERY + DRAFT (workers find threads AND draft the reply, one POST per item)

For each channel marked `bet: true` in `gtmChannelScorecard`, spawn the matching continuous worker, and give each worker its **per-channel research skill** so it mines deep, not shallow: `reddit_research` → `maya-reddit-demand-researcher`, `x_research` → `maya-x-founder-led-researcher` (mine the REPLIES/conversation via `advanced_search` `conversation_id:`/`to:` operators, not just keyword page one), `hn_research` → `maya-hn-researcher` (descend the full comment tree via the Algolia item API), `linkedin_research` → `maya-linkedin-researcher` (only if `maya-linkedin-fit-researcher` cleared LinkedIn). For video platforms that cleared as bets, mine the **comments** (TikTok `/v1/tiktok/video/comments`, IG `/v2/instagram/post/comments`) for buyer language — that's where the intent is, not the view counts. **Each worker both finds a reply-target thread AND drafts the operator-voice reply for it, then POSTs both — one self-contained POST per item.** This mirrors the foundation strategy workers (each worker IS a POST), which is what makes the actionable layer reliable: drafting is NOT deferred to a single inline Maya loop at the end (that loop was the step that empirically got skipped, leaving 0 drafts + an empty calendar). The worker's task string carries the operator's voice contract so the draft lands native; Maya's editorial pass (Phase 2.5) reviews + culls what the workers produced rather than drafting from scratch.

**Discovery depth — workers must not do a single shallow sweep and stop.** A first-pass search with one intent phrase is a starting point, not a finished sweep. Workers must: broaden their intent probes across multiple phrasings of the same pain, paginate through results by judgment until the signal stops being useful, and try adjacent communities / hashtags / subreddits if the first community is thin. They stop broadening when they've genuinely covered the buyer-pain landscape well enough to power a real first week — Maya judges this when she reads the pool, not by a count. **Phase 2.5 cannot start until Maya judges the pool is deep enough** — a handful of threads from one subreddit is not a pool; coverage across real buyer communities is.

Worker task string (Phase 2) — include the operator's voice summary + SOUL voice contract inline so the worker can draft native:
```
You own a complete reply target end to end: find it, draft it, POST it.
Find LIVE threads in <channel> where buyers are venting about this
pain right now. Do not stop after a single search — broaden intent
phrases, try adjacent communities, paginate until you've genuinely
covered the buyer-pain landscape. Use these intent phrases as seeds
(expand on them): [...]. Use these content angles for relevance: [...].
Operator voice (match this): [voice summary from USER.md + SOUL.md].

For EACH thread worth replying to, do ALL of these — one item at a time:
  1. POST /lc_gtm/target_thread with:
     - url, externalId, platform
     - title, excerpt (verbatim from post body, first ~500 chars)
     - author handle, currentMetrics (must be non-zero — skip dead threads)
     - postedAt (use judgment — a week-old thread with active comments is
       live; a 6-month-old thread with zero activity is not)
     - subredditOrCommunity
     - recommendedAction (reply / lurk / upvote_only / avoid)
     - painQuote (verbatim from the post/comment that proves buyer intent)
     - velocityScore, priorityScore
     This returns a targetThreadId.
  2. Compose the reply IN THE OPERATOR'S VOICE — lead with empathy /
     answer what OP asked / mention the product only if naturally
     relevant / end with a follow-up question. NOT a pitch. Match
     native length + the per-channel skill's structure rules. Shape it
     after a format that's converting in THIS niche THIS WEEK (per
     maya-content-format-miner — recent + rising, not a stale template),
     and inject the PRODUCT TWIST: the product's activation moment as the
     concrete proof beat, its wedge as the angle (ProductDiagnosis ×
     format). A generic reply that could mention any tool is a fail —
     it has to be unmistakably about THIS product's real "aha".
  3. POST /lc_gtm/drafted_content with kind="reply", platform,
     targetThreadId (from step 1), draftText (the reply you just wrote).
  4. Re-POST /lc_gtm/target_thread for the SAME thread (same externalId)
     with draftReply set to the same text — keeps the thread row's
     one-tap deep link in sync.
Do step 1→4 per thread before moving to the next. Skip threads not
worth a reply (mark recommendedAction accordingly); don't draft for them.
Focus on threads at a point in the journey where a buyer would try
something new — frustration with current tools, asking for alternatives,
comparing options, a win others want to replicate. Those convert.
API discipline: ScrapeCreators / TwitterAPI.io / Algolia HN. Never
raw curl platform domains.
```

`sessions_yield`. Watch via `subagents action=list`. Kill stuck (silent far longer than the work warrants), steer thin. After workers report `finished`, check the pool via `/lc_gtm/get_my_foundation`. If Maya judges the pool is too shallow — or the drafts read off-voice — steer for another pass.

### Phase 2.5 — EDITORIAL REVIEW (Maya curates the worker drafts, doesn't re-draft from scratch)

Workers POSTed thread + draft per item. Maya is now the editorial gate over what landed — NOT a from-scratch drafter (that inline loop was the unreliable step). Per drafted thread:

1. Read `gtmTargetThreads.excerpt` + the worker's `draftReply` / `gtmDraftedContent.draftText`.
2. Judge against USER.md voice + SOUL.md contract + the relevant `gtmContentAngles` row: does it lead with empathy, answer the ask, keep the product mention soft + natural, end with a real follow-up, match native length?
3. **Good →** leave it (the Phase-4 voice-matcher pass scores it formally).
4. **Off-voice / pitchy / generic →** either fix it in place (re-POST `/lc_gtm/drafted_content` for that thread) or `subagents steer` the worker to redo that specific draft. Don't silently ship a weak reply.
5. **Not worth replying to →** mark the thread `status: "dropped"` with a one-line note on why.

This keeps the editorial bar without the brittle "Maya drafts all N replies inline" loop. Worker output is a first draft; Maya's judgment is the gate.

### Phase 3 — CALENDAR ASSEMBLY (Maya lays out the week from the landed threads + drafts)

Threads + drafts have already landed reliably (Phase 2/2.5). So Phase 3 is no longer "draft AND lay out" jammed into one skipped loop — it's a **bounded layout pass over real input**: read the landed `gtmTargetThreads` (each already carries `draftReply` + a one-tap deep link) and lay them out across the rolling 7 days. Maya reads `maya-calendar-populator/SKILL.md` (§ 2 per-channel cadence, § 3 slot allocation by phase) and POSTs the events. Each event is a full hands-off recipe:

```
WHAT: <action title>
LINK: <thread URL>
OPEN (one-tap): <the thread's deep link / intent URL — see TOOLS.md "Deep links / intent URLs">
WHY: <one sentence — why this thread, why now>
YOUR REPLY (verbatim — copy/paste/edit/post):
<the draftReply already on the thread row>
VOICE NOTES: <one sentence — what to tweak if you want>
AFTER YOU POST: <reply to me — I'll track 72h>
SUCCESS TARGET: <e.g. 1 OP reply or 5+ upvotes within 4 hours>
TIME: <minutes — usually 10-15>
```

POST the events to `/lc_gtm/calendar_proposal` (Convex stores them as `draft` — it does NOT compose or lay them out; that's Maya's job here). Then **add the events that have no thread target** — the guaranteed-floor X build-in-public posts, engagement blocks, and longer-form threads below. The active-launch week should be genuinely full across every bet channel, without padding.

**The empty-calendar gate is the backstop.** Maya does NOT claim the plan is ready (Phase 4) until she re-reads `/lc_gtm/get_my_foundation` and sees real `gtmCalendarEvents`. If the layout step gets skipped, the gate blocks synthesis and forces the retry — she never narrates a calendar that isn't there.

**X build-in-public is GUARANTEED-FLOOR, not discovery-dependent.** If the operator can write text, Maya MUST queue these X events regardless of whether `x_research` returned any threads:
- **1 build-in-public post per day** (7/week) — operator-original on their own X handle, no thread target required. Seed time Tue/Thu 8am operator-tz, daily otherwise.
- **4-5 reply-mining engagement blocks** (15-30 min each) — operator browses X for 15 min finding 5-10 conversations to add to. No specific thread target — opportunistic.
- **2 longer-form threads per week** (Tue + Thu mornings) — a learning or decision from the week, 4-6 tweets.

That's 13-14 X events/week alone, before adding Reddit replies, HN comments, or anything else from discovery. **Without these, the plan is structurally too thin** — the discovered-threads pool is one input channel, not the menu.

ONLY after every kept thread has a draft AND every actionable item has a calendar event does Maya proceed to Phase 4 (the synthesis message). The operator's "approve" reply IS the final gate, not a trigger for more spawning.

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

[N] events queued for week one:
• [day, time]: [event title, one-line what + where]
• [day, time]: [event title]
• …

First action's [day, time]. Tell me if I've got the buyer or the channels wrong — easy to redirect now. Say the word and I'll lock it to your calendar.
```

Plain text. No headers. No "Excited to share." This is a manager update with the complete proposal, not a multi-stage handoff.

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
