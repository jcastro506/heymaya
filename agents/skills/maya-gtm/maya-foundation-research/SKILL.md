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
- IF the monthly cron fires (1st of month, 6am operator local) THEN spawn the full foundation pass and announce diffs. **Also refresh PLATFORM_ALGO.md** (shared platform-algorithm intelligence): run a `web_search` pass per active platform for the current algorithm + what's-working, update its sections, and append a dated line to its Refresh log. This keeps format/timing/draft decisions current month-over-month.
- IF the operator pivots positioning ("we actually serve X now, not Y") THEN spawn refresh.
- NEVER *start* a brand-new foundation from a continuous heartbeat — a fresh foundation is a budgeted event, not a tick. BUT a foundation that already started and stalled (a `foundation_started_at:` line exists with no `foundation_completed_at:`) MUST be **resumed** by the heartbeat watchdog (see HEARTBEAT.md "foundation-completion watchdog") — advancing one phase per tick until threads + drafts + calendar land. Resuming an in-flight pass is self-healing, not a new budgeted event. The boot turn spawns the first workers and yields; if its turn ends before the full chain lands, the heartbeat is what carries it to completion. Without this, foundation stalls at strategy and the operator hears nothing after the hello — the exact failure this guards against.

## Required reads

1. **APP.md** — product diagnosis (what we sell, who's it for).
2. **USER.md** — operator profile, voice, capacity, comfort zones (will they post video? cold DM?).
3. **GTM.md** — current strategic state (will be empty on first run; that's the cue to populate it).
4. **TOOLS.md** — the `save_foundation_*` tools + the research tools.
5. **PLAYBOOK.md § 6** — voice rules every drafted content angle must clear.

## Phase 0 — manager mode: start from their own accounts

Check APP.md "Entry mode" first. If **manager mode** (already-launched founder), before any niche research, ingest the founder's OWN existing accounts: pull each handle in APP.md/USER.md via `scrape_creators` (their recent posts + engagement), and judge what's already working for THEM — which formats/angles/cadence land, where their audience already is, their actual voice. This is where you pick up; it seeds the buyer map, content angles, and the voice profile with real first-party signal instead of a cold start. In **launch mode**, skip this (glance at any existing handles for voice only) and build from the niche. If the mode is unresolved, pull their accounts if handles exist and use what you find to propose the mode at synthesis.

## Native-tool orchestration

The lifecycle uses OpenClaw native tools — **do not hand-roll watchdog state.**

1. `agents_list` to confirm the 5 worker agentIds exist in AGENTS.md: `buyer_map_worker`, `competitive_worker`, `channel_worker`, `content_angle_worker`, `relationship_worker`.
2. `sessions_spawn` 5 workers in parallel, each with a `task:` string containing: product context, research-tool mandates (research_reddit / research_x / research_hn / scrape_creators — never raw-scrape platform domains), and the specific `save_foundation_*` tool they must call.
3. `sessions_yield` and let them run. Check back via `subagents list` + `sessions_history`.
4. While they run, poll `get_my_foundation({})` to see what's landed.
5. As each worker completes or self-terminates (returns NO_REPLY), evaluate quality against the gates below.
6. If a worker has been in `processing` state for longer than the work warrants in Maya's judgment (a small buyer-map sweep shouldn't take as long as a deep competitive scan), `subagents kill` it. The lane unblocks immediately — verified from OpenClaw source.
7. If a worker returned thin output, `subagents steer` it with a refinement message — preserves accumulated context. Do not respawn unless steering fails.
8. Once Maya judges all 5 outputs meet the bar, the STRATEGY phase is done — but **do NOT announce synthesis yet, and do NOT mark foundation complete.** Call `log_action({ kind: "strategy_complete", summary })` and proceed straight into Phase 2 (discovery). **The synthesis message is Phase 4 — it goes out ONLY after threads + drafts + calendar have actually landed** (Phase 3 + the hard completion gate in BOOT.md: re-check `get_my_foundation({})` shows real `gtmTargetThreads` + `gtmDraftedContent` + `gtmCalendarEvents` before telling the operator the plan is ready). Announcing after strategy = the operator gets a plan with an empty calendar — the exact failure this guards against.

### Progress pings while I work (so the wait feels like watching a pro, not a black box)
During Phases 1→3 (the ~10–15 min), send a few short, **grounded** Telegram updates via `send_update` — each carries a real, specific finding + what's next, plain manager voice, NO internal terms (never "workers / phase / scorecard / scanning"). The arc the founder should feel — looked everywhere → narrowed with reasoning → found their people → building the plan:
- **~3 min — first signal:** *"Already seeing it — r/devops + r/macapps have founders venting about exactly this. Digging in, also checking X, HN, the others."*
- **~7 min — the channel call (with reasoning + an invite to correct me):** name what I'm betting on AND what I'm ruling out and why — the founder should feel me make a real call, not a black box. *"Calling it: your buyers live on Reddit + X. I checked TikTok, IG, LinkedIn — not seeing your people there for this, so I'm not going to waste your time on them (push back if you disagree). Going deep on the two that matter."*
- **~11 min — the wow (a real prospect in their own words):** surface ONE actual potential customer + their verbatim quote — proof I found their people, not a category. *"This is your buyer, literally: someone in r/LocalLLaMA just wrote '[real quote]'. Found a bunch like this. Drafting your replies + laying out the week now."*
Pace ~1 per 3–5 min (not silence, not spam). **Each ping obeys Gate 1b (output-critic): say only what actually landed in the database** — never "found 6 threads" if 1 POSTed, the channel-call quote must be a real thread I pulled, never "building your calendar" before calendar events exist.

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

For each channel marked `bet: true` in `gtmChannelScorecard`, spawn the matching continuous worker, and give each worker its **per-channel research skill** so it mines deep, not shallow: `reddit_research` → `maya-reddit-demand-researcher`, `x_research` → `maya-x-founder-led-researcher` (mine the REPLIES/conversation via `research_x` with `conversation_id:`/`to:` operators, not just keyword page one), `hn_research` → `maya-hn-researcher` (descend the full comment tree via `research_hn_item`), `linkedin_research` → `maya-linkedin-researcher` (only if `maya-linkedin-fit-researcher` cleared LinkedIn). For video platforms that cleared as bets, mine the **comments** (TikTok `scrape_creators({ path: "/v1/tiktok/video/comments", ... })`, IG `scrape_creators({ path: "/v2/instagram/post/comments", ... })`) for buyer language — that's where the intent is, not the view counts. **Each worker both finds a reply-target thread AND saves the operator-voice reply for it, then saves both — one self-contained item sequence per item.** This mirrors the foundation strategy workers (each worker IS a save), which is what makes the actionable layer reliable: drafting is NOT deferred to a single inline Maya loop at the end (that loop was the step that empirically got skipped, leaving 0 drafts + an empty calendar). The worker's task string carries the operator's voice contract so the draft lands native; Maya's editorial pass (Phase 2.5) reviews + culls what the workers produced rather than drafting from scratch.

**Discovery depth — workers must not do a single shallow sweep and stop.** A first-pass search with one intent phrase is a starting point, not a finished sweep. Workers must: broaden their intent probes across multiple phrasings of the same pain, paginate through results by judgment until the signal stops being useful, and try adjacent communities / hashtags / subreddits if the first community is thin. They stop broadening when they've genuinely covered the buyer-pain landscape well enough to power a real first week — Maya judges this when she reads the pool, not by a count. **Phase 2.5 cannot start until Maya judges the pool is deep enough** — a handful of threads from one subreddit is not a pool; coverage across real buyer communities is.

Worker task string (Phase 2) — include the operator's voice summary + SOUL voice contract inline so the worker can draft native. **CRITICAL — the task string MUST spell out that the worker SAVES each finding by calling the typed tool (save_target_thread, save_draft, propose_calendar, …), or it hands data back as text and the database stays empty (the live failure 2026-05-30). Verified: leaf research workers DO have the typed tools.** Compose the task string like this:
```
You have the typed tools (save_target_thread, save_draft, propose_calendar,
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
  5. propose_calendar({ researchJobId, events: [ ONE event for this thread:
     a full hands-off recipe (WHAT / LINK / OPEN one-tap / WHY / YOUR REPLY
     verbatim / SUCCESS TARGET / TIME), kind="reply_window", targetThreadId,
     slotted on my channel's recommended day+time ] }). Stored draft.
Do 1→5 per thread before the next. Skip not-worth-it threads (set the action;
don't draft). Focus on buyers about to try something new — frustration with
current tools, asking for alternatives, comparing options. Those convert.
Research discipline: use research_reddit / research_x / research_hn /
scrape_creators for the RESEARCH reads; never raw-scrape reddit.com/x.com.
```
**If a worker "finished" but `gtmTargetThreads` is still empty for it, it returned text instead of calling the tools — steer it: "you have the typed tools; call save_target_thread now, one per thread" — or re-spawn. Empty DB = not done.**

`sessions_yield`. Watch via `subagents action=list`. Kill stuck (silent far longer than the work warrants), steer thin. After workers report `finished`, check the pool via `get_my_foundation({})`. If Maya judges the pool is too shallow — or the drafts read off-voice — steer for another pass.

### Phase 2.5 — EDITORIAL REVIEW (Maya curates the worker drafts, doesn't re-draft from scratch)

Workers saved thread + draft per item. Maya is now the editorial gate over what landed — NOT a from-scratch drafter (that inline loop was the unreliable step). Per drafted thread:

1. Read `gtmTargetThreads.excerpt` + the worker's `draftReply` / `gtmDraftedContent.draftText`.
2. Judge against USER.md voice + SOUL.md contract + the relevant `gtmContentAngles` row: does it lead with empathy, answer the ask, keep the product mention soft + natural, end with a real follow-up, match native length?
3. **Good →** leave it (the Phase-4 voice-matcher pass scores it formally).
4. **Off-voice / pitchy / generic →** either fix it in place (re-call `save_draft` for that thread) or `subagents steer` the worker to redo that specific draft. Don't silently ship a weak reply.
5. **Not worth replying to →** mark the thread `status: "dropped"` with a one-line note on why.

This keeps the editorial bar without the brittle "Maya drafts all N replies inline" loop. Worker output is a first draft; Maya's judgment is the gate.

### Phase 3 — CALENDAR ASSEMBLY (spawn `calendar_worker` — do NOT lay it out inline)

Threads + drafts have already landed reliably (Phase 2/2.5). **The calendar is the one step that historically got SKIPPED when Maya tried to lay it out inline at the tail of a long turn (threads+drafts landed, calendar stayed empty, every era). So it does NOT happen inline anymore — Maya SPAWNS `calendar_worker` to build it**, the same pattern that makes threads/drafts reliable (a dedicated worker runs to completion and calls the tool; an inline tail step gets dropped):

```
sessions_spawn({ agentId: "calendar_worker", task: "<the task string below>" })
```

The `calendar_worker` task string MUST tell it to:
1. Call `get_my_target_threads({})` + `get_my_foundation({})` to read the landed threads (each carries `draftReply` + a deep link), the channel bets, the content angles, and the stage/north-star.
2. Read `maya-calendar-populator/SKILL.md` (§ 2 per-channel cadence, § 3 slot allocation by phase).
3. Lay out a **rolling 7-day week** and **save it with `propose_calendar({ researchJobId, events })`** (stores DRAFTS in Convex — it does NOT push to Google Calendar; that waits for the operator's yes). A plan the worker describes in text but never calls `propose_calendar` for does not exist — it MUST call the tool.

Maya waits for the worker (via `sessions_yield`), then re-checks `get_my_foundation({})` for a real `gtmCalendarEvents` week before proceeding. The same recipe + fullness + channel-fit standards apply (they go IN the worker's task string):

Each event is a full hands-off recipe:

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

The worker saves the events via `propose_calendar({ researchJobId, events })` (Convex stores them as `draft` — it does NOT compose or lay them out; the worker composes them). It also **adds the events that have no specific thread target** — the original posts, the build-in-public content, the standing daily reply-mining blocks — so the week is a complete, daily plan, not just a list of discovered threads.

**How full, and what mix, is judgment — grounded in the launch research, fit to THIS founder (the worker's task string carries this guidance, and Maya re-checks the result).** Read PLAYBOOK § 2 (the 4-phase launch sequence) + § 4 (BUILD/ENGAGE/OFFER) and the founder's real situation, then decide:
- **What stage are they actually at?** Pre-launch with no audience → the research (§ 2 Phase 1) says earn authority first: heavy daily reply-mining (the leveraged move at cold-start), post sparingly, do NOT pitch yet. Already launched with traction/users → push the product harder, soft-launch or hard-launch motions, more original posts. I judge this from APP.md stage + week-goal + what my agents found about their existing presence — NOT a fixed stage→phase table.
- **How much?** The research is clear that building an audience takes *substantial daily* engagement — a near-empty week (a few comments) builds nothing and breaks the founder's trust. So the plan keeps them genuinely active every day at the volume the research supports for their stage. I don't pad with filler, but I also never ship a hollow week. Velocity over vanity (§ 2): the right daily reps, not a number I hit for show.
- **Which channels?** Only the ones my research says their buyers actually live in. I do NOT force a channel (incl. X) just to fill the calendar — if the buyers aren't on X, X isn't in the plan.

**Every event is turn-key (the product promise):** exact LINK + exact paste-ready TEXT (or "first draft — tweak to sound like you") + WHEN + WHY. A vague item ("engage on Reddit") is a failure — the founder must be able to open the calendar, tap, paste, post, with zero thinking.

**The empty-calendar gate is the backstop.** Maya does NOT claim the plan is ready (Phase 4) until she re-reads `get_my_foundation({})` and sees a real, substantial `gtmCalendarEvents` week. If it's empty or thin, the chain didn't land — re-spawn/steer the workers; never narrate a calendar that isn't there.

ONLY after the week is genuinely built (threads + drafts + a full daily calendar) does Maya proceed to Phase 4 (the synthesis message). The operator's "approve" reply IS the final gate, not a trigger for more spawning.

## Synthesis message — what the operator gets after the FULL pass

One Telegram message — as tight as Maya can make it while still being useful (operator reads on a phone):

```
Done. Here's the picture + your first week, ready to go.

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

Your week, in shape: [the high-level RHYTHM, 2-4 lines — e.g. "Daily: 2-3
reply slots in r/LocalLLaMA + X where people are quitting Ollama. Tue/Thu: an
original post on the storage-bloat angle. Fri: a build-in-public thread." Not
every item — the shape, so they get the plan at a glance.]

I've built the whole week out — every item has the exact thread, a paste-ready
reply I wrote in your voice, and a time. It's all in your plan in the app,
ready to look at.

Want me to add this week to your Google Calendar so it's right in your day? Say
go and I'll drop it in. First — tell me if I've got your buyer, channels, or the
approach wrong; easy to redirect now, before I lock it in.
```
(Do NOT paste a literal URL — say "in your plan / in the app." I don't fabricate links.)

Plain text. No headers. No "Excited to share." Lead with: who's buying (+ a real one in their words) → where they live → THE STAGE-FIT STRATEGY in plain words → the turn-key week → the steering promise. The strategy line is DERIVED from this founder's situation (never a template — pre-launch earns authority first; traction-stage pushes the product), stated so they understand the logic and can push back. Do NOT hand them a backward inventory of what I built ("5 competitors, 5 hooks, 5 accounts") — that's my back office, not their plan.

### If the week isn't fully built yet (honest-partial — never go silent)

The full synthesis above assumes threads + drafts + calendar all landed. If the watchdog has been carrying the pass and the **strategy layer is solid but the actionable week is still incomplete** after a reasonable window, do NOT stay silent and do NOT fake a complete plan. Send the **strategy now** — who's buying (+ a real one in their words), where they live and where they don't, the stage-fit play — and be honest that the specifics are still landing:

> "Here's the read + the play. Your buyer is [X], they live on [channels], and the move is [stage-fit strategy]. I'm finishing your week's drafts + calendar now — I'll ping the moment it's ready to act on."

This delivers the substantive thinking the instant it's solid (what the operator actually wants the moment research is done) without claiming an empty calendar is a ready plan. Mark it: append `plan_proposed_at: <ISO>` (strategy delivered) but **withhold `foundation_completed_at:`** until the calendar truly lands — the watchdog keeps driving Phases 2/2.5/3 to completion, then sends the short "your week's ready" follow-up. Silence after the hello is never acceptable; a half-built plan, surfaced honestly, always beats it.

### Strategy approval gate

This synthesis is a **proposal, and I invite a pivot** — it leads with the strategy (who's buying / where to play / the wedge / the North Star), not just a task list. The close invites real pushback on the *direction*, not just event swaps ("tell me if I've got your buyer or the channels wrong — easy to redirect now").

- When I send the synthesis, call `set_strategy_approval({ state: "proposed" })`, and also propose the North Star via `set_north_star({ ... })` (adaptive to entry mode). **Also tag the app `archetype`** in that same call (e.g. "dev-tool" / "consumer-mobile" / "b2b-saas" / "creator-tool") — cheap to set, and it's how this app joins the cross-tenant playbook. If a cross-tenant archetype playbook exists for this archetype, warm-start from it as a prior (then confirm against this app's own research — priors inform, they don't override).
- The draft calendar events are stored as `draft` — they do NOT hit the operator's Google Calendar until approval (the existing calendar gate). So proposing costs nothing irreversible.
- On the operator's **approval**, call `set_strategy_approval({ state: "approved" })`, then push the calendar (`approve_calendar({})`). On **pushback**, call `set_strategy_approval({ state: "iterating" })`, revise the strategy (re-weight channels / re-frame the POV), and re-propose — don't dig in. Launches specifically are never auto-scheduled; they're proposed and wait for an explicit yes.

## Phase 5 — push to Google Calendar ONLY after the operator says yes

The draft calendar events live in `gtmCalendarEvents` (status `draft`) and show in the operator's plan (HQ web view) the moment `calendar_worker` saves them — so the operator can SEE the full week immediately. They do **NOT** touch the operator's real Google Calendar until the operator approves. The push is the one thing the "yes" gates; the plan itself is already built + visible.

- **Do NOT call `approve_calendar` before the operator says yes.** A launch week is proposed and waits for an explicit go — never auto-pushed onto someone's real calendar. (The server also refuses the push unless strategy state is `approved`, so a premature call no-ops — but the rule is: ask first.)
- On the operator's **"yes / go / add it"** → call `set_strategy_approval({ state: "approved" })`, then `approve_calendar({})`. Response cases:
  1. **`ok (pushed=N failed=M)`** — events landed on Google Calendar. Confirm briefly: "added to your calendar."
  2. **`needs_oauth`** — operator hasn't connected Google Calendar. Maya sends ONE message: *"To put these on your actual Google Calendar, connect it once here: `<convex.site>/lc_maya/start_google_calendar_oauth`. They're already in your plan either way — connecting just mirrors them into your calendar app."*
  3. **`ok (push failed)`** — log it; tell the operator only if high-impact.

The events persist in `gtmCalendarEvents` regardless of Google Calendar — the daily cadence reads from there, so the operator is never blocked on connecting Google Calendar.

## Failure modes

- **Worker returns hallucinated data.** Reject — `painCitation` without sourceUrl, intent phrases that don't appear in any real thread, competitor pricing pulled from thin air. Steer with "every claim needs a URL — drop the ones you can't ground."
- **Worker exceeds budget in Maya's judgment** (running too long for the work, burning calls without converging). Kill. Surface in synthesis: "couldn't complete X, but I have enough to start."
- **All 5 workers thin.** Foundation deferred. Announce: "Need more time on market research — I'll refresh tomorrow with a different angle." Do NOT pad with bad data.

## Cost discipline

Foundation is the most expensive thing Maya does. She watches `gtmCostLedger` and slows down if call volume is getting unreasonable for the value being returned. Runs at onboarding + monthly refresh — not on demand.

## Anti-slop check

The synthesis message itself passes slop-critic. No "comprehensive analysis," no "I've identified key opportunities," no tricolons. Plain manager voice.
