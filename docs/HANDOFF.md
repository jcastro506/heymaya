# Session Handoff — 2026-05-06

**Status:** Comprehensive 5-agent code audit complete. Creator MVP sprint plan locked.
**Next move:** Sprint 1 — SSH-debug live Fly cron smoke until it's green.

---

## Where we are

We just finished a deep architecture + code audit before any more execution. Five agents ran in parallel:
1. Workspace bundle audit
2. Skill-by-skill audit
3. Composio + Apple Calendar integration audit
4. Cron + heartbeat collapse + thinking budget audit
5. ClawHub deep registry research (with delegated-production lens)

The audits surfaced concentrated debt — not pervasive — and ratified that fix-in-place is the right call (no v2 fork). The plan that came out of it is now locked at:

### Read in order

1. **`docs/SPRINT_PLAN_CREATOR_MVP.md`** — the locked plan. 9 sprints with real-world bars between each.
2. **This file** — what state we're in, what to do next.
3. `CLAUDE.md` — already in default context.
4. `~/.claude/projects/-Users-joshcastro-Desktop-heymaya/memory/MEMORY.md` — auto-memory index. Latest handoff at top.

---

## Branch + commit state

- **Branch:** `staging` (pushed)
- **Last commit:** `adae6d3` — "Fix pre-existing tsc errors blocking Convex deploy"
- **Tests:** 2673/2673 passing
- **tsc:** clean
- **Sprint 0 done:** Wave 0a cleanup + Wave 0b cron unkill + Wave 0c tsc fixes all merged + pushed.

### Held worktree (intentional)
- `worktree-agent-afcdc3dfb46ae2741` (commit `73226a1`) — Wave 3.5 voice rewrite. Held per operator decision: salvage the voice fixture + banned-term list as the regression net; drop the prose changes (they polished downstream while upstream prompts still leaked "AI"). Fold the salvageable parts into Sprint 2.

### Non-blocking
- ~16 other agent worktrees from prior sessions remain (`git worktree list`). Cleanup is post-MVP; doesn't block anything.

---

## What's locked (operator-confirmed this session)

### Architecture
- **5 layers:** OpenClaw runtime → universal skills → memory-wiki → Convex (data only) → claw-messenger channels (iMessage)
- **No web UI for creators in MVP.** Receipt-only landing + Stripe checkout + Clerk login.
- **Generate-at-deploy** for the workspace bundle. Maya owns mutation post-boot via OpenClaw's native paths (memory-wiki, dreaming, file edits).
- **OpenClaw natives never reimplemented.** Cron, heartbeat, memory, dreaming, channels, TaskFlow, sessions, approvals, image gen, web search.

### Product positioning
- **Coach + Manager** tier names kept (operator stuck with this; positioning beats architectural argument for "Assistant")
- **Maya is advisory + delegated production.** Creator can ask Maya to edit clips, transcribe, generate thumbnails — Maya does it. Not pure-advisory.
- **Single-tier MVP** for friend cohort, comped via admin flag. Coach/Manager autonomy split deferred until post-MVP signal.
- **iMessage-only**, TikTok-only, single platform.

### Integrations
- **Email path = Composio Gmail** (production-grade webhooks already wired)
- **Calendar path = direct Google OAuth** (we have read+write scopes + token refresh; need new iMessage-tap callback that bypasses Clerk session)
- **Apple Calendar dropped from MVP.** Three hard blockers (no OAuth, CalDAV requires manual app-specific password, no webhooks). iPhone-only-Apple-Calendar users get the "add iCloud to Google Calendar (3 min)" message.

