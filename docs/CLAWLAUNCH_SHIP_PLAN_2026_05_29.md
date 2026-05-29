# ClawLaunch — Build & Ship Plan (locked 2026-05-29)

**Canonical execution doc.** Vision/context lives in `CLAWLAUNCH_GTM_V1_VISION_AND_SPRINT_PLAN.md` (§12 points here). ICP lives in memory `project-clawlaunch-icp-locked-replyguy-customer`.

## North star
Ship a **ReplyGuy-killer** to paying pilots: ReplyGuy's job (find buyer conversations → reply), but **more platforms + in the founder's voice + ban-safe + with attribution**, run by an OpenClaw agent that *understands the product, not just keywords.* Path: build on `staging` → operator runs onboarding → multi-day live test → push to `main` → first paying customers (Calacanis/Founder-University cohort).

## Locked decisions
- **ICP:** ReplyGuy's customer — B2B/SaaS/dev/prosumer indie makers, solo founders, small teams, early startups w/o a marketing team. Persona "Sofia." Validate via 3–5 **paid pilots**.
- **Positioning:** "The GTM cofounder for solo builders — the growth hire you can't afford yet." Win on quality + ban-safety + strategy + full-loop, not raw capability.
- **Pricing:** single tier **$99/mo** (test mode first). Margins ~73%. `planFeaturesGtm` server-side/fail-closed, structured so a $49 tier drops in later. (No $49 / no annual yet.)
- **Models:** main brain **`moonshotai/kimi-k2-0905`** (agentic, 262K ctx; replaced Gemma-4 which was too weak). Workers **`google/gemini-3-flash-preview`** ($0.50/$3). Multimodal **watcher** worker (Gemini Flash) handles video/image — main brain need not be multimodal. Pin exact model IDs (never silently route to 3.5-flash). Same brain quality for all tiers (voice = the moat).
- **Infra:** per-user OpenClaw Fly machine **always-on** for v1 (~$15/mo COGS floor; scale-to-zero unreliable for our cron+slow-boot case — verified). COGS ≈ **$22/customer/mo**.
- **HN:** read via **Algolia HN API** (free). Posting = hand-off only (no API).
- **Funnel:** **cheap grounded teaser → pay to unlock + activate.** No free-full-research, no 7-day trial. ~$0.50–1 teaser pass → "I found where your buyers are + a plan, unlock + put me to work, $99/mo" → pay → full deep research + deploy. Bounds free COGS <$1/signup; gates the $15 machine.

