---
name: maya-platform-cron
version: 0.2.0-sprint3
description: Maya's proactive behavior schedule — cron + heartbeat + event split.
---

# cron.md — Maya's proactive schedule

This file is the single source of truth for **when Maya does what**. Every
proactive behavior Maya performs — every push, every brief, every nudge —
lives in one of three buckets:

1. **Cron (precise wall-clock).** Six entries in § 2 below. These have a
   5-field POSIX cron expression and fire at a precise local time on the
   creator's timezone. The OpenClaw scheduler reads `~/.openclaw/cron/jobs.json`
   (built by `convex/agents/packs/maya/workspace/buildCronJobsJson.ts` from
   `STANDING_ORDERS` in `standingOrders.ts`) at boot and fires these on
   their schedules.
2. **Heartbeat-driven (no fixed schedule).** Nine entries in § 3 below.
   These have no cron expression. Maya decides per-tick whether to run
   them based on cooldowns, current state, and what the creator's day
   actually needs. The cooldowns listed are guidance, not gates — Maya's
   judgment owns the trigger. (Mechanical correctness still lives in
   the per-skill SKILL.md and per-mutation validator.)
3. **Event-driven / on-demand / folded.** Listed in § 4 below for
   sibling-scan completeness. Fire on external triggers (Gmail webhook,
   PDF upload, ScrapeCreators delta), creator-initiated chat, or
   composed inside another program's run.

This document is paired with `playbook.md` (the prose for each behavior)
and `SKILL.md` (the skill inventory each behavior depends on). The Sprint 3
acceptance gate runs a sibling-file scan that asserts every program in
`STANDING_ORDERS` has a matching playbook section, and every cron entry
here has a matching cron-kind program in `STANDING_ORDERS`.

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

## 2. Cron entries — precise wall-clock (6)

All expressions are 5-field POSIX cron (`min hour dayOfMonth month
dayOfWeek`). `dayOfWeek`: `0` = Sunday, `1` = Monday, … `6` = Saturday.
Each `entryId` here matches a `cron`-kind program in
`convex/agents/packs/maya/workspace/standingOrders.ts`. If you add or rename
an entry here, you must update that catalog.

| entryId | expression | description | thinking | tier | conditions | playbook § |
|---|---|---|---|---|---|---|
| `morning_brief` | `0 7 * * *` | Daily 7am push: yesterday's signal, today's recommendation, one specific action. Cited from `posts`, `postMetrics`, `dailyBriefs` history. | medium | all | none — runs unconditionally | `playbook.md § Morning brief` |
| `accountability_nudge` | `0 10 * * *` | Daily 10am check on the commitment Maya recorded yesterday. Anti-sycophantic; one nudge max. | low | all | only if `checkIns` row from prior 24h has `status="committed"` and no `followThroughAt` | `playbook.md § Accountability nudge` |
| `evening_recap` | `0 19 * * *` | Daily 7pm recap: what posted today, how it performed, what tomorrow looks like. Two-paragraph prose, no bullet dump. | low | all | none — runs even on no-post days | `playbook.md § Evening recap` |
| `weekly_content_plan` | `0 16 * * 0` | Sunday 4pm next-week plan. Folds in heartbeat-driven calendar lookahead results from the prior week (when Calendar connected). Plan reaches all 5 platforms on both tiers. | medium | all | none | `playbook.md § Weekly content plan` |
| `weekly_review` | `0 21 * * 0` | Sunday 9pm synthesis of the week: top posts cited, what worked, what didn't, one tactical change for next week. Both tiers run the full `high`-thinking synth pass — boundary is autonomy, not compute. | high | all | none | `playbook.md § Weekly review` |
| `revenue_snapshot` | `0 9 * * 1` | Monday 9am revenue snapshot: MTD vs prior month, by source, with anomaly callouts. | low | all | only if Composio Stripe is connected (`connectedAccounts` row with `provider="stripe"`, `scopeStatus="active"`); skip silently otherwise — never alert about a missing connection on a recurring cron | `playbook.md § Revenue snapshot` |

---

## 3. Heartbeat-driven entries — no fixed schedule (9)

These programs do not run on a wall-clock schedule. They fire off
heartbeat ticks: on each tick Maya consults the cooldown listed below
plus the current state of the creator's day, and decides whether to
invoke. Cooldowns are **guidance** Maya uses as a default cadence; the
real trigger is her judgment. If the creator just posted, run the
2h check earlier than the 60-min default; if the niche is quiet, hold
the niche scan past 6h. The .md file does not encode a hard gate.

