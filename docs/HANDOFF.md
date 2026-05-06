# Session Handoff — 2026-05-06 (Sprint 1 done, Sprint 2 next)

**Status:** Sprint 1 (cron-fly-smoke green on real Fly) — DONE.
**Next move:** Sprint 2 — deploy path consolidation + voice fix + skill bundling.

---

## Where we are

- **Branch:** `staging` (pushed)
- **Last commit:** `00e82bb` — "Sprint 1 — cron-fly-smoke green on real Fly v2026.4.23"
- **Tests:** 2673/2673 passing
- **tsc:** clean
- **Smoke:** `npm run smoke:cron-fly -- --confirm` exits 0 in ~50s. `cron: started enabled=true jobs=1` observed in gateway log.

### Read in order

1. **`docs/SPRINT_PLAN_CREATOR_MVP.md`** — locked plan. Sprint 1 marked DONE inline; Sprint 2 spec is below it.
2. This file — Sprint 2 starting state + carry-forward.
3. `CLAUDE.md` — already in default context.
4. `~/.claude/projects/-Users-joshcastro-Desktop-heymaya/memory/MEMORY.md` — auto-memory. Sprint 1 done handoff at top.

---

## Sprint 1 outcome (delta from prior plan)

**Bar was narrowed mid-sprint** (operator-approved option 2):

- **Original bar:** `npm run smoke:cron-fly` exits 0 + `cronHeartbeat` Convex row lands in ≤90s + Fly logs show `cron: started` + `runs/<job>.jsonl` shows `action=finished status=ok`.
- **Narrowed bar:** Verify the cron service initializes — gateway log records `cron: started` with `enabled=true, jobs>=1`. The agent-turn → Convex round-trip is downstream complexity that requires production workspace + skills + tools — moves to Sprint 2's `creator-maya-v0-fly-smoke` real-world bar.

5 bugs fixed in `scripts/cron-fly-smoke.ts`:
1. `--keep-app` didn't actually keep the machine alive (only the app)
2. 512MB OOM-killed the gateway at ~74s — bumped to 2048 MB / 2 CPU
3. `--bind lan --port 3000` crash-loops gateway in v2026.4.23 (needs `gateway.controlUi.allowedOrigins`) — switched to loopback default via `--allow-unconfigured`. Service product already fixed this 2026-04-28.
4. Poller was reading `runs/<job>.jsonl` — that's empty until the agent-turn completes. Switched to grepping `/tmp/openclaw-1000/openclaw-<DATE>.log` for `cron: started` over SSH.
5. `openclaw.json` must stay minimal. Adding `agents.defaults.model.*` OR explicit `cron.*` blocks both correlated with cron silently failing to auto-enable.

---

## Sprint 2 — Foundation: deploy path consolidation + voice fix + skill bundling

**Goal:** Maya boots with the right files + the right skills + clean voice. This is the foundation; everything else assumes it.

### Scope (highly parallelizable — 4 independent agent slices)

**Slice A — Deploy path consolidation + new generators**
- Point `convex/creatorMayaV0/backend.ts:861, 1051` at `convex/agents/packs/maya/workspace/assembleWorkspaceBundle.ts`
- Delete thin-stub generators in `convex/creatorMayaV0/workspaceManifest.ts` (`agentsMd`, `soulMd`, `userMd`, `toolsMd`, `heartbeatMd`, `memoryMd`, `dreamingMd`, `jobsJson` + 13 `creator-*` prose-only skills). Keep manifest as a thin wrapper if needed.
- Write `convex/agents/packs/maya/workspace/generateSoulMd.ts` (creator-side; mirrors `convex/agents/packs/maya_service/generateSoul.ts:40-115`). SEED-only, no picture data. Voice rules: never say "AI"; anti-sycophancy non-negotiable; banned terms list.
- Write `convex/agents/packs/maya/workspace/generateIdentityMd.ts` (name=Maya, vibe from anchor-question tone or default `strategic`, emoji=✨, creature=`creator manager`).
- Wire both into `assembleWorkspaceBundle.ts:103`.

**Slice B — Voice leak strip + rename**
- 5 confirmed sites:
  - `convex/onboarding/maya/synthesizeCreatorPicture.ts:995` — replace `Maya's tagline is "your AI creator manager"`
  - `agents/skills/maya-platform/playbook.md:17` — replace `You are an AI creator manager.`
  - `convex/agents/packs/maya/workspace/generateAgentsMd.ts:80` — `single-creator AI manager` → `single-creator manager`
  - `convex/agents/packs/maya/workspace/generateAgentsMd.ts:92` — `the creator's AI manager` → `the creator's manager`
  - `agents/skills/maya-content-cross-poster/SKILL.md:31` — `exactly what an AI manager should own` → `exactly what a manager should own`
