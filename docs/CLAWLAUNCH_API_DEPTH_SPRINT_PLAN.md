# ClawLaunch — API Depth Sprint Plan

**Status:** Proposed / locked-on-approval. Author pass: 2026-06-04.
**Thesis:** We pay for ScrapeCreators, twitterapi.io, Zernio, and DataForSEO and use a *fraction* of each. This plan turns latent API surface into product moat — deeper grounded research, competitor ad-intelligence, link-penalty-free posting, closed-loop attribution, and a real-time intent monitor — sequenced by ROI.

Source of truth for capability claims: live OpenAPI specs + our wired code, audited 2026-06-04 (four parallel research passes). Companion files: `docs/zernio_openapi_1.0.4.yaml`, `convex/integrations/{scrapeCreators,zernio}/endpoints.ts`, `convex/integrations/twitterApiIo/twitterSearch.ts`, `infra/openclaw-runtime/plugins/maya-gtm-tools/index.js`, `agents/skills/maya-gtm/maya-foundation-research/SKILL.md`.

---

## 0. Executive summary — what we found

| API | We use | Available | The headline gap |
|---|---|---|---|
| **ScrapeCreators** | ~Reddit deep + shallow IG/YT/LI/TikTok | 154 paths / 33 platforms | **3 Ad Libraries, transcripts, Google search, audience, link-in-bio — all unwired.** 4 wired paths are STALE/404ing. |
| **twitterapi.io** | 1 endpoint (advanced_search) | ~14 endpoints | No reply-thread pull, no competitor-mention mining, no engaged-audience harvest, **no persistent intent monitor** (webhook filter rules). |
| **Zernio** | bare post + flat analytics | ~post body + 9 analytics endpoints | **first-comment link-drop unused** (eating LinkedIn's 40-50% reach penalty), X `quoteTweetId` unused (13× cost), **all time-series analytics unread**, webhooks unwired. |
| **DataForSEO** | `search_demand` exists | — | Not mandated in the foundation fan-out — workers don't call it; it's an optional gate. |

**Root cause of the Reddit-bias we observed live (HeyMaya test run, 2026-06-04):** the Phase-1 foundation fan-out mandates only `research_reddit / research_x / research_hn / scrape_creators` with **no per-channel depth floor and no evidence-based bet-gate**. Reddit/HN/X have first-class "go deep" tools; TikTok/IG/YT/LinkedIn route through the untyped `scrape_creators` escape hatch, so the model fires one call and moves on. Result that run: Reddit **39** research calls vs LinkedIn **1**, TikTok **1**, IG **1**, newsletters **0** (a *bet* channel it never researched).

---

## Build progress (2026-06-04)

| Item | Status |
|---|---|
| §0.5 Loop fix | ✅ `subagent_complete` tolerance + heartbeat 30m (committed, on staging) |
| §0.6 Scheduling architecture | ✅ locked (Zernio is the clock) |
| §0.7 Endpoint verification | ✅ all S3/S4/S5 endpoints live-probed OK |
| §0.8 Research-model expansion | ✅ locked (tiered onboarding vs ongoing + dossier) |
| S0 correctness | ✅ ScrapeCreators X/YouTube paths + twitterapi `since_time`. ⏳ remaining: dead-Zernio-path delete, `credit_guard`, twitterSearch `conversationId` preserve |
| S1 Zernio posting | ✅ **first-comment** (LinkedIn/IG/YT). ⏳ remaining: X `quoteTweet` + threads, Reddit flair pre-flight |
| S3 depth-parity | ✅ `research_tiktok/youtube/instagram/linkedin` + `research_video_comments/transcript` (6 tools) + foundation mandate |
| S4 competitor ads | ✅ `competitor_ads` + `bio_funnel` + competitor-researcher mandate |
| S5 X reply-mining | ✅ `research_x_thread / _competitor_mentions / _engaged_audience / _user_timeline` (4 tools) |
| S2 analytics + webhooks | ⏳ not started (Zernio time-series, best-time scheduling, webhook receiver, private-reply/moderate) |
| S6 UI receipts | ⏳ not started |

Plugin: **83 → 95 tools** (+12 verified research/intel tools). Every change tested, convex tsc 0, zero net-new test failures (2 pre-existing generators reds unrelated). The verifying deploy is batched for when S1-remainder + S2 land.

## 0.5 — URGENT: post-foundation heartbeat/discovery cost loop (blocks the live test)

**Symptom (live, 2026-06-04):** a deployed agent that had finished foundation + gone "idle" ran **continuous K2 turns every 20-40s** (`[agents/tool-policy] removed 6 tool(s)` bursts + `[diagnostic] lane wait exceeded: lane=main queueAhead`), billing **~$25 OpenRouter in ~4h (~$150/day)**. Distinct from the #15 *foundation* lease cap (that held — synthesis completed once and stopped).

**Root cause (hypothesis, to confirm via session transcripts):** post-foundation, with **0 connected accounts**, the daily-cadence/heartbeat path re-kicks discovery/draft work that can never reach "done" (nothing can publish), so it re-spawns the worker fleet each tick and the main lane backs up. The `recentActions: []` (no new actions persisted despite continuous turns) is consistent with a spin loop that does work but lands nothing.

**Fix (mirror the #15 pattern one phase down):**
- A durable, capped lifecycle gate for the **daily/discovery** loop like foundation has — once the day's discovery + draft pool is built and the only blocker is "accounts not connected", the heartbeat must go to a true **no-op** (status check only, no fleet spawn) until either accounts connect or the next scheduled cadence cron.
- Heartbeat turn must be cheap: check `get_agent_lifecycle` + connection health → if blocked-on-connect, emit nothing and spawn nothing.
- Cron audit: the evening-recap content fired at 2pm — verify cron schedules + timezone resolution (the `timezone: row.agent.timezone` plumbing at `deployMayaGtm.ts:1161`) and that no missed-run catch-up burst is enqueuing.
- Re-confirm "destroy old machine on redeploy" so stopped/looping machines don't linger.

This is a **prerequisite for resuming the long-running test** — ships before S1.

## 0.6 — Scheduling & posting-time architecture (LOCKED 2026-06-04)

**Decision:** Zernio is the clock. The agent does **not** wake up to post, and the heartbeat is **never** the firing mechanism.

- **Planning (when):** the `morning_brief` cron (7am local) builds the day's plan and assigns each action a **spread-out** time — via Zernio **queue slots** (`/v1/queue/slots`, seeded from `best-time` analytics, e.g. 9:00 / 12:30 / 15:00 / 18:00) + `queuedFromProfile` so Zernio auto-assigns the next open slot. Hard rules: **min-gap ≥45-90 min**, **daily fair-use cap**, never two in one hour. `midday_pulse` (1pm) adds time-sensitive strikes. This is what prevents "15 posts at 9am."
- **Firing (how it actually posts):**
  - **Auto-post channels — X, LinkedIn, Instagram, YouTube:** hand the post to Zernio with a future `scheduleAtMs` (already plumbed: `publishContentDirect` → Zernio returns `state:"scheduled"`). **Zernio fires it server-side. Zero agent tokens at post time.**
  - **Confirm-first channels — Reddit, TikTok (LOCKED: keep human one-tap):** a cheap **non-LLM** Convex `scheduler.runAt(startsAtMs, sendConfirmCard)` fires at go-time and sends the **one-tap Telegram card**. The operator taps to post. Rationale: a Reddit ban is catastrophic and hard to undo; TikTok's API *requires* a consent/preview step anyway. Ban safety > automation.
  - **Time-sensitive replies:** post at *discovery* (not pre-scheduled hours out) — auto → `publishNow`; confirm channel → immediate one-tap card.
- **`gtmCalendarEvents`** stays as the **planning + receipt layer** (what the UI renders, what Maya reasons over) — **not** a heartbeat-polled firing queue.
- **Consequence for cost:** once posting runs on Zernio's clock and inbound runs on Zernio webhooks (`comment.received`, S2), the heartbeat has almost nothing to do → quiet *structurally*, not just by interval. This is the durable fix behind §0.5.

## 0.7 — Endpoint verification matrix (LIVE-probed 2026-06-04, before any wiring)

Every new endpoint below was hit against the real API with our production keys and **returned 200 + the expected shape.** Response key in parens — use these exact keys when building the typed tools.

**S3 depth-parity (ScrapeCreators):**
- TikTok: `/v1/tiktok/video/comments` (`comments`) ✓ · `/v1/tiktok/video/transcript` (`transcript`) ✓
- YouTube: `/v1/youtube/search` (`videos`) ✓ · `/v1/youtube/video/comments` (`comments` + `continuationToken`) ✓ · `/v1/youtube/video/transcript` (`transcript` + **`transcript_only_text`** + `language`) ✓
- Instagram: `/v1/instagram/search/hashtag` (`posts`) ✓ · `/v2/instagram/post/comments` (`comments`) ✓
- LinkedIn: `/v1/linkedin/search/posts` (`posts` + `cursor`) ✓

**S4 ad intelligence (ScrapeCreators):**
- FB Ad Library: `/v1/facebook/adLibrary/search/companies` (`searchResults`) ✓ · `/v1/facebook/adLibrary/search/ads` (`searchResults` + `searchResultsCount` + `cursor`) ✓
- Google Ad Library: `/v1/google/company/ads` (`ads` + `number_of_ads_estimate`, **1 credit**) ✓

**S5 X reply-mining (twitterapi.io):**
- `/twitter/tweet/advanced_search` (`tweets`) ✓ · `/twitter/tweet/replies/v2` (key is **`tweets`**, w/ `next_cursor`) ✓ · `/twitter/tweet/retweeters` (key is **`users`**) ✓ · `/twitter/user/mentions` (`tweets`) ✓
- ⚠️ Operator caveat **confirmed live**: `min_replies:` returns nothing (unsupported) — use the verified `min_faves:` instead. Header must be `x-api-key: <key>` exactly.

**Already fixed & verified (S0):** TikTok video search shape, YouTube `/channel-videos`, X `/user-tweets` (all live-probed; IG `/v1/user/posts` confirmed still-working).

## 0.8 — How the new capabilities reshape the research model (LOCKED)

Yes — these abilities expand foundation research, **most of all competitive intelligence**. But the governing principle stays **minimum viable data**: onboarding must stay fast + bounded in COGS, so we **tier** what gets mined where.

### The competitive lane becomes a real dossier (biggest upgrade)
Today the competitive worker = "who are they + a few complaint quotes." With the new APIs it becomes a genuine competitive-intelligence sweep:
- **What they're paying to say** — `competitor_ads` (FB/Google/LinkedIn ad libraries): live ad copy, offers, CTAs, and **which ads they've kept running** (a long-running ad = a *proven* hook). Ad transcripts for video ads.
- **Their funnel** — `bio_funnel` (Linktree/etc.): lead magnet → pricing → community in one call.
- **Their content + hooks** — their social posts/transcripts (scrape_creators) → what's working for them.
- **Their positioning** — `search_web` on their pricing/changelog (already in the lane).

Maya can now say "here's exactly what your competition is running, what's proven, and the gap" — and it becomes a UI receipt (S6) and a content input (ground the founder's posts in messaging the market already pays for).

### Channel research becomes depth-balanced
Every bet channel mined to comment/transcript depth (S3 typed tools), not just Reddit — with the per-channel floor + evidence bet-gate. This is the fix for the Reddit-bias.

### The tiering decision (the COGS guardrail)
**Onboarding (foundation pass) — sharper but bounded:**
- Competitive: ad-library read **IS** included (FB company-ads is cheap, Google is 1cr, high signal) + funnel + positioning. But cap ad *detail* fetches to top-N competitors.
- Channels: mine comments/transcripts on **bet channels only**, bounded sample (top ~K threads/videos), not exhaustive.
- Demand: the one batched `search_demand` call (already).
- Reply-thread + retweeter harvesting: **NOT** in onboarding (expensive, time-sensitive — belongs to the live loop).

**Ongoing (continuous-research cron, weekly/monthly) — the heavy compounding work:**
- Ad-library **monitoring over time** (did the competitor change/launch ads? that's a signal worth a ping).
- Deep transcript mining, reply-thread harvesting, engaged-audience lists.
- Refreshing the competitive dossier monthly.

**Why tier, not "do it all in onboarding":** a foundation pass already costs real API spend; ad-lib + depth-balanced comments add to it, and exhaustive transcript/reply mining on day one would blow both COGS and the sub-few-minutes onboarding latency. `credit_guard` (S0) enforces a per-pass ceiling. The compounding mining is worth more *amortized over the relationship* than front-loaded.

### Build impact
- **Competitive worker** mandate expands (S4 lands `competitor_ads` + `bio_funnel` into it; split into `competitive_map` + `competitive_intel` sub-workers if the single lane gets too heavy).
- **`maya-ad-intelligence`** method skill (how to read a competitor's ad set: kept-running = proven; recent launch = a bet; gap = opening).
- **`maya-continuous-research`** SKILL gains the ongoing ad-monitoring + deep-mining cadence.
- Onboarding-vs-ongoing split documented in `maya-foundation-research` SKILL so workers know what's in-scope for the bounded pass.

## 1. Cross-cutting correctness fixes (S0 — prerequisite, tiny, ships first)

These are silently degrading us **today** — fix before building on top.

**ScrapeCreators stale paths** (`convex/integrations/scrapeCreators/endpoints.ts`) — *live-probed 2026-06-04, results below:*
1. ~~IG posts~~ — **FALSE ALARM. `/v1/instagram/user/posts` returns 200, still works.** Left as-is. (v2 migration for `next_max_id` pagination is optional, not S0.)
2. ✅ **DONE** — YouTube `/v1/youtube/channel/videos` (**404 confirmed**) → `/v1/youtube/channel-videos`. Also added `viewCountInt`/`likeCountInt`/`commentCountInt`/`publishDate` field mapping (the current shape uses Int variants); back-compat preserved; 2 contract tests added.
3. ✅ **DONE** — X `/v1/twitter/user/tweets` (**404 confirmed**) → `/v1/twitter/user-tweets`. Also rewrote `normalizeXTweets` for the raw GraphQL shape (text at `legacy.full_text`, id at `rest_id`, views at `views.count`); back-compat preserved; contract test added. Returns ~100 *popular* tweets, not chronological — noted in code.
4. ⏭️ **DEFERRED to S3** — LinkedIn `/v1/linkedin/posts` (**404 confirmed**) is a signature change (needs `*url` not `handle`; only `/company/posts` + `/search/posts` exist, no personal-posts-by-handle). The 404 is already contained by `Promise.allSettled` in `runFullScrapePull` (LinkedIn posts come back empty, no crash). Proper fix lands with `research_linkedin` in S3.

**twitterapi.io** (`convex/integrations/twitterApiIo/twitterSearch.ts` + `research_x` tool prose):
5. Teach `since_time:`/`until_time:` **unix seconds**, NOT `since:`/`until:` dates (docs explicitly reject the date form).
6. Stop dropping `conversationId`, `inReplyToId`, `isReply`, `author.followers` in the normalize — they're required for thread chaining downstream.

**Zernio dead code** (`convex/integrations/zernio/endpoints.ts`):
7. Delete legacy Late/GBP paths (`/api/v1/locations`, `/reviews`, `/insights`, `/messages`, `/comments`) — absent from the 1.0.4 spec, 404 on call. (Service product abandoned.)

**Tests:** contract test per repathed endpoint (one live call, assert 200 + shape); regression that `research_x` normalize preserves `conversationId`.

---

## 2. The creative plays (ranked by ROI) — what we're building toward

### Tier 1 — directly grows conversions / kills cost & penalties
1. **first-comment link-drop (Zernio).** Put the app link in `firstComment` on LinkedIn/IG/YouTube; keep `content` link-free. Recovers the **40-50% LinkedIn organic reach penalty** we eat today (`zernioRoutes.ts:82` appends `${content} ${url}`). Pure plumbing. *Highest single ROI.*
2. **X `quoteTweetId` instead of URL-in-text.** **$0.015 vs $0.20/post** (13×) and higher reach. Use for own/mentioned posts.
3. **Closed-loop attribution via Zernio time-series.** Poll `/v1/analytics/post-timeline` daily per post → correlate the impression/click spike to the wrapped-link conversion we already track. `/content-decay` tells Maya when a post is dead so she stops waiting. This is the *proof-of-what-converted* moat, sitting unread.
4. **Competitor ad-intelligence (ScrapeCreators Ad Libraries).** `facebook/adLibrary/company/ads` → every competitor's live ads + copy + CTA + `firstShown` (a kept-running ad = a *proven* winner); `ad/transcript` for video scripts. Plus Google + LinkedIn ad libraries for B2B. Maya mines messaging the market already pays to run, then grounds the founder's organic posts in it. *Biggest new capability.*
5. **comment-to-DM on hot leads (Zernio private-reply + buttons).** When `list_inbox` surfaces buyer intent ("how does this work?"), `private-reply` with a URL button → public comment becomes a private, attributable click.

### Tier 2 — sharper research grounding
6. **Transcript mining (TikTok/IG/YouTube).** Transcribe top videos ranking for a buyer-pain query + competitors' best content → exact phrasing/hooks/structure. Maya drafts native-sounding scripts & replies → higher resonance, lower ban risk.
7. **Google Search (`/v1/google/search`, 1 credit).** Cheap grounding spine: verify competitor pricing, find the canonical pain SERP, discover which subreddits/threads/videos rank — before asserting anything ("grounded or silent" insurance).
8. **X reply-thread mining (twitterapi.io `replies/v2` + `conversation_id:`).** The reply-driven 80% of pre-1K acquisition. Find a viral niche original (`min_faves:200 -filter:replies`), pull its whole reply thread, extract pain language + warm targets.
9. **Link-in-bio funnel map.** One `/v1/linktree|linkbio` call resolves a competitor's entire destination stack (lead magnet → pricing → Discord → newsletter).

### Tier 3 — compounding / always-on
10. **Persistent X intent monitor (twitterapi.io filter rules).** `POST /oapi/tweet_filter/add_rule` with a niche-intent expression + `update_rule` to activate → matching tweets pushed to a Convex webhook the instant they post. This is the **native build for the real-time intent-strike gate** that's been operator-blocked (removes the "live poll + wake" problem).
11. **Competitor-mention switch leads (twitterapi.io `user/mentions` + `to:<competitor> ("cancel" OR "alternative" OR "too expensive")`).** Highest-conversion lead type on X — people publicly unhappy with a competitor.
12. **Best-time scheduling (Zernio `/analytics/best-time` + `/posting-frequency`).** Schedule via `queuedFromProfile` at the empirically optimal slot, not "now."
13. **Reddit pre-flight (Zernio `reddit-flairs`/`reddit-subreddits`).** Cuts Reddit's **~54% post-failure rate** (flair-required rejections) before the one-tap card.

---

## 3. Sprint breakdown

> Sequencing principle: correctness → cheapest-highest-ROI plumbing → research depth → new capabilities. Each sprint is independently shippable and testable. All deploy AFTER the current long-running test agent's cadence is verified (no mid-test deploys).

### **S0 — Correctness & cost guardrails** (0.5 day)
- The 7 fixes in §1.
- **`credit_guard`** (internal): wrap ScrapeCreators `/v1/credit-balance` + daily-usage so Maya self-throttles the metered calls (TikTok audience **26cr**, Google ad-detail **25cr**, twitterapi per-unit). Hard ceiling per foundation pass.
- Files: `endpoints.ts` (both), `twitterSearch.ts`, plugin prose.
- Tests: repath contract tests; credit-guard fail-closed at ceiling.

### **S1 — Zernio posting upgrades** (1-1.5 days) — *Tier-1 #1, #2, #13*
- Extend `multiPlatformPost` / `post_to_channel` to send `platformSpecificData`:
  - `firstComment` (LinkedIn/IG/YouTube) — move link out of caption. **Replace `zernioRoutes.ts:82` link-append.**
  - X: `quoteTweetId`, `threadItems[]`, `poll`.
  - Reddit one-tap card: resolve `flairId` via `reddit_preflight` (`/accounts/{id}/reddit-flairs`, `reddit-subreddits`, `tools/validate/subreddit`).
  - TikTok one-tap: `tiktok_creator_info` pre-fetch + mandatory `contentPreviewConfirmed`/`expressConsentGiven` (camelCase — spec divergence; prose docs are wrong).
- Files: `convex/gtmMaya/{publishEngine,zernioRoutes}.ts`, `convex/integrations/zernio/endpoints.ts`, plugin `post_to_channel`.
- Tests: ban-safety still FORCE-gates Reddit/TikTok to needs_confirm; first-comment payload shape; X link → quoteTweet path; Reddit flair-required → card carries flairId.

### **S2 — Zernio analytics + closed-loop + webhooks** (1.5-2 days) — *Tier-1 #3, #5; Tier-2 #12*
- New readers: `get_post_timeline`, `get_content_decay`, `get_best_time`, `get_posting_cadence` (+ IG/TikTok/YT channel-insights where add-on present, graceful degrade).
- Feed `best-time` into scheduling (`queuedFromProfile`); feed `content-decay` into when Maya stops watching a post.
- **Webhook receiver**: new httpAction `/lc_gtm/zernio_webhook` (HMAC) consuming `post.published/failed/partial` + `comment.received` → replaces the 24h `confirmEventLanded` re-poll AND inbox polling. Register via `/v1/webhooks/settings`.
- `private_reply_to_comment` (IG/FB buttons) + `moderate_comment` (hide/like).
- Files: `convex/gtmMaya/{zernioReads,resultsLoop,publishEngine}.ts`, `convex/http.ts`, `maya-performance-reader/SKILL.md`.
- Tests: webhook HMAC verify + dedup; post-timeline join into attribution; private-reply ban-safety gate.

### **S3 — ScrapeCreators depth-parity tools + foundation mandate** (2 days) — *fixes the Reddit-bias; Tier-2 #6, #7, #9*
- Typed first-class research tools (each chains the drill so the model can't under-call):
  - **`research_tiktok`**: `search/keyword` → `v2/tiktok/video?get_transcript=true` (folds transcript, dodges +10cr fallback) → `video/comments` → `comment/replies`.
  - **`research_instagram`**: `search/hashtag`|`v2/reels/search` → `v1/post` → `v2/media/transcript` → `v2/post/comments`.
  - **`research_youtube`**: `search` → `video/transcript` → `video/comments` → `comment/replies`.
  - **`research_linkedin`**: `search/posts` + `company/posts` (`*url`) → `post` → `post/transcript`.
  - **`ground_search`**: thin `/v1/google/search` (1cr) wrapper, called reflexively before asserting external facts.
  - **`bio_funnel`**: `/v1/linktree|linkbio|komi|pillar` dispatcher.
- **Foundation fan-out fix** (`maya-foundation-research/SKILL.md` + `generators.ts` renderTools):
  - Add `search_web` + `search_demand` to the **worker** mandate (today they're Maya-only gates).
  - **Per-channel depth floor**: every bet candidate must run its `research_<platform>` drill (search → detail → comments/transcript) before scoring.
  - **Evidence bet-gate**: `bet:true` requires ≥K grounded evidence items (quotes w/ URLs OR demand signal). No grounding → `bet:false, reason:"insufficient evidence"` — never an inferred bet (newsletters this run).
- Files: plugin (new tools), `maya-foundation-research/SKILL.md`, per-channel researcher SKILLs, `generators.ts`.
- Tests: bet-gate rejects evidence-empty channel; each research_* tool returns normalized {posts,transcripts,comments}; foundation worker calls search_demand.

### **S4 — Competitor ad intelligence** (1.5 days) — *Tier-1 #4*
- **`competitor_ads`** tool: `facebook/adLibrary/search/companies` → `company/ads` (loop active) → `ad/transcript`; + `google/company/ads` (1cr enumerate, 25cr detail only on top-N) + `linkedin/ads/search`. Normalized `{platform,pageName,isActive,firstShown,body,cta,creativeUrls,transcript}`.
- Wire into `maya-competitor-researcher` (Phase-1 competitive worker) + a new `maya-ad-intelligence` method skill.
- Files: plugin, `convex/gtmMaya/` (new ad-library client wrapper), `maya-competitor-researcher/SKILL.md`.
- Tests: cost-cap (no `get_ad_details` blanket); normalize shape; competitor with no ads → graceful empty.

### **S5 — X reply-driven mining + intent monitor** (2 days) — *Tier-2 #8; Tier-3 #10, #11*
- Typed tools on `twitterApiGet`:
  - **`research_x_thread`**: `tweet/replies/v2?queryType=Likes` (+ `conversation_id:` fallback). *The single biggest missing piece given the reply thesis.*
  - **`research_x_buyer_intent`**: builds the operator string (correct `since_time:` unix) instead of trusting the model to free-hand.
  - **`research_x_competitor_mentions`**: `user/mentions` + `to:<competitor> (<complaint lexicon>)`.
  - **`research_x_engaged_audience`**: `tweet/retweeters` + `tweet/quotes`, ICP-filter by bio/follower.
  - **`research_x_user_timeline`**: `user/last_tweets?includeReplies=true`.
  - **`x_intent_monitor`** (set/clear): `add_rule`/`update_rule`/`get_rules`/`delete_rule` → pushes to `/lc_gtm/x_intent_webhook`. **Productizes the real-time intent-strike gate.**
- Files: plugin, `convex/integrations/twitterApiIo/`, `convex/http.ts`, `maya-x-founder-led-researcher/SKILL.md`, intent-strike wiring.
- Tests: thread pull preserves author follower counts; intent-monitor rule lifecycle; webhook dedup; per-unit cost cap on retweeter/follower harvests (profile-billed).

---

### **S6 — UI receipts (surface the depth)** (1 day) — *trust + retention + WTP*
The web app is the receipt, not a console. Surface curated, plain-language, outcome-framed views of the new depth — never raw dumps.
- **Research tab → add "Where your buyers are"**: render the per-channel scorecard we already compute (`gtmChannelScorecard`) — each of the 6 channels with its evidence (`icpKnowledge`: venues, complaints w/ URLs, native-style) and a clear "betting / not betting + why". This makes the depth-parity work (S3) *legible* and directly answers "are you researching every channel?". The data exists; only the query + render are missing.
- **Results tab → closed-loop card** fed by S2 (`post-timeline` + attribution): "this post → these clicks → these signups", with `content-decay` showing when a post stopped working.
- **New "Competitor ads" view** (gated on S4): cards of competitors' live ads + the hooks Maya extracted. The highest-"holy-cow" trust artifact.
- Keep out: transcripts, API payloads, model/credit/lease internals. Plain language only (per the user-facing-copy rule).
- Files: `app/clawlaunch/mission/{research,results}/page.tsx`, new `convex/gtmMaya/missionControl.ts` queries (channel scorecard, competitor ads).
- Tests: cross-tenant query isolation; empty-state ("research in progress"); plain-language lint (no internal terms).

## 4. COGS discipline (this plan expands API spend — budget it)

| Call | Cost | Guard |
|---|---|---|
| ScrapeCreators flat | ~1 cr | default |
| TikTok audience | **26 cr** | shortlist-only, `credit_guard` |
| Google ad detail | **25 cr** | enumerate at 1cr, detail top-N only |
| Google search | 1 cr | reflexive, cheap |
| twitterapi tweets | $0.15/1K | paginate deliberately |
| twitterapi profiles (retweeters/followers) | $0.18/1K | cap harvest size |
| search_web | ~$0.04 | 2-3/foundation |
| search_demand | ~$0.075 batched | 1/foundation |
| slide image | ~$0.07 | per slideshow |

All metered calls log via `log_cost`; `credit_guard` (S0) enforces a per-pass ceiling. Target: a full foundation pass stays under the per-customer monthly COGS envelope at $99.

---

## 5. Testing — the 5 mandatory categories apply per sprint
1. Cross-tenant isolation (account resolution from agent's own `connectedAccountsJson`, never the shared workspace).
2. Plan-tier × action (fail-closed; ban-safety FORCE gate intact on every new posting path).
3. Adversarial inputs (malformed handles/URLs, empty/blocked API responses → `ok:false`, never throw).
4. Sibling-file scan (new tool ↔ skill mandate ↔ TOOLS.md index coherent).
5. TODO grep.

Plus per-sprint contract tests against live API responses (one call each) since several wired paths were stale.

---

## 6. Teaching Maya to USE the new tools (cross-cutting — every sprint)

A new typed tool is useless if Maya doesn't know when/why to reach for it. Maya's "how to think" lives in three layers, and **every new tool in this plan must update all three** — this is a Definition-of-Done gate, not a follow-up:

1. **TOOLS.md** (`generators.ts` `renderTools`) — the terse orientation index. Each new tool gets a one-line "what + when" entry in the right functional group (and, for the research tools, a per-channel "go deep" note so the model stops treating non-Reddit channels as the escape hatch).
2. **The owning SKILL.md** — the deep how/when/judgment. Each new capability needs its method skill: `research_tiktok`/`instagram`/`youtube`/`linkedin` extend their existing per-channel researcher SKILLs with the drill sequence; `competitor_ads` gets a new `maya-ad-intelligence` skill ("a competitor ad that's run 60+ days is a *proven* hook — extract it, don't copy it"); the X reply-mining tools extend `maya-x-founder-led-researcher`; Zernio first-comment/threads/quote get rules in `maya-publisher`.
3. **The worker/agent mandate** — for foundation, the Phase-1 worker `task:` strings (`maya-foundation-research`) must *name* the new tools and the per-channel depth floor + evidence bet-gate (S3). For the daily loop, the cadence skills (`morning-brief`, `continuous-research`, `performance-reader`) must reference the new analytics/posting tools.

Plus a **decision heuristic** Maya needs (added to AGENTS.md/PLAYBOOK): *"Where do my buyers actually convert?"* is answered by **depth-balanced** research (every bet channel grounded), **demand** (`search_demand`), and **competitor-proven messaging** (`competitor_ads`) — not by whichever API returned the most rows. This is the prompt-level antidote to the Reddit-bias.

Sibling-file coherence (mandatory test category #4) already enforces tool↔skill↔index consistency — extend it to fail if a new tool lacks a TOOLS.md entry or a skill reference.

## 7. Recommended order & rationale
**S0 → S1 → S2 → S3 → S4 → S5.** S0 stops active bleeding. S1/S2 are cheap, pure-plumbing, Tier-1 ROI (link penalty, cost, attribution moat). S3 fixes the depth-parity problem that prompted this plan. S4/S5 add the two biggest *new* capabilities (ad intelligence, reply-mining + intent monitor). S1-S2 could run before S3 even though S3 is the "asked-for" fix, because they're lower-risk and higher immediate ROI — but if depth-parity is the priority, S3 can jump ahead of S4/S5 right after S0.
