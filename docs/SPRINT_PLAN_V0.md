# HeyMaya — Sprint Plan v0

**Branch:** `heymaya/v0` (off `dev`)
**Convex:** preview deployment `heymaya-v0`
**Target:** shippable v0 in 8 working weeks
**Date:** 2026-04-26

---

## 1. Mission

Build **Maya** — an always-on AI creator manager who lives in iMessage / WhatsApp / web chat, knows the creator's content, audience, and brand-deal posture from real platform data, and proactively runs the operational layer of a creator career: content planning, performance analysis, brand-deal triage, accountability, growth strategy.

One creator → one Maya. Single OpenClaw agent. Highly multimodal. Grounded or silent.

> **"Your AI creator manager before you can afford a human one."**

---

## 2. Locked product principles

1. **The product is the agent in the messenger.** The web app is the receipt. iMessage / WhatsApp first; SMS fallback; web chat as office.
2. **Push, don't pull.** Maya tells the creator things before they ask. The dashboard is mostly read.
3. **Grounded or silent.** Every recommendation cites the data. If she can't ground it, she doesn't say it.
4. **Anti-sycophancy is non-negotiable.** Tone-tunable (supportive / strategic / tough-love), but never dishonest.
5. **One agent, multi-skilled.** No team, no org chart, no delegation. Maya is one persona with many capabilities.
6. **Shared infra + per-creator soul.** playbook.md, cron.md, skill.md are shared across all Mayas. Only soul.md and connected accounts vary per creator.
7. **One brain, thinking-budget routing.** Gemini 3 Flash with configurable thinking budget (none / medium / high) sized to the task. Single model = single voice = single telemetry profile. No model swapping in v0.
8. **Multi-platform from day one.** Creators have multiple handles (TikTok / IG / YT / LinkedIn / X). Maya is platform-aware.
9. **No credits theater.** Sell unlimited proactive + capped chat per tier. Credits are the #1 churn vector in this category.
10. **From scratch on the branch.** Reuse infra, delete LaunchCrew product code that doesn't apply.

---

## 3. Tech stack & key decisions

### Brain — single model, thinking-budget routing

**One model: Gemini 3 Flash with configurable thinking budget.** ~$0.50 / $3.00 per MTok, 1M context, native multimodal (text + image + video). Already proven in LaunchCrew model catalog.

Thinking budget routes by task complexity, not by model swap:

| Thinking level | Used for | Why |
|---|---|---|
| **None / low** | Chat replies, comment triage, accountability nudges, niche scans, evening recap | Routine output, fast latency, cheapest |
| **Medium** | Morning brief, post-publish reactions (with video), weekly content plan, hook library auto-build, rate suggestion explainer | Reasoning quality matters; multi-document grounding |
| **High** | Brand-deal email drafts, weekly review synthesis, manager-readiness packet, contract red-flag scan | High-stakes; wrong output has real cost |

**Why not three-tier (Gemma 4 + Flash + Sonnet)?**
- Three-model routing buys ~4 points of margin at the cost of 3× the bug surface, voice drift between models, and 3 telemetry profiles to debug.
- Flash with high thinking matches Sonnet's reasoning on most creator tasks.
- Single model = single voice = consistent Maya feel across all 17 behaviors.
- We can surgically swap the cheapest behaviors to Gemma 4 *post-beta* once telemetry shows which ones don't need Flash. Don't pre-optimize.

**No Opus, no Sonnet, no Gemma 4 in v0.** Re-evaluate after we have 100+ paying creators.

Estimated COGS per Maya: **~$10–11/mo at Pro tier ($39.99) — ~74% margin.** Acceptable for v0. Optimization gains (~5pt margin) deferred until post-beta when we have data to do it surgically.

### Runtime
- OpenClaw 4.12, single-agent deploy variant (skip multi-employee path entirely)
- One Fly machine per creator, shared Hetzner pool model
- OpenClaw native: cron, heartbeat, channels, memory, dreaming, memory-wiki

### Data layer (read)
- **ScrapeCreators** — primary data source, 27+ platforms, agent skill installed in Maya's workspace
  - TikTok (19 endpoints), IG (12), YouTube (12), LinkedIn (4), X (6), Reddit (7), Pinterest (4), Threads (5), plus Facebook, Snapchat, Twitch, Kick, Truth Social, Bluesky, ad libraries, Linktree/Komi/Pillar
  - Pricing: Freelance $47/mo (25K credits) → Business $497/mo (500K credits) → custom
  - Estimated usage: ~300 credits/creator/mo (post deltas, comments on top posts, weekly competitor sweep, daily niche scan, creator-initiated lookups)

### Data layer (write)
- **Composio v3** — Gmail (brand emails), Stripe (revenue), Calendar (shoots), brand contact lookup (Hunter/Apollo if available), IG/TT business if creator opts in
- Reuse universal runner + action picker from `dev`

### Channels (OpenClaw native)
- iMessage (primary for Apple users)
- WhatsApp (primary for Android, recommended over SMS for rich media)
- SMS Twilio fallback (with degraded-experience warning)
- Web chat (always available, lives inside dashboard)

### Stack
- Next.js 14 App Router, TypeScript, Tailwind, shadcn/ui (already in repo)
- Convex backend (preview deployment `heymaya-v0`)
- Clerk auth
- Stripe billing
- Fly.io for OpenClaw machines
- ClawHub skills + ScrapeCreators agent skill + Composio + custom Maya skills

### Pricing — consumer creator app

