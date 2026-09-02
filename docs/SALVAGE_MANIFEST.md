# Salvage manifest — what the clean sheet carries from `legacy`

**Produced 2026-09-01/02 by four parallel audits of the legacy tree** (branch `legacy`, tag `legacy-2026-09-01`). One verdict per file: **PORT** (copy as-is with its tests) · **ADAPT** (copy, rewrite the keys from business/product-URL to creator/catalogue/admired-list) · **REFERENCE** (read for the lesson, rewrite) · **DROP**. The scar-tissue lists at the end of each part are the incidents the old code paid for; the plan's definition of done (§8, gate 11) requires a guard for each before the module that could repeat it lands.

**Headline counts.** Core modules (`convex/maya`, `convex/agents`, `agents/`, `infra/`): PORT 16 · ADAPT 29 · REFERENCE 48 · DROP 83. Integrations, `gtmMaya`, billing, schema: PORT 14 · ADAPT 24 · REFERENCE 41 · DROP 220; schema 90 tables → 22 kept as reference, 68 dropped. Web and infra config: ~10 PORT files, Mission Control 6,912 lines REFERENCE, landing DROP, 50 of 60 scripts DROP. Tests: 291 files / 3,767 tests → PORT 33 files (392 tests) · ADAPT 45 (775) · REFERENCE 24 (448) · DROP 189 (2,152).

