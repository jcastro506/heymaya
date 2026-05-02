# HeyMaya Creator Maya - TikTok-First Sprint Plan

**Target:** shippable creator-first v0
**Primary ICP:** TikTok creators with 5K-500K followers
**Product shape:** one creator gets one proactive Maya social media manager
powered by OpenClaw
**Design stance:** treat this as a clean build, even though the current repo has useful patterns

---

## 1. Product Thesis

Build **Creator Maya for TikTok**: an always-on AI social media manager who knows one creator deeply, watches their TikTok account, understands their niche, fits advice to their real schedule, tracks TikTok trends, analyzes video creative, and messages them the next best move before they ask.

The first sellable promise is not "AI content generation." The promise is:

> Maya knows what works for your TikTok and tells you what to make next.

The product should feel like a junior social media manager who:

- knows the creator's style and constraints
- watches TikTok trends in their niche
- studies the creator's actual videos
- tracks performance against the creator's own baseline
- builds a weekly plan
- nudges filming and posting
- reacts when a post over- or under-performs
- keeps a memory of what to repeat, remix, and stop doing

No multi-platform v0. No brand-deal desk v0. No broad BrainOS framing. TikTok creators first.

The web product is not the main experience. The web product creates the
account, runs onboarding, collects creator context, connects TikTok/calendar,
and starts native iMessage pairing. After that, Creator Maya lives on the
creator's phone, powered by OpenClaw.

---

## 2. Locked Principles

1. **TikTok first.** Every behavior is optimized for TikTok: hooks, retention, format, trend fit, watch loops, captions, comments, posting cadence.
2. **The agent is the product.** The dashboard is the receipt and approval surface. The relationship lives in iMessage for v0.
3. **Creator-specific beats generic expertise.** Maya should say "your audience responds to X" more often than "TikTok generally rewards X."
4. **Watch selectively, never blindly.** Gemini should not watch 30 full videos at onboarding. Maya samples intelligently, stores structured analysis, and deep-watches only when the marginal value is high.
5. **Grounded or silent.** Every recommendation must cite one of: creator post data, video analysis, comment signal, schedule availability, trend evidence, or memory.
6. **One concrete next move.** Maya should prefer one specific action over five vague ideas.
7. **Never auto-post.** Maya drafts, plans, analyzes, and nudges. The creator posts.
8. **Memory compounds.** Every week should make Maya better at knowing this creator.
9. **Small dashboard, strong loop.** Ship the agent workflow before building analytics theater.
10. **Server-side gates.** Plan limits, data access, and outbound actions are enforced in Convex, not just hidden in UI.

---

## 3. What We Are Not Building In v0

- Multi-platform creator manager
- Full brand-deal CRM
- Contract scanning
- Stripe revenue dashboard
- Manager-readiness packets
- Auto-publishing
- Web chat, SMS, WhatsApp, or email outreach
- Deep editing suite
- Generic second brain
- A big creator dashboard
- A "team of agents"

Those may come later. v0 is TikTok social media management.

---

## 4. Core User Journey

### 4.1 Landing

Message:

> Your TikTok social media manager before you can hire one.

Subline:

> Maya studies your videos, your niche, your schedule, and TikTok trends. Then
> she manages the daily loop from iMessage, powered by OpenClaw.

CTA:

> Hire Maya

The landing should sell a concrete daily loop:

1. Connect TikTok.
2. Maya studies what has worked and what has not.
3. Pick your goals and posting schedule.
4. Enter your phone number and pair native iMessage through OpenClaw.
5. Maya texts you a daily plan.
6. She watches new posts and tells you what to repeat or fix.

### 4.2 Signup

User signs up with Clerk. Convex creates an account row.

Required fields:

- email
- timezone
- account status: onboarding
- plan: trial or starter
- primary channel: iMessage
- calendar connection status

### 4.3 Onboarding Step 1 - Connect TikTok

Creator enters TikTok handle.

Maya verifies:

- handle exists
- profile metadata is readable
- follower count is inside target range, or accepted with a warning if outside
- profile belongs to the creator by showing avatar/display name confirmation

Maya stores:

- handle
- display name
- follower count
- bio
- avatar URL
- verifiedAt

### 4.4 Onboarding Step 2 - Lightweight Pull

Pull metadata for recent and top posts, but do not deep-watch all of them.

Collect:

- last 30 post metadata
- top 10 posts by views or engagement
- bottom 10 recent posts by relative performance
- captions
- thumbnails
- durations
- publish times
- public metrics
- top comments for selected posts where available
- profile/bio links

This pull creates the raw input pool. It is not the same thing as video analysis.

### 4.5 Onboarding Step 3 - Smart Video Sampling

This answers the "30 posts is nuts" concern.

Gemini should not watch 30 videos in full. The pipeline should be:

1. **Metadata pass over 30 posts.**
   Use captions, metrics, duration, publish time, thumbnail, and basic derived fields.

2. **Select 6-8 videos for deep watch.**
   Choose:
   - top 3 performers
   - bottom 2 performers
   - most recent 1-2 posts
   - 1 outlier format if metadata shows a unique topic or duration

3. **Clip, frame, or transcript first.**
   Prefer:
   - first 3 seconds
   - first frame
   - transcript/caption
   - sampled frames every few seconds
   - full video only for short/high-value examples

4. **Deep-watch only when needed.**
   Full video watch is reserved for:
   - creator picture synthesis on selected examples
   - new-post reaction
   - postmortem
   - viral post extraction

5. **Cache every analysis.**
   Once a post is analyzed, store the structured result. Never pay to re-watch the same video unless the analysis version changes.

The onboarding analysis should produce enough insight to personalize Maya without pretending she watched everything.

### 4.6 Onboarding Step 4 - Connect Calendar

Maya needs schedule access before she can act like a real social media
manager. Calendar is not a later productivity add-on; it is how Maya knows when
to suggest filming, editing, posting, and review blocks.

