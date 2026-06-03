# ClawLaunch — Top-Tier Growth-Agent BUILD PLAN (no video, no dedicated CRO)

> The buildable sprint plan. Goal: Maya goes from "posts for you" → a top-tier growth operator judged on **customers**, that **compounds** with every founder. Each sprint covers BOTH **how Maya uses the new capability** (agent/skill side) AND **how we implement it** (Convex/code side). Deep research + cost data: `docs/CLAWLAUNCH_TOP_TIER_AGENT_SPRINT_PLAN.md`.
>
> **Excluded per operator (2026-06-03):** Video (parked for the Gemini omni model). A dedicated CRO/landing-page inspector — instead, Maya just uses `search_web` to read a site when she wants to.

## Operating constraints (every sprint)
- **NO new Convex tables** — schema is at the TS DataModel ceiling. Everything new is JSON-on-row on an existing table, or reuses the two scaffold tables that exist (`gtmArchetypeLearnings`, `gtmSkillImprovementProposals`).
- **Sibling-file coherence** — a skill `.md` change must also update its `generators.ts` / `bundledLocalSkills.ts` mirror, and any new tool must be added to `index.js` + `openclaw.plugin.json` + re-synced (`npm run sync:bundled-gtm-plugin`) + taught in `renderTools` + the relevant skill.
- **Validation = deploy + read the transcript/DB.** Unit tests cover server gates; whether Maya *uses* a tool is proven on a real deploy.
- **Per-tool pattern (established):** typed `tool()` in `index.js` → `getLc/postLc` → `/lc_gtm/<x>` httpAction (hookToken auth, agentId from token never body) → internal action/query. Cost auto-logged.

## Operator-blocked — unblock in PARALLEL
| Item | Gates | Action |
|---|---|---|
| **DataForSEO account + ~$50 creds** | Sprint 2 (demand + reviews) | Create account, fund, provide `DATAFORSEO_LOGIN`/`PASSWORD` |
| **Agent-wake latency spike** | Sprint 7 (intent reflex) | I spike whether OpenClaw can low-latency-trigger one focused turn; if not → tighter per-agent cron (higher COGS) |
| Founder Stripe OAuth (later, low reach) | revenue-grade proof | Defer |

---

## Sprint 1 — Open web + "look at any site" (`search_web`)
**Why first:** cheapest depth jump, zero new vendor (the Gemini grounded-search integration ALREADY exists in `convex/integrations/gemini/groundedSearch.ts`, used by the monthly platform-algo cron — we just expose it). Also covers the operator's "we can use websearch to look at a site" — `search_web` reads a landing page or competitor site on demand, so no dedicated CRO tool is needed.

**Implement:**
- New `/lc_gtm/search_web` httpAction wrapping `geminiGroundedSearch(query)` (returns cited cards: url/title/excerpt/domain). New `search_web` typed tool in `index.js` + manifest + re-sync.
- Flip the "do NOT call web_search" prohibitions in `generators.ts` (~L1176), `maya-foundation-research/SKILL.md` (~L97), `maya-competitor-researcher/SKILL.md`, `bundledLocalSkills.ts` mirror.
- Cost: ~$0.18/research run; cap calls in-skill (the `maxScrapeCreatorsCalls` pattern). **No operator block** (`GEMINI_API_KEY` set).

**How Maya uses it:**
- In **foundation research**: read each direct competitor's pricing / positioning / changelog page → populate the `pricing` / `positioning` / `url` / `complaints` fields that already exist on `save_foundation_competitor`. The competitive map stops being social-only.
- **Ad-hoc "look at a site"**: when she wants to judge the founder's landing page (e.g. clicks-but-no-signups) or a competitor's site, she calls `search_web` / reads the page and forms a grounded opinion — no separate CRO machinery.
- Rule: grounded-or-silent still applies — cite the page, don't invent.

**Effort:** S. **Tests:** route auth + cross-tenant; the tool is exercised live on deploy.

---

## Sprint 2 — Demand intelligence (DataForSEO) *(operator-blocked on creds)*
**Why:** the genuinely NEW intelligence Maya can't fake from threads — where buying demand is actually *rising*, and what real customers complain about competitors.

