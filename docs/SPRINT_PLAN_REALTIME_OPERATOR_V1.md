# Sprint Plan — Maya as a Real-Time GTM Operator (V1)

**Status:** proposed (2026-06-16). Clean-sheet target architecture for GTM Maya's daily work.
**One-line promise to the customer:** *a founder hands off their go-to-market and gets back an always-on operator who watches their market in real time, acts while opportunities are hot, makes the content, and proves which actions produced customers.*

> This is a **target-architecture** doc, written from first principles ("if we had nothing"). It revises two earlier decisions deliberately — "discovery is crons-only, 2×/day" and the "~15–20 reply/day floor" — and integrates content creation as a first-class part of the engine. Everything else (grounded-or-silent, anti-sycophancy, warmth/ban-safety, clicks→signups attribution, web-first connect, single-agent-per-tenant) is preserved. See `docs/GTM_PRODUCT_STRATEGY.md` and `docs/CREATIFY_API_REFERENCE.md`.

---

## 1 — Who this is for

A solo / very-small AI-native founder who shipped fast and hit the marketing wall. They don't want a content tool or a dashboard to babysit — they want to **hand off GTM** and trust it's being run. The product wins only if, on any given day, the founder feels: *"someone is on this, jumping on the right moments, posting for me, and showing me it's working — and I barely had to touch my phone."*

## 2 — Day in the life (Day 3, the target experience)

Sam, solo founder of a habit-tracking app. Bets: Reddit + X + TikTok. Channels connected.

- **7:00 AM** — one Telegram: a **digest, not a plan to review**: "Overnight I jumped on 2 r/productivity threads (replied as you), your Tuesday X post is 4× your median, and today I'm leaning Reddit — that's where your clicks come from. One TikTok needs your tap at 6 PM."
- **9:40 AM** — a r/SideProject thread goes hot ("what do you use to actually stick to habits?"). Maya catches it **~20 min in**, replies in Sam's voice, pings: "heating up, dead-on your buyer — replied 👉 [link], watching it."
- **11:15 AM** — Sam: *"competitor launched on PH, react?"* Maya answers in seconds — already saw it, gives a grounded take, **re-weights the day live** toward their onboarding-friction wedge.
- **2:30 PM** — a wrapped link converts. Maya doesn't wait for the recap: "📈 that r/productivity reply → 9 clicks → **1 signup** just hit your Stripe."
- **6:00 PM** — the one-tap TikTok card lands exactly at peak; slides previewed in Telegram; Sam taps ✅.
- **8:00 PM** — tight recap, grounded in conversions: "14 clicks → 2 signups, both Reddit. Leaning harder there tomorrow. Nothing for you to do."

~4 earned touches. Sam knows exactly which actions got customers. **That's the product.**

## 3 — Core principle: a loop, not a schedule

The engine is **one continuous pulse**; crons are a thin rhythm layer on top. In OpenClaw terms: **the heartbeat is the engine; jobs.json is the rhythm section.** This is the exact inverse of today (crons = engine, heartbeat = passive watchman). If every cron failed, the product would still run — because the pulse is the engine.

## 4 — The Pulse (the engine)

**This is where ALL continuous discovery happens — not the 7 AM cron.** Social moves minute-to-minute, so a once-a-day batch can't be the engine. Instead the OpenClaw heartbeat fires a budget-gated tick **every ~30 min** (adaptive — ~30 min during the founder's audience's active hours, ~60 min overnight; ~50–75 ticks/day). Each tick runs on the **cheapest capable model (Gemini 3.1 Flash-Lite class)** and does one economical thing: *"since I last looked, what's NEW on the bet channels, and is any of it worth engaging?"* — across rotating **watch lanes**, each with a **watermark** (last-seen id/timestamp) so it only ever reads the delta, never a full re-pull.

For each new item the cheap model decides: **(a) is this my buyer / worth engaging? (b) if yes, what do I say?** → draft → firewall → post (paced, warmth-gated) / one-tap. If nothing clears the bar → no-op. Because it's the cheapest model on small deltas, a tick costs pennies and **most ticks find nothing and cost almost nothing.**