Flow:

1. User connects Google Calendar or Apple phone calendar access.
2. User chooses which calendars Maya can read.
3. User chooses whether Maya can create tentative content blocks.
4. Maya imports availability windows, busy blocks, timezone, and recurring
   creator commitments.
5. Maya stores calendar access with least privilege and can revoke from
   settings.

Provider modes:

- `google_api`: server-side Google Calendar connection. Maya can sync lookahead
  events, classify creator-relevant events, and create/update/delete only
  Maya-owned calendar holds after approval.
- `apple_phone_api`: device-side Apple calendar bridge. The phone app reads
  calendars with local permission and pushes the limited lookahead Maya needs
  into Convex. The server should not pretend it can directly read iCloud
  calendars without the user's device/app permission.

Beta sequencing:

- Google Calendar can be completed entirely during web onboarding through
  Composio OAuth. Creator Maya then imports the next 14 days of lookahead into
  Convex.
- Apple Calendar is selected during web onboarding, but actual permission
  happens on the iPhone after OpenClaw iMessage pairing. The phone bridge sends
  privacy-filtered lookahead and Maya-owned hold writes back to Convex.
- OpenClaw deploy should require a phone number and a chosen calendar path, not
  a completed native iMessage pairing. Native pairing needs the live OpenClaw
  app id created by deploy, so requiring `imessagePaired` before deploy is a
  circular gate.

Initial permissions:

- read busy/free availability
- read event title only when user allows it
- create tentative content-planning blocks
- update/delete only events Maya created

Maya should never create public-facing events without approval. In v0, calendar
write actions are "hold this filming block" and "schedule this TikTok work
session," not complex calendar management.

### 4.7 Onboarding Step 5 - Creator Interview

Ask only what cannot be inferred.

Maya needs to know where the creator is, but onboarding should feel like a
smart manager intake, not a long survey. The product rule is:

> infer first, ask second, confirm third.

Maya should infer from TikTok and calendar before asking questions. Then ask a
short intake that covers:

- creator stage
- current reality
- 90-day goal
- biggest blocker
- weekly time budget
- style and constraints

Required:

- goal for next 90 days
- creator stage: just starting, growing consistently, monetizing, trying to go
  full-time, already full-time
- biggest blocker
- current content constraint
- realistic weekly posting target
- weekly hours available for content
- preferred filming/editing/posting windows
- calendar boundaries Maya should respect
- tone preference: supportive, strategic, tough-love
- do-not-suggest list

Optional:

- topics they refuse to cover
- creators they admire
- creators they do not want to sound like
- niche boundaries
- monetization goal

The UI should feel conversational, but the output is structured data.

### 4.8 Onboarding Step 6 - Maya Readback

Before deploy, Maya shows a short read of the creator and asks for correction.

Example:

> Here is what I think: you are a founder-creator trying to grow authority, but
> your best posts are tactical demos, not personal updates. Your constraint is
> time, so I will bias toward 20-30 second result-first posts you can film around
> work blocks. Your next 90-day goal is consistent growth and sponsor readiness.

The user can accept or edit:

- stage
- goal
- niche
- audience
- time budget
- tone
- do-not-suggest rules
- calendar boundaries

This readback becomes the seed for `creatorPicture`, `USER.md`, and `SOUL.md`.

### 4.9 Onboarding Step 7 - Creator Picture

Generate `creatorPicture` from:

- TikTok profile
- metadata from 30 posts
- deep analysis of 6-8 selected posts
- top comments from selected posts
- creator interview
- Maya readback corrections
- connected calendar availability
- schedule constraints

Output fields:

- niche
- subniches
- audience
- voice fingerprint
- visual style
- content pillars
- working hooks
- weak hooks
- best formats
- risky formats
- posting cadence
- schedule constraints
- calendar boundaries
- creator stage
- weekly content time budget
- creator goals
- trend fit rules
- do-not-suggest list
- confidence score per section
- source citations

If confidence is low, store that. Maya should say "I need more data" rather than inventing certainty.

### 4.10 Onboarding Step 8 - Phone Handoff

The website should not make the user watch infrastructure boot. Once Maya has
enough context and the user has entered a phone number, the web flow should
end with a calm handoff screen:

> You're all set. Maya will text you directly.

This is a product boundary, not just copy. The web app captures setup context;
the relationship starts on the phone.

Flow:

1. User enters phone number.
2. Convex saves `setup_complete`.
3. Convex enqueues OpenClaw/Fly provisioning.
4. Web UI shows the handoff screen and optional setup status.
5. User can close the browser.

State model:

- `setup_complete`: all required web data is saved
- `maya_provisioning`: OpenClaw workspace and Fly machine are being created
- `maya_online`: OpenClaw health check passes and native iMessage is ready
- `first_text_sent`: Maya sent the activation iMessage
- `provisioning_failed`: operator alert required; user sees a clear status

OpenClaw owns native iMessage delivery. Convex records the active
`pairedChannels` row once the channel is available, gates plan/channel state,
and marks Maya active only after the native OpenClaw channel is online. The
older mock `pairImessage` path is a local test harness only.

First message shape:

> I read your last 30 TikToks and deep-watched the strongest and weakest examples. Your best posts open with the finished result before explaining anything. Your weakest ones start with context. Tomorrow I would film one 18-25 second post that shows the result in frame one. I can draft it now.

Important correction: Maya must not send this message until OpenClaw is online
and the iMessage send path is confirmed. The web page can say setup is done;
it cannot claim Maya is active until `first_text_sent` succeeds.

### 4.11 Onboarding Step 9 - Deploy Maya

Convex generates a per-creator OpenClaw workspace and deploys one Maya machine.

Maya boots with:

- creator picture
- schedule
- TikTok handle
- standing orders
- tools list
- cron jobs
- memory seed
- model router endpoint
- channel config

