---
name: maya-platform-cron
version: 0.1.0-sprint3
description: Maya's proactive behavior schedule — when she does what.
---

# cron.md — Maya's proactive schedule

This file is the single source of truth for **when Maya does what**. Every
proactive behavior Maya performs — every push, every brief, every nudge — is
scheduled here. Reactive behaviors (chat replies, on-demand asks) are not in
this file; behaviors that fire on external events (Gmail webhook, PDF upload,
ScrapeCreators delta) are listed at the bottom under **Event-driven entries**
because they have no cron expression but still belong in the sibling-scan.

The OpenClaw scheduler reads this file at boot, cross-references each
`entryId` against `creators.cronEnablement` (computed from
`planFeatures(creator)` in `convex/lib/planFeatures.ts`), and only schedules
the entries the creator's plan tier permits. Disabled entries are skipped
silently — the creator is never told an entry was suppressed.

This document is paired with `playbook.md` (the prose for each behavior) and
`skill.md` (the skill inventory each behavior depends on). The Sprint 3
acceptance gate runs a sibling-file scan that asserts every `entryId` here
has a matching playbook section AND every playbook section has either a
matching cron entry here or is explicitly tagged event-only / on-demand-only.

---

## 1. Timezone semantics

Every cron expression in this document evaluates **in the creator's
timezone**, not in UTC. The scheduler reads `creators.timezone` (an IANA zone
string such as `America/Los_Angeles`, `Europe/London`, `Asia/Tokyo`) and
computes the next-fire time per-creator. A `0 7 * * *` entry fires at 7:00 AM
local for the LA creator and 7:00 AM local for the Tokyo creator — these are
14 hours apart in wall-clock UTC and that is the desired behavior.

Daylight-saving transitions are handled inside the scheduler. On the spring
forward, a `0 2 * * *` entry in `America/New_York` does not fire (the clock
skips 02:00). On the fall back, the entry fires once (the scheduler
deduplicates the doubled hour). Maya's playbook does not reason about DST;
she trusts the scheduler. If a creator's `creators.timezone` changes mid-day
(e.g. they fly LAX → JFK and update their profile), the scheduler recomputes
all next-fire times on the next heartbeat. Already-in-flight runs complete
in the originating zone and are not re-fired.

UTC is used only for one thing: the `aiCallLog.ts` and `mayaActionLog.ts`
write columns, so cross-tenant analytics align across zones. Every
human-facing timestamp in Maya's messages is rendered in the creator's local
zone.

If `creators.timezone` is missing or invalid, the scheduler refuses to boot
that creator's Maya and writes a `mayaActionLog` row with severity `error` —
fail closed, never default to UTC silently (UTC defaults are how creators
get a 7am brief at 11pm).

---

## 2. Cron entries

All expressions are 5-field POSIX cron (`min hour dayOfMonth month
dayOfWeek`). `dayOfWeek`: `0` = Sunday, `1` = Monday, … `6` = Saturday.
Each `entryId` here matches a key in `PER_TASK_DEFAULT_BUDGET` /
`ALL_CRON_ENTRIES` in `convex/agents/packs/maya/configGeneratorMaya.ts`. If
you add or rename an entry here, you must update both.