- Rename `agents/skills/maya-platform/skill.md` → `SKILL.md` (Linux case-sensitive)

**Slice C — Skill bundling (22 maya-* skills)**
- Massively expand `BUNDLED_SKILLS` in `convex/agents/packs/maya/workspace/skillsRegistry.ts` to include all 22 existing `agents/skills/maya-*/` skills (or implement `scripts/sync-bundled-skills.ts` to do it at deploy)
- Add `metadata.openclaw` frontmatter to all 22 maya-* `SKILL.md` files (env requirements, primary env var, tags) per OpenClaw skill convention

**Slice D — ClawHub pins + Anthropic vendor**
- Update `convex/creatorMayaV0/pinnedClawhubSkills.ts`:
  - Drop `remotion-video-toolkit@1.4.0` (misaligned — NemoVideo is the right pick)
  - Verify `tiktok@3.0.0` value vs `scrapecreators-api`; drop if redundant
  - Add: `vcarolxhberger/free-video-generator-capcut@1.0.0`, `steipete/video-frames@1.0.0`, `theplasmak/faster-whisper@1.5.1`, `paulasjes/elevenlabs-transcribe@1.0.1`, `psyduckler/instagram-photo-text-overlay@1.0.0`, `steipete/brave-search`
- Vendor `pdf`, `docx`, `internal-comms` from `anthropics/skills` repo into `agents/skills/`. Pin versions in a manifest file. Defer `xlsx`. Skip `pptx`/`frontend-design`/etc.
- Update `agents/skills/maya-platform/SKILL.md` (newly renamed in Slice B) to reflect new ClawHub policy

### NEW — Sprint 1 carry-forward (do NOT skip)

**Production `convex/onboarding/maya/deployMaya.ts` still uses `--bind lan --port 3000`.** This will crash-loop the gateway in v2026.4.23 with the same `controlUi.allowedOrigins` error the smoke just hit. Service product already migrated 2026-04-28 (`convex/onboarding/business/deployServiceMaya.ts:280` uses `exec openclaw gateway --allow-unconfigured`).

- Update `convex/onboarding/maya/deployMaya.ts:buildBootstrapShell()` to mirror the service shape: drop `--bind lan --port 3000`, use `--allow-unconfigured`.
- Verify by running `npm run smoke:creator-maya-v0 -- --confirm` end-to-end against the new bootstrap.

### Real-world bar

- `npm run smoke:creator-maya-v0 -- --confirm` deploys a real test creator to Fly + exits 0
- SSH into the deployed Fly machine: `flyctl ssh console -a <test-app>`
  - `ls /data/workspace/` — confirms 11 expected files (AGENTS, SOUL, IDENTITY, USER, MEMORY, HEARTBEAT, BOOT, TOOLS, DREAMING, cron/, skills/)
  - `cat /data/workspace/SOUL.md` — confirms SEED-only content, NO picture data
  - `cat /data/workspace/IDENTITY.md` — confirms name=Maya
  - `ls /data/workspace/skills/` — confirms ≥30 skills present (22 maya-* + 6 ClawHub + 3 Anthropic + 7 OpenClaw built-ins, minus duplicates)
- `grep -ri "AI creator manager\|as an AI\|I'm an AI\|AI assistant\|I'll synthesize" /data/workspace/` — returns ZERO hits
- Maya posts a welcome message to the test creator's iMessage (via claw-messenger). Operator manually grades voice (must read as coach, no chatbot leakage, no banned terms, no menus).
- Voice fixture (`tests/mayaVoice.test.ts`) extended to grep generated SOUL.md, AGENTS.md, USER.md, MEMORY.md output strings against banned-term list — passes
- Cron `[cron] started` observed on the deployed machine (regression check on Sprint 1 win)
- Optional but recommended: at least one cron tick fires successfully (Sprint 1 deferred this; the production workspace has tooling so we can finally test the round-trip)
- All 5 mandatory categories pass + tsc + vitest clean

### Definition of done

`assembleWorkspaceBundle.ts` is the single deploy path; old `workspaceManifest.ts` generators deleted; SOUL.md + IDENTITY.md generators wired and tested; voice leaks zero across user-facing surfaces; all skills present in deployed workspace; production gateway boots cleanly on v2026.4.23; commit + push.

---

## What's locked (operator-confirmed prior session, still active)

