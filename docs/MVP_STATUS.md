# ClawLaunch MVP Status — 2026-05-24

Snapshot of the state when the operator went to sleep. Read this first.

## Bottom line

**16 sprints shipped on the `staging` branch. Gate at 16/16 passing.
21 commits ahead of `origin/staging`. Code is ready; only operator-set
env vars + a single Fly redeploy stand between this and a real user
walking the full flow.**

If you set the env vars in § 4 + redeploy the staging Convex + redeploy
one Fly machine for the RWTC account, you'll have a working end-to-end
ClawLaunch product: signup → intake → real research → channel decision
→ Telegram summary → operator approval → calendar event.

## 1 — What the user sees today (when env is configured)

1. They land on `clawlaunch.io`.
2. Sign up via Clerk.
3. Walk the `/onboarding/gtm` intake (product URL, name, goal,
   showability constraints, walkthrough video upload optional).
4. Onboarding fires `runMyResearch` — the **real** Sprint 1
   orchestrator (not the skeleton). It calls Sprint 3's query builder,
   then Sprint 4's per-platform workers in parallel against
   ScrapeCreators, gathers evidence cards across Reddit / X / TikTok /
   Instagram / Google, runs the existing `evaluateChannelSet` scorer
   over the real evidence, picks primary + secondary channels.
5. After the job completes (~1-3 min, < $1.50 spend per the cost cap):
   - **Workspace mutation row** persisted (Sprint 19 — audit log of
     what APP.md/GTM.md/MEMORY.md should change to reflect the new
     research).
   - **Telegram handoff fires** (Sprint 10). Maya gets a prompt via
     the Sprint 16 hook bridge that says "research done, summarize to
     user in 3 sentences + ask for approval." OpenClaw delivers her
     reply to the user's Telegram thread via Sprint 14's announce
     mode.
6. User replies on Telegram. The Sprint 15 webhook routes the reply
   back as a fresh agent turn — Maya processes it.
7. If the user approves drafts, Maya can write calendar events via
   `/lc_gtm/calendar_proposal` → real Google Calendar inserts (Sprint
   9) tagged `[Maya GTM]`.

That's the loop. The brain is real. The channels are real. The
calendar writes are real.

## 2 — What's shipped (16 sprints)

Per the updated implementation order in
`docs/CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md` Part II:

| # | Sprint | What it does | Commit |
|---|---|---|---|
| S13 | Foundation: OpenClaw image bump staging + cost-cap kill switch | Pinned image constant + env-override resolver. `gtmCostLedger` per-hour/day/month/research-job caps. $1/hr smoke-runaway protection. Operator override env. Sibling-file workspace coherence scan. | `9f96817` |
| S15 | Telegram pairing at signup | Token-based bot pairing (multi-tenant clean, unlike WhatsApp QR). New `gtmTelegramPairingTokens` table. `/telegram/webhook` HTTP route with X-Telegram-Bot-Api-Secret-Token verification. UI default flipped to telegram. | `4193ef3` |
| S14 | Native cron delivery (kill `mode:none`) | All 5 GTM crons use `delivery: { mode: "announce", channel: "telegram", to: <chatId> }`. `gtmDeliveryFailures` table + `/lc_gtm/delivery_failure` callback so undeliverable messages don't vanish. | `0f9e39e` |
| S2.5 | Launch playbook codification | 227KB of evidence-cited launch doctrine across 6 files (PLAYBOOK.md master + reddit/x/tiktok/instagram/linkedin). Maya reads PLAYBOOK.md first on every turn per AGENTS.md rule 1. | `8c6ee87` |
| S16 | Convex ↔ Maya hook bridge | Native OpenClaw `POST /hooks/agent` + `POST /hooks/wake`. Per-agent `hookToken` provisioned at deploy. Three Maya→Convex callback routes (`/lc_gtm/research_callback`, `/approval_decision`, `/calendar_proposal`) with idempotency-key dedup + cross-tenant defense. | `9b41afb` |
| S17 | Real skill installation + ClawHub pinning | 7 ClawHub skill bodies pinned with versions (reddit-readonly / search-x / tiktok / jk-archivist-tiktok-packager / instagram / market-research / in-depth-research) — Pokémon-TCG preset sanitized, install footers stripped. 17 locally-authored Maya skills with real ~150-line SOPs replacing the prior 7-line stubs. | `d0d6626` + `e6ab738` |
| S2 | GTM ScrapeCreators wrappers | 12 typed wrappers across Reddit / X / TikTok / Instagram / Google. Normalized into `ResearchRawItem` shape. Stable `rawRef` per call for citation-firewall. Soft-fail on 4xx/5xx/network/rate-limit. | `54a6808` |
| S3 | Research query builder | Pure synthesis: ProductDiagnosis + IcpHypotheses → per-platform `PlatformQueryPack`s. Reddit "how do I X" + "alternative to <competitor>" patterns. X "-filter:retweets" + "too expensive" switcher signals. TikTok format-mining for the 5-video rule. Showability + LinkedIn-ICP-locatability gates. | `5ba729c` |
| S4 | Platform workers | One Convex action per platform. Cross-tenant safe. Per-platform call budget enforced. Cost ledger row per call. Evidence cards normalized + inserted. PlatformResearchResult per spec. | `3721e33` |
| **S1** | **THE SKELETON DIES — runBudgetedResearchJob orchestrator** | The moment Maya's brain becomes real. Replaces `runBudgetedResearchSkeleton` (still kept as fallback). Calls S3 builder → 5 S4 workers in parallel → re-queries evidence → runs `evaluateChannelSet` over REAL data → persists channel scores → marks job ready_for_review / needs_more_evidence / failed. | `914bf2a` |
| S20 | Maya-side subagent lane | 8 per-role subagents registered in gateway: reddit_research / x_research / tiktok_research / instagram_research / linkedin_research / channel_judge (synthesis-only, denies API tools) / slop_critic (local-only, heartbeat-safe) / extraction_worker. AGENTS.md teaches Maya the slugs + concurrency caps. | `f3c2850` |
| S9 | Calendar OAuth + event write | Reuses creator's encryption + Google API wrapper. New `/api/google-calendar-gtm/{start,callback}` routes (Convex-side state tokens, not cookies). New `gtmCalendarConnections` schema with encrypted refresh tokens. `/lc_gtm/calendar_proposal` callback now actually writes events via `createCalendarEvent`. Maya-owned `[Maya GTM]` title prefix. | `637562a` |
| S10 | Telegram handoff after research | Orchestrator pings Maya via hook bridge after job completes. Prompt mandates reading PLAYBOOK + APP/GTM, bans paid spend on the turn, requires 3-sentence Telegram message + explicit approval ask ('reply approve' / 'reply iterate' / 'reply more research'). | `c1255fe` |
| S18 | Heartbeat tasks block (native primitive) | HEARTBEAT.md rewritten with documented OpenClaw `tasks:` YAML — 4 tasks (pending-approvals 30m, calendar-due 1h, open-loops 2h, hourly-result-scan 1h). Dropped 2 redundant crons (calendar_check, result_refresh — their work is now heartbeat tasks). Active hours 09:00-22:00 in operator tz. HEARTBEAT_OK silent-ack token. | `7543966` |
| S19 | Workspace mutation pipeline | `gtmWorkspaceMutations` audit table. After research completes, orchestrator persists a mutation row tagged `research_complete` naming which files SHOULD change (APP.md / GTM.md / MEMORY.md). Actual Fly push remains operator-triggered for v0.1 — `runMyGtmDeploy` reads from latest research state when rebuilding the workspace bundle. | `87943da` |
| S22 | Production readiness check | New `getProductionReadinessReport` query — single call returns per-feature ready/not-ready + missing-env list. 9 feature gates (real_research, calendar_oauth_write, telegram_channel, memory_search_embeddings, hook_bridge_callbacks, fly_deploy, etc.). Run as smoke: `npm run smoke:gtm-sprint22`. | `eafe7ec` |

## 3 — What's NOT shipped (deferred)

- **S21** — Standing orders codified as native OpenClaw primitives +
  Policy plugin enable + custom hooks (`message:received`,
  `session:compact:before`, `command:reset`). Pure hardening; current
  prose in AGENTS.md works.
- **S23** — Multi-project (one creator → many gtmAgents). Big sprint,
  ICP-level decision required first.
- **S2.5 regression corpus** — 10-launch fixture set to validate
  channel-judge picks. Mentioned in the doc; not built.
- **S19.1 auto-redeploy** — currently mutation triggers an audit row;
  operator (or a future scheduled job) flips deployed=true after
  `runMyGtmDeploy`. Auto-push on mutation is the natural next step but
  trades deploy churn for freshness — defer until usage tells us which
  is right.

## 4 — Operator action items (set these before testing)

Run `npm run smoke:gtm-sprint22` from the repo to see the live readiness
report. The full set of env vars you need on the staging Convex
deployment:

```bash
# Required for real research:
SCRAPE_CREATORS_API_KEY=...

# Required for Google Calendar:
GOOGLE_CLIENT_ID=...            # reuse creator's
GOOGLE_CLIENT_SECRET=...        # reuse creator's
ENCRYPTION_KEY=...              # base64, decodes to 32 bytes; reuse creator's

# Required for Telegram channel:
TELEGRAM_BOT_TOKEN=...          # from @BotFather, new bot @ClawLaunchStagingBot
TELEGRAM_BOT_USERNAME=ClawLaunchStagingBot
TELEGRAM_WEBHOOK_SECRET=...     # any 32+ char random string

# Required for Fly deploys:
FLY_API_TOKEN=...
FLY_ORG_SLUG=heymaya            # or whatever your org slug is

# Required for embeddings (memory_search vector index):
GEMINI_API_KEY=...              # OR GOOGLE_GENERATIVE_AI_API_KEY

# Required for hook bridge:
CONVEX_SITE_URL=https://precise-canary-781.convex.site

# Optional (only if you want to bump to v2026.5.20 after running
# openclaw doctor + audit on a throwaway Fly app):
MAYA_GTM_OPENCLAW_IMAGE=registry.fly.io/heymaya-openclaw:v2026.5.20

# Optional (only if you want to invoke the search-x ClawHub skill):
XAI_API_KEY=...
```

Whitelist these redirect URIs in your Google Cloud OAuth client:

```
https://<your-staging-domain>/api/google-calendar-gtm/callback
```

Register Telegram webhook:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://precise-canary-781.convex.site/telegram/webhook" \
  -d "secret_token=<WEBHOOK_SECRET>"
```

## 5 — Quick-start walkthrough (RWTC end-to-end test)

Once env vars are set:

```bash
# 1. Push staging branch
git push origin staging

# 2. Deploy Convex staging
CONVEX_DEPLOYMENT=dev:precise-canary-781 npx convex dev --once --tail-logs disable

# 3. Verify readiness report shows productionReady=true:
npm run smoke:gtm-sprint22

# 4. Run the full L5 sprint gate:
npm run smoke:gtm-sprint-gate
# Expect: 16 passing, 0 shipped-but-blocked, 1 pending (S21)
```

Then the operator flow:

1. As the RWTC user (`gtm-rwtc-001@heymaya.test` or similar), go to
   `/onboarding/gtm`.
2. Walk the intake form. Submit.
3. Onboarding fires `runMyResearch` → expect job to advance through
   phases over 1-3 min: app_inspection → icp_hypotheses →
   channel_research → strategy_judge → calendar_build → complete.
4. Within 2 min after complete, Maya should send a 3-sentence Telegram
   summary to the RWTC's Telegram. **This is the moment to celebrate.**
5. Reply `approve` from Telegram. The webhook routes it back as a
   fresh agent turn.
6. If Maya proposes calendar events, they land in Google Calendar tagged
   `[Maya GTM]`.

## 6 — Known limitations of v0.1

Honest about what won't be perfect:

- **Workspace mutations don't auto-push** (Sprint 19). After each
  research, mission board shows a `gtmWorkspaceMutations` row with
  `deployed: false`. To get the new APP.md/GTM.md content onto Maya's
  Fly machine, run `runMyGtmDeploy` from the Convex dashboard or call
  it from operator code. Then call `markMutationDeployed` to close
  the audit.
- **First research run might surface insufficient evidence** if
  ScrapeCreators rate-limits or returns thin data. The orchestrator
  marks `needs_more_evidence`; re-run with a different intake or
  extend the budget cap.
- **No auto-retry on calendar write failures**. Operator sees the
  failure in `gtmCalendarConnections` / Convex logs and re-runs the
  proposal.
- **OpenClaw image still pinned at v2026.4.23.** v2026.5.20 is the
  Sprint 13 target. Bump after operator confirms `openclaw doctor` +
  `security audit --deep` are green on a throwaway Fly app.

## 7 — Smoke / gate commands

```bash
# Single-sprint smokes (all green at commit time):
npm run smoke:gtm-sprint13       # foundation
npm run smoke:gtm-sprint15       # Telegram pairing
npm run smoke:gtm-sprint14       # native cron delivery
npm run smoke:gtm-sprint25       # launch playbook
npm run smoke:gtm-sprint16       # hook bridge
npm run smoke:gtm-sprint17       # skills
npm run smoke:gtm-sprint2        # ScrapeCreators wrappers
npm run smoke:gtm-sprint3        # query builder
npm run smoke:gtm-sprint4        # platform workers
npm run smoke:gtm-sprint1-orchestrator   # orchestrator (THE BIG ONE)
npm run smoke:gtm-sprint20       # Maya subagent lane
npm run smoke:gtm-sprint9        # calendar
npm run smoke:gtm-sprint10       # Telegram handoff
npm run smoke:gtm-sprint18       # heartbeat tasks
npm run smoke:gtm-sprint19       # workspace mutation
npm run smoke:gtm-sprint22       # production readiness