| entryId | expression | description | thinking | tier | conditions | playbook § |
|---|---|---|---|---|---|---|
| `morning_brief` | `0 7 * * *` | Daily 7am push: yesterday's signal, today's recommendation, one specific action. Cited from `posts`, `postMetrics`, `dailyBriefs` history. | medium | all | none — runs unconditionally | `playbook.md § Morning brief` |
| `accountability_nudge` | `0 10 * * *` | Daily 10am check on the commitment Maya recorded yesterday. Anti-sycophantic; one nudge max. | low | all | only if `checkIns` row from prior 24h has `status="committed"` and no `followThroughAt` | `playbook.md § Accountability nudge` |
| `performance_check_2h` | `0 8,10,12,14,16,18,20,22 * * *` | 2h window during waking hours. Pulls fresh metrics on today's posts; flags outliers; queues a post-publish reaction if a new metric crossed an alert threshold. | low | all | only if `posts.postedAt` within last 24h for any handle (skip silently otherwise) | `playbook.md § Post-performance check` |
| `daily_niche_scan` | `0 18 * * *` | Daily 6pm scan of niche-wide trending hashtags / sounds / formats via ScrapeCreators. Emits `wiki_apply` to `niche/<niche>/trend-pattern` (durable) + writes `trendObservations` projection (HQ Trends read surface). | low | all | none | `playbook.md § Daily niche scan` |
| `evening_recap` | `0 19 * * *` | Daily 7pm recap: what posted today, how it performed, what tomorrow looks like. Two-paragraph prose, no bullet dump. | low | all | none — runs even on no-post days (the recap then is "rest day, here's what's queued for tomorrow") | `playbook.md § Evening recap` |
| `weekly_content_plan` | `0 16 * * 0` | Sunday 4pm next-week plan. Folds in `calendar_lookahead` results from the prior week (when Calendar connected). Plan reaches all 5 platforms on both tiers. | medium | all | none | `playbook.md § Weekly content plan` |
| `weekly_review` | `0 21 * * 0` | Sunday 9pm synthesis of the week: top posts cited, what worked, what didn't, one tactical change for next week. Both tiers run the full `high`-thinking synth pass — boundary is autonomy, not compute. | high | all | none | `playbook.md § Weekly review` |
| `revenue_snapshot` | `0 9 * * 1` | Monday 9am revenue snapshot: MTD vs prior month, by source, with anomaly callouts. | low | all | only if Composio Stripe is connected (`connectedAccounts` row with `provider="stripe"`, `scopeStatus="active"`); skip silently otherwise — never alert about a missing connection on a recurring cron | `playbook.md § Revenue snapshot` |
| `competitor_watch` | `0 9 * * *` | Daily 9am sweep of named-peers: their new posts, their performance, their formats. Emits `wiki_apply` to `competitor/<creatorId>/<peerHandle>/observation` (durable) + writes `competitorObservations` projection (HQ Trends read surface). | low | all | only if `creators.namedPeers` has 1+ entries (Coach = up to 5, Manager = up to 10 per `planFeatures.competitorWatchSlots`) | `playbook.md § Competitor watch` |
| `comment_triage` | `0 11,17 * * *` | 2× daily comment sweep on most recent posts. Buckets into reply-now / save-for-batch / ignore. Writes `commentTriage`. | low | all | none | `playbook.md § Comment triage` |
| `calendar_lookahead` | `0 8 * * *` | Daily 8am 1–14 day calendar look-ahead. Classifies events via `maya-calendar-classifier` skill; proposes content arcs for life-events. Folds into the next `weekly_content_plan` and surfaces relevant arcs to Today. | high | all | only if Composio Calendar connected (`connectedAccounts` row with `provider="calendar"`, `scopeStatus="active"`); skip silently otherwise | `playbook.md § Calendar-aware content planning` |
| `manager_readiness_packet_quarterly` | `0 14 1 */3 *` | Quarterly (Jan 1, Apr 1, Jul 1, Oct 1 at 2pm local) refresh of the manager-readiness packet PDF. | high | all | none beyond tier — Manager additionally permits on-demand generation outside this schedule | `playbook.md § Manager-readiness packet` |
| `trend_watcher` | `5 9 * * *` | Daily 9:05am broader trend watcher (cross-niche). Offset 5 min from `competitor_watch` to spread ScrapeCreators load. | low | all | none | `playbook.md § Trend watcher` |
| `industry_intel_daily` | `30 7 * * *` | Daily 7:30am creator-economy news sweep — calls `maya-industry-intel` skill, dedupes via `industryIntelSeen`, ranks by relevance to creator's niche/platforms, inlines high-relevance items into morning brief. | medium | all | none beyond tier | `playbook.md § Industry intel` |
| `algo_research_tiktok` | `0 4 * * 1` | Weekly Mon 4am TikTok algorithm signals research — calls `maya-platform-algo-researcher`, updates global `platformAlgoCache`. Manager gets a second weekly run (`0 4 * * 4` Thu 4am). | low | all | global cron, runs once per platform regardless of creator count; uses BRAVE_API_KEY | `playbook.md § Platform algorithm research` |
| `algo_research_instagram` | `15 4 * * 1` | Weekly Mon 4:15am Instagram algorithm research. +Thu 4:15am for Manager. Offset 15 min from TikTok to spread Brave Search load. | low | all | same as `algo_research_tiktok` | `playbook.md § Platform algorithm research` |
| `algo_research_youtube` | `30 4 * * 1` | Weekly Mon 4:30am YouTube algorithm research. +Thu 4:30am for Manager. | low | all | same as `algo_research_tiktok` | `playbook.md § Platform algorithm research` |
| `algo_research_linkedin` | `45 4 * * 1` | Weekly Mon 4:45am LinkedIn algorithm research. +Thu 4:45am for Manager. | low | all | same as `algo_research_tiktok` | `playbook.md § Platform algorithm research` |
| `algo_research_x` | `0 5 * * 1` | Weekly Mon 5:00am X algorithm research. +Thu 5:00am for Manager. | low | all | same as `algo_research_tiktok` | `playbook.md § Platform algorithm research` |
| `opportunity_scout_daily` | `0 6 * * *` | Daily 6am scan of UGC marketplaces (Aspire / GRIN / Creator.co / Modash / Backstage / Mavrck), X creator-call hashtags, and operator-requested local brand search via Brave. Dedupes via `opportunityScoutSeen`, surfaces top 3 to morning brief and full list to Today. | medium | all | uses BRAVE_API_KEY; Manager unlocks larger `maxResults` and Apollo/Hunter contact discovery on confirmed opportunities | `playbook.md § Opportunity scout` |
| `collab_matchmaker_weekly` | `0 17 * * 0` | Sunday 5pm weekly collab shortlist — expands `soul.md` namedPeers via ScrapeCreators creator-search, scores audience overlap, proposes per-match format + first-message DM. Surfaces as tap-to-DM cards on Today. | medium | all | excludes direct competitors (overlap > 0.85) and recent same-format collabs; writes `collabMatchLog` with `creatorActedOn=pending` | `playbook.md § Collab matchmaker` |