**Implement:**
- New `convex/integrations/dataforseo/` client (basic-auth). Two tools + routes:
  - `search_demand({ seeds[] })` → DataForSEO Keywords Data: real Google volume + rising/related keywords + free-rider PAA/autocomplete. (~$0.0001/keyword.)
  - `read_reviews({ competitor })` → DataForSEO Business Data: Trustpilot + App Store + Play + Google reviews. (~$0.75/10k.) **G2/Capterra NOT covered — don't promise them.**
- A new `demandJson` / `seoOpportunity` field on a foundation row (JSON-on-row — no new table).
- Cost: single-digit cents/customer/month.

**How Maya uses it:**
- In **foundation research**: derive keyword seeds from the buyer map → `search_demand` → identify rising buying-intent topics + the SEO/content opportunity; `read_reviews` on each competitor → append real objections to `save_foundation_competitor.complaints[]`.
- In the **daily plan + strategy**: tilt content toward rising-demand topics; use review objections as content angles ("people leaving <competitor> because of X").

**Effort:** M. **Operator-blocked:** DataForSEO creds (one account covers both tools).

---

## Sprint 3 — Close the loop: activation + self-reported attribution
**Why:** "own outcomes" — prove a *customer who stuck*, not just a signup. (No dedicated CRO tool; the "why didn't they convert" read is `search_web` + the strategic diagnostician in Sprint 6.)

**Implement:**
- **Activation:** widen `gtmConversions.kind` with `"activated"` (union-widen on an existing table = schema-safe) + `window.lcMaya.activated()` in the pixel snippet (`getConversionSetupHttp`). Self-report floor via `record_conversion` for non-technical founders.
- **Self-reported attribution:** extend the pixel + coaching so the founder adds a "How did you hear about us?" field; capture answers (the `gtmConversions.note` field already exists). Closes the ~90% organic measurement gap.
- New `maya-activation-coach` skill.

