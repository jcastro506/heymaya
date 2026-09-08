# Tiered Pulse + Cost Model (margin-first)

**Status: WORKING DRAFT — 2026-06-23.** Grounded in a live cost measurement (staging, Starter agent, Cal AI, $8 kill cap). The per-tier pulse cadence is the primary product differentiator AND the primary variable-COGS lever; this doc ties the two together so every "more activity" promise is margin-checked.

---

## 0. The core idea

**Differentiate tiers by how much Maya DOES — and "how much she does" = how often the discovery pulse fires.** More pulses → more buyer-intent threads found → more posts/replies → more visible value. Each pulse also costs tokens + reads, so the same dial that sells the tier sets its COGS. We bill the user in **outcomes** ("a steady daily presence", "always-on") and run the dial in **pulses** internally — never expose pulses/credits/tokens.

**Heartbeats stay 30m for now** (60m is a banked lever, see §5). The pulse cadence + discovery budget do the per-tier work.

---

## 1. What we measured (live, tonight)

Single Starter agent, real Fly deploy, OpenRouter spend polled every ~4 min and attributed via `openrouterSpend.ts` (the de-blinded poll):

| Phase | Observed |
|---|---|
| **One-time boot research** | ~**$1.40** total, clean monotonic decay ($0.67 → $0.44 → $0.17 → $0.12 → $0.05 over ~12 min) |
| **Post-research BOOT work** (synthesis → plan → drafts) | ~$0.05–0.08 / 5 min for ~30 min (one-time) |
| **First 30m heartbeat** | landed in the post-BOOT window; small (≪ a research tick) |
| **True idle between pulses** | settling toward ~$0 (measurement ongoing) |

**Takeaways:** the one-time boot is bounded (~$2), the spend decays correctly, and monitoring SEES it (the thing that was blind during the $28 bills). The number that governs margin is the **steady-state daily burn** after boot — driven by pulses + crons + heartbeats.

---

## 2. The cost model (fixed + variable)