| entryId | trigger | description | thinking | tier | cooldown guidance | playbook § |
|---|---|---|---|---|---|---|
| `performance_check_2h` | heartbeat tick | Pulls fresh metrics on today's posts; flags outliers; queues a hook-library check if a new metric crossed an alert threshold. Skip silently if no `posts.postedAt` in last 24h. | low | all | 60 min | `playbook.md § Post-performance check` |
| `daily_niche_scan` | heartbeat tick | Niche-wide trending hashtags / sounds / formats via ScrapeCreators, scoped to creators in the same follower bracket. Writes `trendObservations`. | low | all | 6 h | `playbook.md § Daily niche scan` |
| `trend_watcher` | heartbeat tick | Broader cross-niche trend layer (hashtags, sounds, formats). Writes `trendObservations` with `source='platform-wide'`. | low | all | 6 h | `playbook.md § Trend watcher` |
| `comment_triage` | heartbeat tick | Comment sweep on the creator's most recent posts. Buckets into reply-now / save-for-batch / ignore. Writes `commentTriage`. | low | all | 6 h | `playbook.md § Comment triage` |
| `competitor_watch` | heartbeat tick | Pulls each named peer's last 24h posts + metric deltas. Writes `competitorObservations`. Silent no-op if `creators.namedPeers` is empty (Coach = up to 5, Manager = up to 10). | low | all | 6 h | `playbook.md § Competitor watch` |
| `calendar_lookahead` | heartbeat tick | Composio Calendar pull for events 1-14 days out. Classifies via `maya-calendar-classifier`; proposes content arcs for relevant life-events. Skip silently if Calendar not connected. | high | all | 12 h | `playbook.md § Calendar-aware content planning` |
| `industry_intel_daily` | heartbeat tick | Calls `maya-industry-intel` (creator niche + platforms). Dedupes via `industryIntelSeen`. Inlines relevance≥0.7 items into the next morning brief. | medium | all | 12 h | `playbook.md § Industry intel` |
| `opportunity_scout_daily` | heartbeat tick | Scans UGC marketplaces + X creator-call hashtags + local-brand Brave search per niche / location. Dedupes via `opportunityScoutSeen`. Surfaces top 3 to morning brief; full list to Today. | medium | all | 12 h | `playbook.md § Opportunity scout` |
| `collab_matchmaker_weekly` | heartbeat tick | Expands `soul.md` namedPeers via ScrapeCreators creator-search, scores audience overlap, proposes per-match format + first-message DM via `maya-voice-applier`. | medium | all | 7 d | `playbook.md § Collab matchmaker` |

The cooldown column is read as "Maya should not run this program more
often than every N unless something genuinely changed." Brand email
events and post-publish events do not count toward heartbeat cooldowns
— they are separate event-driven entries (§ 4).

---

## 4. Event-driven / on-demand / folded entries

These have no schedule and no cooldown; they fire on an external
trigger or are composed inline by another program.

