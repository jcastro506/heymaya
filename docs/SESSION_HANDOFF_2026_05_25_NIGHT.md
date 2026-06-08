# Session handoff — 2026-05-25 night

**For the next Claude picking up this work.** This is what happened tonight, what state the code is in, and what's next.

## TL;DR

- **Shipped:** Sprints 2.16f / 2.16g / 2.16h / 2.16i (Dockerfile only, image not rebuilt).
- **Working:** Maya boots, gateway ready in ~12 sec, Telegram plugin installs in ~4 sec, Maya sends her first hello at ~T+14min.
- **Broken:** Maya's NEXT turn (after the hello) returns `stopReason=stop payloads=0` — empty completion. Gemini 3.5 Flash satisficed on a too-dense 6-step boot prompt.
- **Proposed:** Sprint 2.16j — BOOT.md + one-shot cron tasks + HEARTBEAT.md state machine. Not shipped. Operator approved direction but did NOT green-light implementation before context got cleared.

## What shipped this session

### Sprint 2.16f — Convex research orchestrator deleted (`commit 2071a9c`)

Three surgical cuts:

1. **`convex/_admin/realWorldDeployGtm.ts` `run` action** — removed `runBudgetedResearchJob` call. Deploy flow is now: wipe → seed → Fly deploy. Output now shows `"research": {"skipped": true, "reason": "Sprint 2.16f — Maya owns research loop natively"}`.

2. **`convex/onboarding/gtm/deployMayaGtm.ts`** — removed the hardcoded deploy-time Telegram hello. Maya now sends her own intro via STEP 1 of the boot prompt. Records `"skipped:maya_owns_hello_in_boot_prompt"` for the audit trail.

3. **`convex/agents/packs/maya_gtm/generators.ts` boot prompt STEP 2** — changed from "read pre-baked channel decisions from GTM.md" to "pick channels yourself from APP.md, then spawn _research subagents."

### Sprint 2.16g — sessions_yield phantom-tool fix (`commit 473f4a5`)

Boot prompt referenced `sessions_wait` which doesn't exist in OpenClaw. Verified against the 2026.4.23 source tree at `/tmp/openclaw-source/`. The real tool is `sessions_yield` (in `DEFAULT_TOOL_ALLOW`). Boot prompt now correctly says "call `sessions_yield`. DO NOT poll sessions_list. `sessions_wait` is NOT a real tool."

### Sprint 2.16h — LLM idle timeout 300s (`commit b9e2a98`)

Added `agents.defaults.llm.idleTimeoutSeconds: 300` to gateway config. Bumps the LLM idle watchdog from the default ~120s to 300s so Gemini 3.5 Flash with high thinking doesn't trip mid-stream on multi-step prompts.

**Important correction from prior session:** the prior Claude claimed `models.providers.openrouter.timeoutSeconds` didn't exist in OpenClaw's schema. That was wrong — both that key AND `agents.defaults.llm.idleTimeoutSeconds` are valid. The runtime error message at `pi-embedded-sj59rpw_.js:2374` literally names the latter as the fix.

### Sprint 2.16i — Dockerfile preseed (`commit 0b8a9a7`) — IMAGE NOT REBUILT

Added grammy, @grammyjs/runner, @grammyjs/transformer-throttler to `/opt/openclaw-runtime-preseed/plugin-runtime-deps/` in `infra/openclaw-runtime/Dockerfile`. Verified against OpenClaw 2026.4.23's `dist/extensions/telegram/package.json` — those are the 3 packages the Telegram extension actually needs at runtime (the prior session's claim of 5 missing packages was wrong — `node-edge-tts` is microsoft extension, `undici` is transitive from openclaw root).

**Operator must run** the rebuild + push to take effect:
```bash
cd infra/openclaw-runtime
docker buildx build --platform linux/amd64 \
  -t registry.fly.io/heymaya-openclaw:v2026.4.23 \
  -t registry.fly.io/heymaya-openclaw:latest \
  --push .
```

Until then, current image still has the runtime npm install on first turn (observed ~4 sec in latest deploy — better than the 5-28 min the prior session feared, but the preseed fix will eliminate it entirely).

### Admin tooling shipped (still in tree)

- `_admin/realWorldDeployGtm:destroyAllClawlaunchApps` — nukes every `clawlaunch-*` Fly app. Used to clear all 4 orphaned machines at ~8pm EDT.
- `_admin/realWorldDeployGtm:inspectLatestFlyMachine` — returns machine state + events.
- `_admin/realWorldDeployGtm:tailLatestMaya` — attempted Fly logs fetch via GraphQL. **DOESN'T WORK** — Fly deprecated `app.logs` and `app.vmLogs`. Operator ran `flyctl logs` themselves; that's the working path.

