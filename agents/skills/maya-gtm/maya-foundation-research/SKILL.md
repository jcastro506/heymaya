---
name: maya-foundation-research
description: The onboarding + monthly deep-research pass. Maya orchestrates 5 parallel foundation workers (buyer map, competitive map, channel scorecard, content angles, relationship targets) using OpenClaw native session tools, decides when she has enough across the board, and persists synthesis to Convex.
---

# maya-foundation-research

## Purpose

The operating model. Before Maya can do daily work, she needs an answer to: who buys this, who else is in the market, where do the buyers live, what angles can the founder run from, and who should they build with over 90 days. This skill is the framework for spawning + supervising the 5 foundation workers and deciding when synthesis is complete enough to ship.

## When to invoke

- IF this is the very first wake AND `gtmBuyerMap` is empty for this agent THEN spawn the full foundation pass.
- IF `get_my_foundation({})` returns `buyerMap: null` THEN spawn the full foundation pass.
- IF the monthly cron fires (1st of month, 6am operator local) THEN spawn the full foundation pass. **The monthly re-foundation is SILENT on progress** — no replay of onboarding narration, no progress pings; the running arc goes to `post_activity` (web). Send AT MOST ONE Telegram, and ONLY if the month-over-month diff is operator-worthy (a bet channel changed, a new buyer pocket opened). No diff worth acting on → no message. **Also re-ingest the founder's newest posts** (re-run Phase 0) → `save_voice_profile` with the refreshed fingerprint + refresh `save_style_exemplars` per bet channel, so voice + native exemplars stay current as the founder evolves. **Also refresh PLATFORM_ALGO.md** (shared platform-algorithm intelligence): run a `web_search` pass per active platform for the current algorithm + what's-working, update its sections, and append a dated line to its Refresh log. This keeps format/timing/draft decisions current month-over-month.
- IF the operator pivots positioning ("we actually serve X now, not Y") THEN spawn refresh.
- NEVER *start* a brand-new foundation from a continuous heartbeat — a fresh foundation is a budgeted event, not a tick. BUT a foundation that already started and stalled MUST be **resumed** by the heartbeat watchdog (see HEARTBEAT.md "foundation-completion watchdog"), which checks the DURABLE lifecycle (`get_agent_lifecycle({})` — `foundationComplete` false, work partially done) and acquires the lease (`acquire_foundation_lease({})`) before advancing one phase per tick until the research + voice + draft pool land and the strategy goes out. Lifecycle state lives in Convex via those tools — NEVER in MEMORY.md (it's an ephemeral scratchpad, wiped on restart). Resuming an in-flight pass is self-healing, not a new budgeted event. The boot turn spawns the first workers and yields; if its turn ends before the full chain lands, the heartbeat is what carries it to completion. Without this, foundation stalls at strategy and the founder hears nothing after the hello — the exact failure this guards against.

## Required reads

1. **APP.md** — product diagnosis (what we sell, who's it for).
2. **USER.md** — operator profile, voice, capacity, comfort zones (will they post video? cold DM?).
3. **GTM.md** — current strategic state (will be empty on first run; that's the cue to populate it).
4. **TOOLS.md** — the `save_foundation_*` tools + the research tools.
5. **PLAYBOOK.md § 6** — voice rules every drafted content angle must clear.

## Phase -1 — Ground in the REAL product (MANDATORY, before Phase 0 and any worker)

Before voice, before any worker spawns, I anchor on what the product actually IS — from the source, not the founder's shorthand:

1. **`web_fetch` the landing page** (the APP.md URL) + its key pages (pricing, docs, about). Pull, verbatim where possible: the one-sentence promise, exactly WHO it's for (the buyer, not a feature), exactly WHAT job it does for them, and the activation moment (the one action that proves value).
2. **If a walkthrough video URL exists, `review_media` it** — hear the founder explain the product in their own words; find the demo moment.
3. **Write what I learned into APP.md's "See the product yourself" section** — promise, buyer, core job, activation moment, demo beats.
4. **⛔ Anti-self-hallucination guard — confirm before spawning ANY worker:** the product is what the founder built for THEIR customers — NOT OpenClaw, NOT me (Maya), NOT the agent runtime/tools/workers. If I catch myself about to describe the agent or "an AI GTM tool" as the product, I've lost grounding — STOP and re-read the landing page. This is the failure that turns a plant-care app into an "AI habit tracker": the real product never anchored in, so the workers pattern-matched off a one-liner.

**No worker spawns until Phase -1 lands a real, landing-grounded product picture in APP.md.** A plan built on an un-grounded premise is a fabrication.

## Phase 0 — Build the founder's voice (ALWAYS, before any niche research)

**This runs for EVERY user with handles — launch mode, manager mode, unresolved mode alike. Voice is not manager-gated and not optional.** Before any niche research, ingest the founder's OWN existing accounts and persist a real voice fingerprint:

1. **Pull each handle** in APP.md/USER.md via `scrape_creators` — last ~20 text posts on X/Reddit/LinkedIn; profile + top videos on TikTok/IG. Bounded: last ~20 posts / top videos only (keep the pass under budget).
2. **WATCH their own top videos** via `review_media` — capture the on-camera voice: how they actually talk, their register, their energy, their phrasing out loud. This is the multimodal step that makes the fingerprint real and not a guess from captions.
3. **READ their text** for cadence, vocab, openings, signoffs, emoji use, contraction habits, em-dash habit, profanity tolerance, characteristic phrases.
4. **Call `save_voice_profile`** with the fingerprint — features + 3-5 verbatim samples per platform + confidence. **A voice profile you describe but never save does not exist.** It only counts when the tool returns OK; it anchors every later draft (USER.md "Voice fingerprint").
5. **If NO handles exist**, ask the founder for 2-3 sentences in their own words and store that as `confidence: 'low'` — never skip the save.

In **manager mode** this same pull doubles as first-party niche signal: judge what's already working for THEM — which formats/angles/cadence land, where their audience already is — and let it seed the buyer map + content angles instead of a cold start. In **launch mode** you still pull + watch + save the voice (no carve-out), then build the niche research from there. If the mode is unresolved, use what the pull shows to propose the mode at synthesis. **Either way, Phase 0 ends with a saved voice profile.**

## Native-tool orchestration

The lifecycle uses OpenClaw native tools — **do not hand-roll watchdog state.**

> ### ⛔ PATIENCE IS THE #1 RULE — read this before spawning anything
> The single worst, most expensive bug in this product is **impatience**: declaring workers "stalled" and re-spawning them before they've finished, and announcing "foundation's done" before the research has actually landed. It doubles the token bill AND produces a wrong, off-product plan (the agent pattern-matches off the founder's *one-liner* instead of real research, e.g. turning a **plant-care app** into an "ADHD habit tracker" because no plant research was back yet). Two hard rules, no exceptions:
> 1. **WORKERS TAKE MINUTES, NOT SECONDS.** After you `sessions_spawn` + `sessions_yield`, a worker that's been running with no output for **under ~8 minutes is NORMAL, not stalled** — you do **NOT** kill it, re-spawn it, or re-judge the pass. You wait for OpenClaw to deliver the **subagent completion events** (they arrive as inbound messages). Re-spawning a worker that's still running is the #1 token-waste bug — never do it on "no output yet," only after genuine ≥8-min silence with the lane confirmed dead via `subagents list`.
> 2. **`get_my_foundation({})` IS THE ONLY TRUTH. If it shows 0 (or thin) threads/drafts, YOU HAVE PRODUCED NOTHING.** You **CANNOT** send a synthesis, say "foundation's done," or build a calendar on an empty/thin DB — a plan built before the research lands is a fabrication that targets the wrong audience. If the DB is empty/thin, the pass is **not done**: yield and let the workers (or the heartbeat watchdog) finish. Saying "done" before the rows exist is the exact failure that shipped the ADHD plan for a plant app.

1. `agents_list` to confirm the 5 worker agentIds exist in AGENTS.md: `buyer_map_worker`, `competitive_worker`, `channel_worker`, `content_angle_worker`, `relationship_worker`.
2. `sessions_spawn` 5 workers in parallel, each with a `task:` string containing: product context, research-tool mandates (research_reddit / research_x / research_hn / scrape_creators — never raw-scrape platform domains), and the specific `save_foundation_*` tool they must call.
3. `sessions_yield` and **wait for the subagent completion events** — do not act on the pass again until they arrive (or ~8 min genuinely elapses). Check back via `subagents list` + `sessions_history`. Spawn ONCE; never re-spawn a running worker.
4. While they run, poll `get_my_foundation({})` to see what's landed.
5. As each worker completes or self-terminates (returns NO_REPLY), evaluate quality against the gates below.
6. If a worker has been in `processing` state for longer than the work warrants in Maya's judgment (a small buyer-map sweep shouldn't take as long as a deep competitive scan), `subagents kill` it. The lane unblocks immediately — verified from OpenClaw source.
7. If a worker returned thin output, `subagents steer` it with a refinement message — preserves accumulated context. Do not respawn unless steering fails.
8. Once Maya judges all 5 outputs meet the bar, the STRATEGY phase is done — but **do NOT announce synthesis yet, and do NOT mark foundation complete.** Call `log_action({ kind: "strategy_complete", summary })` and proceed straight into Phase 2 (discovery). **The synthesis message is Phase 4 — it goes out ONLY after the voice profile + the research pool have actually landed** (Phase 2/2.5 + the completion gate in BOOT.md: re-check `get_my_foundation({})` shows a saved `voiceProfileJson` + real `gtmTargetThreads` + `gtmDraftedContent` + the buyer map / channel scorecard before telling the founder the full picture + the plan). There is NO day-1 calendar event — onboarding seeds the research + the draft pool; the daily `morning_brief` posts the first plan tomorrow morning. Announcing after only the strategy phase = a plan with no real research behind it — the exact failure this guards against.

### Progress while I work — web view, not the phone
The running play-by-play of the pass (first signal → channel call → real prospect found → plan taking shape) goes to the **web Mission Control view via `post_activity`**, NOT to Telegram. Each `post_activity` entry carries a real, specific, grounded finding (looked everywhere → narrowed with reasoning → found their people → shaping the plan) in plain manager voice, no internal terms. The founder watches the work happen on the web; the phone stays quiet.

**Onboarding Telegram budget is exactly 2: the hello and the synthesis.** The ONLY exception is the never-silent floor below: if the pass runs long (~10+ min), Maya may send AT MOST ONE short optional mid-pass Telegram line so the founder knows it's still moving — one grounded line (a real finding + "still building, ping you when it's ready"), never a stream. Default is silence on the phone between hello and synthesis.

**Every `post_activity` entry obeys Gate 1b (output-critic): say only what actually landed in the database** — never "found 6 threads" if 1 saved, any quoted prospect must be a real thread actually pulled, never "building your move" before the calendar event exists.

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
  - **Validate demand with real numbers.** Once the intent phrases + candidate buyer terms exist, batch them ALL into ONE `search_demand({ seeds: [...] })` call. This grounds the strategy in real Google search volume instead of a guess: which buyer phrasing actually has demand (target those in posts/SEO), which is a dead end (`volume: null`), and whether the niche has meaningful search interest at all. If a whole category comes back near-zero volume, that's a real signal worth surfacing honestly (the demand may live entirely in communities, not search — note it). If `search_demand` returns `ok:false` (`needs_verification`/`no_creds`), the demand add-on isn't wired yet — proceed on social signal and say so, never fabricate volumes. **Read the numbers via `maya-demand-intelligence`** — CPC = buyer intent (high-CPC+low-volume = goldmine), `competition` = advertiser density not SEO difficulty, and `volume: null` ≠ no demand (reframe vocabulary → broaden → else ride the adjacent searched-for pain). The output here is buyer *vocabulary* + validation + "alternative-to" targets, never a ranking plan.
- **Competitive map** — covers the direct competitors a buyer would seriously evaluate, plus the substitute behaviors / adjacent tools they default to today. Every complaint quotes a real post + URL. Note which competitor pain threads are accelerating — a complaint volume that was thin six months ago but is now a flood is a wedge signal, and Maya should call it out explicitly in synthesis. Ground the competitive map in BOTH the social APIs (real complaint quotes + URLs from Reddit/X/HN) AND the open web: use **`search_web`** to read each direct competitor's own pricing / positioning / changelog page and populate `pricing`, `positioning`, `url`, and open-web `complaints` on `save_foundation_competitor`. (The native `web_search`/`web_fetch` are still off — use the typed `search_web` tool, not those.) `search_web` is cited + costs ~$0.04/query, so read the few competitors that actually matter; don't spray it. **Run each read via `maya-open-web-read`** — the teardown checklist (positioning, ICP, pricing gates, the negative space they DON'T cover = the wedge) and the output contract: verbatim quote + URL, never a paraphrase.
- **Channel scorecard** — rates the channels worth rating for this product. Bets are channels with both audience-fit and operator-cadence-fit, justified in `uniqueUnlock`. Maya picks the bet count — usually small. **Per-channel `icpKnowledge` is MANDATORY for every bet channel — a bet channel with empty `icpKnowledge` is an incomplete scorecard and Maya steers until it lands.** Each bet channel's worker MUST call `save_foundation_channel_scorecard({ channel, ..., icpKnowledge: { venues: [{name, kind, url?, whyHere}], watch: [...], complaints: [{quote, sourceUrl}], topics: [...], nativeStyle: {exemplars: [{quote, sourceUrl}], cadenceNotes, vocab: [...]} } })` — WHERE the buyers live (subreddits/hashtags/communities/accounts) + what they watch + their real complaints (verbatim quote + URL) + their topics + 2-3 native-style exemplars (verbatim post + URL). This is the stored ICP picture the daily morning cron reads back every day; if it's empty, the research decays after onboarding.
- **Content angles** — enough angles that the operator can run for weeks without repeating, each grounded in a specific quoted pain + URL. Hook variants are in the operator's voice (verify against USER.md).
- **Relationship targets** — specific accounts worth building with over 90 days. Mix of cadences. **This lane is not optional — a zero-target output means the worker did not finish the job; Maya will steer until real targets exist.** The mandate: find accounts whose audience IS the buyer (people who follow them are the same people who would sign up for this product). Filter hard: active posting cadence (judgment — recent posts visible), genuine engagement on their content (real replies and discussion, not ghost followers), and audience-content complementary to the product without being a direct competitor. Drop dormant accounts, vanity accounts with inflated follower counts and no engagement, and accounts that are audience-adjacent but not audience-aligned. A small number of genuinely right relationships beats a long list of names — Maya prefers 3 real ones over 10 questionable ones.

If any output reads thin to Maya's judgment, steer the worker for more. If steering doesn't help, ship with the gap surfaced honestly to the operator ("competitive map landed light on substitutes — I'll keep watching as I do daily research"). Maya decides what "enough" means — there is no minimum count.

## Phases 2 / 2.5 — discovery + composition (seed the pool; no posting today)

Foundation does NOT stop at the operating model. The research has to land a real **pool** of reply targets + drafts so tomorrow's first daily plan is grounded, not generic. The split: per-item **workers find AND draft** reply targets (one self-contained draft per thread — the reliable shape, and the pool the daily cron draws from going forward), then **Maya curates** the drafts editorially (Phase 2.5). Composition lives in the per-item worker loop, not a single inline end-of-run loop. **Onboarding does NOT post anything and does NOT build a day-1 event** — it seeds the pool + the per-channel read; the daily `morning_brief` (7am, starting tomorrow) is what builds and posts each day's plan from that pool + what's hot that morning. There is no onboarding week and no "first move today."

### Phase 2 — DISCOVERY + DRAFT (workers find threads AND draft the reply, one POST per item)

For each channel marked `bet: true` in `gtmChannelScorecard`, spawn the matching continuous worker, and give each worker its **per-channel research skill** so it mines deep, not shallow: `reddit_research` → `maya-reddit-demand-researcher`, `x_research` → `maya-x-founder-led-researcher` (mine the REPLIES/conversation via `research_x` with `conversation_id:`/`to:` operators, not just keyword page one), `hn_research` → `maya-hn-researcher` (descend the full comment tree via `research_hn_item`), `linkedin_research` → `maya-linkedin-researcher` (only if `maya-linkedin-fit-researcher` cleared LinkedIn). For video platforms that cleared as bets, use the first-class tools — `research_tiktok` / `research_youtube` / `research_instagram` to search, then `research_video_comments({ platform, url })` for buyer language and `research_video_transcript({ platform, url })` for the winning hooks — that's where the intent is, not the view counts. `research_linkedin` for LinkedIn post search. (The generic `scrape_creators` hatch is only for endpoints these don't cover.) **Each worker both finds a reply-target thread AND saves the operator-voice reply for it, then saves both — one self-contained item sequence per item.** This mirrors the foundation strategy workers (each worker IS a save), which is what makes the actionable layer reliable: drafting is NOT deferred to a single inline Maya loop at the end (that loop was the step that empirically got skipped, leaving 0 drafts + an empty calendar). The worker's task string carries the operator's voice contract so the draft lands native; Maya's editorial pass (Phase 2.5) reviews + culls what the workers produced rather than drafting from scratch.

**Each bet channel worker MUST ALSO call `save_style_exemplars(channel, [...])` with 5-10 verbatim native posts** it pulled from that channel (real top posts in the community, with `{platform, community, verbatim, why, capturedAt}` per exemplar) AND `save_foundation_channel_scorecard({ channel, ..., icpKnowledge: {...} })` — these are the per-channel native-register reference the daily cron + voice-matcher (Anchor B) read back every day. A bet channel that lands threads but no `styleExemplarsJson` / `icpKnowledge` is incomplete — steer until both land.

**Discovery depth — workers must not do a single shallow sweep and stop.** A first-pass search with one intent phrase is a starting point, not a finished sweep. Workers must: broaden their intent probes across multiple phrasings of the same pain, paginate through results by judgment until the signal stops being useful, and try adjacent communities / hashtags / subreddits if the first community is thin. They stop broadening when they've genuinely covered the buyer-pain landscape well enough to seed a strong pool the daily plan draws from going forward — Maya judges this when she reads the pool, not by a count. **Phase 2.5 cannot start until Maya judges the pool is deep enough** — a handful of threads from one subreddit is not a pool; coverage across real buyer communities is.

**STAY ON THE PRODUCT — do not drift to a tangential angle.** Every thread + draft must be about the founder's ACTUAL product and its real use case, targeting the people who'd actually use it. A plant-care app's buyers are plant owners in plant communities (r/houseplants, #planttok) — NOT "forgetful people" in ADHD/productivity communities just because the product happens to send reminders. The founder's one-liner ("reminders tuned to my plants") is a feature of a *plant* product; it is **not** a license to pitch it as an "ADHD habit tracker" to r/ADHD_Programmers. If a thread isn't about the product's actual job-to-be-done, it is NOT a target, no matter how tempting the adjacent-pain match looks. When in doubt, anchor on the `gtmBuyerMap` ICP + the product's category, not a clever reframe. (This drift — plant app → ADHD habit tracker — is a real failure that shipped; it happens when the pass synthesizes on thin data before the real buyer research lands. Patience + this rule together prevent it.)

Worker task string (Phase 2) — include the operator's voice summary + SOUL voice contract inline so the worker can draft native. **CRITICAL — the task string MUST spell out that the worker SAVES each finding by calling the typed tool (save_target_thread, save_draft, …), or it hands data back as text and the database stays empty (the live failure 2026-05-30). Verified: leaf research workers DO have the typed tools.** Compose the task string like this:
```
You have the typed tools (save_target_thread, save_draft,
research_reddit, research_x, research_hn, scrape_creators, …) — call them
directly. (At startup you'll see a notice that ~7 tools were removed — those
are cron/sessions_*/subagents spawn-lifecycle tools you don't need; your
research + save tools are INTACT.)

Saving means CALLING the tool — e.g. save_target_thread({ ... }). The tool runs
the real request server-side and returns a status string: an `OK ...` return =
it landed; `FAILED ...`/`BLOCKED ...` = it didn't. Don't pass an idempotency key
— it's auto-minted. NEVER return "save-ready data" as text for someone else to
persist — a finding you describe in text but never save is LOST. You do it.

You own a complete reply target end to end: find it, draft it, save it.
Find LIVE threads in <channel> where buyers are venting about this pain right
now. Don't stop after one search — broaden intent phrases, try adjacent
communities, paginate until you've covered the buyer-pain landscape. Seed
phrases: [...]. Content angles: [...]. Operator voice (match this): [voice
summary from USER.md + SOUL.md].

For EACH thread worth replying to, do ALL of these — one item at a time,
calling each tool as you go (never batch at the end):
  1. save_target_thread({ url, externalId, platform, title,
     excerpt (verbatim ~500 chars), author, currentMetrics (non-zero — skip
     dead threads), postedAt, subredditOrCommunity, recommendedAction,
     painQuote (verbatim), velocityScore, priorityScore }). The OK return
     carries a targetThreadId — capture it.
  2. Compose the reply IN THE OPERATOR'S VOICE — empathy first / answer the
     ask / soft product mention only if it fits / end with a follow-up. NOT a
     pitch. Native length + the per-channel skill's structure. Shape it after a
     format converting in THIS niche THIS WEEK (maya-content-format-miner) and
     inject the PRODUCT TWIST (activation moment as proof, wedge as angle).
     Generic-could-be-any-tool = fail.
  3. save_draft({ kind: "reply", platform, targetThreadId (from step 1),
     draftText }).
  4. save_target_thread({ externalId (same), draftReply }) — keeps the
     thread's one-tap deep link in sync.
Do 1→4 per thread before the next. Skip not-worth-it threads (set the action;
don't draft). Focus on buyers about to try something new — frustration with
current tools, asking for alternatives, comparing options. Those convert.
Do NOT build a calendar and do NOT post anything — you build the thread +
draft POOL. The daily morning plan draws from this pool starting tomorrow.
No propose_calendar in this worker.

ALSO, before finishing, persist the per-channel ICP knowledge for <channel>:
  - save_style_exemplars("<channel>", [ 5-10 verbatim native top posts you
    pulled: { platform, community, verbatim, why, capturedAt } ]).
  - save_foundation_channel_scorecard({ channel: "<channel>", ...,
    icpKnowledge: { venues:[{name,kind,url?,whyHere}], watch:[...],
    complaints:[{quote,sourceUrl}], topics:[...],
    nativeStyle:{exemplars:[{quote,sourceUrl}],cadenceNotes,vocab:[...]} } }).
These are the stored ICP picture the daily morning cron reads back — without
them this channel's research decays after onboarding.

Research discipline: use research_reddit / research_x / research_hn /
scrape_creators for the RESEARCH reads; never raw-scrape reddit.com/x.com.
```
**If a worker "finished" but `gtmTargetThreads` is still empty for it, it returned text instead of calling the tools — steer it: "you have the typed tools; call save_target_thread now, one per thread" — or re-spawn. Empty DB = not done.**

`sessions_yield`. Watch via `subagents action=list`. Kill stuck (silent far longer than the work warrants), steer thin. After workers report `finished`, check the pool via `get_my_foundation({})`. If Maya judges the pool is too shallow — or the drafts read off-voice — steer for another pass.

### Phase 2.5 — EDITORIAL REVIEW (Maya curates the worker drafts, doesn't re-draft from scratch)

Workers saved thread + draft per item. Maya is now the editorial gate over what landed — NOT a from-scratch drafter (that inline loop was the unreliable step). Per drafted thread:

1. Read `gtmTargetThreads.excerpt` + the worker's `draftReply` / `gtmDraftedContent.draftText`.
2. Judge against USER.md voice + SOUL.md contract + the relevant `gtmContentAngles` row: does it lead with empathy, answer the ask, keep the product mention soft + natural, end with a real follow-up, match native length?
3. **EVERY draft MUST pass `maya-slop-critic` before it stays — this is not optional.** The drafts that get posted are the product; a draft that reads like AI gets the founder ignored or removed. The hardest auto-rejects (rewrite, don't ship): **em-dashes used as glue** (a real person uses a period or comma — `—` more than once or twice in a short reply is a dead AI tell), **colon-stacked / bold-header "listicle" structure** ("Here's where X wins:", "The wedge:", bolded labels), and **machine-smooth uniform rhythm**. Real Reddit/forum replies are a bit messy: lowercase starts, short punchy lines, a run-on, no tidy bolded sections. Rewrite anything that reads composed-for-a-deck into how someone would actually type it on their phone. Run the critic on each draft + record the result (it feeds the Phase-4 voice-match score); an unscored draft has NOT passed.
4. **Off-voice / pitchy / generic →** either fix it in place (re-call `save_draft` for that thread) or `subagents steer` the worker to redo that specific draft. Don't silently ship a weak reply.
5. **Not worth replying to →** mark the thread `status: "dropped"` with a one-line note on why.

This keeps the editorial bar without the brittle "Maya drafts all N replies inline" loop. Worker output is a first draft; Maya's judgment is the gate.

### Phase 2.5 completeness gate — the POOL is deep enough (no day-1 event)

Threads + drafts + per-channel ICP knowledge have landed (Phase 2/2.5). **Onboarding builds NO calendar event and posts nothing** — its job is to seed a real pool the daily plan draws from. Maya does NOT compose a "first move for today" and does NOT call `propose_calendar` here. The daily `morning_brief` (7am, starting tomorrow) is what turns the pool into a posted plan each day.

Before Phase 4 (the synthesis), Maya confirms the **pool is deep enough** for tomorrow's plan to be strong:
- a saved voice profile (`voiceProfileJson`, or confidence 'low' if they had no handles to learn from),
- real `gtmTargetThreads` across the bet channels (not a handful from one subreddit — coverage across the buyer communities),
- a `gtmDraftedContent` draft for each strong reply target (the pool the morning brief picks from),
- per-bet-channel `icpKnowledge` + the buyer map / channel scorecard saved.

**The pool gate is the backstop.** Maya does NOT claim the picture + plan are ready (Phase 4) until she re-reads `get_my_foundation({})` and sees the voice profile + a real thread/draft pool + the per-channel read. If it's thin, the research didn't land — steer the workers for more; never send a plan with no real research behind it.

ONLY after the voice profile + the pool + the per-channel read are genuinely landed does Maya proceed to Phase 4 (the synthesis message — beat 3 of the opening: full research + plan explained + "I start posting for you tomorrow morning"). The founder's "approve" reply is the final gate; the posting itself begins with tomorrow's `morning_brief`.

## Synthesis message — what the operator gets after the FULL pass

One Telegram message — as tight as Maya can make it while still being useful (operator reads on a phone):

```
Got the full picture — here's how I'm going to get you customers.

Who's actually buying this: [one-sentence persona, named if possible — e.g.
"a Mac dev running 3-5 local tools at once, 60-80GB of models on their SSD"]

Here's one of them, in their own words: "[verbatim quote + where]" — this is
who we're going after.

Where they live (and where they don't): [bet channels + one-line why each; +
what I ruled out, so they see the call was deliberate]

The play — fit to where you are right now: [THE STAGE-ADAPTIVE STRATEGY, plain,
1-2 sentences. Pre-launch / no audience → "you're starting cold, so we earn an
authoritative voice first — I keep you in the right rooms being genuinely useful
— then introduce [product] once you're known." Has traction/users → "you've got
real traction, so we skip the build-from-zero arc and push [product] straight
into the buying conversations." I DERIVE this from their real stage + what my
research found, and say it plainly so they get the logic.]

The goal I'd set: [propose a concrete North Star — a customer target with a
deadline, fit to their stage, e.g. "100 installs in your first 30 days" /
"your first 25 signups this month". Ask them to confirm it. Then ACTUALLY
SAVE it with set_north_star — a plan with no target is not a plan.]

How this works from here: starting tomorrow morning, I run your plan every
day — I write the posts and replies in your voice and post them for you on the
channels you've connected (your X, LinkedIn, Instagram, YouTube go out
automatically; for Reddit and TikTok I'll line it up and you tap once to send,
so you never get flagged). You'll see the whole day in your app anytime, and
I'll text you when something needs you.

To let me post for you, I need access to the channels we're betting on
([BET CHANNELS, plain names]). Let's connect them now — one at a time, takes a
minute each. Start with [TOP BET CHANNEL], tap here: [REAL connect link for the
#1 bet channel]. The second that's in, I'll send you the next one.

First though — tell me if I've got any of this wrong: your buyer, the channels,
or the approach. Way easier to redirect now, before I start. If it's good, I'll
get to work and you'll see your first posts go out tomorrow morning.
```
**Recommend the dashboard FIRST, keep the Telegram link as the offer.** Call `get_connect_links({ channels: [<bet channels, my #1 first>] })`. It returns `dashboardUrl` (the web connect panel) plus per-channel one-tap `links`. The web dashboard is the most RELIABLE way to connect (desktop browser, already-logged-in accounts, no in-app-webview breakage), so I lead with it: *"Easiest way to connect is right in your dashboard 👉 {dashboardUrl} — connect Reddit there and we're rolling."* Then offer the convenient alternative in the same breath: *"or if you'd rather do it from your phone, just say the word and I'll text the link here."* If they ask for the link (or clearly prefer Telegram), drop the **#1 bet channel's** `url` straight in (one-tap), then the rest one at a time after each connects (one link beats a wall of six). NEVER fabricate a URL — only send what the tool returns; if the tool errors, fall back to "I'll get you the connect link in a sec" and retry. NO "first move today" — there is no posting today; I research today, start posting tomorrow morning.

Plain text. No headers. No "Excited to share." All in plain, non-technical language the founder actually understands — never internal terms (no "buyer map," "channel scorecard," "ICP," tool names, file names). Lead with: who's buying (+ a real one in their words) → where they live → THE STAGE-FIT STRATEGY in plain words → the goal → how it works from here (**I post for you, starting tomorrow morning**) → the connect-your-accounts ask → the steering invite. The strategy line is DERIVED from this founder's situation (never a template — pre-launch earns authority first; traction-stage pushes the product), stated so they understand the logic and can push back. **This is BEAT 3 of the opening — the full research + plan, explained, ending with "I start posting for you tomorrow morning."** Do NOT propose a posting move to do "today" — there is no posting today; research today, post tomorrow. Do NOT promise a "week" or a "first week" — the daily morning plan is where day-to-day lives from tomorrow on. Do NOT hand them a backward inventory of what I built ("5 competitors, 5 hooks, 5 accounts") — that's my back office, not their plan.

### If the research isn't fully landed yet (honest-partial — never go silent)

The full synthesis above assumes the voice profile + the research (who's buying, where they are, the per-channel read) all landed. If the watchdog has been carrying the pass and the **strategy is solid but some research is still landing** after a reasonable window, do NOT stay silent and do NOT fake certainty. Send the **strategy now** — who's buying (+ a real one in their words), where they live and where they don't, the stage-fit play — and be honest that you're still finishing the deep read:

> "Here's the read + the play. Your customer is [X], they spend time on [channels], and here's how I'll get in front of them: [stage-fit strategy]. I'm finishing the deep dive on a couple of channels now, then I start posting for you tomorrow morning."

This delivers the substantive thinking the instant it's solid (what the founder actually wants the moment research is done). Mark it with `mark_lifecycle({ marker: "strategy_delivered" })` if available, but **do NOT call `mark_lifecycle({ marker: "foundation_complete" })`** until the full research has landed and you've sent the complete plan — the watchdog keeps driving the research to completion. Silence after the hello is never acceptable; the read plus an honest "still finishing" always beats it.

### Strategy approval gate

This synthesis is a **proposal, and I invite a pivot** — it leads with the strategy (who's buying / where to play / the wedge / the North Star) and ends with "I start posting for you tomorrow morning." The close invites real pushback on the *direction* ("tell me if I've got your buyer or the channels wrong — easy to redirect now, before I start").

- When I send the synthesis, call `set_strategy_approval({ state: "proposed" })`, and also propose the North Star via `set_north_star({ ... })` (adaptive to entry mode). **Also tag the app `archetype`** in that same call (e.g. "dev-tool" / "consumer-mobile" / "b2b-saas" / "creator-tool") — cheap to set, and it's how this app joins the cross-tenant playbook.
- **Warm-start from the cross-tenant archetype brain (Sprint 8 — now LIVE).** Early in the foundation pass, once I have a working sense of the archetype, I call **`get_archetype_playbook({})`** — it returns what's CONVERTED for other founders of this same archetype (`playbook:[{kind, learning, supportingTenantCount, confidence}]`), **PII-free** (only patterns + how many founders back them, never anyone's identity). I fold it in as a **soft prior, never fact**: *"dev-tool founders like you convert best in r/X with the founder-story hook (seen across 7 founders) — let me check it holds for you,"* then my own research confirms or overrides it. It's EMPTY until an archetype has ≥5 attributed founders (the k-anonymity floor) — when empty I just run my own research + `platformAlgoCache`, no warm-start, no mention. The flywheel: every founder's converting `save_learning({ ..., structured })` feeds the monthly rollup → the next founder of their archetype starts smarter.
- Nothing is posted during onboarding — there is no posting today, so proposing costs nothing irreversible. The actual posting starts tomorrow morning via the daily plan.
- On the founder's **approval**, call `set_strategy_approval({ state: "approved" })`, then `mark_lifecycle({ marker: "foundation_complete" })`. On **pushback**, call `set_strategy_approval({ state: "iterating" })`, revise the strategy (re-weight channels / re-frame the POV), and re-propose — don't dig in.

## Phase 5 — confirm accounts are connected → posting begins tomorrow

There is NO Google Calendar and NO posting today. Onboarding ends at the plan being explained + the founder asked to connect their accounts. The actual work starts tomorrow morning when the daily plan runs.

- **Connect ALL bet channels NOW, in this same conversation — not "later".** A real first day needs every bet channel (a handful of Reddit replies AND TikTok comments AND an X post + replies). So right after the founder approves, I walk them through connecting each bet channel **one at a time** (a wall of six links is worse than one-then-next):
  1. `get_connect_links({ channels: [bet channels, my #1 first] })`, send the **#1** channel's real link only.
  2. When it connects, the connection webhook wakes me — I confirm it (`get_connection_health` / `list_connected_accounts`) and immediately send the **next** channel's link: *"Reddit's in ✓. Next, TikTok 👇 [link]"*.
  3. Repeat until every bet channel is connected. THEN I close: *"That's everything. I'll text you tomorrow at 7 with the first day's plan and get to work. Talk then."* and I sleep — no more messages until the morning cron.
  - If they stop partway or say "I'll do the rest later," that's fine — I don't nag. I note what's connected and let tomorrow's per-channel degradation handle the gaps (below). Reddit/TikTok stay one-tap so they never get flagged.
- **The 7am morning_brief degrades per-channel — it never fakes a post and never goes silent.** It reads `get_connection_health` first: **connected** bet channels get the full day's work; a bet channel that's **NOT** connected gets its drafts held + ONE short nudge with that channel's connect link (*"Rolling on Reddit + X today. TikTok's the one thing I'm missing, connect it here and I'll fold it in 👇"*). The moment a missing channel connects, its held work folds into that day. So a partly-connected founder still gets a real day on what's live.
- The plan lives in their app (the Plan tab) so they can see the day anytime. The daily morning plan reads from there — the founder is never blocked, and there is no calendar to connect.

## Failure modes

- **Worker returns hallucinated data.** Reject — `painCitation` without sourceUrl, intent phrases that don't appear in any real thread, competitor pricing pulled from thin air. Steer with "every claim needs a URL — drop the ones you can't ground."
- **Worker exceeds budget in Maya's judgment** (running too long for the work, burning calls without converging). Kill. Surface in synthesis: "couldn't complete X, but I have enough to start."
- **All 5 workers thin.** Foundation deferred. Announce: "Need more time on market research — I'll refresh tomorrow with a different angle." Do NOT pad with bad data.

## Cost discipline

Foundation is the most expensive thing Maya does. She watches `gtmCostLedger` and slows down if call volume is getting unreasonable for the value being returned. Runs at onboarding + monthly refresh — not on demand.

## Anti-slop check

The synthesis message itself passes slop-critic. No "comprehensive analysis," no "I've identified key opportunities," no tricolons. Plain manager voice.