### Skills
- **6 ClawHub pins** at deploy: `vcarolxhberger/free-video-generator-capcut@1.0.0`, `steipete/video-frames@1.0.0`, `theplasmak/faster-whisper@1.5.1`, `paulasjes/elevenlabs-transcribe@1.0.1`, `psyduckler/instagram-photo-text-overlay@1.0.0`, `steipete/brave-search`
- **3 Anthropic vendor:** `pdf`, `docx`, `internal-comms`. Defer `xlsx`.
- **22 existing custom Maya skills** in `agents/skills/maya-*/` — bundle them all in Sprint 2.
- **11 new custom Maya skills** to write across Sprints 5-7: `maya-trend-watcher`, `maya-idea-generator`, `maya-picture-verifier`, `maya-gmail-read`, `maya-gmail-draft`, `maya-calendar-read`, `maya-calendar-write`, `maya-clip-editor`, `maya-thumbnail-maker`, `maya-transcribe`, `maya-caption-generator`.
- **OpenClaw built-ins** to install: `summarize`, `video-frames`, `taskflow`, `taskflow-inbox-triage`, `web-search` (Brave), `session-logs`, `model-usage`, `skill-creator`.

### Drops
- `remotion-video-toolkit@1.4.0` ClawHub pin — misaligned (editing-shape, cloud-rendered NemoVideo is better fit)
- `tiktok@3.0.0` ClawHub pin — verify against `scrapecreators-api` custom; likely redundant
- 13 prose-only `creator-*` skills in `convex/creatorMayaV0/workspaceManifest.ts` — duplicates of `maya-*` family

### Cron + heartbeat
- **6 cron entries only:** morning_brief (7am), evening_recap (7pm), weekly_content_plan (Sun 4pm), weekly_review (Sun 9pm), accountability_nudge (daily 10am, conditional), revenue_snapshot (Mon 9am)
- **9 standing orders move to HEARTBEAT.md:** performance_check_2h, daily_niche_scan, trend_watcher, comment_triage, competitor_watch, calendar_lookahead, industry_intel_daily, opportunity_scout_daily, collab_matchmaker_weekly
- **6 standing orders DELETE for MVP:** manager_readiness_packet_quarterly, all 5 algo_research_* entries

### Thinking budgets
- **Heartbeat tick at `low`** — routing call, not reasoning. Per-check escalates to its own budget (e.g., brand-email-triage runs at `high` when fired from inside the tick). Cost reasoning: at `high` heartbeat globally = ~$15/creator/month routing layer alone (75% of $19.99 Coach).
- New task tags: `heartbeat_tick: low`, `pre_post_scorer: high`, `underperformance_diagnoser: high`, `picture_verification: medium`, `revenue_snapshot: low`
- Raise `weekly_content_plan` from medium → high (matches CLAUDE.md spec)