After deploy, Maya sends the activation iMessage. The creator can still open a
minimal dashboard, but the dashboard is a receipt/status surface:

- Today's brief
- next post idea
- weekly plan
- post library
- settings

---

## 5. The Daily iMessage Loop

### 5.1 What Happens Every Morning

At 7:00am creator-local time, OpenClaw runs `morning_brief`.

Maya reads:

- creatorPicture
- current weekly plan
- creator schedule for today
- TikTok posts from last 72h
- latest post metrics
- trend observations from last 24h
- hook library
- open commitments

Maya writes:

- `dailyBriefs` row
- `mayaActionLog` row

Maya sends an iMessage if the creator has iMessage paired.

Message format:

1. One sentence on the signal.
2. One specific thing to make today.
3. One reason it fits this creator.
4. One filming/posting time tied to their schedule.
5. One reply option.

Example:

> Morning. Your strongest recent TikToks all show the result before the setup; the context-first posts are the ones dragging. Today at 3pm, film one "result first, explanation second" post around the client mistake story you mentioned. I would keep it under 25 seconds and open on the finished result. Reply "draft" and I will write the shot list.

Calendar behavior:

- Maya reads today's real availability before proposing a filming or editing
  time.
- If there is no open block, Maya suggests the next realistic available slot
  instead of inventing one.
- If the creator replies "schedule," Maya creates a tentative calendar block
  with the shot list or task summary.
- Maya only edits/deletes events she created.
- Every calendar write gets a `mayaActionLog` entry with provider event ID,
  action, and originating brief/plan ID.

### 5.2 When Maya Should Not Message

Maya should stay quiet when:

- she has no new signal
- metrics have not changed materially
- trend fit is weak
- the creator already has a plan and no pending action
- the last message is still unanswered and not urgent

No "checking in" filler. Silence is acceptable if the dashboard has receipts.

### 5.3 Post-Publish Reaction

Triggered when a new TikTok appears.

Timing:

- first reaction: 30-60 minutes after detection
- stronger analysis: 2h and 24h checkpoints

At first reaction, Maya deep-analyzes the post:

- first frame
- first 3 seconds
- hook type
- caption
- pacing
- topic
- visible pattern match against creator's winners

Maya should only message if there is a meaningful observation.

Example:

> Early read: this uses the same "show the outcome first" structure as your March 12 post, but the first frame is less clear. If it is still under baseline at 2h, repost the idea with the finished result filling the frame.

### 5.4 2-Hour Performance Check

Every 2 hours between 8am and 10pm local, Maya checks recent posts.

Message only when:

- post is above 1.5x matched-time baseline
- post is below 0.5x matched-time baseline
- comments reveal a clear follow-up post
- a trend/post format should be repeated immediately

### 5.5 Evening Recap

At 7:00pm local.

Message only if there was activity:

- post went live
- draft was approved
- a post crossed a threshold
- creator missed a commitment
- tomorrow's plan needs attention

Otherwise no iMessage; write dashboard row only.

### 5.6 Weekly Plan

Sunday 4:00pm local.

Maya creates:

- 5-7 TikTok ideas
- for each idea: hook, shot list, caption, why it fits, expected outcome
- schedule fit
- trend or memory citation

Maya sends:

> I built next week's TikTok plan. The bet is short result-first videos, not storytime. Your best slot is Tuesday/Thursday afternoon. Want the first shot list?

Calendar behavior:

- Maya proposes filming, editing, posting, and review blocks that fit the
  creator's connected calendar.
- Maya can place tentative holds after approval through iMessage.
- A weekly plan is not accepted until every idea has either a proposed time
  block or a reason it is unscheduled.

### 5.7 Weekly Review

Sunday 9:00pm local.

Maya reviews:

- posts shipped
- commitments kept/missed
- best hook
- worst hook
- comments worth mining
- trends tested
- one experiment for next week

This updates memory/wiki.

---

## 6. Feature List

### v0 Must-Have

1. TikTok account verification
2. Recent/top post metadata pull
3. Smart video sampling and Gemini analysis
4. Creator-picture generation
5. iMessage pairing
6. Calendar connection and schedule window import
7. Maya-created calendar holds after user approval
8. OpenClaw per-creator deploy
9. Daily morning brief
10. Weekly TikTok plan
11. Post-publish watcher
12. 2-hour performance check
13. Hook library
14. Basic trend scanner with source-quality benchmark
15. Minimal web HQ
16. Memory/wiki updates
17. Server-side plan gates
18. AI call logging and cost tracking

### v0.5

1. Comment mining for follow-up ideas
2. Creator peer watch
3. Script/shot-list drafts
4. Postmortem requests from iMessage
5. "Remix this post" flow
6. Content commitment tracking
7. Trend fit scoring
8. Multi-calendar preference rules

### Later

1. Instagram Reels
2. YouTube Shorts
3. Brand outreach operator
4. Auto-generated edit briefs
5. Human editor handoff
6. Team access
7. Paid partnership pipeline
8. Multi-person creator brands

### Current Beta Implementation Status

This repo now has a real beta skeleton, not a finished beta. The feature list
above remains the target; the table below is the current truth.