### Architecture
- 5 layers: OpenClaw runtime → universal skills → memory-wiki → Convex (data only) → claw-messenger channels (iMessage)
- No web UI for creators in MVP. Receipt-only landing + Stripe checkout + Clerk login.
- Generate-at-deploy for the workspace bundle. Maya owns mutation post-boot via OpenClaw's native paths.
- OpenClaw natives never reimplemented.

### Product positioning
- Coach + Manager tier names kept (operator stuck with this)
- Maya is advisory + delegated production
- Single-tier MVP for friend cohort, comped via admin flag
- iMessage-only, TikTok-only, single platform

### Integrations
- Email path = Composio Gmail (production-grade webhooks already wired)
- Calendar path = direct Google OAuth (we have read+write scopes + token refresh)
- Apple Calendar dropped from MVP

### Skills
- 6 ClawHub pins at deploy (see Slice D above)
- 3 Anthropic vendor: `pdf`, `docx`, `internal-comms`. Defer `xlsx`.
- 22 existing custom Maya skills in `agents/skills/maya-*/` — bundle them all in Sprint 2.
- 11 new custom Maya skills to write across Sprints 5-7.

### Cron + heartbeat (Sprint 3)
- 6 cron entries only: morning_brief (7am), evening_recap (7pm), weekly_content_plan (Sun 4pm), weekly_review (Sun 9pm), accountability_nudge (daily 10am, conditional), revenue_snapshot (Mon 9am)
- 9 standing orders move to HEARTBEAT.md
- 6 standing orders DELETE for MVP
- Heartbeat tick at `low` thinking budget; per-check escalates

### Test creator (operator-provided for live smokes)
- TikTok handle: `Kevin.Castro9996`
- Phone: `+1 631-335-7603`

---

## Operator preferences refresher

- Anti-sycophancy expected. Push back when wrong. Opinions, not options.
- Native-first rule is locked. Don't reinvent OpenClaw.
- Install-first rule — search ClawHub / Anthropic / Claude Code repos before writing mechanics. Custom-author only the Maya judgment wrapper.
- Trust LLM judgment, no hardcoded rules.
- No "AI" in marketing copy — extends to runtime user-facing prose.
- Maya is one product, two pricing tiers — not two products.
- Commit + push at end of every sprint in logical chunks.
- Full autonomy to MVP — once a sprint lands clean, spawn the next automatically.
- Operator wants real-world verification per sprint, not just unit tests. Run live smokes (don't ask permission).
- Each Fly smoke iteration costs ~5 min real time. Iterate efficiently. Read OpenClaw runtime source on the live machine over SSH when the schema isn't obvious.

---

## How to start next session

1. Read `docs/SPRINT_PLAN_CREATOR_MVP.md` — Sprint 1 marked DONE; read Sprint 2 spec.
2. Read this file — Sprint 2 starting state above.
3. Confirm `git status` is clean on `staging`, last commit `00e82bb`.
4. Run `npx vitest run --reporter=dot` and `npx tsc --noEmit` — both should be clean.
5. Spawn the 4 parallel slice agents for Sprint 2 (A: deploy paths, B: voice leaks, C: skill bundling, D: ClawHub + Anthropic vendor) — plus the carry-forward fix to `deployMaya.ts:buildBootstrapShell()`.
6. After all 4 slices land + tests green: run `npm run smoke:creator-maya-v0 -- --confirm` end-to-end against real Fly. SSH-verify workspace + skills. Commit + push.

---

## Open / non-blocking

- 16+ stale agent worktrees from prior sessions; clean post-MVP.
- Pre-existing `creator-maya-v0-fly-smoke` harness uses `submitOnboarding` flow — still needs to be reconciled with the new onboarding flow that lands in Sprint 6. Both paths can coexist until then.
- Composio OpenClaw plugin install (per `memory/project_composio_openclaw_plugin_pending.md`) — queued post-MVP.
- Orphaned Convex smoke endpoints (`/smoke/cron_heartbeat/insert_creator`, `/smoke/cron_heartbeat/list`, `/smoke/cron_heartbeat/delete_creator`) are no longer called by the new cron-fly-smoke. Cleanup is a low-priority nit.

---

## What MVP is NOT

- Voice calls (Twilio outbound) — defer
- Auto-send brand emails — Manager-tier autonomy gate, defer (drafts only in MVP)
- Apollo/Hunter outbound brand outreach — Studio-tier, defer
- Apple Calendar — Google-only
- Web HQ for creators — receipt-only landing, no UI
- Multi-tier billing differentiation — single comped tier for friend cohort
- Multi-platform — TikTok only
- Telegram / WhatsApp / SMS — iMessage only
- Postiz / multi-platform draft scheduling — defer (TikTok-only positioning)

When operator asks to add scope, push back to keep MVP tight unless it's a beta-blocker.
