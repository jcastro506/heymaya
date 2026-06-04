# ClawLaunch — Top-Tier Growth-Agent Sprint Plan

> Goal: take Maya from "AI that posts for you" → a top-tier AI growth operator judged on **customers, not posts**, that **compounds** with every founder it runs. Synthesized from a 6-pillar code-audit + external-API research pass (2026-06-03).

## The meta-finding
Across all six pillars, the same pattern: **the bones are real, the connective tissue is missing.** The closed-loop attribution, ban-safety, the post/confirm path, experiment *design*, the positioning diagnostic, the cross-tenant table + privacy contract — all exist. What's missing is the wiring that turns them into outcomes: CRO diagnosis isn't reachable by the agent; "what's winning" is heuristic constants not math; the archetype table is empty; PMF/pricing honesty is half-built; there's no real-time intent loop; the open web is walled off. So this is mostly **wiring + a few new integrations**, not a rewrite.

## Hard constraints (carry into every sprint)
- **Schema is at the TS DataModel table-count ceiling — NO new tables.** Everything new is JSON-on-row on an existing table, or reuses the two scaffold tables that already exist (`gtmArchetypeLearnings`, `gtmSkillImprovementProposals`).
- **Sibling-file coherence:** a skill `.md` change must also update its `generators.ts` / `bundledLocalSkills.ts` mirror.
- **Validation = deploy + read the transcript/DB**, not assertions (per project doctrine).

## Operator-blocked items — unblock these in PARALLEL (they gate specific sprints)
| Item | Unblocks | Action |
|---|---|---|
| **DataForSEO account + creds** (~$50 min top-up) | Demand intel (`search_demand`) + review mining (`read_reviews`) — Sprint 1.5 | Create account, fund, provide `DATAFORSEO_LOGIN`/`PASSWORD` |
| **Screenshot API key** (urlbox/screenshotone) OR Playwright-on-Fly | Visual/above-the-fold CRO (Sprint 2 enhancement) | Provide a key, or approve a Playwright Fly machine |
| **Agent-wake latency spike** (OpenClaw can low-latency-trigger one focused turn?) | The real-time intent reflex (Sprint 6) | I spike it; if not supported, falls back to a tighter per-agent cron (higher COGS) |
| **Founder Stripe OAuth** (per-customer, later) | Revenue-grade proof (`kind:"revenue"`) | Defer — low early reach |

## Parked
- **Video (natural-language generation + editing).** Gated on the Gemini omni model. The slideshow/photo-mode path already ships; revisit full video when the model lands.

---

## The sprints (sequenced by leverage × dependency × fewest operator-blockers)

### Sprint 1 — "See the whole board" (open web), zero new vendor — **S/M**
The cheapest depth jump. The Gemini grounded-search integration **already exists** (`convex/integrations/gemini/groundedSearch.ts`, used by the monthly platform-algo cron) — just expose it.
- **`search_web` tool** — wrap `geminiGroundedSearch()` as a hookToken HTTP route + typed tool. Returns cited cards. [S]
- **Re-wire the competitive map** — flip the "do NOT call web_search" prohibitions in `maya-foundation-research` / `maya-competitor-researcher` (+ generator mirrors) to "read each competitor's pricing/positioning/changelog page; populate `pricing`/`positioning`/`url`/`complaints` on `save_foundation_competitor`" (fields already exist). [S]
- **Delivers:** Maya reads competitor pricing/positioning + the open web, not just social threads. **No operator block** (GEMINI_API_KEY already set).

### Sprint 1.5 — Demand intelligence (operator-blocked on DataForSEO) — **M**
Slots in whenever DataForSEO creds land; the genuinely *new* intelligence Maya can't fake from threads.
- **`search_demand` tool** (DataForSEO Keywords Data) — real Google search volume + rising/related keywords + free-rider PAA/autocomplete from buyer-map seeds → a new `seoOpportunity`/demand JSON output on a foundation row. Reveals where buying intent is *rising*. [M]
- **`read_reviews` tool** (DataForSEO Business Data) — Trustpilot + App Store + Play + Google reviews → objection gold into the existing `complaints[]`. (G2/Capterra not covered — set that expectation; defer Apify gap-fill.) [M]
- **COGS:** single-digit cents/customer/month. **Operator-blocked:** DataForSEO creds (one account covers both tools).