| entryId | trigger kind | description | thinking | tier | playbook § |
|---|---|---|---|---|---|
| `first_boot_introduction` | event: session start when `creators.firstBootCompletedAt === undefined` | Maya's first-message-on-boot sequence: greet + cited insight from `creatorPicture` + 2 opening questions (goal w/ examples + tone) + Gmail OAuth deep-link via `integrations.composio.oauth.startOAuth({ provider: "gmail" })` + Calendar OAuth deep-link via the same action with `provider: "calendar"`. Fires once per creator. Stamps `creators.firstBootCompletedAt` on completion. | medium | all | `playbook.md § First message handler — the introduction` |
| `first_weekly_plan` | event: `creators.openingAnswersAt` is set AND `creators.firstWeeklyPlanSentAt === undefined` | First weekly content plan, generated immediately after the creator answers the two opening questions. Same `maya-content-arc-planner` chain as the Sunday `weekly_content_plan` cron; same `contentPlans` persistence. Stamps `creators.firstWeeklyPlanSentAt` on completion. | medium | all | `playbook.md § First weekly plan — chained off the introduction` |
| `first_proactive_ping` | event: `creators.pictureLockedAt` stamped AND `creators.firstProactivePingSentAt === undefined`. Convex scheduler fires the composer at `pictureLockedAt + uniformRandom(15min, 30min)`. | Day 1 first-touch ping: 1 cited trend + 1 grounded idea (≥2 post-id citations) + Gmail/Calendar connect offers, written to `firstProactivePings` for the agent heartbeat to send via claw-messenger. Stamps `creators.firstProactivePingSentAt` at compose time so the event cannot re-fire. Empty-input precedence: BOTH empty → silent no-op (status='skipped'); ONE empty → ship with the leg that worked. The ping body passes a banned-phrase floor (anti-sycophancy) — if it trips, falls back to skip-empty. | medium | all | `playbook.md § Day 1 first-proactive-ping` |
| `hook_library_build` | event: ScrapeCreators delta detects a new post crossing the outlier threshold | Multimodal hook extraction from a high-performing post. Watches the video, parses captions + top comments, writes a hook entry to `hookLibrary` with citations. Wait at least 6h after `posts.postedAt` for engagement to settle, then check the post sits in the top 25% on the creator's prior 30 posts on the same platform. | medium | manager | `playbook.md § Hook library auto-build` |
| `post_publish_reaction` | event: ScrapeCreators delta detects new post for any verified handle | Push to creator within latency cap with first-impression read on the post. Latency cap is plan-tier-bound: Coach 600s, Manager 300s. | medium | all | `playbook.md § Post-publish reaction` |
| `brand_email_triage` | event: Gmail webhook (Composio) delivers a new inbound thread classified as brand-deal | Triage the thread, draft 4 reply variants tuned to the creator's floor rate, write to `brandDeals`. Surfaces to Deals screen + Today notification. Both tiers triage; Manager additionally permits auto-send under `autoSendThreshold`. | high | all | `playbook.md § Brand email triage` |
| `contract_redflag_scan` | event: PDF upload to Deals screen | Parse contract via `pdf` skill, scan via `maya-contract-redflag` skill, write a red-flag report to `dealContracts`. Push summary to creator. | high | all | `playbook.md § Contract scan` |
| `rate_suggestion` | on-demand: chat-initiated, or auto-folded into `brand_email_triage` | Heuristic + LLM rate suggestion via `maya-rate-calculator` skill. | medium | all | `playbook.md § Rate suggestion` |
| `monetization_diversifier` | folded: milestone events (10K/50K/100K/500K → morning brief), revenue-flat-90d (→ evening recap), or on-demand chat | Per-niche playbook of revenue-stream proposals (affiliate / merch / courses / subs / ad-rev / email-list / live-events / consulting) via `maya-monetization-diversifier` skill. | high | all | `playbook.md § Monetization diversifier` |
| `pitch_strategy` | folded: BEFORE every outbound pitch (scout-confirmed or creator-added) and BEFORE replying to inbound emails with no proposed dollars | Pure-logic free / gifted / paid / decline decision via `maya-pitch-strategy` skill. Output anchors `brand_outreach` tone + asked rate. | none | manager | `playbook.md § Pitch strategy` |
| `brand_outreach` | event: creator-confirmed opportunity from `opportunity_scout_daily` (heartbeat) ready to pitch, OR creator manually adds a brand to their target list | Cold-pitch composer via `maya-brand-outreach` skill: subject + body + follow-up cadence (gentle / firm / final). | high | manager | `playbook.md § Brand outreach` |
| `growth_coach` | folded: morning brief daily; on-demand from chat | Call `maya-growth-coach` (creatorPicture + last-30-post metrics + soul goals + optional currentStruggle). Output prioritized moves with cited evidence + anti-patterns. | high | manager | `playbook.md § Growth coaching` |
| `cross_post_distribution` | on-demand or folded into `weekly_content_plan` | Per-platform variants — TikTok 9:16 ≤60s, IG 9:16 Reel/4:5 carousel, YT 9:16 Short/16:9 long, LinkedIn native, X 3-5 tweet thread. Each variant: voice-applied caption, duration cut, aspect ratio, hashtags, posting time, optional one-tap deep link. | medium | all | `playbook.md § Cross-platform content distribution` |
| `pre_post_review` | event: 'Maya score this' in chat OR future `/draft` route | Call `maya-pre-post-scorer` on a draft. Return predicted-tier + signal breakdown + prioritized recommendations + goNoGo verdict. | medium | all | `playbook.md § Pre-post review` |
| `underperformance_diagnosis` | folded: into evening recap when posts underperformed; on-demand from chat | Call `maya-underperformance-diagnoser` on a bombed post. Diagnose hook drift, off-peak posting, format mismatch, topic fatigue, audience drift, recent algo cooling. | medium | all | `playbook.md § Underperformance diagnosis` |