| Area | Current status | True-beta gate |
| --- | --- | --- |
| TikTok metadata pull | Mock pull implemented; ScrapeCreators action bridge added | Live ScrapeCreators account pull succeeds for a real handle and stores profile/posts |
| Smart video sampling | Implemented and tested for metadata-driven 6-8 post selection | Gemini analyzer consumes selected clips/frames/transcripts and writes cached analyses |
| Creator intake/readback | Implemented and tested as structured Convex flow; web onboarding now captures editable goal/blocker/niche/hour inputs | Add final copy polish and validation around weak answers |
| Calendar | Mock calendar, direct Google OAuth/API routes, encrypted Google token storage, Google lookahead sync, legacy Composio import bridge, and Apple phone-provider mode implemented | Real Google OAuth succeeds in beta env; Apple phone bridge sends lookahead events from device into Convex |
| Calendar content planning | Implemented lookahead classification and content arcs | Maya uses those arcs in morning brief and weekly plan generation |
| iMessage | Mock harness exists; native OpenClaw pairing request/confirm UI is wired and gated on real Fly app id | OpenClaw native iMessage pair request, confirmation, and send succeed end to end |
| OpenClaw/Fly | Mock deploy gate and live temporary Fly boot smoke exist | Per-creator production OpenClaw workspace deploy is recorded with real Fly app/machine IDs |
| Daily brief | Implemented and tested against stored creator/TikTok/calendar context | Runs on creator-local schedule and sends only through native iMessage |
| Brand outreach | Tier gates and Studio approval queue implemented | Not in Starter/Pro; Studio beta requires contact enrichment, approval queue UI, and email send audit |
| Web HQ | Real setup surface now exists for account, TikTok, calendar path, creator intake, phone handoff, OpenClaw manifest, and iMessage pairing | Add error-state copy and visual QA after live env variables are present |
| Production deploy | Tailwind scan/build hang fixed; `next build` exits cleanly locally | Deploy target passes browser smoke and auth redirect checks |

---

## 7. Tiering

The tiers should map to trust, cost, and autonomy.

### Starter - TikTok Manager

Promise:

> Maya helps you make better TikToks consistently.

Included:

- TikTok connect
- 30-post metadata pull
- selective Gemini video analysis
- creator picture
- daily iMessage brief
- weekly content plan
- post watcher
- hook library
- ScrapeCreators trend scan
- calendar connection
- calendar-aware content planning
- approved Maya-owned calendar holds

Not included:

- outbound brand discovery
- contact enrichment
- brand outreach campaigns
- auto-follow-up sequences

Calendar is in Starter because schedule context is core personalization. Maya
should know what the creator has coming up, where there is filming/editing time,
and whether a calendar event should become content.

### Pro - Growth + Monetization Prep

Promise:

> Maya helps you grow and become sponsor-ready.

Included:

- everything in Starter
- deeper weekly review
- richer trend and peer watch
- comment mining for follow-up ideas
- richer memory/wiki
- media kit / creator profile draft
- brand-fit categories
- inbound brand email triage if Gmail is connected
- brand reply drafts for user approval

Pro introduces brand readiness, but not cold outbound. Maya can help the creator
look professional and respond well; she does not yet reach out to new brands.

### Studio - Brand Outreach Operator

Promise:

> Maya turns your audience into brand opportunities.

Included:

- everything in Pro
- outbound brand discovery
- contact enrichment
- pitch campaign drafts
- user-approved email sends
- follow-up management
- deal pipeline
- brand call scheduling on the connected calendar
- stronger approval/autonomy controls

Default autonomy level: send after approval only. Auto-send is not v0.

### Autonomy Levels For Brand Work

```txt
level 0: research only
level 1: draft only
level 2: send after approval
level 3: auto-follow-up approved contacts
level 4: auto-send within approved campaign rules
```

Ship through level 2 first. Level 3 and 4 require trust history, suppression
lists, reply handling, and explicit creator configuration.

---

## 8. Clean Architecture

### 8.1 System Diagram

```txt
Creator
  |
  | iMessage
  v
OpenClaw Maya agent on Fly
  |
  | tool calls
  v
Convex backend
  |
  | reads/writes
  +-- TikTok data adapter
  +-- Gemini video analyzer
  +-- trend search adapter
  +-- iMessage sender
  +-- calendar adapter
  +-- brand desk adapter
  +-- scheduler/job state
  |
  v
Next.js dashboard
```

### 8.2 Next.js

Keep the web app small.

Routes:

```txt
/
/onboarding
/today
/plan
/posts
/memory
/settings
```

No Performance/Deals/Trends/Profile split in v0. Those can become tabs later. For TikTok v0:

- Today is the main receipt.
- Plan is the weekly content plan.
- Posts is post history + hook library.
- Memory shows what Maya has learned.
- Settings controls schedule, tone, iMessage, connected TikTok, and connected
  calendar.

### 8.3 Convex Tables

Core tables:

```txt
accounts
creatorProfiles
tiktokAccounts
tiktokPosts
tiktokPostMetrics
videoAnalyses
creatorPicture
creatorSchedule
calendarConnections
calendarEvents
calendarActionLog
contentIdeas
contentPlans
dailyBriefs
weeklyReviews
hookLibrary
trendObservations
postPostmortems
mayaActionLog
aiCallLog
channelConnections
openclawDeployments
brandTargets
brandContacts
brandFitScores
brandOutreachCampaigns
brandOutreachMessages
brandReplies
brandDeals
brandApprovalQueue
brandActionLog
```

Important design choice: split `tiktokPosts` from `videoAnalyses`.

`tiktokPosts` stores facts from the platform.

`videoAnalyses` stores what Gemini inferred. This lets us re-run analysis without changing source facts.

### 8.4 OpenClaw Workspace

Per creator:

```txt
AGENTS.md
SOUL.md
USER.md
TOOLS.md
HEARTBEAT.md
DREAMING.md
MEMORY.md
jobs.json
```

`SOUL.md` is generated from `creatorPicture`.

`USER.md` is editable state:

- goal
- tone
- schedule
- calendar permissions
- calendar boundaries
- constraints
- do-not-suggest list
- posting target

`AGENTS.md` contains standing orders.

`TOOLS.md` documents tool names and when to call them.

`DREAMING.md` tells Maya how to update memory weekly.

### 8.5 Tool API

OpenClaw should not directly know vendor APIs. It calls Convex-backed tools:

```txt
tiktok.get_profile
tiktok.list_recent_posts
tiktok.get_post_metrics
tiktok.get_comments
tiktok.search_trends
video.analyze_tiktok_post
calendar.get_availability
calendar.create_hold
calendar.update_hold
calendar.delete_hold
maya.save_daily_brief
maya.save_weekly_plan
maya.save_hook
maya.save_postmortem
maya.save_trend
maya.get_schedule
maya.send_imessage
brand.search_targets
brand.score_fit
brand.find_contacts
brand.draft_pitch
brand.queue_for_approval
brand.send_approved_email
brand.log_reply
brand.schedule_brand_call
brand.update_pipeline_stage
```

Convex owns auth, plan gates, retries, vendor keys, calendar tokens, caching,
logging, and writes.

### 8.6 Brand Outreach Architecture

Brand outreach is a separate capability pack behind Pro/Studio gates. It should
not pollute the TikTok daily loop.

Core flow:

1. Maya uses `creatorPicture` to identify brand categories that fit the creator.
2. Maya proposes brand categories before specific targets.
3. Maya discovers brand targets and contacts through Convex adapters.
4. Maya scores fit with citations from creator data, brand data, and campaign
   evidence.
5. Maya drafts pitches in the creator's voice.
6. Creator approves sends.
7. Maya sends through the creator's connected Gmail only after approval.
8. Maya watches replies, updates pipeline stage, and can schedule brand calls
   on the connected calendar after approval.

Hard rules:

- no generic pitches
- no direct vendor calls from OpenClaw
- no brand send without tier gate and approval gate
- every contact must store provenance
- every sent message must have a campaign, creator approval, and audit log row
- suppression/unsubscribe state must be checked before send

### 8.7 Model Routing

Use a single primary model for v0, with thinking budgets:

```txt
low:
  chat reply
  basic trend filtering
  evening recap
  simple nudge

medium:
  morning brief
  post-publish reaction
  weekly plan
  hook extraction summary

high:
  creator-picture synthesis
  weekly review
  strategy shift
  deep postmortem
```

Video analysis should be budgeted separately from text reasoning. The expensive operation is not "30 posts"; it is video tokens. That is why v0 must sample.

### 8.8 Video Analysis Pipeline

Pipeline:

```txt
raw TikTok post
  -> metadata stored
  -> thumbnail/frame extraction
  -> transcript/caption parse
  -> sample selector
  -> Gemini analysis
  -> structured videoAnalysis row
  -> creatorPicture / hookLibrary / postmortem consumes it
```

Analysis schema:

```txt
videoAnalyses:
  creatorId
  postId
  analysisVersion
  watchedMode: metadata_only | first_3_seconds | sampled_frames | full_video
  firstFrame
  firstThreeSeconds
  hookType
  pacing
  topic
  visualPattern
  captionFit
  audiencePromise
  likelyRetentionRisk
  repeatability
  citations
  model
  costUsd
  createdAt
```

The selector should choose the cheapest sufficient watch mode.

---

## 9. Trend Scan Source Decision

The repo uses `ScrapeCreators` as the creator read layer. Keep that spelling in
code, docs, logs, and vendor configuration. The architecture should keep the
adapter name generic:

```txt
trendSource.searchTikTokTrends(...)
trendSource.searchHashtag(...)
trendSource.searchSounds(...)
trendSource.searchCreators(...)
```

### Recommendation

Use **ScrapeCreators as primary for v0** and add **Apify only as a benchmark +
fallback** until we prove the primary source misses trends Maya needs.

Why:

- The current project already has a ScrapeCreators client, cache, fixtures, and
  tests. Using it keeps v0 narrower.
- ScrapeCreators exposes TikTok profile, profile videos, video info,
  transcripts, comments, search users, and hashtag search. That is enough for
  owned-account reads and a first trend scanner.
- Apify has a broader marketplace and specialized TikTok actors for search,
  hashtag, music, comments, and trend discovery. That is useful, but it adds a
  second vendor, second schema family, second reliability profile, and more
  cost/debug surface.

### When ScrapeCreators Is Enough

ScrapeCreators is enough if it can reliably return:

- top videos for 10-20 niche hashtags
- search results for 5-10 niche keywords
- enough metadata to rank posts by momentum
- captions, hashtags, author, postedAt, play count, likes, comments, shares
- stable URLs that Gemini can inspect for selected videos

If those work, Maya can ship the first trend loop.

### When We Add Apify

Add Apify if one of these is true during Sprint 5 testing:

- ScrapeCreators hashtag/search results are stale by more than 24 hours.
- ScrapeCreators cannot return sound/music trend surfaces.
- Search results are too sparse for niche discovery.
- Error rate is above 5 percent across the test trend corpus.
- Apify produces materially better trend candidates in blind review.

### Benchmark Gate

Before deciding, run the same 20 trend queries through both sources:

- 10 hashtag queries
- 5 keyword queries
- 3 sound/music queries
- 2 competitor/peer discovery queries

For each source, score:

- freshness
- relevance to niche
- duplicate rate
- availability of metrics
- cost per usable trend
- latency
- failure rate

Decision rule:

- If ScrapeCreators wins or ties on freshness/relevance for at least 14/20
  queries, keep only ScrapeCreators in v0.
- If Apify wins 7+ of 20 and the misses are important for daily brief quality,
  add Apify as a fallback behind the adapter.
- Do not let OpenClaw call either vendor directly. Maya calls the Convex trend
  adapter; Convex chooses the vendor and logs the source.

---

## 10. OpenClaw Standing Orders

### morning_brief

Runs 7:00am local.

Scope:

- read creator schedule
- read latest TikTok metrics
- read active weekly plan
- read trend observations
- write daily brief
- send one iMessage if action exists

Approval:

- no approval required for a brief
- no posting

Escalation:

- if no grounded action exists, write dashboard note and skip iMessage

### post_publish_reaction