### Sprint 2 — "Own outcomes" pt.1: CRO diagnosis + the clicks→no-signups loop — **M**
The #1 "outcomes not outputs" win, mostly *removing a wall* (the landing-page inspector exists but is Clerk-gated + keyword-shallow + not in the plugin).
- **`inspect_landing` tool** — make the inspector agent-callable + upgrade keyword-scan → **LLM-judged CRO heuristics** (5-sec value-prop clarity, feature-vs-outcome, CTA, social proof, form friction). [M]
- **The trigger** — when attribution shows a post with **clicks > 0, signups = 0** (and pixel installed), Maya auto-runs `inspect_landing` and delivers one honest verdict: *"32 clicked, 0 signed up; your hero leads with feature jargon; try this outcome line."* (rules into `maya-results-reviewer` + `maya-evening-recap`). [S]
- **Self-reported attribution** — coach the founder to add "How did you hear about us?" + capture answers (closes the ~90% organic measurement gap; `gtmConversions.note` already exists). [S]
- **Cleanup** — reconcile/delete the orphaned `resultsLoop.ts interpretResults()` heuristic (a second, divergent "is this working?" path on a stale table). [S]
- **Enhancement (operator-blocked):** screenshot → vision-model above-the-fold analysis. [M]
- **Delivers:** Maya diagnoses *why* clicks don't convert. No operator block for the core (OpenRouter + existing pixel).

### Sprint 3 — "Own outcomes" pt.2: activation + the experiment-stats core — **M/L**
Two leaps: prove *activation* (not just signup), and make "what's winning" real math.
- **Activation modeling** — widen `gtmConversions.kind` with `"activated"` (union-widen on an existing table = schema-safe) + a `window.lcMaya.activated()` pixel call + `maya-activation-coach` skill (self-report floor for non-technical founders). Maya reports activation rate + time-to-value and diagnoses onboarding when it's low. [M]
- **`getAttributeOutcomes` join** — the real variant→outcome correlation: per (dimension, attribute-value) aggregates joined to conversions (`{hookType:"punchy", posts:12, signups:3}`). This is the structure `maya-results-reviewer` *claims* to use but has no data for today. [M]
- **`experimentStats.ts` Bayesian judge** — pure, unit-testable: Beta posteriors → `{pBest, ci80, verdict}` where a winner needs **P(best) ≥ 0.85 AND ≥ floor conversions** (never P(best) alone). Replaces the hand-weighted `customerSignal >= 5` constants in `distributionMotions.ts` + `resultsLoop.ts`. [M]
- **Delivers:** Maya proves activation AND can say the most valuable thing a low-volume agent can: *"I don't have enough data to call this yet — here's exactly how many more conversions I need."*

### Sprint 4 — Systematic experimentation: registry + allocator + honest re-weight — **M**
Turn the stats core into a compounding loop.
- **Experiment registry** — `experimentsJson` on `gtmAgents` (hypothesis/dimension/arms/metric/status) + `experimentId`/`armLabel` stamped on drafts + `save_experiment`/`assign_arm` tools. [M]
- **Thompson-sampling allocator** — the morning brief draws from each arm's posterior to pick today's hook/format (explore vs exploit), and *says why*. [S]
- **Honest weekly re-weight** — `gtmNicheLearnings.confidenceScore = pBest` (computed, not model-asserted); `save_learning` server-validates confidence against trials (fail-closed). Contradicted learnings auto-retire. [S-M]
- **Taxonomy discipline** — ≤2 attribute dimensions tested at once (hook > format > angle > cta > channel > time); ICE-ordered backlog. [S]
- **Delivers:** real experiments that compound, with counter-overfitting enforced by math, not prompt memory.

### Sprint 5 — The strategic partner (hard truths: positioning → PMF → pricing) — **M/L**
Extend honesty from "your *post* flopped" to "your *product/positioning/pricing* is the problem," grounded + humble.
- **Reply-sentiment/confusion tagging** — tag the replies/DMs Maya already pulls: `confusion`, `wrong-comparison`, `price-objection`, `unprompted-demand` (the load-bearing inputs for Dunford-style positioning + pricing tells). [S-M]
- **`maya-strategic-diagnostician` skill** — escalates the existing positioning-vs-distribution call up to `messaging | positioning | pmf_suspected | pricing | distribution`, **tier-capped** (`strong|lean|hunch`), evidence-required. PMF/pricing verdicts hard-capped at `lean` + always paired with "this is what I can't see from outside; run X." [M]
- **The strategic-read surface** — weekly-review Block 3 escalation + a **throttled hard-truth ping** (only on a `strong` non-distribution verdict persisting ≥2 weeks, ≤ once/~3 weeks). [M]
- **`app-inspector` re-grounding** — re-run the product diagnosis against live market response when positioning is flagged ≥2 weeks. [S]
- **Survey tools** — `propose_pmf_survey` (Sean-Ellis 40%) + `propose_pricing_test` (van Westendorp); turn the honest "I can't see retention/pricing" boundary into a real instrument. [M-L]
- **The #1 risk + guard:** a *wrong* hard-truth ("you don't have PMF") is worse than silence. Every verdict fails toward "grounded suspicion + evidence + what would confirm it," never "my verdict on your product." That humility *is* the credibility.