### Test creator (operator-provided for live smokes)
- TikTok handle: **`Kevin.Castro9996`** (operator's test handle)
- Phone: **`+1 631-335-7603`**

---

## Critical audit findings to address

### Blocking (Sprint 1-2)
1. **Live Fly cron smoke is RED.** Wave 0b removed `OPENCLAW_SKIP_CRON=1` env var, but real Fly deploy didn't show `cronHeartbeat` row in Convex within 90s. flyctl logs timed out. **Sprint 1 = SSH into Fly during smoke + diagnose root cause + fix.** Add `--keep-alive` flag to `scripts/cron-fly-smoke.ts`.
2. **Two parallel deploy paths exist.** Live (`creatorMayaV0/workspaceManifest.ts`) is the worse one — 17-line AGENTS.md stub, SOUL.md mistargeted as creator picture data, no IDENTITY.md, no BOOT.md. Legacy (`assembleWorkspaceBundle.ts`) is richer (305-line AGENTS.md, correct BOOT.md) but missing SOUL.md generator. **Sprint 2 = consolidate to legacy/richer path + write missing SOUL.md generator.**
3. **22 `maya-*` skills are orphaned.** `BUNDLED_SKILLS` ships only `scrapecreators-api`. Maya boots, reads "consult maya-citation-firewall," can't find it. **Sprint 2 = bundle all 22 + add `metadata.openclaw` frontmatter.**

### Voice leaks (Sprint 2)
Strip "AI" / "synthesize" / chatbot phrasing at these 5 specific sites:
- `convex/onboarding/maya/synthesizeCreatorPicture.ts:995` (synthesis prompt embeds "Maya's tagline is 'your AI creator manager'")
- `agents/skills/maya-platform/playbook.md:17` ("You are an AI creator manager.")
- `convex/agents/packs/maya/workspace/generateAgentsMd.ts:80` ("single-creator AI manager")
- `convex/agents/packs/maya/workspace/generateAgentsMd.ts:92` ("the creator's AI manager")
- `agents/skills/maya-content-cross-poster/SKILL.md:31` ("exactly what an AI manager should own")

Plus rename `agents/skills/maya-platform/skill.md` → `SKILL.md` (Linux case-sensitive).

### Bulk pull gap (Sprint 4)
- `tiktok.audience` wrapper exists at `convex/integrations/scrapeCreators/endpoints.ts:1016-1026` but isn't called from `runFullScrapePull.ts` → `creatorPicture.audience` always empty → USER.md emits "not yet provided"
- `tiktok.following` not wrapped — add wrapper, call from bulk pull
- Credit budget: TikTok audience endpoint is **26 credits/handle** vs 1 for everything else. Gate to handles >5K followers.

### Hardcoded chatbot fallbacks (Sprint 8)
- `convex/dealTriage.ts:269-273` (4 hardcoded reply variants — "Hi ${brand}, thanks for reaching out…")
- `convex/creatorMayaV0/dailyBrief.ts:160-167` (morning brief template — "Reply 'draft' for the shot list…")
- `agents/skills/maya-platform/playbook.md:233/235-237/245/340` (locked first-boot prompts, OAuth offers, gating messages)

Delete templates; route through skills. Tests mock skill output.

### Memory-wiki underuse (Sprint 8)
Zero `wiki_apply` callsites today. The 21 standing orders write to specialized Convex tables (`weeklyLearnings`, `competitorObservations`, `trendObservations`) instead of memory-wiki. Dreaming has nothing to compile. **Sprint 8 = rewrite high-frequency learning skills to call `wiki_apply`; downgrade Convex tables to read-only projections (or delete).**

---

## Operator preferences refresher

- **Anti-sycophancy expected.** Push back when wrong. Opinions, not options.
- **Native-first rule** is locked. Don't reinvent OpenClaw.
- **Install-first rule** — search ClawHub / Anthropic / Claude Code repos before writing mechanics. Custom-author only the Maya judgment wrapper.
- **Trust LLM judgment, no hardcoded rules** — no vertical lookup tables, weighted-composite scores, threshold triggers on qualitative properties.
- **No "AI" in marketing copy** — extends to runtime user-facing prose. System prompts that reach the model are allowed where technically correct.
- **Maya is one product, two pricing tiers** — not two products.
- **Commit + push at end of every sprint** in logical chunks. Don't pile uncommitted work.
- **Full autonomy to MVP** — once a sprint lands clean, spawn the next automatically. Stop only on real ambiguity, operator-blocked deps, or post-fix test failures.

---

## How to start next session

1. Read `docs/SPRINT_PLAN_CREATOR_MVP.md` end-to-end.
2. Confirm `git status` is clean on `staging`, last commit `adae6d3`.
3. Run `npm run smoke:cron-fly -- --confirm` with `MAYA_OPENCLAW_IMAGE=registry.fly.io/heymaya-openclaw:v2026.4.23` to reproduce the Sprint 1 starting state.
4. SSH into the Fly machine while it's running: `flyctl ssh console -a <smoke-app-id>`.
5. Inspect `/data/cron/jobs.json`, `tail -f` gateway logs, find why the cron tick isn't firing OR isn't completing the agent-turn POST to Convex.
6. Fix root cause. Add `--keep-alive` flag to the smoke harness for future debugging.
7. Verify Sprint 1 real-world bar passes (heartbeat row in Convex within 90s, SSH-confirmed gateway log).
8. Commit + push.
9. Move to Sprint 2.

---

## Open / non-blocking

- 16+ stale agent worktrees from prior sessions; clean post-MVP
- Pre-existing `creator-maya-v0-fly-smoke` harness uses `submitOnboarding` flow — still needs to be reconciled with the new onboarding flow that lands in Sprint 6. Both paths can coexist until then.
- Composio OpenClaw plugin install (per `memory/project_composio_openclaw_plugin_pending.md`) — queued post-MVP per operator.

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
