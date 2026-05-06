# HeyMaya Creator MVP — Sprint Plan

**Status:** Locked 2026-05-06 after deep architecture + code audit (5 parallel agents).
**Supersedes:** `docs/SPRINT_PLAN_V0.md` for the creator product. Service product plan unchanged.
**Goal:** Two friend-cohort creators sign up, use Maya for a week, both say "I'd keep this."

---

## How to use this doc

Sprints are sequential. **A sprint is not done until its real-world bar passes.** The bar is verifiable by the operator (Joshua) — text Maya, observe behavior, check Fly logs, query Convex. "Tests pass locally" is not a bar; "Maya texts the operator a cited trend in his niche" is.

If a bar fails, do not move to the next sprint. Diagnose, fix, re-run.

Every sprint also passes the **5 mandatory test categories** (cross-tenant isolation, plan-tier × action, adversarial inputs, sibling-file scan, TODO grep). Voice fixture extends each sprint that touches user-facing surfaces.

Each sprint commits + pushes at end-of-sprint in logical chunks. Don't pile uncommitted work; don't commit mid-sprint while parallel agents are writing.

---

## Architectural reference

Lock the 5 layers in your head. Every sprint sits in one or more.

1. **OpenClaw runtime** (cron, heartbeat, memory + memory-wiki/dreaming, channels, TaskFlow, sessions, approvals, image gen, web search). We do not reimplement.
2. **Skills** — universal, installed at deploy: 22 custom `maya-*` (existing) + 11 new `maya-*` + 6 ClawHub pins + 3 Anthropic public + 7 OpenClaw built-ins.
3. **Memory-wiki** — per-creator compounding learning. `wiki_apply` from learning skills. Dreaming compiles overnight.
4. **Convex** — onboarding intake, ScrapeCreators read cache, picture synth, workspace bundle gen + Fly deploy, Composio Gmail webhooks, Google Calendar OAuth, Clerk auth, Stripe webhooks, plan-tier gating, billing logs.
5. **Channels** — claw-messenger (iMessage). No web UI for creators in MVP.

Workspace bundle (per creator at deploy): AGENTS.md, SOUL.md (seed), IDENTITY.md, USER.md, MEMORY.md (seed), HEARTBEAT.md, BOOT.md, TOOLS.md, DREAMING.md, cron/jobs.json (6 entries), skills/ directory.

---

## Sprint 0 — DONE

**Status:** Merged to `staging`, pushed.

- Wave 0a: Deleted dead onboarding state machine (`_state.ts`, `_steps/`, related tests). Salvaged `recommendChannel` helper.
- Wave 0b: Removed `OPENCLAW_SKIP_CRON=1` kill switch from `convex/onboarding/maya/deployMaya.ts:233`. Root cause: smoke harness regex mistakenly treating non-fatal `[cron] failed to start` log line as fatal. Added `cronHeartbeat` table + smoke harness.
- Wave 0c: Fixed 3 pre-existing tsc errors blocking Convex deploy (telegram-on-claw-messenger union, GatewayConfig browser/discovery/memorySearch).

Tests: 2673/2673 passing. tsc clean.

Carryover: **Live Fly cron smoke is still red.** Goes in Sprint 1.

---

## Sprint 1 — Cron smoke green on real Fly — DONE

**Status:** Merged to `staging`. Smoke green in ~48s on real Fly v2026.4.23.

**Bar (narrowed mid-sprint, operator-approved):** Verify the OpenClaw cron service initializes on a deployed Fly machine post-unkill — i.e., gateway log records `cron: started` with `enabled=true, jobs>=1`. The agent-runtime + Convex round-trip (cron→agentTurn→tool→Convex) is downstream complexity that requires production workspace + skills + tools — that path is covered by Sprint 2's `creator-maya-v0-fly-smoke` real-world bar.

### Bugs fixed this sprint

1. **`--keep-app` flag also keeps the machine alive** — original code destroyed the machine even with `--keep-app`, making live SSH debugging impossible.
2. **Memory bumped 512MB → 2048MB** — gateway boot total-VM hit ~1.7GB, OOM-killed at ~74s.
3. **Dropped `--bind lan --port 3000` → loopback default** — OpenClaw v2026.4.23 requires explicit `gateway.controlUi.allowedOrigins` for non-loopback binds (service product hit this 2026-04-28 — same fix). For the smoke, loopback is sufficient.
4. **Polling switched from runs/jsonl → gateway log file** — the old poll waited for the agent-turn to complete and write `action=finished status=ok`, which requires real workspace tooling. New poll greps `/tmp/openclaw-1000/openclaw-<DATE>.log` for `cron: started` over SSH.
5. **Minimal openclaw.json** — adding `agents.defaults.model.*` or explicit `cron.*` blocks both correlated with cron silently failing to auto-enable. Empirical fix: keep openclaw.json minimal.

### Real-world bar (narrowed)

- `npm run smoke:cron-fly -- --confirm` exits 0 within ~60s
- Gateway log records `cron: started` with `enabled=true, jobs>=1`
- 5 mandatory categories pass (no new business logic added — existing coverage)

### Carry-forward to Sprint 2