Event-driven on new post.

Scope:

- analyze post
- compare to creator baseline
- update hook library if relevant
- send one short message only if useful

Approval:

- no approval required
- no public action

### performance_check_2h

Runs every two hours during waking hours.

Scope:

- update metrics
- detect outlier up/down
- write annotation
- send iMessage only on threshold crossing

### weekly_plan

Runs Sunday 4:00pm local.

Scope:

- generate weekly TikTok plan
- store contentIdeas/contentPlans
- send summary

Approval:

- creator approves by replying or opening dashboard

Calendar:

- once approved, Maya creates tentative filming/editing/posting holds for the
  accepted plan
- Maya never overwrites non-Maya calendar events
- calendar conflicts create a revised plan instead of a forced write

### weekly_review

Runs Sunday 9:00pm local.

Scope:

- synthesize week
- update memory/wiki
- write weeklyReview
- send 3-line recap

---

## 11. Sprint Plan

### Sprint 0 - Clean Product Slice

Goal: strip the design to TikTok creator manager.

Build:

- new docs and product scope
- simple schema for TikTok-first creator
- route map
- feature flag for old broad surfaces
- plan gate helper

Acceptance:

- a new engineer can explain the product in 2 minutes
- no dependency on brand deals or service-business features

Testing gate:

- `docs/CREATOR_MAYA_TIKTOK_FIRST_SPRINT_PLAN.md` exists and is linked from
  README or CLAUDE before implementation starts.
- Route inventory test proves only `/onboarding`, `/today`, `/plan`, `/posts`,
  `/memory`, `/settings` are required for creator v0.
- Feature-scope grep proves no creator-v0 build path imports brand-deal,
  service-business, or Riley growth-agent modules.
- Plan helper tests prove unknown plan values fail closed.
- Tier tests prove Starter includes calendar read + content holds, Pro stops at
  brand prep/draft, and Studio gates outbound brand outreach behind approval.

### Sprint 1 - TikTok Read Layer

Goal: connect one TikTok account and build the raw post pool.

Build:

- TikTok/ScrapeCreators adapter
- verify handle
- pull profile
- pull last 30 post metadata
- pull selected comments
- cache rows
- source-fact storage

Acceptance:

- signed-in creator can connect TikTok
- Convex stores profile and 30 post metadata
- no Gemini video analysis yet

Testing gate:

- Unit: TikTok adapter parses recorded profile, post-list, single-video,
  comment, and hashtag-search fixtures.
- Unit: adapter handles 429, 5xx, timeout, empty profile, private/unavailable
  profile, malformed payload.
- Integration: `verifyTikTokHandle` rejects nonexistent handles and returns
  canonical handle/display name for valid handles.
- Convex: all `tiktokPosts` and cache rows are scoped by signed-in creator.
- Cost gate: one onboarding metadata pull logs source calls and stays under
  the configured API-call cap.
- Live manual: one real creator handle pulls 30 post metadata without touching
  Gemini.

### Sprint 2 - Smart Video Analysis

Goal: analyze only the right posts.

Build:

- sample selector
- frame/transcript extraction bridge
- Gemini video analyzer
- `videoAnalyses` table
- cost logging
- analysis cache

Acceptance:

- onboarding selects 6-8 posts from 30
- Gemini does not full-watch all 30
- each analyzed post has structured output
- repeated onboarding does not re-analyze unchanged posts

Testing gate:

- Unit: sample selector always selects at most 8 posts.
- Unit: selector includes top performers, weak performers, recent posts, and
  one format outlier when available.
- Unit: selector degrades gracefully when the account has fewer than 8 posts.
- Unit: analysis cache key includes `postId`, media URL/hash, and
  `analysisVersion`.
- Integration: repeated analysis with unchanged inputs makes zero model calls.
- Model-contract: mocked Gemini output is validated against the
  `videoAnalyses` schema; malformed JSON retries once then fails structured.
- Cost gate: analysis job records per-post watch mode and total estimated
  video-token cost.
- Policy gate: no code path can call full-video analysis for more than the
  configured onboarding cap.

### Sprint 3 - Creator Picture

Goal: generate Maya's understanding of the creator.

Build:

- creator interview UI
- synthesis prompt
- creatorPicture table
- source citations
- confidence per section
- first message generation

Acceptance:

- Maya can explain creator niche, hooks, weak patterns, audience, schedule, and next move
- every non-obvious claim has source citations
- low-confidence sections are marked low-confidence

Testing gate:

- Unit: creator-picture validator rejects missing citations for niche, hooks,
  weak patterns, and schedule-derived recommendations.
- Unit: onboarding intake asks no more than six required questions before
  Maya readback.
- Unit: Maya readback combines inferred TikTok/calendar context with user
  answers and preserves creator corrections.
- Unit: low-data accounts produce low-confidence sections rather than invented
  certainty.
- Integration: recorded 30-post fixture plus 6 analyses produces a complete
  `creatorPicture`.
- Adversarial: contradictory self-report vs post data produces a gentle
  reconciliation note.
- Regression: generated first message cannot claim "I watched all 30 videos";
  it must distinguish metadata pull from selected deep-watch.
- Cost gate: creator-picture synthesis logs one high-thinking call and stays
  under target cost.

### Sprint 4 - OpenClaw Deploy + iMessage

Goal: deploy one Maya and get the first iMessage.

Build:

- workspace generator
- SOUL/USER/AGENTS/TOOLS/HEARTBEAT/DREAMING
- jobs.json generator
- Fly deploy
- OpenClaw channel pairing
- calendar OAuth connection and availability import
- first message

Acceptance:

- creator finishes onboarding and immediately sees the "You're all set. Maya
  will text you directly." handoff screen
- Maya deploys asynchronously after setup completion
- creator receives first iMessage only after OpenClaw health check and iMessage
  readiness pass