## Channel-selection design (locked 2026-05-29)
Neither "user picks" (they don't know) nor "agent black-box picks" (no trust). **Maya proposes with evidence, user decides.**
- **Criteria (scored from real evidence):** buyer presence × buyer intent × format fit × founder capability × ban-risk × effort-to-payoff.
- **Cold-start = evidence-driven:** don't even start on channels where research shows no buyers (no spraying a dev tool onto TikTok).
- **Ongoing = performance-driven:** among started channels, real results decide double-down vs drop.
- **Flow:** product + 3 capability Qs → teaser research across candidates → **ranked, evidence-backed recommendation with reasoning shown** → user confirms/overrides → engage → re-evaluate. **All platforms always available + ungated;** Maya focuses the relevant set. Self-correcting (evidence upfront + results ongoing + user override) — so it can't drift catastrophically wrong silently.
- **OPEN QUESTION (not doctrine):** "focus 1 channel" is shaky for us (agent removes the attention constraint; reply-motion means buyers span 2–3 venues; ReplyGuy monitors all). Validate single- vs multi-venue speed-to-first-users in the pilots.

## Research-depth audit (2026-05-29) — drives S0
HONEST verdict: **deep on Reddit, thin/missing elsewhere.** Deep: Reddit posts + comment-tree mining, LLM pain/buyer scoring, citation-firewall (grounded-or-silent), 6-phase orchestration. **Gaps:** X = keyword search only, 1 page, NO reply/thread mining · TikTok/IG = search only (comment endpoints exist, unwired) · HN = Algolia search only, no comment-tree · LinkedIn = NO worker · **open web (`web_search`/`web_fetch`) NOT wired into the orchestrator** (product-positioning/competitor-strategy/G2/blogs barely researched) · workers single-pass (stop at call cap, no adaptive deepening) · no cross-platform triangulation · LLM-scorer fallback silent · a hardcoded "skeleton" mode exists (test fallback risk). **This is a prerequisite — Maya's channel recommendation is only as good as how deeply she looks per channel.**

## Research output + handoff spec (locked 2026-05-29)
**Principle: show, don't tell — research returns receipts, never generic text.** ("Reddit is good for you" = worthless; "here are 4 live threads where your buyers say *this* [links+quotes] + a reply I'd post [draft]" = the wow + the sale.)
- **Per recommended channel → a "channel verdict card":** verdict + why · **3–5 real source links + verbatim quotes** (a *pattern*, not one example) · the play (what we'll do here) · **≥1 real voice-matched sample draft** (the killer proof of the deliverable). Per-channel shaped: Reddit thread deep-links, X tweet links, TikTok example-video links + the recurring winning format, HN thread links, LinkedIn posts.
- **Delivery, two surfaces:** **Telegram** = tight cited summary + one killer sample draft + link to Mission Control (never a wall of research in chat). **Mission Control → Research tab** = the full rich, browsable breakdown (all links/quotes + buyer/competitive maps).
- **"Give me an example" always works** — research is stored as **cited evidence cards** (url + verbatim snippet); the citation-firewall guarantees grounding; Maya pulls a real thread + quote + draft on demand.
- **On approval → a rolling 7-day calendar** (NOT a 14-day dump): the approved **target threads become reply-events**, **content angles become posts**; **effort-tiered** (text replies = daily ⚡10-min loop; video = spaced-ahead 🎬 Briefs); each event = **link-first → ready content → why → success metric**; regenerated weekly by what converts.
- **Go-time:** the event sits in Google Calendar at the optimal minute **+** Maya texts the Telegram nudge with the link + ready text. One tap.

## Architecture decision — the research engine (use the better path, not just what exists)
Two research paths exist today: (a) the **Convex `runBudgetedResearchJob`** orchestrator — deterministic, budget-capped, but **single-pass and shallow** (stops at an 8-call cap, no looping, Reddit-only depth); and (b) the **OpenClaw-native skill orchestration** (the agent spawns per-channel research subagents with judgment). **Decision: make OpenClaw-native the canonical deep-research engine.** The agent orchestrates per-channel deep research — multi-source pulls + comment-tree descent + **`web_search`/`web_fetch`** for product/competitor/niche/G2/blogs — and **loops until the evidence is genuinely deep** ("that's thin, go get more"), with NO rigid call cap. It reports structured, **cited** evidence back to Convex via the hook callbacks. **Convex's job = store evidence + enforce the cost-cap budget guardrails + serve UI/gating — NOT orchestrate the research.** Retire/demote the Convex single-pass orchestrator *after verifying* the native path is deeper (delete-after-verify). Judgment-driven depth bounded by Convex cost guards is what makes "genuinely deep on every channel" real — a fixed 8-call cap never will be. **S0 builds to this.**

---

# Sprints (ordered for build → ship → customers)

### S1 — Live agent reliability (FIRST; nothing works if the agent can't talk)
- Fix `No session found: current` — Maya's Telegram reply path fails to resolve, so she can't answer DMs.
- Verify **Kimi K2 0905** live on real hello + synthesis (deploy test Maya, judge voice + agentic reliability vs old Gemma output). Confirms the model A/B.
- **Done =** deployed Maya gives a specific grounded hello + reliably answers DMs.

### S0 — Research-depth parity (THE core-value sprint; gates channel-selection credibility)
Bring every channel up to Reddit's depth + wire open-web research:
- **X:** mine reply threads / quote chains / conversation context (TwitterAPI.io tweet-relations + user tweets), >1 page. (X's value is the replies.)
- **HN:** comment-tree descent via HN `/item/<id>` recursion (Algolia for discovery, item API for trees).
- **TikTok/IG:** wire the existing comment endpoints into the research path (buyer language in comments).
- **LinkedIn:** add a real research worker (comment-mining on relevant posts).
- **Open web:** wire `web_search`/`web_fetch` into the orchestrator — research the product, competitors' own sites/positioning/pricing, G2/Trustpilot, niche blogs. (Currently social-proof-rich, positioning-thin.)
- **Iterative deepening:** workers re-query / broaden when a pass is thin (don't just stop at the call cap); cross-platform triangulation (thin platform → targeted second pass).
- Surface LLM-scorer degradation instead of silently falling back; confirm no path can silently use the hardcoded "skeleton."
- **Done =** a research run produces grounded, cited buyer evidence + competitor-positioning context across the *relevant* channels, deep enough that the channel recommendation is trustworthy.

### S2 — Billing + teaser-paywall + gating ($99/mo)
- **M0 (operator):** Stripe product + $99/mo price (test), keys in Convex env, webhook registered.
- `planFeaturesGtm(creator)` + `"clawlaunch"` plan value + `subscriptionStatus`/`currentPeriodEnd`.
- Reuse `convex/billing/{checkout,portal,webhook,priceIds,stripeClient}.ts`: GTM checkout, webhook → plan/status (idempotent, signature-verified), portal link.
- **Gate `runMyGtmDeploy` on active sub** (no machine without payment). Paywall = "subscribe to activate" after the teaser.
- Cancel/past-due → **stop the Fly machine** (stop-not-destroy) + gate endpoints; reactivate → restart.
- Billing UI in Mission Control Account tab (white/black themed).
- **5 mandatory tests:** cross-tenant · plan×action fail-closed (incl. reads) · adversarial (forged webhook/tampered price) · idempotency (Stripe replay) · sibling coherence.

### S3 — Fast onboarding teaser hook + channel-selection UX
- ~$0.50–1 teaser research pass (relevant candidates, real threads, one-line plan) shown in minutes + texted.
- **Channel-selection UX:** ranked, evidence-backed recommendation with reasoning + user confirm/override (toggle candidates). All platforms available.
- "Unlock + activate" paywall before the full deep research/deploy. (Couples with S2.)

### S4 — One-tap deep-link + effort-tiered calendar engine
- `buildDeepLink(platform, action, target, text)` — Tier-1 pre-fill (X / Reddit-post / HN / Threads); Tier-2 direct+paste (Reddit-comment / LinkedIn / IG / YT).
- Every calendar event = link-first → platform-shaped ready content (text = paste-ready w/ tracked link; video = Brief) → why → success.
- **Effort-tiered:** text replies = daily ⚡10-min loop; video = separate, spaced 🎬 events (or UGC-creator outsourcing). `validateCalendarEvent` fails a text event with no link/ready-copy. Telegram go-time nudge reuses the payload.

### S5 — Multi-day live test (validate the assembled product over DAYS)
- Deploy a real Maya (real product) and **let it run for several days.** Observe across days: daily cron/heartbeat fires, research stays grounded + deep, drafts pass slop+voice gates, calendar/hand-off works, attribution records, COGS stays in band, no crashes/leaks.
- Judge from the user's POV daily: specific not generic, posts AND replies, can answer DMs, channel recommendation holds up.
- **Done =** several consecutive good days with no manual intervention — proof it's a product, not a demo.

### S6 — Legacy purge (hygiene)
Delete creator + service UI/routes/components (`app/(creator)/`, `app/creators/`, `app/onboarding/maya/`, `app/(business)/`, `app/onboarding/business|growth/`, `components/creator|business*/`); simplify middleware; drop `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT`. UI/routes first; Convex tables later. (Overrides CLAUDE.md "creator preserved behind flag" — git retains it.)

### S7 — Delete-account done right (before public launch)
Add ~47 `gtm*` tables to `accountDeletion.ts` cascade + collect `gtmAgents.openClawFlyAppId` for Fly destroy; wire `deleteMyGtmAccount` to real purge; Clerk sign-in/out + custom delete UI; add `user.deleted` Clerk webhook backstop; **exempt** cross-tenant learnings; stop-answering = destroy/stop Fly (inbound Telegram → Fly directly, so a Convex flag alone won't silence her).

### S8 — Indispensability depth
Port TikTok format-recurrence rigor to text channels (drafts match the format provably converting this week); velocity-ranked "trending in your niche today" surface that pre-drafts the twist; the "their product" twist = app-inspector ProductDiagnosis × mined format, required in every draft.

### S9 — Reposition / landing as ReplyGuy-killer
Marketing copy + capability grid vs ReplyGuy/Devi; the cohort paid-pilot pitch (written to Sofia).

### Later (post-validation)
- **S10 — Convex-as-waker scale-to-zero:** route Telegram + cron through always-up Convex → per-user machine scales to zero → cuts machine COGS ~$15→$3 → makes a profitable $49 tier viable.
- **S11 — $49 "Launch" tier:** add second tier + server-side gating (Engage vs Operate: gate volume/cadence/#products/operate-layer; never platforms/voice).

---

## Build → ship sequence
1. **S1** (agent reliability) + **S0** (research depth) — the core product must be reliable and genuinely deep.
2. **S3 + S2** (teaser onboarding + channel UX + billing/paywall) — the funnel + the way to charge.
3. **S4** (one-tap calendar) — the daily-loop UX.
4. **S5** (multi-day live test) — validate the assembled product over days.
5. **Merge `staging`** → operator runs full onboarding on staging → more testing.
6. **S6 + S7** (legacy purge + delete-account) — pre-launch hardening.
7. **Push to `main`** → onboard the first paying pilots from the cohort.
8. **S8 + S9** (depth + repositioning) in parallel/after to harden + differentiate; **S10/S11** when opening the down-market tier.

**Sellable-MVP = S1 + S0 + S2 + S3 + S4, validated by S5.** That's a founder paying $99 and getting deep, grounded, in-voice, ban-safe conversations across the right channels — daily.