**FIXED / month** (independent of token burn):
- Zernio per connected channel (the #1 COGS driver) — ~$6/channel/mo.
- Fly always-on machine — ~$4/mo.

**VARIABLE / day** (token + read burn — what the pulse cadence controls):
- **Heartbeat**: 48/day (30m). Light watchdog ticks (`HEARTBEAT_OK`) ≈ $0.25–0.50/day *if they stay light*. (60m → ~half.)
- **Discovery pulse**: N/day (per-tier, §3). Each tick = ONE budget-gated, watermark-bounded lane scan + judge ≈ $0.10–0.20/tick of tokens, **plus reads that are hard-capped by the per-tier discovery budget**.
- **Daily crons**: morning_brief (7am) + midday_pulse (1pm) + evening_recap (8pm) ≈ 3 reasoning turns ≈ $0.50–0.70/day.
- **Drafting/replying on real hits**: variable — this IS the value; bounded by the pulse finding genuine hits (not a fixed cost).

**The brake already in place:** every pulse calls `check_discovery_budget` first and **degrades to monitoring-only when the day's discovery allowance is spent** (`discoveryBudgetGate.ts`). So reads can't run away even if the pulse fires often — the day's read budget is the hard ceiling.

---

## 3. Per-tier pulse + guarantee design

The dial: **discovery-pulse frequency** + **daily discovery budget** + **active-channel cap**. Frequencies are env-tunable (`MAYA_GTM_PULSE_CRON_EXPR`) — per-tier wiring is the implementation follow-up (§6).

| Tier | $/mo | Active channels | Discovery pulse | Daily discovery budget | Marketed guarantee (outcome, not pulses) |
|---|---|---|---|---|---|
| **Starter** | $99 | 3 | every **6h** (4/day) | $1.00 | "A daily presence — Maya finds and works a few buyer threads a day across your top 3 channels." |
| **Growth** | $149 | 6 | every **4h** (6/day) | $1.50 | "All 6 channels, a steady all-day presence — more threads found, more posts and replies." |
| **Studio** | $199 | 6 | every **3h** (8/day) | $2.00 | "Always-on — the tightest discovery loop, the most engagement, plus Maya makes your videos." |

**Overnight taper (all tiers):** drop the pulse to every 6–8h between ~11pm–7am operator-local regardless of tier — nobody's converting at 3am, and it's the cheapest way to cut the daily burn without touching the daytime promise.

### Rough margin per tier (variable + fixed)

| Tier | Fixed/mo | Variable/mo (steady) | COGS/mo | Margin @ price |
|---|---|---|---|---|
| Starter $99 | ~$22 (3ch + Fly) | ~$30 (~$1/day) | ~$52 | ~**47%** |
| Growth $149 | ~$40 (6ch + Fly) | ~$45 (~$1.5/day) | ~$85 | ~**43%** |
| Studio $199 | ~$40 (6ch + Fly) | ~$60 (~$2/day) + creative ~$22 | ~$122 | ~**39%** |

**Honest read:** these land ~40–47%, BELOW the 60% target — the per-channel Zernio fixed cost + the pulse/cron variable burn are heavier than the headline prices want. The §5 levers are what move each tier toward ~55–60%. Margins on $99 specifically are **tight and require the discipline below** — this is real, not pessimism.

---

## 4. Marketing each tier (what the user sees)

- Never "pulses", "credits", "tokens", or "$/day". Sell **activity + outcomes**.
- **Starter** — "Maya runs your top 3 channels: finds buyers, posts, and replies for you, every day."
- **Growth** — "All 6 channels, all day. More found threads, more posts, more replies — a real presence."
- **Studio** — "Always-on Maya, the tightest loop — *and she makes your videos* (UGC + short-form, paced across the month)."
- The upgrade story is **volume + reach + video**: Starter→Growth = breadth (3→6 channels) + more activity; Growth→Studio = max cadence + video.

---

## 5. Cost-saving levers (ranked)

1. **Per-tier discovery-pulse frequency** (§3) — the main dial; sets both value and COGS. *Implement next.*
2. **Overnight pulse taper** (6–8h, 11pm–7am) — cheapest daily-burn cut; no daytime promise lost. *Implement next.*
3. **Per-tier daily kill cap** — replace the flat $6/day wall with Starter $1.50 / Growth $2.50 / Studio $4. Backstop only — the cadence must genuinely fit under it (a kill cap is NOT how you achieve a budget; it just stops runaways). *Implement next.*
4. **Bounded one-time onboarding research** — pin the boot research job to ~$3.50 so deploy-day can't spiral, separate from the steady-state daily wall.
5. **Heartbeat 30m → 60m** — halves 48→24 ticks/day. **Banked for now** (operator: leave at 30m); flip when we want the saving.
6. **Cheap model for routine** — pulses + heartbeats + light crons on the cheapest capable model; reserve the stronger model for synthesis/judgement.
7. **Pulse self-throttle (already live)** — `check_discovery_budget` → monitoring-only when the day's reads are spent.

---

## 6. Implementation follow-ups (not yet coded)

- Per-tier `discoveryPulseExpr` (read tier from `planFeaturesGtm`, not a single env) — Starter 6h / Growth 4h / Studio 3h.
- Overnight taper window in the pulse cron.
- Per-tier daily kill cap in `spendKill.ts` (mirror `discoveryDailyBudgetUsd`'s per-tier shape).
- Pin onboarding research `budgetUsd` to ~$3.50 at deploy.
- Surface the per-tier "guarantee" copy on the pricing/landing page (outcome language from §4).

**Source measurements:** the openrouterSpend poll + `discoveryBudgetGate.ts` (per-tier read budgets $1/$1.5/$2 already live) + `generators.ts discoveryPulseExpr` (default `0 */3 * * *`, env-tunable) + `deployMayaGtm.ts` heartbeat `every: 30m`.