---

## 5. Removed entries (Sprint 3)

Sprint 3 deleted six MVP-scope entries. They are no longer scheduled,
no longer in `STANDING_ORDERS`, and no longer in `playbook.md`. Listed
here for migration discoverability only — do not re-add without an
explicit operator decision.

- `manager_readiness_packet_quarterly` — quarterly PDF packet generation
  for human-manager handoff.
- `algo_research_tiktok` / `algo_research_instagram` /
  `algo_research_youtube` / `algo_research_linkedin` / `algo_research_x`
  — weekly Brave Search sweeps that updated `platformAlgoCache`. The
  `maya-platform-best-practice` consultant now reads the static knowledge
  baked into its SKILL.md until a refreshed cache strategy lands.

If a downstream surface still references one of these slugs (HQ query,
test fixture, telemetry), treat it as dead code and remove on sight.

---

## 6. Conditional gates

A handful of entries above run only if a runtime condition holds. These
conditions are checked **inside the entry's playbook flow**, not by
the scheduler / heartbeat. The entry fires, the playbook's first step
checks the gate, and if the gate is closed the playbook returns a no-op
without writing anything except a `mayaActionLog` row tagged
`skipped:<reason>`.

- **`accountability_nudge`** — only fires if the creator had a commitment
  in the last 24h with no follow-through. Reads `checkIns` table for
  `status="committed"` rows in the last 24h, joins against `posts`,
  `dealContracts`, `chatMessages` for evidence of follow-through. If
  nothing committed yesterday, no-op silently. **Maya never asks "did you
  do anything yesterday?" — that is interrogation, not nudging.**
- **`performance_check_2h`** (heartbeat) — only fires if `posts.postedAt`
  is within the last 24h for any verified handle. On a no-post day every
  tick no-ops silently.
- **`revenue_snapshot`** — only fires if Composio Stripe is connected.
  **Skip silently otherwise.** Maya never sends a recurring "you should
  connect Stripe" reminder — that is connection-nag, and it is not Maya's
  voice.
- **`competitor_watch`** (heartbeat) — only fires if `creators.namedPeers`
  has at least one entry. The named-peers list lives in the per-creator
  soul.md and is edited from the Profile screen. Empty list → silent
  no-op.
- **`calendar_lookahead`** (heartbeat) — only fires if Composio Calendar
  connected. Same silent-skip discipline as Stripe. The onboarding flow
  is the place to nag about Calendar (it does, twice); the heartbeat is
  not.
- **`hook_library_build`** (event) — only fires when a new post crosses
  the outlier threshold (top 25% performance vs the creator's prior 30
  posts on the same platform). Wait at least 6h after `posts.postedAt`
  for engagement to settle.

---

## 7. Retry & backoff

Every cron entry above runs with the following retry contract:

- **Max attempts:** 3 (one initial run + 2 retries), with exponential
  backoff base 30s and cap 5min (so retry 1 fires at 30s post-failure,
  retry 2 fires at 60s post-failure, capped). Cron-entry retries are
  longer than HTTP retries because re-scheduling a missed cron is fine —
  Maya getting a brief out at 7:01am instead of 7:00am is invisible to
  the creator.
- **Exception:** `accountability_nudge` runs with **0 retries**. The
  creator only needs one nudge per day; double-nudging is annoying and
  reads as anxious. If the first attempt fails, log it and let the next
  morning's `morning_brief` absorb the missed commitment if still
  unresolved.

Heartbeat-driven entries do not retry — the next tick is the retry. If
the `daily_niche_scan` ticks and ScrapeCreators 5xx's, the next tick
attempts again; the first failure writes a single `mayaActionLog` row
and otherwise stays silent.

Event-driven entries (`post_publish_reaction`, `brand_email_triage`,
`hook_library_build`, `contract_redflag_scan`) follow their own latency
budgets, not the cron retry policy. See `playbook.md § <entry>` for each
event-driven entry's retry contract.

**Failure logging:** every failure (final, after retries exhausted) writes
a `mayaActionLog` row with `severity="error"`, the `entryId`, the
exception message, and the attempt count. The operator dashboard surfaces
these. If a single creator hits ≥3 failures of the same entry in a 24h
window, the dashboard auto-pages.

**Idempotency:** every playbook entry's first step is a write-guard —
query for an already-written row keyed on `(creatorId, entryId,
scheduledFor)` and skip if present. This means a re-fired cron after a
partial failure cannot double-write a brief or double-nudge a creator.