- Production `convex/onboarding/maya/deployMaya.ts` still uses `--bind lan --port 3000` (creator pack). The service product already migrated to `--allow-unconfigured` loopback. Sprint 2's deploy-path consolidation should mirror the service shape on creator-side too.
- Smoke deletes orphaned Convex endpoints (`/smoke/cron_heartbeat/*`) are unused now but left in place for backwards-compat. Cleanup is a low-priority nit, not a Sprint 2 blocker.

---

## Sprint 2 — Foundation: deploy path consolidation + voice fix + skill bundling — DONE

**Status:** Merged to `staging`, pushed. 2704/2704 tests passing, tsc clean, real-world Fly smoke green.

**Outcome:**
- `assembleWorkspaceBundle.ts` is the single creator deploy path. `creatorMayaV0/backend.ts` callers point at it. 13 prose-only `creator-*` skill stubs + 8 thin-stub generators (agentsMd/soulMd/userMd/toolsMd/heartbeatMd/memoryMd/dreamingMd/jobsJson) deleted from `workspaceManifest.ts`.
- `generateSoulMd.ts` + `generateIdentityMd.ts` written, wired into `assembleWorkspaceBundle.ts:103`. Both ship anti-sycophancy frame, anti-fake-busy, banned-term enforcement.
- 6 voice leaks stripped (5 confirmed + 1 in `maya-calendar-classifier/script.ts:204`). `agents/skills/maya-platform/skill.md` → `SKILL.md` rename via `git mv` (history preserved). `tests/mayaVoice.test.ts` (17 cases) extended to grep banned terms in every workspace generator's output.
- 23 creator-side `maya-*` skills bundled into `BUNDLED_SKILLS` (vs. 1 before). `metadata.openclaw` frontmatter added to each. Regen via `scripts/sync-bundled-skills.ts`. Companion test asserts byte-for-byte sync.
- `pinnedClawhubSkills.ts` refreshed: `remotion-video-toolkit` dropped; `tiktok@3.0.0` kept (Growth-OS, complementary to scrapecreators read-layer per skill-content judgment); 6 ClawHub pins added (capcut, video-frames, faster-whisper, elevenlabs-transcribe, photo-text-overlay, brave-search).
- 3 Anthropic skills vendored faithfully from `anthropics/skills@d230a6dd` into `agents/skills/{pdf,docx,internal-comms}/` (79 files). Provenance + re-vendor command in `agents/skills/VENDOR_MANIFEST.md`.
- Sprint 1 carry-forward landed: `convex/onboarding/maya/deployMaya.ts:buildBootstrapShell()` switched from `--bind lan --port 3000` (crash-loops on v2026.4.23) to `--allow-unconfigured` loopback default — mirrors `deployServiceMaya.ts`.
- `creator-maya-v0-fly-smoke.ts` extended with post-ready `pollCronAndVoiceReady()` step: polls for `cron: started enabled=true jobs=21` in gateway log, then voice-grep over `/data/workspace/*.md`. Both green on real Fly machine in iad in ~50s.

**Real-world bar (verified):**
- `npm run smoke:creator-maya-v0 -- --live --confirm` exits 0 in ~50s on real Fly v2026.4.23
- 11 root files emit (AGENTS, SOUL, IDENTITY, USER, MEMORY, HEARTBEAT, BOOT, TOOLS, DREAMING, standing-orders, Operations/) + 31 skills in `/data/workspace/skills/` (23 maya-* + scrapecreators-api + 7 ClawHub pins)
- SOUL.md ships SEED-only anti-sycophancy frame; IDENTITY.md is `name=Maya, vibe=strategic, emoji=✨, creature=creator manager`
- Voice grep over `/data/workspace/*.md` returns ZERO hits on banned terms
- `cron: started` observed in gateway log with `enabled=true, jobs=21` (Sprint 1 win regression-checked + scaled from 1 → 21 jobs)

**Carry-forward into Sprint 3:**
- 3 Anthropic vendored skills (`pdf/`, `docx/`, `internal-comms/`) live in `agents/skills/` but DO NOT ship to `/data/workspace/skills/` at deploy. The `BUNDLED_SKILLS` registry only inlines a single SKILL.md per slug; the Anthropic skills have helper scripts/examples/refs (79 files) that need a multi-file bundling path. Decide whether to: (a) extend the bundle assembler to walk subtrees per slug, (b) ship them via a separate ClawHub-style hydration step, or (c) defer until Maya needs them at runtime (likely not v0).
- `agents/skills/maya-platform/SKILL.md` frontmatter is `name: maya-platform-skills` (not `maya-platform`); harmless but worth standardizing if the OpenClaw loader ever uses the frontmatter name for resolution.
- `__tests__/deployMaya.test.ts` — 4 synthesis/Wave-3 tests bumped to `{ timeout: 30_000 }`. They run real model-router code paths with retries (~20s each); the previous "2673/2673 passing" count from the Sprint 1 handoff was likely vitest's default 5s timeout failing them silently. Investigate whether the synthesis path can be sped up or split into faster unit tests.

---

## Sprint 2 — Foundation (original spec, kept for reference)

**Goal:** Maya boots with the right files + the right skills + clean voice. This is the foundation; everything else assumes it.

### Scope

**Consolidate deploy paths:**
- Point `convex/creatorMayaV0/backend.ts:861, 1051` at `convex/agents/packs/maya/workspace/assembleWorkspaceBundle.ts`
- Delete thin-stub generators in `convex/creatorMayaV0/workspaceManifest.ts` (`agentsMd`, `soulMd`, `userMd`, `toolsMd`, `heartbeatMd`, `memoryMd`, `dreamingMd`, `jobsJson` functions and the 13 `creator-*` prose-only skills)
- Keep the manifest file as a thin Coach/Manager-shaped wrapper if needed; otherwise delete