**How Maya uses it:**
- Reports **activation rate + time-to-value** ("12 signed up, 2 came back — your aha is X, they're not reaching it; cut onboarding from 7 steps to 3").
- Offers the activation pixel + the "how did you hear about us" field ONCE, never nags (mirror conversion-tracker's discipline).
- On **clicks-but-no-signups**: uses `search_web` to read the landing page + hands off to the strategic diagnostician (Sprint 6) — no separate CRO tool.

**Effort:** M. **No operator block** (OpenRouter + existing pixel).

---

## Sprint 4 — The experiment-stats core (Bayesian honesty)
**Why:** today "what's winning" is hand-weighted constants (`signups + demos*2 + replies*0.25 >= 5`) and the "your punchy hooks convert 4x" claim has **zero supporting computation.** Make it real math.

**Implement:**
- **`getAttributeOutcomes` join** in `attribution.ts` — per (dimension, attribute-value) aggregates joined to conversions (`{hookType:"punchy", posts:12, signups:3}`). Reuses the existing wraps→clicks→conversions walk + `gtmDraftedContent.attributes`. Expose as `get_attribute_outcomes` tool.
- **`convex/gtmMaya/experimentStats.ts`** (pure, unit-testable, no DB): Beta posteriors → `{pBest, ci80, verdict}`; a winner needs **P(best) ≥ 0.85 AND ≥ floor conversions** (never P(best) alone). Bounded Monte-Carlo (deterministic seed for test stability).
- Rewire `decideExperimentScale` (distributionMotions.ts) + `decideLearningLoop` (resultsLoop.ts) to call it; delete the divergent weighted-sum heuristics. Expose `get_experiment_verdict` tool.

**How Maya uses it:**
- `maya-results-reviewer` + `maya-weekly-review` read **real posteriors** instead of guessing. Maya can finally say the most valuable thing a low-volume agent can: *"I don't have enough data to call this yet — here's exactly how many more conversions I need,"* and *"lowercase hooks: 3 signups / 12 posts vs polished 0 / 9 — 84% likely better."*

**Effort:** M. **Tests:** `experimentStats.ts` against the fixture corpus (pure functions — ideal).

---

## Sprint 5 — Systematic experimentation: registry + allocator + honest re-weight
**Why:** turn the stats core into a compounding loop with real explore/exploit.

**Implement:**
- **Experiment registry:** `experimentsJson` on `gtmAgents` (hypothesis/dimension/arms/metric/status) + `experimentId`/`armLabel` stamped on `gtmDraftedContent.attributes`. Tools `save_experiment` / `assign_arm`.
- **Thompson-sampling allocator** in `experimentStats.ts` (`allocateArm` — draw from each arm's posterior).
- **Honest re-weight:** `gtmNicheLearnings.confidenceScore = pBest` (computed); `save_learning` server-validates confidence vs trials (fail-closed); contradicted learnings auto-retire.
- **Taxonomy discipline:** ≤2 attribute dimensions at once (hook > format > angle > cta > channel > time); ICE-ordered backlog (extend `experimentPlanner.ts`).

**How Maya uses it:**
- The **morning brief** lets the allocator (not vibes) pick today's hook/format and **says why**: "Running the lowercase-hook arm (71% likely best); 1 post tests the explainer arm so it gets a fair shot."
- The **weekly review** promotes/retires learnings from computed posteriors, with counter-overfitting enforced by the floor, not prompt memory.

**Effort:** M.

---

## Sprint 6 — The strategic partner (hard truths: positioning → PMF → pricing)
**Why:** extend honesty from "your *post* flopped" to "your *product/positioning/pricing* is the problem" — grounded + humble. (Uses `search_web` from Sprint 1 to read the landing page, not a CRO tool.)

**Implement:**
- **Reply-sentiment/confusion tagging** in `maya-results-reviewer` over replies/DMs Maya already pulls: `confusion`, `wrong-comparison`, `price-objection`, `unprompted-demand`.
- **`maya-strategic-diagnostician` skill** — escalates the existing positioning-vs-distribution call up to `messaging | positioning | pmf_suspected | pricing | distribution`, **tier-capped** (`strong|lean|hunch`), evidence-required. **PMF/pricing verdicts hard-capped at `lean`** + always paired with "this is what I can't see from outside; run X." Verdict stored as a field on the weekly-review action-log row (no new table).
- **The surface:** weekly-review Block 3 escalation + a **throttled hard-truth ping** (only on a `strong` non-distribution verdict persisting ≥2 weeks, ≤ once/~3 weeks).
- **Survey tools:** `propose_pmf_survey` (Sean-Ellis 40%) + `propose_pricing_test` (van Westendorp) — turn the honest "I can't see retention/pricing" into a real instrument.

**How Maya uses it:**
- When reach is real but conversion is flat across ≥2 posts + confusion replies appear → she reads the landing page via `search_web` and tells the founder, plainly: *"More posting won't fix this — it's your positioning. Here's the pattern. Rewrite who this is for before we post another week."*
- For PMF/pricing she NEVER asserts a verdict — she surfaces a grounded suspicion + the evidence + hands over the survey: *"I can't see retention from out here; run this 5-question survey and I'll score it."*
- **The #1 guard:** a *wrong* hard-truth ("you don't have PMF") is worse than silence. Every verdict fails toward "suspicion + evidence + what would confirm it." That humility is the credibility.

**Effort:** M/L.

---

## Sprint 7 — The speed moat: real-time intent strike *(spike first)*
**Why:** the highest-converting GTM action is answering a buyer the MOMENT they ask "is there a tool that does X." Today the fastest Maya reacts is the 1pm cron. The strike mechanism (draft→ban-safety→post / one-tap card) is **already built** — this is the *trigger + gate*. Read primitives (`research_reddit sort=new`, `research_x since:`, HN Firebase/Algolia) + the watchlist (`gtmBuyerMap.intentPhrases`) + dedup (`gtmTargetThreads`) all already exist.

**Implement:**
- **SPIKE FIRST:** agent-wake latency. If OpenClaw can't low-latency-trigger one focused turn → fall back to a tighter per-agent cron.
- `intentWatchJson` on `gtmAgents` (compiled from intent phrases + bet channels).
- **Central intent-poll cron** (Convex, every 2-3 min, scoped to bet channels/keywords, plan-gated via existing `monitoringEnabled`). **The watcher lives in Convex, NOT the agent** (agents can't poll cheaply).
- **Cheap relevance + dedup gate (non-negotiable):** dedup on `gtmTargetThreads` → non-LLM pre-filter (keyword + author-quality + freshness + velocity) → ONE cheap Flash-Lite "real buyer? we answer it?" call on survivors only. This gate is the whole ballgame.
- **Strike trigger** → existing `post_to_channel` / `send_confirm_card`. Cadence: strikes ADD to today's queue (never replace), hard daily strike budget (≤2-3 auto, rest one-tap), warmth-respecting; attribution-wrap every strike.

**How Maya uses it:**
- She's **woken with a pre-vetted, pre-deduped hot thread** ("strike this"), drafts in voice, and the existing post path fires (auto on X/LI/IG/YT, one-tap card on Reddit/TikTok) within minutes.
- HEARTBEAT.md / AGENTS.md prose updated so she understands the reflex is **Convex-owned** — she does NOT poll; she just strikes what she's handed.
- The weekly review reads the attribution on intent strikes to **prove or kill** the 10x-conversion claim.

**Effort:** M/L. **Operator-blocked:** the agent-wake spike result.

---

## Sprint 8 — The compounding brain (archetype moat) *(plumb early, pays off at density)*
**Why:** every attributed founder should make Maya smarter for the next in their archetype — the defensible, gets-better-with-scale moat. The table (`gtmArchetypeLearnings`), index, read query, privacy contract, and deletion-exemption ALL already exist — they're just empty/unwired. Goes live only at **cohort density (≥5 attributed founders per archetype)** — so plumb it now so the corpus accrues from day one; don't market it live until an archetype clears the floor.

**Implement:**
- **Structure the per-founder signal:** add `structuredJson` (`{venue, hook, format, timeBucket, outcome}`) to `gtmNicheLearnings` (today it's free text → un-aggregatable).
- **Cross-tenant aggregation job:** monthly Convex cron, per archetype, rolls up converting venues/hooks/formats/times, **publishes only when `distinctTenantCount ≥ 5`** (k-anonymity), generalizes up the archetype hierarchy below floor, returns **PII-free tuples only** (the query physically can't return `accountId`/`agentId`).
- **Expose + warm-start:** wire the dead `getArchetypeLearnings` query to a `get_archetype_playbook` tool; onboarding reads the prior, falling back to `platformAlgoCache` + own research when empty.
- **Outcome feedback:** confirmations raise confidence, contradictions lower/retire across tenants. *(Flagged, last:)* the `gtmSkillImprovementProposals` consumer — k-floor + A/B + human-gated merge, core-safety skills permanently off-limits, behind a flag.

**How Maya uses it:**
- At **synthesis**, after she tags the app archetype, she fetches the archetype prior and folds it in as a **soft prior** ("dev-tool founders convert best in r/X with the Y hook — let me confirm that holds for you") — her own research confirms or overrides it. The empty warm-start hook in `maya-foundation-research` becomes live.
- Her converting learnings feed the monthly rollup → the brain compounds.

**Effort:** M/L.

---

## Execution order
1. **Sprint 1** (open web — cheap, no block, also covers "look at a site").
2. **In parallel:** unblock **DataForSEO** (→ Sprint 2); run the **agent-wake spike** (→ gates Sprint 7).
3. **Sprint 3** (activation + self-report) → **Sprint 4** (stats core) → **Sprint 5** (experimentation compounds).
4. **Sprint 6** (hard truths) → **Sprint 7** (intent speed, after the spike) → **Sprint 8** (archetype brain — plumb early so the corpus accrues).

## The two bets
- **Own the outcome** (Sprints 3-4-6): judged on customers; diagnose why they don't convert (via `search_web` + the diagnostician); tell hard truths.
- **Compound** (Sprints 5-7-8): real learning per founder + a cross-customer brain per customer base.
Open web (1) + demand (2) + intent speed (7) make that loop richer and faster.