- Maya can schedule an approved filming hold on the connected calendar
- web dashboard shows deployment status and first receipt

Testing gate:

- Unit: workspace generator emits `AGENTS.md`, `SOUL.md`, `USER.md`,
  `TOOLS.md`, `HEARTBEAT.md`, `DREAMING.md`, `MEMORY.md`, and `jobs.json`.
- Unit: `jobs.json` has valid 5-field cron expressions and creator timezone.
- Unit: `SOUL.md` includes creatorPicture facts but omits raw secrets.
- Integration: mocked Fly deploy receives correct image, env, secrets, and
  workspace URL.
- Deploy gate: mock OpenClaw deploy can run without paid infra, but live-test
  deploy requires green mock E2E, Fly token, and explicit paid-deploy approval.
- Channel: mocked iMessage pairing handles success, timeout, wrong-code, and
  retry.
- Calendar: mocked OAuth handles success, revoked token, read-only permission,
  write permission, conflict, and provider timeout.
- Calendar: `calendar.create_hold` is idempotent by creator, plan item, and
  requested time window.
- Calendar: Maya can update/delete only events with a matching Maya-created
  marker.
- Provisioning: setup completion writes `setup_complete` before OpenClaw deploy,
  then transitions through `maya_provisioning`, `maya_online`, and
  `first_text_sent`.
- Provisioning: OpenClaw failure records `provisioning_failed`, shows a web
  status message, and emits an operator alert.
- Messaging: activation iMessage cannot be sent before OpenClaw reports healthy
  and the native iMessage channel is ready.
- E2E mock: onboarding to deployed state writes `openclawDeployments`,
  channel row, calendar connection row, first daily receipt.
- Security: no vendor API keys or channel tokens are returned to the browser.

### Sprint 5 - Daily Loop

Goal: Maya sends useful daily messages.

Build:

- morning brief job
- weekly plan job
- daily trend scan
- basic schedule reader
- calendar availability reader
- iMessage-to-calendar scheduling reply handler
- dailyBriefs/contentPlans tables
- minimal Today and Plan screens

Acceptance:

- Maya sends 7am local iMessage with one grounded move
- Maya skips iMessage when there is no grounded move
- "schedule" reply creates a tentative calendar hold for the recommended work
  block
- Sunday plan is generated and visible

Testing gate:

- Unit: morning brief prompt builder refuses to emit unsupported metrics.
- Unit: timezone scheduler fires 7:00am in creator-local time, including DST
  cases.
- Unit: "no grounded action" path writes a dashboard receipt and sends no
  iMessage.
- Integration: morning brief writes `dailyBriefs` and `mayaActionLog` before
  channel send.
- Integration: weekly plan writes 5-7 ideas with hook, shot list, caption,
  schedule fit, and citations.
- Integration: accepted weekly plan creates only Maya-owned tentative calendar
  holds.
- Trend benchmark: run 20 fixed queries through ScrapeCreators
  and Apify test adapters; record winner per query before production vendor
  decision.
- E2E mock: creator receives exactly one 7am message for a grounded-action day.
- E2E mock: creator replies "schedule" and sees exactly one matching calendar
  hold.

### Sprint 6 - Post Watcher

Goal: Maya reacts to posts after they go live.

Build:

- new-post detector
- post-publish reaction
- 2h performance check
- hook library
- post annotations
- Posts screen

Acceptance:

- new TikTok post triggers analysis
- Maya messages only on meaningful signal
- hook library updates from winners
- weak post gets a specific postmortem, not generic advice

Testing gate:

- Unit: new-post detector dedupes same post across retries.
- Unit: post-publish reaction uses selected watch mode and does not re-watch
  cached analyses.
- Unit: threshold logic sends only on >1.5x or <0.5x matched-time baseline, or
  a high-confidence comment/trend signal.
- Integration: 2h performance check writes post annotation and action log.
- Integration: hook library write requires source post, hook type, and
  repeatability reasoning.
- Adversarial: missing metrics, deleted post, private video, and vendor timeout
  all degrade to no-send plus retry log.
- E2E mock: new post appears, Maya analyzes it, and only sends when threshold
  is crossed.

### Sprint 7 - Memory Compounding

Goal: Maya improves week over week.

Build:

- weekly review
- memory/wiki pages
- "what worked / what failed / what to test" loop
- creator-visible Memory screen
- memory update tests

Acceptance:

- after one week, Maya's next plan references learned patterns
- memory updates are source-cited
- creator can edit/delete incorrect memory

Testing gate:

- Unit: weekly review outputs `what worked`, `what failed`, `test next`, and
  `do not repeat` sections.
- Unit: memory writer rejects claims without post/video/trend citations.
- Integration: weekly review updates memory/wiki and next weekly plan reads it.
- UI: creator can edit or delete a memory item and Maya respects correction on
  the next plan.
- Regression: deleted memory is not reintroduced unless new evidence supports
  it.
- E2E mock: two-week fixture shows week-two plan using week-one learning.

### Sprint 8 - Beta Hardening

Goal: 5-10 real TikTok creators using Maya daily.

Build:

- reliability dashboard
- cost guardrails
- onboarding failure recovery
- channel failure recovery
- manual operator override
- feedback capture

Acceptance:

- 5 beta creators complete onboarding
- daily message reliability >95 percent
- no creator gets a hallucinated metric
- average onboarding analysis stays inside target cost

Testing gate:

- Live beta: 5 real TikTok accounts complete onboarding and receive first
  iMessage.
- Reliability: scheduled-message success rate above 95 percent over 7 days.
- Quality review: manually review 50 Maya messages; zero hallucinated metrics,
  zero unsupported trend claims.
- Cost: median onboarding cost and p95 daily cost are under budget.
- Failure drill: vendor outage, Gemini malformed output, Fly deploy failure,
  channel send failure, and Convex transient failure all produce actionable
  operator logs.