**New generators:**
- `convex/agents/packs/maya/workspace/generateSoulMd.ts` — creator-side, mirrors `convex/agents/packs/maya_service/generateSoul.ts:40-115`. SEED-only, no picture data. Includes:
  - "You are Maya, a creator manager. One creator, one you."
  - Voice rules: never say "AI"; anti-sycophancy non-negotiable; short, direct; push back on bad ideas; never explain how you work; banned terms list
  - Boundaries, brevity defaults
- `convex/agents/packs/maya/workspace/generateIdentityMd.ts` — name=Maya, vibe (from anchor-question tone or default `strategic`), emoji=✨, creature=`creator manager`
- Wire both into `assembleWorkspaceBundle.ts:103` with `files.set("SOUL.md", generateSoulMd(...))` and `files.set("IDENTITY.md", generateIdentityMd(...))`

**Strip "AI" voice leaks (the 5 confirmed sites):**
- `convex/onboarding/maya/synthesizeCreatorPicture.ts:995` — replace `Maya's tagline is "your AI creator manager"` with role-shaped phrasing
- `agents/skills/maya-platform/playbook.md:17` — replace `You are an AI creator manager.` with `You are Maya, a creator manager.`
- `convex/agents/packs/maya/workspace/generateAgentsMd.ts:80` — `single-creator AI manager` → `single-creator manager`
- `convex/agents/packs/maya/workspace/generateAgentsMd.ts:92` — `the creator's AI manager` → `the creator's manager`
- `agents/skills/maya-content-cross-poster/SKILL.md:31` — `exactly what an AI manager should own` → `exactly what a manager should own`

**Skill bundling:**
- Massively expand `BUNDLED_SKILLS` in `convex/agents/packs/maya/workspace/skillsRegistry.ts` to include all 22 existing `agents/skills/maya-*/` skills (or implement `scripts/sync-bundled-skills.ts` to do it at deploy)
- Add `metadata.openclaw` frontmatter to all 22 maya-* `SKILL.md` files (env requirements, primary env var, tags) per OpenClaw skill convention
- Rename `agents/skills/maya-platform/skill.md` → `SKILL.md` (Linux case-sensitive runtimes will reject lowercase)

**ClawHub pin updates** in `convex/creatorMayaV0/pinnedClawhubSkills.ts`:
- Drop `remotion-video-toolkit@1.4.0` (misaligned even under delegated-edit lens — cloud-rendered NemoVideo is the right pick)
- Verify `tiktok@3.0.0` value vs `scrapecreators-api`; drop if redundant
- Add `vcarolxhberger/free-video-generator-capcut@1.0.0`
- Add `steipete/video-frames@1.0.0`
- Add `theplasmak/faster-whisper@1.5.1`
- Add `paulasjes/elevenlabs-transcribe@1.0.1`
- Add `psyduckler/instagram-photo-text-overlay@1.0.0`
- Add `steipete/brave-search` (latest verified)

**Anthropic public skills:**
- Vendor `pdf`, `docx`, `internal-comms` from `anthropics/skills` repo into `agents/skills/`. Pin versions in a manifest file.
- Defer `xlsx`. Skip `pptx`, `frontend-design`, etc.

**Doc cleanup:**
- Update `agents/skills/maya-platform/SKILL.md` (newly renamed) to reflect new ClawHub policy: install where ClawHub skills are better; custom-write Maya-specific judgment skills. Drop the "no third-party ClawHub skills in v0" line.

### Real-world bar