**What has already been ported to `creator` as of this manifest:** the ScrapeCreators client, `deps`, `schemas`, `normalize`, the TikTok and Instagram wrappers (pruned to the plan's endpoint set and extended), the client tests and TikTok/Instagram fixtures. Everything else below is queued in Sprint 0/1 order.

**Read this first:** Part 4's numbered scar-tissue list (30 items with the guard each one needs), then Part 1's ten most valuable PORT files, then the DROP lists to confirm nothing you care about is on them.

---

# Part 1 — convex/maya, convex/agents, agents/, infra/

# Salvage manifest — part 1: `convex/maya/`, `convex/agents/`, `agents/`, `infra/`

Scope: 90 source files + 87 test files under `convex/maya/`; 16 files under `convex/agents/`; 65 markdown files under `agents/skills/`; `infra/openclaw-runtime/` (README + 2 plugin dirs; `plugins/*/node_modules` is 15,300 untracked files, 465 MB — not enumerated, DROP). 90,648 tracked lines in scope.

Method: header comment, imports and exports of every file; callers grepped where the verdict was unclear. Nothing modified.

Verdict key: **PORT** copy as-is with its test · **ADAPT** copy, then rewrite keys business→creator · **REFERENCE** read for the lesson, rewrite · **DROP** not carried. A test file inherits its source's verdict unless listed separately.

Notes on the verdict calls that differ from the sprint plan's "expected examples" (§6 Sprint 0):
- `cogs.ts` is ADAPT not PORT — half of it provisions per-machine OpenRouter keys (Fly).
- `preSpendGate.ts` is ADAPT not PORT — its eight checks are Creatify credits and asset rungs; the *ordering skeleton* becomes the §13.8 gate.
- `ladder.ts` is ADAPT not PORT — rungs are seen/engaged/clicked/converted (a funnel); §13.7's rungs are cadence/format/hook.
- `cadence.ts` is ADAPT not REFERENCE — the timezone helpers are pure, tested, and were the fix for seven UTC bugs; copy them, rewrite the placement streak.
- `convex/agents/modelRouter/` is DROP — its only callers are `gtmMaya/*` and it reads the deleted Creator-Maya `lib/planFeatures.ts` (coach/manager tiers).

---

## convex/maya/ — sources (90 files)

### PORT (16)

| path | lines | verdict | tests | reason / what changes |
|---|---|---|---|---|
| convex/maya/llm.ts | 148 | PORT | — (covered by llmBudget.test.ts, cogs.test.ts) | The one path to a model; records cost on every call; reasoning-token allowance guard. New §4 registry plugs into `callModel`. |
| convex/maya/breaker.ts | 103 | PORT | breaker.test.ts (7) | Vendor circuit breaker; fails OPEN on missing/stale row; `low` still goes. Maps 1:1 to `vendorBreaker` table. |
| convex/maya/spendCeiling.ts | 238 | PORT | spendCeiling.test.ts (26) | Per-tenant daily ceiling; throttle-never-destroy; reads `costEvents` not `jobs.costUsd`. Only the `THROTTLEABLE_KINDS` constant list changes. |
| convex/maya/jobs.ts | 308 | PORT | jobs.test.ts (24) | Durable queue: idempotent enqueue, lease + reaper, backoff, dead letters, starvation-safe `claimNext`. |
| convex/maya/messages.ts | 530 | PORT | messages.test.ts (25) | One-open-question and dedupe-key invariants enforced in the write path; scoped per tenant; founder-day allowance. Delete `carriesDraft`/`DRAFT_MATCH_CHARS` (~30 lines). |
| convex/maya/pairing.ts | 149 | PORT | pairing.test.ts (9) | Token lives on the tenant row, not a foreign agent row; TTL; `claimPairing`. |
| convex/maya/plainLanguage.ts | 275 | PORT | plainLanguage.test.ts (29) | The leak guard: strings she never wrote (exceptions, vendor names, ids). Whole-term match; stateless; product-name carve-out. Edit `INTERNAL_NAMES` for the new vendor set. |
| convex/maya/directives.ts | 368 | PORT | directives.test.ts (17) | Append-only verbatim ledger, tombstone on revoke, supersede chain, ownership re-derived from identity. Maps 1:1 to `directives`. |
| convex/maya/benchmarks.ts | 299 | PORT | benchmarks.test.ts (10) | Median with sample floor, author-diversity floor, ±20% "at" band, stale-but-flagged. Rename `CACHE_KIND` to a `readCache` kind; drop the `formats` import. |
| convex/maya/quality.ts | 377 | PORT | quality.test.ts (25) | Sweep quality gates: freshness, sample size, author diversity, similarity-to-prior, concrete-noun check, model filler judge. |
| convex/maya/embeddings.ts | 147 | PORT | embeddings.test.ts (13) | Gemini embeddings + cosine, calibrated threshold. Needed for `search_swipe`, `search_memory`, and §13.1 transcript outliers. |
| convex/maya/delivery.ts | 148 | PORT | — (covered in telegram.test.ts) | Reads `deliveryError` back — "who we can no longer reach". Tiny, and it is the reader the column never had. |
| convex/maya/__tests__/founderDay.test.ts | 178 | PORT | — | Every "per day" boundary is the tenant's day. Guards the seven-copies-of-UTC-floor incident. |
| convex/maya/__tests__/sweepMapIsSingular.test.ts | 54 | PORT | — | Exactly one sweep-name→function map; a named-but-missing sweep is a test failure. |
| convex/maya/__tests__/modelSwap.test.ts | 143 | PORT | — | A directive survives a deliberate model swap. Sprint-exit shape worth keeping verbatim. |
| convex/maya/__tests__/llmBudget.test.ts | 64 | PORT | — | Reasoning models bill thinking to `max_tokens`; empty completion, not an error. |

### ADAPT (24)

| path | lines | verdict | tests | reason / what changes |
|---|---|---|---|---|
| convex/maya/cadence.ts | 324 | ADAPT | cadence.test.ts (16) | Keep `dayKeyInZone`, `weekKeyInZone`, `isSameDayInZone`, `dayScanFloor`, `previousDay`. Rewrite `cadence`/`fleetCadence` from placement streak → posts-vs-stated-cadence (§13.7 L0) and sweeps-ran. |
| convex/maya/cogs.ts | 637 | ADAPT | cogs.test.ts (13) | Keep `project`, `record`, `forCustomer`, `fleet`, `formatUsd`, `refreshVendorSpend`, `MIN_DAYS_TO_PROJECT`. Delete `provisionKey`/`storeKeyHash`/`machineSpend`/`keyHashFor` (per-machine OpenRouter keys). customer→creator. |
| convex/maya/telegram.ts | 426 | ADAPT | telegram.test.ts (15), typing.test.ts (DROP) | Keep written≠delivered, `deliveryError` on the inbound row, dedupe, `customerByChatId`. Drop the `./attribution` import (bio-link wraps) and the hand-off to a machine; `handleInbound` enqueues a `converse` job for the dispatcher (§11.4). |
| convex/maya/telegramFiles.ts | 297 | ADAPT | telegramFiles.test.ts (16) | Keep `extractFile`, album settle, oversize message, media-vs-text fork. Route to the §15.3 classifier: photo→`read-screenshot`, video/file→`opinion` instead of `mediaAssets`. Drop `./scheduler` import. |
| convex/maya/directiveGate.ts | 193 | ADAPT | directiveGate.test.ts (7) | Keep fail-open-and-say-so, "false is the common answer" prompt, different-family judge. `CONTENT_KINDS` post/reply → idea/message. Becomes part of `critique` (§15.5). |
| convex/maya/ladder.ts | 321 | ADAPT | ladder.test.ts (9) | Keep `diagnose`/`diagnoseBenchmarked` shape, the pluralised first sentence, the "computed here not by the model" rule. Rungs → §13.7: L0 cadence, L1 format (pace-at-48h < 0.7× baseline), L2 hook. |
| convex/maya/planFeatures.ts | 343 | ADAPT | planFeatures.test.ts (29) | Budgets-never-booleans; `verdictFor`/`BudgetCheck` shape. Budgets become `watchesPerDay`, `ideasPerDay`, `trackedAccounts` per plan; drop `checkVideoBudget`/`checkChannelBudget`/`RUNG_WEIGHT`. |
| convex/maya/preSpendGate.ts | 368 | ADAPT | preSpendGate.test.ts (16) | Keep the skeleton: ordered checks, a named verdict reason, "resolves rather than refuses", `unresolved[]` for checks the caller could not feed. Replace the eight render checks with §13.8's order (quiet hours → cap → open question → budget → cooldown → corroboration). Becomes THE gate under `send_idea`. |
| convex/maya/liveness.ts | 680 | ADAPT | liveness.test.ts (54) | Keep `evaluate`, `tooNewToJudge`/`NEW_CUSTOMER_GRACE_HOURS`, `correlateFleet`, `checkBalance`/`CREDIT_RESERVES`, breach kinds with actions. Facts: brief/recap/placements → sweep ran, gate ran, morning message sent. Drop Creatify balance; add ScrapeCreators `/v1/credit-balance`. |
| convex/maya/scheduler.ts | 639 | ADAPT | scheduler.test.ts (10) | Keep `drainJobs`, `HANDLED_KINDS` + handler-coverage assertion, `deliverNow`, `livenessSweep`, founder-day key. Drop `./video`, `wake_agent`, `DayPlan`. Job kinds → `sweep`, `gate`, `weekly`, `dossier`, `converse`, `calendar_event`. |
| convex/maya/watchers.ts | 592 | ADAPT | watchers.test.ts (18) | Keep once-per-tenant-day `claimSweep`/`releaseSweep`, jitter, `isDue` at local hour, per-tenant action split (300 s limit), `sweepRefs` single map. Sweeps → tracked-account sampler (6–12 h), keyword search, sounds, weekly. |
| convex/maya/formats.ts | 1280 | ADAPT | formats.test.ts (37) | Keep the watch pipeline: `depth` read/watch on every card, dedupe on video not URL, zero-views skip, empty-`reusableAs` drop, stale-flagged cards, `MAX_VIDEO_BYTES`, `mineHashtags` from collected captions. Move the direct Gemini call into `integrations/gemini/`. Drop `extractYoutubeTranscript`, `topShapes` for carousels, `nicheFingerprint`→`formatFingerprint` (§14.2). `nicheCache`→`readCache`. |
| convex/maya/scroll.ts | 845 | ADAPT | scroll.test.ts (31) | Keep velocity-not-volume, `normalizeInstagramReels` (ISO vs unix-seconds guard, shortcode identity), `interleave`, `recordObservations` dedupe on `sourceUrl`. Drop `normalizeYouTubeVideos`, `normalizeXSearch`, `NEWS_WINDOW_MS`. Velocity → §13.2 age-normalised pace. |
| convex/maya/trends.ts | 511 | ADAPT | trends.test.ts (21) | Keep the in-niche vs out-of-niche split, merge-don't-overwrite of watched cards, depth-first sort, "caption-judged is never watched". Trending sounds (`user_count` rise ≥40%) become the corroboration signal (§13.2). |
| convex/maya/learnBusiness.ts | 909 | ADAPT | learnBusiness.test.ts (29) | Keep `judgeKeyword` (validation against live search yield), `looksGeneric`, `rankAccounts` (accounts under ≥2 keywords), `velocity`/`median`, `relearnIfStale`. Product URL → handles + admired list; thresholds → §13.4 (≥15 posts, ≥8 authors, ≥1,000 views). Becomes the code half of `learn-creator`. |
| convex/maya/competitors.ts | 161 | ADAPT | competitors.test.ts (7) | Keep `isBreakout` (multiple vs the account's own median inside a window) and "posting is not a message". competitors → `trackedAccounts`; window/multiple → §13.2 pace ratio and cooldown. |
| convex/maya/relevance.ts | 211 | ADAPT | relevance.test.ts (12) | The niche screen — becomes skill #4 `screen` in code form. Persona summary comes from the dossier; output → `ScreenVerdict` (§14.5). Keep batch size, caption cap, keep-set parse. |
| convex/maya/onramp.ts | 434 | ADAPT | onramp.test.ts (9) | Keep `startFromRead` shape: schedules the first learn, `needsFirstLearn`, `pairingState`, provenance on the row, gaps kept not accepted. URL read → handles + admired list + one sentence. |
| convex/maya/firstRun.ts | 327 | ADAPT | firstRun.test.ts (18) | Keep "say what she is about to do, then do it", `markHelloSent` as the honest start of her working life, briefs-are-briefs-not-scripts, thin-mode brief. Drop `MACHINE_WAIT_MS`/retry. Hello within 10 min of web onboarding (Sprint 1 exit). |
| convex/maya/voiceCorpus.ts | 347 | ADAPT | voiceCorpus.test.ts (25) | Keep `excerptCandidates`/`isVoiceSample` from the creator's own Telegram messages, judged refresh. Feeds `creators.tone`, not a posting voice. |
| convex/maya/voice.ts | 366 | ADAPT | voice.test.ts (26) | Keep `diffSignals`/`foldEdits`/`buildFewShot`. "Edits" become "Not quite" corrections and rewritten hooks the creator sends back. |
| convex/maya/experiments.ts | 403 | ADAPT | experiments.test.ts (20) | Keep pre-declared window and metric, "inconclusive said out loud", closed≠successful, static import rule. Arms from placements → own posts; one live experiment per creator, stored on `creators.experiments[]`; called by `weekly-review`. |
| convex/maya/metrics.ts | 575 | ADAPT | metrics.test.ts (18) | Keep `dueForRefresh`/`REFRESH_WINDOW_MS`/`BATCH_SIZE`, `recordMetrics`, `markGone`, `canonicalUrl`, `awaitingMetrics`. Drop `tweetIdFromUrl`, `refreshFromZernio` for X. Becomes the `ownPosts` sampler with `metricsAsOf` + `source`. |
| convex/maya/dataExport.ts | 259 | ADAPT | dataExport.test.ts (deleted 2026-08-12; dataExportReachable.test.ts REFERENCE) | Keep "the export list IS the purge list", `redactRow`, truncation surfaced. Table list → the §5 creator-scoped set; backs `account({op:"export"})`. |

### REFERENCE (23)

| path | lines | verdict | tests | reason / lesson (≤ 12 words) |
|---|---|---|---|---|
| convex/maya/publishDecision.ts | 319 | REFERENCE | publishDecision.test.ts (27) | One function decides; ten booleans agreeing produced silent holds. → D6 |
| convex/maya/hooks.ts | 2384 | REFERENCE | hooks.test.ts (39) | No tool accepts a tenant id; `{ok,data,next,why}` on every response. |
| convex/maya/outbound.ts | 472 | REFERENCE | — | Exact-string denylist for catastrophic leaks; substring match ate real words. |
| convex/maya/ideas.ts | 687 | REFERENCE | ideas.test.ts (35) | Generate from a standing inventory; blank page gave 10/10 duplicates. |
| convex/maya/complaints.ts | 517 | REFERENCE | complaints.test.ts (24) | Frequency is the point; model merges, sorted not re-clustered. |
| convex/maya/buyerMap.ts | 293 | REFERENCE | buyerMap.test.ts (36) | Ranked evidence with receipts; word-overlap under-clusters (see embeddings). |
| convex/maya/productTruth.ts | 717 | REFERENCE | productTruth.test.ts (31) | Fetched page is data, never instruction; login-wall detection; grounded refusal. |
| convex/maya/activityFeed.ts | 146 | REFERENCE | activityFeed.test.ts (8) | "Is she working?" reads the cost ledger, translated never relayed. |
| convex/maya/archive.ts | 374 | REFERENCE | archive.test.ts (21) | Store `snapshotText`; links die, the archive must outlive the platform. |
| convex/maya/dayPlan.ts | 240 | REFERENCE | dayPlan.test.ts (9) | A promise in a sentence cannot be checked; record it as a row. |
| convex/maya/strategy.ts | 593 | REFERENCE | strategy.test.ts (11) | Weekly review: fixed inputs, default answer is no, change bar. |
| convex/maya/weeklyReport.ts | 413 | REFERENCE | weeklyReport.test.ts (14) | A zero week leads and says why; only show chains that hold. |
| convex/maya/traceability.ts | 238 | REFERENCE | traceability.test.ts (10) | Surface the number that tests the central claim, weekly. → ideas made |
| convex/maya/tells.ts | 247 | REFERENCE | tells.test.ts (9) | Measure the AI-tell list in the niche; most hypotheses died. |
| convex/maya/cringeEval.ts | 605 | REFERENCE | cringeEval.test.ts (27) | Pairwise judge, 50% is perfect; synthetic control; variety score. |
| convex/maya/behaviourEval.ts | 246 | REFERENCE | — | Rules judged by a different model; control scenario; VOID ≠ pass. |
| convex/maya/widerWorld.ts | 173 | REFERENCE | widerWorld.test.ts (3) | Grounded or silent: a search result with no citations is nothing. |
| convex/maya/channels.ts | 678 | REFERENCE | channels.test.ts (20) | Connection health derived from the vendor, never hand-entered; per-channel trust. → Sprint 4 `connections` |
| convex/maya/connect.ts | 224 | REFERENCE | — | Vendor profile is the tenant boundary; scope every call by it. → Sprint 4 |
| convex/maya/zernioCapability.ts | 226 | REFERENCE | — | Declared capability is not verified; probe it live. → Sprint 4 |
| convex/maya/channelRequirements.ts | 93 | REFERENCE | — | Say platform limits at connect, not when the failure lands. |
| convex/maya/__tests__/harnessBoundary.test.ts | 248 | REFERENCE | — | Every job kind has a handler; dead-letter is a test failure. (OpenClaw premise gone.) |
| convex/maya/__tests__/dayInTheLife.test.ts | 362 | REFERENCE | — | Modules pass alone and fail to compose; one end-to-end day test. |

### DROP (27)

| path | lines | verdict | tests | reason |
|---|---|---|---|---|
| convex/maya/deploy.ts | 1068 | DROP | deploy.test.ts (44) | Fly machine + OpenClaw boot. |
| convex/maya/handoff.ts | 258 | DROP | handoff.test.ts (19) | Wire to a per-customer machine. |
| convex/maya/checkpoint.ts | 155 | DROP | checkpoint.test.ts (15) | OpenClaw memory mirror and context check. |
| convex/maya/setup.ts | 274 | DROP | — | Operator machine-start form. |
| convex/maya/publish.ts | 622 | DROP | publish.test.ts (27) | Zernio publish; product does not post. |
| convex/maya/preflight.ts | 222 | DROP | preflight.test.ts (22) | Post text limits per channel. |
| convex/maya/drafts.ts | 703 | DROP | drafts.test.ts (52) | Draft→approve→publish flow. |
| convex/maya/crosspost.ts | 387 | DROP | crosspost.test.ts (20) | Cross-channel caption variants. |
| convex/maya/tiktokConsent.ts | 214 | DROP | tiktokConsent.test.ts (8) | TikTok publish consent flag. |
| convex/maya/inbox.ts | 621 | DROP | inbox.test.ts (18) | Zernio comment inbox and replies. |
| convex/maya/attribution.ts | 825 | DROP | attribution.test.ts (6) | Link wraps, pixel, signups. |
| convex/maya/media.ts | 920 | DROP | media.test.ts (14), assetAsk.test.ts (8) | Media library for renders. |
| convex/maya/assetClassifier.ts | 368 | DROP | assetClassifier.test.ts (22) | Screenshot vs stock classifier. |
| convex/maya/assetFloor.ts | 225 | DROP | assetFloor.test.ts (15) | Video asset ladder, avatar rung. |
| convex/maya/imagery.ts | 304 | DROP | imagery.test.ts (13) | Generated slide backgrounds. |
| convex/maya/slides.ts | 407 | DROP | slides.test.ts (17) | Fixed-frame slide renderer. |
| convex/maya/carousel.ts | 893 | DROP | carousel.test.ts (16) | Carousel planner and critic. |
| convex/maya/brandKit.ts | 549 | DROP | brandKit.test.ts (23) | Brand extraction from a website. |
| convex/maya/video.ts | 935 | DROP | video.test.ts (30) | Creatify render path. |
| convex/maya/videoBrief.ts | 388 | DROP | videoBrief.test.ts (18) | Storyboard for Creatify. |
| convex/maya/adIntel.ts | 1481 | DROP | adIntel.test.ts (41) | Meta ad library competitor intel. |
| convex/maya/audience.ts | 256 | DROP | audience.test.ts (7) | ICP follower overlap; measured near-useless. |
| convex/maya/dashboard.ts | 1230 | DROP | dashboard.test.ts (25) | Founder dashboard over placements/drafts. |
| convex/maya/dailyReport.ts | 434 | DROP | dailyReport.test.ts (25) | Brief/recap over placements. (`dayKey` lives on in cadence.) |
| convex/maya/demo.ts | 536 | DROP | demo.test.ts (12) | Pre-signup product-URL demo. |
| convex/maya/__tests__/typing.test.ts | 262 | DROP | — | v1/v2 webhook fork, machine wake. |
| convex/maya/__tests__/plugin.test.ts | 346 | DROP | — | OpenClaw plugin source contract. |

### Test files without a same-named source, not covered above

| path | lines | verdict | reason |
|---|---|---|---|
| convex/maya/__tests__/dataModelInvariants.test.ts | 349 | ADAPT | Structural invariants asserted against `schema.ts`; table names → §5. Add "table count ≤ 17". |
| convex/maya/__tests__/fleetScale.test.ts | 203 | ADAPT | Two-tenant-through-one-sweep pattern; guards the global-dedupe-key bug. Facts → sweeps/ideas. |
| convex/maya/__tests__/skills.test.ts | 297 | ADAPT | Sibling-file coherence: a skill may not name a tool/table that does not exist (§11.1 requires this test). |
| convex/maya/__tests__/platformAlgo.test.ts | 117 | ADAPT | Bundle matches `craft/*.md`; channel list → TikTok + Instagram. |
| convex/maya/__tests__/dataExportReachable.test.ts | 57 | REFERENCE | Export must be reachable before deletion is. |

---

## convex/agents/ (16 files)

| path | lines | verdict | tests | reason |
|---|---|---|---|---|
| convex/agents/modelRouter/taskTags.ts | 169 | REFERENCE | taskTags.test.ts (79 lines) | Per-task thinking budget map, plan-capped. → §4 registry |
| convex/agents/modelRouter/maya.ts | 236 | DROP | maya.test.ts | Creator-Maya-era router; callers are `gtmMaya/*` only. |
| convex/agents/modelRouter/openRouterClient.ts | 279 | DROP | openRouterClient.test.ts | Superseded by `maya/llm.ts` + `integrations/openrouter`. |
| convex/agents/modelRouter/logCall.ts | 31 | DROP | — | `aiCallLog` writer; `costEvents` replaces it. |
| convex/agents/packs/maya/generators.ts | 1617 | REFERENCE | generators.test.ts (784) | Prompt prefix has a ceiling; fallback from a different vendor family. |
| convex/agents/packs/maya/bundledSkills.ts | 65 | DROP | — | Generated from `agents/skills/maya/`. |
| convex/agents/packs/maya/bundledPlugin.ts | 53 | DROP | bundledPlugin.test.ts (210), configRootKeys.test.ts (344) | Base64 OpenClaw plugin tarball. |
| convex/agents/packs/maya_gtm/generators.ts | 2242 | DROP | generators.test.ts (963), deliveryAnnounce/honestDiagnosis/nativeVoice tests | Frozen GTM workspace bundle. |
| convex/agents/packs/maya_gtm/bundledLocalSkills.ts | 4679 | DROP | — | Generated GTM skill bodies. |
| convex/agents/packs/maya_gtm/bundledPlaybook.ts | 2917 | DROP | — | Generated launch playbook. |
| convex/agents/packs/maya_gtm/bundledGtmPlugin.ts | 147 | DROP | — | Base64 GTM plugin tarball. |
| convex/agents/packs/maya_gtm/pinnedClawhubSkills.ts | 604 | DROP | pinnedClawhubSkills.test.ts (119) | ClawHub skill vendoring. |

---

## agents/skills/ (65 markdown files)

### REFERENCE (craft only) — 20

| path | lines | verdict | lesson |
|---|---|---|---|
| agents/skills/maya/CONVENTIONS.md | 107 | REFERENCE | One shared rules file; skills never repeat it. → §11.1 skill shape |
| agents/skills/maya/PLATFORM_ALGO/tiktok.md | 65 | REFERENCE | What TikTok rewards; publish-only stated. → `craft/tiktok.md` |
| agents/skills/maya/PLATFORM_ALGO/instagram.md | 47 | REFERENCE | Sends and saves outrank likes. → `craft/instagram.md` |
| agents/skills/maya/watch-content/SKILL.md | 57 | REFERENCE | Rank by how much someone else risked on it. → `scout` |
| agents/skills/maya/critique/SKILL.md | 120 | REFERENCE | Veto by tell class: lexical, structural, tonal, register, visual. → `critique` |
| agents/skills/maya/pick-the-week/SKILL.md | 65 | REFERENCE | One shape, derive variations, ask once. → `weekly-review` |
| agents/skills/maya/write-post/SKILL.md | 125 | REFERENCE | Caption's first line is a hook, never a description. → `adapt-format` |
| agents/skills/maya/answer-people/SKILL.md | 115 | REFERENCE | Reply vs escalate vs ignore; never pricing/security/legal. → `converse` |
| agents/skills/maya/comment-relay/SKILL.md | 66 | REFERENCE | Send it with a link so they post it in seconds. |
| agents/skills/maya/make-video/SKILL.md | 126 | REFERENCE | Asset ladder ordering stated out loud. (Craft only; no rendering.) |
| agents/skills/maya-gtm/maya-tiktok-format-researcher/SKILL.md | 132 | REFERENCE | Identify the format that recurs across the strongest posts. → `watch-formats` |
| agents/skills/maya-gtm/maya-content-format-miner/SKILL.md | 128 | REFERENCE | Format card fields; what transfers. → §14.2 |
| agents/skills/maya-gtm/maya-instagram-researcher/SKILL.md | 109 | REFERENCE | Mine Reels and comments for what they watch now. |
| agents/skills/maya-gtm/maya-output-critic/SKILL.md | 119 | REFERENCE | Five gates before any user-facing message. → `critique` |
| agents/skills/maya-gtm/maya-slop-critic/SKILL.md | 125 | REFERENCE | Banned structures beat banned words. → `critique` |
| agents/skills/maya-gtm/maya-voice-matcher/SKILL.md | 111 | REFERENCE | Score against their real writing, not a form. |
| agents/skills/maya-gtm/maya-morning-brief/SKILL.md | 213 | REFERENCE | Self-graded Strong/Thin; tight while useful. → `scout` message |
| agents/skills/maya-gtm/maya-weekly-review/SKILL.md | 152 | REFERENCE | What we learned, extracted, not restated. → `weekly-review` |
| agents/skills/maya-gtm/maya-results-reviewer/SKILL.md | 111 | REFERENCE | double_down / iterate / do_not_overfit. → `explain-post` |
| agents/skills/maya-gtm/maya-strategic-diagnostician/SKILL.md | 62 | REFERENCE | Say the hard thing: it is not the post. → `explain-post` |
| agents/skills/scrapecreators-api/SKILL.md | 303 | REFERENCE | Endpoint catalogue; verify against live before trusting. → §12 |

### DROP — 44

| path | lines | verdict | reason |
|---|---|---|---|
| agents/skills/maya/PLATFORM_ALGO/youtube.md | 44 | DROP | YouTube. |
| agents/skills/maya-gtm/* (the other 32 SKILL.md files: activation-coach, app-inspector, calendar-populator, channel-strategy-judge, competitor-researcher, connection-health, content-reviewer, continuous-research, conversion-tracker, demand-intelligence, distribution-motion-tester, engagement-responder, evening-recap, foundation-research, hn-researcher, icp-hypothesis, inspiration-scout, linkedin-fit-researcher, linkedin-researcher, open-web-read, performance-reader, publisher, reddit-demand-researcher, safety-critic, slideshow-strategist, static-asset-producer, tiktok-demo-strategist, ugc-producer, video-producer, viral-demo-moment-miner, x-founder-led-researcher, youtube-researcher) | 3,171 | DROP | GTM product: ICP, Reddit/HN/X/LinkedIn, publish, Creatify. |
| agents/skills/VENDOR_MANIFEST.md | 77 | DROP | OpenClaw vendored-skill record. |
| agents/skills/docx/SKILL.md | 601 | DROP | Vendored Anthropic skill for OpenClaw. |
| agents/skills/pdf/SKILL.md, forms.md, reference.md | 1,230 | DROP | Vendored Anthropic skill for OpenClaw. |
| agents/skills/internal-comms/SKILL.md + examples/ (5 files) | 197 | DROP | Vendored example skill. |

---

## infra/ (3 tracked units)

| path | lines | verdict | reason |
|---|---|---|---|
| infra/openclaw-runtime/README.md | 142 | DROP | Fly Docker image build notes. |
| infra/openclaw-runtime/plugins/maya-tools/ (index.js 521, README 47, manifest, package.json) | 568 | DROP | OpenClaw tool plugin. |
| infra/openclaw-runtime/plugins/maya-gtm-tools/ (index.js 2274, README 24, manifest, package.json, lockfile; `node_modules/` untracked, 465 MB) | 2,298 | DROP | GTM OpenClaw tool plugin. |

---

## Scar tissue found in this scope

Each is a guard, test, or comment that encodes an incident. Number → becomes a test or guard in the new repo before the module that could repeat it lands.

1. `convex/maya/plainLanguage.ts:220` + `__tests__/plainLanguage.test.ts:310` — a regex with the `g` flag kept `lastIndex` between calls, so the leak guard silently stopped guarding after one match; found 2026-08-24 by shuffling test order.
2. `convex/maya/plainLanguage.ts:184` + `__tests__/plainLanguage.test.ts:262` — the denylist ate the customer's own product name ("Creatify" for creatify.ai); whole-term match with a product-name carve-out, found live 2026-08-21.
3. `convex/maya/llm.ts:58,117` + `__tests__/llmBudget.test.ts` — reasoning models bill thinking to `max_tokens`; 1200 requested, 892 spent thinking, empty completion with no error (2026-08-09, second occurrence).
4. `convex/maya/llm.ts:1-14` — ten call sites imported the model client directly and none recorded cost; `spendToday` reported $0.00 against a $2,508 bill. Recording lives on the only path to the model.
5. `convex/maya/spendCeiling.ts:160` + `__tests__/spendCeiling.test.ts:50,246` — the ceiling read `jobs.costUsd`, which nothing in the live product wrote; `recordCost` had no caller. Now reads `costEvents`.
6. `convex/maya/spendCeiling.ts:1-14` — the previous cap DESTROYED the Fly machine; caps throttle, never destroy, never fleet-wide.
7. `convex/maya/cadence.ts:69` + `__tests__/founderDay.test.ts` + `liveness.ts:474` + `planFeatures.ts:175` + `hooks.ts:636` + `activityFeed.ts:132` — seven copies of `floor(now/86_400_000)*86_400_000` across five files; in New York "today" started at 20:00 yesterday and the 2026-08-07 recap filed as the 8th. Every day boundary is the tenant's day.
8. `convex/maya/messages.ts:461` + `__tests__/messages.test.ts:558` — the UTC day boundary made a founder's daily allowance roll over at the wrong hour and broke the seven-day cadence on 2026-08-10.
9. `convex/maya/messages.ts:332-340` — `askFounder` inserted directly, bypassing dedupe and the one-open-question invariant; two bugs found by watching a real row (2026-08-06).
10. `convex/maya/messages.ts:237` + `__tests__/fleetScale.test.ts:1-10` — the morning-brief dedupe key `brief:<date>` was global, so customer #2 onward were silently suppressed; keys are scoped per tenant.
11. `convex/maya/jobs.ts:131` + `__tests__/jobs.test.ts:364` — `claimNext` could starve: one job kind hogging the queue; the failure that matters is starvation, not slowness.
12. `convex/maya/scheduler.ts:566` + `__tests__/harnessBoundary.test.ts:1-10` — jobs with no handler dead-lettered silently while "the action was metadata"; the whole proactive path did nothing for a day (2026-08-08). Handler-coverage assertion over `HANDLED_KINDS`.
13. `convex/maya/watchers.ts:1-16,174,235` + `__tests__/sweepMapIsSingular.test.ts` — sweeps ran only when the agent chose to call the tool; and two sweep maps diverged (13 vs 6 entries), the missing `fillFromProductPage` sent 14 of 16 placements to X. Code watches; one map.
14. `convex/maya/watchers.ts:517` + `__tests__/watchers.test.ts:200` — one sweep action for all tenants exceeded Convex's 300 s limit at N=1 (2026-08-10); split per tenant.
15. `convex/maya/liveness.ts:115` + `__tests__/liveness.test.ts:743` — a founder onboarded at 17:54 got a "late" breach at 18:13; `tooNewToJudge` + `NEW_CUSTOMER_GRACE_HOURS` (2026-08-21).
16. `convex/maya/liveness.ts:377-388` — the watch cost (Gemini) was invisible to the kill switch; OpenRouter balance added 2026-08-06 with `CREDIT_RESERVES` in dollars vs vendor credits (`:419`).
17. `convex/maya/breaker.ts:1-14` — `checkBalance` shipped, was wired hourly, and only logged; a vendor at zero changed nothing. Breaker fails open on missing/stale rows deliberately.
18. `convex/maya/telegram.ts:282-303` + `delivery.ts:1-14` — a founder said "Yes" and nothing happened because the inbound failure reason was written to a column nobody read (2026-08-12). `deliveryError` on the inbound row, and `fleetUnreachable` reads it.
19. `convex/maya/telegramFiles.ts:1-14` — the webhook forked on `update.message.text`, so every file the founder sent was dropped; media messages have no `text`.
20. `convex/maya/directiveGate.ts:1-13,115,145` + `__tests__/modelSwap.test.ts` — the directive ledger was append-only and write-only ("we do NOT use Reddit" recorded, never enforced); gate fails open and says so; a directive must survive a model swap.
21. `convex/maya/directives.ts:7` — on 2026-07-26 a model ignored a verbatim workspace instruction twice; rules live in rows, verbatim, not in a prompt.
22. `convex/maya/hooks.ts:1-14` — no hook accepts a tenant id; tenancy from the bearer token only (the frozen pack let the agent send its own app id). → §15.6 "no tool accepts a creator id".
23. `convex/maya/hooks.ts:616` — she relayed a tool's refusal text to the founder verbatim (2026-08-21); tool `why` strings must be quotable.
24. `convex/maya/scroll.ts:290` + `relevance.ts:6-15` — keyword search returned `#games` for a SaaS niche and nothing looked broken: real posts, real metrics, wrong niche (2026-08-09). A screen after every search.
25. `convex/maya/scroll.ts:100,245` + `__tests__/scroll.test.ts:303` — 34 of a sweep's observations were X noise on 2026-08-18; channel mix is a quality property.
26. `__tests__/scroll.test.ts:349,518,546` — Instagram `taken_at` is ISO, TikTok `create_time` is unix seconds; seconds-vs-ms decided by magnitude; a reel with no url and no shortcode is skipped, never named after its neighbours.
27. `convex/maya/formats.ts:482` + `__tests__/formats.test.ts:81` — the same TikTok arrived three times as three URLs; dedupe on the video id, not the URL (2026-08-09).
28. `convex/maya/formats.ts:36,102` — `nicheCache` was defined in Sprint 1 with no writers and no readers; and it must carry no customer id (shared read cache, D5).
29. `convex/maya/formats.ts:1142` — a TikTok page URL returns HTML, not an mp4; fetch the CDN URL from `post.info`. (D2 depends on this.)
30. `convex/maya/trends.ts:356` + `__tests__/trends.test.ts:154,207` — banking every judged shape as an idea put 155 of 322 ideas in the bank as noise (2026-08-17); and the merge regression shipped the same afternoon (insert vs merge of watched cards).
31. `convex/maya/benchmarks.ts:21,119,145` — three ways a benchmark lies: too few posts, too few authors, and no "at" band; all guarded.
32. `convex/maya/quality.ts:1-12` — a perception layer that returns mush on every run is worse than one that returns nothing.
33. `convex/maya/learnBusiness.ts:850` — stale keywords rot silently; `relearnIfStale` exists because "silently" was the whole problem.
34. `convex/maya/ideas.ts:7` + `__tests__/cringeEval.test.ts:211` — asked for ten varied posts with no bank she returned one idea ten times (2026-08-05); measured, not vibes.
35. `convex/maya/outbound.ts:118` — the denylist matcher was a substring search and bare words matched inside real words (2026-05-26); exact-string only.
36. `convex/maya/preSpendGate.ts:1-12` + `preflight.ts:1-8` — "failing after a yes is the worst possible sequence"; every gate runs before the person sees the idea.
37. `convex/maya/publishDecision.ts:1-14,204` — ten independent booleans had to agree before a post went out, any one stale held silently for days; and a draft surfaced twelve minutes before its TTL expired (2026-08-06). Exactly one decider, with `now` as an input.
38. `convex/maya/firstRun.ts:1-14` — after pairing she said one hardcoded line and was silent for sixteen hours while running the most expensive call in the product.
39. `convex/maya/liveness.ts:1-10` + `activityFeed.ts:4` — a system cannot be the watchdog for itself; and 111 cost events and 182 jobs were read by nothing while the founder asked "so are you still doing stuff or".
40. `convex/maya/metrics.ts:1-14`, `inbox.ts:1-12`, `audience.ts:4-12`, `carousel.ts:226`, `hooks.ts:1942,2118`, `watchers.ts:560`, `weeklyReport.ts:328`, `drafts.ts:156`, `assetFloor.test.ts:119`, `dataExportReachable.test.ts:5` — the zero-caller defect class, at least 14 instances: built, tested, never invoked. Grep for callers before trusting anything "already built".
41. `convex/maya/cogs.ts:1-14` + `__tests__/cogs.test.ts:134` — a ledger reporting $0.025 against a $22 bill; project per tenant, blend across the fleet, never cap one user into silence.
42. `convex/maya/experiments.ts:36` — a mutation that `await import`s an action dependency fails at runtime; static imports in mutations.
43. `convex/maya/embeddings.ts:9` — Jaccard 0.07 vs cosine 0.71 on the same complaint pair; word overlap under-clusters (measured 2026-07-31).
44. `convex/maya/adIntel.ts:32` + `__tests__/adIntel.test.ts:81,437` — vendor `start_date` in unix SECONDS; the root key differs by endpoint; Meta-signed video URLs die in ~4 days. (DROP module; the "read the live payload, not the doc" rule survives.)
45. `convex/agents/packs/maya/generators.ts:219-222,251-255,328-330` + `__tests__/generators.test.ts:40,685,735` — bootstrap caps (12k/file, 60k total) fail silently; a reasoning model as the cron model produced "Agent couldn't generate a response" six times running; fallback must be a different vendor family.
46. `convex/agents/packs/maya/__tests__/generators.test.ts:417` — a test asserted the opposite of the intended behaviour and the opposite shipped empty for everyone; assert the property, not the current output.
47. `convex/maya/__tests__/dayInTheLife.test.ts:1-10` — every production call into the module came from one file; modules that pass alone must be tested composing.
48. `convex/maya/onramp.ts:15` + `__tests__/onramp.test.ts:58,144,180` — the live module had no customer on-ramp at all; step 2 was found by the operator in a browser; a missing `accountType` made Settings say "No agent yet" to a working customer.
49. `convex/maya/channels.ts:308-312` + `connect.ts:14` — one Zernio API key covers the fleet; until 2026-08-11 the account list carried no `profileId`, so any tenant could see every account. The vendor profile is the tenant boundary.
50. `convex/maya/demo.ts:57,78,393,463` — a public URL-fetching endpoint needs a global ceiling, not per-IP; a 700-token cap truncated the JSON (found by shipping it).

---

# Part 2 — integrations, gtmMaya (salvage only), billing, schema

# Salvage manifest — part 2: `convex/integrations/`, `convex/gtmMaya/`, `convex/billing/`, `convex/accountDeletion.ts`, `convex/http.ts`, `convex/schema.ts`

Scope read against `docs/CREATOR_SPRINT_PLAN.md` §0, §2, §3.2, §5, §6 (Sprint 0), §12. Target: TikTok + Instagram only, Convex-only runtime, Telegram, ScrapeCreators through one `read(kind, params)` cache, Gemini direct, Zernio read-only from Sprint 4, Stripe, Google Calendar, ~14 tables.

Verdict key: **PORT** copy as-is with tests · **ADAPT** copy then rewrite keys · **REFERENCE** read for the lesson, rewrite · **DROP** not carried.

Counts (source + test files, excluding `schema.ts` which gets a per-table table):

| Verdict | Files |
|---|---|
| PORT | 14 |
| ADAPT | 24 |
| REFERENCE | 41 |
| DROP | 220 |

"callers today" = non-test importers outside the file's own directory (`_generated/api.d.ts` excluded).

---

## `convex/integrations/scrapeCreators/`

| path | lines | verdict | tests | callers today | reason / what changes |
|---|---|---|---|---|---|
| `convex/integrations/scrapeCreators/client.ts` | 284 | PORT | `__tests__/client.test.ts` (242) | 23 files: `maya/{buyerMap,competitors,complaints,trends,audience}.ts`, `gtmMaya/*`, `_admin/realWorldDeployGtm.ts` | Retry policy already matches §12.1 (5xx + 429 w/ `retry-after`, full-jitter, 3 attempts, never other 4xx). Additive only: map `402` → fleet breaker + page, `403` → named failure; concurrency cap 50 lives above it. |
| `convex/integrations/scrapeCreators/platforms/tiktok.ts` | 971 | PORT | `__tests__/endpoints.test.ts` "endpoints — TikTok" + "Sprint 1 P0 wrappers" (params verified live 2026-07-31) | `maya/{competitors,trends,audience,buyerMap}.ts`, `gtmMaya/{formatIntel,mineCommentTrees,platformWorkers,researchWorker}.ts` | 23 wrappers, 21 kept (see wrapper table). Params to add after copy: `lastPosts` gets `sort_by`/`max_cursor`/`region=US`/`trim`/`user_id`; `searchTop` gets `publish_time`/`sort_by`; `trendingFeed` gets `trim`; `popularCreators` gets its five filters. Keep ids as strings (see scar #9). |
| `convex/integrations/scrapeCreators/platforms/instagram.ts` | 269 | PORT | `__tests__/endpoints.test.ts` "endpoints — Instagram" + P0 block | `maya/competitors.ts`, `gtmMaya/{platformWorkers,researchWorker}.ts` | 9 wrappers, all kept. After copy: `profile` gets `trim` + `cache_max_age`; `lastPosts` moves `/v1/instagram/user/posts` → `/v2/instagram/user/posts` with `next_max_id`; `mediaTranscript` gets `cache_max_age=30d`. |
| `convex/integrations/scrapeCreators/normalize.ts` | 61 | PORT | via `endpoints.test.ts` | platforms/* | Pure helpers (`num`, `str`, `mediaUrl`, `normalizeVideoDurationSec`). Nothing to change. |
| `convex/integrations/scrapeCreators/deps.ts` | 29 | PORT | via `endpoints.test.ts` | platforms/* | `clientOf(deps)` injection seam + `rawResult` envelope. Nothing to change. |
| `convex/integrations/scrapeCreators/__tests__/client.test.ts` | 242 | PORT | — | — | Retry/backoff/timeout/rate-limit matrix with injected fetch+sleep+random. |
| `convex/integrations/scrapeCreators/__tests__/fixtures/tiktok.ts` | 199 | PORT | — | `endpoints.test.ts` | Real-shape fixtures. |
| `convex/integrations/scrapeCreators/__tests__/fixtures/instagram.ts` | 45 | PORT | — | `endpoints.test.ts` | Real-shape fixtures. |
| `convex/integrations/scrapeCreators/schemas.ts` | 176 | ADAPT | via `endpoints.test.ts` | platforms/*, `gtmMaya/*`, `maya/*` | `PlatformSchema` enum shrinks to `tiktok \| instagram`; `NormalizedPost/Profile/Comment/Audience` shapes stay. Drop `TikTokResearchResultSchema` naming ("research" is GTM vocabulary) or rename to `RawPage`. |
| `convex/integrations/scrapeCreators/endpoints.ts` | 78 | ADAPT | `__tests__/endpoints.test.ts` (738) | 23 files (barrel) | Barrel + `PLATFORM_READERS` dispatch. Drop `youtube`/`linkedin`/`x` re-exports and their `PLATFORM_READERS` entries; keep `tiktok`, `instagram`, `tiktokVideoUrl`, type re-exports. |
| `convex/integrations/scrapeCreators/verifyHandle.ts` | 134 | ADAPT | none direct | none (zero callers — onboarding UI that used it was deleted) | Keep `normalizeHandle` and the round-trip-through-public-profile account-takeover guard; drop `creatorHandles` mentions, keep the Clerk-gated `action` shape for S2 onboarding. |
| `convex/integrations/scrapeCreators/__tests__/endpoints.test.ts` | 738 | ADAPT | — | — | Keep the P0, TikTok, Instagram `describe` blocks (lines 67–603); drop YouTube/LinkedIn/X blocks (604–738). |
| `convex/integrations/scrapeCreators/cache.ts` | 77 | REFERENCE | none (storage half deleted in 0b) | `gtmMaya/researchQueryRunner.ts` (`cacheKey`, `CacheKind` only) | Lesson: this cache was **scoped per creator** ("A can never read B's payloads") — the exact opposite of plan D5, where the shared cross-tenant read cache is the business. Keep only the idea of `kind:` TTL constants; rewrite as `readCache` keyed on kind+normalized params. |
| `convex/integrations/scrapeCreators/platforms/youtube.ts` | 271 | DROP | `endpoints.test.ts` (block) | `gtmMaya/platformWorkers.ts` | YouTube not in the product. |
| `convex/integrations/scrapeCreators/platforms/linkedin.ts` | 149 | DROP | `endpoints.test.ts` (block) | `gtmMaya/platformWorkers.ts` | LinkedIn not in the product. |
| `convex/integrations/scrapeCreators/platforms/x.ts` | 167 | DROP | `endpoints.test.ts` (block) | `gtmMaya/platformWorkers.ts` | X not in the product. |
| `convex/integrations/scrapeCreators/platforms/facebook.ts` | 89 | DROP | none | `maya/adIntel.ts` | Meta ad library; competitor-ad intel not in plan. |
| `convex/integrations/scrapeCreators/agentSkill/manifest.json` | 529 | DROP | `agentSkillManifest.test.ts` | OpenClaw workspace generators | OpenClaw skill manifest; no OpenClaw. |
| `convex/integrations/scrapeCreators/agentSkill/install.md` | 66 | DROP | — | — | OpenClaw install doc. |
| `convex/integrations/scrapeCreators/__tests__/agentSkillManifest.test.ts` | 173 | DROP | — | — | Tests the OpenClaw manifest. |
| `convex/integrations/scrapeCreators/__tests__/fixtures/youtube.ts` | 39 | DROP | — | — | Platform dropped. |
| `convex/integrations/scrapeCreators/__tests__/fixtures/linkedin.ts` | 28 | DROP | — | — | Platform dropped. |
| `convex/integrations/scrapeCreators/__tests__/fixtures/x.ts` | 40 | DROP | — | — | Platform dropped. |

### ScrapeCreators wrappers, per platform file

**`platforms/tiktok.ts`** (`export const tiktok`)

| wrapper | endpoint | verdict |
|---|---|---|
| `profile(handle)` | `GET /v1/tiktok/profile` | PORT |
| `lastPosts(handle)` | `GET /v3/tiktok/profile/videos` | PORT (add `sort_by`, `max_cursor`, `region`, `trim`, `user_id`) |
| `post(handle, awemeId)` | `GET /v2/tiktok/video?url=` (unwraps `aweme_detail`) | PORT |
| `comments(handle, awemeId, cursor)` | `GET /v1/tiktok/video/comments?url=` | PORT |
| `transcript(handle, awemeId)` | `GET /v1/tiktok/video/transcript?url=` | PORT (add `language`, `use_ai_as_fallback`) |
| `audience(handle)` | `GET /v1/tiktok/user/audience` (26 credits) | PORT (onboarding-only, never in a loop) |
| `following(handle)` | `GET /v1/tiktok/user/following` | DROP — not in §12.1 |
| `followers(handle)` | `GET /v1/tiktok/user/followers` | DROP — buyer-map input, not in plan |
| `commentReplies(...)` | `GET /v1/tiktok/comment/replies` | DROP — one page of comments is enough |
| `searchUsers(query)` | `GET /v1/tiktok/search/users` | DROP — `creators/popular` + `find-social-profiles` cover discovery |
| `searchHashtag(hashtag, opts)` | `GET /v1/tiktok/search/hashtag` | PORT |
| `searchKeyword(query, opts)` | `GET /v1/tiktok/search/keyword` (`date_posted`, `sort_by`, `region`, `trim` already mapped) | PORT |
| `searchTop(query)` | `GET /v1/tiktok/search/top` | PORT (add `publish_time`, `sort_by`; the only carousel source) |
| `trendingFeed(region)` | `GET /v1/tiktok/get-trending-feed` | PORT (add `trim`) |
| `popularVideos()` | `GET /v1/tiktok/videos/popular` | DROP — not in §12.1 |
| `popularCreators()` | `GET /v1/tiktok/creators/popular` | PORT (add `followerCount`, `creatorCountry`, `audienceCountry`, `sortBy`, `page`) |
| `popularHashtags()` | `GET /v1/tiktok/hashtags/popular` | DROP — not in §12.1 |
| `popularSongs()` | `GET /v1/tiktok/songs/popular` | DROP — endpoint DOWN at vendor (memory 2026-08-09); not in §12.1 |
| `song(clipId)` | `GET /v1/tiktok/song?clipId=` | PORT (ids as strings — scar #9) |
| `songVideos(clipId, cursor)` | `GET /v1/tiktok/song/videos` | PORT |
| `tiktokVideoUrl(handle, awemeId)` (free fn) | — | PORT |

**`platforms/instagram.ts`** (`export const instagram`)

| wrapper | endpoint | verdict |
|---|---|---|
| `profile(handle)` | `GET /v1/instagram/profile` | PORT (add `trim`, `cache_max_age=1d`) |
| `lastPosts(handle, limit)` | `GET /v1/instagram/user/posts` | PORT → move to `/v2/instagram/user/posts` + `next_max_id` |
| `post(shortcode)` | `GET /v1/instagram/post` | PORT (plan calls it with `url=`; verify param) |
| `postComments(url)` | `GET /v2/instagram/post/comments` | PORT |
| `mediaTranscript(url)` | `GET /v2/instagram/media/transcript` | PORT (add `cache_max_age=30d`; 404 "does not have a video" is a named non-error) |
| `reelsSearch(query, opts)` | `GET /v2/instagram/reels/search` | PORT (pages 1–11 only) |
| `userReels(userId, maxId)` | `GET /v1/instagram/user/reels` | PORT |
| `songReels(audioId, cursor)` | `GET /v1/instagram/song/reels` (alias of `/audio/reels`) | PORT |

**`platforms/youtube.ts`** — `channel`, `recentVideos`, `video`, `search`, `videoComments`, `videoTranscript`, `shortsTrending`, `searchHashtag`, `channelShorts` → all **DROP**.
**`platforms/linkedin.ts`** — `profile`, `recentPosts` → **DROP**.
**`platforms/x.ts`** — `profile`, `recentPosts` → **DROP**.
**`platforms/facebook.ts`** — `searchCompanies`, `companyAds`, `searchAds`, `adTranscript` → **DROP**.

Outside `integrations/` but relevant: `convex/gtmMaya/scrapeCreatorsGtmResearch.ts:220 searchRedditAll` wraps `GET /v1/reddit/search` (the plan's one Reddit call) — lift that single function into `platforms/reddit.ts` (see gtmMaya table).

### Missing wrappers (needed by §12.1 / §3.2, do not exist anywhere in the repo)

- **TikTok:** `GET /v1/tiktok/search/suggestions?query=&region=` (demand) · `GET /v1/tiktok/profile/region?handle=` (drives trending region)
- **Instagram:** `GET /v1/instagram/search?query=` (native search) · `GET /v1/instagram/search/popular?query=&cursor=` (curated topic page, the best IG trend surface) · `GET /v1/instagram/search/profiles?query=&cursor=` (creator discovery) · `GET /v1/instagram/search/hashtag?hashtag=&date_posted=&media_type=reels&cursor=` · `GET /v1/instagram/reels/trending` · `GET /v1/instagram/profile/post-count?handle=` (fills null `media_count`)
- **Cross-platform / account:** `GET /v1/find-social-profiles?platform=&handle=&cache_max_age=30d` · `GET /v1/credit-balance` (0 credits; before every sweep) · `GET /v1/account/get-daily-usage-count` · `GET /v1/account/get-most-used-routes` (§16.4 reconciliation)
- **Reddit:** `GET /v1/reddit/search` exists only inside `gtmMaya/scrapeCreatorsGtmResearch.ts` — not in `integrations/`
- **The cache function itself:** no `read(kind, params)` exists. `maya/nicheCache` (other agent's scope) is keyed per niche, not per kind+params; `scrapeCreators/cache.ts` was per-creator and its storage half is deleted.
- **Cost stamping:** no wrapper writes a `costEvents` row with the endpoint's documented credit cost (`gtmMaya/providerPricing.ts` has a rate table but it is GTM-scoped).

---

## `convex/integrations/zernio/`

| path | lines | verdict | tests | callers today | reason / what changes |
|---|---|---|---|---|---|
| `convex/integrations/zernio/client.ts` | 369 | PORT | `__tests__/client.test.ts` (302: retry matrix, HMAC verify, sha256) | `accountDeletion.ts`, `gtmMaya/{publishEngine,zernioReads,zernioConnect,zernioWebhook}.ts`, `maya/{publish,channels,inbox,zernioCapability,metrics,connect}.ts`, `_admin/zernioLiveSmoke.ts` | Bearer transport + `verifyZernioSignature` (constant-time). Additive: treat `202` as "sync pending" and `424` as "all fetches failed" in the analytics read layer — today both fall through `res.ok` / generic `ZernioApiError` (scar #8). |
| `convex/integrations/zernio/__tests__/client.test.ts` | 302 | PORT | — | — | Comes with `client.ts`. |
| `convex/integrations/zernio/endpoints.ts` | 2658 | ADAPT | `__tests__/contract.test.ts` "read wrappers hit the right paths" + `createProfile` + `getConnectUrl` blocks | as above | Keep ~450 lines: `createProfile`, `getConnectUrl`, `listAccounts`, `getAccountsHealth`, `deleteAccount`, `getPostAnalytics`, `getFollowerStats`, `listWebhooks`, `createWebhook`, `zernioWireSlug`. Drop ~2,200 lines: all `gbp*`, `fb*`, `ig*` writes, `multiPlatformPost`, `*CreatePost`, `validatePost`, `getPostTimeline`, `getBestTime`, `listInboxComments`, `listPostComments`, `listConversations`, `replyToComment`, `sendDm`, `presignMedia`, `makeZernioContext`. Type `listAccounts` rows (`needsReconnect`, `canFetchAnalytics`, `status`) instead of `Record<string, unknown>` passthrough. |
| `convex/integrations/zernio/types.ts` | 697 | ADAPT | via contract tests | as above | Keep error classes, `ZernioProfile`, `ConnectUrlResult`, `AccountHealth`, `FollowerStats`, `PostAnalytics`, `ZernioWebhookEnvelope`/event types. Drop GBP/FB/IG/multi-platform post types (~450 lines). `ZernioPlatform` shrinks to `tiktok \| instagram`. |
| `convex/integrations/zernio/__tests__/contract.test.ts` | 612 | ADAPT | — | — | Keep `createProfile`, `getConnectUrl`, "read wrappers", `createWebhook` blocks; drop `multiPlatformPost`, inbox writes, `presignMedia`. |
| `convex/integrations/zernio/publish.ts` | 332 | REFERENCE | none direct (via `maya/publish` tests) | `maya/publish.ts` | Never publishes in the new product. Lesson worth carrying into every vendor parser: **200 is not the success signal** — a lenient `.passthrough()` parsed a changed shape into "success" for six days while nothing was published. Strict parse the field you act on; `x-request-id` idempotency window. |
| `convex/integrations/zernio/README.md` | 158 | DROP | — | — | Describes the deleted service product. |
| `convex/integrations/zernio/__tests__/endpoints.test.ts` | 498 | DROP | — | — | Tests GBP/FB/IG write wrappers only. |

### Zernio read-only endpoints wrapped today vs §12.2

| §12.2 step | endpoint | wrapped today? |
|---|---|---|
| 1 | `POST /v1/profiles` | yes — `createProfile` (verified live 2026-06-02) |
| 2 | `GET /v1/connect/{tiktok\|instagram}?profileId=&redirect_url=` | yes — `getConnectUrl` (note: `x`→`twitter` slug mapping, irrelevant now) |
| 3 | webhook `account.connected` routed by `profileId` | yes — `gtmMaya/zernioWebhook.ts` (+ `listWebhooks`/`createWebhook` for registration) |
| 4 | `GET /v1/accounts?profileId=` · `GET /v1/accounts/health` | yes — `listAccounts`, `getAccountsHealth`; rows are **untyped passthrough** |
| 5 | `GET /v1/analytics?accountId=&source=external&...` with `202` retry / `424` named failure | wrapper yes (`getPostAnalytics`, lenient schema, `[shape-unverified-live]`); **202/424 handling missing** |
| 6 | `GET /v1/analytics/instagram/account-insights` | **missing** |
| 6 | `GET /v1/analytics/tiktok/account-insights` | **missing** |
| 6 | `GET /v1/accounts/follower-stats` | yes — `getFollowerStats` (verified live 2026-08-12) |
| 7 | `accountsQueried: 0` is unreadable | handled only on inbox wrappers (`endpoints.ts:2199`, `maya/inbox.ts:341`) — the inbox is dropped; carry the rule to analytics |
| 8 | disconnect every account, then **delete the profile** | `deleteAccount` yes; **`DELETE /v1/profiles/{id}` missing** — `accountDeletion.ts` disconnects accounts and leaves the profile |

---

## `convex/integrations/telegram/`

| path | lines | verdict | tests | callers today | reason / what changes |
|---|---|---|---|---|---|
| `convex/integrations/telegram/client.ts` | 418 | ADAPT | `__tests__/botIdentityResolution.test.ts` (75); `maya/__tests__/{typing,telegramFiles}.test.ts` | 15 files: `gtmMaya/*` telegram modules, `maya/{telegram,telegramFiles,media}.ts` | Keep identity resolution, `buildPairingDeepLink`, `parseStartCommand`/`parsePairingPayload`, `sendTelegramMessage`, `sendTelegramChatAction`, `fetchTelegramFile`, `setTelegramWebhook`, secret header, the attachment types (caption ≠ text lesson is in the comments). Add per §12.6: `answerCallbackQuery`, `reply_markup.inline_keyboard` on send, `message_reaction` update type, `allowed_updates` default `["message","callback_query","message_reaction"]` (today defaults to `["message"]` only, line 395), per-chat send queue, `dedupeKey`. Rewrite the header (ClawLaunchBot naming). |
| `convex/integrations/telegram/__tests__/botIdentityResolution.test.ts` | 75 | PORT | — | — | Env-override resolution. |
| `convex/integrations/telegram/sendDirectMessage.ts` | 241 | DROP | `sendDirectMessage.test.ts` | `maya/deploy.ts` (deploy-time hello) | Deploy-time hello for a Fly machine; imports gtm firewall. |
| `convex/integrations/telegram/__tests__/sendDirectMessage.test.ts` | 217 | DROP | — | — | Tests the dropped file. |

## `convex/integrations/gemini/`

| path | lines | verdict | tests | callers today | reason / what changes |
|---|---|---|---|---|---|
| `convex/integrations/gemini/groundedSearch.ts` | 240 | ADAPT | `__tests__/groundedSearch.test.ts` (437) | `gtmMaya/{webSearch,platformWorkers}.ts`, `maya/widerWorld.ts` | Only Gemini file in `integrations/` and it is **grounded web search**, not the watch call — the video `generateContent` (`inlineData`/`fileData`) lives in `maya/formats.ts`, `maya/media.ts`, `maya/assetClassifier.ts` (other agent's scope). Keep the raw-fetch transport to `v1beta/models/{model}:generateContent`, key fallback, citation parsing, soft-fail `gemini_key_missing`; drop the `ResearchRawItem`/`WrapperResult` import from `gtmMaya/scrapeCreatorsGtmResearch.ts`. |
| `convex/integrations/gemini/__tests__/groundedSearch.test.ts` | 437 | ADAPT | — | — | Rewrite the return-shape assertions once `ResearchRawItem` is gone. |

## `convex/integrations/google/`

| path | lines | verdict | tests | callers today | reason / what changes |
|---|---|---|---|---|---|
| `convex/integrations/google/calendar.ts` | 318 | ADAPT | `__tests__/calendar.test.ts` (386) | `gtmMaya/{calendarWrite,calendarOAuth}.ts` | Stateless token-in/JSON-out wrappers: `listCalendarEvents`, `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent`, typed `GoogleCalendarApiError`. Add per §12.5: `calendarList.list`, `syncToken`/`nextSyncToken` on list, `events.watch`/`channels.stop`, `extendedProperties.private.maya="block"` on insert. Strip header references to `creatorMayaV0`/`lcMaya`. |
| `convex/integrations/google/__tests__/calendar.test.ts` | 386 | ADAPT | — | — | Extend for sync token + watch. |
| `convex/integrations/google/gmail.ts` | 291 | DROP | `gmail.test.ts` | none (zero callers) | Gmail not in the product. |
| `convex/integrations/google/__tests__/gmail.test.ts` | 235 | DROP | — | — | Tests the dropped file. |

## `convex/integrations/openrouter/`

| path | lines | verdict | tests | callers today | reason / what changes |
|---|---|---|---|---|---|
| `convex/integrations/openrouter/client.ts` | 160 | PORT | none direct (exercised through `maya/llm.ts` tests) | `maya/llm.ts` | Vendor-only chat completion + 45s timeout + typed result. `llm.ts` (other scope) is the routing layer §12.4 needs. Header prose about onboarding step 2 / Fly boot should be rewritten, code unchanged. |

## Everything else under `convex/integrations/` — DROP

| path | lines | verdict | tests | callers today | reason |
|---|---|---|---|---|---|
| `convex/integrations/appStore/storeListing.ts` | 205 | DROP | `storeListing.test.ts` | `gtmMaya/appInspector.ts` | App-store listing reader for founders' apps. |
| `convex/integrations/appStore/playScraper.ts` | 35 | DROP | — | `storeListing.ts` | Google Play scraper, Node runtime. |
| `convex/integrations/appStore/__tests__/storeListing.test.ts` | 174 | DROP | — | — | Tests dropped file. |
| `convex/integrations/composio/client.ts` | 292 | DROP | `client.test.ts` | `billing/stripeClient.ts` (comment only), `gtmMaya/publishWorkflow.ts` | Composio not in the stack. |
| `convex/integrations/composio/oauth.ts` | 405 | DROP | — | none | Composio OAuth. |
| `convex/integrations/composio/publishContent.ts` | 252 | DROP | — | `gtmMaya/publishWorkflow.ts` | X/LinkedIn publishing. |
| `convex/integrations/composio/universalRunner.ts` | 141 | DROP | `universalRunner.test.ts` | actions/* | Composio action runner. |
| `convex/integrations/composio/actions/calendar.ts` | 119 | DROP | — | — | Calendar via Composio; direct Google wrapper wins. |
| `convex/integrations/composio/actions/gmail.ts` | 320 | DROP | `gmailActions.test.ts` | — | Gmail. |
| `convex/integrations/composio/actions/index.ts` | 32 | DROP | — | — | Barrel. |
| `convex/integrations/composio/actions/linkedin.ts` | 301 | DROP | — | — | LinkedIn. |
| `convex/integrations/composio/actions/stripe.ts` | 161 | DROP | — | — | Stripe reads for creators' revenue; not ours. |
| `convex/integrations/composio/actions/twitter.ts` | 399 | DROP | — | — | X. |
| `convex/integrations/composio/__tests__/client.test.ts` | 176 | DROP | — | — | Dropped vendor. |
| `convex/integrations/composio/__tests__/gmailActions.test.ts` | 126 | DROP | — | — | Dropped vendor. |
| `convex/integrations/composio/__tests__/universalRunner.test.ts` | 153 | DROP | — | — | Dropped vendor. |
| `convex/integrations/creatify/client.ts` | 290 | DROP | `client.test.ts` | `gtmMaya/creatifyVideo.ts`, `maya/{video,videoBrief}.ts`, `vendorSmoke/registry.ts` | Not an editor, not a video generator (§1). |
| `convex/integrations/creatify/endpoints.ts` | 495 | DROP | `linkPaths.test.ts`, `lipsyncV2.test.ts` | as above | Creatify. |
| `convex/integrations/creatify/types.ts` | 261 | DROP | — | as above | Creatify. |
| `convex/integrations/creatify/__tests__/client.test.ts` | 203 | DROP | — | — | Creatify. |
| `convex/integrations/creatify/__tests__/linkPaths.test.ts` | 85 | DROP | — | — | Creatify. |
| `convex/integrations/creatify/__tests__/lipsyncV2.test.ts` | 232 | DROP | — | — | Creatify. |
| `convex/integrations/dataforseo/client.ts` | 130 | DROP | via `gtmMaya/__tests__/{discoveryBudgetGate,providerPricing}.test.ts` | `gtmMaya/demandIntel.ts` | Google search volume; keyword validation uses live search yield instead. |
| `convex/integrations/hackerNews/algoliaSearch.ts` | 194 | DROP | `algoliaSearch.test.ts` | `gtmMaya/platformWorkers.ts` | HN not in the product. |
| `convex/integrations/hackerNews/__tests__/algoliaSearch.test.ts` | 293 | DROP | — | — | Dropped vendor. |
| `convex/integrations/r2/client.ts` | 568 | DROP | via `endpoints.test.ts` | `maya/media.ts`, `vendorSmoke/registry.ts` | R2 not in the stack; Convex storage. |
| `convex/integrations/r2/endpoints.ts` | 377 | DROP | `endpoints.test.ts` | as above | R2. |
| `convex/integrations/r2/__tests__/endpoints.test.ts` | 432 | DROP | — | — | R2. |
| `convex/integrations/twitterApiIo/endpoints.ts` | 207 | DROP | `endpoints.test.ts` | `maya/{inbox,scroll,metrics}.ts`, `gtmMaya/platformWorkers.ts` | twitterapi.io not in the stack. |
| `convex/integrations/twitterApiIo/twitterSearch.ts` | 172 | DROP | — | `gtmMaya/platformWorkers.ts` | X search. |
| `convex/integrations/twitterApiIo/__tests__/endpoints.test.ts` | 179 | DROP | — | — | Dropped vendor. |
| `convex/integrations/videoSynthWorker/client.ts` | 266 | DROP | `client.test.ts` | `gtmMaya/{formatIntel,contentReview}.ts` | Fly worker for Gemini Files; D2 says fetch bytes in a Convex action. |
| `convex/integrations/videoSynthWorker/__tests__/client.test.ts` | 367 | DROP | — | — | Dropped worker. |

---

## `convex/gtmMaya/` — the retired product

Nothing here is PORT. One ADAPT (the Telegram webhook router), a handful of REFERENCE for the lessons, the rest DROP.

| path | lines | verdict | tests | callers today | reason / what changes |
|---|---|---|---|---|---|
| `convex/gtmMaya/telegramWebhook.ts` | 296 | ADAPT | none direct (`maya/__tests__/typing.test.ts`, `onboarding/gtm/__tests__/deployMayaGtm.test.ts` touch it) | `http.ts` | The switchboard. Keep: 503-if-unconfigured, constant-time secret check → 401, always-200 after verification, **files-before-text fork** (media messages have `caption`, never `text`), album `media_group_id` ack key, pairing branch that awaits the claim (founder is watching), typing-first-then-schedule. Remove: v1/v2 `customerByChatId` fork, `telegramHandoff.routeInboundToMachine`, `telegramConfirm.handleConfirmCallback`, `firstRun.kickoff` import. Add per §12.6: **dedupe inbound by `update_id`** (missing today — Telegram replays on any non-200), `answerCallbackQuery` immediately then idempotent processing by payload id, `message_reaction` → signal on the idea, unknown sender → signup link and nothing else. |
| `convex/gtmMaya/zernioWebhook.ts` | 271 | ADAPT | `zernioWebhook.test.ts` (53) | `http.ts` | §12.2 step 3 nearly verbatim: HMAC verify (both header names), replay via `webhookEvents`, `extractProfileId` (recursive, handles nested payloads), route to owner by profile id, run the same reconcile the callback uses, 200 on everything accepted, `ensureZernioGtmWebhook` idempotent registration. Rewrite `gtmAgents.zernioProfileId` → `connections.profileId`; events shrink to `account.connected`/`account.disconnected`. |
| `convex/gtmMaya/scrapeCreatorsGtmResearch.ts` | 1117 | ADAPT | `scrapeCreatorsGtmResearch.test.ts` (416) | `integrations/{gemini,hackerNews,twitterApiIo}` (type import), scripts | Lift **one function**: `searchRedditAll` (line 220, `GET /v1/reddit/search`) into `integrations/scrapeCreators/platforms/reddit.ts` with the plan's params (`filter=posts`, `sort=top`, `timeframe=week`, `trim`). Everything else (X, YouTube, Google, subreddit, comment trees, `ResearchRawItem`) drops. |
| `convex/gtmMaya/calendarOAuth.ts` | 402 | ADAPT | `calendarOAuth.test.ts` (298) | `app/api/google-calendar-gtm/{start,callback}`, scripts | Google OAuth code exchange, refresh, single-use state token, `calendar.readonly` scope (line 30). Retable `gtmCalendarConnections` → `calendarBlocks`/`creators`; add incremental consent for `calendar.events` on first "yes" (§12.5). |
| `convex/gtmMaya/telegramPairing.ts` | 354 | REFERENCE | `telegramPairing.test.ts` (347) | `app/onboarding/gtm/page.tsx`, scripts | `maya/pairing.ts` (other scope) is the PORT. Lesson kept from this one: **a failed claim must talk back** (2026-07-15 — a stale/duplicate `/start` died in a server log while the founder stared at a silent chat); 32-byte base64url token, 15-min TTL, cross-agent claims throw. Plan adds a 24-h TTL during onboarding. |
| `convex/gtmMaya/telegramConfirm.ts` | 1039 | REFERENCE | `telegramConfirm.test.ts` (366), `confirmChainRearm.test.ts` (578) | `http.ts` | The only inline-keyboard/`callback_query` flow in the repo: card with `callback_data`, edit-message-on-tap, re-arm chain. The publish half is dead; the button mechanics inform §12.6 one-tap options. |
| `convex/gtmMaya/outboundFirewall.ts` | 831 | REFERENCE | `outboundFirewall.test.ts` (300), `sanitizeOutbound.test.ts` (46), `sendUpdateCriticGate.test.ts` (260) | `integrations/telegram/sendDirectMessage.ts` | The gtm-era leak guard: exact-string denylist (skill slugs, workspace filenames) + `sanitizeOutboundText` + LLM structural/safety critic. Lessons: (a) `validateOutbound` was **contract-level** — Maya had to choose to call it (header lines 33–36), so it enforced nothing; the new product runs the deterministic check at the send function (§12.4 outage path). (b) Denylist = exact strings only, prompt-primary, no regex heuristics. The PORT candidate is `maya/plainLanguage.ts` (other scope; commit 151e9c7 "the leak guard could silently stop guarding"). |
| `convex/gtmMaya/zernioConnect.ts` | 765 | REFERENCE | `zernioConnect.test.ts` (366) | `http.ts`, `app/clawlaunch/mission/account/_ConnectedAccounts.tsx` | Three lessons for Sprint 4: profile created and persisted **before** the connect URL is minted (line 380–390); the state token is **peeked, not burned**, until at least one account lands, so a re-tap can retry (line 166–172, 489–496); the callback trusts nothing but its own token and re-reads accounts by profileId. And line 718–731: the model pasted in-chat OAuth links into Telegram despite the prompt (2026-06-22), fixed structurally by never returning links from the tool. |
| `convex/gtmMaya/zernioReads.ts` | 528 | REFERENCE | `zernioReads.test.ts` (189) | `http.ts` | Graceful add-on degradation: analytics 403 `hasAnalyticsAccess:false` → `{ok:false, addonRequired}` with a plain message instead of a throw. Everything inbox/reply is dead. |
| `convex/gtmMaya/accountLifecycle.ts` | 590 | REFERENCE | `accountLifecycle.test.ts` (491) | `crons.ts`, `app/api/billing/stripe-webhook/route.ts`, settings page | Cancel = Stripe `cancel_at_period_end` + retention sweep at period end; delete = Stripe → authoritative purge → destroy runtime, every public entry fail-closed to the caller's own account. §19.3 state machine rewrites the states; the order of destruction stays. |
| `convex/gtmMaya/agentLifecycle.ts` | 857 | REFERENCE | `agentLifecycle.test.ts` (717) | — | The "re-doing loop" (42 drafts, 9 day-1 events, fabricated history every 5 min) → durable lifecycle state + lease. New repo: idempotency keys on `jobs`, no permanent non-terminal state (§5 invariants). |
| `convex/gtmMaya/spendKill.ts` | 380 | REFERENCE | `spendKill.test.ts` (277) | `crons.ts` | Rolling-window velocity ($3/hr) + 24h ceiling; **caps throttle, never destroy** (live-verified 2026-06-28). Budgets-as-rows supersede the mechanism, keep the rule. |
| `convex/gtmMaya/livenessWatch.ts` | 348 | REFERENCE | `livenessWatch.test.ts` (167) | `crons.ts` | The dark-day watchdog: DARK BRIEF / BLIND COST / STALLED ONBOARDING — "two weeks of silence looks identical to two weeks of working". Becomes §16.2 liveness + §16.3 alerts. |
| `convex/gtmMaya/evidenceGuard.ts` | 216 | REFERENCE | `evidenceGuard.test.ts` (275) | — | "Grounded or silent" made real: outbound claims must carry evidence ids that resolve to rows. The plan's rule for every proactive message (evidence + links) needs the same server check on `ideas.evidence`. |
| `convex/gtmMaya/synthesisDelivery.ts` | 656 | REFERENCE | `synthesisDelivery.test.ts` (200), `synthesisDedup.test.ts` (274) | `crons.ts` | Deterministic safety net when the LLM turn flakes and the founder never gets the plan. The plan's first-week schedule is a row, not a hope — same reason. |
| `convex/gtmMaya/providerPricing.ts` | 107 | REFERENCE | `providerPricing.test.ts` (116) | — | Per-endpoint credit table for vendors that report no cost (ScrapeCreators logged `costUsd: 0`, so COGS was fiction). §16.4: write the documented credit at call time, reconcile daily against `/v1/credit-balance`. |
| `convex/gtmMaya/openrouterSpend.ts` | 221 | REFERENCE | — | `crons.ts` | Polls vendor-reported spend and compares to the ledger so the kill switch is not blind. §16.4 reconciliation. |
| `convex/gtmMaya/calendarWrite.ts` | 765 | REFERENCE | `calendarApprovalGate.test.ts` (273) | mission page, scripts | Approval-gated event writes with `externalEventId`; the plan's `calendarBlocks.consentAt` rule ("never write without consent") is the same gate. Most of the file is publishing-calendar and drops. |
| `convex/gtmMaya/deliveryFailures.ts` | 215 | REFERENCE | `deliveryFailures.test.ts` (171) | `http.ts`, scripts | OpenClaw `failureDestination` contract is dead, but the dedupe-by-(agent, job) + `attemptCount`/`lastSeenAt` shape is what §16.1 "what the creator hears" needs for send failures. |
| `convex/gtmMaya/costLedger.ts` | 234 | DROP | `costLedger.test.ts` | — | `maya/cogs.ts` supersedes. |
| `convex/gtmMaya/costCap.ts` | 352 | DROP | `costCap.test.ts` | scripts | Budgets-as-rows supersede. |
| `convex/gtmMaya/discoveryBudgetGate.ts` | 347 | DROP | `discoveryBudgetGate.test.ts` | — | GTM discovery pulse budget. |
| `convex/gtmMaya/creativeBudgetGate.ts` | 303 | DROP | `creativeBudgetGate.test.ts` | — | Creatify credits. |
| `convex/gtmMaya/betaGuards.ts` | 402 | DROP | `betaGuards.test.ts` | scripts | GTM beta cohort caps. |
| `convex/gtmMaya/privateBeta.ts` | 346 | DROP | `privateBeta.test.ts` | scripts | GTM beta cohort. |
| `convex/gtmMaya/engagementLedger.ts` | 184 | DROP | `engagementLedger.test.ts` | — | Never-reply-twice; she does not reply. |
| `convex/gtmMaya/telegramHandoff.ts` | 459 | DROP | `telegramHandoff.test.ts` | scripts | Routes inbound to a Fly machine. |
| `convex/gtmMaya/telegramBotPerTenant.ts` | 324 | DROP | `telegramBotPerTenant.test.ts` | `onboarding/gtm/deployMayaGtm.ts` | Per-operator bot tokens; one shared bot. |
| `convex/gtmMaya/zernioRoutes.ts` | 208 | DROP | `publishReplyRouting.test.ts` | `http.ts` | Publish route. |
| `convex/gtmMaya/publishEngine.ts` | 582 | DROP | `publishGate.test.ts`, `autoPublishGate.test.ts` | — | Publishing. |
| `convex/gtmMaya/publishWorkflow.ts` | 195 | DROP | — | — | Composio publish. |
| `convex/gtmMaya/approvalPublishing.ts` | 257 | DROP | `approvalPublishing.test.ts` | scripts | Publishing approvals. |
| `convex/gtmMaya/recordPublished.ts` | 438 | DROP | `recordPublished.test.ts` | — | Published-post metrics polling. |
| `convex/gtmMaya/postResults.ts` | 153 | DROP | `realMetricFetch.test.ts` | mission pages | Published-post snapshots. |
| `convex/gtmMaya/attribution.ts` | 1146 | DROP | `attribution.test.ts`, `attributionRead.test.ts` | `http.ts` | Link wraps, clicks, conversions. |
| `convex/gtmMaya/conversionPing.ts` | 121 | DROP | `conversionPing.test.ts` | — | Conversion pings. |
| `convex/gtmMaya/deepLink.ts` | 153 | DROP | `deepLink.test.ts` | — | Compose-window deep links. |
| `convex/gtmMaya/creatifyVideo.ts` | 1677 | DROP | `creatifyCreative.test.ts`, `creatifyDegrade.test.ts` | `http.ts` | Creatify orchestration. |
| `convex/gtmMaya/mediaAssets.ts` | 831 | DROP | `mediaAssets.test.ts`, `mediaGallery.test.ts` | `http.ts` | Slideshow media library. |
| `convex/gtmMaya/contentReview.ts` | 166 | DROP | — | `http.ts` | Routes video to the Fly worker. |
| `convex/gtmMaya/contentQuality.ts` | 94 | DROP | `contentQuality.test.ts` | — | Draft quality heuristics. |
| `convex/gtmMaya/appInspector.ts` | 484 | DROP | `appInspector.test.ts` | `app/onboarding/gtm/page.tsx` | Founder product inspection. |
| `convex/gtmMaya/productPicture.ts` | 267 | DROP | `productPicture.test.ts`, `productContext.test.ts`, `productFact.test.ts` | account page | Founder product synthesis. |
| `convex/gtmMaya/walkthrough.ts` | 394 | DROP | `walkthrough.test.ts` | onboarding page, scripts | Product walkthrough uploads. |
| `convex/gtmMaya/archetypeBrain.ts` | 245 | DROP | `archetypeBrain.test.ts` | `crons.ts`, `http.ts` | Cross-founder archetype playbooks. |
| `convex/gtmMaya/autonomyPolicy.ts` | 102 | DROP | `autonomyPolicy.test.ts` | — | Posting autonomy. |
| `convex/gtmMaya/calendarPlan.ts` | 249 | DROP | `calendarPlan.test.ts` | scripts | Posting calendar plan. |
| `convex/gtmMaya/channelAgents.ts` | 204 | DROP | `channelAgents.test.ts` | — | Channel research agents. |
| `convex/gtmMaya/channelScoring.ts` | 454 | DROP | `channelScoring.test.ts` | — | Self-declared legacy scaffolding. |
| `convex/gtmMaya/channelSelection.ts` | 223 | DROP | `channelSelection.test.ts` | `onboarding/gtm/deployMayaGtm.ts` | Channel activation policy. |
| `convex/gtmMaya/channelWarmth.ts` | 268 | DROP | — | `http.ts` | Account warmup arcs. |
| `convex/gtmMaya/demandIntel.ts` | 118 | DROP | `demandIntel.test.ts` | `http.ts` | DataForSEO. |
| `convex/gtmMaya/distributionMotions.ts` | 568 | DROP | `distributionMotions.test.ts` | — | GTM motions. |
| `convex/gtmMaya/experimentPlanner.ts` | 113 | DROP | `experimentPlanner.test.ts` | — | GTM experiments. |
| `convex/gtmMaya/experimentStats.ts` | 399 | DROP | `experimentStats.test.ts` | `maya/experiments.ts` | Beta-Bernoulli on conversions; predictions (§14.6) are scored differently. |
| `convex/gtmMaya/experiments.ts` | 264 | DROP | `experiments.test.ts` | `http.ts` | Thompson allocator on drafts. |
| `convex/gtmMaya/formatIntel.ts` | 417 | DROP | `formatIntel.test.ts` | — | Uses the Fly worker; `maya/formats.ts` supersedes. |
| `convex/gtmMaya/intentStrike.ts` | 376 | DROP | `intentStrike.test.ts` | `http.ts` | Buyer-intent strike gate. |
| `convex/gtmMaya/judgeCardsBatch.ts` | 365 | DROP | `judgeCardsBatch.test.ts` | `_admin/realWorldDeployGtm.ts` | Pain-match scoring of threads. |
| `convex/gtmMaya/judgeChannel.ts` | 403 | DROP | `judgeChannel.test.ts` | — | Channel judge. |
| `convex/gtmMaya/managerStore.ts` | 1269 | DROP | `managerStore.test.ts` | — | Nine manager-mode tables. |
| `convex/gtmMaya/memoryLedger.ts` | 218 | DROP | `memoryLedger.test.ts` | `http.ts` | OpenClaw workspace-file write ledger. |
| `convex/gtmMaya/mineCommentTrees.ts` | 476 | DROP | `mineCommentTrees.test.ts`, `commentTreeMining.test.ts` | `_admin/realWorldDeployGtm.ts` | Reddit comment mining. |
| `convex/gtmMaya/missionActions.ts` | 368 | DROP | `missionActions.test.ts` | mission pages, `maya/drafts.ts` | Mission Control UI. |
| `convex/gtmMaya/missionBoard.ts` | 530 | DROP | `missionBoard.test.ts` | — | Mission Control UI. |
| `convex/gtmMaya/missionControl.ts` | 582 | DROP | `missionControl.test.ts` | mission pages, `maya/{formats,archive,attribution}.ts` | Mission Control UI. |
| `convex/gtmMaya/phase2Trigger.ts` | 169 | DROP | — | — | Onboarding phase trigger. |
| `convex/gtmMaya/planDoc.ts` | 262 | DROP | — | `http.ts`, mission page | Plan document. |
| `convex/gtmMaya/planGtm.ts` | 625 | DROP | `planGtm.test.ts` | `billing/gtmBilling.ts`, `founder/dashboard.ts`, onboarding | Three-tier gating; one tier at launch, budgets not booleans. |
| `convex/gtmMaya/platformAlgo.ts` | 250 | DROP | `platformIntelligence.test.ts` | `crons.ts`, `http.ts` | Monthly algo research cron; craft lives in `.md`. |
| `convex/gtmMaya/platformIntelligence.ts` | 172 | DROP | — | — | Platform claims. |
| `convex/gtmMaya/platformWorkers.ts` | 880 | DROP | `platformWorkers.test.ts` | scripts | Multi-platform research workers. |
| `convex/gtmMaya/productionReadiness.ts` | 183 | DROP | — | scripts | GTM env readiness. |
| `convex/gtmMaya/productionReality.ts` | 114 | DROP | `productionReality.test.ts` | — | Founder capability flags. |
| `convex/gtmMaya/queryExpansion.ts` | 174 | DROP | — | — | Keyword expansion for GTM research. |
| `convex/gtmMaya/researchLifecycle.ts` | 972 | DROP | `researchLifecycle.test.ts` | onboarding, mission pages, 8 scripts | Research job lifecycle. |
| `convex/gtmMaya/researchQueryBuilder.ts` | 620 | DROP | `researchQueryBuilder.test.ts` | scripts | Query packs. |
| `convex/gtmMaya/researchQueryRunner.ts` | 220 | DROP | `researchQueryRunner.test.ts` | — | Only caller of `scrapeCreators/cache.ts`. |
| `convex/gtmMaya/researchResults.ts` | 86 | DROP | `researchResults.test.ts` | — | Research results. |
| `convex/gtmMaya/researchTasks.ts` | 387 | DROP | `researchTasks.test.ts` | — | Research task specs. |
| `convex/gtmMaya/researchWorker.ts` | 1526 | DROP | `researchWorker.test.ts`, `runBudgetedResearchJob.test.ts` | `_admin/realWorldDeployGtm.ts`, scripts | Research worker. |
| `convex/gtmMaya/resultsLoop.ts` | 151 | DROP | `resultsLoop.test.ts` | scripts | Learning loop. |
| `convex/gtmMaya/steering.ts` | 396 | DROP | `steering.test.ts` | `http.ts` | Steering directives; `maya/directives.ts` supersedes. |
| `convex/gtmMaya/strategicDiagnosis.ts` | 336 | DROP | `strategicDiagnosis.test.ts` | `http.ts` | PMF/pricing verdicts. |
| `convex/gtmMaya/strategyJudge.ts` | 135 | DROP | `strategyJudge.test.ts` | scripts | Strategy plan types. |
| `convex/gtmMaya/targetList.ts` | 900 | DROP | `targetList.test.ts` | — | Target threads/accounts. |
| `convex/gtmMaya/tiktokWarmup.ts` | 100 | DROP | `tiktokWarmup.test.ts` | — | Account warmup. |
| `convex/gtmMaya/voiceProfile.ts` | 312 | DROP | — | `http.ts` | Founder voice; `maya/voice.ts` supersedes. |
| `convex/gtmMaya/watermarks.ts` | 379 | DROP | `watermarks.test.ts` | — | Delta-read watermarks; velocity sampler replaces. |
| `convex/gtmMaya/webSearch.ts` | 81 | DROP | `webSearch.test.ts` | `http.ts` | hookToken tool wrapper. |
| `convex/gtmMaya/workspaceMutator.ts` | 221 | DROP | `workspaceMutator.test.ts` | scripts | OpenClaw workspace files. |
| `convex/gtmMaya/openclaw/conversationCapture.ts` | 552 | DROP | `conversationCapture.test.ts` | `http.ts`, onboarding | OpenClaw transcript capture; `messages` table is the truth now. |
| `convex/gtmMaya/openclaw/hookClient.ts` | 290 | DROP | `hookClient.test.ts` | onboarding, scripts | OpenClaw hooks. |
| `convex/gtmMaya/openclaw/inboundCallback.ts` | 1631 | DROP | `inboundCallback.test.ts`, `subagentComplete.test.ts` | `http.ts` | hookToken auth + 20 callbacks. |
| `convex/gtmMaya/openclaw/llmGateway.ts` | 213 | DROP | `llmGateway.test.ts` | `http.ts` | OpenRouter proxy for OpenClaw. |
| `convex/gtmMaya/openclaw/managerCallbacks.ts` | 1763 | DROP | — | `http.ts` | Manager-mode callbacks. |
| `convex/gtmMaya/openclaw/planCallbacks.ts` | 96 | DROP | — | `http.ts` | Plan tool. |
| `convex/gtmMaya/openclaw/pulseCallbacks.ts` | 270 | DROP | — | `http.ts` | Discovery pulse tools. |
| `convex/gtmMaya/openclaw/traceCapture.ts` | 199 | DROP | `traceCapture.test.ts` | `http.ts` | OpenClaw trace capture. |

### `convex/gtmMaya/__tests__/` and `openclaw/__tests__/` (113 files, 26,548 lines)

Verdict follows the source file: REFERENCE where the source is REFERENCE/ADAPT (read for the test *shape* — cross-tenant, adversarial, fail-closed patterns — then rewrite against new tables), DROP otherwise.

| path | lines | verdict |
|---|---|---|
| `convex/gtmMaya/__tests__/accountLifecycle.test.ts` | 491 | REFERENCE |
| `convex/gtmMaya/__tests__/activationByConsent.test.ts` | 149 | DROP |
| `convex/gtmMaya/__tests__/agentLifecycle.test.ts` | 717 | REFERENCE |
| `convex/gtmMaya/__tests__/appInspector.test.ts` | 79 | DROP |
| `convex/gtmMaya/__tests__/approvalPublishing.test.ts` | 119 | DROP |
| `convex/gtmMaya/__tests__/archetypeBrain.test.ts` | 191 | DROP |
| `convex/gtmMaya/__tests__/attribution.test.ts` | 628 | DROP |
| `convex/gtmMaya/__tests__/attributionRead.test.ts` | 451 | DROP |
| `convex/gtmMaya/__tests__/autoPublishGate.test.ts` | 161 | DROP |
| `convex/gtmMaya/__tests__/autonomyPolicy.test.ts` | 109 | DROP |
| `convex/gtmMaya/__tests__/betaGuards.test.ts` | 169 | DROP |
| `convex/gtmMaya/__tests__/calendarApprovalGate.test.ts` | 273 | REFERENCE |
| `convex/gtmMaya/__tests__/calendarOAuth.test.ts` | 298 | REFERENCE |
| `convex/gtmMaya/__tests__/calendarPlan.test.ts` | 178 | DROP |
| `convex/gtmMaya/__tests__/channelAgents.test.ts` | 127 | DROP |
| `convex/gtmMaya/__tests__/channelScoring.test.ts` | 193 | DROP |
| `convex/gtmMaya/__tests__/channelSelection.test.ts` | 225 | DROP |
| `convex/gtmMaya/__tests__/coerceStoredJson.test.ts` | 47 | DROP |
| `convex/gtmMaya/__tests__/commentTreeMining.test.ts` | 253 | DROP |
| `convex/gtmMaya/__tests__/confirmChainRearm.test.ts` | 578 | REFERENCE |
| `convex/gtmMaya/__tests__/contentAttributes.test.ts` | 135 | DROP |
| `convex/gtmMaya/__tests__/contentQuality.test.ts` | 87 | DROP |
| `convex/gtmMaya/__tests__/conversionPing.test.ts` | 142 | DROP |
| `convex/gtmMaya/__tests__/costCap.test.ts` | 291 | DROP |
| `convex/gtmMaya/__tests__/costLedger.test.ts` | 244 | DROP |
| `convex/gtmMaya/__tests__/creatifyCreative.test.ts` | 179 | DROP |
| `convex/gtmMaya/__tests__/creatifyDegrade.test.ts` | 79 | DROP |
| `convex/gtmMaya/__tests__/creativeBudgetGate.test.ts` | 167 | DROP |
| `convex/gtmMaya/__tests__/deepLink.test.ts` | 91 | DROP |
| `convex/gtmMaya/__tests__/deleteAccount.test.ts` | 67 | REFERENCE |
| `convex/gtmMaya/__tests__/deliveryFailures.test.ts` | 171 | REFERENCE |
| `convex/gtmMaya/__tests__/demandIntel.test.ts` | 128 | DROP |
| `convex/gtmMaya/__tests__/deriveTurnCost.test.ts` | 42 | DROP |
| `convex/gtmMaya/__tests__/discoveryBudgetGate.test.ts` | 658 | DROP |
| `convex/gtmMaya/__tests__/distributionMotions.test.ts` | 230 | DROP |
| `convex/gtmMaya/__tests__/engagementLedger.test.ts` | 96 | DROP |
| `convex/gtmMaya/__tests__/evidenceGuard.test.ts` | 275 | REFERENCE |
| `convex/gtmMaya/__tests__/experimentPlanner.test.ts` | 149 | DROP |
| `convex/gtmMaya/__tests__/experimentStats.test.ts` | 196 | DROP |
| `convex/gtmMaya/__tests__/experiments.test.ts` | 245 | DROP |
| `convex/gtmMaya/__tests__/formatIntel.test.ts` | 134 | DROP |
| `convex/gtmMaya/__tests__/foundationInsights.test.ts` | 158 | DROP |
| `convex/gtmMaya/__tests__/founderCards.test.ts` | 416 | DROP |
| `convex/gtmMaya/__tests__/hookClient.test.ts` | 101 | DROP |
| `convex/gtmMaya/__tests__/intentStrike.test.ts` | 263 | DROP |
| `convex/gtmMaya/__tests__/judgeCardsBatch.test.ts` | 293 | DROP |
| `convex/gtmMaya/__tests__/judgeChannel.test.ts` | 300 | DROP |
| `convex/gtmMaya/__tests__/livenessWatch.test.ts` | 167 | REFERENCE |
| `convex/gtmMaya/__tests__/managerStore.test.ts` | 1043 | DROP |
| `convex/gtmMaya/__tests__/mediaAssets.test.ts` | 176 | DROP |
| `convex/gtmMaya/__tests__/mediaGallery.test.ts` | 91 | DROP |
| `convex/gtmMaya/__tests__/memoryLedger.test.ts` | 285 | DROP |
| `convex/gtmMaya/__tests__/mineCommentTrees.test.ts` | 317 | DROP |
| `convex/gtmMaya/__tests__/missionActions.test.ts` | 331 | DROP |
| `convex/gtmMaya/__tests__/missionBoard.test.ts` | 159 | DROP |
| `convex/gtmMaya/__tests__/missionControl.test.ts` | 397 | DROP |
| `convex/gtmMaya/__tests__/multiProductMatrix.test.ts` | 284 | DROP |
| `convex/gtmMaya/__tests__/outboundFirewall.test.ts` | 300 | REFERENCE |
| `convex/gtmMaya/__tests__/pipelineHealth.test.ts` | 93 | DROP |
| `convex/gtmMaya/__tests__/planGtm.test.ts` | 533 | DROP |
| `convex/gtmMaya/__tests__/platformIntelligence.test.ts` | 128 | DROP |
| `convex/gtmMaya/__tests__/platformWorkers.test.ts` | 239 | DROP |
| `convex/gtmMaya/__tests__/privateBeta.test.ts` | 198 | DROP |
| `convex/gtmMaya/__tests__/productContext.test.ts` | 117 | DROP |
| `convex/gtmMaya/__tests__/productFact.test.ts` | 111 | DROP |
| `convex/gtmMaya/__tests__/productPicture.test.ts` | 112 | DROP |
| `convex/gtmMaya/__tests__/productionReality.test.ts` | 76 | DROP |
| `convex/gtmMaya/__tests__/providerPricing.test.ts` | 116 | REFERENCE |
| `convex/gtmMaya/__tests__/publishGate.test.ts` | 129 | DROP |
| `convex/gtmMaya/__tests__/publishReplyRouting.test.ts` | 416 | DROP |
| `convex/gtmMaya/__tests__/realMetricFetch.test.ts` | 296 | DROP |
| `convex/gtmMaya/__tests__/recordPublished.test.ts` | 279 | DROP |
| `convex/gtmMaya/__tests__/researchLifecycle.test.ts` | 333 | DROP |
| `convex/gtmMaya/__tests__/researchQueryBuilder.test.ts` | 249 | DROP |
| `convex/gtmMaya/__tests__/researchQueryRunner.test.ts` | 114 | DROP |
| `convex/gtmMaya/__tests__/researchResults.test.ts` | 107 | DROP |
| `convex/gtmMaya/__tests__/researchTasks.test.ts` | 152 | DROP |
| `convex/gtmMaya/__tests__/researchWorker.test.ts` | 101 | DROP |
| `convex/gtmMaya/__tests__/resultsLoop.test.ts` | 67 | DROP |
| `convex/gtmMaya/__tests__/runBudgetedResearchJob.test.ts` | 219 | DROP |
| `convex/gtmMaya/__tests__/sanitizeForConvex.test.ts` | 86 | DROP |
| `convex/gtmMaya/__tests__/sanitizeOutbound.test.ts` | 46 | REFERENCE |
| `convex/gtmMaya/__tests__/schema.test.ts` | 395 | REFERENCE (two-account cross-tenant fixture shape; tables are dead) |
| `convex/gtmMaya/__tests__/scrapeCreatorsGtmResearch.test.ts` | 416 | REFERENCE (only the `searchRedditAll` block) |
| `convex/gtmMaya/__tests__/selfImproving.test.ts` | 137 | DROP |
| `convex/gtmMaya/__tests__/sendUpdateCriticGate.test.ts` | 260 | REFERENCE |
| `convex/gtmMaya/__tests__/setNorthStar.test.ts` | 193 | DROP |
| `convex/gtmMaya/__tests__/setPostingMode.test.ts` | 70 | DROP |
| `convex/gtmMaya/__tests__/setStrategyApproval.test.ts` | 163 | DROP |
| `convex/gtmMaya/__tests__/spendKill.test.ts` | 277 | REFERENCE |
| `convex/gtmMaya/__tests__/steering.test.ts` | 228 | DROP |
| `convex/gtmMaya/__tests__/strategicDiagnosis.test.ts` | 187 | DROP |
| `convex/gtmMaya/__tests__/strategyJudge.test.ts` | 114 | DROP |
| `convex/gtmMaya/__tests__/synthesisDedup.test.ts` | 274 | REFERENCE |
| `convex/gtmMaya/__tests__/synthesisDelivery.test.ts` | 200 | REFERENCE |
| `convex/gtmMaya/__tests__/targetList.test.ts` | 627 | DROP |
| `convex/gtmMaya/__tests__/telegramBotPerTenant.test.ts` | 318 | DROP |
| `convex/gtmMaya/__tests__/telegramConfirm.test.ts` | 366 | REFERENCE |
| `convex/gtmMaya/__tests__/telegramHandoff.test.ts` | 192 | DROP |
| `convex/gtmMaya/__tests__/telegramPairing.test.ts` | 347 | REFERENCE |
| `convex/gtmMaya/__tests__/tiktokWarmup.test.ts` | 48 | DROP |
| `convex/gtmMaya/__tests__/walkthrough.test.ts` | 63 | DROP |
| `convex/gtmMaya/__tests__/watermarks.test.ts` | 400 | DROP |
| `convex/gtmMaya/__tests__/webSearch.test.ts` | 139 | DROP |
| `convex/gtmMaya/__tests__/workspaceMutator.test.ts` | 215 | DROP |
| `convex/gtmMaya/__tests__/zernioConnect.test.ts` | 366 | REFERENCE |
| `convex/gtmMaya/__tests__/zernioReads.test.ts` | 189 | REFERENCE |
| `convex/gtmMaya/__tests__/zernioWebhook.test.ts` | 53 | REFERENCE |
| `convex/gtmMaya/openclaw/__tests__/conversationCapture.test.ts` | 396 | DROP |
| `convex/gtmMaya/openclaw/__tests__/inboundCallback.test.ts` | 317 | DROP |
| `convex/gtmMaya/openclaw/__tests__/llmGateway.test.ts` | 120 | DROP |
| `convex/gtmMaya/openclaw/__tests__/subagentComplete.test.ts` | 97 | DROP |
| `convex/gtmMaya/openclaw/__tests__/traceCapture.test.ts` | 239 | DROP |

---

## `convex/billing/`

| path | lines | verdict | tests | callers today | reason / what changes |
|---|---|---|---|---|---|
| `convex/billing/stripeClient.ts` | 158 | PORT | `convex/__tests__/billing.test.ts` (injects fake via `_setStripeClientForTests`) | `checkout.ts`, `portal.ts`, `gtmBilling.ts`, `stripeWebhookHttp.ts`, `accountDeletion.ts`, `gtmMaya/accountLifecycle.ts`, Next webhook route | Lazy singleton, pinned `STRIPE_API_VERSION = "2026-04-22.dahlia"`, `StripeClientLike` seam. Widen the seam for `invoices` if `invoice.paid`/`invoice.payment_failed` need retrieves. |
| `convex/billing/portal.ts` | 83 | PORT | `billing.test.ts` "billing.portal.openCustomerPortal" (3 cases incl. adversarial) | Settings UI | Customer Portal URL, requires `stripeCustomerId`, Clerk-resolved. Exactly §19.3 self-service. |
| `convex/billing/stripeWebhookHttp.ts` | 211 | ADAPT | none direct (`billing.test.ts` covers the mutations it calls) | `http.ts` `/stripe/webhook` | The public, signature-verified receiver on `*.convex.site` — the fix for scar #1 and #19. Change: it **only dispatches `metadata.product === "gtm"`** and audits/skips everything else (lines ~150–190); the creator/coach path stayed on the Next route. New repo: one product, dispatch everything; add `invoice.paid`, `invoice.payment_failed`, `customer.subscription.trial_will_end`; resolve out-of-order by subscription status timestamp (§19.3). Keep `constructEventAsync` (WebCrypto path), raw-body-first, 500-on-throw so Stripe retries, `.dispatch-failed` audit suffixes. |
| `convex/billing/webhook.ts` | 641 | ADAPT | `billing.test.ts` (cross-tenant, replay, plan×action, downgrade-preserves-connections), `__tests__/paymentFailed.test.ts` (105), `convex/__tests__/webhookSecurityWrappers.test.ts` | Next webhook route, `stripeWebhookHttp.ts` | Keep: sole-writer-of-`creators.plan` rule, `recordWebhookEvent` idempotency by `eventId` → `replay_dropped`, customer→creator lookup + `metadata.creatorId` must match, `handleTrialWillEnd`, `handlePaymentFailed`. Rewrite: coach/manager tiers → the §19.3 plan row (`status`, `trialEndsAt`, `currentPeriodEnd`, `founding`); drop the `*Public` + `assertWebhookSecret` bridge wrappers (they exist only because the Next route uses `ConvexHttpClient`; the Convex http route calls `internal.*` directly). |
| `convex/billing/checkout.ts` | 215 | ADAPT | `billing.test.ts` "createCheckoutSession" (reuse customer, unauthenticated rejects, lazy creator row, missing price env) | `app/checkout/page.tsx` | Keep: Clerk-resolved creator (never a client-supplied id), create-or-reuse `stripeCustomerId`, `metadata.{creatorId}`, hosted URL. Rewrite per §19.3: `trial_period_days: 7` + `payment_method_collection: "always"` on every first subscription, one tier (founding vs list price), Stripe Tax, customer lookup by `creatorId` before creating (two sessions → one subscription). |
| `convex/billing/priceIds.ts` | 92 | ADAPT | via `billing.test.ts` | `checkout.ts`, `webhook.ts`, Next route | Env-driven price table + reverse lookup. Shrink to `{founding, list} × {monthly, annual}`; keep the reverse lookup as the metadata fallback. |
| `convex/billing/gtmBilling.ts` | 397 | REFERENCE | `__tests__/gtmBilling.test.ts` (109) | Settings page, `_admin/realWorldDeployGtm.ts`, webhook routes | `mapStripeStatusToGtm` (line 238) is the status → plan-state mapping §19.3 needs; `compGtmPlanByAgent` is the wrong way to comp (plan says a 100% coupon on the same path). Three-tier gating drops. |
| `convex/billing/__tests__/paymentFailed.test.ts` | 105 | ADAPT | — | — | Keep the case; retarget to the plan row. |
| `convex/billing/__tests__/gtmBilling.test.ts` | 109 | DROP | — | — | Three tiers. |
| `convex/__tests__/billing.test.ts` (not in scope dir, but the billing suite) | — | ADAPT | — | — | Carry the cross-tenant / replay / adversarial cases; rewrite tier assertions. |

---

## Root files

| path | lines | verdict | tests | callers today | reason / what changes |
|---|---|---|---|---|---|
| `convex/http.ts` | 1081 | ADAPT | `maya/__tests__/{hooks,skills}.test.ts` (route-coverage style) | Convex runtime | Keep the router shape and three routes: `POST /stripe/webhook`, `POST /telegram/webhook`, `POST …/zernio_webhook`; add the Google Calendar `events.watch` receiver. Drop the ~80 `/lc_gtm/*` hookToken routes, `/r/` redirects, `/lc_gtm/llm/` gateway, and the 20+ `maya/hooks` routes (OpenClaw tools). Keep the handler-coverage test pattern (every registered route has a test). |
| `convex/accountDeletion.ts` | 940 | ADAPT | `convex/__tests__/accountDeletion.test.ts` (purge by Clerk id, unknown id no-op, Zernio disconnect + 404-is-success, missing key fails loud); `maya/dataExport.ts` shares the list; `accountDeletionCoverage.test.ts` derives it from `schema.ts` | `gtmMaya/accountLifecycle.ts`, Settings | Keep: `DELETE MAYA` confirmation phrase + 30-min request TTL, budgeted deletes under the 4,096-read ceiling, **schema-derived coverage test** (five tables were found orphaned after a live deletion, 2026-07-15 — a hand-maintained list is wrong), Stripe customer delete, Zernio disconnect with retry, the "customers row goes LAST so a partial purge stays resumable" rule. Rewrite the table lists to the ~14 new tables; drop `destroyFlyAppsInternal`; **add Zernio profile deletion** (§12.2 step 8 — no wrapper exists). This is also the Instagram App Review data-deletion endpoint's backing (S1). |

---

## `convex/schema.ts` — 4,514 lines, 90 tables

**TypeScript instantiation-ceiling comments** (the schema sat at 138 tables before Sprint 0a; now 90, still near the ceiling because of nested validators):

- `schema.ts:822–836` (`gtmAgents.mediaLibraryJson`, `creatifyJobsJson`): "the schema sits exactly at TypeScript's DataModel instantiation ceiling, so adding a 139th table (or a richly-typed array field) regresses `db.get()` narrowing project-wide" → JSON-on-row.
- `schema.ts:845` (`voiceProfileJson`), `:857` (Zernio auto-post block "NO new tables"), `:1029` (plan JSON "per the 138-table TS ceiling").
- `schema.ts:1472–1475`: the slideshow media library is NOT a table for the same reason.
- `schema.ts:3466–3469` (the `convex/maya/` block): "Structured blobs are stored as JSON strings rather than nested validators — the schema sits near TypeScript's instantiation ceiling, and deep nesting is what pushes it over (it already regressed `db.get()` narrowing once)"; `:3525`, `:3561`, `:3575`, `:3584` repeat it per field.
- `schema.ts:561`: the Zernio/service block is "part of the orphaned set pending Sprint 0b".

The plan's Sprint 0 named test "schema table count ≤ 17" and "JSON strings for structured blobs" both come from these comments.

| table | verdict | note |
|---|---|---|
| `creators` | keep-as-reference | Clerk identity + Stripe fields + sole-writer-of-`plan` comment; the §19.3 plan row lands here |
| `connectedAccounts` | drop | creator-product Composio connections |
| `aiCallLog` | drop | `costEvents` supersedes |
| `platformAlgoCache` | drop | craft is `.md` |
| `weeklyReviews` | drop | old creator product |
| `accountDeletionRequests` | keep-as-reference | confirmation phrase + TTL + source |
| `stripeWebhookEvents` | keep-as-reference | idempotency by `eventId`, `replay_dropped` audit |
| `webhookEvents` | keep-as-reference | generic provider replay defense (Zernio uses it) |
| `mayaProductWaitlist` | drop | trial with card, no waitlist |
| `growthWaitlist` | drop | Riley |
| `usageEvents` | drop | `costEvents` supersedes |
| `cronHeartbeat` | keep-as-reference | §16.2 liveness |
| `oauthStateTokens` | keep-as-reference | single-use state token with `by_token`; `gtmOauthStateTokens` duplicates it |
| `gtmAgents` | drop | JSON-on-row lesson lives in the comments, not the table |
| `gtmTelegramPairingTokens` | keep-as-reference | one-shot token, TTL, chat binding |
| `gtmCalendarConnections` | keep-as-reference | refresh token, `lastSyncedAt`, selected calendar |
| `gtmCalendarEvents` | keep-as-reference | `externalEventId` + consent → `calendarBlocks` |
| `gtmWorkspaceMutations` | drop | OpenClaw |
| `gtmOauthStateTokens` | drop | duplicate of `oauthStateTokens` |
| `gtmHookCallbacks` | drop | OpenClaw |
| `gtmDeliveryFailures` | drop | OpenClaw |
| `gtmApps` | drop | founder product |
| `gtmResearchJobs` | drop | |
| `gtmWalkthroughUploads` | drop | |
| `gtmEvidenceCards` | drop | |
| `gtmBuyerSegments` | drop | |
| `gtmPlatformBriefs` | drop | |
| `gtmPlatformClaims` | drop | |
| `gtmPlatformRefreshRuns` | drop | |
| `gtmChannelScores` | drop | |
| `gtmDistributionMotions` | drop | |
| `gtmFormatExperiments` | drop | |
| `gtmContentBankItems` | drop | |
| `gtmCostLedger` | drop | `costEvents` supersedes |
| `gtmChannelWatermarks` | drop | |
| `gtmWatchLaneState` | drop | |
| `gtmToolCallLog` | drop | |
| `gtmContentDrafts` | drop | |
| `gtmResultSnapshots` | drop | |
| `gtmSafetyStates` | drop | |
| `gtmAuditEvents` | drop | |
| `gtmConnectionHealth` | drop | `connections.health` on the row |
| `gtmMachineHealth` | drop | Fly |
| `gtmBetaCohort` | drop | |
| `gtmHumanPlanReviews` | drop | |
| `gtmUserReportedSignals` | drop | |
| `gtmUgcReadinessReports` | drop | |
| `gtmTargetThreads` | drop | |
| `gtmTargetAccounts` | drop | |
| `gtmDraftedContent` | drop | |
| `gtmPostResults` | drop | |
| `gtmLinkWraps` | drop | |
| `gtmLinkClicks` | drop | |
| `gtmConversions` | drop | |
| `gtmArchetypeLearnings` | drop | |
| `gtmSkillImprovementProposals` | drop | |
| `gtmAgentActivity` | drop | |
| `gtmAgentTrace` | drop | |
| `mayaMessages` | drop | `messages` supersedes |
| `gtmBuyerMap` | drop | |
| `gtmCompetitiveMap` | drop | |
| `gtmChannelScorecard` | drop | |
| `gtmContentAngles` | drop | |
| `gtmRelationshipTargets` | drop | |
| `gtmCompetitorMoves` | drop | |
| `gtmNichePulse` | drop | |
| `gtmActionLog` | drop | |
| `gtmMemoryWrites` | drop | |
| `gtmNicheLearnings` | drop | |
| `gtmSteeringDirectives` | drop | `directives` supersedes |
| `customers` | keep-as-reference | dossier-as-JSON, quiet hours, tone, timezone → merges into `creators` |
| `channels` | keep-as-reference | → `connections` (profile/account ids, health, `needsReconnect`) |
| `directives` | keep-as-reference | append-only, verbatim, dated, tombstoned |
| `mediaAssets` | drop | no media library; thumbnails go to storage |
| `observations` | keep-as-reference | other people's posts + metrics + sample timestamps |
| `ideas` | keep-as-reference | evidence links, `sentAt`, reaction, `postedAt` — the north-star row |
| `targets` | keep-as-reference | → `trackedAccounts` (handle, platform, why added) |
| `drafts` | drop | she does not draft posts |
| `placements` | drop | she does not publish |
| `inboxItems` | drop | no inbox reads |
| `memorySnapshots` | keep-as-reference | §15.7 `notes[]` replaces the memory file |
| `messages` | keep-as-reference | dedupe key, `skillVersion`/`model` stamps |
| `costEvents` | keep-as-reference | vendor-reported cost basis |
| `dashboardState` | drop | dashboard is a view of rows |
| `strategyChanges` | drop | |
| `dayPlans` | drop | the day is a schedule row, not a table |
| `vendorBreaker` | keep-as-reference | fleet breaker (402 trips it) |
| `jobs` | keep-as-reference | idempotency keys, dead-letter |
| `nicheCache` | keep-as-reference | → `readCache`, re-keyed on kind + normalized params |
| `vendorHealth` | keep-as-reference | smoke results, drift paths, `skipped` ≠ pass |

**Total: 90 tables — 22 keep-as-reference, 68 drop.** (56 `gtm*` + `mayaMessages` + 11 old shared/creator-product tables; the plan's "56 gtm tables and 14 old shared tables" count matches once `gtmOauthStateTokens`, `mayaMessages`, and the seven dead `maya/` tables are included.)

---

## Scar tissue found in this scope

1. `middleware.ts:104–110` — the Stripe webhook route was **never** in `PUBLIC_ROUTES`; Clerk's `auth.protect()` answers **404, not 401**, so the missing entry looked like an undeployed route. The first real `checkout.session.completed` would have 404'd for three days with the payment taken. New repo: "webhook reachable unauthenticated" is a named test (§19.4).
2. `convex/billing/stripeWebhookHttp.ts:8–16` — on staging the Next route sat behind Vercel SSO, so Stripe got a 302 and two `checkout.session.completed` events stuck with `pending_webhooks` (2026-07-06). Billing delivery must never depend on the web deployment's protection settings.
3. `convex/billing/stripeWebhookHttp.ts:~150–190` — the Convex route dispatches only `metadata.product === "gtm"` and **audits-then-skips** everything else; a product with different metadata is silently un-dispatched again. Dispatch every event; skip nothing you audit as "processed".
4. `convex/gtmMaya/zernioConnect.ts:399` + `zernioWebhook.ts:4–12` — the connect `redirect_url` carries `?token=`; Zernio appends its own query string and the browser redirect is best-effort. The `account.connected` webhook, routed by `profileId`, is the authoritative signal.
5. `convex/maya/connect.ts:10–11` (and `zernioConnect.ts:380–390`) — `zernioProfileId` lived only on the gtm-era row, so the live module "had nowhere to put one": six orphan profiles and accounts landing on the **Default profile** (2026-06-07). Persist `profileId` on `connections` before minting the connect URL.
6. `convex/integrations/zernio/endpoints.ts:2120–2129` — `/inbox/comments` returned `accountsQueried: 0` with one healthy account while `/inbox/conversations` returned 1 on the same call; `accountsQueried: 0` is **unreadable**, not "no data" (`maya/inbox.ts:341` handles it; the analytics reads do not).
7. `convex/maya/zernioCapability.ts:14,164–165` — `canFetchAnalytics: true` while `/analytics` returned `lastSync: null`; and health was derived by parsing `tokenExpiresAt`. §12.2: `needsReconnect` means "creator must act", `canFetchAnalytics` means "we can read", never derive from `tokenExpiresAt`.
8. `convex/maya/metrics.ts:20` — analytics answered `lastSync: null` and `posts: []` while `overview.totalPosts` claimed 9: the vendor's own summary disagrees with its rows. Read the rows, not the overview.
9. `convex/integrations/zernio/client.ts:193` — a `202` (sync pending) is `res.ok` and goes straight to the Zod parser; a `424` (every platform fetch failed) becomes a generic `ZernioApiError`. Neither gets the retry-in-an-hour / no-retry-for-6h treatment §12.2 step 5 needs.
10. `convex/integrations/zernio/endpoints.ts:1655–1687` — `listAccounts` returns `Array<Record<string, unknown>>` passthrough; `needsReconnect`/`canFetchAnalytics`/`status` are untyped, and `zernioConnect.ts:588` derives "unhealthy" from `needsReconnect === true || canPost === false` by duck-typing.
11. `convex/accountDeletion.ts:551–605` — Zernio disconnect deletes each account (404 = already gone) but **never deletes the profile**; no `DELETE /v1/profiles/{id}` wrapper exists anywhere (§12.2 step 8).
12. `convex/integrations/scrapeCreators/client.ts:160–170` — "never retry 4xx other than 429" is right, but `402` (credits gone) and `403` (source blocks) are indistinguishable `ScrapeCreatorsHttpError`s: no breaker trip, no page, no named failure.
13. `convex/integrations/scrapeCreators/platforms/x.ts:118` uses `id_str`; **`platforms/tiktok.ts` has no `id_str` handling at all** — TikTok music/clip ids exceed `MAX_SAFE_INTEGER` (memory 2026-08-09) and `NumberLike` coerces strings to numbers. Keep ids as strings end to end.
14. `platforms/tiktok.ts` / `instagram.ts` — `mediaUrl` normalizes the signed CDN `download_addr`/`play_addr` into `NormalizedPost.mediaUrl` with no expiry marker, so any caller can persist a URL that dies in minutes. D2: fetch within minutes, never store the URL.
15. `convex/integrations/scrapeCreators/cache.ts:3–7` — the cache was scoped per creator "so creator A can never read creator B's payloads" — the inverse of D5; its storage half was deleted in 0b and only `cacheKey` survived with one caller.
16. `convex/gtmMaya/telegramWebhook.ts` — no `update_id` dedupe. Telegram replays on any non-200, and every branch returns 200 only after scheduling work; a retried update produces two replies. Also `client.ts:395`: `allowed_updates` defaults to `["message"]`, so `callback_query`/`message_reaction` never arrive unless the caller remembers to override.
17. `convex/gtmMaya/telegramWebhook.ts:282–294` — `constantTimeEqual` returns `false || acc === -1` on length mismatch: correct, but a reader has to prove it. Use `crypto.subtle.timingSafeEqual`-style helper from `lib/webhookSecret.ts:44` instead.
18. `convex/gtmMaya/telegramWebhook.ts:126–131` — a failed pairing claim used to die in a server log while the founder stared at a silent chat (2026-07-15). Every `/start` answers, success or failure.
19. `convex/gtmMaya/telegramWebhook.ts:140–150` + `client.ts:98–103` — media messages have `caption`, never `text`; the switchboard forked on `text`, so a founder who answered "send me a screen recording" got **silence**. Files before the text fork.
20. `convex/integrations/telegram/sendDirectMessage.ts:22–30` — the private-DM firewall policy: the outbound firewall bounced private messages (the plan's scar list item).
21. `convex/gtmMaya/outboundFirewall.ts:33–36` — `validateOutbound` was "contract-level": the model had to choose to call it. Enforcement lived in a prompt.
22. `convex/gtmMaya/zernioConnect.ts:718–731` — the model pasted in-chat OAuth links into Telegram despite the prompt (2026-06-22); fixed by never returning links from the tool. Structural, not prompt.
23. `convex/gtmMaya/zernioConnect.ts:166–172` — the single-use state token is peeked on callback and only burned once an account lands, because Zernio's eventual-consistency lag returned 0 accounts and burned the token on the first design.
24. `convex/integrations/zernio/publish.ts:10–16` — Zernio returned 200 for six days while nothing was published; `.passthrough()` parsed a changed shape into success. 200 is not the signal; the field you act on is.
25. `convex/accountDeletion.ts:106–113` — five account-scoped tables (incl. the founder's private DM transcript) survived a live deletion (2026-07-15). Fix: `accountDeletionCoverage.test.ts` derives the purge list from `schema.ts`; `accountDeletion.ts:800–805` records that the hand-written list was wrong twice out of fifteen.
26. `convex/schema.ts:824,1474,3466` — the TS DataModel instantiation ceiling at 138 tables regressed `db.get()` narrowing project-wide; the response was JSON-on-row everywhere. New repo: ≤ 17 tables, JSON strings for blobs, and a count test.
27. `convex/gtmMaya/agentLifecycle.ts:6–8` — the re-doing loop: onboarding re-ran every 5 minutes forever (42 drafts, 9 day-1 events, fabricated history). Durable lifecycle state + idempotency keys, not prompt discipline.
28. `convex/gtmMaya/providerPricing.ts:4–8` — ScrapeCreators/TwitterAPI/DataForSEO logged `costUsd: 0`, so the COGS model and budget gate were fiction. Write the documented credit at call time; reconcile against `/v1/credit-balance`.
29. `convex/gtmMaya/livenessWatch.ts:16–19` — "two weeks of silence looks identical to two weeks of working"; nothing watched for quiet degradation until the dark-day watchdog.
30. `convex/integrations/gemini/groundedSearch.ts:23` and `hackerNews/algoliaSearch.ts`, `twitterApiIo/twitterSearch.ts` — three `integrations/` files import product types from `gtmMaya/scrapeCreatorsGtmResearch.ts`, inverting the "vendor SDKs, never product logic" rule; the barrel dependency has to be cut before any of them is copied.
31. `convex/integrations/telegram/client.ts:14–20` — bot-token env naming was shared with OpenClaw, whose env-token polling **deleted the webhook** (memory: shared-bot architecture). The new repo has no second consumer of the token, but the `setWebhook`-at-deploy step should assert the webhook is still set.

---

# Part 3 — web app and infra config

# Salvage manifest — part 3: web surface and infra

Scope: `app/`, `components/`, `lib/`, `hooks/` (does not exist), `middleware.ts`, `proxy.ts` (does not exist), `public/`, `app/globals.css`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `package.json`, `.github/workflows/`, `vercel.json`, `.vercelignore`, `.env.example` (no `.env.local.example` exists), `scripts/`, `assets/fonts/`. No `tailwind.config.*` (Tailwind v4, config lives in `globals.css`). No `components.json`, no `components/ui/` — **shadcn is named in CLAUDE.md/README but was never installed**; the only Radix primitive in use is `@radix-ui/react-dialog`.

Totals: `app/` 78 files / 16,124 lines · `components/` 3 / 365 · `lib/` 2 / 107 · `scripts/` 60 / 12,928.

Legend: **PORT** copy as-is · **ADAPT** copy and rewrite (says what) · **REFERENCE** read for the pattern, rewrite (says the lesson) · **DROP** (≤ 8 words).

---

## Root config

| path | lines | verdict | reason / what changes |
|---|---|---|---|
| `middleware.ts` | 143 | **ADAPT** | The pattern is the salvage: three exported route arrays (`PUBLIC_ROUTES`, `SERVER_TO_SERVER_ROUTES`, `PUBLIC_BROWSER_ROUTES`) consumed by `clerkMiddleware` AND by `tests/middlewarePublicRoutes.test.ts`. Keep the arrays + matcher + the `auth.protect()`-answers-404 comment verbatim. Replace the route list: `/`, `/privacy`, `/terms`, `/account/delete`, `/sign-in(.*)`, `/sign-up(.*)`, the operator console (token-gated), the data-deletion URL, and the webhooks. Drop `/clawlaunch(.*)`, `/vibecoders`, `/builders`, `/waitlist`, `/demo`, `/start`, `/founder`, `/api/render/slide`, `/api/demo/read`, the TikTok verification `.txt`. Rename to `proxy.ts` only if Next 16 in the new repo has deprecated `middleware.ts` (it still works today). |
| `next.config.ts` | 34 | **REFERENCE** | Everything in it serves the deleted resvg render route (`outputFileTracingIncludes`). New repo starts from `allowedDevOrigins` and nothing else. Lesson worth a comment: Turbopack statically analyses `require.resolve`, and output file tracing can't see runtime-built paths. |
| `postcss.config.mjs` | 6 | **PORT** | Tailwind v4 postcss plugin, nothing else. |
| `eslint.config.mjs` | 17 | **PORT** | Flat config, `eslint-config-next` vitals + TS. Make lint blocking from day one (§20.1). |
| `tsconfig.json` | 31 | **ADAPT** | Strict, `@/*` alias, ES2017 target. Remove the `services` exclude and `.next/dev/types` include. Consider `target: ES2022`. |
| `vitest.config.ts` | 33 | **ADAPT** | Keep: `@` alias mirroring tsconfig, `edge-runtime` env, `convex-test` inline dep. Rewrite the `include` globs for the new tree. |
| `vercel.json` | 9 | **PORT** | `git.deploymentEnabled: { "*": false, main: true, staging: true }` is exactly §20.1's deploy rule. |
| `.vercelignore` | 6 | **PORT** | Trivial. |
| `.gitignore` | 84 | **ADAPT** | Port the iCloud sync-conflict block (`* 2.ts`, `* [0-9]/` …) — this repo currently has **five tracked ` 2.`/` 3.` duplicates** despite it (`scripts/convex-deploy-prod 2.sh`, `3.sh`, `app/clawlaunch/mission/house-rules/page 2.tsx`, two test dupes). Drop the Fly/veo/services lines. |
| `.env.example` | ~110 | **DROP** | Names Composio, Fly, Twilio, WhatsApp, deleted feature flags. Write fresh from §20.2. |
| `package.json` | 89 | **ADAPT** | See the dependency lists at the end. Scripts: keep `dev/build/start/lint/test/test:watch`; replace `convex:*` with `deploy:staging` / `deploy:prod` (§20.3); delete every `smoke:gtm-*`, `sync:*`, `scan:*`. Note `stripe:create-creator-products` points at a file that does not exist (`createCreatorProducts.ts`). |
| `.claude/launch.json` | 22 | **PORT** | `web` (next dev :3000) and `web-prod` (next start :3001) preview configs. Harmless and useful. |

## `.github/workflows/`

| path | lines | verdict | reason / what changes |
|---|---|---|---|
| `ci.yml` | 62 | **ADAPT** | Keep the shape: PR + push on `staging`/`main`, concurrency cancel-in-progress, Node 22 npm cache, typecheck before tests, dot reporter. Change: make `lint` blocking (delete `continue-on-error`), add the copy grep, the chat-completeness registry, and the scar-tissue guard list as named steps (§20.1). Add a scheduled live-smoke job that writes `vendorHealth`. |
| `claude-code-review.yml` | 44 | **PORT** | Stock `anthropics/claude-code-action` PR review. Needs `CLAUDE_CODE_OAUTH_TOKEN` secret in the new repo. |
| `claude.yml` | 50 | **PORT** | Stock `@claude` mention handler. Same secret. |

## `app/` — root, auth, providers

| path | lines | verdict | reason / what changes |
|---|---|---|---|
| `app/layout.tsx` | 84 | **ADAPT** | Keep: `next/font/google` variable-font pattern, `viewport` export with `viewportFit: cover` + `userScalable` left on, `apple-mobile-web-app-*` meta, `suppressHydrationWarning`. Change: metadata (it says "UGC your app needs"), fonts (S1 wants display + body + mono; currently mono is aliased to Geist Sans), `themeColor` must follow the theme (currently hardcoded dark), add `manifest` link for the PWA (none exists today). |
| `app/providers.tsx` | 95 | **ADAPT** | Keep `ClerkProvider` → `ConvexProviderWithAuth` → `PostHogProvider` nesting, `allowedRedirectOrigins` regex, and `useConvexAuthFromClerk` (fetches the Convex JWT from `/api/auth/convex-token` with a force-refresh header). Change: the regex domain, and delete the 30-line hardcoded cream `clerkAppearance` — drive Clerk from tokens, both themes. |
| `app/api/auth/convex-token/route.ts` | 23 | **PORT** | Clerk `getToken({ template: "convex" })` bridge with `no-store`. Requires the `convex` JWT template in the new Clerk instance. |
| `app/sign-in/[[...sign-in]]/page.tsx` | 31 | **ADAPT** | Keep the `redirect_url` → `forceRedirectUrl` plumbing and the `signUpFallbackRedirectUrl` fix (OAuth first-timers get routed through sign-UP and land in the wrong place without it). Change all four URLs to `/today` and the S2 flow. |
| `app/sign-up/[[...sign-up]]/page.tsx` | 25 | **ADAPT** | Same; `fallbackRedirectUrl` → onboarding screen 2. |
| `app/page.tsx` | 31 | **DROP** | Re-exports the founder landing with UGC metadata. |
| `app/auth-debug/page.tsx` | 113 | **REFERENCE** | Decodes the Convex JWT client-side and shows issuer/audience/expiry next to a live query. Useful once when wiring Clerk↔Convex on a new instance; rebuild only if that wiring breaks. Never ship publicly. |
| `app/favicon.ico` | — | **DROP** | New brand asset. |

## `app/api/` — webhooks and server routes

| path | lines | verdict | reason / what changes |
|---|---|---|---|
| `app/api/billing/stripe-webhook/route.ts` | 604 | **ADAPT** | PORT the skeleton (≈120 lines): raw `req.text()` before `constructEvent`, 400 only on signature failure, always-200 with an audit row otherwise, `recordWebhookEvent` first and short-circuit on `alreadySeen` (idempotent by `event.id`), `subscriptionPeriodEndMs` guarding both SDK shapes, `trial_end` extraction, the `.dispatch-failed` / `.handler-threw` suffixed audit ids, the catch-all. DELETE (≈480 lines): the coach/manager and starter/growth/studio tier branches, `isGtmProduct`, `gtmTier`, the Fly machine teardown on `subscription.deleted`. Rewrite dispatch to the §19.3 plan-row state machine and add `invoice.paid` (currently `skipped`) and out-of-order resolution by subscription status timestamp (currently missing — spec §19.3 requires it). |
| `app/api/clerk/webhook/route.ts` | 92 | **ADAPT** | PORT the Svix verify (`svix-id/timestamp/signature` → `wh.verify`), `user.created` → create row, `user.deleted` → purge backstop. Delete `destroyMayaFlyApps` and `accountType: "gtm-agent"`. Add the 18+ age-gate check if Clerk exposes it in the payload (S1). |
| `app/api/account/delete/route.ts` | 53 | **ADAPT** | Keep: Clerk `auth()` gate, typed confirmation phrase, Convex purge then `clerkClient().users.deleteUser`. Drop the Fly cleanup. This IS the S1 "working deletion endpoint" Meta/Google require — keep it public-URL-documented. |
| `app/api/render/slide/**` (route 244 + 2 tests 198) | 442 | **DROP** | Carousel rasteriser; new product makes no media. |
| `app/api/demo/read/route.ts` | 97 | **REFERENCE** | The salted-IP-hash pattern (`sha256(salt:ip)` sliced, never storing the address) and "always 200, `ok:false` is an answer" are worth keeping in mind for S2's public handle-check endpoint, which needs the same per-IP guard. Endpoint itself is founder-product. |
| `app/api/google-calendar-gtm/start/route.ts` | 101 | **REFERENCE** | Google OAuth start with a Convex-stored single-use state token instead of a cookie (so the flow works from web or Telegram). S2 screen 5 needs exactly this; rewrite against the new `calendarOAuth` module. Scopes: `calendar.readonly` + `calendar.events` — the new product also writes blocks (Plan tab), so both stay. |
| `app/api/google-calendar-gtm/callback/route.ts` | 84 | **REFERENCE** | Same flow's callback. ⚠️ It calls `internal.*` via `ConvexHttpClient` with `as never` casts — that is a type lie that only works because the state-token claim is exposed; the new one must call a public wrapper gated by the state token. |

## `app/` — founder product surfaces (not carried)

| path | lines | verdict | reason / what changes |
|---|---|---|---|
| `app/clawlaunch/page.tsx` | 1326 | **DROP** | Founder landing; UGC positioning. Only reusable bits: footer links to `/privacy` + `/terms`, `DotNav` built from `data-nav` attributes (cute, not needed), and the "hero entrance is a CSS animation, never an observer" lesson — also encoded in `tests/landingPageIntegrity.test.ts`. |
| `app/clawlaunch/__tests__/landingDemo.test.tsx` | 81 | **DROP** | Guards the founder demo block. |
| `app/_components/landingMode.ts` | 40 | **DROP** | Waitlist/signup env switch; new landing has one CTA. |
| `app/_components/MarketingNav.tsx` | 88 | **DROP** | Links to vibecoders/waitlist. |
| `app/_components/FeatureSection.tsx` | 60 | **DROP** | Founder landing block. |
| `app/_components/ScrollReveal.tsx` | 76 | **REFERENCE** | Two-rAF defer so elements already in view still transition; `prefers-reduced-motion` respected in CSS. Reuse the trick if S1 wants scroll reveals. |
| `app/_components/DemoRead.tsx` | 145 | **DROP** | URL-read demo, founder product. |
| `app/vibecoders/page.tsx` | 334 | **DROP** | Second founder landing. |
| `app/builders/page.tsx` | 5 | **DROP** | Redirect to `/clawlaunch`. |
| `app/demo/page.tsx` | 13 | **DROP** | Demo block host. |
| `app/waitlist/page.tsx` + `WaitlistForm.tsx` | 131 | **DROP** | Waitlist mode; no waitlist in the plan. |
| `app/start/page.tsx` | 515 | **REFERENCE** | The only lesson worth keeping is the pairing step: `useQuery(pairingState)` flips the screen to Connected live from the row, **no polling**. S2 screen 6 is this pattern plus the app-link/fallback-to-store logic. Everything else is founder onramp. Also: ⚠️ comment records that `mc-*` classes only exist inside the mission layout's CSS import — a route outside it rendered the primary button as bare text. One stylesheet, globally imported, in the new repo. |
| `app/maya/setup/page.tsx` | 279 | **REFERENCE** | QR rendered client-side from the pairing deep link (`qrcode` lib) — because the link carries a token and a third-party QR service would see it. S2 desktop path needs this. Rest is Fly deploy plumbing. |
| `app/connect/page.tsx` | 333 | **REFERENCE** | Zernio OAuth in a **popup**, with the opener re-reading on window close and on focus as the fallback. The reason (preview deployments have unique hostnames; a full-tab redirect to `APP_URL` lands on a session-less sign-in) applies to Sprint 4's Zernio connect and to Google Calendar. `connected_cant_post` as a distinct state rather than a boolean is the right shape for the Settings connections row. |
| `app/checkout/page.tsx` | 152 | **REFERENCE** | Auth-gated bridge: `?tier=&interval=` → sign-up with `redirect_url` preserved → `useAction(createCheckoutSession)` → `window.location.assign`. Keep the `startedRef` guard against strict-mode double-fire and the `Suspense` around `useSearchParams`. New product has one tier so the params shrink to `interval`. |
| `app/account/delete/page.tsx` | 145 | **ADAPT** | Typed-phrase deletion UI. Change the phrase, the copy (mentions "OpenClaw channel rows"), restyle on tokens. |
| `app/privacy/page.tsx` | 152 | **ADAPT** | `LegalSection`/`LegalHeader` layout is fine; the text describes Creator Maya v0 (iMessage, TikTok context providers), dated May 2026. S1 requires naming ScrapeCreators, Google, Zernio and the models plus the unverified-ownership posture, so the prose is a rewrite. `tests/marketingCopy.test.ts` already exempts legal pages from the no-"AI" rule — carry that exemption. |
| `app/terms/page.tsx` | 134 | **ADAPT** | Same; "Creator Maya" scope section, iMessage. Keep the "AI Output can be wrong" disclosure. |
| `app/founder/page.tsx` | 544 | **REFERENCE** | Operator console S5 pattern: `/founder?token=` in the URL, **every Convex query fails closed on `ADMIN_DASH_TOKEN`**, route public at the Clerk layer because the token is the gate. Keep that gating shape; the panels (Fly machines, Reddit distribution, transcripts) are the old product. |
| `app/onboarding/gtm/page.tsx` | 1442 | **REFERENCE** | One 1,442-line client component holding a 40-field intake draft. The lesson is negative: S2 is seven screens with state kept across back/resume — build it as a route per screen with a server-owned `onboardingState` row, not a stage enum in `useState`. Keep the `track(ANALYTICS_EVENTS.*)` call sites as the shape of the funnel instrumentation. |
| `app/onboarding/gtm/__tests__/page.test.tsx` | 110 | **REFERENCE** | Test pattern: `renderToString` under vitest edge-runtime with `convex/react`, `@clerk/nextjs`, `next/link`, `@/lib/analytics` mocked, asserting the page is wired to the **right api ref** rather than to prose. Note the comment: `posthog-js` touches `document` at import, so the analytics wrapper must be mocked in every SSR test. |

## `app/clawlaunch/mission/` — Mission Control (founder dashboard)

Uniform verdict for the directory: **REFERENCE** for the reactive-query patterns only; nothing ports. Line count: 6,912 across 30 files (incl. 3 tracked ` 2.tsx` duplicates, which are DROP outright).

| path | lines | what to read it for |
|---|---|---|
| `layout.tsx` | 190 | Mobile floating bottom tab bar with `env(safe-area-inset-bottom)` + desktop side rail from one `NAV` array; `isActive` prefix matching. S4's five tabs are exactly this shell. `data-surface="mission"` attribute theming is the *wrong* way (see design tokens). |
| `_components.tsx` | 507 | The primitive set S4 needs, by name: `Shell`, `Section`, `Panel`, `Card`, `Pill`, `Chip`, `Btn`, `Sparkline` (pure SVG, 45 lines — worth lifting), `BigStat`, `Loading`, `Empty`, `NeedsOnboarding`, `timeAgo/clock/monoDate`, `SourceChip`, `LiveDot`, `Fold`. Rewrite on tokens; the API shapes are sound. |
| `_TodayLive.tsx` · `results/_ResultsLive.tsx` · `_ActivityLive.tsx` | 331 | The additive live-panel pattern: `useQuery(...)`, `if (!data?.ok) return null`, honest empty state as a sentence, `metricsAsOf` rendered under every number ("Numbers last checked 2 days ago"). The `!data` vs `=== undefined` null-crash note in `PlanScreen`/`LadderBlock` is real — `useQuery` can return `null`. |
| `page.tsx` (Today) | 539 | Mixed frozen (`gtmMaya.*`) and live (`maya.*`) reads on one screen — the dual-source mess the clean sheet exists to end. Do not replicate. |
| `house-rules/page.tsx` | 132 | Directives listed verbatim with date and one-tap revoke, per-row busy state, no add box — this is S4 Settings "house rules verbatim, dated, one-tap revoke" nearly as-is in intent. |
| `plan/PlanScreen.tsx` | 168 | Changelog including "nothing changed" entries; no edit control because steering is chat. |
| `settings/page.tsx` | 566 | Data export before delete ordering (export had no caller; deletion did — fix that ordering from day one); Stripe portal/cancel/resume via actions; `exportTruncated` surfaced not swallowed. |
| `account/_ConnectedAccounts.tsx` + test | 278 | `OFFERED` channel array pinned by a source-reading test (`connectedChannelsMatchSpec`) — the product-boundary-as-test idea carries; the list (TikTok/IG/YT) becomes TikTok/IG. |
| `account/_PostingControl.tsx` | 96 | Founder autonomy modes; not applicable (Maya doesn't post). |
| `account/_ProductBrain.tsx` | 311 | Editable ground-truth over a grounded read-only picture — the S4 Settings "what Maya knows about you / correct me" screen has the same two-layer shape. |
| `brain/`, `competition/`, `videos/`, `results/page.tsx`, `results/LadderBlock.tsx`, `_DraftCard.tsx`, `_PlanCard.tsx`, `connect-result/` | 2,101 | Founder-product screens. `competition` shows the Radix `Dialog` usage (only two callers in the repo). Rung ladder UI in `LadderBlock` is the closest cousin to S4 Results' rung. |
| `mission.css` | 1646 | A second, hardcoded dark palette that re-flips the light `[data-surface]` override with a doubled-attribute selector. DROP; it is the case study for why tokens go in one file. |
| `drafts/ queue/ research/ assets/ thinking/ activity/ page.tsx` | 71 | Six redirect stubs from IA churn. DROP. |
| `__tests__/render.test.tsx` (700) · `todayLive` · `activityLive` · `resultsLive` | 1,083 | The SSR smoke pattern: one hoisted `useQuery` mock keyed by api-ref name, two modes ("null" → every gated page renders `NeedsOnboarding`; "data" → fixtures). Good for S4's "every tab renders a designed empty state for a day-one creator" test. |

## `components/`, `lib/`, `hooks/`

| path | lines | verdict | reason / what changes |
|---|---|---|---|
| `components/analytics/PostHogProvider.tsx` | 98 | **PORT** | Guarded `posthog.init` (no-op without key), manual `$pageview` on App Router navigation inside `Suspense`, `identify(clerkUserId, {email,name})` and `reset()` on sign-out. Only change: `persistence: "localStorage+cookie"` → decide with the S1 cookie-banner rule (cookieless `localStorage` avoids the banner). |
| `lib/analytics.ts` | 49 | **ADAPT** | Keep the typed `track(event, props)` chokepoint with `posthog.__loaded` guard. Replace `ANALYTICS_EVENTS` with the §18 taxonomy (view, scroll depth, CTA click, the seven onboarding screens, tab views). |
| `components/billing/TierSelector.tsx` + test | 267 | **DROP** | Three founder tiers; new product has one price. |
| `lib/destroyMayaFlyApps.ts` | 58 | **DROP** | Fly per-customer machines are gone. |
| `hooks/` | — | — | Does not exist. |

## Design tokens / theme

| path | lines | verdict | reason / what changes |
|---|---|---|---|
| `app/globals.css` | 358 | **REFERENCE** | Read for: Tailwind v4 `@theme inline` bridging `--color-*` to runtime CSS vars (so utilities re-resolve when the vars change — the one good idea); `.input` mobile rules (48px min height, 16px font to stop iOS focus-zoom, autofill override); reduced-motion guards. Do NOT port the token model: there is **no light theme, no `prefers-color-scheme`, no `data-theme`** anywhere (0 hits in both stylesheets); "light" is faked per-surface by `[data-surface="mission"]`/`"onboarding"` overriding the same variables, and `mission.css` then re-overrides with a doubled selector. Names lie too (`--lime` is sky blue since 2026-07-10). New repo: semantic tokens on `:root` (dark default) + `[data-theme="light"]`, one file, S1's "no colour defined only inside a media block" test. Also 60 lines of `.cl-*` `!important` Clerk overrides — replace with Clerk `appearance.variables` bound to tokens. |
| `app/clawlaunch/mission/mission.css` | 1646 | **DROP** | See above. |
| `assets/fonts/Geist-*.ttf` | 2 files | **DROP** | Only served the resvg route; web fonts come from `next/font`. |

## `public/`

| path | size | verdict | reason / what changes |
|---|---|---|---|
| `public/demos/*.mp4, *.jpg` (6 files) | 6.6 MB | **DROP** | Founder landing hero videos. |
| `public/tiktok9iwZOtsyHO9kZG4DFCD2AMpXjKs4jtyO.txt` | 69 B | **DROP** | TikTok developer domain verification for the old app; a new domain/app gets a new token. Note the *mechanism* (static file + public route entry) if TikTok app review is ever pursued for the direct API. |
| `public/file.svg globe.svg next.svg vercel.svg window.svg` | — | **DROP** | create-next-app leftovers, zero callers. |
| (missing) `manifest.webmanifest`, icons, service worker | — | — | **S4 requires a PWA; nothing exists today.** Net-new. |

## `scripts/`

| path | lines | verdict | reason / what changes |
|---|---|---|---|
| `scripts/convex-deploy-prod.sh` | 38 | **PORT → extend** | The guard: refuses unless branch is `main` and tree is clean, then `exec npx convex deploy`. §20.3 adds three things: `main` up to date with origin, print the target deployment name and require typing it back, and a `preconvex` / npm pre-script that makes bare `npx convex deploy` exit non-zero. Wire as `deploy:prod`; `deploy:staging` becomes the `CONVEX_DEPLOYMENT=… convex dev --once` one-liner or a `--deployment` flag against the staging project. |
| `scripts/convex-deploy-prod 2.sh`, ` 3.sh` | 76 | **DROP** | Byte-identical iCloud duplicates, tracked in git. |
| `scripts/sync-env-to-convex.sh` | 67 | **PORT** | Pushes `.env.local` keys to a Convex deployment, skipping `CONVEX_*`/`NEXT_PUBLIC_*`, with `--deployment` and `--env-file` flags. Exactly the §20.2 "secrets live in each Convex deployment" workflow. |
| `scripts/dev_tunnel.sh` | 73 | **REFERENCE** | ngrok for testing OAuth callbacks from a phone; the redirect-URI checklist is the useful part. Rewrite the env-var names. |
| `scripts/gtm-sprint-gate.ts` | 335 | **REFERENCE** | "One growing E2E, one section per sprint, `--mock`/`--live --confirm` modes, exit 0/1/2" is the shape §17.2's standing suite and the scheduled live smoke want. Content is all founder sprints. |
| `scripts/scan-workspace-coherence.ts` | 255 | **REFERENCE** | The sibling-file coherence category (mandatory five #4) as a script with a severity list. The new equivalent is the chat-completeness registry check. |
| `scripts/stripe/createServiceProducts.ts` | 399 | **REFERENCE** | Idempotent Stripe product/price seeder using `lookup_key` + metadata to detect existing rows, writing a JSON of price ids. Rewrite for one product, two prices, founding coupon. Note the `package.json` script points at a non-existent `createCreatorProducts.ts`. |
| `scripts/stripe/stripe-creator-products*.json` | 44 | **DROP** | Old price ids (coach/manager), test and live. |
| `scripts/gtm-sprint-*-smoke.ts` (20 files), `gtm-readiness-smoke.ts`, `gtm-capability-smoke.ts`, `gtm-openclaw-fly-smoke.ts` + its test, `cron-smoke.ts`, `cron-fly-smoke.ts`, `cron-smoke-results.txt`, `gtm-sprint1-smoke.ts`, `gtm-sprint-1-smoke.ts` | ≈8,000 | **DROP** | Founder-product / OpenClaw / Fly smokes. |
| `scripts/sync-bundled-*.ts`, `sync-maya-skills.ts`, `sync-maya-plugin.ts` | 633 | **DROP** | Inline skills/plugins into TS for Fly machines; no machines. |
| `scripts/maya-telegram-creator-demo.ts` | 418 | **REFERENCE** | Sends model output to the operator's Telegram via a test bot, `--dry-run` flag. Handy for S3 message-type review before the runtime exists. |
| `scripts/calendar_crud_smoke.sh`, `lc_maya_smoke.sh` | 305 | **DROP** | Sweep deleted `lc_maya` HTTP endpoints. |
| `scripts/creatify-test.ts` | 177 | **DROP** | Creatify is out of the stack. |
| `scripts/fixtures/serviceBusinesses/**`, `fixtures/qbo/`, `fixtures/serviceJobsNer/` | 2,890 | **DROP** | Deleted trades product; only self-referenced. |
| `scripts/fixtures/mvp-smoke/*.json` | 102 | **REFERENCE** | Recorded ScrapeCreators `tiktok-profile` / pull responses as mock-mode fixtures; the *practice* (record real vendor payloads, replay in tests) is §17's golden-set idea. Payload shapes may be stale. |

---

## Scar tissue found in this scope

- `middleware.ts:96-119` — Clerk `auth.protect()` answers an unauthenticated API request with **404, not 401**; an unlisted machine route is indistinguishable from an undeployed one. `/api/billing/stripe-webhook` was never in the public list in any commit; the first real `checkout.session.completed` would have 404'd, Stripe would have retried for three days, and the customer would have paid and stayed unactivated. Fixed by the exported route arrays + `tests/middlewarePublicRoutes.test.ts`, which also asserts every `app/api/**/route.ts` is classified. §19.3 makes reachability a named test — port that test.
- `scripts/convex-deploy-prod.sh:5-13` — bare `npx convex deploy` ignores `CONVEX_DEPLOYMENT` and targets prod; on 2026-08-11, 27 staging commits reached prod's backend while prod Vercel served `main`. The doc said so; nothing enforced it. §20.3's block-the-bare-command pre-script is the missing half.
- `app/api/billing/stripe-webhook/route.ts:25-35` and `convex/lib/webhookSecret.ts` — `WEBHOOK_INTERNAL_SECRET` must be set identically in Vercel env AND Convex env; `ConvexHttpClient` can't call `internal.*`, so every webhook goes through a public wrapper gated by this shared secret. Missing it fails closed but silently (200 + `errored` audit row).
- `app/api/render/slide/route.ts:162`, `convex/maya/carousel.ts:636-697` — `RENDER_SHARED_SECRET` had to be set on Vercel by the operator; until it was, Convex→Next calls 401'd. Route is dropped, but the general rule stands: any Convex→Vercel call needs its secret in **both** places, per environment.
- `next.config.ts:1-34` + `app/api/render/slide/__tests__/fonts.test.ts` — resvg renders **blank** (HTTP 200, valid PNG) with no fonts; Next output file tracing can't see runtime-built paths; Turbopack statically analyses `require.resolve`. Three production-only failures that passed every test.
- `CLAUDE.md` "Gotcha" — stale `.next` cache produces phantom `tsc` errors after deleting routes (`rm -rf .next`). Note `.next-stale-1777697400/` still sits in the repo root, and `tsconfig.json` includes `.next/types/**` and `.next/dev/types/**`, which is why.
- `app/sign-in/[[...sign-in]]/page.tsx:22-27` — a first-time "Sign in with Google" user goes through Clerk's sign-UP transfer; without `signUpFallbackRedirectUrl` they landed on a dashboard that said "No agent yet".
- `app/connect/page.tsx:26-46` — OAuth full-tab redirect returns to `APP_URL`, which on a Vercel preview is a different hostname → Clerk-protected page with no session → sign-in. Popup + opener-refetch on close/focus fixes it. Applies to Zernio and Google Calendar in the new repo.
- `app/start/page.tsx:33-38` — `mc-*` classes lived in a CSS file imported only by the Mission layout; a route outside it rendered the primary button as unstyled text. One global stylesheet.
- `app/onboarding/gtm/__tests__/page.test.tsx:19-25` — `posthog-js` touches `document` at module import; every SSR/edge-runtime test must mock `@/lib/analytics`.
- `app/clawlaunch/mission/plan/PlanScreen.tsx:38-46`, `results/LadderBlock.tsx:32-33` — `useQuery` returns `null` as well as `undefined`; `if (data === undefined)` crashed the screen. Guard with `!data`.
- `tests/landingPageIntegrity.test.ts:24-36` — a backtick inside a `<style>{\`…\`}</style>` template literal ends the string; broke the build twice from a CSS comment. Don't inline CSS in JSX.
- `.gitignore:60-84` and five tracked `" 2."`/`" 3."` files — iCloud/Dropbox sync-conflict copies get committed by `git add -A`; invisible to Convex and vitest, so nothing fails. The ignore block exists; the duplicates still slipped in before it. Add a CI step that fails on `git ls-files | grep ' [0-9]\.'`.
- `app/clawlaunch/mission/_TodayLive.tsx:8-28` — "zero-caller machinery": `maya.dashboard.myDashboard` computed on every refresh with no reader while the dashboard showed a frozen product's empty tables. The new repo's chat-completeness registry is the structural answer; grep callers before trusting anything.
- `app/globals.css:60-72` + `mission.css:16-40` — two theme systems fighting via specificity, `--lime` meaning blue, no light theme anywhere. Both-themes test (S1) exists precisely because this happened.
- `package.json:47` — `stripe:create-creator-products` points at `scripts/stripe/createCreatorProducts.ts`, which does not exist. Dead npm script; no test catches a broken script entry.
- `docs/DEPLOYMENT_ENVIRONMENTS.md` — staging Convex is a long-lived **dev** deployment (`dev:precise-canary-781`) inside the prod project, not a separate project; §20.2 fixes this with a dedicated staging project + deploy key. Vercel branch-scoped env vars carry three `NEXT_PUBLIC_CONVEX_*` names for one value (`_URL`, `_SITE_URL`, `_HTTP_URL`) — collapse to two in the new repo (`.cloud` for the client, `.site` for HTTP actions).

## Dependencies for the new repo

**Keep** (all present, all with real callers in the salvaged files):
- `next` 16.x, `react` 19.x, `react-dom` 19.x
- `@clerk/nextjs` ^7 (providers, middleware, `auth()`, `clerkClient`)
- `convex` ^1.36 (`ConvexReactClient`, `ConvexProviderWithAuth`, `ConvexHttpClient`)
- `stripe` ^22 (webhook `constructEvent`, checkout, portal)
- `svix` (Clerk webhook verification)
- `posthog-js` (browser; server side is a plain `fetch` in `convex/lib/posthog.ts` — no `posthog-node` needed)
- `zod` ^4 (vendor schema validation — 161 callers today, all Convex-side)
- `qrcode` + `@types/qrcode` (S2 desktop pairing QR, rendered client-side for token privacy)
- `lucide-react` (icons; the only icon lib that should remain)
- `@radix-ui/react-dialog` — keep **only if** shadcn/ui is actually installed this time (the plan and CLAUDE.md both say shadcn; the repo never had `components.json`). If shadcn: install it properly and let it pull its own Radix deps; do not hand-add.
- dev: `typescript` ^5, `eslint` ^9, `eslint-config-next`, `tailwindcss` ^4, `@tailwindcss/postcss`, `vitest`, `@edge-runtime/vm` (vitest env for `convex-test`), `convex-test`, `tsx` (scripts), `@types/node`, `@types/react`, `@types/react-dom`

**Drop** (zero callers in salvaged scope, or belong to deleted subsystems):
- `@emotion-machine/claw-messenger` — OpenClaw Telegram plugin, zero importers in the repo
- `@resvg/resvg-wasm` — render route
- `google-play-scraper` — app-store inspection for founders (`convex/integrations/appStore`)
- `openai` — zero importers anywhere
- `posthog-node` — zero importers (Convex isolate can't run it; fetch is used instead)
- `react-icons` — one caller, the founder landing (`SiTiktok` etc.); lucide covers it
- `tsdav` — Apple Calendar CalDAV, zero importers; §12.5 says post-pilot, re-add then
- `ws` + `@types/ws` — zero importers
- `lightningcss-darwin-x64` optionalDependency — machine-specific pin, let Tailwind resolve it
- `google-play-scraper`, and anything Fly/Creatify/twitterapi/Composio-related that other salvage parts may find in `convex/`

---

# Part 4 — tests, harness, and the numbered scar-tissue list

# Salvage manifest — part 4: test harness and scar tissue

Scope: 291 test files (3,767 `it(`/`test(` sites) outside `node_modules` and `.claude/worktrees`, plus `vitest.config.ts`, `tests/`, and the convex-test helpers. Judged by imports and `describe()` titles, per the Sprint 0 verdict table in `docs/CREATOR_SPRINT_PLAN.md` §6.

Verdict rule of thumb: a test travels with its module's verdict, **except** where the file is a harness piece or a static-analysis pattern worth keeping regardless of the module it currently reads. Those are PORT or REFERENCE even when the module is DROP.

## A. Harness pieces (not test files)

| path | tests | verdict | module it covers | reason |
|---|---|---|---|---|
| `vitest.config.ts` | – | PORT | harness | edge-runtime env + `convex-test` inlined + `@` alias. Trim the `include` globs to the new tree. |
| `tests/_modules.ts` | – | PORT | harness | The convex-test module-glob helper §17.4 names explicitly. The header comment (why it must live outside `convex/`, why one fixed location) is the load-bearing part. |
| `tests/lib/minimalRow.ts` | – | PORT | harness | Fixture loader: minimal valid row per table. Rewrite the rows for the ≤17-table schema, keep the shape. |
| `tests/lib/mayaVoiceValidator.ts` | – | ADAPT | voice | Banned-terms / structure checks on generated prose. Keep the checker, re-seed the lists for creator copy. |
| `tests/fixtures/mayaVoiceFixture.ts` | – | ADAPT | voice | Corpus fixture; shape test lives in `tests/mayaVoiceFixture.test.ts`. Re-record with creator samples. |
| `convex/integrations/scrapeCreators/__tests__/fixtures/{tiktok,instagram}.ts` | – | PORT | scrapeCreators | Real vendor shapes, params verified live 2026-07-31. These are the seed of the §17.4 vendor recorder. |
| `convex/integrations/scrapeCreators/__tests__/fixtures/{x,linkedin,youtube}.ts` | – | DROP | scrapeCreators | Channels the creator product does not read. |
| `convex/smokeFixtures/cronHeartbeat.ts` | – | DROP | crons (old) | Heartbeat table belongs to the deleted products. |
| `scripts/fixtures/**` (mvp-smoke, qbo, serviceBusinesses, serviceJobsNer) | – | DROP | service product | Orphans of the deleted service-business product. |
| `tests/houseRules.test 2.ts`, `scripts/convex-deploy-prod 2.sh`, `... 3.sh` | – | DROP | – | Finder duplicates sitting in the tree (untracked-looking `" 2"` suffixes). Delete on the legacy branch too. |

**Harness pieces §17.4 asks for that do NOT exist today** — build, don't port: a vendor recorder/replayer keyed by `read()` params (fixtures are hand-written today) · a shared fake Telegram (every test mocks `fetch` inline) · a fake clock helper (tests call `vi.useFakeTimers` ad hoc; two CI flakes came from that — `d632949`, `2cf8f47`) · a cost-ledger assertion helper (assertions are inline in `cogs.test.ts` / `spendCeiling.test.ts`) · the simulate-a-day runner (`dayInTheLife.test.ts` is the closest seed) · a global "no unmocked network" guard (scar #22).

## B. Test files

### PORT (33 files, 392 tests)

| path | tests | verdict | module it covers | reason |
|---|---|---|---|---|
| `convex/__tests__/webhookSecurityWrappers.test.ts` | 8 | PORT | `lib/webhookSecret` | Shared-secret gate for every server-to-server route; travels with the Telegram router and Stripe webhook. |
| `convex/billing/__tests__/paymentFailed.test.ts` | 8 | PORT | Stripe webhook route | Static: reads the route source and asserts it handles `invoice.payment_failed` at all. §19.3 lists that event. |
| `convex/integrations/gemini/__tests__/groundedSearch.test.ts` | 19 | PORT | `integrations/gemini` | Named PORT in the spec; missing-key / grounding-shape tests. |
| `convex/integrations/scrapeCreators/__tests__/client.test.ts` | 12 | PORT | `scrapeCreators/client` | Named PORT. Client wrapper, retries, key handling. |
| `convex/integrations/telegram/__tests__/botIdentityResolution.test.ts` | 4 | PORT | `integrations/telegram` | Static: "NO PRODUCTION CALL SITE BLINDS THE RESOLVER" — reads call sites from source. Pattern and module both port. |
| `convex/lib/__tests__/posthog.test.ts` | 4 | PORT | `lib/posthog` | Telemetry events §18 emit from mutations; wrapper is vendor-neutral. |
| `convex/maya/__tests__/benchmarks.test.ts` | 10 | PORT | `maya/benchmarks` | Named PORT. Median / quality math. |
| `convex/maya/__tests__/breaker.test.ts` | 7 | PORT | `maya/breaker` | Named PORT. "IT FAILS OPEN, AND THAT IS THE POINT." |
| `convex/maya/__tests__/cogs.test.ts` | 13 | PORT | `maya/cogs` | Named PORT. "THE CEILING NEVER SILENCES HER." |
| `convex/maya/__tests__/founderDay.test.ts` | 14 | PORT | `maya/cadence` (static) | Static: no module derives a day from UTC / ISO / `86_400_000`. Scar #5 guard; the cadence *logic* is REFERENCE but this guard ports. |
| `convex/maya/__tests__/harnessBoundary.test.ts` | 10 | PORT | scheduler / jobs (static) | Named PORT. Allow-list of Convex crons + "EVERY JOB KIND ENQUEUED HAS A HANDLER." Drop the OpenClaw half, keep the handler-coverage half. |
| `convex/maya/__tests__/jobs.test.ts` | 24 | PORT | `maya/jobs` | Named PORT. Idempotent enqueue, exclusive claim, dead state. |
| `convex/maya/__tests__/ladder.test.ts` | 9 | PORT | `maya/ladder` | Named PORT (L0–L2). |
| `convex/maya/__tests__/llmBudget.test.ts` | 7 | PORT | `maya/llm` | `budgetFor` — scar #10 guard (thinking billed to `max_tokens`). |
| `convex/maya/__tests__/messages.test.ts` | 25 | PORT | `maya/messages` | Named PORT. "INVARIANT 6 — every outbound message has a dedupe key." |
| `convex/maya/__tests__/modelSwap.test.ts` | 8 | PORT | enforcement path | Sprint 0 named test: "the enforcement path is not bound to a model." Re-point at the model registry. |
| `convex/maya/__tests__/pairing.test.ts` | 9 | PORT | `maya/pairing` | Named PORT. |
| `convex/maya/__tests__/plainLanguage.test.ts` | 30 | PORT | `maya/plainLanguage` | Named PORT. "HER REAL MESSAGES PASS UNTOUCHED" — asserts on structure, not prose. Scar #1. |
| `convex/maya/__tests__/preSpendGate.test.ts` | 16 | PORT | `maya/preSpendGate` | Named PORT. |
| `convex/maya/__tests__/spendCeiling.test.ts` | 26 | PORT | `maya/spendCeiling` | Named PORT. "CAPS THROTTLE, THEY NEVER DESTROY." Scar #19/#20. |
| `convex/maya/__tests__/telegram.test.ts` | 15 | PORT | `maya/telegram` | Named PORT. "WRITTEN IS NOT DELIVERED." |
| `convex/maya/__tests__/typing.test.ts` | 14 | PORT | `maya/telegram` (chat action) | Travels with telegram.ts. |
| `convex/vendorSmoke/__tests__/{drift,execute,registry,report,runner}.test.ts` | 16+13+13+13+7 | PORT | `vendorSmoke/*` | Sprint 0 exit criterion needs the live smoke suite writing `vendorHealth`; `drift.test` (zod drift detection) and `registry.test` (static: every check registered) are the reusable core. Trim the registry to TikTok/IG/Gemini/Zernio-read/Stripe. |
| `tests/accountDeletionCoverage.test.ts` | 7 | PORT | `accountDeletion` (static) | Derives "every customer-scoped table" from `schema.ts` and asserts the purge names each. Cross-tenant mandatory category; scar #30. |
| `tests/cogsRealBill.test.ts` | 9 | PORT | `maya/cogs` + `preSpendGate` | "prefers the vendor's figure over our own bookkeeping"; "the gate reports what it could not check." Scar #7. |
| `tests/middlewarePublicRoutes.test.ts` | 4 | PORT | `middleware.ts` | Scar #3 guard: every server-to-server route is public and exists; every API route is classified. |
| `tests/noDynamicImportInQueries.test.ts` | 3 | PORT | Convex functions (static) | Convex-runtime constraint that will bite the new repo identically. |
| `tests/sweepCoverage.test.ts` | 8 | PORT | `maya/watchers` (static) | The handler-coverage pattern the spec names: "every daily sweep has a function… every WEEKLY sweep… no handler for a sweep nobody schedules." Re-point at the new sweep table. Scar #2. |
| `tests/vendorSchemaStrictness.test.ts` | 7 | PORT | integrations (static + runtime) | "vendor responses fail loudly, not emptily"; "throws instead of reporting zero accounts." Scar #17/#28. |

### ADAPT (45 files, 775 tests)

| path | tests | verdict | module it covers | reason |
|---|---|---|---|---|
| `convex/__tests__/accountDeletion.test.ts` | 5 | ADAPT | `accountDeletion` | Deletion endpoint is built in S1 (Instagram App Review needs it). Table list changes. |
| `convex/__tests__/billing.test.ts` | 28 | ADAPT | Stripe checkout | 7-day trial, card required, one tier — rewrite the matrix, keep the session-shape assertions. |
| `convex/integrations/google/__tests__/calendar.test.ts` | 20 | ADAPT | google calendar | §17.4 wants a fake calendar with push; the wrapper tests are the starting point. |
| `convex/integrations/scrapeCreators/__tests__/endpoints.test.ts` | 49 | ADAPT | `scrapeCreators/platforms/*` | Keep tiktok/instagram cases (params VERIFIED LIVE 2026-07-31); drop x/linkedin/youtube cases. |
| `convex/integrations/telegram/__tests__/sendDirectMessage.test.ts` | 15 | ADAPT | `integrations/telegram` | Wrapper ports; `buildDeployTimeHelloText` is Fly-era and goes. |
| `convex/integrations/zernio/__tests__/client.test.ts` | 20 | ADAPT | `integrations/zernio` (read half) | Client/auth/retry port; publish surface dropped. |
| `convex/integrations/zernio/__tests__/endpoints.test.ts` | 25 | ADAPT | `integrations/zernio` (read half) | Keep profile/account/analytics reads; drop GBP and publish. |
| `convex/maya/__tests__/competitors.test.ts` | 7 | ADAPT | `maya/competitors` | "WHAT EARNS A MESSAGE" → tracked accounts. |
| `convex/maya/__tests__/cringeEval.test.ts` | 27 | ADAPT | `maya/cringeEval` | "THE EVAL MUST BE ABLE TO FAIL" — keep the control/mutant structure, re-seed for creator voice. |
| `convex/maya/__tests__/dataExportReachable.test.ts` | 4 | ADAPT | data export route (static) | Route paths change; the "a founder can actually get their data out" static check stays. |
| `convex/maya/__tests__/directiveGate.test.ts` | 7 | ADAPT | `maya/directiveGate` | "A VIOLATION MUST QUOTE THE RULE IT BREAKS." |
| `convex/maya/__tests__/directives.test.ts` | 18 | ADAPT | `maya/directives` | "INVARIANT 3 — a directive is never mutated." |
| `convex/maya/__tests__/embeddings.test.ts` | 13 | ADAPT | `maya/embeddings` | Cosine/similarity helpers, generic; imported with buyerMap. |
| `convex/maya/__tests__/firstRun.test.ts` | 18 | ADAPT | `maya/firstRun` | "SHE INTRODUCES HERSELF EXACTLY ONCE." |
| `convex/maya/__tests__/formats.test.ts` | 37 | ADAPT | `maya/formats` | Watch pipeline; `depth` field; niche fingerprint → creator keys. |
| `convex/maya/__tests__/ideas.test.ts` | 35 | ADAPT | `maya/ideas` | Idea bank; north star is `ideas.postedAt`. "NO EVIDENCE IS NOT A LOW SCORE." |
| `convex/maya/__tests__/learnBusiness.test.ts` | 29 | ADAPT | `maya/learnBusiness` | "A CATEGORY IS NOT A NICHE" — keyword validation against live yield → admired list. |
| `convex/maya/__tests__/liveness.test.ts` | 54 | ADAPT | `maya/liveness` | Founder-timezone hours; the new runtime has no Fly machine but the day-shape checks stay. |
| `convex/maya/__tests__/metrics.test.ts` | 18 | ADAPT | `maya/metrics` | "THE ID COMES FROM THE URL WE ALREADY HAVE" — own metrics via Zernio read. |
| `convex/maya/__tests__/onramp.test.ts` | 9 | ADAPT | `maya/onramp` | Named ADAPT. |
| `convex/maya/__tests__/planFeatures.test.ts` | 29 | ADAPT | `maya/planFeatures` | "budgets, never booleans" — one tier, still budgets. |
| `convex/maya/__tests__/platformAlgo.test.ts` | 7 | ADAPT | `PLATFORM_ALGO/*.md` (static) | Asserts platform expertise is markdown in the repo, not branches. Paths change. |
| `convex/maya/__tests__/quality.test.ts` | 25 | ADAPT | `maya/quality` | Sweep quality control; travels with scroll. |
| `convex/maya/__tests__/relevance.test.ts` | 12 | ADAPT | `maya/relevance` | Screen prompt for scroll results (#319). |
| `convex/maya/__tests__/scroll.test.ts` | 31 | ADAPT | `maya/scroll` | "RE-RUNNING A SWEEP DUPLICATES NOTHING"; velocity + in/out-of-niche split. |
| `convex/maya/__tests__/sweepMapIsSingular.test.ts` | 3 | ADAPT | `maya/watchers` (static) | Sibling-file coherence: one sweep map, not two. Scar #9. |
| `convex/maya/__tests__/telegramFiles.test.ts` | 16 | ADAPT | `maya/telegramFiles` | Creators send clips; file extraction from Telegram stays. |
| `convex/maya/__tests__/tells.test.ts` | 9 | ADAPT | `maya/tells` | "refuses to speak at small n." |
| `convex/maya/__tests__/trends.test.ts` | 21 | ADAPT | `maya/trends` | "TRENDING IS NOT THE SAME AS RELEVANT." |
| `convex/maya/__tests__/voice.test.ts` | 30 | ADAPT | `maya/voice` | `diffSignals` — what one edit tells us. |
| `convex/maya/__tests__/voiceCorpus.test.ts` | 25 | ADAPT | `maya/voiceCorpus` | "AN INSTRUCTION IS NOT A VOICE SAMPLE." |
| `convex/maya/__tests__/watchers.test.ts` | 18 | ADAPT | `maya/watchers` | "JITTER IS DERIVED, NEVER RANDOM." |
| `convex/maya/__tests__/weeklyReport.test.ts` | 14 | ADAPT | weekly review | "a zero week" honesty → the day-7 review. |
| `tests/accountDeletionPurge.test.ts` | 1 | ADAPT | `accountDeletion` | End-to-end purge on the new tables. |
| `tests/behaviourEval.test.ts` | 5 | ADAPT | `maya/behaviourEval` | Rules handed to the LLM judge. |
| `tests/dataExportRedaction.test.ts` | 6 | ADAPT | `maya/dataExport` | Redaction set changes with the schema. |
| `tests/dataExportRun.test.ts` | 2 | ADAPT | `maya/dataExport` | |
| `tests/deliveryUnreachable.test.ts` | 6 | ADAPT | delivery failures | "fleet-wide unreachable customers" → creators; feeds the fake-Telegram delivery-failure cases. |
| `tests/lib/__tests__/mayaVoiceValidator.test.ts` | 41 | ADAPT | `tests/lib/mayaVoiceValidator` | Banned-terms and structure checks; re-seed. |
| `tests/marketingCopy.test.ts` | 5 | ADAPT | marketing copy (static) | §17 CI "copy grep"; rules move from §18.13.4 to the creator copy rules. |
| `tests/mayaVoiceFixture.test.ts` | 11 | ADAPT | voice fixture | Corpus-shape test for the fixture loader. |
| `tests/onramp.test.ts` | 8 | ADAPT | `maya/onramp` | |
| `tests/voiceEvalWired.test.ts` | 3 | ADAPT | `maya/watchers` | "the voice eval is actually run and kept" — a zero-caller guard for the eval. |
| `tests/workerModel.test.ts` | 5 | ADAPT | model registry | "the worker model is not a reasoning model" — re-point at the §4 registry. Scar #10 sibling. |
| `tests/zernioProfileScoping.test.ts` | 4 | ADAPT | `integrations/zernio` (read half) | "fails CLOSED — no profile means no channels"; "two customers never share a profile id." Scar #16. |

### REFERENCE (24 files, 448 tests)

| path | tests | verdict | module it covers | reason |
|---|---|---|---|---|
| `app/api/render/slide/__tests__/fonts.test.ts` | 3 | REFERENCE | render (dropped) | Asserts font bytes and LFS-pointer-not-file — the only guard for "resvg renders blank." Pattern: assert generated assets by content. Scar #18. |
| `convex/agents/packs/maya/__tests__/configRootKeys.test.ts` | 23 | REFERENCE | OpenClaw config (dropped) | "EVERY ROOT KEY IS ONE OPENCLAW ACCEPTS" — structural key-path diff against the vendor's accepted set. Reuse for any generated vendor config. |
| `convex/agents/packs/maya/__tests__/generators.test.ts` | 63 | REFERENCE | OpenClaw workspace (dropped) | "THE PROMPT BUDGET IS MEASURED, NOT HOPED FOR" — size caps that fail silently at the vendor get a byte-count test. |
| `convex/gtmMaya/__tests__/outboundFirewall.test.ts` | 24 | REFERENCE | `gtmMaya/outboundFirewall` (dropped) | Drift-is-not-a-leak; sanitize-and-send for private DMs. Scar #4. |
| `convex/gtmMaya/__tests__/sendUpdateCriticGate.test.ts` | 7 | REFERENCE | gtmMaya (dropped) | "operator DMs never blackhole." Scar #4. |
| `convex/gtmMaya/__tests__/costCap.test.ts` | 13 | REFERENCE | `gtmMaya/costCap` (dropped) | Kill-switch as a pure evaluator over a ledger — and the file comments record why watch spend was invisible to it. Scar #7. |
| `convex/gtmMaya/__tests__/spendKill.test.ts` | 16 | REFERENCE | `gtmMaya/spendKill` (dropped) | Foundation-grace ceiling: throttle vs destroy, born of the 2026-07-06 four-dead-agents incident. Scar #20. |
| `convex/gtmMaya/__tests__/zernioConnect.test.ts` | 13 | REFERENCE | `gtmMaya/zernioConnect` (dropped) | State token single-use, bound to the issuing tenant, expiry, provider mismatch. Re-implement for the read-half connect flow. Scar #16. |
| `convex/gtmMaya/__tests__/zernioWebhook.test.ts` | 7 | REFERENCE | `gtmMaya/zernioWebhook` (dropped) | `extractProfileId` from the callback — the mangled-token lesson. Scar #16. |
| `convex/maya/__tests__/activityFeed.test.ts` | 8 | REFERENCE | `maya/activityFeed` (dropped) | "WORK IS READ FROM SPEND, WHICH CANNOT BE PADDED" — the S5 console reads rows the model cannot pad. |
| `convex/maya/__tests__/audience.test.ts` | 7 | REFERENCE | `maya/audience` | "what it refuses to do" — buyerMap's audience half, measured not to work (#288). |
| `convex/maya/__tests__/buyerMap.test.ts` | 36 | REFERENCE | `maya/buyerMap` | Named REFERENCE. Audience-overlap math may inform tracked-account overlap. |
| `convex/maya/__tests__/cadence.test.ts` | 16 | REFERENCE | `maya/cadence` | Named REFERENCE: seven-day streak counted in the founder's timezone. |
| `convex/maya/__tests__/channels.test.ts` | 20 | REFERENCE | `maya/channels` (dropped) | "CONNECTED IS NOT THE SAME AS CAN-POST" — connection health is a successful read, recorded. Scar #23. |
| `convex/maya/__tests__/checkpoint.test.ts` | 15 | REFERENCE | `maya/checkpoint` (dropped) | Memory-shrink watch after MEMORY.md was overwritten; new memory is rows. Scar #8. |
| `convex/maya/__tests__/complaints.test.ts` | 24 | REFERENCE | `maya/complaints` | Named REFERENCE. |
| `convex/maya/__tests__/dailyReport.test.ts` | 26 | REFERENCE | `maya/dailyReport` | "SEND-FIRST — the brief goes out before any work"; honest about zero days. Informs the daily message. |
| `convex/maya/__tests__/dataModelInvariants.test.ts` | 14 | REFERENCE | `schema.ts` (static) | Invariants derived from the schema ("a placement has a live URL or an explicit unknown"). Write the same shape for the ≤17 tables. |
| `convex/maya/__tests__/dayInTheLife.test.ts` | 4 | REFERENCE | every module | "a full day, walked through every module" — seed for the §17.4 simulate-a-day runner. |
| `convex/maya/__tests__/fleetScale.test.ts` | 4 | REFERENCE | `maya/liveness` | "the liveness sweep at 200 customers" — Convex action-limit guard. Scar #24. |
| `convex/maya/__tests__/hooks.test.ts` | 39 | REFERENCE | `maya/hooks` (dropped) | "THE AGENT CANNOT NAME A TENANT" — the cross-tenant isolation template for every model-facing tool. |
| `convex/maya/__tests__/inbox.test.ts` | 19 | REFERENCE | `maya/inbox` (dropped) | "NOBODY GETS ANSWERED TWICE"; the `accountsQueried: 0` case. Scar #17. |
| `convex/maya/__tests__/publishDecision.test.ts` | 27 | REFERENCE | `maya/publishDecision` (dropped) | "THE IRON RULE — the closed set of reasons" — the exactly-one-decider pattern, for whatever the creator product's single gate is (send / hold an idea). |
| `tests/sprint1Acceptance.test.ts` | 20 | REFERENCE | plan-tier × action matrix | The budget × action fail-closed mandatory-category template; the tiers themselves are gone. |

### DROP (189 files, 2,152 tests)

Everything not listed above. By directory:

| path (group) | files | tests | verdict | module it covers | reason |
|---|---|---|---|---|---|
| `convex/gtmMaya/__tests__/*` (all not listed as REFERENCE) | 102 | ~950 | DROP | `gtmMaya/*` | The frozen business product. Reddit/X intent hunting, calendars, confirm chains, channel scoring, experiments, attribution, media, publish. |
| `convex/gtmMaya/openclaw/__tests__/*` | 5 | 45 | DROP | OpenClaw bridge | Hook bridge, conversation capture, llmGateway metering. |
| `convex/agents/packs/maya_gtm/__tests__/*` | 5 | 73 | DROP | OpenClaw GTM pack | |
| `convex/agents/packs/maya/__tests__/bundledPlugin.test.ts` | 1 | 11 | DROP | OpenClaw plugin | |
| `convex/agents/modelRouter/__tests__/*` | 3 | 26 | DROP | old model router | Replaced by `maya/llm.ts` + §4 registry. |
| `convex/maya/__tests__/{adIntel,archive,assetAsk,assetClassifier,assetFloor,attribution,brandKit,carousel,crosspost,dashboard,dayPlan,demo,deploy,drafts,experiments,handoff,imagery,media,plugin,preflight,productTruth,publish,scheduler,skills,slides,strategy,tiktokConsent,traceability,video,videoBrief,widerWorld}.test.ts` | 31 | ~700 | DROP | dropped maya modules | Publish, video, carousels, media, Fly deploy, OpenClaw skills/plugin, attribution, drafts, ad intel, X preflight. `deploy.test.ts` (46) carries the always-on scar but the runtime is gone. |
| `convex/integrations/{appStore,composio,creatify,hackerNews,r2,twitterApiIo,videoSynthWorker}/__tests__/*` | 12 | 155 | DROP | dropped integrations | |
| `convex/integrations/google/__tests__/gmail.test.ts` | 1 | 15 | DROP | gmail | |
| `convex/integrations/scrapeCreators/__tests__/agentSkillManifest.test.ts` | 1 | 6 | DROP | OpenClaw skill manifest | |
| `convex/integrations/zernio/__tests__/contract.test.ts` | 1 | 36 | DROP | Zernio publish | `multiPlatformPost` body contract; publish half is dropped. |
| `convex/lib/__tests__/{flyClientVolume,planFeatures,usageEvents}.test.ts` | 3 | 51 | DROP | Fly, coach/manager tiers, creator-usage analytics | Deleted products. |
| `convex/{founder,billing,queries/admin,onboarding/gtm}/__tests__/*`, `convex/__tests__/admin.test.ts` | 7 | 64 | DROP | founder console, gtm billing, comp accounts | S5 console is rewritten from rows; `fleetHealth`'s fail-closed token gate is worth a glance. |
| `app/**/__tests__/*` except `render/slide/fonts` | 9 | 52 | DROP | landing, mission control, onboarding, slide route | Founder landing and dashboard are dropped; S1 rebuilds. |
| `components/billing/__tests__/TierSelector.test.tsx` | 1 | 5 | DROP | 3-tier selector | One tier. |
| `scripts/__tests__/gtm-openclaw-fly-smoke.test.ts`, `services/video-synth-worker/__tests__/server.test.ts` | 2 | 25 | DROP | Fly smoke, synth worker | |
| `tests/{bioLinkRung1,channelRequirements,dayPlanPromise,houseRules,landingPageIntegrity,linkTrackingChain,pixelRung2,selfReportRung4}.test.ts` | 8 | 60 | DROP | attribution rungs, channels, day plan, house rules, landing | |

## Scar-tissue list

Each item becomes a test or a guard in the new repo **before the module that could repeat it lands** (Sprint 0 named test: "one guard or test per scar-tissue item, listed by number").

| # | incident (one sentence, date if findable) | guard today (file:line or "no guard") | guard the new repo needs |
|---|---|---|---|
| 1 | The plain-language leak guard could silently stop guarding — a guard that swallows its own failure hides which message it missed (2026-08-24, `151e9c7`). | `convex/maya/plainLanguage.ts:25,216`; `convex/maya/__tests__/plainLanguage.test.ts` (30) | Static test that every outbound path calls the guard (call-site grep from source) + a canary: a known leak string must be caught on every path, and a guard exception is itself a named delivery failure, never a pass. |
| 2 | Zero-caller machinery — 14 instances in one audit (2026-08-05): the safety critic (`8ba007a`), `mineComplaints` (`ff1e711`), the credit reserve (`6107272`), three sweeps built in one night (`cee60cd`), weekly collection (`734e0fb` 2026-08-09), two of five weekly sweeps (`a5ee7a6` 2026-08-12), the pre-spend gate (`1338544` 2026-08-12). | `tests/sweepCoverage.test.ts:33-52`; `convex/maya/__tests__/harnessBoundary.test.ts:191-238`; `convex/integrations/telegram/__tests__/botIdentityResolution.test.ts`; `tests/voiceEvalWired.test.ts` — all per-module, no general guard | One static "every exported Convex function is referenced by a cron, an http route, a tool, or an allow-list" test in CI; plus the handler-coverage pattern ported for every scheduled table. Grep for callers before trusting anything "already built." |
| 3 | The Stripe webhook route was never in the public-route list, so Clerk's `auth.protect()` answered 404 for months and would have eaten the first real payment (found 2026-08-09, `ba367ef`; `middleware.ts:104` notes `git log -S` finds no commit that ever listed it). | `middleware.ts:48-50,104`; `tests/middlewarePublicRoutes.test.ts:44-73` | Port the static test (every server-to-server route public and existing; every API route classified) **and** a live smoke: unauthenticated POST to each webhook returns a signature error, never 404/redirect. Spec §19.3 makes reachability a test. |
| 4 | The Telegram private-DM firewall blackholed the founder's whole plan because it contained "content" narration; AI self-reference was treated as a leak (2026-07-10 `7e88b00`; 2026-07-15 `8dca2d9`). | `convex/maya/outbound.ts:17-27,149`; `convex/gtmMaya/__tests__/outboundFirewall.test.ts` (24); `sendUpdateCriticGate.test.ts` | Invariant test: non-catastrophic drift is LOG-ONLY and the message is delivered; only the exact-string catastrophic denylist holds. A held message must produce a row the operator sees. |
| 5 | The liveness watchdog counted the founder's day in UTC and reported a broken run as clean (2026-08-06, `0346317`); earlier, UTC pre-conversion put every cron four hours late (2026-07-20, `5bfc5bd`). | `convex/maya/cadence.ts:53` (`dayKeyInZone`); `convex/maya/liveness.ts:38-40,79`; `convex/maya/__tests__/founderDay.test.ts:82-131` (static: no UTC day, no `/86_400_000`) | Port `founderDay` static test; fake clock helper with DST and quiet-hours cases (§17.4); every "day" derived through one function that takes the creator's timezone. |
| 6 | Jobs with no handler dead-lettered silently — `wake_agent` routed to a kind nothing handled (`convex/maya/scheduler.ts:123`); `render_video` "no handler for job kind" (`scheduler.ts:161`); durable queue's "no silent death" was the fix (2026-07-31, `b8e3065`). | `convex/maya/__tests__/harnessBoundary.test.ts:191-238`; `convex/maya/jobs.ts:286` `deadLetters` query (nothing alerts on it) | Port the enqueue-site→handler static test; plus a runtime test that a job reaching `dead` writes a named failure that reaches the operator console / creator (principle: nothing fails silently). |
| 7 | Watch cost was invisible to the kill switch: the ledger saw ~2% of the bill because vendor calls bypassed it (2026-08-07, `46995e1`); the spend number was wrong by ~50× (2026-08-12, `a9c1ab0`); `costCap.ts:113-117` conflated research and operational spend. | `convex/maya/cogs.ts`; `tests/cogsRealBill.test.ts:24-35`; `convex/schema.ts:3511` | Static test: no `fetch` to a vendor host outside `integrations/`; every `integrations/*` call writes a `costEvents` row via one helper; the ceiling reads the same table (sibling coherence). Cost-ledger assertion helper per §17.4. |
| 8 | `MEMORY.md` was overwritten on deploy — workspace re-copy restored the seed over live memory (fix `convex/maya/deploy.ts:191-199` `if [ ! -f ]`; checkpoint shrink watch `4ba8206` 2026-08-02). | `convex/maya/deploy.ts:199,889-891`; `convex/maya/checkpoint.ts:45` | No file-resident memory (spec §memory: five layers, all rows). Guard: static test that nothing under `convex/` writes agent state to a filesystem or volume; deploy scripts touch code only. |
| 9 | Two research pipelines pointed at different tables — `gtmMaya/scrapeCreatorsGtmResearch` vs `maya/scroll`; a second sweep map appeared and was deleted (2026-08-18, `1b93489`). | `convex/maya/__tests__/sweepMapIsSingular.test.ts` (3) | One `read()` entry per vendor; static test that only `integrations/` imports vendor clients; schema table count ≤ 17 (Sprint 0 named test) so a second table per concept cannot appear quietly. |
| 10 | Reasoning models bill thinking to `max_tokens` — 892 reasoning tokens against a 1,200 cap returned an empty completion with a 200, not an error (2026-08-09, `c0d2cd7`); the worker model was itself a reasoning model (2026-08-13, `fb01fd8`). | `convex/maya/llm.ts:58-97` (`budgetFor`); `convex/maya/__tests__/llmBudget.test.ts`; `tests/workerModel.test.ts` | Model registry (§4) carries `reasoning: boolean`; `budgetFor` tested against the registry; an empty completion with a 200 is a named `llm.emptyCompletion` failure, never silence. |
| 11 | TikTok music `id` exceeds `Number.MAX_SAFE_INTEGER` and rounds silently; only `id_str` is safe (2026-08-09 memory). `songs/popular` was down at the vendor at the time. | **no guard** — `id_str` handling exists only for X (`convex/integrations/scrapeCreators/platforms/x.ts:63,118`) | zod schemas for TikTok/Instagram parse every id as a string (prefer `id_str`, `z.coerce.string()` never `z.number()`); fixture with a 19-digit id asserting round-trip equality. |
| 12 | Bare `npx convex deploy` ignores `CONVEX_DEPLOYMENT` and shipped 27 unreleased staging commits to prod (2026-08-11; `345ee4f` made the guardrail refuse). | `package.json:14-15`; `scripts/convex-deploy-prod.sh:19-34` (refuses off `main`); bare command still not blocked | Spec §20: `deploy:staging` / `deploy:prod` only; a pre-script that exits non-zero on the bare command; `deploy:prod` requires typing the deployment name back; CI asserts no other deploy script exists in `package.json`. |
| 13 | Every OpenClaw cron targeted `main` and every one was skipped — 12 hours of a daily loop that never ran once (2026-08-05, `7087956`). | `convex/agents/packs/maya/generators.ts:1123` (`isolated`) + `generators.test.ts` | Runtime dropped. General form: every scheduled thing writes a `lastRanAt` row and a daily liveness check fires a named failure when a schedule has not run — a schedule that "exists" is not a schedule that runs. |
| 14 | Auto-stop removed the loop — the Fly machine slept and the heartbeat never fired; always-on cost 10× (auto-stop wired 2026-08-01 `d7531d7`; `autostop: "off"` at `convex/maya/deploy.ts:306`). | `convex/maya/__tests__/deploy.test.ts` "ALWAYS-ON, SO THE HEARTBEAT CAN ACTUALLY RUN"; `harnessBoundary.test.ts:183` | Runtime dropped; Convex crons are the only scheduler. Guard: the harness-boundary allow-list of crons, and the liveness check from #13. |
| 15 | The ScrapeCreators `nicheCache` was half-dead — reads went to the vendor while the cache looked populated (memory; no commit names it). | **no guard** | `readCache` keyed by `read()` params with tests for hit / miss / expired / serve-stale-on-vendor-failure, and a cost assertion that a second identical read within TTL writes no `costEvents` row. |
| 16 | Zernio `profileId` not persisted: every customer's sync could inherit the whole fleet's accounts (2026-08-11, `4f4fb8c`); the "Default profile" fallback; the connect-callback state token mangled in transit. | `tests/zernioProfileScoping.test.ts:57-135`; `convex/gtmMaya/__tests__/zernioConnect.test.ts:67-157`; `convex/schema.ts:3498` ("the TENANT BOUNDARY at the vendor") | Port profile scoping (fail closed with no profile; one profile per creator; never reassigned; account list scoped by profile not API key) and state-token tests (single-use, bound to issuing tenant, expiry). Cross-tenant mandatory category. |
| 17 | `/inbox/comments` returned `accountsQueried: 0` and the sweep reported "0 new" instead of "vendor read nothing" (2026-08-05, `convex/maya/inbox.ts:332-341`); Instagram "returned nothing" vs "dropped everything" (2026-08-18, `34f34f1`). | `convex/maya/inbox.ts:341` throws; `tests/vendorSchemaStrictness.test.ts:174-188` | Port `vendorSchemaStrictness`: required fields on every vendor list schema; `read()` returns `{ok, data, why}` and an empty result carries whether the vendor queried anything. Empty and failed are different rows. |
| 18 | resvg renders blank rather than erroring — status, content-type and byte count all looked right (2026-08-09, `ba367ef`; `app/api/render/slide/__tests__/fonts.test.ts:10-31`). | `fonts.test.ts:31` (zero-byte / LFS-pointer check) | Render dropped. General: any generated or fetched asset is asserted by content (decoded dimensions, non-trivial bytes, a pixel), never by 200 + content-type. Applies to video fetch in the scrape spike. |
| 19 | The spend ceiling could never fire — it summed `jobs.costUsd`, a field nothing wrote, so it read $0 against a real $2,508 (2026-08-12, `0717250`; `convex/schema.ts:4217`). | `convex/maya/spendCeiling.ts:158-179` (sums `costEvents`); `convex/maya/__tests__/spendCeiling.test.ts` | Sibling-coherence static test: the field the ceiling sums is a field the ledger writer sets (grep both from source). Direct vendor call sites forbidden outside `integrations/` (17 files hit `chat/completions`/openrouter today). |
| 20 | Foundation-research runaway loop at ~$30/hr — four agents killed by their own spend wall (2026-07-06, `convex/gtmMaya/spendKill.ts:69`); the $32-burn autopsy (2026-07-12, `d029743`); an orphaned machine with no agent row burned all night (`convex/accountDeletion.ts:397-398`). | `gtmMaya/spendKill.ts` (throttle); `maya/spendCeiling` "CAPS THROTTLE, NEVER DESTROY"; `maya/liveness.ts:386` | Per-creator daily ceiling that throttles; a test that a loop of identical reads stops within N calls; every cost row has an owner (no orphan spend); breaker on repeated identical vendor calls. |
| 21 | The suite exited 1 with 3,239 green tests and nobody knew until CI's first run (2026-07-30, `2b7da05`); later 289 files passed and a scheduled function outliving its test failed CI silently (2026-08-24, `1149221`). | CI on `staging`/`main` (`.github/workflows/ci.yml`); no shared helper drains scheduled functions | CI blocking from day one (§17); convex-test helper that drains scheduled functions on teardown; CI step asserts on exit code and on "unhandled rejection" count. |
| 22 | A v1 test made a REAL network call to Telegram (2026-08-03, `ea30523`). | **no guard** | Vitest setup file that stubs `fetch` and fails any unmocked network call; the fake Telegram and vendor replayer are the only ways out. |
| 23 | Three of four channels could connect and never post, silently (2026-08-11, `cd7daac`); the founder was "deployed" and Mission Control said not (`da759c1`). | `convex/maya/__tests__/channels.test.ts` "CONNECTED IS NOT THE SAME AS CAN-POST"; `tests/channelRequirements.test.ts` | Publish dropped. General: a connection is healthy only after a successful read is recorded with a timestamp; the console reads that row, never the OAuth status. |
| 24 | The liveness sweep exceeded Convex's action limit at ONE customer (2026-08-11, `aec1f7e`). | `convex/maya/__tests__/fleetScale.test.ts` "the liveness sweep at 200 customers" | Every fleet-wide cron fans out one scheduled function per creator; a 200-fixture test in the simulate-a-week runner. |
| 25 | `askFounder` wrote a row and never sent it (`81f23ca`); an unanswered question blocked her for days (2026-08-10, `0d00027`); a draft nobody saw is not a draft (2026-08-22, `086a927`). | `convex/maya/__tests__/messages.test.ts` "INVARIANT 6"; `telegram.test.ts` "WRITTEN IS NOT DELIVERED" | Outbound rows carry `deliveredAt`; a test that written-but-undelivered rows older than N minutes surface as a named failure; questions carry a deadline after which Maya proceeds. |
| 26 | The vendor denylist deleted the customer's own product name (2026-08-21, `2c37828`); the SOUL prompt was teaching her the words she was forbidden to say (`198f01d`). | `plainLanguage.test.ts` "HER REAL MESSAGES PASS UNTOUCHED" | Exact-string denylist only, never regex; creator's own names/handles on a tested allow-list; the denylist is never rendered into any prompt. |
| 27 | Convex apologised, in her voice, for a day that never happened (2026-08-21, `940bbbd`). | liveness tests (partial) | Every outbound message carries a `source` (`maya` / `system`); system messages never use her voice; test that a liveness alert is not a Maya message. |
| 28 | The "unreadable response" vendor guard was unreachable (2026-08-12, `75fd825`). | `tests/vendorSchemaStrictness.test.ts` | Every guard branch in `integrations/` has a test that reaches it; the vendor replayer includes a malformed-body case per endpoint. |
| 29 | Auditing REAL rows found in 10 minutes what tests never would: 8 of 39 sent messages leaking plumbing, replies waiting up to 5 minutes (2026-08-05). | `plainLanguage` guard; no audit tooling | A weekly script over real outbound rows (leak count, reply latency p50/p95) surfaced in the S5 operator console; the exit criterion is demonstrated on a live deploy, not in a harness (§18.0). |
| 30 | Account deletion left live-product tables behind — five orphaned tables (2026-07-15, `b330d1e`), then every live table (2026-08-11, `7b687ac`). | `tests/accountDeletionCoverage.test.ts` (derives the table list from `schema.ts`) | Port the static coverage test; deletion coverage is derived from the schema, never hand-listed. Instagram App Review requires the deletion endpoint in S1. |