### 2.1. Why some entries are not on the table

Three entries appear in `playbook.md` and `PER_TASK_DEFAULT_BUDGET` but have
**no cron expression** because they are event-driven or on-demand. They are
documented here for sibling-scan completeness:

| entryId | trigger | description | thinking | tier | conditions | playbook § |
|---|---|---|---|---|---|---|
| `first_boot_introduction` | event: session start when `creators.firstBootCompletedAt === undefined` | Maya's first-message-on-boot sequence: greet + cited insight from `creatorPicture` + 3 opening questions (goal / tone / brand-deal floor) + Gmail OAuth deep-link via `integrations.composio.oauth.startOAuth({ provider: "gmail" })` + Calendar OAuth deep-link via the same action with `provider: "calendar"`. Fires once per creator. Stamps `creators.firstBootCompletedAt` on completion. | medium | all | runs once; idempotency-guarded by `firstBootCompletedAt`; partial completion re-enters at the next live point in the sequence rather than re-greeting | `playbook.md § First message handler — the introduction` |
| `first_weekly_plan` | event: `creators.openingAnswersAt` is set AND `creators.firstWeeklyPlanSentAt === undefined` | First weekly content plan, generated immediately after the creator answers the three opening questions. Same `maya-content-arc-planner` chain as the Sunday `weekly_content_plan` cron; same `contentPlans` persistence. Stamps `creators.firstWeeklyPlanSentAt` on completion. Connection state is NOT gating — Calendar enrichment lands in the next Sunday cycle if Calendar isn't yet connected. | medium | all | chained off `first_boot_introduction`; runs once per creator | `playbook.md § First weekly plan — chained off the introduction` |
| `hook_library_build` | event: ScrapeCreators delta detects a new post crossing the outlier threshold | Multimodal hook extraction from a high-performing post. Watches the video, parses captions + top comments, writes a hook entry to `hookLibrary` with citations. | medium | manager | Manager-only — folded into the autonomous post-reaction loop. Wait at least 6h after `posts.postedAt` for engagement to settle, then check that the post sits in the top 25% performance vs the creator's prior 30 posts on the same platform | `playbook.md § Hook library auto-build` |
| `post_publish_reaction` | event: ScrapeCreators delta detects new post for any verified handle | Push to creator within latency cap with first-impression read on the post. Latency cap is plan-tier-bound: Coach 600s, Manager 300s — matches `planFeatures.postPublishReactionLatencySec` exactly. | medium | all | latency budget per plan tier; if the platform-fetch fails twice, drop to caption-only analysis rather than skip entirely | `playbook.md § Post-publish reaction` |
| `brand_email_triage` | event: Gmail webhook (Composio) delivers a new inbound thread classified as brand-deal | Triage the thread, draft 4 reply variants tuned to the creator's floor rate, write to `brandDeals`. Surfaces to Deals screen + Today notification. Both tiers triage; Manager additionally permits auto-send under `autoSendThreshold`. | high | all | only if Composio Gmail connected; if revoked mid-task, fall back to polling once per 15 min for up to 2h, then surface a reconnect prompt on Today (this prompt is the **one** non-silent connection alert — brand emails are time-sensitive enough to warrant it) | `playbook.md § Brand email triage` |
| `contract_redflag_scan` | event: PDF upload to Deals screen | Parse contract via `pdf` skill, scan via `maya-contract-redflag` skill, write a red-flag report to `dealContracts`. Push summary to creator. | high | all | none — both tiers get this; contract liability is independent of plan tier | `playbook.md § Contract scan` |
| `rate_suggestion` | on-demand: chat-initiated, or auto-folded into `brand_email_triage` | Heuristic + LLM rate suggestion via `maya-rate-calculator` skill. | medium | all | none | `playbook.md § Rate suggestion` |
| `monetization_diversifier` | folded: milestone events (10K/50K/100K/500K → morning brief), revenue-flat-90d (→ evening recap), or on-demand chat | Per-niche playbook of revenue-stream proposals (affiliate / merch / courses / subs / ad-rev / email-list / live-events / consulting) via `maya-monetization-diversifier` skill. | high | all | no standalone cron — always folded into an existing surface | `playbook.md § Monetization diversifier` |
| `pitch_strategy` | folded: BEFORE every outbound pitch (scout-confirmed or creator-added) and BEFORE replying to inbound emails with no proposed dollars | Pure-logic free / gifted / paid / decline decision via `maya-pitch-strategy` skill. Output anchors `brand_outreach` tone + asked rate, and `maya-rate-calculator` ranges when no offer dollars attached. | none | manager | Manager-only — Coach skips this program entirely (Coach never composes cold outbound, so the pre-pitch decision is moot) | `playbook.md § Pitch strategy` |
| `brand_outreach` | event: creator-confirmed opportunity from `opportunity_scout_daily` ready to pitch, OR creator manually adds a brand to their target list | Cold-pitch composer via `maya-brand-outreach` skill: subject + body + follow-up cadence (gentle / firm / final). Pre-pitch `pitch_strategy` decided angle + rate; this composes the email. | high | manager | Manager-only — Coach never composes cold outbound. Creator-approved by default; auto-send only fires when `autoSendThreshold` is set, ask is below it, AND citation firewall passes. Manager additionally permits Apollo/Hunter contact discovery via `brandContactDiscoveryEnabled` when `brand.contactEmail` is null | `playbook.md § Brand outreach` |