| Tier | $/mo | Annual | Handles | Channels | Thinking budget | Proactive | Chat | Deal desk | Competitor | Packet | Multi-account |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Starter** | **$19.99** | $199 | 1 platform | Web + SMS | None / low only | Morning + evening + weekly review only | 200 turns/mo | Manual deal entry only (no Gmail) | — | — | — |
| **Pro** | **$39.99** | $399 | Up to 3 | + iMessage + WhatsApp | None / low / medium / high all available | All 17 cron behaviors | Unlimited | Full Gmail + 4-variant drafts + auto-send threshold | 5 named peers | Quarterly auto | — |
| **Studio** | **$79.99** | $799 | Up to 5 | All | All + priority routing | Full + faster cadence (post-publish <5min) | Unlimited | Full + brand outreach (Apollo/Hunter via Composio) | 10 named peers | On-demand any time | Up to 3 personas |

**14-day Pro-tier trial, no card required.** Day-12 prompt for card. If no card by day 14, account auto-downgrades to Starter limits — never lose them to free-tier-zombie status.

**Plan-tier gating must be enforced server-side**, not just UI. Single `planFeatures(creator)` helper consulted by every gated entry point: `lc_maya_*` endpoints, model-router thinking-budget caps, channel pairing, ScrapeCreators credit accounting.

**COGS targets** (must hold to keep ~75-85% margin):
- Starter: ≤ $3/mo (85% margin) — limited heartbeat (60 LLM calls/mo) + low/no thinking + 1 platform ScrapeCreators
- Pro: ≤ $10/mo (75% margin) — full heartbeat (~600 calls/mo) + mixed thinking + 3 platforms
- Studio: ≤ $14/mo (82% margin) — heavy heartbeat + heavy thinking + 5 platforms + brand outreach

---

## 4. Architecture overview

```
                                       ┌────────────────────────────────┐
                                       │  iMessage / WhatsApp / SMS /   │
        ┌───────────────────────────► │  Web chat (the relationship)    │
        │                              └─────────────┬──────────────────┘
        │                                            │
┌───────┴────────┐    ┌────────────────────┐    ┌──┴──────────────────┐
│  ScrapeCreators │ ◄─►│  OpenClaw (Maya)   │◄──►│  Composio (write)   │
│  agent skill    │    │  - soul.md (user)  │    │  Gmail/Stripe/Cal   │
│  (read 27+      │    │  - playbook.md     │    └─────────────────────┘
│  platforms)     │    │  - cron.md         │
└─────────────────┘    │  - skill.md        │
        │              │  - lc_* skill      │
        │              └─────────┬──────────┘
        │                        │
        │                        ▼
        │              ┌──────────────────────┐
        └─────────────►│  Convex backend      │
                       │  (tables Maya writes │ ──► Web dashboard (6 screens)
                       │   to, UI reads from) │
                       └──────────────────────┘
```

Per-creator state lives in:
- Convex tables (`creators`, `creatorHandles`, `posts`, `postMetrics`, `contentPlans`, `brandDeals`, `dailyBriefs`, `weeklyReviews`, `trendObservations`, `revenueSnapshots`, `hookLibrary`, `commentTriage`, `competitorObservations`, `checkIns`, `chatMessages`, `dealContracts`, `readinessPackets`, `connectedAccounts`)
- OpenClaw workspace memory (`/data/memory/*`, dreaming notes, vault)
- Per-creator soul.md generated at deploy

---

## 5. Sprint plan

### Sprint 0 — Branch & infra (1-2 days, before kickoff)

**Goal:** clean working branch, isolated Convex, killed legacy code paths.

Tasks:
- `git checkout -b heymaya/v0` from `dev`
- `npx convex deploy --preview-create heymaya-v0` (user runs interactively)
- Delete from this branch's deploy path (code stays in `dev`):
  - `convex/agents/skills/coverageEnumerator.ts` invocation
  - `convex/onboarding/teamBlueprints.ts`, `blueprintEditor.ts`
  - `convex/agents/skills/maxDynamicEmployee.ts`
  - `convex/agents/packs/contentMarketing/` (LaunchCrew pack)
  - `convex/agents/configGenerator.ts` + `configGeneratorV2.ts` (V3 only)
  - All `app/(dashboard)/team/`, `routines/`, `automations/`, `briefings/`, `tasks/` (renamed/restructured later)
  - `convex/lib/vapiClient.ts`, `retellProvisioning.ts`, `voicePromptShared.ts`, `siteTemplate/`, `namecheapClient.ts`, `vercelDomainsClient.ts`
  - `convex/lib/roleCatalog.ts`, `roleToolMap.ts`
- Schema additions for Maya (new tables in `convex/schema.ts`)
- Update `CLAUDE.md` for the branch context (this is HeyMaya, not LaunchCrew)
- README rewrite for the branch

**Acceptance:** branch builds, Convex preview is reachable, `npm run dev` runs without errors, type-check + lint pass on a clean state.

---

### Sprint 1 — Foundation (Week 1)

**Goal:** ScrapeCreators wired, model router live, solo OpenClaw deploy variant working.

Tasks:
- **ScrapeCreators integration** — `convex/integrations/scrapeCreators/`
  - `client.ts` — HTTP client with `x-api-key` auth, retry, exponential backoff, 98.2%-success-aware timeouts
  - `endpoints.ts` — typed wrappers for the 27+ platform endpoints we'll actually use (profile, posts, post metrics, comments, audience demographics, hashtag trending, creator search, transcripts, ad libraries)
  - `cache.ts` — Convex-backed 6h cache for profile data, 30min for post metrics
  - `agentSkill/` — install ScrapeCreators agent skill into Maya's workspace template (per their docs)