### Sprint 6 — The speed moat (real-time intent strike) — **M/L** *(spike first)*
The strike mechanism (draft→ban-safety→post / one-tap card) is **already built**; this is the *trigger + gate*. The read primitives already exist (`research_reddit sort=new`, `research_x since:`, HN Firebase/Algolia), the intent-phrase watchlist already exists (`gtmBuyerMap.intentPhrases`), the dedup substrate exists (`gtmTargetThreads`).
- **SPIKE FIRST: agent-wake latency** — if OpenClaw can't low-latency-trigger one focused turn, the architecture shifts to a tighter per-agent cron. Decide before building. [spike]
- **Intent watchlist** — compile `intentWatchJson` on `gtmAgents` from intent phrases + bet channels. [S]
- **Central intent-poll cron** (Convex, every 2-3 min, scoped to bet channels/keywords, plan-gated via the existing `monitoringEnabled`). **Don't make the agent poll.** [M]
- **Cheap relevance + dedup gate** (NON-negotiable) — dedup on `gtmTargetThreads`, then a non-LLM pre-filter (keyword + author-quality + freshness + velocity), then ONE cheap Flash-Lite "real buyer? we answer it?" call on survivors only. This gate is the whole ballgame — without it the reflex spams + blows COGS + risks the ban-safety we sell. [M]
- **Strike trigger** → existing `post_to_channel` / `send_confirm_card`. [S-M]
- **Cadence reconciliation** — strikes ADD to today's queue (never replace), hard daily strike budget (≤2-3 auto, rest one-tap), warmth-respecting; attribution-wrap every strike so the weekly review *proves or kills* the 10x-conversion claim. [S]
- **COGS:** sub-5-min (often sub-minute on X/HN) reflex fits $99/mo on providers already paid for, IF scoped + the relevance gate is cheap-pre-filter-first.

### Sprint 7 — The compounding brain (archetype moat) — **M/L** *(plumb early, pays off at density)*
The moat only goes live at **cohort density (≥5 attributed founders per archetype)** — so build the plumbing now so the corpus accrues from day one; don't market it live until an archetype clears the floor. The table (`gtmArchetypeLearnings`), index, read query, privacy contract, and deletion-exemption already exist — they're just empty/unwired.
- **Structure the per-founder signal** — add a `structuredJson` (`{venue, hook, format, timeBucket, outcome}`) to `gtmNicheLearnings` so it's roll-up-able (today it's free text). [S]
- **Cross-tenant aggregation job** — monthly Convex cron, per archetype, rolls up converting venues/hooks/formats/times, **publishes only when `distinctTenantCount ≥ 5`** (k-anonymity), generalizes up the archetype hierarchy below floor, returns PII-free tuples only. [M]
- **Expose + warm-start** — wire the dead `getArchetypeLearnings` query to a `get_archetype_playbook` tool; onboarding warm-starts from the prior (the empty hook in the skill becomes live), falling back to `platformAlgoCache` + own research when empty. [S-M]
- **Outcome feedback** — confirmations raise confidence, contradictions lower/retire it across tenants; the brain *compounds* rather than snapshots. [M]
- **(Flagged, last) self-improving skills** — activate the `gtmSkillImprovementProposals` consumer (k-floor + A/B + human-gated merge; core-safety skills permanently off-limits). Highest blast radius — behind a flag, human approval, instant rollback. [L]
- **Delivers:** every attributed founder makes Maya measurably smarter for the next in their archetype — the defensible, gets-better-with-scale moat.

---

## Suggested order of execution
1. **Sprint 1** (open web — cheap, no block) → **Sprint 2** (CRO/outcomes — the reframe that matters most) → **Sprint 3** (activation + stats core).
2. **In parallel:** unblock DataForSEO (→ Sprint 1.5), run the agent-wake spike (→ gates Sprint 6), provision a screenshot key (→ Sprint 2 enhancement).
3. **Sprint 4** (experimentation compounds) → **Sprint 5** (hard truths).
4. **Sprint 6** (intent speed, after the spike) and **Sprint 7** (archetype brain — plumb early so the corpus accrues even before it's "live").

## The two bets, restated
- **Own the outcome (Sprints 2-3-5):** judged on customers + diagnose why they don't convert + tell hard truths.
- **Compound (Sprints 4-7):** real learning that gets smarter per founder, and a cross-customer brain that gets smarter per *customer base*.
Everything else (open web, intent speed) makes that loop tighter and faster.