## The current bug (observed in latest deploy)

Deployed `clawlaunch-ws75xrx6zngxv7ah25` at 7:55pm EDT. From `flyctl logs`:

```
2026-05-26T00:04:18Z [gateway] ready (1 plugin: telegram; 12.1s)
2026-05-26T00:04:18Z [heartbeat] started
2026-05-26T00:04:18Z [telegram] [default] starting provider (@Tommymmymmymm_bot)
2026-05-26T00:09:36Z [plugins] microsoft installed bundled runtime deps: node-edge-tts@^1.2.10
2026-05-26T00:10:29Z [telegram] Polling stall detected (active getUpdates stuck for 159.05s); forcing restart
2026-05-26T00:14:40Z [agent/embedded] incomplete turn detected: runId=6bf2aa64-826e-4b37-b2d4-6fe825da7e37
                                       stopReason=stop payloads=0 — surfacing error to user
```

Maya sent her STEP 1 hello successfully at ~T+14min: `"Hey - Maya. I in. Going to spend the next 30-60 min..."`. Immediately after, her NEXT turn (STEP 2: pick channels + spawn subagents) — Gemini 3.5 Flash returned an empty completion. Zero tool calls, zero text, just `stopReason=stop`.

**Root cause (high confidence):** the boot prompt at `convex/agents/packs/maya_gtm/generators.ts:654-721` is 6 dense steps × hundreds of words. The model satisficed after STEP 1 (a clear achievable goal) and returned nothing for STEP 2. Prompt density problem, not infrastructure.

**Side observations:**
- USER.md `[name]` placeholder leaked in hello → "Hey - Maya" (synth deploys have no real name; real Clerk users will).
- Apostrophes stripped — "I in" instead of "I'm in" — slop critic or encoding strip.
- microsoft plugin installed `node-edge-tts@1.2.10` at T+5min (another preseed gap, future).
- Telegram polling had a 159s stall, recovered with IPv4 sticky dispatcher fallback (grammy bug — monitor).

## Architectural insight (verified, NOT YET ACTED ON)

**BOOT.md is a real OpenClaw primitive, distinct from HEARTBEAT.md.** Verified:

- Lives in workspace alongside `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, etc.
- Fires once on gateway startup.
- Requires `hooks.internal.enabled: true` in gateway config (real schema field at `zod-schema.d.ts:3789-3790`).
- Docs: https://docs.openclaw.ai/reference/templates/BOOT and https://docs.openclaw.ai/concepts/agent-workspace

**Other primitives confirmed against schema:**

- `sessions_yield` is real, in `DEFAULT_TOOL_ALLOW`.
- `sessions_wait` does NOT exist — phantom tool that broke prior sessions.
- Subagent lane default concurrency = **8** (we're at 4 in config — could double).
- Main lane default = 4.
- `deleteAfterRun: true` is a real flag for one-shot cron tasks (we already use it).
- 48-hour default session timeout (`DEFAULT_AGENT_TIMEOUT_SECONDS = 2880 * 60`).
- `agents.defaults.heartbeat.every` controls steady-state cadence (default `"30m"`).

## Sprint 2.16j — proposed, not yet shipped

The actual fix for the empty-completion bug. Two-tier scheduling using native OpenClaw primitives instead of one giant boot prompt:

| Trigger | When | What it does | Lifecycle |
|---|---|---|---|
| **BOOT.md** | Gateway startup | Reads APP.md + USER.md, sends hello via `/lc_gtm/send_update`, exits | Native, fires once. Requires `hooks.internal.enabled: true`. |
| `0001_pick_channels` cron | T+2 min | Reads APP.md, picks channels from product context, writes to GTM.md, exits | One-shot, `deleteAfterRun: true` |
| `0002_dispatch_research` cron | T+4 min | Reads GTM.md, spawns research subagents (concurrency 8), yields | One-shot, `deleteAfterRun: true` |
| (push resume) | When subagents complete | Synthesizes plan, populates calendar, validates via `/lc_gtm/validate_outbound`, sends final Telegram message | Native push-resume, not scheduled |
| **HEARTBEAT.md** | Every 30 min (forever) | Daily morning brief, evening review, weekly refresh, monthly channel discovery, safety net for stuck states | `agents.defaults.heartbeat.every: "30m"` |

After the 3 one-shot crons fire + delete themselves, only the 30-min heartbeat remains. Steady state is clean.

**Expected wall-clock to first plan in Telegram: ~20 min from deploy.**

**Files to change** (single sprint, ~1 hour):
- `convex/agents/packs/maya_gtm/generators.ts`:
  - Add `hooks.internal.enabled: true` to gateway config
  - Replace single `0001_gtm_first_research` cron with `0001_pick_channels` + `0002_dispatch_research` (smaller, focused, single-action turns)
  - Rewrite BOOT.md content to just send hello
  - Rewrite HEARTBEAT.md as a state machine: check workspace, do next ONE thing, exit
  - Bump `subagents.maxConcurrent: 4 → 8`
- `convex/agents/packs/maya_gtm/__tests__/generators.test.ts` — update assertions
- `scripts/__tests__/gtm-openclaw-fly-smoke.test.ts` — update assertions

## Open architectural questions (deferred)

- **Per-customer Fly machine vs multi-tenant gateway.** Today: one Fly machine per Maya. OpenClaw supports many agents/workspaces in one gateway. Multi-tenant is the right cost shape at 100s/1000s of users but Sprint 7+ work.
- **Telegram bot strategy at scale.** Today: one shared bot, per-Maya `dmPolicy: "allowlist"`. Polling stall observed. When to split to per-customer bots?
- **Calendar integration.** Today: Convex-native `gtmCalendarEvents` rows. Should it be Google Calendar instead?

## Cost context

- Each deploy now costs ~$1-3 of LLM (no more Convex orchestrator $0.46). ~6-8 deploys today = $10-25 OpenRouter burn.
- Steady-state daily target: <$0.50/day/Maya.
- Operator wants to NOT redeploy unless we have a real reason.

## Operator posture

- Frustrated by 16+ sprints with no working end-to-end loop. Wants to see a real research-backed plan land in Telegram before any more polish.
- Strong preference: trust OpenClaw, give Maya a goal + tools + skills, let her work until done.
- Has been shopping the HeyMaya architecture for second opinions in other Claude sessions. Most recently received a brief recommending BOOT.md + HEARTBEAT.md state machine + multi-tenant gateway — verified mostly correct (subagent lane 8 is real, mudrii/openclaw-docs and VoltAgent/awesome-openclaw-skills repos are real). Some claims unverified (CVE-2026-25253, ClawHavoc, "5,400+ skills" actually ~5,200).

## Tools / commands to remember

- **Fresh Maya deploy:**
  ```bash
  npx convex run _admin/realWorldDeployGtm:run '{"productName":"ModelHub","productUrl":"https://studio.consciousengines.com/model-hub","founderWhy":"local LLM workflows on Mac feel disjointed","weekGoal":"signups","stage":"live-beta","budgetUsd":0.5,"deployFly":true,"telegramChatId":"8376373926"}'
  ```
- **Push Convex changes to dev** (NOT `npx convex deploy` — that's prod):
  ```bash
  npx convex dev --once
  ```
- **Destroy all Maya machines:**
  ```bash
  npx convex run _admin/realWorldDeployGtm:destroyAllClawlaunchApps
  ```
- **Check Maya activity:**
  ```bash
  npx convex run _admin/realWorldDeployGtm:gradeLatestSynth
  ```
- **Inspect Fly machine state:**
  ```bash
  npx convex run _admin/realWorldDeployGtm:inspectLatestFlyMachine
  ```
- **Tail Fly logs** (NOTE: `set -a; source .env.local` fails because token has spaces in it):
  ```bash
  export FLY_API_TOKEN=$(grep '^FLY_API_TOKEN=' .env.local | sed 's/^FLY_API_TOKEN=//')
  flyctl logs -a clawlaunch-<id> --no-tail
  ```

## Where to pick up

1. Read this doc + `/memory/session_handoff_sprint_2_16f_through_2_16j_proposed_2026_05_25_night.md`.
2. Confirm with operator: ship Sprint 2.16j now, or different approach?
3. If shipping, the file to edit is `convex/agents/packs/maya_gtm/generators.ts`. Tests live at `convex/agents/packs/maya_gtm/__tests__/generators.test.ts` and `scripts/__tests__/gtm-openclaw-fly-smoke.test.ts`.
4. After code changes: `npx convex dev --once` to push to dev, then `npx convex run _admin/realWorldDeployGtm:run '{...}'` to deploy a fresh Maya.