- **Model + thinking-budget router** — `convex/agents/modelRouter/maya.ts`
  - Single model: Gemini 3 Flash for everything
  - Per-task thinking budget map: `none` (chat, comments, nudges, niche scan, evening recap), `medium` (morning brief, post-publish reaction, weekly plan, hook library, rate suggestion), `high` (brand email draft, weekly review synth, readiness packet, contract scan)
  - Plan-tier caps the maximum thinking budget allowed (Starter = none/low only, Pro/Studio = all)
  - Telemetry capture per call (tokens in/out, thinking tokens, latency, cost) → `aiCallLog` table
- **Solo deploy variant** — `convex/onboarding/maya/deployMaya.ts`
  - Strip multi-employee logic from `configGeneratorV3.ts` (clone as `configGeneratorMaya.ts`)
  - Single soul + shared playbook/cron/skill assembly
  - Fly machine create + bootstrap (reuse `flyClient.ts`)
- **Schema** in `convex/schema.ts`:
  - `creators` (clerkUserId, email, primaryHandle, phoneNumber, channelPreference, timezone, status, mayaFlyAppId, mayaConfigVersion, createdAt)
  - `creatorHandles` (creatorId, platform, handle, verified, scrapedAt, follower_count)
  - `connectedAccounts` (creatorId, provider, composioAccountId, scopes, scopeStatus, autoSendThreshold)
  - `creatorPicture` (creatorId, niche, audience, voiceFingerprint, topHooks, bottomHooks, postingCadence, brandDealHistory, generatedAt, model, sourceCitations)
  - `aiCallLog` (creatorId, taskTag, model, inputTokens, outputTokens, costUsd, latencyMs, ts)

**Acceptance:**
- `runFullScrapePull(creatorId, handle, platform)` returns a populated `creatorPicture` for any of TikTok/IG/YT in <30s
- `deployMaya(creatorId)` boots a Fly machine with one Maya in <60s and she responds to "hi" via her web channel
- Model + thinking-budget router fires Flash with correct thinking level per task; plan-tier caps enforced
- `aiCallLog` captures every call

---

### Sprint 2 — Onboarding (Week 2)

**Goal:** sub-4-minute onboarding from landing to deployed Maya pinging the creator.

Tasks:
- **Landing page** — `app/page.tsx` rewrite for Maya
  - Hero: "Your AI creator manager. Hire her in 4 minutes."
  - 3 cards: Content Strategy / Deal Desk / Accountability
  - Pricing preview ($39 / $99 / $249, 14-day trial)
  - CTA → "Hire Maya"
- **Auth** — Clerk one-tap (Apple/Google/email) → `creators` row inserted on webhook
- **Onboarding flow** — `app/onboarding/maya/page.tsx`
  - Step 1: Add handles. Multi-input UI: TikTok / IG / YouTube / LinkedIn / X. Add as many as relevant. Each handle confirmed via ScrapeCreators profile lookup before accepting (account-takeover guard).
  - Step 2: Real-time progress UI while ScrapeCreators bulk-pulls all platforms in parallel: "Reading your IG… Watching your top TikToks… Looking at your audience…"
  - Step 3: Multimodal creator-picture synthesis. **Gemini 3 Flash with high thinking** watches the actual video content of the creator's top 5 posts per platform AND processes captions, comments, audience demographics, post-thumbnail images. One-shot grounded synthesis — high thinking justified for the make-or-break first impression. Generates: niche, audience, voice fingerprint, top hook patterns with citations, posting cadence, brand-deal history.
  - Step 4: Maya's first message in chat — specific, cited, grounded. Three Q's framed conversationally: goal / tone / brand-deal floor.
  - Step 5: Phone number capture. Detect device → recommend channel. iPhone → iMessage; Android → WhatsApp recommended (rich media). SMS as fallback with warning ("you won't be able to send me images/videos via SMS").
  - Step 6: Optional Composio connections (Gmail / Stripe / Calendar) — one-click OAuth, skip available.
  - Step 7: Deploy. `generateMayaSoul()` → assemble soul.md → `deployMaya()` → Maya pings on chosen channel.