- Retention signal: at least 3/5 beta creators reply to Maya or open the
  dashboard on 3+ days in week one.

---

## 12. Tests That Matter

1. Cross-tenant isolation.
2. Plan gates fail closed.
3. Gemini sample selector never selects more than configured cap.
4. Re-analysis cache prevents duplicate video spend.
5. Citation firewall rejects unsupported claims.
6. iMessage send is skipped when no grounded action exists.
7. Timezone-local 7am schedule.
8. Calendar hold creation is approval-gated and idempotent.
9. Calendar writes can only update/delete Maya-owned events.
10. New-post watcher dedupes reposts/retries.
11. Weekly memory update preserves user corrections.
12. Cost per onboarding stays under budget.
13. Trend-source benchmark records freshness/relevance/cost before vendor lock.
14. Daily iMessage is skipped when Maya has no grounded action.

---

## 13. Cost Guardrails

The main cost risk is video analysis.

Rules:

- never full-watch 30 posts
- metadata pull can cover 30 posts
- deep analysis cap: 6-8 posts at onboarding
- full video cap: only short videos or selected high-value posts
- use first 3 seconds whenever hook analysis is the goal
- use sampled frames when pacing/visual structure is enough
- cache analysis by postId + videoUrl/hash + analysisVersion
- store model usage in `aiCallLog`
- show internal cost per onboarded creator

If onboarding analysis cost exceeds target, reduce deep-watch count before reducing personalization quality everywhere else.

---

## 14. Definition Of Working

The product works when a first-time TikTok creator can:

1. Sign up.
2. Connect TikTok.
3. Let Maya pull 30 metadata rows.
4. Let Maya deep-analyze only the selected sample.
5. Connect calendar.
6. Answer the short creator interview.
7. Confirm or correct Maya's read of where they are and what they want.
8. Pair iMessage.
9. Receive a grounded first message.
10. Receive a useful 7am local message the next morning.
11. Publish a TikTok.
12. Get a post-specific read from Maya that references the actual creative,
    not generic TikTok advice.

The internal proof is:

- all sprint testing gates are green
- full mock E2E passes via `convex/creatorMayaV0/__tests__/backendE2E.test.ts`
- one live-test OpenClaw deploy passes after mock E2E is green; current harness:
  `npm run smoke:creator-maya-v0 -- --live --confirm`
- no unsupported creator-specific claims ship in sampled QA
- onboarding and daily costs are visible in `aiCallLog`

Current MVP gate status:

- Green: Creator Maya v0 unit tests, Convex mock E2E, calendar lookahead tests,
  UI render test, focused onboarding/iMessage/calendar tests, regenerated
  Convex bindings, touched-file TypeScript check, repository-wide Vitest suite,
  and local Next production build.
- Newly implemented beta bridges: ScrapeCreators TikTok pull action,
  direct Google Calendar OAuth/API onboarding, Google-calendar lookahead sync
  actions, Apple-phone provider mode, calendar event classification/content
  arcs, live OpenClaw deployment recording, native iMessage pairing verification
  from `pairedChannels`, and a web onboarding surface that hands the user to
  phone-first operation.
- Remaining true-beta gates: beta env must contain Google OAuth client env,
  ScrapeCreators credentials, OpenClaw CLI credentials, Fly token, and a live
  per-creator app deploy path. Then run a real iMessage pair/send and a real
  Google or Apple calendar scheduling hold.
- Note: full Convex typecheck still reports unrelated legacy test/schema typing
  issues outside the Creator Maya v0 files. They do not block `npm test` or
  `next build`, but they should be cleaned before treating Convex typecheck as
  a global release gate.

### Current Web Architecture Reset

The creator web surface is now split by user intent:

- `/` is the public HeyMaya landing page for creators.
- `/creator-maya-v0` is the signed-in onboarding app. It captures the creator
  picture, TikTok handle, calendar mode, and phone number, then hands the user
  to OpenClaw-native iMessage.
- `/creator-maya-v0/debug` is the internal operator console for mock E2E runs,
  Studio brand gate checks, OpenClaw readiness validation, and native pairing
  diagnostics.

Environment path:

1. Local: `localhost:3020`, HeyMaya Clerk development keys, Convex dev
   deployment with `CLERK_JWT_ISSUER_DOMAIN` set to the same Clerk frontend API
   URL, Google OAuth local redirect, no production user promises.
2. GitHub: feature branches named `codex/*`, with Creator Maya changes kept
   isolated from unrelated Riley/service-business work.
3. Staging: staging web deployment, staging Convex deployment, staging Clerk
   app, and Google OAuth redirect for the staging domain.
4. Production: `https://www.hey-maya.ai`, production Convex deployment,
   production Clerk app, Google OAuth production redirect, ScrapeCreators
   production key, and live OpenClaw/Fly iMessage pairing.

Local developer rule:

- Prefer `http://localhost:3020` in the browser.
- If a Google OAuth client still redirects to `127.0.0.1`, Next dev allows that
  origin for HMR/font assets, but the OAuth app should be updated to include
  `http://localhost:3020/api/google-calendar/callback` before the next full
  local Google Calendar test.
- Google Calendar start and callback routes stay public in Clerk middleware.
  The routes do their own signed-in checks so OAuth can resume cleanly after
  Clerk redirects.

---

## 15. Why This Beats A Broad BrainOS Start

BrainOS is an eventual platform. Creator Maya is a wedge.

Creator Maya has:

- one ICP
- one platform
- one daily workflow
- clear data
- obvious willingness to pay
- visible outcomes
- strong proactive loop

TikTok-first Creator Maya can later become:

- Maya for Reels
- Maya for Shorts
- Maya for brand deals
- Maya for creator business ops
- eventually, a creator-specific BrainOS

But v0 should not sell BrainOS. It should sell:

> Maya helps you win on TikTok this week.
