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

> **Status (2026-06-03):** `search_demand` + `search_web` are BUILT, wired as typed tools, and live-verified. `read_reviews` (DataForSEO Business Data) is the remaining Sprint 2.1 follow-on. The *tools* exist; **the judgment to use them well does NOT yet — that is Sprint 2.5 below.**

---

## Sprint 2.5 — The demand-intel & open-web JUDGMENT layer (skill + thinking)
**Why:** `search_demand` and `search_web` are instruments, not method. Today Maya has each wired into a single bullet. A SEO/demand tool with no thinking model is just COGS — she'd fire a $0.075 keyword call and not know that *high CPC at low volume = a buyer goldmine*, that *0 volume ≠ 0 demand for a new-category dev tool*, or that this data is **vocabulary + validation + "alternative-to" organic targets**, NOT a Google-ads/ranking plan for an organic-social founder. This sprint gives her the operating method — grounded in expert research (decision rubric, seed taxonomy, 0-volume reframe, landing-page teardown, review/forum mining, "why no conversion" diagnostic, when-to-read rubric). Distilled research brief lives in this sprint's notes.

**Implement (it's all `.md` + prompt thinking — no schema, no new tables):**
- New skill **`maya-demand-intelligence`** (SKILL.md). Teaches:
  - **Decision rubric** read VOLUME×CPC×COMPETITION *together*: COMP = ad-bidder density (market validation), NOT rank difficulty; CPC = buyer-value/commercial-intent proxy; high-CPC+low-volume = buyer goldmine → make it the spine of positioning + BOFU replies; high-volume+low-comp = content gap to *bank* (not a today-priority for a no-SEO founder).
  - **Seed taxonomy** problem-aware → solution-aware → competitor/"alternative to X" → modifiers (best/vs/pricing/review/open-source). Source seeds from the ICP's *own words* (Reddit/HN/support language), not the tool's vocabulary; expand via autosuggest before spending.
  - **The 0/null-volume reframe protocol** wrong-vocabulary (reframe + retest 2-3 synonyms) → too-niche (broaden one level, confirm the *cluster*) → genuinely-new-category (accept it; ride the adjacent-problem term that DOES have volume + CPC; capture the new vocabulary early for first-mover). **Never call 0 "no demand."**
  - **Cost discipline** dedup/normalize seeds, batch, only fire when a decision hinges on it.
- New skill **`maya-open-web-read`** (SKILL.md) for `search_web`. Teaches:
  - **Landing-page teardown checklist** (own + competitor): hero/subhead/category, ICP named, primary use-case, pricing & tier gates, top-3 above-fold features, social-proof type, and the **negative space** (what they DON'T say = white space).
  - **Review/forum mining** read 3-star first (most honest) → 1-2 star (dealbreakers) → 5-star (proof + happy-buyer words); extract verbatim quotes ≤125 chars + URL + a tag (`#pain #trigger #objection #alternative #language`); require a volume floor before calling a pattern (don't over-index on one loud thread).
  - **"Why aren't they converting" diagnostic** (clicks, no signups): 5-second test (what/who/next from hero+CTA), message-match to the traffic source (#1 killer), single clear CTA, proof near CTA, top-objections answered, pricing clarity, form friction. Routes the honest *"it's your positioning, not your distribution"* hand-off to the Sprint 6 diagnostician.
  - **When-to-read rubric** fire when the artifact is a *page* (pricing, positioning, reviews, the founder's own funnel) or to confirm a LOW/MED-confidence theme; SKIP when it's *chatter you already pulled*, a re-read this session, or a HIGH-confidence claim. One authoritative read beats five confirming ones.
- **Wire the thinking into the loops, not just the skill shelf:** add a compact demand-intel + open-web reasoning block to `generators.ts` `renderTools` (so it's in BOOT context), and reference both skills from `maya-foundation-research` (demand validation + competitor teardown), `maya-competitor-researcher` (open-web teardown + review mining), and `maya-continuous-research` (rising-demand re-checks + watering-hole discovery).
- **Output contract (grounded-or-silent):** every demand finding cites volume/CPC/competition + the seed; every open-web finding cites a verbatim quote + URL. No ungrounded "people are searching for X."

**How Maya uses it (plain-language, user-facing):** she tells the founder things like *"'open source datadog alternative' gets real searches and advertisers pay $9 a click for it — that's where the buyers are, so I'm leading your Reddit replies and your headline with that exact phrase,"* and *"nobody's searching your product name yet — that's normal for something new — so I'm riding the bigger pain people DO search and planting your name early."* All in words a non-technical founder understands.

**Effort:** M (mostly prompt/skill authoring + light generators wiring). **No operator block** (tools already live). **Tests:** sibling-file scan (both skills referenced from the loops that use them) + a generators assertion that the demand-intel reasoning block renders. **Pick-up order:** strong candidate to run right after Sprint 3 — it makes the already-live S1/S2 tools actually pay off.

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

> **Status (2026-06-03): SHIPPED.** `activated` kind, the pixel `activated()`/`signup(kind,source)` calls, the "how did you hear" note path, and `maya-activation-coach` are all built + tested (attribution suite 16/16). **BUT** — see Sprint 3.5: we are deliberately **not offering the paste-the-code pixel in MVP**. The signal that's actually live for MVP is **clicks (automatic) + signups/activation via self-report (Maya asks).** The pixel endpoint + snippet stay in the codebase (tested server-side) for the deferred roadmap build, but Maya does not hand it to founders yet.

---

## Sprint 3.5 — MVP conversion = clicks + self-report (retire the pixel OFFER)
**Why:** the automatic web pixel's **client snippet has never executed in a real browser** (only the server endpoint is tested), it's **web-only** (useless for the mobile-app slice of our ICP), and it can't see organic signups as currently built. Offering an untested, setup-requiring tracker at the exact "prove it" moment is a credibility risk that's worse than just asking. For the first cohort, **clicks (already automatic + tested) + self-report ("did anyone sign up?") closes the loop honestly with zero founder setup** — and being asked is natural at pilot scale, not friction.

**Implement (skill/prompt/onboarding copy only — keep all pixel CODE + tests):**
- `maya-conversion-tracker` + `maya-activation-coach`: lead with **self-report** as THE method; **stop offering the paste-the-code snippet**; keep wrapping links to `signupUrl` (clicks stay automatic) and keep the "how did you hear about us?" question as a *spoken* ask, not a pixel field. Note the automatic tracker is "coming," not offered.
- `get_conversion_setup` tool + TOOLS.md blurbs: reframe to "returns `signupUrl` so I wrap links + I ask about signups"; de-emphasize `pixelSnippet`.
- `getConversionSetupHttp` `instructions` field: self-report-first wording (snippet stays in the payload, unused).
- Onboarding/results UI: no pixel-paste ask; `SOURCE_LABEL`/`CONVERSION_LABEL` stay (add the `activated` label).
- **Never offer a web tracker to a mobile-only / no-site founder** (we already capture `appType`).

**Effort:** S. **No operator block.** **Tests:** existing pixel/endpoint tests stay green (we're not removing code); a sibling-scan that the skills no longer instruct "paste the snippet."

---

## Roadmap (deferred) — Automatic verified web pixel
**Build when:** a pilot founder's signup volume makes a daily "any signups?" genuinely annoying, OR we want "automatically proves organic conversions" as a marketing line. Not before.
**Shape (already designed):** a public per-founder **`pixelKey`** baked into the snippet (self-identifying — no click needed); a **`hello`-on-load ping** → stamps "tracker live"; a **3-state machine** Maya narrates (not installed → live-unconfirmed → confirmed-by-one-test-signup); organic signups recorded as theirs-but-untied; install via **"hand this to your coding agent (Claude Code / Cursor / Lovable)."** Web-only by design; mobile/no-site stay on self-report. Verify with a happy-dom test that actually *executes* the snippet JS + one real-browser live fire (the client JS has never run live).

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

> **Status (2026-06-03): SHIPPED.** `convex/gtmMaya/experimentStats.ts` (deterministic Beta-Bernoulli MC: `summarizeExperiment` → winner needs P(best)≥0.85 AND ≥5 conversions; `confirmedConversions` + `assessSingleMotion`). `getAttributeOutcomes` join + `get_attribute_outcomes` / `get_experiment_verdict` tools (75 total). Rewired `decideExperimentScale` + `interpretResults` to drop the weighted sums. `maya-results-reviewer` now reports the computed verdict, never an uncomputed multiplier. 12 stats tests + 4 join/verdict tests; convex+root tsc clean, zero net-new failures.

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

> **Status (2026-06-03): SHIPPED.** `experimentStats.ts` gained `allocateArm` (deterministic-by-seed Thompson sampling) + `maxConfidenceForEvidence` + `RETIRE_CONFIDENCE`. `experimentsJson` on gtmAgents + `experimentId`/`armLabel` on draft attributes (JSON-on-row / additive — no new table). `convex/gtmMaya/experiments.ts`: `save_experiment` (≤2 running dimensions server-enforced, + conclude) / `assign_arm` (Thompson over real outcomes) (79 tools). `upsertNicheLearning` now clamps confidence to the evidence (fail-closed) + auto-retires contradicted learnings. Wired into morning-brief (allocator picks + says why) + weekly-review (conclude only on a `winner` verdict). 8 allocator/cap unit tests + 9 registry/clamp convex-tests. convex+root tsc clean, zero net-new failures.

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

---

## UI / receipt surfacing (the web app) — a PARALLEL track, auto-updating via Convex
**Principle:** Telegram = nudges + what-needs-a-tap. The web app (`app/clawlaunch/mission/*`) is the **receipt** — where the founder reviews the proof, the intel, and what's working at a glance. The rich, glanceable outputs of these sprints belong here, NOT in a text message.

**Auto-update is free:** every Mission Control tab already uses Convex `useQuery` (live subscriptions). When Maya writes new data to Convex, the subscribed UI re-renders **instantly — no refresh, no polling.** Each new capability just needs: (a) a reactive query over the table/JSON-field it writes, (b) a tile/panel. That's the whole UI cost per sprint.

**Surface map (build the tile alongside each backend sprint):**
| Sprint | Founder-visible output | Web surface (Mission Control tab) |
|---|---|---|
| 1 — Open web | Competitor pricing / positioning / real weaknesses (richer competitive map) | **research** |
| 2 — Demand intel | Rising-demand topics + SEO opportunity + competitor objections | **research** — new "Market" panel |
| 3 — Activation/attribution | clicks → signups → **activated**, time-to-value, "how they heard" | **results** (extend; today it's clicks/signups only) |
| 4-5 — Experiments | What's converting + **confidence (P(best))** + what's being tested + why this arm | **results** — "What's working / Testing" panel |
| 6 — Strategic read | North Star on-track/at-risk + the current honest strategic verdict (tiered) | **Today** (`page.tsx`) — "Strategy" panel |
| 7 — Intent strikes | "Maya jumped on this hot thread 3 min ago" + the live post | **Today** activity feed (`getMyAgentActivity` already feeds it) |
| 8 — Archetype brain | (mostly invisible) subtle "informed by N similar founders" note | light/none |

**Implementation note per tile:** the data already lands in Convex (the backend sprint writes it). The UI add is a new reactive `query` in the relevant `convex/founder/` or `convex/gtmMaya/` read module + a tile in the tab's `page.tsx`. Keep it glanceable — the receipt shows *proof + intel*, it is not a control panel (Maya drives; the founder reviews). Build each tile in the SAME sprint as its backend so the data never lands invisibly.