> **Note on entry count.** The CLAUDE.md and playbook reference "17
> behaviors" historically. Counting strictly post-orphan-skill wire-up:
> 21 cron entries above + 8 event/on-demand entries = **29 total
> proactive behaviors**. The drift is because (a) `rate_suggestion` was
> originally folded into `brand_email_triage` in early planning; we now
> schedule it as its own entry because it's also chat-initiated
> independently, and (b) the Sprint 3.5b orphan skills
> (`opportunity_scout_daily`, `collab_matchmaker_weekly`,
> `monetization_diversifier`, `pitch_strategy`, `brand_outreach`) now
> have first-class cron / event / folded entries. Keep this count in
> sync with `playbook.md § Index` and `skill.md § Coverage matrix`.

---

## 3. Plan-tier cron-enablement matrix

This table is the **runtime authority** that OpenClaw consults at boot. It
mirrors `planFeatures(creator)` in `convex/lib/planFeatures.ts` and the
tier gating in `convex/agents/packs/maya/workspace/standingOrders.ts`. If
you change one, you must change all three. The acceptance gate diffs this
table against the `cronEnablement` array produced by `buildMayaConfig()`
for a Coach / Manager fixture creator.

**Tier semantics post-coach/manager migration:** the boundary is **autonomy
on the creator's behalf**, NOT breadth. Both tiers see every read/advisory
program — including programs that consume paid third-party APIs (Brave,
Composio Stripe/Calendar reads). Manager-only programs are ones that
require Maya to take an autonomous action OUTBOUND: auto-send a brand
email, draft a cold pitch, fire Apollo/Hunter discovery, hook-library
auto-build (folded into the autonomous post-reaction loop).