- `npm run smoke:creator-maya-v0 -- --confirm` deploys a real test creator to Fly
- SSH into the Fly machine: `flyctl ssh console -a <test-app>`
  - `ls /data/workspace/` — confirms 11 expected files (AGENTS, SOUL, IDENTITY, USER, MEMORY, HEARTBEAT, BOOT, TOOLS, DREAMING, cron/, skills/)
  - `cat /data/workspace/SOUL.md` — confirms SEED-only content (Maya's voice rules), NO picture data
  - `cat /data/workspace/IDENTITY.md` — confirms name=Maya
  - `ls /data/workspace/skills/` — confirms ≥30 skills present (22 maya-* + 6 ClawHub + 3 Anthropic + 7 OpenClaw built-ins minus duplicates)
- `grep -ri "AI creator manager\|as an AI\|I'm an AI\|AI assistant\|I'll synthesize" /data/workspace/` — returns ZERO hits
- Maya texts the operator's TikTok handle a welcome message — operator manually grades voice (must read as coach, no chatbot leakage, no banned terms, no menus)
- Voice fixture (`tests/mayaVoice.test.ts`) extended to grep the actual generated SOUL.md, AGENTS.md, USER.md, MEMORY.md output strings against banned-term list — passes
- All 5 mandatory categories pass
- tsc + vitest clean

### Definition of done

`assembleWorkspaceBundle.ts` is the single deploy path; old `workspaceManifest.ts` generators deleted; SOUL.md + IDENTITY.md generators wired and tested; voice leaks zero across user-facing surfaces; all skills present in deployed workspace; commit + push.

---

## Sprint 3 — Cron + heartbeat collapse + thinking budget tags

**Goal:** Cron is exactly 6 entries (precise timing only). HEARTBEAT.md is the proactive spine. Thinking budgets match task class.

### Scope

**Standing orders refactor** in `convex/agents/packs/maya/workspace/standingOrders.ts`:
- KEEP as cron: `morning_brief`, `evening_recap`, `weekly_content_plan`, `weekly_review`, `accountability_nudge`, `revenue_snapshot`
- MOVE to heartbeat (change `kind` to `"heartbeat"` or add `cronEnabled: false`): `performance_check_2h`, `daily_niche_scan`, `trend_watcher`, `comment_triage`, `competitor_watch`, `calendar_lookahead`, `industry_intel_daily`, `opportunity_scout_daily`, `collab_matchmaker_weekly`
- DELETE for MVP: `manager_readiness_packet_quarterly`, `algo_research_tiktok`, `algo_research_instagram`, `algo_research_youtube`, `algo_research_linkedin`, `algo_research_x`

**Verify** `convex/agents/packs/maya/workspace/buildCronJobsJson.ts` filters `kind === "cron"` and emits exactly 6 entries.

**HEARTBEAT.md rewrite** in `convex/agents/packs/maya/workspace/generateHeartbeatMd.ts`:
- Idle-aware (no push 10pm-7am unless URGENT — defined as: post crashed >0.3× baseline OR brand email flagged paid-deal-pending)
- Skip-if-recent cooldowns stamped to `mayaActionLog`
- 11 ordered checks (stop on first ACT for the tick unless trivial):
  1. Unread creator message → ACT now, skip rest
  2. Past-due `contentPlans` post → nudge if not nudged today
  3. Post-outlier scan (60min cooldown): >2× ping, >1.5× annotate, <0.3× ping, <0.5× annotate
  4. Brand-email triage (30min cooldown, Manager only at MVP single-tier all gets it)
  5. Niche + trend scan (6h cooldown): write `trendObservations`, fold into next morning brief
  6. Competitor pull (6h cooldown): named peers' last 24h posts → `competitorObservations`, fold
  7. Comment triage (6h cooldown): classify last 5 posts' comments → `commentTriage`, fold
  8. Calendar peek (12h cooldown, only if Composio Calendar connected): events 1-14d out, propose arc
  9. Opportunity scout (12h cooldown): UGC marketplaces + creator-call hashtags + local-brand Brave search
  10. Collab matchmaker (7d cooldown): expand named peers + niche search, score overlap
  11. Industry intel (12h cooldown): niche+platform news
- Decision rules: max 1 push per tick; citation firewall mandatory; tone=anti-sycophancy; silent no-op is default
- Stay under 2K char soft cap (`HEARTBEAT_SOFT_CAP_CHARS:22` budget)

**Thinking budget tags** in `convex/agents/modelRouter/taskTags.ts`:
- ADD `heartbeat_tick: low` (default for the routing call itself)
- ADD `pre_post_scorer: high`
- ADD `underperformance_diagnoser: high`
- ADD `picture_verification: medium`
- ADD `revenue_snapshot: low`
- RAISE `weekly_content_plan` from medium → high (matches CLAUDE.md spec)

**Telemetry:** ensure `mayaActionLog` table captures tick-decision quality (which check fired, what was pushed, was it acted on, did creator engage). Used to validate heartbeat thinking budget is appropriately low.

### Real-world bar

- Deploy test creator
- Wait 90 minutes during awake hours; observe heartbeat tick logs in Fly + Convex
  - At least 2 ticks fired
  - Each tick read HEARTBEAT.md, ran the 11 checks, evaluated cooldowns, and either pushed or no-op'd
  - At most 1 push per tick
  - Citation firewall caught any uncited recommendation (drop it from output)
- Manually wait through 10pm-7am window: zero pushes during idle hours unless URGENT
- Verify `mayaActionLog` rows: each tick stamps a decision with check IDs + outcomes
- Cron schedule check: deploy creator at any time, verify the 6 entries fire at correct wall-clock times over 24h (morning_brief at 7am local, evening_recap at 7pm, etc.)
- Verify thinking budget escalation in `model-usage` skill output: heartbeat ticks log `low`, escalating per-check (e.g., brand-email-triage logs `high` when it fires from inside the tick)
- All 5 mandatory categories

### Definition of done

`buildCronJobsJson.ts` emits 6 entries; HEARTBEAT.md content matches audit-defined 11-check shape; 5 new task tags live; weekly_content_plan raised to high; mayaActionLog telemetry firing; live tick-and-push observed.

---

## Sprint 4 — Bulk pull expansion (audience + following + follower trend)

**Goal:** Picture has real audience demographics + named-peer signal, no more "not yet provided."

### Scope

- Wire `tiktok.audience` (already wrapped at `convex/integrations/scrapeCreators/endpoints.ts:1016-1026`) into `runFullScrapePull.ts:115` parallel block as a 3rd `Promise.allSettled` entry. TikTok-only.
- Cache key: `cacheKey("tiktok", "audience", handle)`.
- Add `tiktok.following(handle, deps)` wrapper to `endpoints.ts` after `:1016`. Call from `runFullScrapePull` for TikTok handles only.
- Pipe audience data into `creatorPicture.audience.{ageRanges, topGeos, gender}` synthesis step.
- Update `convex/agents/packs/maya/workspace/generateUserMd.ts:170-189` to populate audience block from real data; remove "not yet provided" fallback.
- Add follower-count trend (30-day delta) to USER.md via `generateUserMd.ts:60-65` handles block.
- **Credit budget gating**: TikTok audience endpoint costs 26 credits/call (vs. 1 for everything else). Add gating logic: only call `tiktok.audience` for handles with >5K followers, or if creator opts in during onboarding. Track credit usage in a Convex audit table.

### Real-world bar

- Deploy test creator (operator's TikTok handle, >5K followers — confirm Kevin.Castro9996 meets threshold)
- After onboarding bulk pull completes:
  - SSH into Fly: `cat /data/workspace/USER.md` — audience block shows real age ranges + top geos (not "not yet provided")
  - Follower count trend block shows 30-day delta (or "no prior snapshot" on first run, then real data on second run a day later)
  - Named peers section populated from `tiktok.following` data (or top peer suggestions from search)
- Convex query: verify `scrapeCreatorsCache` rows for `tiktok:audience:<handle>` and `tiktok:following:<handle>`
- Credit usage audit: ScrapeCreators dashboard shows expected credit burn (~26 + 1 + N for full pull)
- For a fixture creator with <5K followers, audience endpoint NOT called (credit gating works)
- All 5 mandatory categories

### Definition of done

`runFullScrapePull` calls audience + following for qualifying handles; credit gating live; USER.md generates with real data; verified via SSH on a real test deploy.

---

## Sprint 5 — New skills wave 1: picture-verifier + trend-watcher + idea-generator + transcribe

**Goal:** Maya has the foundational skills for accurate picture, Day 1 value, and voice-memo handling.

### Scope

For each new skill:
- `agents/skills/<slug>/SKILL.md` (with `metadata.openclaw` frontmatter)
- `agents/skills/<slug>/script.ts` (pure-logic library: prompt builders, validators, citation firewall)
- `agents/skills/<slug>/__tests__/<slug>.test.ts` (unit + adversarial)
- Bundle into `BUNDLED_SKILLS`

**`maya-picture-verifier`:**
- Input: `creatorPicture.draft` + `needsVerification[]` items
- Output: per-item iMessage-shaped verification questions, parsed creator answers, updated draft, lock-in mutation call
- Triggers: after picture synthesis, before `pictureLockedAt`
- Citation firewall: every claim Maya makes about the creator cites a source (post ID, anchor answer, etc.)

**`maya-trend-watcher`:**
- Input: `creator.niche`, primary platform, trailing 7-day baseline
- Calls: `scrapecreators-api` (popular_hashtags, trendingFeed, popular_creators)
- Output: `[{ trendPattern, citation, fitToCreatorScore, sampleCreatorsRiding }]`
- Citation firewall on every output string

**`maya-idea-generator`:**
- Input: `creatorPicture.voiceFingerprint`, recent posts last 30d, top hooks from `hookLibrary`, trend candidates from maya-trend-watcher
- Output: `[{ idea, hook, format, citationToVoiceAnchor, citationToTrend, antiPatternFlag }]`
- Each idea cites ≥2 specific real recent posts; uncited ideas dropped

**`maya-transcribe`:**
- Wraps `theplasmak/faster-whisper` ClawHub skill
- Input: audio/video file path or URL (from iMessage attachment)
- Output: `{ text, srt, vtt, wordTimestamps }`
- Triggers: "Maya, transcribe this", or when caption-overlay edit needs subtitles

### Real-world bar

- **Picture-verifier**: synthetic creator fixture with London content + Brooklyn self-report → produces verification question, refuses to assert London. Test creator runs full picture-verify round-trip in iMessage; operator manually validates Maya's questions feel natural.
- **Trend-watcher**: invoked against operator's TikTok account → returns ≥3 cited recent trend examples filtered to operator's niche. Each citation links to a real ScrapeCreators trending feed entry.
- **Idea-generator**: invoked against operator's account post-picture-lock → returns ≥2 ideas. Each cites ≥2 real recent posts. Citation firewall demonstrably drops uncited candidates (run a fixture that forces hallucination → verify it's dropped).
- **Transcribe**: feed a 30-second test voice memo → returns text with ≥95% word accuracy on clean audio, valid SRT output.
- All 5 mandatory categories on each skill

### Definition of done

4 new skills bundled, full SKILL.md + script.ts + tests; demonstrable real-world output on operator's account; citation firewall working.

---

## Sprint 6 — Onboarding flow redesign

**Goal:** Sub-3-min web → deploy → 6 anchor questions over iMessage → constraint-aware synth → verify round-trip → picture lock.

### Scope

**Web form** (`app/onboarding/maya/page.tsx`):
- 4 fields: handle, name, phone, channel preference (default iMessage)
- Drop hardcoded `channelPreference: "imessage"` at `convex/onboarding/maya/submitOnboarding.ts:158`
- Use the salvaged `recommendChannel` userAgent helper for the radio default

**Playbook rewrite** (`agents/skills/maya-platform/playbook.md` § 4.5):
- Total rewrite of first-message handler. New 6-question script in target order:
  1. Where based? (location anchor — fixes London bug)
  2. Niche in your own words? ("I don't know yet" valid)
  3. 3-month goals? (followers / money / brand deals / audience / consistency)
  4. Full-time or day job?
  5. Brand deals — interested + rough floor? (everyone on Manager trial during onboarding, so always asked; planFeatures gates feature post-trial)
  6. Anti-patterns — anything you've tried that didn't work, or that I shouldn't push you toward?
- One question per message, parse answers as they arrive
- Drop the meta-tone-question ("how do you want me to talk to you?") — calibrate from answers, not by asking
- Drop the menus / listicle scaffolding ("Two quick things before I begin")

**HTTP endpoint** (`convex/lcMaya/lcMayaHttp.ts`):
- Extend `submit_opening_answers` schema to accept new fields: locationCity, locationState, locationCountry, timezone, nicheInOwnWords, goals3Mo, jobStatus, dealsInterest, dealsFloorUsd, antiNiches
- New endpoint `POST /lc_maya/lock_picture` to commit verified picture (with corrections if any)

**Schema additions** (`convex/schema.ts`):
- New fields on `creatorPicture.openingAnswers`: locationCity, locationState, locationCountry, timezone, nicheInOwnWords, goals3Mo, jobStatus, dealsInterest, dealsFloorUsd, antiNiches
- New output field on synth: `needsVerification[]` — `{ field, selfReported, observedSignal, evidence[], question, severity: "blocker"|"soft" }`
- New flag on `creators`: `pictureLockedAt`

**Constraint-aware synth** (`convex/onboarding/maya/synthesizeCreatorPicture.ts`):
- Read `openingAnswers` BEFORE the model call
- Inject as constraints in the prompt: "Creator confirmed they're based in [Brooklyn]. Treat any [London] footage as travel, not home base."
- Generalize the existing `careerStageReconciliation` pattern (`:1073-1170`) to a top-level `needsVerification[]` output array covering location, niche, audience, voice direction, brand-deal history
- Output schema validation: every claim about the creator either matches an anchor or appears in `needsVerification`

**Standing order trigger:**
- Re-key `first_weekly_plan` standing order to fire on `creators.pictureLockedAt`, not `openingAnswersAt`. The current trigger is premature.

### Real-world bar

- Operator signs up via web onboarding using the test handle (Kevin.Castro9996 + +1 631-335-7603)
- Web form completes in <2 min
- Maya texts welcome message within 60s of submit (verified by operator's iMessage)
- 6 anchor questions delivered ONE at a time over iMessage (verified by operator)
- Operator answers all 6
- Picture synth completes in background (Fly logs confirm)
- Maya texts picture summary + 1-3 verification questions ("London — trip or split time?" if applicable)
- Operator confirms / corrects in iMessage
- `pictureLockedAt` stamps in Convex (verify via dashboard)
- **London-bug regression test**: synthetic fixture creator with NYC self-report + heavy London footage in last 30 posts → synth produces `needsVerification` entry for location with severity=blocker, does NOT silently overwrite. Maya asks before locking. Verified by automated test.
- All 5 mandatory categories
- Voice fixture passes on every Maya output during the flow

### Definition of done

Operator personally walks through the onboarding flow on his real account, picture locks accurately, no London-shaped assumptions made, no chatbot voice leaks.

---

## Sprint 7 — Email + Calendar integrations + Day 1 value

**Goal:** Maya can read/draft Gmail + read/write Google Calendar over iMessage. Day 1 first-proactive-ping fires with trend + idea + connect offer. Delegated clip-edit works.

### Scope

**Email skills:**
- `agents/skills/maya-gmail-read/` — wraps `convex/integrations/composio/actions/gmail.ts:searchThreads/getThread`
- `agents/skills/maya-gmail-draft/` — wraps `gmail.ts:createDraft/updateDraft` (NEVER `sendEmail` in MVP)
- Both with full SKILL.md + script.ts + tests
- Composio Gmail webhook (`app/api/composio/webhook/route.ts`) already production-grade — verify it routes to brand-deal-triager → maya-gmail-draft pipeline

**Calendar skills:**
- `agents/skills/maya-calendar-read/` — wraps direct Google Calendar OAuth read (uses existing `convex/creatorMayaV0/backend.ts:1703-1802` token-refresh + fetch helpers)
- `agents/skills/maya-calendar-write/` — wraps Google Calendar event create/update (NEW helper in `backend.ts`, `createGoogleCalendarEvent(accessToken, ...)` mirroring `fetchGoogleCalendarEvents`)
- Both with full SKILL.md + script.ts + tests

**iMessage-tap Calendar OAuth:**
- New endpoint `POST /lc_maya/start_google_calendar_oauth` in `convex/lcMaya/lcMayaHttp.ts` — returns Google OAuth URL with Convex-stored state token (no browser cookie needed)
- New callback `app/api/google-calendar/callback-imessage/route.ts` — accepts state token + creatorId mapping (no Clerk session)
- New Convex table or scope-status row for OAuth state token mapping with TTL

**Provider validator update:**
- `convex/lcMaya/lcMayaHttp.ts:52-98` — fork `googlecalendar-direct` vs `googlecalendar-composio` paths. Use direct path in MVP. Either deprecate or remove the Composio Calendar path.

**Delegated edit + thumbnail + caption skills:**
- `agents/skills/maya-clip-editor/` — orchestrator. Receives iMessage video attachment URL → calls `vcarolxhberger/free-video-generator-capcut` ClawHub skill → returns rendered MP4 → pushes back via claw-messenger outbound media
- `agents/skills/maya-thumbnail-maker/` — image generation via Gemini multimodal OR `psyduckler/instagram-photo-text-overlay` for quote cards
- `agents/skills/maya-caption-generator/` — voice-applied + platform-tuned captions

**Day 1 first-proactive-ping:**
- After `pictureLockedAt`, schedule first-ping at +15-30 min via cron or heartbeat trigger
- First-ping content: 1 trending observation in niche (cited via maya-trend-watcher) + 1 grounded idea (from maya-idea-generator) + Gmail/Calendar connect offer (Composio + direct OAuth links over iMessage)

### Real-world bar

- **Email path**:
  - Operator (test creator) gets Composio Gmail connect URL via iMessage, taps it, completes OAuth on Composio's hosted page → tokens stored
  - Operator emails the test account from a different account simulating a brand inquiry
  - Composio webhook fires within 60s → `maya-brand-deal-triager` runs → `maya-gmail-draft` writes 4 reply variants to Gmail drafts
  - Operator opens Gmail web UI → confirms 4 drafts visible
  - Operator approves one in iMessage → Maya does NOT auto-send (MVP rule); creator manually sends from Gmail

- **Calendar path**:
  - Operator gets Google Calendar connect URL via iMessage (the new direct-OAuth-no-Clerk-session path), taps it, completes Google consent → tokens stored
  - Operator says in iMessage "block 3pm Tuesday for filming" → maya-calendar-write creates event → operator verifies in Google Calendar web UI
  - Maya reads upcoming events when relevant (e.g., heartbeat tick 8 fires) → fold into morning brief

- **Clip-edit path**:
  - Operator sends a short test video clip in iMessage with caption "Maya, can you trim this to 30 seconds and add captions?"
  - Maya downloads attachment → maya-clip-editor → NemoVideo cloud-render → returns trimmed MP4 with auto-captions in iMessage
  - Operator confirms quality acceptable

- **Day 1 first-ping**:
  - Within 30 min of `pictureLockedAt`, Maya texts:
    - 1 cited trending observation in operator's niche
    - 1 idea grounded in his voice + the trend (with ≥2 post citations)
    - Connect offers for Gmail + Calendar
  - Operator confirms message reads natural, not corny / generic / AI-slop

- All 5 mandatory categories
- Voice fixture passes

### Definition of done

End-to-end: Gmail connect via iMessage → brand email arrives → reply drafted → operator approves → manual send. Calendar connect via iMessage → event written → operator confirms. Clip edit delegated → returned. Day 1 ping fires with cited Day 1 value.

---

## Sprint 8 — Hardcoded prose deletion + memory-wiki adoption

**Goal:** Zero hardcoded user-facing prose. Memory-wiki feeds dreaming. The "learns YOUR creator" moat is structurally live.

### Scope

**Hardcoded prose deletion:**
- Delete `convex/dealTriage.ts:269-273` (4 hardcoded reply variants) → route through `maya-brand-deal-triager` skill (add `buildVariantPrompt(...)` helper if needed)
- Delete `convex/creatorMayaV0/dailyBrief.ts:160-167` (`renderMorningMessage` template) → route through morning-brief skill
- Delete `agents/skills/maya-platform/playbook.md:233/235-237/245/340` (locked prompts) → Maya-generated, voice-applied via `maya-voice-applier`
- Update tests to mock skill output instead of validating hardcoded fallback strings

**Memory-wiki adoption** — rewrite high-frequency learning skills to call `wiki_apply` (OpenClaw native) instead of writing to specialized Convex tables:
- `maya-platform-algo-researcher`
- `maya-pre-post-scorer` (writes "this hook pattern works" claims)
- `maya-collab-matchmaker` (writes peer/competitor observations)
- `maya-trend-watcher` (writes trend observations)
- `maya-industry-intel`
- `maya-opportunity-scout`

Convex tables `weeklyLearnings`, `competitorObservations`, `trendObservations`:
- DELETE outright if redundant
- OR downgrade to read-only projections of memory-wiki (mirror the wiki for cross-tenant analytics queries; never primary write source)

**Voice fixture extension** (`tests/mayaVoice.test.ts`):
- Add 30+ real Maya outputs from a 7-day live test creator session
- Banned-term grep + length cap + disclaimer-pattern check on each
- Treat any failure as a regression

### Real-world bar

- `grep -ri "Hi \${brand}\|Reply 'draft'\|happy to walk you through\|two quick things before" convex/ app/ agents/` returns ZERO hits in user-facing paths (system prompts to model are allowed under operator's "no AI in marketing copy" rule, verify each remaining hit is system-prompt only)
- Voice fixture passes against 30+ outputs from live test creator (operator's account during sprint 7 + new test session)
- Memory-wiki on Fly machine: SSH in, `ls /data/memory-wiki/` confirms claims directory exists; `find /data/memory-wiki/ -name '*.md' | wc -l` ≥ 10 after 7 days of test creator activity
- Convex query: `weeklyLearnings`/`competitorObservations`/`trendObservations` tables either gone or read-only (no new rows from skill calls; only mirror writes from memory-wiki sync)
- Dreaming verification: SSH into Fly at 3am local → confirm Light/Deep/REM passes ran (from gateway logs); `cat /data/memory-wiki/<some-claim>.md` shows compiled claim with provenance
- All 5 mandatory categories

### Definition of done

Hardcoded prose extinct in user-facing surfaces. Memory-wiki receiving claims. Dreaming compiling. Voice fixture passing on live outputs.

---

## Sprint 9 — Beta hardening + ship to friend cohort

**Goal:** 2 friend creators sign up and use Maya for a week. Both say "I'd keep this."

### Scope

**Friend cohort onboarding:**
- Admin-flagged comp accounts (skip Stripe billing for friends)
- Stripe products created in test mode for future self-serve (no immediate use)
- Friend cohort list: operator picks 2 (aspiring or current creators with TikTok handles)

**Live monitoring during friend trial:**
- SSH into each friend's Fly machine during first 24h, watch every Maya output
- Sample at least 10 Maya outputs per friend per day for the full week
- Voice fixture grades each output

**Bug bash:**
- Any output that feels off → root cause + fix + commit
- Any cron miss / heartbeat skip → diagnose
- Any picture inaccuracy → trace to skill / synth / data and fix

**Edge case verification:**
- "Are you AI?" trap question handler: friend asks Maya "are you AI?" → Maya answers in voice without disclaimers (per playbook canonical answer)
- Idle-aware enforcement: zero pushes between 10pm-7am
- Heartbeat-tick decision quality: review `mayaActionLog` after 7 days, verify no obvious mis-prioritization (low thinking budget for tick is sustainable)

**Real-OpenClaw smoke harness extension:**
- Full creator flow: signup → deploy → 6 questions → synth → verify → first ping → 24h activity → 7-day activity
- Run on schedule against fixture creators to catch regressions

### Real-world bar

- Friend 1 completes 7-day trial:
  - Onboarding completed in <5 min total
  - Picture locked accurately (no London-shape errors)
  - First-day proactive value landed
  - At least 5 distinct skill invocations observed (trend watch, idea gen, post-publish reaction, brand-deal triage if applicable, calendar block, clip edit, etc.)
  - Memory-wiki accumulated ≥30 compiled claims
  - Voice fixture passed every observed output
  - Friend texts operator "yeah I'd keep this" (or equivalent)

- Friend 2: same

- Cron + heartbeat fired correctly throughout the week (no missed entries, no thrash)
- Zero "AI" / chatbot leakage in any creator-facing message across both friends
- All 5 mandatory categories pass + acceptance test pass
- Real-OpenClaw smoke harness green on each green sprint

### Definition of done

2 friends in trial, both keep Maya, operator signs off. MVP shipped.

---

## Cross-cutting rules

### 5 mandatory test categories (per sprint)

1. **Cross-tenant isolation** — Creator A's data never reachable by Creator B's Maya
2. **Plan-tier × action matrix** — server-side gating fail-closed at every entry point (single-tier MVP, but the gating helper stays for post-MVP)
3. **Adversarial inputs** — malformed payloads, oversized fields, broken cron expressions, etc., don't crash the gateway
4. **Sibling-file scan** — every cron entry has matching playbook + skill entries; every skill referenced in playbook is bundled
5. **TODO grep** — no `TODO`, `FIXME`, `eslint-disable` without justification

### Voice fixture (`tests/mayaVoice.test.ts`)

Extended each sprint that touches user-facing surfaces. Always:
- Banned-term grep (no "AI", "synthesize", "as an AI", "happy to walk you through", etc.)
- Length cap (320 chars default; longer requires explicit context)
- Disclaimer-pattern check
- Sycophancy-pattern check ("Great question!", "Amazing!", etc.)

### Definition of done (every sprint)

1. Unit + integration tests pass (vitest, convex-test)
2. `tsc --noEmit` clean
3. 5 mandatory test categories pass
4. Voice fixture passes (where user-facing surfaces touched)
5. **Real-world bar passes** (sprint-specific)
6. Operator manually validates the user-facing surface where applicable
7. Commit + push at end of sprint

A sprint is not "done," doesn't merge, and doesn't unblock the next sprint until 1-7 are all green.

### Commit + push cadence

End of each sprint, in logical chunks. Don't pile uncommitted work; don't commit mid-sprint while parallel agents are writing.

---

## Operator-blocked items (carryover)

- Stripe products in production (post-MVP)
- Apollo / Hunter API keys (Studio-tier, post-MVP)
- ElevenLabs production-grade Voice Calls (post-MVP)
- Multi-platform support (IG, YouTube, X, LinkedIn) — TikTok-only in MVP

---

## What MVP is NOT

- Voice calls (Twilio outbound)
- Auto-send brand emails (Manager-tier autonomy gate, defer)
- Apollo/Hunter outbound (Studio-tier, defer)
- Apple Calendar (Google-only — iPhone-only-Apple-Calendar users get the "add iCloud to Google Calendar (3 min)" message)
- Web HQ for creators (no UI — receipt-only landing + Stripe checkout + Clerk login)
- Multi-tier pricing differentiation (single comped tier for friend cohort)
- Multi-platform (TikTok only)
- Telegram / WhatsApp / SMS (iMessage only)
- Postiz / multi-platform draft scheduling (defer; locked TikTok-only positioning)

---

## After MVP ships

Post-friend-cohort signal:
- Tier split: Coach (advisory) vs Manager (autonomy on send)
- Stripe production billing live
- Multi-platform (IG/YouTube next)
- Voice calls (Studio-tier)
- Brand outreach (Apollo/Hunter)

These are explicitly NOT in the MVP sprint plan. Don't build them yet.