- **Soul generation** — `convex/agents/packs/maya/generateSoul.ts`
  - Inputs: creatorPicture + 3 Q's + connectedAccounts + handle list
  - Output: soul.md with sections (Identity, Niche, Voice fingerprint, Audience, Goals, Tone, Platforms, Brand-deal posture, Anti-sycophancy block, Memory anchors)
  - Gemini 3 Flash with high thinking for soul drafting (it's a one-shot, high thinking justified for first impression)

**Acceptance:**
- Creator with 3 handles (TT + IG + YT) goes from landing to Maya-deployed in <4 min
- Maya's first message references at least 2 specific posts from each connected platform
- Phone number captured + correct channel routed
- Soul.md persisted, deploy succeeds, Maya replies to first message

---

### Sprint 3 — The .md layer (Week 3)

**Goal:** Maya is a *capable* creator manager. Every day-to-day behavior is encoded in playbook.md / cron.md / skill.md and works against the platform skill endpoints.

Tasks:
- **playbook.md** (shared, in `agents/skills/maya-platform/playbook.md`):
  - § Identity & ethics (anti-sycophancy, no auto-send without permission, no legal/financial advice)
  - § Platform expertise — per-platform best practice (TikTok hooks vs IG Reels saves vs YT retention vs LinkedIn voice vs X concision). Maya consults this section + `lc.platform_best_practice` skill on every cross-platform decision.
  - § Morning brief flow (7am)
  - § Post-publish reaction flow (event-driven)
  - § 2h performance check
  - § Brand email triage (high thinking)
  - § Daily niche scan (6pm)
  - § Trend watcher (separate, niche-wide)
  - § Competitor watch (per-creator named peers)
  - § Accountability nudge (10am, conditional)
  - § Evening recap (7pm)
  - § Weekly content plan (Sun 4pm, high thinking for synthesis)
  - § Weekly review (Sun 9pm, high thinking)
  - § Hook library auto-build (event-driven, multimodal)
  - § Comment triage (2× daily)
  - § Revenue snapshot (Mon 9am)
  - § Manager-readiness packet (on-demand or quarterly, high thinking)
  - § Contract scan (event: PDF upload, high thinking)
  - § Rate suggestion (heuristic + LLM)
  - § Free-form chat handling
  - § Auto-send escalation (creator can grant "send under $X without asking" via Profile)
- **cron.md** (shared) — out-of-box schedule, all timezone-aware via creator's tz:
  - `0 7 * * *` morning brief
  - `0 10 * * *` accountability nudge (conditional)
  - `0 */2 8-22 * * *` post performance check (conditional, only if posted today)
  - `0 18 * * *` daily niche scan
  - `0 19 * * *` evening recap
  - `0 16 * * 0` weekly content plan generation
  - `0 21 * * 0` weekly review
  - `0 9 * * 1` revenue snapshot
  - `0 9 * * *` competitor watch
  - `0 11,17 * * *` comment triage
  - `0 14 1 */3 *` quarterly readiness packet refresh
- **skill.md** (shared) — full inventory, with one-line description per skill, of:
  - ClawHub skills (writing, brainstorming, verification-before-completion, anti-sycophancy patterns, skill-creator)
  - ScrapeCreators agent skill (full endpoint inventory documented inline so Maya knows what she can do)
  - Composio (Gmail send/search/draft, Stripe balance, Calendar create/list)
  - Custom Maya skills (rate-calculator, hook-pattern-extractor, packet-generator, platform-best-practice, contract-redflag-scanner)
- **Custom Maya skills** — `agents/skills/maya-rate-calculator/`, `maya-packet-generator/`, `maya-platform-best-practice/`, `maya-contract-redflag/`, `maya-hook-extractor/`
  - Each with SKILL.md + script.ts where applicable
  - Skill-creator pattern from LaunchCrew handles auto-authoring of any gaps Maya finds
- **Platform skill endpoints** — `convex/http.ts` (extend for Maya namespace `lc_maya_*`):
  - `lc_maya.save_brief`, `get_recent_posts`, `create_deal`, `save_drafts`, `get_deal`, `metrics_summary`, `save_hook`, `get_benchmark`, `get_commitments`, `last_post`, `brief_history`, `metrics_window`, `get_trends`, `deals_paid`, `full_creator_picture`, `parse_contract`, `platform_best_practice`, `record_checkin`, `save_plan`, `log_trend`, `log_competitor_observation`, `log_comment_triage`

**Acceptance:**
- Maya runs all 12 cron behaviors successfully against a test creator (Tideline-style fixture)
- Each behavior writes to the correct Convex table
- Maya uses correct thinking budget per task (verified in `aiCallLog` thinking-token column)
- Maya can author a new custom skill on the fly when she hits a gap (Wave 14 pattern reused)

---

### Sprint 4 — Today + Performance UI (Week 4)

**Goal:** the two highest-value screens shipped, mobile-first.

Tasks:
- **Today screen** — `app/(creator)/page.tsx`
  - Top: morning brief reader (markdown, real-time subscription)
  - Today's recommendation (with cite-back to past performance)
  - Pending items (drafts to approve, deliverables due, brand emails)
  - Revenue widget (MTD + trend)
  - Trending badge if outlier post performance detected today
  - Mobile-first vertical scroll
- **Performance screen** — `app/(creator)/performance/page.tsx`
  - Posts grid across all connected platforms
  - Platform filter chips (TikTok / IG / YouTube / LinkedIn / X)
  - Hook-type / format / day-of-week / length filters
  - Hover any post → Maya's read on it (from `posts.mayaAnnotation`)
  - Click post → detail panel (video player, transcript, comments, hook breakdown, comparable posts)
  - "What works" smart filter (auto-curated from `hookLibrary`)
  - Real-time updates as ScrapeCreators delta detects metric changes

**Acceptance:**
- Today screen renders the morning brief from the latest `dailyBriefs` row in <1s
- Performance screen loads 30 posts × 3 platforms in <2s
- Multimodal post detail (video + transcript + comments + Maya annotation) renders for any post
- Mobile (390px width) UX is clean

---

### Sprint 5 — Plan + Trends + Deals UI (Week 5)

**Goal:** the three remaining content/business screens.

Tasks:
- **Plan screen** — `app/(creator)/plan/page.tsx`
  - This week's plan (from latest `contentPlans` row)
  - Drag-to-reorder days
  - Idea card: hook + format + script outline + caption + reasoning + suggested posting time + per-platform variant ("post on TikTok as carousel; on IG as Reel; on YT as Shorts")
  - "Replan this day" button → Maya-initiated regen
  - Plan history (past weeks archived)
- **Trends screen** — `app/(creator)/trends/page.tsx`
  - Niche radar (from `trendObservations`) — emerging hashtags, sounds, formats in creator's niche
  - "From your peers" panel (from `competitorObservations`) — what named competitors are doing
  - "Fits your voice" smart filter — Maya's annotation on each
  - One-click "Want a draft for this?" → Maya generates + adds to Plan
- **Deals screen** — `app/(creator)/deals/page.tsx`
  - Pipeline by status (new / reviewing / negotiating / signed / shooting / submitted / paid)
  - Each card: brand, offer amount, Maya's suggested rate, deliverables, due date, risk flags
  - Click → detail panel with drafts (4 reply variants Maya prepared) + email thread mirror via Gmail + contract upload (PDF) + Maya's red-flag scan + risk meter
  - Filter by status, due date, brand
- **Composio Gmail integration**
  - Gmail webhook → trigger brand email triage in Maya's playbook
  - Send-as-user with audit log
  - Auto-send threshold (configurable in Profile, e.g. "send replies under $X without asking")

**Acceptance:**
- Plan screen renders a complete 7-day plan with platform-specific variants
- Trends screen shows live ScrapeCreators-fed observations updated daily
- Deals screen handles inbound brand emails: arrives in Gmail → triaged within 5 min → drafts ready → notification on Today

---

### Sprint 6 — Profile + Billing + iMessage/WhatsApp (Week 6)

**Goal:** account ops + the messaging channels live.

Tasks:
- **Profile screen** — `app/(creator)/profile/page.tsx`
  - Editable creator picture (niche, audience description, voice samples, goals, tone, brand-deal floor)
  - Connected handles (add/remove platforms — triggers re-pull + soul.md regen on add)
  - Connected accounts (Gmail / Stripe / Calendar — connect/disconnect)
  - Channel preference (iMessage / WhatsApp / SMS / web — change anytime)
  - Auto-send threshold setting
  - Tone slider (supportive / strategic / tough-love)
  - Memory reset button (with confirmation — "this rewrites your soul")
  - Billing tab (current plan, MTD usage, upgrade/downgrade)
  - Export data (GDPR-style)
- **Stripe billing**
  - Products: `starter_monthly` ($19.99), `pro_monthly` ($39.99), `studio_monthly` ($79.99)
  - Annual variants (~17% off): $199 / $399 / $799
  - 14-day trial flow, no card required at signup, card prompted on day 12
  - Checkout session, customer portal, webhook handlers
  - Plan-tier gating: chat turn cap (200 / unlimited / unlimited), competitor watch slots (1 / 5 / 10), readiness packet refresh frequency, **maximum thinking budget allowed** (none-low / all / all + priority routing)
- **iMessage channel pairing**
  - OpenClaw native — pair via SMS code flow (sent to creator's phone, creator texts back from iMessage)
  - Verify Apple ID / iMessage capability before deploying iMessage as primary
- **WhatsApp channel pairing**
  - OpenClaw native — pair via WhatsApp Business Cloud API or Twilio (whichever LaunchCrew already supports)
  - QR code or phone-link flow
- **Twilio SMS fallback**
  - For Android creators not on WhatsApp
  - Show degraded-experience warning at pairing time
  - Block rich-media outbound (Maya can't send images/videos to SMS)
  - Maya's playbook detects SMS-only and avoids offering "send me a draft" flows

**Acceptance:**
- Three plans purchasable end-to-end with working trial
- iMessage pairing succeeds for an iPhone tester within 60s
- WhatsApp pairing succeeds for an Android tester within 60s
- Maya routes outbound messages to the right channel correctly
- Auto-send threshold actually controls Maya's behavior (toggle off → she always asks first)

---

### Sprint 7 — Beta hardening (Week 7)

**Goal:** put 10 real creators on Maya, capture telemetry, fix what breaks.

Tasks:
- Empty / loading / error states pass across all 6 screens
- Mobile responsive review (390px / 768px / 1024px breakpoints)
- Telemetry instrumentation:
  - Maya output approval rate (drafts approved vs edited vs ignored)
  - Time from morning brief delivered → creator opened
  - Channel engagement rates (iMessage replies vs WhatsApp vs SMS vs web)
  - ScrapeCreators failure rate per platform
  - Per-task model cost (from `aiCallLog`)
- Beta cohort recruitment: 10 creators across niches (fitness, finance, beauty, gaming, lifestyle, food, tech, art, parenting, education) with 50K–500K followers
- Free 60-day Maya tier in exchange for weekly feedback call
- Bug bash week — all hands on Slack + creator-feedback Discord channel
- Failure-mode audit:
  - ScrapeCreators times out → graceful degrade ("I'll have fresh data in a bit")
  - Gmail webhook fails → polling fallback
  - Maya hallucinates a fact → citation firewall pre-send check
  - Multimodal video processing latency → budget ceiling per call

**Acceptance:**
- 10 creators onboarded successfully
- Maya's morning brief approval rate >70% in week 1
- No P0 bugs open by end of week
- Telemetry pipeline live and queryable

---

### Sprint 8 — Iterate from beta (Week 8)

**Goal:** ship what works, kill what doesn't.

This is the hard week. Every previous sprint shipped to a spec. This one ships to *user reality*.

Tasks (TBD until beta data lands, but plan space for):
- Cut the lowest-engagement behaviors (some of the 17 won't earn their cost — kill them)
- Sharpen the top-3 most-loved behaviors (whatever beta tells us — likely morning brief + deal desk + post-publish reaction)
- Rewrite playbook.md sections that produced low-quality output
- Re-tune tone/voice if creators consistently say "doesn't sound like me"
- Decision: ship public, or another iteration cycle
- If shipping public: marketing site polish, pricing page, FAQ, terms
- Public launch announcement (Twitter / TikTok / creator-economy newsletters)

**Acceptance:**
- 8 of 10 beta creators report Maya is "worth it"
- Public launch decision made with data
- Public launch executed OR clear gap-list for sprint 9

---

## 6. Open questions to resolve before / during

1. **Gemma 4 cost optimization deferred to post-beta.** v0 ships single-model on Gemini 3 Flash. Once we have telemetry from 100+ paying creators, we'll know which behaviors waste tokens (e.g., simple chat replies, accountability nudges) and can swap them surgically to Gemma 4 31B IT for ~5pt margin gain. Don't pre-optimize.
2. **Auto-send threshold UX** — does the threshold mean dollars (deal value) or sender reputation? Probably both — refine in beta.
3. **Multi-account creators (Pro tier)** — does one creator with 3 brand personas get 3 Mayas or 1 Maya with 3 mode switches? Lean toward 3 Mayas, simpler architecture.
4. **iMessage TOS** — Apple doesn't formally allow business iMessage. OpenClaw's iMessage support is via private API or Mac-server bridge. Confirm reliability and ToS posture before depending on it as primary channel.
5. **Custom skill authoring** — Wave 14 skill-creator pattern from LaunchCrew vs hand-write Maya's custom skills upfront. Lean toward hand-write for v0 (5 skills), use auto-author for gaps in beta.
6. **Phyllo / IG Graph fallback** — ScrapeCreators is read-only and is screen-scrape under the hood (98.2% but not 100%). For the 1.8% failure case, do we have a fallback for the highest-impact reads (creator's own profile)? Probably accept the rate and add manual retry.
7. **Brand contact lookup** — Apollo or Hunter via Composio? Or just Maya web-searching? Decide before Sprint 5.
8. **Data retention / GDPR** — creator data is sensitive. Default 90-day retention on raw scraped post data, indefinite on derived insights, 30-day chat history? Confirm before beta.

---

## 7. Risks

1. **ScrapeCreators reliability at scale.** 98.2% means 1 in 50 calls fails. At 100 customers × 10 calls/day = 20 failures/day. Maya needs to degrade gracefully every time.
2. **Multimodal video processing cost.** Gemini 3 Flash on a full 60s TikTok isn't free, and high thinking adds tokens on top. Need per-call budget ceilings: max 30s of clip per analysis, max thinking tokens per task. Fallback: drop to ScrapeCreators-transcript + caption-only analysis if budget exceeded.
3. **iMessage channel reliability.** OpenClaw's iMessage support has historically been the flakiest channel. If it can't hit 99%+ uptime, default Apple users to WhatsApp.
4. **Voice fingerprint drift.** Creator's tone changes. Soul.md generated at onboarding will rot in 90 days. Need a quarterly soul-refresh cron — bake in from start.
5. **Brand-deal liability.** Even with "draft only, you approve" framing, a Maya-drafted email that goes wrong creates legal exposure. ToS needs explicit "you are responsible for what you send." Pre-launch lawyer review of ToS.
6. **Creator anxiety about AI replacing them.** Some creators (esp. parasocial / personality-driven) will feel weird about an AI representing them. Soul-tuning + tone control + transparency about what Maya actually does mitigates but doesn't eliminate. Beta will reveal who this is for and who it isn't.
7. **The "cool gimmick that doesn't retain" risk.** Magic onboarding moment is high. Day 30 retention is the real question. Mitigation: telemetry from day 1, kill behaviors that don't earn engagement, never let Maya go silent for >36h.

---

## 8. Definition of done for v0

- 10 paying customers (post-beta) on the $39 tier
- Maya morning brief approval rate >70%
- Maya monthly retention (day 0 → day 30) >60%
- COGS per Maya <$8/mo at average usage
- Public-launchable: pricing page, marketing site, ToS, privacy policy, support email, refund flow
- All 6 screens functional and mobile-clean
- iMessage, WhatsApp, SMS, web all proven channels

---

## 9. Branch hygiene

- `heymaya/v0` rebases against `dev` weekly to absorb shared infra fixes (Composio runner, Fly client, encryption)
- Maya-specific code lives in clearly-namespaced dirs: `convex/agents/packs/maya/`, `convex/onboarding/maya/`, `convex/integrations/scrapeCreators/`, `app/(creator)/`, `app/onboarding/maya/`
- Any change to LaunchCrew shared infra goes back to `dev` first, then rebases into `heymaya/v0`
- Branch protected from auto-merge until v0 ships
- Convex preview `heymaya-v0` stays separate from prod LaunchCrew Convex throughout

---

## 10. Testing strategy

Every sprint must ship with tests that prove the work. No green tests = sprint not done.

### Test stack

| Layer | Tool | Where it lives |
|---|---|---|
| Unit (TS pure functions) | Vitest | `*.test.ts` co-located |
| Convex queries / mutations / actions | `convex-test` (already in repo) | `convex/**/__tests__/*.test.ts` |
| React components | Vitest + Testing Library | `components/**/__tests__/*.test.tsx` |
| Behavioral simulation (Maya playbook flows) | Tideline-style fixture pattern (already in repo at `convex/sim/`) | `convex/sim/maya/*` |
| E2E (browser flows) | Playwright | `e2e/maya/*.spec.ts` |
| Real-creator E2E (live ScrapeCreators + Fly + Convex) | Custom test harness | `scripts/e2e-maya-*.ts` |
| Hallucination / phantom-name check | Wave 17 citation firewall pattern (reused) | `convex/agents/packs/maya/__tests__/grounding.test.ts` |
| Load / soak | k6 or simple node loader | `scripts/load-test.ts` |

### Mandatory test categories per sprint (from LaunchCrew's validation-gap-prevention rule)

Every sprint's "smoking gun" must cover:

1. **Cross-tenant isolation** — Creator A cannot read Creator B's data, ever. Test against Convex queries with mismatched `creatorId`.
2. **Plan-tier × action matrix (incl. reads)** — Starter user calling a Pro-only endpoint must fail closed, not silently succeed.
3. **Adversarial inputs** — empty handle, malformed handle, handle-not-found, ScrapeCreators timeout, Gmail OAuth revoked mid-task, contract PDF malformed.
4. **Sibling-file scan** — when adding a new behavior, grep for sibling files that need parallel updates (every cron entry needs a playbook entry needs a skill entry).
5. **TODO grep** — no `TODO`, `FIXME`, `// eslint-disable-next-line` snuck in without justification.

### Per-sprint test plans

#### Sprint 0 — Branch & infra
- **Smoke:** `npm run build` + `tsc --noEmit` + `npm run lint` all pass on a clean clone of the branch
- **Convex codegen clean:** `npx convex dev --once` succeeds, `convex/_generated/` matches expected diff
- **Preview deployment reachable:** `curl https://heymaya-v0.convex.cloud/...` returns 200 on a public health endpoint
- **No `dev`-leftover imports:** sibling-file scan for any imports referencing deleted V1/V2 files
- **CLAUDE.md branch context updated** and verified by tests that grep for "Maya" not "LaunchCrew"

#### Sprint 1 — Foundation
- **Unit:** `scrapeCreators/client.ts` retry, exponential backoff, `x-api-key` injection, response parsing for each platform's profile + posts shape
- **Unit:** `scrapeCreators/cache.ts` TTL behavior (6h profile, 30min metrics), invalidation, multi-key safety
- **Unit:** `modelRouter/maya.ts` task-tag → thinking budget map, plan-tier cap enforcement, `aiCallLog` write
- **Unit:** Convex schema validators for new tables (cross-tenant `by_creator` index correctness)
- **Integration:** `runFullScrapePull("test-fitness-creator", "tiktok")` returns populated `creatorPicture` against a recorded fixture (no live API in CI)
- **Integration:** real-creator E2E (manual) — use one real handle, verify ScrapeCreators returns sane data, persists correctly
- **Integration:** `deployMaya(creatorId)` boots a real Fly machine in <60s, agent responds to "hi" via web channel
- **Cross-tenant:** Creator A cannot read Creator B's `creatorPicture`, `aiCallLog`, etc.
- **Acceptance gate:** all 5 mandatory test categories pass

#### Sprint 2 — Onboarding
- **Component:** handle-add UI accepts add/remove for 5 platforms, validates before accepting (mocked ScrapeCreators)
- **Component:** phone capture detects iPhone vs Android user agent, renders correct channel recommendation
- **Component:** Composio connect flow renders correctly for Gmail/Stripe/Calendar
- **Integration:** full onboarding action chain: `startOnboarding` → `pullScrapeData` → `synthesizeCreatorPicture` → `generateSoul` → `deployMaya` → `sendFirstMessage`
- **E2E (Playwright):** new user lands → enters handle → confirms → answers 3 Qs → captures phone → connects Gmail → deploys → sees Maya's first message in <4 min total wall-clock
- **Multimodal synthesis quality test:** synthesized creator picture cites at least 2 specific posts per connected platform (regex-grep citation IDs)
- **Hallucination test (CRITICAL):** Maya's first message contains no names not present in scraped data — Wave 17 phantom-name detector reused
- **Adversarial:** handle that doesn't exist on platform; handle with rate-limited platform; ScrapeCreators 5xx mid-pull; Convex Cloud transient error
- **Acceptance gate:** all 5 mandatory categories pass + first-message hallucination rate = 0% across 50-creator fixture corpus

#### Sprint 3 — The .md layer
- **Unit:** each custom Maya skill (`rate-calculator`, `hook-pattern-extractor`, `packet-generator`, `platform-best-practice`, `contract-redflag`) tested with canned inputs
- **Behavioral sim (Tideline-style):** fixture creator with known posts/audience/deals, run each of the 17 cron behaviors, assert correct Convex table written, correct shape
- **Behavioral sim:** thinking-budget map verified — chat call uses `none`, morning brief uses `medium`, brand email draft uses `high` (verified in `aiCallLog`)
- **Integration:** Maya HTTP endpoints `lc_maya_*` — each endpoint tested for auth (must be Maya's own gateway), input validation, write correctness, idempotency where required
- **Hallucination:** every Maya output passes citation firewall before being persisted (phantom-name detector, source-resolution check)
- **Cross-tenant:** Maya for Creator A cannot call `lc_maya.save_brief` against Creator B's brief slot (HTTP layer enforces gateway → creator binding)
- **Plan-tier:** Starter Maya cannot invoke high-thinking flows; medium thinking caps at Starter's max budget
- **Acceptance gate:** 17/17 behaviors run successfully against fixture; all 5 mandatory categories pass

#### Sprint 4 — Today + Performance UI
- **Component:** Today screen with mocked Convex subscription renders morning brief, recommendations, pending items, revenue widget
- **Component:** Performance grid renders 30 posts × 3 platforms, filters work, hover annotations show
- **Snapshot:** all six screens at three breakpoints (390 / 768 / 1024)
- **A11y:** axe-core pass, no critical/serious violations
- **Realtime test:** Convex mutation that writes a new `posts` row → Performance screen shows it within 5s without page reload
- **Multimodal post detail:** opens detail panel, video player loads, transcript renders, comments load, Maya's hook breakdown renders from `posts.mayaAnnotation`
- **Acceptance gate:** all 5 mandatory categories pass + Lighthouse mobile performance >85 on Today

#### Sprint 5 — Plan + Trends + Deals UI
- **Component:** Plan drag-reorder maintains Convex state, idea cards render all required fields including platform variants
- **Component:** Trends screen renders niche radar + competitor watch, "fits your voice" filter works
- **Component:** Deals pipeline accepts new card, drag-between-statuses, drafts panel opens, contract upload accepts PDF
- **Integration:** Gmail webhook → triage action → `brandDeals` row + drafts within 5min — assert end-to-end timing
- **Integration:** Auto-send threshold toggle on/off changes Maya's playbook behavior — verified by Maya re-reading `connectedAccounts.autoSendThreshold` on every email-handling cycle
- **Adversarial:** Gmail OAuth revoked mid-triage; contract PDF malformed; brand email arrives during ScrapeCreators outage
- **Plan-tier:** Starter user cannot connect Gmail; cannot access auto-send threshold UI
- **Acceptance gate:** all 5 mandatory categories pass + brand email triage <5min P95

#### Sprint 6 — Profile + Billing + iMessage/WhatsApp
- **Stripe (test mode):** purchase Starter / Pro / Studio + annual variants; trial flow; trial → conversion; trial → expiration → downgrade; upgrade Starter → Pro mid-period; downgrade Studio → Pro mid-period; cancel + reactivate; failed-payment dunning
- **Stripe webhooks:** subscription.updated, invoice.paid, invoice.payment_failed, customer.subscription.deleted — all handled idempotently
- **Channel pairing (real):** iMessage pairing on real iPhone tester within 60s; WhatsApp on real Android within 60s; SMS Twilio fallback works
- **Channel routing test:** Maya outbound message routed to creator's primary channel; degrades gracefully (e.g., iMessage outage → WhatsApp fallback if available)
- **Plan-tier × action matrix (CRITICAL):** Starter user blocked from medium/high thinking, blocked from 2nd platform, blocked from iMessage/WhatsApp pairing, blocked from Gmail integration, blocked from competitor watch — all enforced server-side, not just UI
- **Memory reset:** Profile → reset memory → soul.md regenerates, agent restarts, conversation history cleared per retention policy
- **Acceptance gate:** all 5 mandatory categories pass; Stripe checkout E2E green for all 6 monthly+annual SKUs

#### Sprint 7 — Beta hardening
- **Beta cohort acceptance:** 10 creators onboarded successfully end-to-end
- **Telemetry queryability:** all events captured in `aiCallLog`, `mayaActionLog`, `creatorEngagement` tables; admin dashboard renders top metrics
- **Soak test:** simulated 24h day-in-the-life × 10 creators concurrent; no memory leaks, no Convex pagination issues, no Fly machine OOM
- **ScrapeCreators failure injection:** force 1.8% failure rate, verify graceful degradation messages
- **Bug bash:** team writes 50 adversarial scenarios, sweeps for breakage
- **Acceptance gate:** zero P0 open; <5 P1 open; Maya morning brief approval rate >70% in beta week 1

#### Sprint 8 — Iterate from beta
- **Behavior cull:** any of the 17 behaviors with <30% beta engagement gets cut, including its tests
- **Behavior sharpen:** top-3 behaviors get a second test pass with quality bar raised (e.g., morning brief specificity score)
- **Public launch readiness:** ToS, privacy policy, refund policy reviewed; pricing page legal-reviewed; FAQ written
- **Acceptance gate:** 8/10 beta creators say "worth it"; public launch checklist 100% green OR clear gap-list documented for Sprint 9

### Test data — fixture corpus

Sprint 0 builds a **50-creator fixture corpus** (similar to Tideline pattern) covering:
- 10 niches (fitness, finance, beauty, gaming, lifestyle, food, tech, art, parenting, education)
- 5 follower brackets (5K-25K, 25K-100K, 100K-500K, 500K-1M, 1M+)
- 3 platform configs (TT-only, IG-only, multi-platform)
- 2 brand-deal postures (no deals yet, active deals)
- Edge cases: handle-with-emoji, business-account-only, deactivated-account, rate-limited-platform

Each fixture has: scraped profile JSON, last-30-posts JSON, audience demographics JSON, top-3 video transcripts, one inbound brand email, one signed contract PDF.

This corpus is reused across Sprint 1-3 integration tests and Sprint 7 simulated soak.

### What "tests pass" means at each gate

- **Per-PR (CI):** unit + integration + component tests must pass, no flakes tolerated, code coverage ≥70% on net-new code
- **Per-sprint (manual sign-off):** behavioral sim suite green, plan-tier × action matrix green, hallucination rate = 0% on fixture corpus
- **Per-sprint (acceptance):** 5 mandatory test categories pass, sprint-specific acceptance gates pass, no P0 bugs
- **Pre-launch (Sprint 7):** real-creator E2E across 10 niches, soak test 24h, telemetry pipeline live