`Y` = enabled, `—` = disabled (the Maya for that tier never schedules it),
`*` = enabled with degraded behavior (see footnotes).

| entryId | Coach | Manager |
|---|:---:|:---:|
| `morning_brief` | Y | Y |
| `accountability_nudge` | Y | Y |
| `performance_check_2h` | Y | Y |
| `daily_niche_scan` | Y | Y |
| `evening_recap` | Y | Y |
| `weekly_content_plan` | Y | Y |
| `weekly_review` | Y | Y |
| `revenue_snapshot` | Y¹ | Y¹ |
| `competitor_watch` | Y² | Y² |
| `comment_triage` | Y | Y |
| `calendar_lookahead` | Y³ | Y³ |
| `manager_readiness_packet_quarterly` | Y | Y⁴ |
| `trend_watcher` | Y | Y |
| `industry_intel_daily` | Y | Y |
| `algo_research_tiktok` | Y | Y⁵ |
| `algo_research_instagram` | Y | Y⁵ |
| `algo_research_youtube` | Y | Y⁵ |
| `algo_research_linkedin` | Y | Y⁵ |
| `algo_research_x` | Y | Y⁵ |
| `opportunity_scout_daily` | Y⁶ | Y⁶ |
| `collab_matchmaker_weekly` | Y⁷ | Y⁷ |
| `first_boot_introduction` (event) | Y | Y |
| `first_weekly_plan` (event) | Y | Y |
| `hook_library_build` (event) | — | Y |
| `post_publish_reaction` (event) | Y⁸ | Y⁸ |
| `brand_email_triage` (event) | Y⁹ | Y⁹ |
| `contract_redflag_scan` (event) | Y | Y |
| `rate_suggestion` (on-demand) | Y | Y |
| `monetization_diversifier` (folded) | Y | Y |
| `pitch_strategy` (folded) | — | Y |
| `brand_outreach` (event) | — | Y |

**Footnotes:**

1. Conditional on Composio Stripe connected — see § 4.
2. Conditional on `creators.namedPeers.length >= 1` — see § 4. Coach caps
   at 5 peers; Manager caps at 10 (per `planFeatures.competitorWatchSlots`).
3. Conditional on Composio Calendar connected — see § 4.
4. Manager additionally permits **on-demand** packet generation between
   quarterly refreshes (per `planFeatures.readinessPacketCadence =
   "on-demand"`). The cron entry behavior is unchanged.
5. Manager gets a second weekly run (Thursday at the same per-platform
   offset) for fresher cache. Coach's algo-research cache is one
   weekly tick; Maya's `maya-platform-best-practice` consultant reads
   from the same global cache regardless of tier.