| Lane | Cadence | Reads | On a hit → Act |
|---|---|---|---|
| **Buyer-intent** ⭐ (the volume) | **every tick (~30 min)** | **the founder's BET channels' research tools** — dispatched per the channel scorecard, ANY of `research_reddit`/`research_x`/`research_hn`/`research_tiktok`/`research_instagram`/`research_youtube`/`research_linkedin` (+ `research_video_comments`), new-since-watermark on ICP intent language | reply Act on text channels (the day's 15–30 replies, found continuously); on video channels (TikTok/IG/YT) this lane feeds the **content-creation Act** + comment engagement instead, under warmup/one-tap constraints |
| **Switch-intent** ⭐ | ~30–60 min | `research_x_competitor_mentions` + "alternative to [X]" / complaint searches | positioning reply + founder ping (highest-value lead) |
| **Competitor activity** | ~1–2 h | `research_x_user_timeline` / scrape competitor accounts, diffed | log move, mine angle → content idea |
| **Launch / pricing / ads** | daily (ads weekly) | `competitor_ads` + `search_web` on changelog/pricing | alert + grounded take |
| **Own perf + inbox** | ~20–30 min | `get_account_analytics` / `list_inbox` | celebrate/learn; reply to comment/DM |
| **Go-time** | every tick | due scheduled items | fire post / send one-tap card |

Most pulses are no-ops (`HEARTBEAT_OK`, ≈$0). The pulse never acts itself — it **escalates**.

### 4a — One tick, mechanically (the clockwork)
```
TICK fires (~every 30 min active / ~60 min overnight)
 1. get_agent_lifecycle → onboarding done? if not, NO_REPLY, end.
 2. budget gate: per-hour discovery budget left? (gtmCostLedger)
       exhausted → monitoring-only (own-posts + inbox), skip discovery, end (~$0)
 3. which LANES are DUE this tick? (rotation table above)
 4. for each due lane, on the CHEAP model (Gemini 3.1 Flash-Lite):
       pull ONLY items new-since-watermark → score buyer-fit + velocity → advance watermark
 5. for each item that clears the bar (cheap model):
       decide "worth engaging?" → if yes, draft the reply/comment → firewall → post (paced, warmth-gated) / one-tap
 6. nothing cleared → HEARTBEAT_OK, end.     ← most ticks
```
**Where the volume comes from:** the 15–30 replies/day are the *cumulative output of the buyer-intent lane firing every ~30 min and acting on what fits* — spread naturally across the day, rate-limit- and warmth-respecting, not a quota dumped at 7 AM. Busy niche → 25–30; slow day → fewer, honestly (fit is the gate, not a raw count). She is *always looking*, so volume is a byproduct of continuous presence.

**Model economy (what makes 24/7 affordable):** the constant work — the scan + the "worth it?" call + most reply drafts — runs on the **cheapest model**. Only high-stakes work escalates to the stronger brain: original posts, the synthesis, the weekly strategic read, anything the founder will be judged on publicly. Cheap-and-constant + smart-and-rare = the per-agent cost stays inside $99–$149 with margin.

## 5 — The Acts (what Maya does on a hit)

An Act is a focused worker (`sessions_spawn`, main brain) spawned only when the pulse finds something real. Act types:

1. **Reply** — draft in-voice → firewall → post (warmth-gated) / one-tap.
2. **Original content** — see §6. Triggered by the planned slate (morning) *or* opportunistically by the pulse.
3. **Alert** — a grounded heads-up + recommended response (competitor launch, conversion, anomaly).
4. **Steer-response** — a founder inbound re-weights the live loop.

Every Act: warmth-gated, plan/tier-gated server-side, firewall'd, logged to `gtmAgentTrace`, and — if it ships a link — wired for attribution (`wrap_link`).

## 6 — Content creation, integrated (not a silo)

**The hunt loop is the idea engine.** Original content is grounded in what the loop sees — recurring buyer complaints, competitor gaps, what's actually converting (`get_my_attribution`) — never invented in a vacuum. Two triggers: the **planned daily slate** (chosen at morning intent) and **opportunistic** (the pulse surfaces a moment worth an original post now).

The production line (existing skills as stages):
1. **Idea / angle** — `maya-idea-generator` / `maya-viral-demo-moment-miner` / `maya-hook-extractor`, seeded by loop signal + attribution.
2. **Format** — `maya-slideshow-strategist` / `maya-tiktok-demo-strategist` / `maya-content-format-miner` + `get_platform_algo` (what's working now).
3. **Draft in voice** — `maya-caption-generator` + `maya-voice-matcher`.
4. **Media** (branch by tier):
   - **Text** — LLM. The bulk of GTM; the *entire $99 core*.
   - **Slideshow / carousel** — `generate_slide_image` (Gemini image). $99 visual path.
   - **Video** — **Creatify, Studio ($149) only** (`creatifyVideo.ts`): URL→ad, Ad-Clone, Aurora avatar. Maya grounds the script + picks the reference; Creatify renders; we re-host to Convex + record COGS. The $99 core has no video and falls back to slideshow/text.
5. **Quality gate** — `maya-pre-post-scorer` + `maya-slop-critic` + firewall.
6. **Publish** — `post_to_channel` / `maya-publisher` → auto on connected/warm channels (Zernio-scheduled at peak), one-tap card for ban-safety channels (Reddit/TikTok).

**Creatify's place:** it is the renderer for *one branch* (video Act, Studio-gated) — not "content-making" writ large. Most content is text + slideshow and never touches it.

## 7 — Anchored moments (thin crons on the loop)

- **Morning (founder-local):** a **digest** — "here's what I already did overnight + today's 1–2 bets + the day's content slate." High thinking; reads attribution. It owns **ZERO discovery** (the pulse has been finding + acting since the founder's morning). It is NOT a from-scratch plan and NOT the work — just the framing.
- **Evening:** reflection — what converted, what I learned, re-weight lanes. Skip if empty.
- **Weekly (Sun):** strategy review; re-weight bets by conversions; advance warmth.
- **Monthly:** foundation + voice refresh; competitor map refresh.

## 8 — The feedback circuit

Idea → distribution → **attribution** (`wrap_link` → `record_conversion` → `get_my_attribution`) → re-weight → better idea. Closed loop, not one-shot. Conversions are surfaced to the founder **event-driven and loud** (the moat), and visualized in the Thinking decision-timeline (shipped) + Results.

## 9 — Governance (the make-or-break — why this wasn't already built)

Batch existed to tame runaway/cost. A 24/7 loop is only safe with:
- **Per-hour + per-day budget** (extend `gtmCostLedger` + `spendKill`). Pulse draws ~nothing; Acts draw; on exhaustion → degrade to monitoring-only until reset.
- **Cheap-model scan, stronger-brain only when it matters** — the constant work (every-30-min scan + "worth it?" call + most reply drafts) runs on the **cheapest capable model (Gemini 3.1 Flash-Lite class)**; escalate to the stronger brain only for high-stakes Acts (original posts, synthesis, weekly strategic read). Thinking-budget per tier: scan ≈0, reply = low, original-content/strategy = high. This dual-model routing is the single biggest cost lever — it's what makes a 24/7 loop affordable at $99–$149 (the service product already adopted this split).
- **Watermarks** per lane (only-new reads — no full re-pulls).
- **Durable lease + dedup** (built) — one pulse in flight; never double-acts.
- **Kill-switch** (built) as hard backstop. **⚠ Video interaction:** Creatify ad-clone bursts can trip the $6/24h kill — record `provider:"creatify"` to the ledger and bump `spendKillCapUsd` for Studio agents (per Creatify ref §2).
- **`gtmAgentTrace`** (shipped) — the telemetry to *prove* the loop isn't runaway before prod.

### 9a — Per-user spend ceiling (a single Maya can't overspend a day)

**What exists today (hard caps — block/destroy):** every agent is already bounded by a layered set of per-agent limits, all override-able:
- **$2 / day** cost cap — `betaGuards.ts` `DEFAULT_DAILY_COST_LIMIT_USD = 2` (+ a **120 API-call/day** limit + a **monthly** cap), `evaluateGtmBetaGuard` **blocks** the next spend when exceeded.
- **$1 / hr** operational cap — `costCap.ts` `HOURLY_COST_CAP_USD` (403s further spend).
- **$3 / hr** velocity kill + **$6 / 24h** sustained kill — `spendKill.ts` **destroys the Fly machine**; per-agent `spendKillCapUsd` override.

So a user's Maya literally cannot run away past these — the machine is killed first. The limitation is that they are **blunt: they block or destroy, they don't degrade.**

**Target (graceful, tier-aware daily ceiling):** keep the hard caps as the absolute backstop, but add a **per-agent daily spend ceiling derived from tier** (so COGS stays a predictable fraction of $99 / $149 and margin is guaranteed), with a **degradation ladder** instead of a wall:

1. Under ceiling → full engine (discovery + Acts).
2. ~70% of daily ceiling → **cheap-model-only** (no escalation to the stronger brain except one-tap-approved high-stakes).
3. ~85% → **monitoring-only** (pause discovery lanes; keep own-post + inbox polling, which is <$0.10/tick).
4. ~100% (soft) → **pause** until the daily window resets; tell the founder honestly if it materially capped the day.
5. Hard caps ($6/24h kill etc.) remain only as the last-resort backstop — graceful degradation should mean they essentially never fire in normal operation.

This makes the daily $/user a **dial the operator sets** (per tier, per agent), enforced server-side in `gtmCostLedger` + the discovery budget gate (Phase-2 ⑤), with `gtmAgentTrace` proving the ceiling holds. Net promise: **a single user's Maya has a known, enforced daily spend cap — and approaches it by getting cheaper/quieter, not by dying.**

### 9b — COGS budget & margin targets (the binding numbers)

**Operator targets (locked):** **$99 → ≤ $30/mo variable COGS per user · $199 → ≤ $60/mo** (≈ 70% gross margin each), where "variable" = LLM + research APIs + slideshow. **Fly compute (~$5–8/mo/user) is separate fixed infra**, not a token cost (so all-in COGS ≈ variable + ~$8). On Studio, Creatify **video is metered separately** within its own high margin (per Creatify ref), not inside the $60 ops budget.

**Derived daily ceilings (all-in: LLM + research, provider-complete):**
- **$99 → $1.00/day** (= $30/mo).
- **$199 → $2.00/day** ops (= $60/mo) + video metered separately.

**Feasibility — REBUILT FROM RESEARCHED PRICING (2026-06-16 web audit; replaces an earlier ~3× too-optimistic guess).** Per-provider rates were read from live vendor pages; **volumes are still design-intent estimates** (ScrapeCreators/TwitterAPI/DataForSEO log `$0` in our ledger, so nothing is telemetry-verified yet).

Real unit prices (sourced): OpenRouter — Kimi K2 $0.60/$2.50 per 1M, Gemini 3 Flash $0.50/$3.00, **Flash-Lite $0.25/$1.50** · ScrapeCreators **~$0.0019/call** (Freelance $47/25k) → ~$0.001 (Business $497/500k) · TwitterAPI.io **$0.00015/tweet** · DataForSEO ~$0.03/req · Gemini image **$0.067/slide** · Fly **$5.92/mo (1GB) + $2 IPv4** · Convex $25 seat (amortizes) + ~$3–5 marginal · **Zernio = per CONNECTED ACCOUNT: first 2 free, accounts 3–10 @ $6 → 6 channels = $24/mo** · Creatify **$99/mo base / 300cr**, 30s URL→video = 10cr ≈ $3.30.

**Modeled monthly COGS (avg case, at the current 6-channel, ~30-min-pulse design):**

| Tier | Modeled COGS (avg) | Margin | vs. target |
|---|---|---|---|
| **$99** (Freelance SC) | **~$87/mo** (Zernio $24 + ScrapeCreators $21 + LLM $20 + Fly $8 + …) | **~12%** | **misses $30 by ~3×** |
| **$99** (Business SC rate) | ~$77/mo | ~22% | still misses |
| **$199** (consumer per-credit Creatify) | **~$127/mo** | **~36%** | misses $60 |
| **$199** (consumer per-SEAT Creatify, $99 floor) | ~$186/mo | **~6%** | underwater |
| **$199** (✅ **API-tier Creatify + .md levers**) | **~$52/mo** | **~74%** | **HITS $60 ✅** |

**Verdict (updated):** at the *naive* 6-channel/30-min design margins are thin (12–36%), **but with the .md levers + the Creatify API tier: $199 HITS its $60 target (~$52/mo, ~74% margin); $99 lands ~$40/mo (~60% margin) — healthy, but $30 is not reachable** without trimming Acts/crons or dropping a provider. The cost driver is **NOT the LLM** (only ~$20/mo, Flash-Lite-on-pulse works) — it's the **fixed social read/post layer + video:**

- **Zernio bills per connected channel ($6/account after 2 free)** → 6 channels = $24/mo. *Posting frequency is free; channel COUNT is the entire cost.* This collides head-on with "multi-platform from day one."
- **ScrapeCreators ~$21/mo** at the naive 5-calls-every-tick × 75 ticks. **Watermarked delta reads + lane rotation** (not every channel every tick) is the direct lever — and is exactly the Phase-2 ④ design.
- **Creatify — RESOLVED via the API/agency tier** (corrected 2026-06-16, [docs.creatify.ai/billing](https://docs.creatify.ai/billing)). The consumer *seat* plans ($39/$99) are a trap (per-seat, no rollover, no-share). But Creatify sells a dedicated **API tier**: **API Starter $99/500cr · API Pro $299/2,000cr ($0.15/cr) · API Enterprise (custom, multi-brand, "built for agencies")**. On the API path **URL→video = 5cr/30s = $0.75/video** (4× cheaper than the consumer rate). HeyMaya holds **ONE shared API/Enterprise account** and amortizes credits across all Studio tenants → video COGS ≈ **$10–12/tenant/mo**, not a $99 seat each. This is what takes **$199 to ~$52/mo COGS / ~74% margin (hits the $60 target)**. ⚠️ Still get **written confirmation from Creatify sales** that generating on behalf of paying end-customers is permitted (billing docs don't spell out reselling, though the API + Enterprise multi-brand framing is sold for exactly this).

**Levers to approach the targets** (none are LLM optimization): fewer connected channels (6→3 saves $18/mo on Zernio) · hourly pulse instead of 30-min (cuts ScrapeCreators + Twitter ~3×) · Business-rate ScrapeCreators at fleet scale · resolved Creatify licensing. Even doing all of these lands **~$40–45/mo on $99** — so **either accept thinner margin, raise prices, or drop a provider.**

> ⚠️ **Two structural decisions this forces:** (1) **Channel count is a pricing variable** — Zernio per-account means "how many channels does a tier include?" is a margin lever, not a feature toggle. (2) **Creatify's per-seat/no-rollover/no-share model may make $199 unviable** — confirm the licensing answer before committing the tier.
> ⚠️ **Still unmeasured:** every volume figure + Convex per-tenant GB-hr are estimates; ScrapeCreators/TwitterAPI/DataForSEO log `$0` today (`index.js:170`). **Provider-complete metering (Phase-2 ⓪) → a real metered test deploy is the only way to replace these models with measured COGS before locking prices.**

### 9c — Code-grounded COGS (call-pattern audit, 2026-06-16)

A second fan-out audited how the code ACTUALLY makes calls (caching, fan-out width, cron cadence). This **supersedes** the price×naive-volume model above and changes the picture:

| Tier | Code-grounded COGS/mo | Margin | Dominant lines |
|---|---|---|---|
| **$99** | **~$56–74** | ~34–44% | Zernio $18–24 · Kimi $15–20 · Gemini workers $10–15 · Fly $6 |
| **$199** | **~$75–100** | ~50–62% | + Zernio extra channel · Creatify $10–15 (API-amortized) |

**Three findings that change the strategy:**
1. **#1 cost driver is Zernio connected-account fees — NOT AI or research.** $6/account × 3.5–5 channels (`MIN_ACTIVE_CHANNELS=3` + promoted secondaries, `channelSelection.ts:47`) = $18–30/mo — *larger than the entire LLM stack and ~13× the read-API cost.* **Cheapest lever: drop the channel floor 3→2** = −$6/account, ~25–33% off the top line, a one-constant edit. **Channels-per-tier is THE pricing dial.**
2. **Read APIs are negligible today (~$1.70/mo combined).** `scrapeCreatorsCache` (TTLs: profile 6h/posts 30m/transcript 7d) + bet-channel rotation + `maxPages:1` on Twitter keep ScrapeCreators ~$0.90, TwitterAPI ~$0.68, DataForSEO ~$0.10. **The earlier $21 ScrapeCreators figure was a naive-sweep artifact** — the real code is far leaner.
3. **LLM ~$30–40/mo** (Kimi $15–20 + **Gemini workers $10–15**, 3–6 spawned per morning_brief) — HIGH confidence (instrumented via `recordAiCall`→`aiCallLog`). Bigger than I'd modeled, because of the *workers*, not the main brain.

> 🔴 **PULSE COST DELTA — load-bearing for the whole real-time vision:** all of §9c is TODAY's **cron-only** design (2 discovery events/day). The audit warns (`generators.ts:1593`) the **continuous-pulse design would spike read-API + Gemini-worker volume ~100×** and add **+$15–25/mo** in worker LLM cost. So the real-time engine is **NOT free on COGS.** Therefore: (a) the **cheap-model discipline (Flash-Lite on the scan, NOT Gemini-3-Flash workers) is mandatory, not optional**; (b) **read-API metering (Phase-2 ⓪) must ship BEFORE the pulse** — at 100× volume, `$0`-logged research calls become a real runaway risk; (c) the **per-hour budget must bound worker fan-out**, not just tokens.

**vs targets:** $99 at ~$56–74 misses the ≤$30 variable target (~$48–65 ex-Fly); $199 at ~$75–100 misses ≤$60. Margins are positive (34–44% / 50–62%) but the targets need **both** the Zernio channel lever **and** the cheap-model pulse discipline to approach.

## 10 — What changes vs. today (implementation steps)

1. **Heartbeat → hunter** (`HEARTBEAT.md` + deploy interval + budget guard): add Tier-0 scan + Tier-1 escalate; remove "discovery is crons-only" everywhere at once.
2. **`morning_brief` → digest** (cron prompt): frame + report, not build-from-scratch.
3. **Quality bar over quota** (playbook): drop the hard 15–20 floor; optimize conversions + a minimum cold-start presence floor.
4. **Guaranteed same-day activation** (Convex `scheduler.runAfter` on connect-complete): first hunt+act pass in minutes, warmth-gated.
5. **Loud, event-driven proof** (`record_conversion` → proactive ping).
6. **Live founder steering** (rides on the shared-bot inbound, in progress).
7. **Content as a first-class Act** with the tier-branched production line (§6).

## 11 — Sequencing (risk-ordered)

1. Changes 4 + 5 (cheap, high-value: activation + proof).
2. Change 3 (prompt-only quality reframe).
3. Change 6 (falls out of the Telegram inbound cutover).
4. Change 1 (hunter heartbeat) **last**, behind the hard per-hour budget + kill-switch, validated on staging against `gtmCostLedger` + `gtmAgentTrace` before prod.

## 12 — Testing (5 mandatory + sprint-specific)

Cross-tenant (a pulse for A never touches B's channels/budget) · plan-tier × action (video Studio-only; posting warmth+plan-gated, fail-closed) · adversarial (budget exhaustion → graceful monitoring fallback; dedup under concurrent ticks) · sibling-file (HEARTBEAT.md ↔ jobs.json ↔ discovery skill coherent) · TODO grep. **Sprint-specific:** cost-ceiling soak (busy niche → per-hour spend under cap, kill never trips in normal use) · TTFV (connect-complete → first pass within N min) · Creatify spend-kill-interaction test.

## 13 — Preserved, explicitly

Grounded-or-silent · anti-sycophancy · warmth/ban-safety floors · clicks→signups attribution · one-tap for Reddit/TikTok · web-first connect · single-agent-per-tenant. The philosophy is right; this sprint changes the **cadence** (batch → real-time) and the **success metric** (activity → conversions), and makes **content creation a first-class Act** of the same grounded engine.

## 14 — Current state vs. target (gap map, from the 2026-06-16 codebase audit)

**Headline: the product is ONE architectural inversion away from this target.** Every supporting piece exists — discovery is just wired *backwards*: it lives in two daily crons (`morning_brief` 7am, `midday_pulse` 1pm) and the heartbeat is *explicitly forbidden* from discovering (`generators.ts:1351,1593-1595` "It NEVER discovers"). The five "discovery" rows below are **five views of one missing system** — build them as ONE Phase-3 workstream, not five items.

| Component | Status | Note |
|---|---|---|
| `generate_slide_image` (grounded screenshots → Gemini image) | **HAVE** | done; cost-tracked (`mediaAssets.ts:600+`) |
| Dual-model infra (Kimi main + Gemini-Flash subagents + 3.1-Flash-Lite extraction) | **HAVE** | deployed (`deployMayaGtm.ts:343-366`) — exists, just not driving a real-time loop |
| 5 crons (schedules/ids) | **PARTIAL** | all registered; but `morning_brief` *spawns discovery* at 7am (`:1709`) instead of digesting |
| Attribution (`wrap_link`→`record_conversion`→Results) | **PARTIAL** | built + isolated; **no event-driven conversion ping** (only 8pm recap) |
| `weeklyReviews` UI surface | **PARTIAL** | narrative sent to Telegram; **table is never written to** (`schema.ts:1428`) + no UI query |
| Telegram inbound routing + steering | **PARTIAL** | chat_id→machine forward built (`telegramRouter.ts`/`telegramWebhook.ts`); **no lane/budget re-weight** from steering; `/inbound` native session creation unverified |
| Heartbeat discovery engine | **MISSING** | monitoring-only watchdog; discovery banned in HEARTBEAT.md/AGENTS.md/jobs.json |
| Per-lane watermarks (delta-only reads) | **MISSING** | cron workers do full re-pulls; `gtmTargetThreads.observedAt` not used as a watermark |
| Per-hour discovery budget + graceful degradation | **MISSING** | only *hard-kill* caps exist ($1/hr, $3/hr, $6/24h) that 403/destroy — the **opposite** of degrade-to-monitoring |

### Build backlog (risk-ordered)
- **Phase 1 — proof & activation wins (low risk, no cost exposure):** ① event-driven conversion ping (`attribution.ts:583-625`) · ② write + surface `weeklyReviews` (`getMyLatestWeeklyReview` + Results "Strategic Review" section) · ③ founder-steering plumbing (intent-classify + `save_steering_directive` + steering marker) — built *before* the heartbeat so it can read steering day one.
- **Phase 2 — engine foundations (no live loop yet):** **⓪ provider-complete cost metering FIRST** — per-provider price table so ScrapeCreators / TwitterAPI / DataForSEO record *real* cost instead of `costUsd:0` (`index.js:170`); without it the budget gate + the $30/$60 targets (§9b) are fiction. · ④ watermark schema (`gtmChannelWatermarks` / `gtmWatchLaneState`) + cursor-bounded delta reads · ⑤ per-hour + per-day discovery budget + monitoring-only degradation gate sized to the §9b ceilings ($1/day @ $99, $2/day @ $199) (`discoveryBudgetGate.ts`, ledger discovery-tagging). **All three MUST land before the heartbeat turns on.**
- **Phase 3 — the inversion (gated by Phase 2):** ⑥ heartbeat discovery engine + 30-min pulse (invert HEARTBEAT.md/AGENTS.md/jobs.json; rotating lanes; cheap-model scoring; budget gate; escalate→Acts; `gtmAgentTrace` per tick) · ⑦ `morning_brief` → pure digest reading overnight `gtmTargetThreads` (+ reconcile `midday_pulse`).

> ⚠️ **Load-bearing warning:** do NOT switch on continuous discovery until the Phase-2 budget gate exists. Today's kill-switches *block/destroy*; they do not *degrade*. An un-gated hunter heartbeat is a spend-runaway hazard — the exact failure mode that justified the original batch design.

## 15 — Margin levers & tier economics (target: ≥60% gross on every tier)

Goal: ≥60% gross margin on all three tiers, achieved with **cheap, quality-safe levers — not by cutting the brain or the machine.** Grounded in the §9c code-audit + the 2026-06-16 pricing research.

### 15.1 — Tier structure (channel-gated — channel count is the #1 cost lever)
| Tier | Channels | Video | COGS (optimized, Fly 2GB) | Margin |
|---|---|---|---|---|
| **$99 Starter** | up to **3** | — | ~$41/mo | **~59%** |
| **$149 Growth** | up to **6** | — | ~$64/mo | **~57%** |
| **$199 Studio** | up to **6** | + Creatify | ~$77/mo | **~61%** |

Enforce with **`planFeaturesGtm.maxActiveChannels` (3 / 6 / 6)** + have **`selectActiveChannels` respect it** (today it caps nothing — `channelSelection.ts:47` floors at 3 with NO upper cap). Fail-closed, server-side, like every tier feature. Channel gating doubles as **pulse-cost governance** (each active channel adds discovery-worker cost). Channel-gating + the at-scale Zernio **$3/account band** (11+ accounts fleet-wide) lift these another ~5–10 points.

### 15.2 — Fixed infra (LOCKED — leave as-is)
- **Fly: `shared-cpu-2x : 2048MB` (~$12/mo) — KEEP, do not downsize.** Bumped from 1x:1024 due to gateway/inbound issues (`deployMayaGtm.ts:400`). (⚠️ one live agent runs 4GB ≈ $21 — standardize on 2GB.) Machine sleeps between crons today; the always-on pulse removes that, so Fly stays ~$12.

### 15.3 — LLM levers (the big saving: ~$35 → ~$18, quality-safe)
1. **Prompt caching — DO IT (zero quality risk, biggest single saver).** Static context (PLAYBOOK / foundation / skills / TOOLS) is re-sent every cron + heartbeat tick → caching cuts *repeated-input* tokens **60–80%** with **no change to any output.** Near-term build item.
2. **Gemini 3.1 Flash-Lite for the CHEAP TIER ONLY** ($0.25/$1.50 — half of Gemini 3 Flash $0.50/$3.00). Benchmarks (2026): Flash-Lite is built for **extraction / routing / high-volume scan**; **Gemini 3 Flash is meaningfully stronger on reasoning + agentic + drafting (SWE-bench Verified 78%, beats Gemini 3 Pro).** **Decision: Flash-Lite does NOT replace Flash-3 wholesale** — it runs the scan + extraction + the cheap **"worth a deep look?" pre-filter**; **Flash-3 keeps fit-judgment + voice-drafting** (where slop risk lives). The saving comes from Flash-Lite pre-filtering so **fewer Flash-3 workers fire**, not from swapping the drafting model. Quality preserved.
3. **Route routine crons off Kimi** (evening recap, status pings) → Gemini 3 Flash; **keep Kimi K2 for synthesis / weekly strategy / high-stakes** (the anti-slop moat).

### 15.4 — ⚠️ Pulse caveat (these levers are mandatory, not optional, on the real-time design)
The continuous pulse adds **+$15–25/mo** LLM (more discovery workers) and **can't auto-stop Fly**. So on the pulse design the §15.3 levers are what **hold** 60%, not a bonus: **Flash-Lite-on-scan + the cheap pre-filter + prompt caching + the per-hour discovery budget bounding worker fan-out** are non-negotiable. On today's cron design, ≥60% is comfortable with these levers; on the pulse, ≥60% holds *only if* the cheap-model discipline holds.

## 16 — Pricing rollout (Stripe + landing) — operator-driven

When the 3-tier structure (§15.1) is locked, the rollout is:
1. **Stripe products** (operator): create `$99 Starter`, `$149 Growth`, `$199 Studio` price objects (+ annual variants); env vars `STRIPE_PRICE_*` per tier. (Today only the single `$99` `gtm99` + `$149` `studio` exist in `planGtm.ts`.)
2. **`planGtm.ts`** (code): extend `GtmPlan` to the 3 tiers; add **`maxActiveChannels`** (3 / 6 / 6) to `GtmPlanFeatures` + the per-tier feature sets; keep `canVideo` Studio-only.
3. **`selectActiveChannels`** (code): respect `maxActiveChannels` (today it has NO upper cap — `channelSelection.ts:47`). Fail-closed server-side.
4. **Landing page** (`app/clawlaunch/page.tsx` + pricing UI): show 3 tiers, gated channel counts, video on Studio; CTAs → `/sign-up?redirect_url=/onboarding/gtm` (unchanged).
5. **Onboarding/connect**: cap connectable channels by the chosen tier.
6. **Billing webhook** (`app/api/billing/stripe-webhook`): map the new price IDs → tier on `gtmPlanJson`.

Operator owns Stripe product creation + price IDs; code owns the gating + landing + webhook mapping.

## 17 — Landing page & value messaging (surface the new capabilities)

When the real-time operator ships, the landing must communicate that it's **an operator you hand GTM to**, not a posting tool. New capabilities to surface (each tied to a value claim):

| Capability (this sprint) | Landing claim | Proof element |
|---|---|---|
| Real-time pulse (not a daily scheduler) | "She watches your market every few minutes and jumps on the right conversations *while they're hot* — not once a day." | the Day-in-the-life (§2) |
| Makes the content | "Writes your posts + replies in your voice; on Studio, makes the videos too." | sample posts / a generated video |
| Right channels, not all channels | "Picks the 3 channels your buyers actually live on (6 on Growth/Studio) and works them." | the channel-fit logic |
| **Proves customers** ⭐ | "See exactly which post got you a signup — not likes, customers." | live conversion ping + Results page |
| Watch her think | "Open the Thinking view and watch her reason and decide, in real time." | the shipped decision-timeline |
| Hands-off | "~2–3 taps a day. She runs it; you build." | the tap-load cap |
| Honest | "Grounded or silent. She tells you the hard truth — even when it's your pricing, not your marketing." | the diagnosis loop |

**Value framing (lead with the comparison):** a founder's real alternatives are *hire a marketer (~$5–10k/mo), an agency (~$2–5k/mo), or do it themselves (their time).* **Maya is an always-on GTM operator for $99–$199 — a fraction of those — and it proves which actions produced customers, which none of those reliably do.** Lead the page with **(1) time-to-first-value** ("real work on day one, not a setup project") and **(2) proof** ("which post → which customer"). 

**Per-tier value ladder (from §15.1):** $99 Starter (3 channels, full real-time engine, no video) · $149 Growth (6 channels) · $199 Studio (6 channels + AI video). Frame the upsell as *breadth → content*, and make the proof/attribution the same on every tier (it's the moat).

Implementation: new feature blocks + the 3-tier pricing UI on `app/clawlaunch/page.tsx`; keep CTAs mode-aware (waitlist on prod) per §16. Operator owns final copy.

## 18 — Test plan (what we need to test before each phase ships)

**Always — the 5 mandatory categories per change:** cross-tenant isolation · plan-tier × action (fail-closed, incl. reads) · adversarial inputs · sibling-file coherence · TODO grep.

**Telegram shared bot (in flight):**
- [ ] Pairing: scan QR → @Mayaaaayaayaa_bot → `/start pair_` → chat binds → "✓ Connected" (UI flips, phone confirmation).
- [ ] Routing: a message → Convex routes to the right machine; reply comes back; **shared bot webhook stays at Convex (no hijack)** — verify `getWebhookInfo` after a deploy.
- [ ] Cross-tenant: agent A's chat never routes to agent B's machine.
- [ ] Unpaired chat → "open your dashboard" nudge, reaches no agent.

**COGS metering (Phase-2 ⓪ — prerequisite for everything cost):**
- [ ] ScrapeCreators / TwitterAPI / DataForSEO record REAL `costUsd` (not 0).
- [ ] A metered live deploy → per-provider $/agent/day matches the §9c model (or correct it).

**Pricing / tier gating:**
- [ ] `maxActiveChannels` (3/6/6) enforced server-side, fail-closed; `selectActiveChannels` respects it.
- [ ] Stripe price IDs → correct tier on `gtmPlanJson`; video gated to Studio.

**Margin levers (§15):**
- [ ] Prompt caching live → measurable repeated-input token reduction (target ~60–80%); no output regression (slop check on the 50-corpus).
- [ ] Flash-Lite on scan/extraction only; Flash-3 retained for drafting (quality unchanged).

**Pulse engine (Phase 3 — the big one):**
- [ ] Cost-soak: busy niche → per-hour spend stays under the discovery budget; kill-switch never trips in normal use.
- [ ] Degradation: budget exhaustion → monitoring-only (own-posts + inbox), discovery paused, <$0.10/tick.
- [ ] Dedup/lease: concurrent ticks never double-act.
- [ ] Watermarks: only-new reads, no full re-pulls.
- [ ] TTFV: connect-complete → first hunt+act pass within N minutes (activation).
- [ ] No-runaway: validate on staging against `gtmCostLedger` + `gtmAgentTrace` BEFORE prod.

**Proof & activation (Phase 1):**
- [ ] Conversion → event-driven Telegram ping (not batched to evening).
- [ ] `weeklyReviews` written + surfaced in Mission Control (Strategic Review on Results).
- [ ] Same-day first engine pass fires on connect-complete (warmth-gated).

**Decision-timeline (shipped):** live-verify on a real Fly deploy that tool calls stream into the Thinking page.