---

## 8. Sibling-file scan map

The Sprint 3 acceptance gate runs a sibling-file scan that asserts:

1. Every `entryId` in this `cron.md` has a matching `### <Title>` section
   in `playbook.md`.
2. Every `### <Title>` section in `playbook.md` either has a matching
   `entryId` here OR is explicitly tagged `event-only` / `on-demand-only`
   in the section frontmatter.
3. Every `cron`-kind entry here resolves to a `cron`-kind program in
   `STANDING_ORDERS`.
4. Every `heartbeat`-kind entry here resolves to a `heartbeat`-kind
   program in `STANDING_ORDERS`.

The mapping below is the explicit lookup the scan uses. Keep it
alphabetical by `entryId` so diff review is mechanical.

| entryId | playbook section | scheduling kind |
|---|---|---|
| `accountability_nudge` | `playbook.md § Accountability nudge` | cron |
| `brand_email_triage` | `playbook.md § Brand email triage` | event |
| `brand_outreach` | `playbook.md § Brand outreach` | event |
| `calendar_lookahead` | `playbook.md § Calendar-aware content planning` | heartbeat |
| `collab_matchmaker_weekly` | `playbook.md § Collab matchmaker` | heartbeat |
| `comment_triage` | `playbook.md § Comment triage` | heartbeat |
| `competitor_watch` | `playbook.md § Competitor watch` | heartbeat |
| `contract_redflag_scan` | `playbook.md § Contract scan` | event |
| `cross_post_distribution` | `playbook.md § Cross-platform content distribution` | on-demand / folded |
| `daily_niche_scan` | `playbook.md § Daily niche scan` | heartbeat |
| `evening_recap` | `playbook.md § Evening recap` | cron |
| `first_boot_introduction` | `playbook.md § First message handler — the introduction` | event |
| `first_proactive_ping` | `playbook.md § Day 1 first-proactive-ping` | event |
| `first_weekly_plan` | `playbook.md § First weekly plan — chained off the introduction` | event |
| `growth_coach` | `playbook.md § Growth coaching` | folded / on-demand |
| `hook_library_build` | `playbook.md § Hook library auto-build` | event |
| `industry_intel_daily` | `playbook.md § Industry intel` | heartbeat |
| `monetization_diversifier` | `playbook.md § Monetization diversifier` | folded / on-demand |
| `morning_brief` | `playbook.md § Morning brief` | cron |
| `opportunity_scout_daily` | `playbook.md § Opportunity scout` | heartbeat |
| `performance_check_2h` | `playbook.md § Post-performance check` | heartbeat |
| `pitch_strategy` | `playbook.md § Pitch strategy` | folded |
| `post_publish_reaction` | `playbook.md § Post-publish reaction` | event |
| `pre_post_review` | `playbook.md § Pre-post review` | event / on-demand |
| `rate_suggestion` | `playbook.md § Rate suggestion` | on-demand |
| `revenue_snapshot` | `playbook.md § Revenue snapshot` | cron |
| `trend_watcher` | `playbook.md § Trend watcher` | heartbeat |
| `underperformance_diagnosis` | `playbook.md § Underperformance diagnosis` | folded / on-demand |
| `weekly_content_plan` | `playbook.md § Weekly content plan` | cron |
| `weekly_review` | `playbook.md § Weekly review` | cron |

---

## 9. Change procedure

If you need to add, remove, rename, or reschedule an entry:

1. Edit `convex/agents/packs/maya/workspace/standingOrders.ts` — every
   program lives there as the single source of truth for tier + kind +
   cron metadata. The workspace-bundle generators (`generateAgentsMd.ts`,
   `buildCronJobsJson.ts`) consult that catalog directly.
2. Edit this file (`cron.md`) so § 2 / § 3 / § 4 stay in sync with the
   catalog.
3. Edit the matching section in `playbook.md`. If the entry is new, add a
   section; if removed, delete it.
4. Edit `SKILL.md` if the change affects which skills the entry depends
   on.
5. Update the sibling-scan map in § 8.
6. Run the sibling-file scan locally and the cron-jobs builder tests:
   `npx vitest run convex/agents/packs/maya/workspace/__tests__`.
7. Add a fixture-corpus behavioral test for the new entry if cron;
   skip if event/on-demand and already covered by the event harness.

The sibling-scan failure message is intentionally loud and points at
every file that needs a parallel edit. Do not bypass it.