6. Manager unlocks larger `maxResults` and Apollo/Hunter contact discovery
   on confirmed opportunities (gated by `brandContactDiscoveryEnabled`).
   Coach surfaces the listings but stops at "creator decides whether to
   pitch" — no autonomous outbound.
7. Manager unlocks larger `maxMatches` and richer audience-overlap
   scoring. Coach gets the same shortlist on a smaller `maxMatches`.
8. Latency cap differs by tier: Coach 600s, Manager 300s (per
   `planFeatures.postPublishReactionLatencySec`).
9. Coach triages inbound brand email into a draft; auto-send under
   `autoSendThreshold` is **Manager-only** (per
   `planFeatures.canAutoSendBrandEmails`).

---

## 4. Conditional gates

A handful of entries scheduled above run only if a runtime condition holds.
These conditions are checked **inside the entry's playbook flow**, not by
the scheduler — the entry fires on its cron, the playbook's first step
checks the gate, and if the gate is closed the playbook returns a no-op
without writing anything except a `mayaActionLog` row tagged
`skipped:<reason>`.

- **`accountability_nudge`** — only fires if the creator had a commitment
  in the last 24h with no follow-through. Reads `checkIns` table for
  `status="committed"` rows in the last 24h, joins against `posts`,
  `dealContracts`, `chatMessages` for evidence of follow-through. If
  nothing committed yesterday, no-op silently. **Maya never asks "did you
  do anything yesterday?" — that is interrogation, not nudging.**
- **`performance_check_2h`** — only fires if `posts.postedAt` is within the
  last 24h for any verified handle. On a no-post day every 2h slot
  no-ops silently. (We deliberately schedule the 2h slots and gate at
  runtime instead of using a smarter cron expression — keeps the cron file
  simple and lets the gate own the "was there a post?" reasoning.)
- **`revenue_snapshot`** — only fires if Composio Stripe is connected.
  **Skip silently otherwise.** Maya never sends a recurring "you should
  connect Stripe" reminder — that is connection-nag, and it is not Maya's
  voice. If the creator wants Stripe, they wire it up; until then revenue
  is not Maya's beat.
- **`competitor_watch`** — only fires if `creators.namedPeers` has at least
  one entry. The named-peers list lives in the per-creator soul.md and is
  edited from the Profile screen. Empty list → silent no-op.
- **`calendar_lookahead`** — only fires if Composio Calendar connected.
  Same silent-skip discipline as Stripe. The onboarding flow is the place
  to nag about Calendar (it does, twice); the recurring cron is not.
- **`hook_library_build`** — only fires when a new post crosses the outlier
  threshold (top 25% performance vs the creator's prior 30 posts on the
  same platform). Wait at least 6h after `posts.postedAt` for engagement
  to settle before scoring; viral arcs that hit in the first hour
  routinely flatten by hour six and we don't want a `hookLibrary` row for
  a flash-in-the-pan.

---

## 5. Retry & backoff

Every cron entry above runs with the following retry contract:

- **Max attempts:** 3 (one initial run + 2 retries), with exponential
  backoff base 30s and cap 5min (so retry 1 fires at 30s post-failure,
  retry 2 fires at 60s post-failure, capped). Cron-entry retries are
  longer than HTTP retries because re-scheduling a missed cron is fine —
  Maya getting a brief out at 7:01am instead of 7:00am is invisible to the
  creator.
- **Exception:** `accountability_nudge` runs with **0 retries**. The
  creator only needs one nudge per day; double-nudging is annoying and
  reads as anxious. If the first attempt fails, log it and let the next
  morning's `morning_brief` absorb the missed commitment if still
  unresolved.
- **Exception:** event-driven entries (`post_publish_reaction`,
  `brand_email_triage`, `hook_library_build`, `contract_redflag_scan`)
  follow their own latency budgets, not the cron retry policy. See
  `playbook.md § <entry>` for each event-driven entry's retry contract.
- **Failure logging:** every failure (final, after retries exhausted)
  writes a `mayaActionLog` row with `severity="error"`, the `entryId`, the
  exception message, and the attempt count. The operator dashboard
  surfaces these. If a single creator hits ≥3 failures of the same entry
  in a 24h window, the dashboard auto-pages.