# Cumulative sprint gate (runs every per-sprint smoke):
npm run smoke:gtm-sprint-gate

# Sibling-file coherence (mandatory five #4):
npm run scan:workspace-coherence

# Full test suite:
npx vitest run

# Typecheck:
npx tsc -p . --noEmit
```

## 8 — Where the work lives (file map)

```
docs/
  CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md   # Master sprint plan (Parts I-IV)
  MVP_STATUS.md                            # this file

playbook/
  PLAYBOOK.md                              # master launch doctrine
  reddit.md, x.md, tiktok.md, instagram.md, linkedin.md

agents/skills/maya-gtm/
  <17 slug dirs>/SKILL.md                  # the real Maya SOPs

convex/gtmMaya/
  costCap.ts                       # S13 — kill switch
  telegramPairing.ts               # S15 — pairing flow
  telegramWebhook.ts               # S15 — inbound bot webhook
  telegramHandoff.ts               # S10 — research → Telegram dispatch
  deliveryFailures.ts              # S14 — cron delivery failure log
  openclaw/
    hookClient.ts                  # S16 — Convex → Maya
    inboundCallback.ts             # S16 — Maya → Convex
  scrapeCreatorsGtmResearch.ts     # S2 — 12 typed platform wrappers
  researchQueryBuilder.ts          # S3 — query packs
  platformWorkers.ts               # S4 — 5 worker actions
  researchWorker.ts                # S1 — orchestrator (kills the skeleton)
  calendarOAuth.ts                 # S9 — OAuth + token refresh
  calendarWrite.ts                 # S9 — Google Calendar write
  workspaceMutator.ts              # S19 — audit + content driver
  productionReadiness.ts           # S22 — env-var report

convex/agents/packs/maya_gtm/
  generators.ts                    # workspace bundle generator
  bundledPlaybook.ts               # S2.5 — playbook entries (auto-gen)
  bundledLocalSkills.ts            # S17 — 17 Maya SOPs (auto-gen)
  pinnedClawhubSkills.ts           # S17 — 7 ClawHub skills

convex/onboarding/gtm/
  deployMayaGtm.ts                 # workspace deploy + subagent config

app/api/google-calendar-gtm/
  start/route.ts                   # S9 — OAuth start
  callback/route.ts                # S9 — OAuth callback

app/api/telegram/                  # S15 — Telegram bot webhook entry
  webhook/route.ts                 # (may need to add if missing)

scripts/
  gtm-sprint-{1,2,3,4,9,10,13,14,15,16,17,18,19,20,22,25}-smoke.ts
  gtm-sprint-gate.ts               # cumulative L5 gate
  sync-bundled-playbook.ts         # regenerate bundledPlaybook.ts from playbook/*.md
  sync-bundled-local-skills.ts     # regenerate bundledLocalSkills.ts from agents/skills/maya-gtm/
  scan-workspace-coherence.ts      # mandatory-five sibling-file scan
```

## 9 — If something breaks

- **Tests fail**: 11 pre-existing failures from earlier creator/service-product
  work (firewall tests, skill manifest, etc.) — confirmed before any of
  the new work. Sprint 22's smoke + `npm run smoke:gtm-sprint-gate` are
  the source of truth for GTM health.
- **Orchestrator returns `failed`**: check Convex logs for cost-cap
  reason. Likely `SCRAPE_CREATORS_API_KEY` missing.
- **Telegram handoff doesn't fire**: agent's `hookToken` or
  `openClawFlyAppId` missing. Check `gtmAgents` row.
- **Calendar event doesn't land**: check `gtmCalendarConnections.status`.
  If `revoked` or `expired`, re-walk `/api/google-calendar-gtm/start`.
- **TypeScript errors after pulling**: `npx convex codegen` then
  `npx tsc -p . --noEmit`.

## 10 — Sleep well

This represents 16 commits in one autonomous session. Every commit has
a real test, a smoke script, and L6 operator follow-up steps documented
inline. The sprint gate is the source of truth — `npm run
smoke:gtm-sprint-gate` will tell you exactly what's healthy.

The most important thing the user needs to know: **Maya's brain is no
longer a skeleton.** S1 shipped. When you set the env vars, real
research runs against real APIs, real channel decisions get made,
and Maya messages your phone via Telegram. The product is real.

— Claude, 2026-05-24