- **Idempotency:** every playbook entry's first step is a write-guard —
  query for an already-written row keyed on `(creatorId, entryId,
  scheduledFor)` and skip if present. This means a re-fired cron after a
  partial failure cannot double-write a brief or double-nudge a creator.
  The write-guard is implemented per-entry in `playbook.md §
  Idempotency conventions`.

The `mayaActionLog` table is added in Sprint 3 if not already present in
schema (`creatorId`, `entryId`, `scheduledFor`, `firedAt`, `attemptCount`,
`status`, `severity`, `errorMessage`, `payloadHash`).

---

## 6. Sibling-file scan map

The Sprint 3 acceptance gate runs a sibling-file scan that asserts:

1. Every `entryId` in this `cron.md` has a matching `### <Title>` section in
   `playbook.md`.
2. Every `### <Title>` section in `playbook.md` either has a matching
   `entryId` here OR is explicitly tagged `event-only` / `on-demand-only`
   in the section frontmatter.
3. Every `entryId` here resolves to a valid task tag in
   `PER_TASK_DEFAULT_BUDGET` in `configGeneratorMaya.ts` (or is one of the
   event/on-demand entries documented in § 2.1).
4. Every entry referenced in the plan-tier matrix (§ 3) appears in the
   cron table (§ 2) or the event/on-demand table (§ 2.1).

The mapping below is the explicit lookup the scan uses. Keep it
alphabetical by `entryId` so diff review is mechanical.

| entryId | playbook section | configGenerator key | scheduling kind |
|---|---|---|---|
| `accountability_nudge` | `playbook.md § Accountability nudge` | `PER_TASK_DEFAULT_BUDGET.accountability_nudge` | cron |
| `algo_research_instagram` | `playbook.md § Platform algorithm research` | (no per-task key — `low` thinking) | cron |
| `algo_research_linkedin` | `playbook.md § Platform algorithm research` | (no per-task key — `low` thinking) | cron |
| `algo_research_tiktok` | `playbook.md § Platform algorithm research` | (no per-task key — `low` thinking) | cron |
| `algo_research_x` | `playbook.md § Platform algorithm research` | (no per-task key — `low` thinking) | cron |
| `algo_research_youtube` | `playbook.md § Platform algorithm research` | (no per-task key — `low` thinking) | cron |
| `brand_email_triage` | `playbook.md § Brand email triage` | `PER_TASK_DEFAULT_BUDGET.brand_email_draft` | event |
| `brand_outreach` | `playbook.md § Brand outreach` | (no per-task key — `high` thinking, follows brand_email budget) | event |
| `calendar_lookahead` | `playbook.md § Calendar-aware content planning` | (no per-task key — uses `weekly_content_plan` budget) | cron |
| `collab_matchmaker_weekly` | `playbook.md § Collab matchmaker` | (no per-task key — uses `niche_scan` budget) | cron |
| `comment_triage` | `playbook.md § Comment triage` | `PER_TASK_DEFAULT_BUDGET.comment_triage` | cron |
| `competitor_watch` | `playbook.md § Competitor watch` | (no per-task key — uses `niche_scan` budget) | cron |
| `contract_redflag_scan` | `playbook.md § Contract scan` | `PER_TASK_DEFAULT_BUDGET.contract_redflag_scan` | event |
| `cross_post_distribution` | `playbook.md § Cross-platform content distribution` | (no per-task key — uses `weekly_content_plan` budget) | event/on-demand |
| `daily_niche_scan` | `playbook.md § Daily niche scan` | `PER_TASK_DEFAULT_BUDGET.niche_scan` | cron |
| `evening_recap` | `playbook.md § Evening recap` | `PER_TASK_DEFAULT_BUDGET.evening_recap` | cron |
| `first_boot_introduction` | `playbook.md § First message handler — the introduction` | (no per-task key — uses `chat_reply` budget for the intro messages; OAuth-link generation is a Convex action, no LLM) | event |
| `first_weekly_plan` | `playbook.md § First weekly plan — chained off the introduction` | `PER_TASK_DEFAULT_BUDGET.weekly_content_plan` (same chain as Sunday cron) | event |
| `growth_coach` | `playbook.md § Growth coaching` | (no per-task key — folded into `morning_brief` budget) | folded/on-demand |
| `hook_library_build` | `playbook.md § Hook library auto-build` | `PER_TASK_DEFAULT_BUDGET.hook_library_build` | event |
| `industry_intel_daily` | `playbook.md § Industry intel` | (no per-task key — uses `niche_scan` budget) | cron |
| `manager_readiness_packet_quarterly` | `playbook.md § Manager-readiness packet` | `PER_TASK_DEFAULT_BUDGET.manager_readiness_packet` | cron |
| `monetization_diversifier` | `playbook.md § Monetization diversifier` | (no per-task key — folded into `morning_brief` / `evening_recap` / `chat_reply` budgets) | folded/on-demand |
| `morning_brief` | `playbook.md § Morning brief` | `PER_TASK_DEFAULT_BUDGET.morning_brief` | cron |
| `opportunity_scout_daily` | `playbook.md § Opportunity scout` | (no per-task key — uses `niche_scan` budget) | cron |
| `performance_check_2h` | `playbook.md § Post-performance check` | (no per-task key — uses `chat_reply` budget for read-only metric pull) | cron |
| `pitch_strategy` | `playbook.md § Pitch strategy` | (no per-task key — pure decision logic, `none` thinking) | folded |
| `post_publish_reaction` | `playbook.md § Post-publish reaction` | `PER_TASK_DEFAULT_BUDGET.post_publish_reaction` | event |
| `rate_suggestion` | `playbook.md § Rate suggestion` | `PER_TASK_DEFAULT_BUDGET.rate_suggestion` | on-demand |
| `revenue_snapshot` | `playbook.md § Revenue snapshot` | (no per-task key — pure data-pull, `none` thinking) | cron |
| `trend_watcher` | `playbook.md § Trend watcher` | (no per-task key — uses `niche_scan` budget) | cron |
| `weekly_content_plan` | `playbook.md § Weekly content plan` | `PER_TASK_DEFAULT_BUDGET.weekly_content_plan` | cron |
| `weekly_review` | `playbook.md § Weekly review` | `PER_TASK_DEFAULT_BUDGET.weekly_review_synth` | cron |

Entries flagged "no per-task key" above intentionally do not need a unique
budget — they reuse a related task tag's budget and write to
`aiCallLog.taskTag` with that reused tag. The Sprint 3.5 skill bundle work
will revisit this list and decide whether any of them deserve their own
budget key for telemetry granularity.

---

## 7. Change procedure

If you need to add, remove, rename, or reschedule an entry:

1. Edit this file (`cron.md`).
2. Edit the matching section in `playbook.md`. If the entry is new, add a
   section; if removed, delete it.
3. Edit `skill.md` if the change affects which skills the entry depends on.
4. Edit `convex/agents/packs/maya/workspace/standingOrders.ts` — every
   program lives there as the single source of truth for tier + cron
   metadata. The workspace-bundle generators (`generateAgentsMd.ts`,
   `buildCronJobsJson.ts`) consult that catalog directly, so updating
   the program's `tier` / `defaultCron` / `cronEntryId` flows through.
5. Edit `convex/agents/packs/maya/configGeneratorMaya.ts`:
   - `PER_TASK_DEFAULT_BUDGET` if the thinking budget changed
   - `ALL_CRON_ENTRIES` if the entryId changed
6. Update the plan-tier matrix in § 3 and the sibling-scan map in § 6.
7. Run the sibling-file scan locally (`npm run test:sibling-scan` —
   ships in Sprint 3 acceptance).
8. Add a fixture-corpus behavioral test for the new entry if cron;
   skip if event/on-demand and already covered by the event harness.

The sibling-scan failure message is intentionally loud and points at every
file that needs a parallel edit. Do not bypass it.
