# HeyMaya — Sprint Plan, Service-Business v0

**Branch:** `heymaya/service-v0` (off `main`)
**Convex:** preview deployment `heymaya-service-v0`
**Target:** shippable v0 in 8 working weeks
**Date:** 2026-04-26
**Companion to:** `docs/SPRINT_PLAN_V0.md` (the creator product). Sections mirror that doc one-for-one so the operator can compare side-by-side.

---

## 1. Mission

Build **Maya for service businesses** — a single proactive AI ops manager who lives in the operator's text thread, answers their phone, and runs the operational layer of a 1-to-25-truck home-service business: review automation cited to actual jobs, social posting from real job photos, lead-response triage, brand-voice consistency, accountability, and growth strategy.

One business → one Maya. Single OpenClaw agent. CRM-aware where a CRM exists; GBP-grounded always. Voice-first when the operator's hands are dirty, text-first the rest of the time. Grounded or silent.

> **"Your AI marketing manager before you can afford a human one — for the trades."**
>
> Subline (landing-page explainer): *"Maya turns every completed job into local marketing."* The completed job is the trigger; the marketing asset is the output. This is the wedge.

### Why now / where the gap is (cited from R4)

R4 maps the competitive landscape and shows a single empty quadrant — **broad scope + done-for-you AI + SMB-priced**. Today the only inhabitants of "broad + DFY" are agencies at $2–10k/mo (Scorpion, Blue Corona) and ServiceTitan-stack bundles at $1.5k+/mo (ServiceTitan + Marketing Pro + Phones Pro + Avoca/Arch). Everything else is a **feature buried in a $250–$500/tech CRM**, a **single-channel point tool** (Birdeye, Podium, Hootsuite, Avoca, Goodcall), or a **$300–$900/mo communications platform** that only owns the inbound phone slice (Hatch, Avoca, Numa, Quo+Sona).

**The wedges Maya owns that no competitor combines:**
1. **Proactive, in-the-text-thread, cross-channel.** Birdeye/Podium/HCP/Jobber all require the operator to log into a dashboard. Maya pushes morning briefs, post-job review automations, slow-week alerts, competitor-ad clones — into the operator's iMessage/SMS/voice line.
2. **CRM-agnostic.** Every meaningful AI player today (ServiceTitan Marketing Pro, HCP AI Team, Jobber AI, Avoca, Arch) is welded to one FSM. The 60% of <10-truck operators not on a major FSM are unserved. Maya works with ServiceTitan, HCP, Jobber, QuickBooks, **or no CRM** — only GBP is required.
3. **Service-business-trained voice from day one.** Hootsuite/Buffer/Loomly write generic captions. Maya knows summer HVAC capacity windows, that a 1-star at 11pm is the one you reply to first thing in the morning, that a 5-star from a senior is gold.
4. **Flat SMB pricing, no per-location/per-tech/per-call theater.** Goodcall and Numa proved $79–$249/mo is the SMB-AI mental anchor. Birdeye's per-location ($299/loc) and Jobber/HCP add-on stacking are the operator pain we exploit.

### Closest competitors (acknowledged)

| Competitor | Why they matter | What we do that they don't |
|---|---|---|
| **Podium "Jerry"** (R4 § Tier 1) | Genuine proactive AI lead-handler. Closest analog to "AI employee voice" today. | Jerry is inbound-SMS-funnel-only at $400–$1000/mo. No outbound social, no review-strategy, no brand-voice across channels. |
| **HCP Coach AI / AI Team** (R4 § Tier 2 — flagged most concerning) | Free with HCP, shipping fastest of any FSM AI. Direct ICP overlap. | Lives inside the HCP dashboard (not the operator's text thread), HCP-only, feature-shaped not manager-shaped. We ship CRM-agnostic + push-to-text-thread before HCP ships their own. |
| **Birdeye Reputation Agents** (R4 § Tier 1) | Real AI agents, real review-response capability. | Per-location pricing ($299/loc), enterprise sales motion, reactive not proactive, dashboard-bound. |

**Strategic priority (from R4):** Ship CRM-agnostic + voice + proactive-text-thread *before HCP can ship the same shape inside their 200-engineer org.* That's the existential race.

---

## 2. Locked product principles

**Operator-locked principles** (from operator review of this doc 2026-04-27):

0. **Minimum viable data, always.** Service operators are local small businesses, not content creators. Most have thin social presence + limited CRM data. Onboarding pulls bounded by COUNT (not date), skips platforms with zero data, and never blocks the operator on data we don't actually need to deliver value. Pulling 6 months of nothing slows everything to a crawl + burns API quota.

1. **Maya's platform expertise lives in MD files (SOUL.md / AGENTS.md / per-skill SKILL.md), NOT hardcoded rules in TypeScript.** GBP posts behave differently than Instagram posts behave differently than Facebook posts. The expertise is encoded as Maya's prompts + skill instructions, not as `if (platform === "instagram") {...}` branches in our code. OpenClaw's proactive nature + good prompting is the lever; we don't translate platform quirks into hard rules. When she sees 5 inbound photos from the operator, Maya decides — based on the prompt + her platform knowledge — whether to ask "want me to edit these together for an IG post?" vs "want me to post all 5 to GBP as a scrollable photo set?" vs "let's do a Facebook carousel."

2. **Third-party-first for everything social, ads, and CRM.** We do NOT build ad-platform logic, group-monitoring infrastructure, or per-CRM auth/refresh ourselves. Use Zernio (15-platform unified API + 280-tool MCP server), Composio (Gmail/Calendar/Stripe/Meta Ads/IG/LinkedIn), Nango (custom Jobber/HCP/QBO connectors with managed OAuth), Apideck/Unified.to (QuickBooks normalized accounting). HeyMaya's value-add is the AGENT orchestration + operator UX + cross-vendor coordination — not the platform infrastructure.

   **v0 hardening (operator decision 2026-04-27):** every external integration in v0 routes through a third-party wrapper. This is a hard rule for ship-the-MVP velocity — no direct partner-program-gated APIs (GBP, Meta Graph, ServiceTitan-direct) ship in v0. Direct paths are post-launch upgrades to be evaluated when partner access lands AND/OR scale/cost forces the direct route. The full v0 integration map: **Social** = Zernio (GBP + FB + IG + TikTok + LinkedIn + X + Pinterest + Threads). **CRM** = Nango (Jobber, HCP). **Accounting** = Apideck or Unified.to (QBO). **Email + Calendar** = Composio. **LLM** = OpenRouter. **Competitor read** = ScrapeCreators. Canonical SDK libraries (Stripe, Twilio, ElevenLabs, Clerk) count as third-party — they are not partner-gated. **ServiceTitan direct integration is the explicit v0 exclusion** (Sprint 7+, no aggregator covers it). Future-state direct paths (e.g. direct GBP API once partner-access lands) parked under `convex/integrations/{provider}/direct/` for the eventual upgrade.

3. **Local marketing is the only audience. Maya is hyperlocal by default.** Operators serve a defined geographic area — a metro region, a list of zip codes, a 25-mile radius. Every post, review reply, content arc, GBP local-post, FB post, IG caption, and brand-voice fingerprint is calibrated to the operator's service area, neighborhood vernacular, named local competitors, and local hooks (weather, school district, named neighborhoods, county fairs, sports teams, seasonal patterns). Maya never writes for a global feed. CTAs assume hyperlocal reach. Tagging assumes local audience. The wedge phrase — *"Maya turns every completed job into local marketing"* — is load-bearing: the *local* is what makes Maya feel like a local instead of a regional bot. Captured at onboarding via § 5 Q-form expansion (named competitors, neighborhood emphasis, local hooks); persisted in `businessPicture.localPositioning` and consulted by every content-generating skill.

(Numbered original principles continue below.)


1. **The product is the agent in the operator's text thread + on the phone.** The web HQ is the receipt and the approval queue. iMessage / WhatsApp / SMS for routine; voice for when the operator's driving or hands-dirty.
2. **Push, don't pull.** Maya pings the operator with morning brief, review-request alerts, lead-response nudges, slow-week alarms. The dashboard is mostly read.
3. **Grounded or silent.** Every recommendation cites real data — a CRM job, a Google review, a GBP post engagement, a competitor's Maps listing. If she can't ground it, she doesn't say it. (R3 § Soul recommends this same posture.)
4. **Anti-sycophancy with operator-friendly tone.** Warmer than creator-Maya, still honest. R3 § Soul calls out the failure mode: service-Maya must avoid *fake-busy chatter* ("I'm on it!" with no progress). Default is short confirmations + receipts.
5. **One agent, multi-skilled.** Same Maya across iMessage, voice, web. No team, no delegation.
6. **CRM-agnostic + GBP-required.** Service operators may or may not have an FSM, but every operator has a Google Business Profile. GBP is the always-on data anchor; CRM is the high-value upgrade.
7. **Voice-first interface for the truck-bound operator.** R3 § Voice — operators are in trucks, on jobsites, hands dirty. Maya answers their phone (Studio tier) and calls them back when something matters.
8. **Per-customer Maya phone number.** Twilio-provisioned at signup (R3 § Voice — $1.15/mo carry baked into all tiers). Operator saves "Maya — +1 555 …" to contacts.
9. **One brain, thinking-budget routing.** Same Gemini 3 Flash as creator product, configurable thinking budget. R3 enforces `thinkingBudget: 0` for inbound voice (sub-1s response); medium for routine drafts; high for review-reply drafting + revenue snapshots + content arcs.
10. **No credits theater.** Sell unlimited proactive + capped chat per tier, voice metered above an inclusion bucket on Studio.
11. **Plan-tier gating server-side.** `planFeaturesService(business)` helper. Fail-closed, including reads.

---

## 3. Tech stack & key decisions

### Brain — DUAL model, action-level routing (service product BREAKS creator-product principle 7)

The service product deliberately breaks the creator-product locked principle of "single model + thinking-budget routing" (CLAUDE.md principle 7). Lower headline pricing ($99 / $149 / $199 vs creator's $19.99 / $39.99 / $79.99 — but service-side absolute infra cost is higher because of voice + media + integrations) forces tighter inference economics. The full routing matrix is locked under the **Pricing — service tier** subsection below; this is the architectural shape.

- **Primary model:** Gemini 3 Flash via OpenRouter, configurable thinking budget per task. Used for synthesis, high-stakes drafts (review-reply, contract scan, packet, video edit-plan), and all multimodal vision (asset cataloging, business-picture, photo curation).
- **Secondary model:** **Gemini 3.1 Flash Lite** via OpenRouter for the routine task class (chat replies, comment triage, accountability nudges, niche scans, FB-group lead-classify, light routine engagement watch). Quality drop (89% → ~85% MMLU-Pro) doesn't show through in operator-facing routine output but cuts per-call cost by ~10×.

Routing decided at the action level — every Convex action specifies `modelTarget` + `thinkingBudget` + `routedReason` for telemetry. Operator-decide gate: A/B-validate Flash Lite quality on routine class with 3 beta operators before Sprint 7 ships (see § 18 open items). The full per-task-class matrix lives in the Pricing subsection below alongside the cost envelope it enables.

Runtime pin: **OpenClaw >= 2026.2.26** (R3 § Voice — covers GHSA-4rj2-gpmh-qq5x allowlist CVE + iMessage attachment regressions in #34749, #4848, #17670, #30170). Current `4.23` predates `2026.2.x` numbering — confirm upgrade path before Sprint 0 ships.

### Stack diagram

```
          ┌─────────────────────────────────────────────────────┐
          │   Operator (1-truck owner / office mgr / dispatcher)│
          │   iMessage  WhatsApp  SMS  Voice (Studio)  Web HQ   │
          └────────────┬────────────────────────────────────────┘
                       │
   ┌───────────────────┴───────────────────────────────────────┐
   │                CHANNEL LAYER                              │
   │  Twilio (SMS, MMS, voice — per-op number $1.15/mo)        │
   │  BlueBubbles (iMessage host, R2 attachment bridge)        │
   │  WhatsApp Business via OpenClaw native                    │
   │  ElevenLabs Agents (inbound voice, custom-LLM → Convex)   │
   └────────────┬───────────────────────────────────────┬──────┘
                │                                       │
                ▼                                       ▼
   ┌────────────────────────┐                ┌──────────────────────────┐
   │  OPENCLAW 2026.2.26+   │                │   CONVEX (heymaya-       │
   │  (per-op Fly machine)  │◄──────────────►│    service-v0)           │
   │  - SOUL.md  USER.md    │  HTTP endpts   │   - Tables (jobs,        │
   │  - HEARTBEAT.md        │  lc_maya_*     │     reviews, gbpPosts,   │
   │  - jobs.json (cron)    │                │     serviceJobs, etc.)   │
   │  - skills/maya-svc-*   │                │   - Webhooks (CRM, GBP   │
   │  - voice-call plugin   │                │     Pub/Sub, Stripe)     │
   │    (outbound only)     │                │   - planFeaturesService  │
   └────┬───────────────────┘                │   - Onboarding pipeline  │
        │                                    │   - Workspace bundler    │
        │                                    └──────┬───────────────────┘
        │  reads/writes                             │
        ▼                                           ▼
   ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐
   │ ZERNIO (Late)  │  │ DIRECT GBP API │  │ COMPOSIO v3      │
   │ FB+IG+TT+LI+   │  │ (LocalPosts +  │  │ Gmail / Calendar │
   │ YT+X+Pin+TG+   │  │  Reviews +     │  │ Stripe / IG-biz  │
   │ Threads        │  │  Pub/Sub)      │  │                  │
   └────────────────┘  └────────────────┘  └──────────────────┘
        │                                           │
        ▼                                           ▼
   ┌──────────────────────────────────────────────────────────┐
   │  CRM ADAPTER LAYER (convex/integrations/crm/*)           │
   │  Jobber (GraphQL) ▸ HCP (REST, MAX-only) ▸ QBO (REST)    │
   │  ServiceTitan (REST, partner-gated, Sprint 4+)           │
   └──────────────────────────────────────────────────────────┘
        │
        ▼
   ┌──────────────────────────────────────────────────────────┐
   │  PHOTO/VIDEO PIPELINE (Fly worker, Wave 4 pattern)       │
   │  R2 attachment bridge ▸ Gemini Files API ▸ Veo 3.1 Fast  │
   └──────────────────────────────────────────────────────────┘
```

### Per-layer decisions, cited

| Layer | Choice | Source | Rationale |
|---|---|---|---|
| Frontend | Next.js 16 + Tailwind + shadcn/ui | Creator V0 § 3 | Reuse |
| Backend | Convex | Creator V0 § 3 | Reuse; new `heymaya-service-v0` preview |
| Auth | Clerk + `accountType` enum on user | Creator V0 § 3 | Dual-track from one Clerk userId |
| Billing | Stripe | Creator V0 § 3 | New service-tier products |
| Agent runtime | OpenClaw native, **pinned >= 2026.2.26** | R3 § Capability matrix, § 1 Voice, § 2 MMS | Covers all known iMessage/voice CVEs + regressions. Verify current `4.23` covers — if not, upgrade is a Sprint 0 blocker. |
| Brain | Gemini 3 Flash via OpenRouter | Creator V0 § 3, R3 § Cost envelope | Single model = single voice |
| **Voice (inbound + outbound)** | **OpenClaw `voice-call` plugin** with `provider: twilio`, `realtime: elevenlabs` (or `gemini-live`) | R3 § 1 Voice (revised), https://docs.openclaw.ai/plugins/voice-call | **REVISED 2026-04-27 (operator audit):** the plugin handles BOTH inbound and outbound natively — Twilio Media Streams + bundled realtime providers (ElevenLabs, Gemini Live, OpenAI Realtime). Earlier plan version called for ElevenLabs Agents as a separate front-end with a Convex shim — that was a reimplementation of plugin functionality. Shim dropped. |
| Voice telephony | Twilio (per-op number) | R3 § 1 Voice | $1.15/mo carry, A2P 10DLC under shared HeyMaya brand campaign |
| **Multi-platform social posting** | **Zernio (Late)** primary, Ayrshare as interface-isolated swap | R1 § Comparison matrix, § Verdict | Zernio $19/mo ent vs Ayrshare $149/mo. Zernio is 5-person bootstrapped (HIGH lock-in risk) — interface-isolate so swap is <2 weeks. |
| **GBP read + write + review-reply** | **Zernio (v0) → Direct Google Business Profile API (post-partner-access fallback, Sprint 8+ upgrade)** | R1 § Tier 2, § Open Q1, **operator decision 2026-04-27** | **Operator-revised lock**: Direct GBP API requires partner-access application (2-8 wk wait, no SLA per § 17 + § 18). Operator can't ship v0 gated on a multi-week external approval, so v0 routes ALL GBP operations (review-fetch, review-reply, local-post create/update, insights) through Zernio's MCP server. This means trusting Zernio's review-reply depth without a pre-spike — verified during implementation; if Zernio's review-reply turns out shallow/broken in real testing, escalate immediately and consider falling back to operator-approved-only (no auto-publish) until partner-access lands. The future-state direct GBP API path lives parked at `convex/integrations/gbp/direct/` for the eventual upgrade when partner-access lands. Cloud Pub/Sub `NEW_REVIEW` notifications also wait for direct path; until then, Zernio webhooks (or a polling fallback every 30 min) drive behavior #4. |
| FB + IG posting | **Zernio (v0 + post-launch — operator-revised 2026-04-27)** | R1 § Tier 2, R1 Composio row | **Operator-revised lock**: stay on Zernio. The prior plan called for Sprint 5 migration to Composio + Meta Graph direct for margin/rate-limit headroom; operator decided v0 keeps everything third-party-wrapped (avoiding multi-week Meta App Review + Business Verification gates). Re-evaluate direct Meta Graph at scale (>500 ops or when Meta BUC 200/user/hr starts biting). |
| **CRM (priority order, layered via aggregators)** | 1. **Jobber + HCP via Nango** (Sprint 4-5) — Nango handles OAuth + token refresh + sync infra. We ship the connector spec for these two FSMs ON the Nango platform. Open-source, audit-able, swap-out-able. 2. **QuickBooks Online via Apideck or Unified.to** (Sprint 5) — managed unified accounting API; don't build OAuth + token refresh ourselves. Pick Apideck as default, Unified.to as backup; defer the choice to Sprint 4 with a 2-day spike. 3. **ServiceTitan: direct integration** (Sprint 7+) — no aggregator (partner program is the gate; aggregators don't cover ServiceTitan because it requires per-customer partner contracts). HCP customer-side caveat: still requires **MAX plan ($329/mo)** for API+webhooks. | R2 § TL;DR, § Tier 1 + operator addendum | Significantly less work than fully bespoke integrations and avoids OAuth-per-vendor token-refresh hell. Each adapter still gets a thin Convex wrapper for normalization to our uniform job-event schema (R3 § 6). |
| Photo / video pipeline | Existing yt-dlp + Gemini Files API worker (Wave 4) extended to handle direct MMS images. **R2 attachment bridge** in front of OpenClaw. | R3 § 2 MMS, § 5 Multimodal | R3 § 2 mandates: BlueBubbles host uploads to Convex R2, OpenClaw sees only public URLs (sidesteps SSRF guard #34749, race #4848, HEIC #17670, mediaLocalRoots #30170 in one move). HEIC→JPEG in bridge. 1s debounce for multi-image. 5MB cap (under 8MB OpenClaw default). |
| Channel routing | OpenClaw native (`dmScope: per-channel-peer` + `session.identityLinks`); per-intent routing in Convex outbound layer | R3 § 8 Channel routing | Native primitives sufficient; gating in `planFeaturesService()`. |
| Read layer (social) | ScrapeCreators (lighter usage than creator product — competitor watch only) | Creator V0, R3 cost envelope | $1.50/op/mo budget |
| Write layer (CRM-adjacent) | Composio v3 — Gmail (operator inbox), Stripe-as-data, Google Calendar | Creator V0 § 3, R3 § 7 Calendar | Reuse |

### Pricing — service tier (LOCKED — operator-revised, supersedes R3/R4 anchors at the upper end)

The locked tiers compress the spread vs the prior $99 / $249 / $499 draft. Operator framing: *"I would charge, like, 99 to $1.49 for the first tier, and then maybe $1.49 and $1.99. I don't wanna bang these business owners over the head."*

| Tier | $/mo | Annual | Voice | Headline |
|---|---|---|---|---|
| **Starter** | **$99** | $999 | None | 1 GBP, text-only (web + SMS), 200 chat turns/mo, manual review-reply approval, no voice, no CRM integration |
| **Pro** | **$149** | $1,499 | 30 min/mo + $0.20/min overage | 1 GBP + 2 social, all 4 text channels, 1000 chat turns/mo, full Gmail deal desk, CRM integration (Jobber / HCP / QBO), weekly content suggestions |
| **Studio** | **$199** | $1,999 | 100 min/mo + $0.15/min overage, hard cap 500 | Multi-location (up to 5 GBPs), all channels, unlimited chat, ServiceTitan integration (when available), content rejuvenation (§ 10.5), Maya video editing (§ 12.5.7) |

14-day Pro trial → auto-downgrade to Starter on expiry, no card lost. Plan-tier enforced server-side via `planFeaturesService(business)`.

**Anchor reset against R4:** Compressed pricing means we no longer match Birdeye Starter ($299) or Goodcall Scale ($249) head-on at Pro. The new Pro $149 sits BELOW NiceJob Pro $125 + ReviewBox-tier and is dramatically below Hatch/Podium. Studio at $199 is roughly 1/3 of Goodcall Scale, ~1/4 of Hatch, ~1/8 of Scorpion-tier agency retainers. The headline becomes *"Maya does what a $1k-$2.5k/mo agency + $300/mo Birdeye stack does, for $199."* Pricing power left on the table; operator-revised lock holds.

#### Cost envelope per tier (validated against new model-routing matrix below)

| Tier | Infra cost (steady-state) | Revenue | Margin |
|---|---|---|---|
| **Starter ($99)** | ~$8/op/mo (Flash Lite-routed routine + minimal media) | $99 | **~92%** |
| **Pro ($149)** | ~$20/op/mo (mixed-thinking LLM + 30 voice min + light media) | $149 | **~87%** |
| **Studio ($199), avg 100 voice min** | ~$30/op/mo (full LLM mix + 100 voice + media + cataloging) | $199 | **~85%** |
| **Studio ($199) @ 500-min voice cap (worst case)** | ~$130/op/mo ($75 voice cost + $55 LLM/media; $60 charged as overage) | $199 + $60 = $259 | **~50%** |

All margins healthy. Voice metering + dual-model routing (next subsection) is what makes $99 / $149 / $199 work without compromising on capability.

### Model routing matrix (LOCKED — service product breaks creator-product principle 7)

The creator product locked "single model + thinking-budget routing" (CLAUDE.md principle 7). **The service product deliberately breaks this principle** because the lower headline pricing forces tighter inference economics. Documented as an explicit service-side architectural decision; routing decided at the action level (each Convex action specifies its target model + thinking).

| Task class | Model | Thinking | Why |
|---|---|---|---|
| `businessPicture` synthesis (one-time per operator at onboarding) | Gemini 3 Flash | HIGH | High-stakes; output cascades into every future Maya interaction |
| Contract red-flag scans (PDF → red flags) | Gemini 3 Flash | HIGH | Real money / legal exposure |
| Weekly content plan, manager-readiness packet, revenue snapshot synthesis, video edit-plan | Gemini 3 Flash | HIGH | High-stakes; multi-document grounding |
| Review-reply drafting, GBP post drafts, content arc planning | Gemini 3 Flash | MEDIUM | Reasoning quality matters; Google moderation bar to clear |
| Morning brief, evening recap, post-publish reaction | Gemini 3 Flash | LOW | Routine, fast latency, multi-doc grounding |
| Chat replies, comment triage, accountability nudges, niche scans, routine engagement watch, FB-group lead-classify | **Gemini 3.1 Flash Lite** | LOW | Routine, fast, cost-sensitive — quality drop (89% → ~85% MMLU-Pro) doesn't show through in operator-facing output |
| Voice replies + voice tool-calls | Gemini 3 Flash | ZERO (forced) | ElevenLabs custom-LLM endpoint sub-300ms first-token requirement (R3 § Voice) — unchanged |

Telemetry per task class so we can re-evaluate routing post-launch. Each Convex action carries a `modelTarget` + `thinkingBudget` + `routedReason` for audit.

#### Cost envelope sanity-check at Pro tier ($149) under typical operator load:
- ~5 routine LLM calls/day × 30 days = 150 calls × $0.005 (Flash Lite cheap) = **$0.75**
- ~3 medium-thinking calls/day × 30 = 90 × $0.04 = **$3.60**
- ~1 high-thinking call/week × 4 = 4 × $0.40 = **$1.60**
- Voice (30-min Pro inclusion): ~30min × $0.10 ElevenLabs + $0.014 Twilio = **$3.42** + $1.15/mo Twilio number = **$4.57**
- Asset cataloging (§ 10.5): **$3.40**
- Composio + GBP + Zernio per-op: **~$3-5**
- **LLM total ~$6/mo. Voice ~$5/mo. Media + integrations ~$8/mo. Total infra: ~$19-21/mo. Validates the $20 Pro infra envelope above.**

### Voice tier economics + minute caps (LOCKED — operator-revised at lower headline prices)

- **Service-operator voice usage pattern:** short bursts (30-90 sec avg per call). "Did you see the pics? Yeah post 'em. Done." Not extended dictation.
- **Pro ($149) includes 30 voice min/mo + $0.20/min overage** (was: no inclusion at all on prior Pro $249). 30-min inclusion is a deliberate signal — every Pro operator gets a taste of voice; heavier users self-select to Studio.
- **Studio ($199) includes 100 voice min/mo + $0.15/min overage** in $5 increments via Stripe metered billing. Hard cap 500 min/mo — operator must explicitly raise the cap (UI flow + Stripe metered config). Prevents runaway bills.
- **Starter ($99): no voice access at all** — text-only.

**Margin math (revalidated at lock):**
- Studio @ 100-min avg: ~$15 voice cost vs $199 = **~92% margin** on inclusive minutes.
- Studio @ 500-min cap: ~$75 voice cost + ~$55 LLM/media = ~$130 cost vs $199 + $60 overage = $259 revenue = **~50% margin** at heavy-use floor.
- Pro @ 30-min avg (inclusion only): ~$3.42 voice cost vs $149 = **~98% margin** on inclusive minutes.
- Pro overage at $0.20/min vs Studio inclusion-then-$0.15/min nudges heavy-voice Pro users to Studio at ~50-min/mo crossover.

Voice never tanks Studio's economics under any usage profile, even at the new compressed Studio price.

---

## 4. Personas

Three named ICPs the v0 must serve. Use as the test-fixture archetypes (parallel to creator V0's 50-creator corpus → 50-business corpus).

### Persona A — "Mike, the 1-truck HVAC owner" (target: Starter $99)

- **Business:** 1-3 trucks, owner-operator, residential HVAC service + repair.
- **Revenue:** $200K-500K annual.
- **Stack today:** GBP claimed, maybe a Facebook page he hasn't posted to in 6 months, sometimes Instagram. **No CRM** — pen-and-paper or QuickBooks for invoicing. Phone in pocket.
- **Pain:** Drowning in marketing he doesn't do. Forgets to ask for reviews. His GBP rating slipped from 4.8 to 4.5 because his last 3 unhappy customers are loud. Misses 2-3 leads/week because his phone goes to voicemail when he's elbow-deep in a furnace.
- **Cares about:** Getting more reviews, fewer missed calls, posting consistently, looking professional.
- **Pays:** **$99/mo Starter** for the Maya who texts him morning briefs ("3 jobs done yesterday, here are the review requests I drafted") + drafts his GBP review replies + nudges him on missed leads via SMS.
- **Voice:** No voice on Starter — text-only. Considers upgrading to Pro ($149) when he wants the 30-min voice taste, or Studio ($199) when his trucks hit 4.

### Persona B — "Sarah, the 8-truck plumber" (target: Pro $149)

- **Business:** 5-15 trucks, growing, residential + light commercial plumbing.
- **Revenue:** $1M-3M annual.
- **Stack today:** **Jobber or Housecall Pro** for dispatch + invoicing. GBP + active FB + occasional IG. 1-2 office staff (dispatcher, bookkeeper) but no marketing person.
- **Pain:** Review automation that *actually works* — Jobber has a feature for this but it's clunky and the requests look templated. Social goes dead for weeks at a time. Inbound leads from missed calls go nowhere because the dispatcher is on dispatch, not lead follow-up. Brand voice on review replies is inconsistent across whoever happens to be at a screen.
- **Cares about:** Review automation grounded to specific jobs, social staying alive, lead follow-up on missed calls, *one* voice replying on her behalf.
- **Pays:** **$149/mo Pro** — gets the CRM integration so Maya knows when a job closed and pings the customer 24h later, drafts review replies in Sarah's voice, posts to GBP+FB+IG from Sarah's job photos, triages inbound emails. Includes 30 voice min/mo so she can sample voice without committing to Studio.
- **Voice:** 30-min Pro inclusion is enough for occasional truck-cab calls; if she lands on >50 min/mo the upgrade math nudges her to Studio at $199.

### Persona C — "Ed, the multi-location electrical contractor" (target: Studio $199)

- **Business:** 20-50 trucks, 2-5 locations, $5M-15M annual revenue, residential + commercial electrical.
- **Stack today:** **ServiceTitan** (or migrating from FieldEdge to ServiceTitan). Multi-location GBP. Has a marketing coordinator who's overwhelmed managing 4 locations.
- **Pain:** Per-location consistency — different technicians, different review-reply tones across locations. Brand voice diluted. Considered Birdeye but $299/loc × 4 = $1,200/mo just for reviews. Considered Hatch but $900/mo and only does sales follow-up. Wants a *single voice* that owns the whole house.
- **Cares about:** Per-location consistency, brand voice across locations, voice-channel for high-touch leads, ROI tracking per location, ServiceTitan integration when ready.
- **Pays:** **$199/mo Studio** — gets multi-location (up to 5 GBPs), voice (100-min inclusion + $0.15/min overage to 500-min cap), content rejuvenation, video editing, ServiceTitan tier integration (Sprint 7+).
- **Voice:** Uses voice heavily for after-hours lead capture (operator's truck → Maya answers → drafts followup text). Burns 200 min/mo on average ($15 overage above inclusion); $214/mo all-in is still <1/4 of any human-CSR vendor he's looked at.

---

## 5. Onboarding flow (sub-5-min, conversational, never a multi-step form)

Mirror creator V0 § 4. Service-specific Qs. Sub-5-minute target (one minute slack vs creator's sub-4 because GBP claiming flow is slower than handle entry).

### The 11 steps

1. **Sign up via Clerk** (Apple / Google / Email). Webhook inserts row into `accounts` table with `accountType: "service-business"`.
2. **Account-type selection** — **SUPPRESSED in v0 (operator decision 2026-04-27).** Public surface is service-business-only; new signups default to `accountType: "service-business"`. Creator product is preserved behind `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT` env flag (default `false`). When the flag is `true`, the dual-track entry point (creator card / service card) is restored and `app/onboarding/creators/` is reachable. Operator flips the flag to re-expose; no code/test/schema work needed to re-enable.
3. **Claim Google Business Profile (GBP)** — Google OAuth flow with `business.manage` scope. List all GBPs the user has **manager/owner** access to (filter out `Sites`, `Suspended`). Pick one (Starter/Pro) or up to 5 (Studio). **Account-takeover guard:** verify Google account email matches the GBP owner-email-of-record before accepting. If user sees no GBPs, fall through to a "claim or create your GBP" link to Google.
4. **Connect FB + IG** (optional) — Composio existing OAuth flow. Pitch: "Your Facebook + Instagram drafts will be 80% better when Maya reads your past posts." Skip allowed (Pro+ only).
5. **Connect CRM** (optional, multi-select):
   - Jobber (Sprint 4-shipped)
   - Housecall Pro (warn: requires MAX plan $329/mo on customer side per R2 — pre-flight check before OAuth completes)
   - QuickBooks Online (universal fallback)
   - "I'll connect later" / "I don't use one" (creates a `crmConnections` row with `provider: "none"` so Maya knows to ask about jobs differently)
   - ServiceTitan (deferred Sprint 7+, shows greyed "Coming soon" CTA)
   - Pitch: "When Maya knows your jobs, her reviews/social/follow-up are 5× better."
6. **Background bulk pull** (parallel to Q&A, like Wave 3 onboarding parallelism). **HARD RULE: minimum viable data only — these are local small businesses, not creators producing daily content. Most have minimal social presence; pulling more than we need slows everything to a crawl + burns API quota + exceeds Gemini's per-request multimodal limits.** Bound by COUNT (not date), aggressively low ceilings, and design for "good enough first picture" — Maya's voice + understanding develop OVER TIME via the cron behaviors, not in onboarding.

   - GBP: **last 10 posts** + **last 20 reviews** + **last 8 photos** (Gemini's practical multimodal limit per request is ~10 images; we stay under). Customer Q&A skipped at onboarding (cron picks it up later).
   - FB/IG (if connected): **last 10 posts per platform** (cap count, bound work)
   - CRM (if connected): **last 14 days** of jobs + customers + invoices (cut from 30 — we just need recent context to recognize jobs Mike texts about, not a backfill)
   - **Competitor sweep DEFERRED to first weekly cron run** — not part of onboarding. Onboarding stays under 30 seconds of pull time.
   - **Skip platforms with zero data entirely**: if FB has 0 posts, skip. If GBP has 0 reviews, Maya's first message focuses on "you have 0 reviews — let's get your first 5 from your existing customer list" rather than analyzing absence.
   - **Synthesis goal at onboarding**: produce a "good enough first picture" — niche, top customer-praise theme, one clear first move ("you haven't posted in 38 days; let's fix that this week"). NOT a perfect voice fingerprint, NOT a complete brand-deal history, NOT a full audience analysis. Voice + nuance develop via the cron behaviors over the first 4-6 weeks of operator interaction.
   - **Total bulk pull budget**: ≤ 3 GBP API calls, ≤ 1 FB Graph call, ≤ 1 IG Graph call, ≤ 1 CRM call per onboarding. Synthesis sees ≤ 8 images + ≤ 30 text items. Bounded hard.
7. **11-Q service-business onboarding** (was 8; expanded with three local-texture Qs per § 2 principle 3 "Local marketing is the only audience") — clickable / multi-select where possible, conversational framing in Maya's first chat overlay (NOT a form). Local-texture Qs (Q9/Q10/Q11) are explicit because GBP gives us coordinates but not the *vernacular* — the named neighborhoods, named local competitors, and recurring local hooks that make Maya sound like a local instead of a regional bot. Skip allowed on Q9/Q10/Q11; Maya backfills via cron behaviors over time if skipped.
   - Q1. Business name + service type (multi-select: HVAC / plumbing / electrical / landscaping / cleaning / contracting / roofing / pest / restoration / mobile detailing / other)
   - Q2. Service area (city + miles radius OR list of zip codes — geocode locally, store as polygon)
   - Q3. Business size (multi-select: solo / 2-5 trucks / 6-15 / 16-50 / 50+)
   - Q4. Top 3 services (free text or pick from suggested list, e.g. "AC tune-up", "Furnace replacement", "Drain clearing")
   - Q5. Typical job ticket size ($) — bucketed: <$200 / $200-500 / $500-2K / $2K-10K / >$10K
   - Q6. Tone preference (friendly neighborhood pro / professional & efficient / authoritative expert) — service-business equivalent of creator's 3-way tone slider
   - Q7. Response speed expectation (how fast should Maya reply when Sarah/Mike/Ed texts her: instant / within 5 min / within 30 min)
   - Q8. Voice channel preference (skip / set up later / set up now — Studio only). Default: skip on Starter/Pro, "set up now" on Studio.
   - **Q9. Top 3 local competitors** (free text — names of the plumber/HVAC/roofer/etc. down the street that operators consider their direct competition; Maya looks these up via ScrapeCreators GBP for behavior #13 competitor watch). Skippable; pre-fills suggestions from GBP "similar businesses" if available.
   - **Q10. Where do most jobs come from?** (free text or multi-select — neighborhoods, suburbs, zip codes the operator does most of their work in; not the same as the broader service area Q2. Powers local-hook insertion in `gbp-post-optimizer` + `content-arc-planner`.) E.g. "Lincoln Park, Lakeview, and the West Loop" or "78704 mostly, some 78745."
   - **Q11. Local hooks the operator already uses** (free text — examples: "we sponsor the Lincoln Park Little League", "I do a lot of work in the historic district", "we always ramp up before the State Fair", "freezes hit us hard in February"). Captures the recurring local references Maya should weave into content. Skippable; backfills from review text + GBP post history if skipped.
8. **Multimodal "business picture" synthesis** — Gemini 3 Flash @ HIGH thinking (parallel to creator's `creatorPicture`). Watches GBP photos + reads last 50 reviews (with sentiment) + processes brand voice samples (operator's existing review replies + GBP post captions) + identifies recurring service patterns + extracts customer pain points + maps the operator's local-market position. Produces `businessPicture` row, including a **`localPositioning` block** (named served zips/neighborhoods from Q10; named local competitors with reputational positioning from Q9 + ScrapeCreators sweep; recurring local hooks from Q11 + extracted from review text mentioning landmarks/neighborhoods/seasonal patterns; "what makes this operator the local choice vs alternatives" — load-bearing input for `gbp-post-optimizer`, `content-arc-planner`, `competitor-watcher`, `seasonal-nudge`).
9. **Maya's first message** — grounded, cites the data, sent to chosen channel:
   > *"Read your last 47 reviews — your customers love how clean your techs leave the job site (mentioned in 11 reviews) but 6 of your last 30 jobs in the CRM didn't get review requests. I'll fix that. Tomorrow morning at 7am I'll text you yesterday's job summary + any pending review requests. Anything I should know before I start?"*
   The first message MUST cite at least 2 specific data points from the bulk pull (R1 grounding, R3 anti-fake-busy directive). Hallucination test = first-message phantom-name detector reused from creator side.
10. **Phone number capture → Twilio provisioning** — provision a unique US local number ($1.15/mo carry, R3 § 1). Display "Your Maya: +1 555 123 4567" with a one-tap "Add to contacts" iOS link. Channel routing: iPhone → iMessage (BlueBubbles); Android → WhatsApp recommended; SMS as fallback. Studio tier: voice number same as text number (one number for everything, dispatch by inbound type).
11. **OpenClaw deploy** — same pattern as creator side. Workspace bundle assembly (`SOUL.md` + `USER.md` + `AGENTS.md` + `HEARTBEAT.md` + `BOOT.md` + `MEMORY.md` seed + `TOOLS.md` + `DREAMING.md` + `jobs.json`) → Fly machine create → `openclaw cron add` for each cron job → channel pair → Maya pings on chosen channel.

**Acceptance:** sub-5-min wall-clock from "Sign up" click → first Maya message landed.

---

## 6. Day-to-day Maya behaviors (the service-side equivalent of creator's 17)

15 behaviors. Each maps to a cron entry in `jobs.json` + a standing-orders block in `AGENTS.md` + a skill in `agents/skills/maya-service-*/`. Rate-limit middleware enforces ≤4 unsolicited outbound/day (R3 § 4 — Hatch/Regal benchmark > 5/day = unsubscribe).

| # | Behavior | Cron / Trigger | Plan-tier | Data inputs | Output target | Failure-mode |
|---|---|---|---|---|---|---|
| 1 | **Morning brief** | `0 7 * * *` operator-tz | All | `serviceJobs` (today's schedule) + `reviews` (overnight new) + `inboundLeads` (last 12h) | `dailyBriefs` table → push to operator's primary channel. HQ Today screen subscribes. | If GBP API down, brief sent without review section + flagged inline. |
| 2 | **Job-completion review request** | Event-driven on CRM webhook `job.completed` (or polling fallback for HCP non-MAX); Starter has manual queue | All (Starter manual, Pro+ auto-draft + auto-send 24h after job) | `serviceJobs.completedAt` + `customers.phone` + `customers.email` + brand-voice from `businessPicture` | `reviewRequests` table; Twilio SMS or email send via Composio | Idempotent on `(jobId, kind)` — prevent duplicates. R3 § 6: cancel via cron tag if customer already left review. |
| 3 | **Review followup** | Day 3 + day 7 if no review left; Starter manual reminder, Pro+ auto-send | Starter manual / Pro+ auto | `reviewRequests.sentAt` + `reviews` cross-check | Append to `reviewRequests.followups[]` | Auto-cancel if review detected in `reviews` table. |
| 4 | **Review reply (drafted, NEVER auto-posted)** | Event-driven from Google Pub/Sub `NEW_REVIEW` (R1) within 30 min | All | `reviews.body` + `businessPicture.brandVoice` + `serviceJobs` (lookup by customer name) | `reviews.draftReply` + ping operator for approval; on yes, POST to GBP `reviews.updateReply` | **R3 § 3: NEVER auto-post — Google's `ReviewReplyState` moderation rejects AI-generated replies.** Always operator-approval gated. |
| 5 | **GBP cadence watch** | `0 10 */3 * *` (every 3 days, 10am op-tz) | All | `gbpPosts` (last post date) + `serviceJobs` (recent photos) | If last GBP post >5 days ago, draft post + queue in `gbpPosts` with `status: pending_approval` | If no recent job photos, fall back to suggesting a service-tip post. |
| 6 | **Content rejuvenation** | `0 14 * * 0` (Sundays 2pm op-tz) | Pro+ | `gbpPosts` + `socialContent` lib + `serviceJobs` (last 30d photos) | Suggest 3 repurposing ideas (before/after pair, customer testimonial, service-tip carousel); push to `gbpPosts.suggestions[]` | If no library, skip with `reason=empty-content-library`. |
| 7 | **Engagement watch** | `0 */2 8-22 * * *` (every 2h waking hours) | Pro+ | GBP messages + FB DMs + IG comments via Zernio webhooks | If operator hasn't responded within 2h, draft reply + ping for approval | Adversarial: rate-limit-inject if Zernio webhook flood. |
| 8 | **Lead response alarm** | `0 */30 * * * *` (every 30 min, 24/7) | All | `inboundLeads` (missed GBP message + missed call from Twilio + missed FB DM) older than 2h with no operator response | Single SMS nudge: "you have a missed lead from [name] in [zip], want me to draft a reply?" | Hard-rate-limit: max 4 unsolicited/day (R3 § 4 middleware). |
| 9 | **Daily content check** | `0 8 * * *` (8am op-tz) | All | `serviceContent` library — has operator sent any photos in last 48h? | If empty, soft check-in via primary channel | Skip on Sundays (off-day). |
| 10 | **Seasonal nudge** | `0 9 * * 1` (Mondays 9am op-tz) | Pro+ | `businessPicture.serviceType` + current month + `serviceJobs` (recent service-mix) | Suggest 2-3 season-relevant content angles (e.g. "AC tune-ups before the heat wave", "furnace pre-winter checklist") | Cited to historical demand — if no historical data in same season, label as suggestion not citation. |
| 11 | **Local event watch** | `0 18 * * *` (6pm op-tz) | Pro+ | ScrapeCreators local-events + weather API + sports scores | Surface 1-2 relevant local hooks for content if any | If quiet day, skip. |
| 12 | **Weather-triggered promo** | Event-driven from weather API webhook (storm forecast, heat wave, freeze) | Pro+ | NWS alerts in service area | Draft urgency post (e.g. "freeze warning Friday — pre-book pipe insulation now") + queue for approval | Don't double-fire on overlapping alerts; idempotency on `(zip, eventId)`. |
| 13 | **Competitor watch** | `0 9 * * 0` (Sundays 9am op-tz) | Pro+ | ScrapeCreators top-3 named competitor GBPs + their recent posts/reviews | Weekly competitor digest in morning brief: "X dropped to 4.4 stars, Y just posted a $99 tune-up promo" | If competitor GBP suspended, drop with note. |
| 14 | **Revenue snapshot** | `0 9 * * 1` (Mondays 9am op-tz) | Pro+ (CRM-required) | CRM jobs.completed + invoices.paid + invoices.outstanding for last 7d | Push to `revenueSnapshots` + brief surface | Skip silently if no CRM connected. |
| 15 | **Manager-readiness packet** | Quarterly auto, on-demand any time | Studio | `businessPicture` + 90d metrics + brand-voice samples + review history + content cadence + crew names | PDF rendered via `pdf` skill; "if you ever wanted to hire a real marketing manager, here's what they'd inherit" | Heavy thinking; sub-30s render budget. |
| 16 | **Asset ingestion + cataloging** | Event-driven on any inbound media (iMessage / WhatsApp / SMS-MMS / web-upload) | All | Raw bytes from R2 bridge, `serviceJobs` (for CRM linkage by recency + sender), Gemini multimodal | `mediaAssets` row with full one-time catalog (primarySubject, serviceCategory, visualQuality, framingNotes, suggestedUses, pairableWithAssetId, captionDraft) | Hash-dedupe before catalog cost. Failure → store with `catalog.primarySubject = "[uncataloged]"` + retry queue; never lose the file. Rate-limit cataloger queue so a 50-photo flood doesn't burn $1 in 10s. **See § 11.5 for the full Operator content library spec.** |

**Sibling-file scan rule (creator V0 § 10 inherited):** every entry in `jobs.json` must have a matching standing-order block in `AGENTS.md` must have a matching skill in `agents/skills/maya-service-*/`. Sprint 3 acceptance includes the green sibling-file scan.

---

## 7. Skills inventory

13 custom `maya-service-*` skills + 4 Anthropic public skills installed by reference. Each ships SKILL.md + `script.ts` (if non-trivial compute) + `__tests__/` per the creator-side custom-skill convention.

**Model routing per skill (per § 3 routing matrix):** `review-reply-drafter` → Gemini 3 Flash MEDIUM; `review-request-drafter` + `gbp-post-optimizer` + `lead-response-nudger` + `brand-voice-applier` → Gemini 3 Flash LOW; `citation-firewall` + `competitor-watcher` (routine classify) → Gemini 3.1 Flash Lite LOW; `packet-generator` + `revenue-snapshot-renderer` + `content-arc-planner` + `contract-redflag` → Gemini 3 Flash HIGH; `voice-brevity-overlay` + voice tool-calls → Gemini 3 Flash ZERO (forced); `asset-cataloger` → Gemini 3 Flash MEDIUM (multimodal vision). Each skill's `script.ts` declares `modelTarget` + `thinkingBudget` so the routing is auditable per call.

### Custom Maya service skills

| Skill | Purpose | Inputs | Outputs | Plan-tier | Test categories |
|---|---|---|---|---|---|
| `maya-service-review-request-drafter` | Draft a job-specific review request in operator's brand voice | jobId, customerFirstName, serviceType, technicianName, jobNotes, brandVoice | text (SMS) + email subject + email body | All (Starter manual queue, Pro+ auto-send) | cross-tenant, plan-tier, adversarial (empty notes), citations |
| `maya-service-review-reply-drafter` | Draft a GBP review reply that passes Google's `ReviewReplyState` moderation | reviewBody, reviewerName, starRating, brandVoice, jobContext (if matched) | reply text (≤350 chars) + sentiment classification + risk flags | All | cross-tenant, citations (no fabricated job details), adversarial (1-star review, profanity), Google-moderation-pass simulation |
| `maya-service-gbp-post-optimizer` | Compose a GBP local post (text + CTA + image hint). **SKILL.md hard rule (§ 2 principle 3): every post MUST include at least one local hook — neighborhood/zip mention, named local landmark, weather reference, local event, or community reference — pulled from `businessPicture.localPositioning`. If `localPositioning` is empty, fall back to served zips from Q2 + GBP city. Generic "we serve [region]" is rejected by the citation firewall.** | seedTopic OR jobPhotos[], serviceArea, brandVoice, postType (`STANDARD`/`EVENT`/`OFFER`), **businessPicture.localPositioning** | text (≤1500 chars) + CTA button + recommended image + **localHookUsed: string** (which hook from localPositioning was woven in) | Pro+ | cross-tenant, plan-tier, citations, **local-hook-presence** (asserts every output contains at least one hyperlocal reference; generic "in your area" outputs fail) |
| `maya-service-job-photo-curator` | Pick best photos from a job batch + reasoning + before/after pairing | photoUrls[], jobContext, geminiFilesApi | best_photos[], rejected[] with reasons, before_after_pairs[] | All (Starter limited to 3 photos/day) | adversarial (face/license-plate detection), photo-bridge-integrity (R3 § 2) |
| `maya-service-lead-response-nudger` | Compose an SMS nudge when operator has missed a lead | leadSource, leadName, leadAge, lastChannel | SMS body (≤120 chars), urgency tag | All | rate-limit (≤4/day enforced upstream, but skill confirms in metadata), cross-tenant |
| `maya-service-brand-voice-applier` | Apply business brand voice to any draft | draftText, businessPicture.brandVoice, channelHints | tone-adjusted draft + diff from input | All | tone-consistency, citations |
| `maya-service-citation-firewall` | Pre-send hallucination gate (parallel to creator-side firewall) | draftText, sourceContextList | pass/fail + flagged unsupported claims | All | hallucination grounding |
| `maya-service-packet-generator` | Render manager-readiness packet PDF | businessPicture + 90d metrics + brand-voice + reviews + content history | PDF (via Anthropic `pdf` skill) | Studio | output-quality, adversarial (missing data sections) |
| `maya-service-content-arc-planner` | Plan a multi-day content arc around a seed event (storm, season, milestone). **SKILL.md hard rule (§ 2 principle 3): the arc MUST be hyperlocal — every post in the arc references named neighborhoods, local landmarks, named local competitors (where contrast is helpful), or operator-supplied local hooks from `businessPicture.localPositioning`. National-scope copy is rejected.** | seedEvent, **businessPicture.localPositioning**, platforms[] | per-platform per-day post outline (build-up / day-of / recap) + **localHooksWoven[]** (which hooks from localPositioning each post draws from, for audit) | Pro+ | cross-tenant, citations, **local-hook-density** (asserts ≥80% of posts in an arc reference at least one local hook from `localPositioning`) |
| `maya-service-contract-redflag` | Scan uploaded service contract / vendor agreement PDF for red flags | PDF (via Anthropic `pdf` skill) | red-flag report (auto-renew, IP grants, kill fees, exclusivity) | Pro+ | adversarial PDF (malformed, password-locked) |
| `maya-service-revenue-snapshot-renderer` | Compose revenue snapshot prose from CRM data | crmJobs[], crmInvoices[], priorWeekBaseline | prose snapshot + comparison hints | Pro+ (CRM-required) | cross-tenant CRM data, citations |
| `maya-service-voice-brevity-overlay` | System-prompt overlay for voice-mode (≤20 words) | base SOUL.md persona | overlay block | Studio | latency budget (must not add >50ms processing) |
| `maya-service-competitor-watcher` | Weekly competitor digest from ScrapeCreators sweeps | competitorGbps[], lastSweep | digest prose + flags (e.g. "competitor dropped 0.3 stars") | Pro+ | citations, adversarial (competitor GBP suspended) |
| `maya-service-asset-cataloger` | One-time multimodal catalog of an inbound photo/video/audio asset | assetUrl, mimeType, businessId, serviceJobId? | structured catalog object (primarySubject, serviceCategory, visualQuality, framingNotes, suggestedUses[], pairableWithAssetId?, captionDraft?) | All | adversarial (corrupted bytes, oversized video), idempotency (hash-dedupe), catalog-quality (>85% accuracy on synthetic test set) |
| `maya-service-content-rejuvenator` | When operator is light on new content, surface unposted-or-stale catalog assets ranked for repurposing | businessId, last-content-cadence, recent-posting-history | ranked list of `{assetId, suggestedAction, draftCaption, targetPlatform, reasoning}` | All | citations (asset must exist + be unposted on target platform), cross-tenant |

### Anthropic public skills installed (consistent with creator V0 § 5 Sprint 3.5 policy)

- `pdf` — packet render + contract scan
- `docx` — vendor proposal parse
- `internal-comms` — long-form prose tone
- `skill-creator` — Maya can author skills in beta when she hits a gap

**No third-party ClawHub skills in v0.** Locked policy carries from creator side.

---

## 8. Schema additions

Mirror the additive-block convention. New tables + extensions to existing creator tables. Each new table includes `_creationTime` (Convex auto), `accountId` indexed, `createdAt`/`updatedAt`.

### Extensions to existing tables

```ts
// Existing creators table extended (or rename to `accounts`):
accountType: v.union(v.literal("creator"), v.literal("service-business"))
businessId: v.optional(v.id("businesses"))     // service-business pointer
creatorId: v.optional(v.id("creators"))        // creator pointer (back-compat)
```

### New tables (service-side)

| Table | Key fields | Purpose |
|---|---|---|
| `businesses` | accountId, name, serviceTypes[], serviceAreaPolygon, ticketSizeBucket, businessSize, tonePreference, responseSpeed, voiceEnabled, twilioNumber, mayaFlyAppId | Parallel to creator's onboarding-answers fields. One per service-business account. |
| `businessPicture` | businessId, brandVoice (stylometry), customerSentiment, recurringServicePatterns, localCompetitors[], **localPositioning** (servedZips[], servedNeighborhoods[], namedCompetitors[{name, reputationalNote, gbpRating?}], recurringLocalHooks[{kind: "weather"\|"event"\|"landmark"\|"sport"\|"season"\|"community", text}], localChoiceThesis: string), generatedAt, model, sourceCitations[] | Parallel to `creatorPicture`. High-thinking synthesis output. **`localPositioning` is load-bearing for principle 3 ("Local marketing is the only audience") — consulted by `gbp-post-optimizer`, `content-arc-planner`, `competitor-watcher`, `seasonal-nudge`. Captured at onboarding from Q9-Q11; refined over time by cron behaviors.** |
| `gbpLocations` | businessId, gbpLocationId, gbpAccountId, address, primaryCategory, verifiedAt, owner email | One per claimed GBP. Studio: up to 5. |
| `serviceCustomers` | businessId, crmCustomerId (nullable), name, phone, email, address, lifetimeValue, lastJobAt, reviewStatus | CRM-mirrored customer records. |
| `serviceJobs` | businessId, customerId, crmJobId, status, scheduledAt, completedAt, technicianName, serviceType, ticketAmount, photos[], notes | CRM-mirrored. Source of truth for job-completion-driven behaviors. |
| `gbpPosts` | businessId, gbpLocationId, status (draft/pending/posted/rejected), text, cta, imageUrl, scheduledAt, postedAt, gbpLocalPostId, engagement | Maya-generated + operator-approved GBP posts. |
| `reviews` | businessId, gbpLocationId, platform (gbp/fb/yelp), externalReviewId, reviewerName, starRating, body, sentiment, customerMatchedJobId, draftReply, replyStatus (drafted/approved/posted/rejected), publishedAt | Cross-platform review pipeline. Yelp = monitor-only. |
| `reviewRequests` | businessId, jobId, customerId, channel (sms/email), status, sentAt, openedAt, completedAt, followupCount, lastFollowupAt | Queue + send + followup tracking. |
| `serviceContent` | businessId, type (photo/video/before-after-pair), uploadedBy (operator/maya), originalUrl, processedUrl, geminiFileId, jobId, tags[], qualityScore | Photo/video library. |
| `inboundLeads` | businessId, source (gbp-msg/fb-dm/twilio-missed-call/twilio-sms), externalId, contactName, contactPhone, body, capturedAt, operatorRespondedAt, mayaNudgedAt | Lead tracker; powers behavior #8. |
| `crmConnections` | businessId, provider (jobber/hcp/qbo/servicetitan/none), oauthAccessToken (encrypted), oauthRefreshToken (encrypted), expiresAt, scopes[], lastSyncAt, planTierWarning (HCP MAX detection) | Separate from `connectedAccounts` so we don't pollute creator-side schema. |
| `voiceChannels` | businessId, twilioNumberSid, twilioPhoneNumber, elevenlabsAgentId, elevenlabsVoiceId, provisionedAt, monthlyMinutesUsed, lastBilledAt | Twilio + ElevenLabs provisioning records. Studio-only rows. |
| `webhookEvents` | provider, externalEventId, kind, processedAt | 24h TTL, fail-closed-on-duplicate (R3 § 4 idempotency requirement). |
| `mediaAssets` | businessId, storageUrl, storageBytes, mimeType, source, receivedAt, serviceJobId?, serviceCustomerId?, **catalog** (primarySubject, serviceCategory, visualQuality, framingNotes, suggestedUses[], pairableWithAssetId?, captionDraft?, catalogedAt, catalogModel, catalogCostUsd), usageHistory[], archivedAt?, expiresAt? | The operator content library. Every photo/video/audio note from operator, persistently stored + cataloged once + retrievable. **Full schema in § 11.5.** Indexes: `by_business`, `by_business_and_received_at`, `by_business_and_service_category`, `by_service_job`. |
| `approvalRules` | businessId, ruleType (`review-request-auto-send` / `gbp-post-auto-publish` / `review-reply-auto-publish-allowlist` / `content-rejuvenation-auto-publish`), enabled, scope (per-rule constraints — e.g. `safeContentClasses[]` for auto-publish, `delayHours` for review-request), createdAt, updatedAt, lastTriggeredAt | Tiered approval modes (operator addendum 2026-04-27). Starter has zero rules — every action operator-approved. Pro can enable specific rule types (e.g. `review-request-auto-send` 24h after `job.completed`). Studio can enable broader auto-publish rules on a curated allowlist of safe content classes. **Plan-tier-gated rule types** enforced server-side: `review-reply-auto-publish-allowlist` is FORBIDDEN at all tiers (Google `ReviewReplyState` requires operator approval — locked across tiers). Index: `by_business_and_rule_type`. **First implementation lands in Sprint 5 alongside Reviews/Posts/Customers UI.** |

### Index requirements (cross-tenant testing depends on these)

Every business-scoped table indexed `by_business` on `businessId`. Cross-tenant test asserts a query with mismatched `businessId` returns empty / throws.

---

## § 8.5 — Maya's dynamic skill discovery + install (RETIRED FOR V0 — 2026-04-27 fourth correction)

> **2026-04-27 status:** This section is preserved for historical reference and Phase 1.5+ design. **Runtime skill discovery + install is RETIRED for v0.** Per operator (fourth correction this day): every Maya gets the SAME curated skill bundle at deploy time. No per-business skill divergence. No operator-approved on-demand installs. The variation surface in v0 is `soul.md` + memory-wiki seed pages + connected accounts only.
>
> **What this means in code:**
> - The `maya-skill-installer` SKILL.md stays in-repo as a dev-time reference shape but is NOT shipped in any v0 workspace bundle (annotated with `status: NOT-SHIPPED-IN-V0` in its frontmatter).
> - The `customSkills` schema table stays additive but is annotated deprecated; production writes are bugs.
> - The HQ Profile "Skills tab" planned for Sprint 5 is dropped from v0.
> - The plan-tier matrix Pro+ "extension path" gate is dropped from v0.
>
> **What survives:** the *capability shape* (search ClawHub, evaluate candidates, risk-flag) is a sound dev-time curation tool **we** could use when picking the v0 baseline ClawHub skills (NemoVideo for video, etc.). Just not a runtime surface Maya invokes.
>
> **Phase 1.5+ revisit:** if post-MVP feedback shows operators wanting niche skills the curated baseline doesn't cover, this whole section is the design spec to reintroduce.

---

### Original § 8.5 design (HISTORICAL, NOT V0)

**Operator framing (original):** "Maya should already have these (the curated baseline in § 7), as well as the ability to go search ClawHub or skills.sh and install skills she doesn't have but needs."

**Why this matters:** service businesses have wildly varied operational shapes (HVAC vs landscaping vs roofing vs cleaning vs mobile detailing). Curating *every* possible niche skill in our § 7 baseline is impossible. A roofer might need a "drone-footage post-production" skill; a cleaner might need a "recurring-customer cadence" skill; a restoration contractor might need a "FEMA-claim documentation" skill. Maya extending herself based on operator needs is a wedge — fixed-feature competitors can't keep up with the tail. The skills.sh + ClawHub ecosystems are growing fast (Vercel launched skills.sh on Jan 20 2026 per [Vercel changelog](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem); ClawHub hit 13,729 skills by Feb 28 2026 per [DataCamp guide](https://www.datacamp.com/blog/best-clawhub-skills) and [Mehul Gupta Medium piece](https://medium.com/data-science-in-your-pocket/what-is-openclaw-clawhub-e123c2dd0db1)). Riding that growth means Maya gets more capable over time without us shipping every feature.

**The two registries (April 2026 state):**

| Registry | Source | Skill count | Standard | Verified flag | Risk posture |
|---|---|---|---|---|---|
| **ClawHub** ([clawhub.ai](https://clawhub.ai/), [GitHub openclaw/clawhub](https://github.com/openclaw/clawhub), [OpenClaw docs](https://docs.openclaw.ai/tools/clawhub)) | OpenClaw official skill registry | 13,729 by late Feb 2026; **3,286 after Feb 7 2026 security purge** ([Blink security guide](https://blink.new/blog/openclaw-clawhub-skills-safe-install-guide-2026), [DataCamp](https://www.datacamp.com/blog/best-clawhub-skills)) | SKILL.md (Anthropic Dec 2025 standard) | Yes — `verified` (first-party / Anthropic-blessed) post-purge + VirusTotal partnership | Material — security incident already happened in 2026; 2,419 suspicious skills removed in one sweep |
| **skills.sh** ([skills.sh](https://skills.sh/), [Vercel docs](https://vercel.com/docs/agent-resources/skills), [vercel-labs/skills GitHub](https://github.com/vercel-labs/skills), [Vercel changelog](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem)) | Vercel-launched open directory | Growing fast since Jan 20 2026 launch | SKILL.md (same standard) | Anonymous-telemetry leaderboard (install counts) — no formal verified flag | Newer ecosystem; less curation in place yet |

**This is a deliberate v0 policy reversal for the service product.** The creator-product locked policy (`memory/project_skill_strategy.md`) is "no third-party ClawHub skills in v0; install only Anthropic public utility skills + custom-write all behavioral skills." The service product *extends* that posture: the curated baseline in § 7 stays Anthropic-public + custom-Maya only, BUT we add a *gated, operator-approved* extension path via the new meta-skill. The creator product can adopt this retroactively if the security model proves out — defer that decision; document the parallel for awareness.

#### Meta-skill: `maya-skill-installer`

Add to § 7 inventory as the 16th custom service skill.

| Field | Value |
|---|---|
| Purpose | When Maya identifies a capability gap during her work, search ClawHub + skills.sh for relevant skills, present top candidate to operator with description + source + install count + risk flags, install on operator approval. |
| Inputs | `capabilityDescription` (free-form), `preferredRegistry` (`clawhub` \| `skills.sh` \| `both`), `verifiedOnly` (default true), `searchContext` (optional Maya task that triggered the search) |
| Outputs | Ranked candidate list (top 5), per-candidate `{name, sourceUrl, author, installCount, verified, requestedPermissions, riskFlags[]}`, install confirmation flow link, post-install verification result |
| Plan-tier | **Pro+ only.** Starter has the curated § 7 baseline + nothing else. |
| Security gates | (1) Operator approval required for *every* install — never silent. (2) `verifiedOnly: true` is the default; operator can flip to false but UI surfaces a red warning. (3) Curated allow-list of permissible tool requests at the registry-fetch stage — a candidate skill requesting unknown / excessive tool surface (e.g. raw-fs-write, arbitrary HTTP) is rejected pre-presentation. (4) Installed skills are version-pinned per business — never auto-upgrade; operator approves each version bump. (5) Convex audit log of every search + install + uninstall with operator userId. |
| Test categories | Cross-tenant (Business A's installed skills never visible in Business B's runtime), plan-tier (Starter blocked at search-call entry), adversarial (malicious manifest rejected; permission-creep skill rejected; operator-approval bypass attempt rejected), idempotency (re-install of same skill+version is a no-op + audit-logged). |

#### Schema addition (extends § 8)

```ts
customSkills: defineTable({
  businessId: v.id("businesses"),
  skillName: v.string(),
  source: v.union(v.literal("clawhub"), v.literal("skills.sh"), v.literal("custom")),
  sourceUrl: v.string(),
  version: v.string(),
  installedAt: v.number(),
  approvedByOperator: v.boolean(),
  approvalContext: v.optional(v.string()),  // why operator approved it
  searchTriggerContext: v.optional(v.string()),  // the Maya task that triggered the search
  verified: v.boolean(),                        // registry's verified flag at install time
  requestedPermissions: v.array(v.string()),
  lastUsedAt: v.optional(v.number()),
  archivedAt: v.optional(v.number()),
})
  .index("by_business", ["businessId"])
  .index("by_business_and_skill_name", ["businessId", "skillName"])
```

#### Architectural concerns + mitigations

- **Skills run inside Maya's OpenClaw runtime** — a malicious skill could exfiltrate per-business data or perform destructive actions. Mitigations: (a) prefer ClawHub `verified` post-Feb-2026-purge skills; (b) reject unknown-permission skills at fetch time; (c) operator approval per install; (d) Convex audit log of every skill action; (e) per-business Fly machine isolation already gives us tenant-level blast-radius limit.
- **Versioning** — pinned per business. Auto-upgrade is forbidden. Operator gets notified of available updates via primary channel; approves each bump explicitly.
- **Skills that Maya never uses** — telemetry tracks `lastUsedAt`; Maya proactively suggests archiving stale skills in monthly recap (avoids bundle bloat).
- **Honest limitation:** even with curation, this surface is materially riskier than the curated baseline. We document this in operator-facing copy ("Pro+ feature: Maya can install community skills with your approval — community skills are reviewed but not Anthropic-built") and gate it behind an explicit Pro+ opt-in toggle (default OFF on first Pro upgrade; operator must turn on).

#### Operator-required for v0

- ClawHub API key / public access verification ([clawhub.ai](https://clawhub.ai/), [docs.openclaw.ai/tools/clawhub](https://docs.openclaw.ai/tools/clawhub)).
- skills.sh API access ([skills.sh](https://skills.sh/), [vercel-labs/skills](https://github.com/vercel-labs/skills) — npx-installable per the changelog; API surface for programmatic search `[unverified]` — operator-side spike during Sprint 3.5).
- **Curation policy decision (operator owns):** verified-only by default + operator can opt-in to community? Or community always behind explicit per-install warning? Recommend verified-only by default with operator opt-in toggle. Operator decides final security posture.

---

## 9. Workspace bundle (the Maya OpenClaw workspace files)

Per-business workspace bundle uploaded to the Fly machine on deploy. Differences from creator-side noted inline. All conventions per `memory/project_openclaw_alignment.md` and OpenClaw docs.

**Critical reminder per § 2 principle 1**: PLATFORM EXPERTISE LIVES HERE, NOT IN CODE. The workspace MD files are where Maya learns "GBP can take a multi-photo carousel as one post, Instagram needs a single combined edit or carousel, Facebook prefers a polished caption + 1-3 image set." We do NOT translate platform quirks into TypeScript `if (platform === "x") {...}` rules. The MD files contain platform-by-platform best practice prompting; Maya proactively decides what to do with inbound photos/videos based on her training there.

Specifically AGENTS.md must include sections on:
- **GBP**: scrollable photo posts (operator can dump 5 raw photos and Maya posts as one scrollable GBP entry — no edit needed), 1500-char caption, CTA buttons, posting cadence sweet spot
- **Instagram**: requires polished single-post or carousel — Maya proactively offers to edit raw clips/photos together using the FFmpeg+Gemini editor (§ 12.5.7)
- **Facebook**: caption-first, 1-3 image carousel, longer-form storytelling than Instagram
- **TikTok** (if Studio operator wants it): vertical short-form video required, hook-first, FFmpeg edit + caption + hashtags
- **Local-first content rule (§ 2 principle 3 — load-bearing):** every piece of content Maya generates is hyperlocal by default. Maya is told explicitly in AGENTS.md: *"You are not writing for a global feed. You are writing for [Operator]'s neighbors in [served-neighborhoods] within [service-area]. Every post should reference at least one of: a named neighborhood/zip from `localPositioning.servedNeighborhoods`, a named local landmark, a named local competitor (where contrast helps), a local weather/seasonal pattern, a local event/team/community reference from `localPositioning.recurringLocalHooks`. Generic 'in your area' or 'in our community' phrasing is a failure mode — name the place."*
- **General behavior**: when operator sends multiple media items in a short window (60-second debounce), Maya asks: "I see 4 photos from what looks like the same job — want me to (a) post all 4 to GBP as a scrollable set, (b) pick the best one for Instagram + edit a 30-sec reel from clips you sent earlier, (c) draft a Facebook post with 3 of these + a caption?" Operator picks; Maya executes.

This is OpenClaw's proactive nature + good prompting doing the work, not custom code.

| File | Owner | Service-side specifics | Source / how it's generated |
|---|---|---|---|
| `AGENTS.md` | Author | Service-business-specific intro ("You are Maya, [Operator]'s back-office for [Business]"). Embeds standing-orders for the 15 cron jobs. Operating rules: never auto-post review replies; never bill/charge/schedule without confirmation; always cite the job by customer-last-name + service-type ("Henderson 14-SEER install" not "the job"). | `convex/agents/packs/maya_service/agents.template.md` + per-business interpolation |
| `SOUL.md` | Author | "Maya from the office" voice. Calm, practical, dry humor. Anti-fake-busy block (R3 § 3). Brevity defaults: voice ≤20 words, text ≤2 sentences unless asked. | `generateServiceSoul()` from `businessPicture` + onboarding Qs |
| `USER.md` | Author | Operator name, business name, service area polygon, top services, tone, response-speed, technician names (from CRM if connected), business hours (from CRM/calendar/manual), brand-voice samples (operator's own past review replies + GBP captions). | Onboarding pipeline output |
| `IDENTITY.md` | Runtime (OpenClaw) | Auto-generated. We don't touch. | OpenClaw bootstrap |
| `HEARTBEAT.md` | Author | Brief checklist, <2K chars (R3 § 4 token-burn warning). References to which behaviors are "due" via `tasks:` interval gating. **`activeHours` window** set from operator's CRM/calendar busy windows + 7am-9pm fallback. | Generated from `businesses` + cron jobs list |
| `BOOT.md` | Author | First-message instructions calibrated to service-business. Cite ≥2 grounded data points from bulk pull. Open with the fix (e.g. "I see 6 of your last 30 jobs didn't get review requests — I'll fix that."), close with one specific Q the operator can answer in one tap. | `convex/agents/packs/maya_service/boot.template.md` + interpolation |
| `MEMORY.md` seed | Author | Domain priors per service-type (HVAC vs plumbing vs electrical tone differs). Seasonal calendar anchors. Brand-safety memory ("never quote pricing without operator approval", "never schedule without confirmation"). | `convex/agents/packs/maya_service/memorySeeds/<serviceType>.md` |
| `TOOLS.md` | Author | Lists tools Maya has access to: `lc_maya_service.*` HTTP endpoints (read serviceJobs, write reviewRequests, etc.), Zernio publish, GBP read/write/reply, Composio (Gmail/Calendar), photo-upload bridge, voice-call (outbound only), CRM read/write. Plan-tier-gated tools listed as gated. | Generated from skill manifests + `planFeaturesService` map |
| `DREAMING.md` | Author | Domain knowledge consolidation patterns. Per-service-type heuristics ("HVAC: customers care about cleanliness in reviews; plumbing: speed; electrical: certifications"). Operator-voice consolidation rules (after 30 days, lock the voice fingerprint). | `convex/agents/packs/maya_service/dreaming.template.md` |
| Standing orders | (Embedded in AGENTS.md per W5 inline pattern) | 15 standing-order blocks, one per cron behavior, each with Scope / Triggers / Approval gates / Escalation rules. | Generated from a single declarative table in `convex/agents/packs/maya_service/standingOrders.ts` |
| `jobs.json` | Author | The 15 service-side cron jobs (table in § 6 above). Installed via `openclaw cron add` calls during deploy. | Generated declaratively |
| `skills/maya-service-*/` | Author | The 13 custom skills + 4 Anthropic public-skill references | Built in Sprint 3 / 3.5 |

**Bootstrap cap (R3 § 3 / OpenClaw docs):** Default 12K chars per file; combined SOUL+AGENTS+USER+HEARTBEAT default 60K total per [agent-workspace docs](https://docs.openclaw.ai/concepts/agent-workspace) — we raise to 150K via `bootstrapTotalMaxChars` config since service-business AGENTS.md inlines 15 standing-orders (rendered ~22K). Bundler asserts the configured ceiling before upload.

---

## 9.5 Memory-wiki integration (NEW 2026-04-27 per https://docs.openclaw.ai/plugins/memory-wiki)

**The operator-content-library wedge made structural.** OpenClaw's `memory-wiki` plugin is a compiled knowledge vault on top of `memory-core`. It stores structured claims with provenance (sourceId + path + lines + weight + confidence + updatedAt), organized into `entities/`, `concepts/`, `syntheses/`, `sources/`, `reports/`. It exposes 5 agent tools: `wiki_status`, `wiki_search`, `wiki_get`, `wiki_apply`, `wiki_lint`. Compile produces `.openclaw-wiki/cache/{agent-digest.json,claims.jsonl}`. Recommended mode for our deployment: **`bridge`** — wiki reads memory-core's exported memory artifacts + dream reports + daily notes, so dreaming continues to populate the wiki automatically.

### Why this is load-bearing for the service-business product

The wedge phrase is "Maya turns every completed job into local marketing." That requires Maya to hold a rich, provenance-traceable picture of the operator's business — brand voice, named local competitors, named neighborhoods, recurring service patterns, customer-praise themes, technician personalities, seasonal patterns, named-customer relationship history. Earlier plan revisions had us hand-rolling this as a `businessPicture` Convex row + ad-hoc citation lookups in skills + ad-hoc local-positioning prompts. Memory-wiki is the canonical OpenClaw pattern for exactly this. Adopting it means: **every Maya claim is automatically provenance-traced; citation firewall reduces to `wiki_get` + verify; dreaming auto-promotes learned facts; competitor-watcher / brand-voice / local-positioning each become wiki pages with real evidence chains.** This is the difference between Maya saying "your customers love how clean your techs leave the job site" because she's repeating a phrase from the prompt, and Maya saying it with `wiki_get('concepts.customer-praise-themes')` returning 11 evidence-cited claims back to specific reviews. Operator-trust dividend is enormous.

### Per-business vault shape (locked)

Each per-business Maya gets its own vault on its Fly machine. Layout per business:

```
<vault>/
  AGENTS.md           # workspace AGENTS.md (already generated)
  WIKI.md             # wiki entry point
  index.md            # auto-compiled index
  inbox.md            # raw drops Maya promotes via dreaming
  entities/
    customers/<lastname-firstinitial>.md   # named customer relationships
    technicians/<firstname>.md             # crew personalities + capabilities
    competitors/<slug>.md                  # named local competitors (from Q9 + ScrapeCreators)
    services/<slug>.md                     # service-type patterns (HVAC tune-up, drain clearing)
    neighborhoods/<slug>.md                # named local neighborhoods served (from Q10)
    vendors/<slug>.md                      # operator's suppliers / contractors
  concepts/
    brand-voice.md                          # stylometry + signature phrases (was businessPicture.brandVoice)
    customer-praise-themes.md               # what customers love (was businessPicture.customerSentiment.positive)
    customer-friction-points.md             # what customers complain about (was businessPicture.customerSentiment.negative)
    recurring-service-patterns.md           # service-mix by season (was businessPicture.recurringServicePatterns)
    local-positioning.md                    # served zips/neighborhoods/hooks/local-choice-thesis (THE wedge surface)
    seasonal-patterns.md                    # local weather/season → service demand mapping
    business-policies.md                    # operator-stated rules (e.g. "never quote pricing without confirmation")
  syntheses/
    business-picture-<YYYY-MM-DD>.md        # Maya's compiled mental model, refreshed quarterly
    weekly-content-plan-<YYYY-WW>.md
    manager-readiness-packet-<YYYY-MM-DD>.md
    revenue-snapshot-<YYYY-MM-DD>.md
  sources/
    onboarding/                             # raw bulk pull from Zernio: GBP profile, last 50 reviews, last 30 jobs
    reviews/<external-id>.md                # one page per inbound review
    jobs/<crm-id>.md                        # one page per CRM-mirrored job
    operator-chats/<YYYY-MM-DD>.md          # operator's chat with Maya, daily
    media-assets/<asset-id>.md              # one page per cataloged photo/video; cites mediaAssets row
    contracts/<vendor-slug>.md              # vendor contract scans
  reports/
    open-questions.md                       # what Maya doesn't know but should
    contradictions.md                       # operator said X, data says Y — surface for resolution
    low-confidence.md                       # claims Maya is unsure about
    claim-health.md                         # provenance gaps
    stale-pages.md                          # haven't been refreshed in N days
  _attachments/                             # binary assets (mirrored from R2)
  _views/                                   # operator-facing dashboards
  .openclaw-wiki/
    cache/agent-digest.json                 # compiled per-business digest Maya consumes
    cache/claims.jsonl                      # all claims, indexed
```

### Integration touchpoints

1. **Onboarding step 8 (businessPicture synthesis)** — ALSO writes initial wiki pages: `concepts/brand-voice.md`, `concepts/customer-praise-themes.md`, `concepts/local-positioning.md`, `entities/competitors/*` (one per Q9 named competitor), `entities/neighborhoods/*` (one per Q10 named neighborhood), `syntheses/business-picture-2026-04-27.md`. Each claim cites `sources/onboarding/...` raw material. Convex `businessPicture` row remains as a fast read-projection for HQ Today screen + skills that don't want to round-trip to OpenClaw; the wiki is source-of-truth.

2. **Cron behaviors (§ 6)** — every behavior that produces a fact runs `wiki_apply` to record it with provenance:
   - `competitor-watcher` → updates `entities/competitors/<slug>.md` with new claims citing each ScrapeCreators sweep
   - `brand-voice-applier` → updates `concepts/brand-voice.md` with refined stylometry citing operator's manual edits
   - `revenue-snapshot-renderer` → writes `syntheses/revenue-snapshot-<date>.md` with claims citing each `serviceJobs` + `crmInvoices` row
   - `seasonal-nudge` → updates `concepts/seasonal-patterns.md` with claims citing prior-year service-mix data
   - `asset-cataloger` → writes `sources/media-assets/<id>.md` with the catalog details + photo URL pointer
   - `review-reply-drafter` → writes `sources/reviews/<id>.md` per inbound review

3. **Citation firewall skill (`maya-service-citation-firewall`)** — REWRITTEN to call `wiki_get` for each factual claim in a draft. If the claim has no supporting wiki entry, fail the firewall. Vastly stronger than text-grep against a context blob. Sprint 3.5 wires this.

4. **Dreaming → wiki promotion** — `memory-core`'s 3 AM dream sweep already promotes session learnings to MEMORY.md. With `bridge` mode, wiki reads those promotions + ingests them into `entities/` / `concepts/` automatically. We don't manage promotion logic ourselves.

5. **HQ surface (Sprint 5)** — Posts > Library tab + Profile > "What Maya knows about your business" surface compiled wiki digests via `wiki_get` over an `lc_maya_service.wiki_get` HTTP endpoint. Operator can audit/correct claims; corrections flow back as new evidence on existing claims (via `wiki_apply`).

6. **Reports (`reports/open-questions.md` + `reports/contradictions.md`)** — surfaced in HQ Today as a "Maya needs your input" prompt. Operator answers; Maya updates the relevant claim's evidence. Self-improving over time.

### Plan-tier gating

Wiki itself is plan-agnostic infrastructure. The PLUGIN is enabled in workspace bundle for all tiers. Read access to the operator-facing "What Maya knows" view in HQ:
- Starter: Today / Profile see the syntheses + concepts pages (read-only)
- Pro: above + can request Maya to refresh specific concepts
- Studio: above + Reports dashboards (open-questions / contradictions / low-confidence) directly visible

### Schema additions (extends § 8)

The wiki itself lives on the Fly machine, not Convex. But Convex needs a thin projection table for HQ-screen reactivity:

| Table | Key fields | Purpose |
|---|---|---|
| `wikiProjections` | businessId, pageType (entity/concept/synthesis/source/report), pageId, title, summary, claimsCount, lastCompiledAt, digestUrl | Fast read-projection for HQ. Maya's `wiki_apply` calls trigger a Convex action that mirrors the page summary + claim count here. |
| `wikiClaims` | businessId, claimId, pageId, text, status, confidence, evidenceCount, updatedAt | Optional projection of compiled `claims.jsonl` for fast cross-page queries (e.g. "show me all claims with confidence < 0.6"). Sprint 3.5 spike decides whether we project all claims or just summaries. |

Indexes: `by_business`, `by_business_and_page_type`, `by_business_and_updated_at`.

### Sprint integration

| Sprint | Wiki work |
|---|---|
| Sprint 1 | Add `memory-wiki` plugin to workspace bundle template; configure `mode: bridge`. Sketch `wikiProjections` schema (defer field finalization to S3.5 spike). |
| Sprint 2 | Onboarding step 8 ALSO writes initial wiki pages alongside `businessPicture` row. Bundle-time `openclaw wiki init` invocation in deploy orchestrator. |
| Sprint 3 | `wiki_apply` calls embedded in: `review-reply-drafter` (writes `sources/reviews/<id>.md`), `gbp-post-optimizer` (cites local-positioning page), `lead-response-nudger` (cites `entities/customers/<lastname>.md` if matched). |
| Sprint 3.5 | **Citation firewall rewritten** to use `wiki_get` instead of text-grep. **Asset cataloger** writes `sources/media-assets/<id>.md`. Decide schema for `wikiClaims` projection. |
| Sprint 4 | CRM job sync writes `sources/jobs/<crm-id>.md` per job; `entities/customers/<lastname>.md` populated from CRM customer records. |
| Sprint 5 | HQ Library tab + Profile "What Maya knows" surface compiled wiki digests. Studio Reports dashboards. |
| Sprint 6 | Voice transcripts written to `sources/voice-calls/<call-id>.md`; Maya can cite voice-call context in subsequent text follow-ups. |
| Sprint 7 | `reports/open-questions.md` surfaced as a Today-screen prompt; operator responses become wiki claim evidence. |

### Test categories (extends § 14)

14. **Wiki claim provenance** — every claim Maya states externally (in a draft, a post, a review reply, a brief) must resolve to an existing wiki claim ID via `wiki_get`. Citation firewall enforces. Test corpus: 50 fixture businesses × 20 sample claims each, assert ≥98% resolve.

15. **Wiki contradiction surfacing** — fixture: same fact stated two different ways across two sources (e.g. operator says "we serve Lincoln Park" but a review mentions a job in Lakeview without operator confirmation). Wiki should flag in `reports/contradictions.md`. Test asserts.

16. **Wiki cross-tenant isolation** — Business A's vault contents are never readable from Business B's Maya runtime. Per-Fly-machine isolation gives us this for free; test asserts via fixture deploy.

### Open `[unverified]`

- **Vault size at scale** — docs don't cite a per-vault size limit. With 30 jobs/wk × 50 reviews/wk × ~1KB per source page over a year, vault grows ~5-15MB per business. Compile-time should be sub-second; verify in Sprint 3 spike.
- **`wiki_apply` rate limits** — does compile happen on every apply, or batched? Affects how often skills can `wiki_apply` without thrashing. Sprint 3 spike confirms.
- **Bridge-mode dreaming integration** — docs say wiki reads memory-core's promoted artifacts; verify exactly which artifacts and on what cadence in a Sprint 3 spike.
- **`memory_search corpus=all` semantics** — when both layers are present, does ranking favor wiki (provenance-rich) over raw memory? Spike confirms.

---

## 10. Voice integration architecture (REVISED 2026-04-27 per OpenClaw docs audit)

**This section was rewritten 2026-04-27 after auditing https://docs.openclaw.ai/plugins/voice-call.** The prior plan called for ElevenLabs Agents as a separate inbound voice front-end with a Convex `elevenlabsBridge.ts` shim. The audit revealed `voice-call` plugin handles BOTH inbound and outbound natively — Twilio Media Streams + ElevenLabs (or Gemini Live, or OpenAI Realtime) as bundled realtime providers — making the shim a redundant reimplementation. The shim is dropped. Voice goes through OpenClaw native.

**Inbound voice path** (the operator's customers → Maya answering → operator notified):

```
Customer dials operator's Twilio number (per-op unique, $1.15/mo)
   │
   ▼
Twilio Voice (PSTN leg) → Twilio Media Streams
   │
   ▼
OpenClaw `voice-call` plugin (inbound, configured per https://docs.openclaw.ai/plugins/voice-call)
   │  provider: "twilio"
   │  realtime: "elevenlabs" (also supports "gemini-live", "openai-realtime")
   │  inboundPolicy: "allowlist"
   │  fromNumber: <operator's Twilio number>
   │
   │  Plugin natively owns: Twilio Media Streams bridging, STT, TTS,
   │  realtime turn-taking, tool-call dispatch, recording, transcripts
   ▼
Maya agent (per-business OpenClaw on Fly machine)
   │  loads workspace SOUL.md + voice-brevity-overlay (workspace MD file, NOT Convex code)
   │  thinkingBudget=0 forced via model-router config in workspace
   ▼
Maya tool calls (`lc_maya_service.lookup_customer`, `lc_maya_service.draft_followup_sms`, etc.)
   ▼
Convex actions — same surface as text-channel Maya
```

**Outbound voice path** (Maya proactively calling the operator — Studio only):

```
Convex scheduler trigger ("Hey Mike, missed-lead worth >$5K just landed")
   │  → fires standing-order from AGENTS.md → Maya emits voice-call tool invocation
   ▼
OpenClaw `voice-call` plugin (outbound, "notify mode" for one-way alerts OR "conversation mode")
   │
   ▼
Twilio outbound + ElevenLabs voice synthesis (same plugin config)
   │
   ▼
Operator's phone (recognizes "Maya — +1 555 …")
```

### Locked decisions (REVISED — operator audit 2026-04-27)

- **OpenClaw version pin: `>= 2026.2.26`** for security/reliability fixes (current pin `2026.4.23` satisfies). Verified during cleanup; no upgrade needed.
- **~~Inbound voice → ElevenLabs Agents (NOT OpenClaw `voice-call`)~~** — DROPPED. Replaced with: **Inbound + outbound voice → OpenClaw `voice-call` plugin** per https://docs.openclaw.ai/plugins/voice-call. Plugin natively bridges Twilio Media Streams to a configurable realtime provider (ElevenLabs, Gemini Live, OpenAI Realtime). The Convex `elevenlabsBridge.ts` shim is **deleted from scope** — its responsibilities (Twilio bridging, STT/TTS, tool-call dispatch) are owned by the plugin.
- **PIN challenge for sensitive CRM operations** — caller-ID is low-assurance; Maya never updates CRM data on a voice call without an SMS PIN sent to operator's known number. Same as before; ours to enforce in Convex action layer.
- **Voice = Studio-only.** 100-min inclusion / mo, $0.15/min overage (covers $0.10 ElevenLabs + $0.014 Twilio + margin).
- **Per-call cost (target):** ~$0.45 per 5-min call. Studio operator at 200 min/mo costs ~$22 voice spend.
- **A2P 10DLC registration** under shared HeyMaya brand campaign (~$10/mo amortized).

### Hard rules

- `voice-call` plugin config force-sets `thinkingBudget: 0` via model-router config in the workspace (not via a Convex shim).
- `SOUL.md` voice-mode overlay block: "Spoken responses ≤20 words unless asked to elaborate." Lives in the workspace MD, loaded by OpenClaw.
- All voice calls recorded; `voice-call` plugin handles transcript capture; we persist transcripts to Convex `voiceCallTranscripts` table (TTL 90 days, GDPR) via plugin's transcript hook.

### `[unverified]` for Sprint 6 spike

- Whether `voice-call` realtime first-token latency hits the sub-1s bar — docs don't cite numerics. Sprint 6 acceptance gate: latency budget regression test asserts p95 < 1s.
- Whether `voice-call` integrates ElevenLabs **Agents** (turn-taking, barge-in, agent-mode) or only ElevenLabs **realtime primitives** — docs name only the realtime primitives. If primitives only, we drive turn-taking from the plugin's own config.
- PIN challenge before any destructive CRM write.

---

## 10.5 Operator content library + asset cataloging

**The product requirement (operator addendum):** every photo, video, and audio note the operator sends to Maya — across iMessage / WhatsApp / SMS / web chat — gets persistently stored, cataloged once at ingest, and remains retrievable + reusable for the life of the account. Maya never has to "re-watch" the same video. When the operator is light on new content, Maya pulls from the library and proposes repurposing.

This sits between § 10 Voice integration and § 11 Channel routing because it is a cross-channel ingest concern that overlaps both: photos arrive on text channels, audio arrives on voice channels, all converge in `mediaAssets`.

### The four contracts the library enforces

1. **Persistent storage in our infrastructure (R2 bucket).** Never just sits in OpenClaw's ephemeral session memory. Every byte is durable from the moment it lands in the R2 bridge (R3 § 2).
2. **One-time multimodal cataloging at ingest.** Gemini 3 Flash analyzes once, writes structured metadata to `mediaAssets`. Re-cataloging only on operator-requested refresh or schema-version-bump migration.
3. **Retrievable + reusable.** Maya can pull from the library at any time. When the operator is content-light, Maya proposes repurposing ("hey, slow week — I've got 12 unposted photos from last month, want me to repurpose the Johnson kitchen reno as a before/after?").
4. **Maya knows EXACTLY what each asset is.** The catalog includes job ID (if CRM-linked), date, location, visual subject, inferred service category, quality assessment, suggested-uses array, and platforms-already-posted-to (so we never re-post the same photo to GBP twice without an explicit refresh).

### Schema (formal — extends § 9)

```ts
mediaAssets: defineTable({
  businessId: v.id("businesses"),
  // R2 storage URL + size + mime
  storageUrl: v.string(),
  storageBytes: v.number(),
  mimeType: v.string(),  // image/jpeg, image/png, video/mp4, audio/m4a, etc.

  // Provenance
  source: v.union(
    v.literal("imessage"),
    v.literal("whatsapp"),
    v.literal("sms"),
    v.literal("web"),
    v.literal("crm-import")
  ),
  receivedAt: v.number(),
  // Optional CRM linkage
  serviceJobId: v.optional(v.id("serviceJobs")),
  serviceCustomerId: v.optional(v.id("serviceCustomers")),

  // Maya's one-time catalog (Gemini multimodal at ingest)
  catalog: v.object({
    primarySubject: v.string(),       // "completed kitchen renovation, modern white cabinets"
    serviceCategory: v.string(),      // "kitchen-remodel" | "hvac-install" | etc.
    visualQuality: v.union(v.literal("excellent"), v.literal("good"), v.literal("fair"), v.literal("poor")),
    framingNotes: v.string(),         // "well-lit, centered, includes context"
    suggestedUses: v.array(v.string()), // ["GBP showcase", "before/after pair candidate", "Instagram reel"]
    pairableWithAssetId: v.optional(v.id("mediaAssets")), // before/after detection
    captionDraft: v.optional(v.string()),  // pre-drafted caption for likely use
    catalogedAt: v.number(),
    catalogModel: v.string(),          // "gemini-3-flash-preview"
    catalogCostUsd: v.number(),
  }),

  // Usage tracking — every time Maya posts the asset, append a record
  usageHistory: v.array(v.object({
    platform: v.union(v.literal("gbp"), v.literal("facebook"), v.literal("instagram"), v.literal("tiktok")),
    postId: v.optional(v.string()),
    postedAt: v.number(),
  })),

  // Lifecycle
  archivedAt: v.optional(v.number()),  // operator-soft-deleted
  expiresAt: v.optional(v.number()),    // GDPR / retention policy
})
  .index("by_business", ["businessId"])
  .index("by_business_and_received_at", ["businessId", "receivedAt"])
  .index("by_business_and_service_category", ["businessId", "catalog.serviceCategory"])
  .index("by_service_job", ["serviceJobId"])
```

### Ingest pipeline (cataloging)

This is **Behavior #16** in § 6 (Asset ingestion + cataloging). Detail:

```
Inbound media on any channel
   │
   ▼
R2 attachment bridge (R3 § 2)
   │  - HEIC → JPEG conversion
   │  - 5MB cap (8MB OpenClaw default; we hold 5MB margin)
   │  - 1s debounce groups multi-image batches
   ▼
Hash dedupe (sha256 of bytes, scoped per businessId)
   │
   ├─ exists? → link to existing mediaAssets row, NO re-catalog cost, return
   │
   ▼ (new)
Insert mediaAssets row with catalog="[uncataloged]" placeholder
   │
   ▼
Enqueue maya-service-asset-cataloger skill (rate-limited queue)
   │  - Gemini 3 Flash multimodal call via Wave 4 worker (extended for stills + audio)
   │  - Cost ~$0.02/photo, ~$0.10/30s video, ~$0.40/5min video
   ▼
Update mediaAssets.catalog with structured output
   │
   ▼
Emit Convex realtime → Library tab on Posts screen updates
```

**Idempotency.** Hash (sha256) the bytes per business. Same hash = link to existing row, do not re-catalog.
**Failure mode.** If Gemini call fails: retain `catalog.primarySubject = "[uncataloged]"`, queue retry (exponential backoff, max 3 attempts), surface uncataloged count in Library tab. Never lose the file.
**Rate limiting.** Cataloger queue rate-limited to **5 concurrent jobs per business** so a 50-photo flood doesn't burn $1 in 10 seconds. Excess queued, processed in-order.

### Retrieval / reuse flow

This is the `maya-service-content-rejuvenator` skill (§ 7).

```
Cron job #6 (Sundays 2pm op-tz, content rejuvenation, Pro+):
   │
   ▼
Query mediaAssets by_business + filter:
   - catalog.visualQuality in ["excellent", "good"]
   - usageHistory.length === 0 OR oldest-platform-post >60d ago
   - archivedAt IS NULL
   ▼
Rank top 5 by (quality × recency × CRM-linkage strength)
   ▼
For each: draft suggestedAction + captionDraft tuned to current platform gaps
   ▼
Surface 3 options to operator (text + Library tab)
   ▼
Operator approves → Maya posts → append usageHistory record
```

When operator-initiated ("Maya, find me a good furnace photo"):
- Skill receives natural-language query
- Convex query against `by_business_and_service_category` index + LLM-rerank
- Maya returns top 3 + reasoning + ready-to-post draft

### Library surface in Company HQ

A dedicated **Library** tab on the Posts screen (§ 12). Renders:
- Recent assets (last 30 days) with catalog metadata visible (thumbnail + primarySubject + visualQuality badge + serviceCategory chip + usageHistory count)
- Filter: service category, visual quality, posting status (used/unused/stale), source channel, has-CRM-linkage
- "Maya's recommended for next post" surface (rejuvenator output)
- Per-asset detail panel: full catalog, usage history, manual edit ("Maya thought this was a kitchen remodel, it's actually a bathroom" — operator override is sacred and re-cataloging is gated to operator-confirmed only)
- Operator-archive action (soft delete, sets `archivedAt`)

### Test categories (formal — extends § 14)

| Category | Specifics |
|---|---|
| Cross-tenant | Business A's `mediaAssets` never visible to Business B (every query gates on `businessId`) |
| Adversarial | (a) Operator sends 50 photos in 10 seconds → cataloger queue rate-limit holds; no $1-burn; (b) Corrupted photo bytes → graceful skip, surface uncataloged, no crash; (c) Oversized video (>500MB) → R2 bridge rejects with friendly "send a shorter clip" message |
| Idempotency | Same bytes hashed by business → links to existing row; cost telemetry shows zero re-catalog charges |
| Catalog quality | Synthetic test set of 20 service-business photos with known correct primarySubject + serviceCategory; assert Maya's catalog matches expected at **>85% accuracy** before Sprint 3.5 ships |
| Lifecycle | Archived assets excluded from rejuvenator; expiresAt-past assets purged; usageHistory append is idempotent on (assetId, platform, postId) |

### Cost envelope contribution (extends § 3)

Per-operator monthly cataloging cost, steady-state:
- ~80 photos/mo × $0.02 = $1.60
- ~10 short videos/mo × $0.10 = $1.00
- ~2 long videos/mo × $0.40 = $0.80
- **Total: ~$3.40/op/mo cataloging**

Folded into the existing § 3 cost envelope; Studio's $44 infra estimate already absorbs this.

---

## 11. Channel routing per operator (REVISED 2026-04-27 per OpenClaw docs audit)

OpenClaw native channel plugins handle the underlying mechanics for iMessage / WhatsApp / voice; Convex layer handles per-intent routing + SMS (no native SMS channel exists in OpenClaw).

### Three address namespaces (clarified per audit)

A per-business Maya talks across multiple addressing namespaces — a single phone number does NOT serve all channels. Operator onboarding configures all three:

| Namespace | Identity | Channel(s) served | Provisioning |
|---|---|---|---|
| **Twilio number** (per-op unique, $1.15/mo) | A US local phone number | SMS + MMS + voice (Twilio Voice consumed by `voice-call` plugin as provider) | We provision via Twilio API (`provisionNumber.ts`); ours to manage |
| **Apple ID on BlueBubbles host** | Operator's existing Apple ID | iMessage | Operator self-installs the BlueBubbles macOS helper from https://bluebubbles.app/install; we configure `channels.bluebubbles.password/guid` + `mediaMaxMb: 5` + `mediaLocalRoots`. **Native OpenClaw channel** per https://docs.openclaw.ai/channels/bluebubbles |
| **WhatsApp account** | Operator's WhatsApp account | WhatsApp Business | Operator pairs via QR code from `openclaw channels login --channel whatsapp` (OpenClaw native pairing flow) |

### Per-operator channel state

Each operator has, at most:
- web chat session (always available)
- iMessage (OpenClaw `bluebubbles` plugin paired to operator's Apple ID; attachments delivered natively)
- WhatsApp (OpenClaw native pairing via QR)
- SMS via Twilio number (always provisioned; SMS/MMS webhooks → Convex → forwarded as Maya inbound message — no native SMS channel in OpenClaw)
- voice via OpenClaw `voice-call` plugin (Twilio provider, ElevenLabs realtime; Studio only)

### Per-intent routing (lives in Convex outbound layer)

```
intent: routine_update     → SMS (cheapest, async)
intent: quick_approval     → iMessage if iPhone, else WhatsApp/SMS
intent: photo_heavy        → iMessage / WhatsApp (rich media)
intent: voice_required     → outbound voice call (Studio-only)
intent: review_draft       → channel of last interaction
intent: revenue_snapshot   → primary + Today screen surface
```

### Same Maya identity, channel-aware persistence

`session.identityLinks` (R3 § 8) links iMessage / SMS / voice / web identities to the same underlying session — operator can text from truck → drive home → continue on web HQ without context loss.

### Photo handling per channel (REVISED 2026-04-27 per OpenClaw docs audit)

OpenClaw's `bluebubbles` channel plugin natively handles iMessage attachment delivery, including its own SSRF / race / HEIC / mediaLocalRoots mitigations (configurable debounce, `mediaLocalRoots` allowlist, mandatory webhook auth). The earlier plan's R2 attachment bridge sat IN-LINE in front of OpenClaw to mitigate those issues; it is now repositioned as an ASYNC SIDECAR MIRROR for durability + the multimodal cataloger pipeline (§ 10.5). Bytes still land in R2 either way — but the framing is "we copy what OpenClaw delivers" not "we proxy because OpenClaw can't be trusted."

| Channel | Inbound photo path |
|---|---|
| iMessage | OpenClaw `bluebubbles` plugin (native) → Maya context. Async sidecar: bytes mirrored to R2 (`convex/photoBridge/`) + cataloger queue + `mediaAssets` row per § 10.5 |
| WhatsApp | OpenClaw native (Baileys) → Maya context. Same async R2 sidecar mirror. |
| SMS (MMS) | Twilio MMS webhook → Convex `/api/webhooks/twilio/sms` → forwarded as Maya inbound message + R2 mirror + cataloger enqueue (no native SMS channel in OpenClaw) |
| Web | File upload directly to R2 (operator uploads via Posts > Library) |

5MB cap enforced at R2 ingest (under OpenClaw `mediaMaxMb: 8` default).
OpenClaw `bluebubbles` plugin handles the 1-second debounce for multi-image batches (configurable in plugin config; we set to align).

### Operator can mid-switch

Common pattern: operator texts Maya from truck about a job → drives home → opens web HQ to approve drafts → end-of-day voice call summary. All same Maya, same context, no re-explanation needed.

### Plan-tier × channel matrix

| Channel | Starter | Pro | Studio |
|---|---|---|---|
| Web HQ | ✓ | ✓ | ✓ |
| SMS | ✓ | ✓ | ✓ |
| iMessage | — | ✓ | ✓ |
| WhatsApp | — | ✓ | ✓ |
| Voice (inbound) | — | — | ✓ |
| Voice (outbound) | — | — | ✓ |

Enforced server-side via `planFeaturesService(business).allowedChannels[]`.

---

## § 12.5 — Proactive Social Outreach + Paid Ad Management (v0 + Phase 2)

**Architectural posture (locked, operator-clarified):** for *everything* in this section — social discovery, group monitoring, ad creation, ad optimization, conversion tracking, video polishing — **HeyMaya is the orchestration layer over third-party services that already do these jobs.** We do not build a Meta Ads management platform. We do not build a Google Ads optimizer. We do not build a Facebook Group scraper. The HeyMaya value-add is the agent (Maya) + operator UX (text-thread-first, sub-tap approvals) + cross-vendor coordination (one Maya, many vendors, single coherent voice). Where a category has no acceptable third-party (e.g. group POSTING into arbitrary groups), v0 ships the honest constraint, not a workaround.

**Zernio as THE social layer (locked — extends + supersedes R1 § Tier 1 + § 3 stack table):** Per [Zernio.com](https://zernio.com), [Zernio agents page](https://zernio.com/agents), [Social Media MCP blog](https://zernio.com/blog/social-media-mcp), and [Zernio MCP docs](https://docs.zernio.com/resources/mcp), Zernio (formerly Late / getlate.dev) ships a **production MCP server with 280+ tools** covering posts, scheduling, comments, DMs, analytics, **and now ads** ([Zernio Ads API](https://zernio.com/blog/social-media-ads-api)) across 14+ platforms including Google Business Profile. Locked decisions:
- **The Zernio MCP server plugs directly into Maya's OpenClaw runtime** as a tool layer. OpenClaw natively supports MCP servers, so Maya gains all 280+ tools without us writing per-platform Convex integration code. This was not the architecture R1 sketched (R1 was pre-MCP-server-launch); we're upgrading on better information.
- **Drop the Composio FB/IG integration entirely for the service product.** Zernio covers both natively. Composio stays for non-social: Gmail, Calendar, Stripe, Apollo, Hunter (creator product also unaffected).
- **Direct platform APIs (GBP, Meta Graph) become FALLBACKS only**, fired only if Zernio is down OR a specific feature isn't covered.
- **The single open question for v0:** Zernio's review-REPLY depth (not just monitoring). Per [getlate Google Business Reviews API blog](https://getlate.dev/blog/google-business-reviews-api), [Zernio Google Business platform docs](https://docs.zernio.com/platforms/google-business), [Zernio reviews list endpoint](https://docs.getlate.dev/reviews/list-inbox-reviews), Zernio claims `late.reviews.reply({reviewId, message})` works end-to-end with token management + webhooks. R1 marked this `[unverified]`. **Sprint 0 / 1 spike (1 day, Zernio Build tier $19/mo):** confirm review-reply API works against a real test GBP. If confirmed, drop direct GBP API entirely from the v0 stack; if shallow, keep direct GBP API as the review-reply-only fallback. This collapses the § 3 "GBP review reply = direct Google API" decision into a single Zernio call IF the spike is green.

**Updated stack diagram delta** (replaces parts of § 3 stack diagram for the social layer):

```
   ┌────────────────────────┐                ┌──────────────────────────┐
   │  OPENCLAW 2026.2.26+   │                │   CONVEX (heymaya-       │
   │  (per-op Fly machine)  │◄──────────────►│    service-v0)           │
   │  - SOUL.md USER.md     │                │   ...                    │
   │  - jobs.json (cron)    │                │                          │
   │  - skills/maya-svc-*   │                │                          │
   │  - ZERNIO MCP server   │ ◄── 280+ tools │                          │
   │    (posts, schedules,  │                │                          │
   │     comments, DMs,     │                │                          │
   │     analytics, ads,    │                │                          │
   │     GBP reviews)       │                │                          │
   └────┬───────────────────┘                └──────┬───────────────────┘
        │                                           │
        ▼                                           ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  ZERNIO API (15 platforms incl GBP — primary)                      │
   │  → Direct GBP API + Cloud Pub/Sub  (FALLBACK ONLY if Zernio gap)   │
   │  → Direct Meta Graph API           (FALLBACK ONLY at >500 ops)     │
   └────────────────────────────────────────────────────────────────────┘
```

This section sits between channel routing (§ 11) and Company HQ (§ 12) because it touches both: outbound *discovery* of leads (social) and outbound *paid acquisition* (Meta + Google + LSA). It is the most-asked-for-by-operators feature category that *also* contains the most-misunderstood feasibility traps. We separate what ships in v0 (a small, honest, high-leverage piece) from what is explicitly Phase 2 (a multi-sprint module that touches real money + real liability).

### 12.5.1 — What's in v0 (ships with the rest of the service product)

**Facebook Group monitoring + operator-approved drafts** — the high-value, low-effort piece. This is a single new cron behavior + one custom skill + a thin schema addition. It does NOT touch Meta's deprecated Groups API, does NOT auto-post anywhere, does NOT spend any ad money.

#### The honest constraint up front

Operators will ask, repeatedly: *"Can Maya post in 50 local 'I need a plumber' Facebook groups for me?"* The answer is **no — not via API, not via any compliant automation path.** Meta deprecated the Groups API in April 2024 ([TechCrunch coverage](https://techcrunch.com/2024/02/05/meta-cuts-off-third-party-access-to-facebook-groups-leaving-developers-and-customers-in-disarray/), [SocialRails 2026 update](https://socialrails.com/blog/how-to-post-to-multiple-facebook-groups), [Sprinklr deprecation notice](https://www.sprinklr.com/help/articles/getting-started/meta-deprecates-facebook-groups-api/66229eb25f9dd9599d632712)). As of 2026, no third-party tool — Buffer, Hootsuite, Sprinklr, Zernio, anyone — can publish into arbitrary Facebook Groups via API. Operators who claim otherwise are using browser-extension scrapers that violate Meta's TOS, get accounts flagged in days, and expose the operator to immediate ban risk in exactly the high-trust local groups that matter. Maya does not go there.

What we CAN do — and what is genuinely high-leverage — is **monitor + draft**. Maya watches public group activity (where the operator is already a member), spots the "I need a plumber in 30075" pattern, and drops a fully-drafted reply into the operator's text thread within minutes. The operator opens Facebook on their phone, pastes, edits one word, sends. Maya never touches Meta's API for groups.

#### v0 scope

**Discovery (Brave-search-seeded):** onboarding adds a one-tap step where the operator pastes URLs of groups they're already a member of. Maya seeds suggestions via Brave Search ([Brave API pricing 2026](https://api-dashboard.search.brave.com/documentation/pricing): $5 per 1k requests, ~$0.005/query) using the operator's service area + niche (`site:facebook.com/groups "Sandy Springs" OR "30075" plumbing OR HVAC`). Returns 10-30 candidates; operator confirms/rejects. Stored as `monitoredFbGroups` rows scoped to `businessId`. No OAuth, no Meta connection — public URLs the operator voluntarily flagged. Brave free credit ($5/mo) covers ~1,000 discovery queries; envelope ~$0.05/op/mo.

**Monitoring (read-only polling):** new cron **behavior #17** (this addendum extends § 6 to 17 behaviors): `local-group-lead-watcher`, cadence every 30 min during operator's active hours via Brave-narrowed-to-group-URL queries. (The [Meta Content Library — Facebook Groups](https://developers.facebook.com/docs/content-library-and-api/content-library-api/guides/fb-groups/) is research-program-only — not viable for v0.) Pattern detection: regex + LLM-classify for intent signals (`"looking for"`, `"anyone know a good"`, `"emergency"` + service-type keywords from `businessPicture`). Hot-lead threshold: post <2h old, intent keyword present, geographic match against operator's service-area polygon.

**Drafting:** new custom skill `maya-service-fb-group-reply-drafter` (added to § 7). Outputs a 2-4 sentence reply draft + one-line "why this lead is worth it" cite + the literal group URL. Maya pings via primary channel: *"Hot lead in 'Sandy Springs Neighbors' — Sarah K asked for an HVAC referral 14 min ago. Drafted reply, says you've done 4 jobs in 30075 this year. Tap to copy."* Operator copy-pastes manually; we log paste-vs-not via a "Mark as posted" tap-back.

**Third-party group-monitoring vendors checked, none usable:** [PostPilot AI](https://app.postpilotai.io/) is a posting platform; [ReplyPilot](https://replypilot.app/) is a Chrome extension for the operator's own activity (not multi-tenant orchestratable); [Respond.io](https://respond.io/) unifies messenger inboxes but no Group monitoring; "Group Boss" / "Engaged.ai" are browser-extension-class TOS-grey. Verdict: no legitimate third-party API exists. **Brave Search is the third party** for discovery + monitoring (published search index, same legal class as Google's crawler); Maya is the drafting layer; operator-pastes-manually is the only TOS-clean shape.

**Optional sub-feature — Page-into-group posting (Pro+ only, where allowed):** if the operator's FB Page is a group member AND the group admin enabled Page-as-member posting AND the operator connected their Page via Zernio: Maya can draft + queue a Page-as-member post (uses Pages publishing API, NOT deprecated Groups API). Per [SocialRails 2026](https://socialrails.com/blog/how-to-post-to-multiple-facebook-groups), realistically ~5-15% of local groups allow this. Bonus where available, not primary.

#### Schema additions (extends § 9)

Two new tables: **`monitoredFbGroups`** (businessId, groupUrl, groupName, discoverySource [operator-added | brave-suggested], pageCanPost, monitoringEnabled, lastSweepAt, approxMemberCount, geographicMatch) indexed `by_business` and `by_business_and_monitoring`; **`fbGroupLeads`** (businessId, monitoredGroupId, externalPostId for dedupe, postBody, posterDisplayName, detectedIntent, geographicSignal, draftReply, status [detected | drafted | notified | operator-marked-posted | operator-skipped | expired], detectedAt, notifiedAt, operatorActionAt) indexed `by_business_and_status` and `by_business_and_detected`.

#### Plan-tier gating

| Capability | Starter | Pro | Studio |
|---|---|---|---|
| Group monitoring (read-only) | up to 5 groups | up to 25 | up to 100 |
| Maya drafts replies | manual queue | auto-draft + push | auto-draft + push + multi-location aggregation |
| Page-into-group posting (where allowed) | — | ✓ | ✓ |
| Brave-suggested group discovery | — | ✓ | ✓ |

Enforced via `planFeaturesService(business).fbGroupLimits.maxMonitored`. Server-side, fail-closed (parallel to § 11 channel matrix).

#### Test categories (extends § 14)

Cross-tenant (A's `monitoredFbGroups`/`fbGroupLeads` never visible to B); plan-tier (Starter blocked at 6th group; auto-push suppressed on Starter); adversarial (Brave 0-results graceful; private-group → monitoring auto-flipped false; spam/honeypot post → low-confidence + no draft; intent false-positive → confidence threshold auto-raises after 5 operator-skips); rate-limit (100 Brave sweeps/business/day cap — misconfigured cadence can't burn $50); **TOS hygiene** (static check asserts NO outbound call to Meta Graph `groups/` endpoint — defense in depth against future contributors wiring the deprecated path).

#### Expected operator workflow

Mike (HVAC, 1 truck, 30075, Pro): onboarding pastes 8 group URLs, Brave suggests 11 more, he confirms 7 (total 15 monitored). Hot lead detected in "Roswell Neighbors" at 11:42am ("AC died, need today, north Roswell"). Maya texts at 11:43am with 3-sentence draft + group URL. Mike copies, opens FB, pastes, edits one word, posts at 11:44am, taps "Marked as posted" link. Evening recap: "Posted in 1 group today, drafted 2 you skipped." High-leverage (one good lead/week > the entire Pro subscription), no deprecated APIs, no TOS-grey-area.

#### What v0 does NOT do (locked)

No auto-posting into groups (not via API — deprecated; not via headless browser — TOS + ban risk; not via paid scraping — operator-side TOS exposure). No DM-ing group members. No reading non-public group content. No competing-business defamation or copy-cat replies.

---

### 12.5.2 — Phase 2 / v1 modules (NOT in v0) — third-party-wrapped

These are explicitly deferred. Each is a 2-3 sprint module of its own. Each touches real money or real legal exposure that v0 should not carry.

**Build posture for every module:** HeyMaya does NOT build the underlying ad platform. We pick a vendor that already runs the optimization + spend + conversion-tracking pipelines + reporting, then Maya orchestrates it. The vendor is the engine; Maya is the driver-in-the-text-thread. Operator can use this section as a roadmap for what to *apply for + sign up for now* so Phase 2 isn't gated on multi-week approvals.

#### Module A — Meta Ads management (third-party-wrapped, 2 sprints)

**What ships:** Maya orchestrates Meta Ads on the operator's behalf. Maya drafts campaign briefs in the operator's text thread ("you closed 14 jobs this week, I want to allocate $50/day to a Sandy-Springs awareness ad targeting homeowners 30-55, here's the creative" → operator one-tap-approves → vendor executes). Vendor handles creative variation, A/B testing, budget rebalancing, conversion tracking. Maya reads results back, reports in morning brief, proposes next week's adjustments.

**Vendor selection — Zernio Ads API is now the primary candidate** because (a) we've already plugged Zernio's MCP server into Maya's runtime for organic social, so adding Ads is zero new integration cost and (b) Zernio just shipped Ads as the fourth pillar with all endpoints exposed via the MCP server ([Zernio Ads API blog](https://zernio.com/blog/social-media-ads-api), [Social Media Ads page](https://zernio.com/social-media-ads)).

| Vendor | API quality | Agency-friendly | Service-business fit | Verdict |
|---|---|---|---|---|
| **Zernio Ads API** ([Zernio Ads](https://zernio.com/social-media-ads), [Zernio Ads blog](https://zernio.com/blog/social-media-ads-api)) | Same MCP server we already use for organic; boost organic posts as paid ads + standalone ads with custom creative; cross-platform (Meta + LinkedIn + others) | Yes — built for AI agents, multi-tenant by default | Excellent — single MCP toolset across organic + paid; no separate integration | **Recommended primary IF Sprint 5-6 spike confirms creative-test depth + per-customer ad-account linking model + spend caps.** |
| **Revealbot** ([AdStellar 2026](https://www.adstellar.ai/blog/best-meta-ads-management-platform), [agency guide](https://www.adstellar.ai/blog/facebook-ad-automation-software-for-agencies)) | Strong rule-engine API, 30+ conditions/actions, automation sequences | Yes — multi-account agency tier | Excellent — bid-by-CPA + auto-pause map cleanly to service-business CPL | **Backup primary IF Zernio Ads depth is shallow on creative testing or rule-engine triggers.** Sprint 5-6 spike compares the two. |
| **Smartly.io** ([Smartly.io](https://www.smartly.io/)) | Enterprise; cross-channel; dynamic creative optimization | Enterprise-only | Overkill for 1-15-truck operators | **Skip for v1.** |
| **AdEspresso** | A/B-test focused; weaker automation | Agency tier exists | Shallow automation | **Skip.** |
| **Composio Meta Ads MCP** | Read-confirmed; write `[unverified]`; redundant with Zernio MCP | AI-agent-oriented | Doesn't add anything Zernio doesn't already give us | **Skip — Zernio MCP supersedes.** |
| **Direct Meta Marketing API** | Max control, max work, App Review burden | We absorb everything | Same as everyone | **Skip per locked posture.** |

**Default: Zernio Ads is the v1 primary; Revealbot is the fallback.** Either way, the registered Meta partner relationship is the vendor's, not ours — **this eliminates the 4-8 week Meta App Review blocker entirely.** Sprint 5-6 spike picks the winner.

**What HeyMaya owns regardless of vendor** (vendor-invisible to operator — white-label): Maya's service-business-aware prompts (HVAC tone, plumbing CTA, electrical credentials), operator approval flow (text → web HQ → one-tap), per-business spend caps + anomaly detection (defense in depth on top of vendor's), cross-vendor conversion attribution (Meta data + Module B Google data → single per-operator CAC view), Convex audit log of every Maya→vendor mutation.

**Conversion tracking:** vendor wires Meta Pixel + CAPI through its setup wizard. Maya fans CRM `job.completed` → vendor offline events → Meta CAPI. Twilio number from § 10 reused for call tracking — no CallRail needed.

**Real-money safeguards (ours):** per-business daily / monthly / per-launch spend caps in Convex, enforced *before* any Maya→vendor call. PIN-confirm for any single-campaign budget >$1,000. Anomaly detection (spend velocity >3× rolling 7-day baseline) auto-pauses + pings operator.

**Legal exposure (ours, regardless of vendor):** E&O insurance required before Module A ships (~$2,500-$8,000/yr per [InsuranceBee marketing E&O](https://www.insurancebee.com/marketing-insurance), [Berxi Media & Marketing E&O](https://www.berxi.com/industries/media-marketing-insurance/)). Customer agreement: explicit ad-spend authorization, liability cap, sub-processor disclosure (vendor named).

#### Module B — Google Ads (Search + Performance Max) management (third-party-wrapped, 2 sprints)

**What ships:** Maya orchestrates a Google-Ads-management vendor (recommend **Optmyzr**, see selection below) for operator's Search + Performance Max campaigns on local service keywords. Same operator-approval-gated, capped-spend posture as Module A.

**Vendor selection:** **Optmyzr is the v1 primary** ([Optmyzr Partner Services](https://www.optmyzr.com/services/partner-services/), [Optmyzr best-tools roundup](https://www.optmyzr.com/blog/best-google-ads-tools/), [groas 2026 ranking](https://groas.ai/post/the-ai-tools-reshaping-google-ads-in-2026-the-definitive-ranking)) — mature rule-engine + scripts + budget monitoring with an *explicit white-label partner program* ("managed under your agency's brand"). Adzooma ([groas 2026 review](https://groas.ai/post/adzooma-review-2026-is-it-worth-it-honest-breakdown-better-alternatives)) skipped as primary (3-4/10 performance in 2026 reviews); free tier kept as internal test-fixture. Marin = enterprise overkill. Direct Google Ads API skipped per locked posture.

**Locked: Optmyzr is the v1 primary** with explicit white-label partner status. Same pattern as Module A — Optmyzr holds the Google Ads developer-token relationship; operator's Google Ads account links via Optmyzr's OAuth. **We do not file for Google Ads API Standard Access ourselves.** The $1,000-historical-spend gate, the developer-token application, the Feb-2026 backlog ([PPC News](https://ppcnewsfeed.com/ppc-news/2026-02/high-demand-slows-google-ads-api-access-approvals/)) — all absorbed by Optmyzr.

Maya owns the same shape as Module A: brief drafting, operator approval, spend caps, cross-vendor attribution, white-label UX. Optmyzr handles Google Tag + offline-conversion wiring; Maya fans CRM `job.completed` into Optmyzr's offline-conversion endpoint. Twilio reused for call tracking.

**Replaces what for the operator:** per [ClicksGeek Performance Marketing Agency Pricing 2026](https://clicksgeek.com/performance-marketing-agency-pricing/) + [Marketing Agency Monthly Retainer Cost 2026](https://clicksgeek.com/marketing-agency-monthly-retainer-cost/), an operator spending $2K-$5K/mo on Google Ads pays a human agency $1,000-$2,500/mo OR 10-20% of spend. Maya + Optmyzr at Marketing Pro pricing (§ 12.5.3) replaces both the agency's labor AND its tooling.

#### Module C — Local Service Ads (LSA) management (third-party-wrapped, 2 sprints + per-customer guided certification)

**What ships:** Maya orchestrates **Hatch's LSA integration** (or equivalent — see selection) for the operator's LSA campaign management + lead-quality dispute filings + lead-response automation. The Google-Verified-badge gate is operator-side certification work that Maya guides (it cannot be outsourced — Google requires per-trade per-state license/insurance from the operator directly).

**Vendor selection:** **Hatch is the v1 primary** ([Hatch LSA integration docs](https://www.usehatchapp.com/knowledge/google-lsa), [Hatch migrate guide](https://www.usehatchapp.com/migrate/knowledge/google-lsa), [Hatch lead-rating blog](http://hs.usehatchapp.com/blog/google-lsa-rate-a-lead)) — Hatch holds the LSA partner relationship, exposes `ProvideLeadFeedback()` dispute UI, lead-rating, V2 real-time lead delivery (with 15-min sync ceiling per Google's LSA-API limit — Google-side limitation, not improvable). Service Direct (pay-per-lead aggregator) and Direct Google Local Services API ([overview](https://developers.google.com/local-services-ads/guides/local-services-api-overview), [LSA campaigns in Google Ads API](https://developers.google.com/google-ads/api/docs/campaigns/local-service-campaigns)) both skipped per locked third-party posture.

**The Google Verified gate (per-customer, NOT vendor-absorbable):** per [Google's qualification](https://support.google.com/localservices/answer/6230381), [Google Verified guide](https://adamgrubbmedia.com/google-verified-badge/), [Plumber LSA 2026](https://rankmetop.net/blog/plumber-google-local-service-ads/): every operator must pass Google's screening — business registration, background checks, state-level trade license, $1M+ general liability insurance, per-trade workers comp. Plumbing / HVAC / electrical = "high-risk trade", strictest tier. Per-trade per-state (multi-location = multiple filings). Annual renewal. October 2025: Google retired separate Guarantee + Screened badges, unified to single Google Verified blue checkmark, Money Back Guarantee discontinued for new bookings Dec 7 2025 (small operator-cost reduction we surface).

**Module C ships in two halves:** (1) **Maya-orchestrated, Hatch-wrapped:** lead-quality dispute filing (Maya identifies edge-case spam Google's auto-credit AI missed; Hatch executes), profile optimization (Maya rewrites services list weekly based on Hatch's lead-quality telemetry), bid-rank tuning (Maya adjusts weekly target budget in Hatch based on lead-cost vs ticket-size). (2) **Guided onboarding wizard** at `app/(business)/marketing/lsa-certification/page.tsx`: walks operator through doc collection (license PDF upload via § 10.5 media bridge, COI via Composio email-to-broker template, background-check authorization signature), monitors Google screening status via Hatch, surfaces blockers in real-time, Maya nudges stuck steps via primary channel.

**Lead-response automation (Maya owns this, not Hatch — LSA-specific killer feature):** missed-call-to-lead is LSA's #1 ranking-decay signal. Maya answers (Studio voice tier, § 10) → captures intent → SMS-backs operator within seconds → operator confirms or Maya schedules. Hatch syncs lead status every 15 min; Maya's voice + immediate SMS bridges the polling gap. Every recovered missed call = $200-$2,000 job → bid-rank stays high → more leads at lower CPL.

#### Module D — Cross-platform ad orchestration (super-feature, optional, post-A/B/C)

After A+B+C have 30+ days of per-operator conversion data, Maya takes a single monthly marketing budget and allocates dynamically across Zernio Ads / Revealbot (Meta) + Optmyzr (Google) + Hatch (LSA) based on observed CAC + LTV per channel. Operator approves the new allocation weekly in morning brief: *"shift $400 from Meta to LSA — LSA CPL dropped 22% this week, Meta CTR is flat."* Maya reads each vendor's reporting API, writes unified per-operator CAC view, proposes rebalance, vendor APIs execute on operator approval. Cherry on top — requires every per-vendor safeguard solid first.

---

### 12.5.3 — Pricing implications

Service-business marketing agencies typically charge ([ClicksGeek 2026 guide](https://clicksgeek.com/marketing-agency-fees-explained/), [HVAC Marketing Xperts](https://hvacmarketingxperts.com/hvac-advertising-cost/)):

- **Retainer:** $1,000-$3,000/mo for a small service business
- **Plus 10-20% of ad spend** on top
- **Setup fees:** $500-$2,500 one-time

Maya at $199/mo Studio is already 5-15× cheaper than the bottom of that range *before* ad management. Bundling ad management into Studio at no upcharge would mean competing with $2,500/mo agencies at $199 — economically reckless given E&O + per-customer marginal cost (in fact, Studio's ~$30/mo infra envelope can't absorb the additional $20-40/mo of ad-vendor pass-through + audit-log + CAPI fan-out).

**Recommendation: ad management ships as a separate add-on tier on top of Studio, NOT bundled.**

| Product | Monthly | Annual | Includes |
|---|---|---|---|
| **Studio** (locked) | $199 | $1,999 | Everything in § 3, NO ad management |
| **Marketing Pro add-on** | **+$299/mo** (so $498/mo total with Studio) | $2,999 | All of Module A + B + C; up to $5K/mo total managed ad spend across channels included |
| **Marketing Pro overage** | **5% of managed ad spend above $5K/mo** | — | Replaces the agency 10-20% model with a half-the-rate equivalent |
| **Marketing Pro setup** | **$0** (vs agency $500-$2,500) | — | Wedge against agency setup-fee gating |

**Why $299 add-on (not $499 like the prior pricing draft):** the new compressed Studio at $199 anchors the entire package lower; a $499 add-on would create a 2.5× jump from base that operators would balk at. $299 keeps the all-in Marketing-Pro customer at $498/mo — still 4-5× cheaper than the agency floor, still margin-positive after E&O + vendor pass-through.

**Why not bundle into Studio:** E&O ($3-8K/yr fixed) + per-customer marginal vendor pass-through ($20-40/mo) means margin-negative at $199 alone for ad-managed customers within months. Customers who don't run paid ads (~40-60% of service operators per [ClicksGeek 2026](https://clicksgeek.com/marketing-agency-fees-explained/)) shouldn't subsidize the ones who do. The $199 → $498 jump is also a useful filter: ad-curious operators self-select.

**Why flat ($299 add-on) + small overage (5% above $5K), NOT pure percentage-of-spend (10-20%):** the agency-standard 10-20% model creates a perverse incentive (agency makes more by spending more). Flat fee aligns Maya's incentive with the operator's. Small overage above $5K covers our marginal cost (more API calls, more CAPI events, more audit logging) without becoming the percentage-trap. At $10K spend: operator pays $498 + 5% × $5K = $748 with HeyMaya vs $1K-$2K agency. At $20K: $498 + 5% × $15K = $1,248 vs $2K-$4K agency. Always cheaper.

**Liability cap:** customer agreement caps HeyMaya's liability at the lesser of (a) Marketing Pro fees paid in trailing 12 months OR (b) actual demonstrable damages from gross negligence. Operator separately authorizes ad spend up to configured monthly cap.

---

### 12.5.4 — Operator-required items for v0 (Facebook Group monitor)

Add to § 17:

1. **Brave Search API account** — ~$5-15/mo at v0 scale; jump to ~$50-100/mo at 100 ops; covers all group discovery + monitoring sweeps. Free credit ($5/mo) is plenty during dev.
2. **No additional Meta permissions needed for v0** — we deliberately do not connect any Meta API surface for the group monitor, so no App Review, no Business Verification, no compliance bar to clear before shipping.
3. **TOS / privacy review** — confirm with counsel that read-only monitoring of public group content via Brave (search-engine-class crawler) is distinguishable from headless-browser scraping. Should be — Brave is a published search index, same legal class as Google's. Operator action: 1-hour counsel review before Sprint 3 ships.
4. **Operator agreement language addition** — disclosure that Maya monitors public Facebook content the operator has voluntarily flagged + drafts replies but never auto-posts.

---

### 12.5.5 — Operator-required items to start NOW for Phase 2

Reflects the third-party-wrapped posture: we are NOT applying for Meta App Review or Google Ads developer token ourselves — Revealbot / Optmyzr / Hatch hold those relationships. Operator action items collapse meaningfully.

1. **Vendor evaluation calls — Sprint 5-6 of v0:**
   - **Zernio Ads tier sales conversation** (PRIMARY for Module A) — confirm creative-test depth, per-operator ad-account-link OAuth model, spend-cap controls, pricing at 50/250/1000-op scale. If green, Zernio Ads supersedes Revealbot for Module A.
   - **Revealbot agency-tier call (BACKUP for Module A)** — same questions; only relevant if Zernio Ads spike falls short.
   - **Optmyzr Partner Services call** — confirm white-label "managed under your agency's brand" terms, MCC-link model, pricing tiers.
   - **Hatch partnership conversation** — confirm LSA integration is exposable via API to a downstream orchestrator (vs UI-only product), pricing for our agency posture.
2. **Vendor contracts signed before Phase 2 build starts:** Zernio Ads (or Revealbot) + Optmyzr + Hatch master service agreements with sub-processor + DPA addenda. Counsel review ~4-8 hours.
3. **E&O insurance quote shopping** — 3 quotes from agency-specialized brokers ([InsuranceBee marketing E&O](https://www.insurancebee.com/marketing-insurance), [Hiscox marketing](https://www.hiscox.com/small-business-insurance/professional-business-insurance/marketing-insurance), [Insureon media-liability](https://www.insureon.com/media-business-insurance/professional-liability)) for $2M aggregate / $1M per-claim media-liability + ad-management coverage. Budget $3,000-$8,000/yr depending on customer count projection. Per-broker question: explicitly ask carriers about AI-decision-making coverage — Module D (cross-vendor allocation) is where AI autonomy is highest. Bind before Module A onboarding ships.
4. **Counsel-drafted Marketing Pro customer addendum** — ad-spend authorization, liability cap, dispute resolution, sub-processor disclosure (Revealbot / Optmyzr / Hatch named), data-use language. ~4-8 hour engagement ($1,500-$3,000).
5. **Cloud infrastructure readiness:** Convex actions ready to fan out `job.completed` to each vendor's offline-conversion endpoint. Plan during v0 Sprint 6 even if Phase 2 modules ship later.
6. **Optional, Module D only — apply for Google Premier Partner status** (eligibility = $20K+ MCC spend over 90 days + certified team members). Useful at scale (>50 Marketing Pro customers) for cross-channel attribution credibility. Defer decision until Module D scoping.
7. **What we EXPLICITLY do NOT need to apply for** (operator clarity):
   - ~~Meta Marketing API Advanced Access for `ads_management`~~ — Zernio Ads (or Revealbot fallback) holds this.
   - ~~Google Ads API developer token, Standard Access~~ — Optmyzr holds this. We never face the Feb-2026 backlog.
   - ~~Local Services API access~~ — Hatch holds this.
   - ~~Meta Business Verification of HeyMaya entity~~ — not needed; Zernio's MCP toolset replaces our prior Composio FB/IG dependency entirely.
   - ~~Direct Google Business Profile API partner access~~ — **conditional**. If the Zernio review-reply spike (§ 12.5 architecture lock) is green, we drop the GBP API application from § 17 entirely. Keep applying in parallel as defense-in-depth until the spike confirms.
   This is the third-party-first dividend: months of approval lead time collapse to vendor sales cycles measured in days.

---

### 12.5.6 — Open research items / unverified claims

Add to § 18:

| Item | Source / status | Open Q | Operator action |
|---|---|---|---|
| **Zernio review-reply API depth (highest-priority spike)** | [getlate Google Business Reviews API blog](https://getlate.dev/blog/google-business-reviews-api), [Zernio GBP platform docs](https://docs.zernio.com/platforms/google-business), [Zernio reviews list endpoint](https://docs.getlate.dev/reviews/list-inbox-reviews) | Zernio claims `late.reviews.reply()` works end-to-end with token refresh + webhooks. R1 marked the depth `[unverified]`. If green, drop direct GBP API from v0 stack. | **Sprint 0/1 spike (1 day, Zernio Build $19/mo):** post a real reply to a real test GBP review via Zernio. Confirm moderation pass-through (Google's `ReviewReplyState` rejects AI-flavored replies — does Zernio surface that signal?). If shallow, keep direct GBP API as review-reply-only fallback. |
| Zernio MCP-server stability + scope drift | [Zernio MCP docs](https://docs.zernio.com/resources/mcp), [Social Media MCP blog](https://zernio.com/blog/social-media-mcp), [Zernio agents page](https://zernio.com/agents) | 280+ tools confirmed; production-grade reliability at multi-tenant 50+ ops `[unverified]`; tool-add cadence (Zernio is a 5-person bootstrapped co — R1 § Tier 1 risk noted) | Sprint 5+: instrument Zernio MCP error-rate + latency in OpenClaw telemetry; trigger interface-isolation review if error-rate >2% at scale. |
| Zernio Ads API depth — campaign create + creative test + spend cap | [Zernio Ads blog](https://zernio.com/blog/social-media-ads-api), [Zernio social-media-ads page](https://zernio.com/social-media-ads) | Boost organic + standalone ads + custom creative claimed; per-customer ad-account-linking model + spend-cap controls + creative-rotation-test depth `[unverified]` | Phase 2 Sprint 5-6 spike (compares Zernio Ads vs Revealbot side-by-side over 5-day test campaign). Picks Module A primary. |
| Brave Search coverage of Facebook Group content | [Brave API pricing 2026](https://api-dashboard.search.brave.com/documentation/pricing) | Brave indexes public web; depth of FB Group page indexing `[unverified]` (FB has aggressive anti-crawler signals) | Sprint 3 spike: query Brave for 20 known-public group URLs, measure result quality + freshness. If <60% useful coverage, fall back to operator-supplied URL polling only. |
| Brave indexing latency for hot leads | [Brave API docs](https://api-dashboard.search.brave.com/documentation/pricing) | A "hot lead" 14 min old needs Brave to have indexed it. Index lag for low-trafficked FB Group URLs `[unverified]` | Sprint 3 spike (combined with #1) — assert lag <30 min p95 on operator-supplied group corpus; if >2 hours, v0 monitor model degrades, revisit operator-supplied direct-link refresh as primary path. |
| Meta Content Library API access for service-product use | [Meta Content Library docs](https://developers.facebook.com/docs/content-library-and-api/content-library-api/guides/fb-groups/) | Currently research-program-only, gated by approved-academic-affiliation. Will Meta expand access? `[unverified]` | Quarterly check; do not assume access in Phase 2 plan. |
| Revealbot agency-tier API depth + white-label posture | [AdStellar 2026 review](https://www.adstellar.ai/blog/best-meta-ads-management-platform), [AdStellar agency guide](https://www.adstellar.ai/blog/facebook-ad-automation-software-for-agencies) | Public reviews confirm rule-engine API + agency tier. **Multi-tenant per-operator OAuth flow + white-label reporting + price-at-scale `[unverified]`** | Phase 2 Sprint 5-6 of v0: sales call w/ Revealbot — validate before architecture lock. |
| Optmyzr Partner Services API depth + contract terms | [Optmyzr Partner Services](https://www.optmyzr.com/services/partner-services/), [groas 2026 ranking](https://groas.ai/post/the-ai-tools-reshaping-google-ads-in-2026-the-definitive-ranking) | White-label confirmed; per-operator MCC-link OAuth + API write surface + price-at-scale `[unverified]` | Phase 2 Sprint 5-6: sales call w/ Optmyzr Partner Services. |
| Hatch LSA integration as orchestratable API vs UI-only | [Hatch LSA integration](https://www.usehatchapp.com/knowledge/google-lsa), [Hatch lead-rating blog](http://hs.usehatchapp.com/blog/google-lsa-rate-a-lead) | Customer-facing UI confirmed; agency-orchestrator API surface `[unverified]` — may be UI-only product | Phase 2 Sprint 5-6: partnership conversation w/ Hatch sales/BD. If UI-only, fall back to direct Local Services API + accept the developer-token application overhead. |
| Composio Meta Ads depth — read vs write | [Composio Metaads toolkit](https://composio.dev/toolkits/metaads), [Scalemate MCP comparison](https://www.scalemate.co/blog/best-mcp-servers-meta-google-ads) | R1 noted "Metaads = ads only" — read confirmed; campaign-create + budget-set + activate `[unverified]` at production-grade | Even with Revealbot as primary, useful as supplemental telemetry layer. 1-day spike before Phase 2. |
| LSA per-trade per-state license + insurance matrix | [Google qualification](https://support.google.com/localservices/answer/6230381), [Plumber LSA 2026 guide](https://rankmetop.net/blog/plumber-google-local-service-ads/) | High-level "high-risk trades require trade license + COI" confirmed. Per-state granularity `[unverified]` for v0 ICP states | Phase 2: build per-state per-trade matrix as part of LSA-certification onboarding wizard. ~2-day research task. |
| Page-into-group posting prevalence | [SocialRails 2026 update](https://socialrails.com/blog/how-to-post-to-multiple-facebook-groups) | Confirmed mechanism; % of local-service groups that allow it `[unverified]` | Sprint 3-4: scan operator-supplied group URLs at onboarding for Page-allowed status; report prevalence after first 20 operators. |
| E&O insurance carrier appetite for AI-driven ad management | [InsuranceBee marketing E&O](https://www.insurancebee.com/marketing-insurance), [Berxi Media & Marketing E&O](https://www.berxi.com/industries/media-marketing-insurance/) | Standard agency E&O is a mature market; AI-specific clauses `[unverified]` — may surface as exclusions in fine print, especially Module D autonomy | Phase 2 prep: brokers must ask carriers about AI-decision coverage. Budget premium uplift if needed. |
| Submagic API quality + caption accuracy on service-business jargon | [Submagic API](https://www.submagic.co/api), [Submagic API docs](https://docs.submagic.co/introduction), [Submagic pricing 2026](https://fluxnote.io/guides/submagic-pricing-guide-2026) | API confirmed at $69/mo Business plan + $0.69/processed-min. Caption accuracy on trade jargon ("R-410A", "240V single-pole") `[unverified]` | § 12.5.7 Sprint 3.5 spike: 10 trade-vocabulary clips through API; assert >95% accuracy before adoption. |
| OpusClip API closed-beta access | [Opus API page](https://www.opus.pro/api), [Opus help](https://help.opus.pro/docs/article/api-requests) | API confirmed in closed beta, gated to "20+ packs annual Pro plan" qualification form; multi-tenant terms `[unverified]` | § 12.5.7 deferred — assume FFmpeg + Gemini in v0; revisit OpusClip API if v0 output quality forces a Phase 2 polish layer. |

---

### 12.5.7 — Maya video editing capability (the "raw clips to finished reel" workflow)

**Operator requirement:** the operator drops a handful of raw clips from a job (truck pull-up, before-photo, install footage, finished-job pan, customer thumbs-up) into Maya's text thread; Maya returns a polished 20-45 second short-form video, captioned, color-graded, with intro/outro, ready to post to GBP + IG Reels + TikTok.

**Architectural posture (consistent with § 12.5 lock):** the editing engine is reused infrastructure (existing Wave-4 video-synth Fly worker has FFmpeg + Gemini Files API) — not third-party. The edit *decisions* are made by Gemini multimodal, not by a third-party editor. We pull patterns from the open-source [Claude Code video toolkit](https://github.com/digitalsamba/claude-code-video-toolkit) ([Wilwaldon mirror](https://github.com/wilwaldon/Claude-Code-Video-Toolkit)) — open-source SKILL.md skills wrapping FFmpeg for auto-cut, filler-word removal, subtitle generation, color grading, intro/outro insertion, multi-resolution export. We port those patterns into our own custom skill, not install the toolkit wholesale (skill-policy carries from creator side: only Anthropic public skills + custom-written Maya skills, no third-party ClawHub).

#### v0 scope (ships in current plan, not Phase 2)

- **New custom skill: `maya-service-clip-editor`.** Inputs: array of `mediaAssets._id` (raw clips), operator-supplied one-line brief ("highlight the install"), target platform, optional music vibe ("upbeat", "calm", "none"). Outputs: a finished MP4 stored back into `mediaAssets` with `derivedFromAssetIds[]` populated.
- **Decision layer (Gemini 3 Flash @ HIGH thinking, ONE call per edit):** plans the cut sequence — which clips, in what order, where to cut each clip (start/end timecodes), what overlay captions, what transition style, what music feel. Output is a structured "edit plan" JSON.
- **Execution layer (FFmpeg on Wave-4 worker):** consumes the edit plan, executes deterministic FFmpeg passes (cut + concat + caption-burn + LUT color-grade + intro/outro splice + format export). Reuses existing Wave-4 worker — no new Fly infra.
- **Output:** finished MP4 written to R2, new `mediaAssets` row inserted with full catalog metadata, `derivedFromAssetIds[]` populated, `editVersion: 1`.
- **Operator approval workflow:** Maya sends preview URL + short caption draft to operator's primary channel ("here's a 28-sec edit of the Johnson kitchen — want me to post to GBP + IG?"). Operator one-tap-approves; Maya publishes via Zernio (multi-platform), appends to `usageHistory` per platform.
- **Revisions:** operator says "make it shorter" or "use the truck shot first" → Maya re-runs the planner with the feedback, increments `editVersion`, sends new preview. Idempotent — same input + same brief = same output (deterministic FFmpeg seed).

**Reference patterns (open-source, ported not installed per skill-policy):** [`digitalsamba/claude-code-video-toolkit`](https://github.com/digitalsamba/claude-code-video-toolkit) — port the FFmpeg-command patterns + input-folder convention into our skill's `script.ts`. OpenClaw-marketplace skills surveyed for prompt patterns only (not installed): `clawvid`, `ai-video-gen`, `ffmpeg-video-editor`, `video-frames`.

#### Phase 2 upgrade path (better polish via third-party)

If FFmpeg-only output looks too rough for some operators after v0 ships, add a polish layer. Vendors evaluated:

| Vendor | What it adds | API status | Pricing | Verdict |
|---|---|---|---|---|
| **Submagic API** ([Submagic API page](https://www.submagic.co/api), [docs](https://docs.submagic.co/introduction), [pricing 2026](https://fluxnote.io/guides/submagic-pricing-guide-2026)) | Best-in-class AI captions (100+ languages, "reduces post-editing work by 98%"), B-roll suggestions, platform-specific metadata | Production-grade API, well-documented, Discord dev community | $69/mo Business plan (includes 100 API minutes); overage $0.69/processed-min | **Recommended Phase 2 polish layer.** Run our FFmpeg edit through Submagic for captions + B-roll only; we keep cut/order/structure decisions. |
| **OpusClip API** ([Opus API](https://www.opus.pro/api), [API requests](https://help.opus.pro/docs/article/api-requests)) | ClipAnything model — picks best moments from long video; Virality Score | Closed beta, gated to "20+ packs annual Pro plan" customers | $19/mo+ for app; API pricing not public | **Skip for now.** Closed-beta gate makes it unreliable as a planned dependency. Revisit if it opens. |
| **CapCut API** | AI auto-edit + AI avatars added in 2026 | Public API status `[unverified]`; mostly desktop/mobile app | Free → $12.99/mo | **Skip.** No clear API contract for orchestration. |
| **ZSky AI** | Free REST API, 1080p with audio | Free | Free | **Test bench only.** Free tier good for our internal smoke tests; production trust low. |
| **Veed.io** | Templated video editing API | Has API | Mid-tier | **Watchlist.** Templated approach less flexible than our Gemini-plan + FFmpeg-execute pattern. |

**Phase 2 trigger:** if v0 telemetry shows operator-edit-rejection rate >25% (operator regenerates more than 1 in 4 edits), add Submagic API as the captions/B-roll polish layer between FFmpeg and final delivery. Until then, FFmpeg + Gemini is the lock.

#### Schema additions (extends § 9 + § 10.5)

`mediaAssets` gains three optional fields: `derivedFromAssetIds: v.array(v.id("mediaAssets"))` (which raw clips fed this edit), `editVersion: v.number()` (v1/v2/v3 if operator requests revisions on the same source set), and `editPlan: v.object({briefText, targetPlatform[], musicVibe?, cutSequence: array of {sourceAssetId, startSec, endSec, captionOverlay?, transitionToNext?}, plannedAt, plannerModel, plannerCostUsd, ffmpegRenderMs, ffmpegCostUsd})`.

#### Cost envelope (extends § 3)

FFmpeg on Wave-4 Fly worker: ~$0.001-$0.01/render. Gemini 3 Flash HIGH-thinking edit-planning call (one per edit): ~$0.05-$0.10/video. **Total ~$0.05-$0.15 per finished edit.** Anticipated v0 volume ~3-5 edits/op/mo → $0.30-$0.50/op/mo, negligible. Phase 2 Submagic add (if triggered): +$0.69/min processed → +$0.20-$0.50 per 20-45s edit; still profitable on Pro+.

#### Plan-tier gating

| Capability | Starter | Pro | Studio |
|---|---|---|---|
| Maya edits raw clips → finished video | up to 2 edits/mo | up to 10 edits/mo | unlimited |
| Operator-requested revisions per edit | 1 | 3 | unlimited |
| Multi-platform variant rendering (GBP + IG + TikTok in one pass) | — | ✓ | ✓ |
| Phase 2: Submagic polish layer (when shipped) | — | opt-in | included |

Enforced via `planFeaturesService(business).videoEditing.{maxEditsPerMonth, maxRevisionsPerEdit}`. Server-side, fail-closed.

#### Test categories (extends § 14)

Cross-tenant (A's clips never combined into B's edit); idempotency (same inputs + brief + plannerModel → byte-identical FFmpeg output via deterministic seed; assert `sha256(output_v1) === sha256(output_v1_rerun)`); adversarial (corrupted clip → skip-and-warn, finish on remaining; oversized clip >500MB → R2 bridge rejects per § 11; audio-sync drift bounded ±33ms on known-tricky multi-clip corpus; brief jailbreak → planner ignores); output-quality regression (5-bundle synthetic corpus, SSIM floor per release).

#### Operator-required for v0

- **None.** Reuses existing Wave-4 Fly worker + Gemini Files API + R2 bucket from § 10.5. No new vendor signup, no new API key, no new lead-time.

#### Operator-required if Phase 2 polish layer triggers

- **Submagic Business plan API key** ($69/mo or $41/mo annual). Single shared HeyMaya account; meter per-operator usage internally for cost attribution.

---

## 12. Company HQ shape (the service-side dashboard, 6 screens)

Mirror creator V0 § 4 Today/Performance/Plan/Trends/Deals/Profile — but service-business shape.

### 1. Today (`app/(business)/page.tsx`)

- Top: today's morning brief (markdown, real-time Convex subscription)
- Today's job schedule (CRM-mirrored, vertical scroll)
- Today's jobs-completed-needing-reviews queue
- Today's pending operator approvals (review-reply drafts, GBP-post drafts, content arc proposals)
- GBP/social activity stream (last 24h: new reviews, post engagement, FB/IG comments)
- Inbound-leads-pending-response counter (red alert if any >2h old)
- Mobile-first vertical scroll, 390px-clean.

**Data sources:** `dailyBriefs` (latest), `serviceJobs` (today), `reviews` (status=drafted), `gbpPosts` (status=pending), `inboundLeads` (operatorResponded=null).
**Stage-aware empty state:** Day 0 ("Maya is reading your reviews — first brief at 7am tomorrow"); Day 1+ filled.

### 2. Jobs (`app/(business)/jobs/page.tsx`)

- CRM-mirrored job pipeline (open / scheduled / in-progress / completed / invoiced / paid)
- Per-job: customer + address + technician + service type + ticket amount + photo upload + review-request status + Maya's notes
- Filter: status, technician, zip, date range
- Click a job → detail panel: photos (drag-drop upload), Maya's recommended best-photos curation, review-request status, replies-from-customer mirror

**Data:** `serviceJobs`, `serviceCustomers`, `serviceContent`. **Plan-tier:** Starter shows last 30d only; Pro+ unlimited history.

### 3. Reviews (`app/(business)/reviews/page.tsx`)

- Multi-platform review feed (GBP + FB + Yelp monitor-only) with sentiment color-coding
- Drafted replies inline + reply approval queue (one-tap approve / edit / reject)
- Reply-status tracker: drafted → approved → posted → moderation-status (Google may reject AI-flavored replies — display the moderation outcome from `ReviewReplyState`)
- Sentiment trend chart (last 90d)
- Unmatched-customer reviews surfaced ("this review mentions Sarah but no Sarah in your CRM")

**Data:** `reviews`, `reviewRequests`. **Plan-tier:** Starter manual queue only; Pro+ auto-draft + auto-send-on-approve.

### 4. Posts (`app/(business)/posts/page.tsx`)

Two tabs: **Calendar** (default) and **Library**.

**Calendar tab:**
- Content calendar across GBP + FB + IG (week-grid view)
- Drafted-but-pending-approval queue
- Posted history with engagement metrics
- "Generate post from job" action — pick a recent job → Maya curates 3 photos + drafts copy + queues for approval
- Per-platform variant renderer (GBP = local-post format with CTA; FB = page-post; IG = caption + hashtags)

**Library tab (operator content library, § 10.5):**
- Recent assets (last 30 days) with thumbnail + primarySubject + visualQuality badge + serviceCategory chip + usageHistory count
- Filter: service category, visual quality, posting status (used/unused/stale), source channel, has-CRM-linkage
- "Maya's recommended for next post" surface (rejuvenator output)
- Per-asset detail panel: full catalog, usage history, manual override ("Maya thought this was a kitchen remodel, it's actually a bathroom" — operator override gates re-catalog)
- Operator-archive action (soft-delete via `archivedAt`)
- Bulk-action: tag all unused-and-fair-quality assets for review

**Data:** `gbpPosts`, Zernio post-records table, `serviceContent` (raw inputs from operator), **`mediaAssets`** (cataloged library). **Plan-tier:** Starter GBP-only + library read; Pro+ multi-platform + rejuvenator suggestions.

### 5. Customers (`app/(business)/customers/page.tsx`)

- CRM-mirrored customer list + lifetime value + last interaction + review status (asked/left/not-yet)
- Filter: zip, service-type, ticket-size, review-status
- Click → customer detail: job history, review history, communication history, lifetime value
- Bulk-action: send review-request to last-30d-completed-with-no-review (operator-confirmation gated)

**Data:** `serviceCustomers`, `serviceJobs`, `reviews`, `reviewRequests`. **Plan-tier:** CRM-required; Starter sees CRM-empty state.

### 6. Profile (`app/(business)/profile/page.tsx`)

- Editable business profile: name, service types, service area, tone, response-speed, business hours
- Connections panel: GBP locations (add/remove, triggers re-pull + soul.md regen on add), CRM (Jobber/HCP/QBO connect/disconnect), FB/IG (Composio), Calendar, Voice (Studio)
- Channel preference (iMessage / WhatsApp / SMS / web — change anytime)
- Auto-send threshold (review requests, GBP cadence)
- Tone slider (friendly / professional / authoritative)
- Memory reset button (with confirmation — "this rewrites your business picture")
- Billing tab (current plan, MTD usage incl. voice minutes, upgrade/downgrade)
- Export data (GDPR-style)

**Plan-tier UX:** Locked features show greyed with "Upgrade to Pro/Studio" inline pitch; never silently fail.

---

## 13. 8-sprint roadmap

Mirror creator V0 § 5. Each sprint includes acceptance gates + the 5 mandatory test categories.

### Sprint 0 — Service-product scaffolding (1-2 days)

**Goal:** branch + dual-onboarding routing + pricing landing page that splits creator vs service.

Tasks:
- `git checkout -b heymaya/service-v0` from `main`
- `npx convex deploy --preview-create heymaya-service-v0`
- Schema additions: `accountType` enum on existing accounts table; new tables (R § 9 list) added as additive blocks
- Dual onboarding routing: `/onboarding/creators` vs `/onboarding/business`; landing page split with the account-type selector
- Service Sprint Plan landing page at `/business` (marketing copy, pricing card)
- `planFeaturesService(business)` helper stub — fail-closed defaults
- README + CLAUDE.md update for the service product context (NEW SECTION, not replacement)
- **Operator action items:** apply for GBP API partner access, apply for Meta App Review, apply for ServiceTitan partner program, ElevenLabs paid tier, Zernio account
- **Confirm OpenClaw version pin >= 2026.2.26** — if current `4.23` doesn't cover, file an upgrade plan
- **HCP non-MAX preflight contract** (validation report 2026-04-27 hardening): document the onboarding-side detection — operator selects HCP → call HCP API with provided OAuth → if API returns 403/feature-gated, auto-route to no-CRM mode + surface "your HCP plan doesn't expose API access — Maya will work with what you tell her in chat" message. Never show a connect button that fails. Implementation lands in Sprint 5 (HCP integration sprint); Sprint 0 spec only.
- **No-CRM NER grammar spec** (validation report 2026-04-27 hardening): write the extraction grammar spec for "just finished the Johnson kitchen sink at 432 Oak" → `{customer_last_name: "Johnson", service_type: "kitchen-sink", address: "432 Oak", completedAt: now}`. Locks the schema-target before Sprint 4 builds against it. This is Persona A (Mike, no-CRM HVAC) primary path — first-class engineering, not fallback engineering.

Acceptance: branch builds, type-check + lint pass, dual onboarding routes resolve, planFeaturesService stub fails-closed by default, HCP non-MAX preflight + no-CRM NER spec docs landed.

### Sprint 1 — Foundation (Week 1)

**Goal:** GBP + Zernio scaffold + schema + fixture corpus.

Tasks:
- **GBP API client** — `convex/integrations/gbp/`
  - `client.ts` — OAuth `business.manage` scope, retry + backoff
  - `endpoints.ts` — Locations, LocalPosts, Reviews, Insights wrappers
  - `pubsub.ts` — Cloud Pub/Sub subscriber for `NEW_REVIEW`/`UPDATED_REVIEW`/`NEW_QUESTION`
- **Zernio integration scaffold** — `convex/integrations/zernio/`
  - `client.ts` — auth + webhook signature verification
  - `endpoints.ts` — post create/update + analytics
  - **Interface-isolated** so Ayrshare swap is <2 weeks (R1 § Verdict)
- **Composio FB/IG verification** — confirm existing Composio accounts handle FB Pages publishing + IG Business; add to `connectedAccounts` provider enum
- **Schema additions** — all tables from § 9 added to `convex/schema.ts` with `by_business` indexes
- **50-business fixture corpus** (parallel to creator's 50-creator corpus):
  - 10 service types × 5 size brackets × ICP variants
  - Each fixture: GBP profile JSON, last 50 reviews, last 30 jobs, 5 brand-voice samples, 1 vendor contract PDF
- **`planFeaturesService(business)` complete implementation** — full plan-tier × action matrix

**Acceptance:**
- GBP OAuth works against a real test GBP, posts a LocalPost, reads reviews
- Zernio scaffold handles a test FB post end-to-end
- Schema cross-tenant indexes verified
- 50-business fixture corpus loaded into `convex-test` harness
- All 5 mandatory test categories green for the new tables

**Operator-required:** Test GBP claimed and ready. Zernio paid plan ($19/mo). Composio FB+IG account live.

### Sprint 2 — Onboarding (Week 2)

**Goal:** sub-5-min onboarding from landing → deployed Maya pinging operator on chosen channel.

Tasks:
- Landing pages: `app/business/page.tsx` (marketing) + `app/onboarding/business/page.tsx` (the flow)
- 11-step onboarding flow (§ 5): account-type select → GBP claim → FB/IG → CRM (stubbed Sprint 4) → bulk pull (parallel) → 8-Q form → businessPicture synthesis (high thinking) → first message → phone capture + Twilio provision → deploy
- `app/onboarding/business/QuestionsStep.tsx` — clickable/multi-select question UI
- `convex/onboarding/business/pipeline.ts` — orchestration
- `convex/agents/packs/maya_service/generateBusinessPicture.ts` — high-thinking multimodal synthesis (parallel to creator's `generateCreatorPicture`)
- `convex/agents/packs/maya_service/generateSoul.ts` — service-side SOUL.md generator
- Twilio number provisioning — `convex/integrations/twilio/provisionNumber.ts`
- Service-side OpenClaw deploy variant — `convex/onboarding/business/deployServiceMaya.ts`

**Acceptance:**
- Operator with 1 GBP onboards in <5 min wall-clock
- First message cites ≥2 specific data points (review snippets, recurring service patterns)
- Hallucination test = 0% phantom names across the 50-business fixture corpus (firewall reused)
- Twilio number provisioned + saved to `voiceChannels`
- Deploy succeeds, Maya pings on chosen channel
- All 5 mandatory test categories green; sub-5-min E2E (Playwright) passes

### Sprint 3 — The .md layer + first 5 service skills (Week 3)

**Goal:** Maya is a *capable* service-business manager. 15 cron behaviors documented; first 5 skills shipped.

Tasks:
- `agents/skills/maya-service-platform/AGENTS.md` (shared) — 15 standing-order blocks
- `agents/skills/maya-service-platform/HEARTBEAT.md` (shared)
- `agents/skills/maya-service-platform/jobs.json` (shared template)
- First 5 skills shipped:
  1. `maya-service-review-request-drafter`
  2. `maya-service-review-reply-drafter`
  3. `maya-service-gbp-post-optimizer`
  4. `maya-service-job-photo-curator`
  5. `maya-service-lead-response-nudger`
- HTTP endpoints (`lc_maya_service.*`) — gated, cross-tenant-safe

**Acceptance:**
- 15/15 cron behaviors pass sibling-file scan (every cron entry → standing order → skill)
- 5/5 skills test green incl. cross-tenant + plan-tier + adversarial + citation
- Behavioral simulation: 50-business fixture corpus runs Maya end-to-end without crashes
- All 5 mandatory test categories green

### Sprint 3.5 — Remaining 10 skills + photo bridge + content library ingest (Week 3.5, ~6-7 days)

**Goal:** the rest of the skill bundle + R2 attachment bridge live + the operator content library cataloger pipeline live.

Tasks:
- 10 remaining `maya-service-*` skills authored + tested (incl. **`maya-service-asset-cataloger`** and **`maya-service-content-rejuvenator`** for § 10.5)
- R2 attachment bridge: BlueBubbles host upload → R2 → public URL → OpenClaw input (R3 § 2 mitigation)
- HEIC → JPEG conversion in bridge worker
- 1-second multi-image debounce
- Photo-bridge integrity test (regression-test for SSRF guard / race / HEIC bugs)
- **`mediaAssets` table + cataloger pipeline (§ 10.5):**
  - Hash-dedupe before catalog cost
  - Wave 4 worker extended for stills + audio (was video-only)
  - Rate-limited cataloger queue (5 concurrent jobs/business)
  - Catalog-quality test set (20 photos, >85% accuracy gate)
  - Library tab data layer ready for Sprint 5 UI

**Acceptance:**
- 15/15 total skills test green
- Photo bridge handles iPhone HEIC + multi-image batches reliably
- Bridge integrity regression test green (5/5 known-bug scenarios mitigated)
- Asset cataloger achieves >85% accuracy on test corpus
- 50-photo flood adversarial test: cataloger queue rate-limit holds, no $1-burn in 10 seconds
- Hash-dedupe verified: same bytes never re-cataloged

### Sprint 4 — Jobber CRM integration via Nango + Today/Jobs UI (Week 4)

**Goal:** Jobber wired (R2 § Tier 1 — easiest API in the category) via Nango aggregator; Today + Jobs HQ screens shipped.

Tasks:
- **Day 1-2: Apideck vs Unified.to spike** for QBO (Sprint 5 dependency, decided here so Sprint 5 ships clean). Output: 1-page memo + locked decision.
- **Nango Jobber connector** — deploy Jobber connector spec on Nango; Convex action layer over Nango's normalized API
  - GraphQL client (Nango handles OAuth + token refresh)
  - Webhook receiver (HMAC-SHA256, 1-second ack budget per R2)
  - Idempotency on (`provider`, `event_id`, `kind`) via `webhookEvents` table
  - `WebHookTopicEnum` mappings → normalized job-event schema
- Job-completion event → `/hooks/wake` to operator's Maya with normalized payload
- Polling fallback (15-min cadence) for any operator whose webhook delivery looks unreliable
- Today screen — `app/(business)/page.tsx`
- Jobs screen — `app/(business)/jobs/page.tsx`
- **No-CRM NER extractor implementation** (per Sprint 0 spec; validation hardening 2026-04-27): Persona A's primary path. Convex action `extractServiceJobFromText(message: string, businessId)` → upserts `serviceJobs` + `serviceCustomers` with `crmJobId: null`. Tested against a 30-message synthetic operator-text corpus covering kitchen / bathroom / HVAC / electrical / yard / cleaning service descriptions. Acceptance: >85% extraction accuracy on customer-last-name + service-type fields. Cross-tenant test asserts extracted rows scope to `businessId` correctly. This is the FOUNDATION of behavior #16 working for the largest ICP segment — first-class engineering.

**Acceptance:**
- Jobber OAuth E2E green
- Webhook → wake → Maya draft → operator approval → review request sent — full chain in <30s
- Cross-tenant: Business A's Jobber webhook never wakes Business B's Maya
- Plan-tier: Starter cannot connect Jobber (Pro+ only)
- All 5 mandatory test categories green

### Sprint 5 — HCP (via Nango) + QBO (via Apideck/Unified.to) + Reviews/Posts/Customers UI (Week 5)

**Goal:** broaden CRM coverage; ship the remaining 3 HQ screens.

Tasks:
- **Nango Housecall Pro connector** — `convex/integrations/crm/housecallpro.ts` (thin wrapper over Nango)
  - REST + OAuth 2.0 (Nango-managed)
  - Webhook receiver
  - **MAX-plan detection** post-OAuth — if customer is on Basic/Essentials, surface upgrade prompt or polling fallback
- **Apideck (or Unified.to per Sprint 4 decision) QuickBooks Online integration** — `convex/integrations/crm/quickbooks.ts`
  - OAuth 2.0 + `com.intuit.quickbooks.accounting` scope managed by aggregator
  - Customer parent / sub + Estimate + Invoice → mapped to our `serviceJobs` shape via aggregator's normalized schema
  - Entity-level webhooks via aggregator
- Reviews screen — `app/(business)/reviews/page.tsx`
- Posts screen with **Library tab** — `app/(business)/posts/page.tsx` (§ 12 + § 10.5)
- Customers screen — `app/(business)/customers/page.tsx`
- **`approvalRules` table + Profile-screen "Trust Maya" UI section** (operator addendum 2026-04-27, see § 8): Starter — read-only "all actions require approval" notice; Pro — toggles for `review-request-auto-send` + `gbp-post-auto-publish` (with operator-curated `safeContentClasses` allowlist); Studio — full rule surface incl. `content-rejuvenation-auto-publish`. Server-side: `planFeaturesService(business)` enforces which `ruleType`s are enableable per tier; `review-reply-auto-publish-allowlist` always rejected (Google `ReviewReplyState` lock). Test categories: cross-tenant (Business A's rules never apply to B), plan-tier × ruleType matrix, adversarial (Starter trying to enable Pro-only rule rejected, server-side).
- **Pre-spike (1 day, Day 1 of Sprint 5)** — Jobber GraphQL points budget on the "today's jobs window" query (morning brief load) + HCP MAX rate-limit ceiling against a real sandbox. Output: 1-page memo confirming morning brief stays within Jobber points budget under 100-job/day operator load + HCP rate limit safe under behavior #2/#16 ingest pace.

**Acceptance:**
- HCP MAX detection works (test against fake plan response) + non-MAX preflight (S0 spec) auto-routes to no-CRM mode without dead-end UI
- approvalRules table + Profile UI shipped + plan-tier × ruleType matrix tests green
- QBO Customer/Invoice → `serviceJobs` mapping correct on fixture data
- Reviews screen approval flow E2E green (draft → approve → POST `reviews.updateReply` → moderation result back)
- All 5 mandatory test categories green

### Sprint 6 — Voice channel (Week 6) — REVISED 2026-04-27 per OpenClaw docs audit

**Goal:** OpenClaw `voice-call` plugin live for Studio operators (inbound + outbound). ~30-50% smaller scope than the prior plan since the plugin owns Twilio bridging + STT + TTS + tool-call dispatch natively. Sprint may compress to ~3-4 days.

Tasks:
- **`voice-call` plugin config per business** — workspace bundle adds plugin config block: `provider: "twilio"`, `realtime: "elevenlabs"` (or `gemini-live` if ElevenLabs realtime depth disappoints in the latency spike), `inboundPolicy: "allowlist"`, `fromNumber: <operator's Twilio number>`, transcripts hook → Convex `voiceCallTranscripts` table. Per [docs.openclaw.ai/plugins/voice-call](https://docs.openclaw.ai/plugins/voice-call).
- **Twilio Programmable Voice + Media Streams** — Twilio number provisioning already done in Sprint 2; here we configure the number's voice webhook to route into the `voice-call` plugin's inbound endpoint
- **A2P 10DLC** shared brand campaign registration (operator-side prerequisite; document the operator action)
- **Voice-mode SOUL.md overlay** — workspace MD content (`agents/skills/maya-service-platform/SOUL.md` already includes voice-brevity block from Wave A; verify it activates correctly under voice-call)
- **PIN-challenge flow for sensitive CRM operations** — Convex action layer, NOT in voice-call plugin (caller-ID-trust pattern; voice-call writes the SMS PIN via `voiceTools.send_sms_pin` → Convex action)
- **Voice-call transcript persistence + 90d TTL** — Convex `voiceCallTranscripts` table; voice-call plugin's transcript hook calls `lc_maya_service.persist_transcript`
- **Profile screen — `app/(business)/profile/page.tsx`** — voice setup section. Studio operators can toggle `voice-call` on/off, set inbound allowlist (whitelisted customer numbers), test outbound notification call
- **Latency benchmark spike** (1 day at start of Sprint 6) — verify `voice-call` realtime first-token latency hits sub-1s p95 against a real Twilio + ElevenLabs realtime config. If fails, swap `realtime: "gemini-live"` and re-test. If both fail, escalate (post-launch direct ElevenLabs Agents fallback path).

**~~DROPPED from Sprint 6 scope (audit 2026-04-27):~~**
- ~~ElevenLabs Agents per-business setup — `convex/integrations/elevenlabs/`~~ → owned by voice-call plugin
- ~~Custom-LLM endpoint shim — `convex/voice/elevenlabsBridge.ts`~~ → reimplementation of plugin functionality; deleted from scope

**Acceptance:**
- Real inbound voice call works end-to-end on a Studio test account
- First-token latency <1s (p95) on Studio plan
- Outbound notification call reaches operator and routes correctly
- PIN challenge gates CRM writes — caller-ID-spoof attack does not bypass
- Plan-tier: Pro tier cannot access voice (server-side enforced)
- Voice latency budget regression test green
- All 5 mandatory test categories green

### Sprint 7 — Beta hardening (Week 7)

**Goal:** 5-10 real service-business operators on Maya; capture telemetry; close gaps; begin ServiceTitan partner program in parallel.

Tasks:
- Empty / loading / error states across all 6 HQ screens
- Mobile responsive review (390 / 768 / 1024)
- Telemetry instrumentation:
  - Review-request approval rate
  - Review-reply moderation pass rate (Google's `ReviewReplyState`)
  - Lead-response-nudge open + reply rate
  - Voice call satisfaction signal (operator post-call rating)
  - Per-task model cost (`aiCallLog`)
  - CRM webhook idempotency-hit count
- Beta cohort recruitment: 5-10 operators across service types (HVAC, plumbing, electrical, landscaping, cleaning) with 1-15 trucks
- Free 60-day Pro tier (or Studio for the multi-location ones) in exchange for weekly feedback
- Bug bash week — failure-mode audit incl. all R3 § 2 known iMessage bugs, Zernio outage simulation, GBP API down, CRM webhook flood
- **ServiceTitan partner program kicked off** in parallel (R2 § Tier 1 — multi-week minimum)
- Stripe products + checkout + 14-day Pro trial flow for service tier

**Acceptance:**
- 5-10 operators onboarded
- Maya morning brief approval rate >70%
- Review-request open rate >40% (industry benchmark 30%)
- No P0 bugs by end of week
- Telemetry pipeline live + queryable
- All 5 mandatory test categories green

### Sprint 8 — Iterate from beta + public launch decision (Week 8)

**Goal:** ship what works, kill what doesn't, decide public launch.

Tasks (TBD until beta data lands; reserve space for):
- Cut lowest-engagement behaviors (any of the 15 with <30% engagement gets cut, including its tests)
- Sharpen top-3 most-loved behaviors (likely review-reply-drafter + lead-response-nudger + morning brief)
- Rewrite AGENTS.md sections with low-quality output
- Re-tune tone if operators say "doesn't sound like me"
- ServiceTitan integration (best-case if partner approval lands; otherwise Sprint 9)
- Public launch decision: ship public, or another iteration cycle
- If shipping public: marketing site polish, pricing page, FAQ, ToS, privacy policy, refund flow

**Acceptance:**
- 4 of 5 (or 8 of 10) beta operators report Maya is "worth it"
- Public launch decision made with data
- Public launch executed OR clear gap-list for Sprint 9

---

## 14. Testing strategy

Mirror creator V0 § 10 5 mandatory categories. Add service-specific.

### 5 mandatory categories (per `feedback_validation_gap_prevention.md`)

1. **Cross-tenant isolation** — Business A cannot read or write Business B's data, ever. Including reads. Every new query/mutation gets a cross-tenant test in same PR.
2. **Plan-tier × action matrix** — Starter calling Pro/Studio endpoint must fail closed. Including reads. The full grid: Starter × every gated action; Pro × every Studio action.
3. **Adversarial inputs** — CRM webhook signature mismatch, malformed phone, malformed GBP location ID, PDF-malformed, account-takeover via someone else's GBP, ScrapeCreators timeout, GBP API revoked mid-task, Twilio provisioning fails.
4. **Sibling-file scan** — every `jobs.json` entry → standing-order block in `AGENTS.md` → skill in `agents/skills/maya-service-*/`. CI grep enforces.
5. **TODO grep** — no `TODO`, `FIXME`, `// eslint-disable` without justification.

### Service-specific additions

6. **Voice latency budget** — sub-1s TTFT (p95) on Studio plan. Voice-channel regression test asserts.
7. **CRM webhook idempotency** — duplicate webhook delivery (provider, event_id) is a no-op. Test injects duplicate event.
8. **Photo upload bridge integrity** — R3 § 2 SSRF / race / HEIC / mediaLocalRoots regression scenarios. Five-scenario test:
   - SSRF guard scenario (BlueBubbles localhost) — bridge bypasses correctly
   - Race condition (text-then-attachment 350ms gap) — debounce + groups
   - HEIC ingestion — bridge converts before agent context
   - Multi-image batch — debounces into one turn
   - Image >5MB — bridge rejects, prompts operator to send smaller
9. **GBP review-reply moderation pass-rate** — synthetic batch of 50 review-replies submitted to a moderation simulator (or in-prod silver-channel during beta) tracks pass-rate; gate Sprint 7 acceptance at >90%.
10. **Content library catalog quality** — synthetic test set of 20 service-business photos with known correct primarySubject + serviceCategory; assert Maya's catalog matches expected at **>85% accuracy** before Sprint 3.5 ships (§ 10.5).
11. **Content library idempotency** — duplicate inbound bytes (same sha256, same business) link to existing `mediaAssets` row; cost telemetry shows zero re-catalog charges.
12. **Content library rate-limit** — adversarial 50-photo flood in 10 seconds → cataloger queue holds at 5 concurrent jobs per business; no runaway spend; queue drains in-order.
13. **Voice tier metering** — Studio operator hits 100-min inclusion → next minute logs to Stripe metered usage; hits 500-min hard cap → outbound voice blocked + operator notified to raise cap; Pro-tier voice opt-in routes to $0.20/min product correctly.

### Test stack

Same as creator V0 § 10:
- Vitest, `convex-test`, `@testing-library/react`, Playwright (E2E)
- Tideline-style behavioral sim, citation-firewall, k6 soak
- **Add:** voice-test harness (mock ElevenLabs custom-LLM endpoint, assert latency + brevity)
- **Add:** GBP-moderation simulator (mock Google's `ReviewReplyState` rejection patterns)

### Hallucination floor

0% phantom-name on 50-business fixture corpus before Sprint 2 ships (parallel to creator V0 hallucination floor).

---

## 15. Repo structure (target — extends creator product)

```
heymaya/
  CLAUDE.md
  README.md
  docs/
    SPRINT_PLAN_V0.md              # creator product (locked)
    SPRINT_PLAN_SERVICE_V0.md      # this doc (service product)
    research/                       # R1-R4 inputs
  app/
    page.tsx                        # marketing landing (split: Creator / Service)
    business/                       # service marketing landing
      page.tsx
    (creator)/                      # 6-screen Creator HQ (existing)
    (business)/                     # 6-screen Service HQ (NEW)
      page.tsx                      # Today
      jobs/
      reviews/
      posts/
      customers/
      profile/
    onboarding/
      page.tsx                      # account-type splitter (NEW)
      creators/                     # creator onboarding (existing, renamed from /maya)
      business/                     # service onboarding (NEW)
        page.tsx
        QuestionsStep.tsx
        GbpClaimStep.tsx
        CrmConnectStep.tsx
    api/
      webhooks/
        gbp-pubsub/                 # NEW
        zernio/                     # NEW
        crm-jobber/                 # NEW (Sprint 4)
        crm-hcp/                    # NEW (Sprint 5)
        crm-qbo/                    # NEW (Sprint 5)
        elevenlabs/                 # NEW (Sprint 6)
        twilio/                     # NEW (Sprint 6)
  convex/
    schema.ts                        # service tables additive (§ 9)
    integrations/
      scrapeCreators/                # existing
      composio/                      # existing
      gbp/                           # NEW
      zernio/                        # NEW
      nango/                         # NEW (Sprint 4) — Nango client + connector specs
        client.ts
        connectors/jobber.ts
        connectors/housecallpro.ts
      apideck/                       # NEW (Sprint 5) — OR unified.to/ per Sprint 4 spike
        client.ts
        accounting.ts
      crm/                           # NEW — thin Convex wrappers over Nango/Apideck
        jobber.ts                   # Sprint 4 (over Nango)
        housecallpro.ts             # Sprint 5 (over Nango)
        quickbooks.ts               # Sprint 5 (over Apideck/Unified.to)
        servicetitan.ts             # Sprint 7+ (direct, no aggregator)
        adapter.ts                  # uniform job-event schema (R3 § 6)
      mediaLibrary/                  # NEW (Sprint 3.5) — § 10.5
        cataloger.ts                # asset cataloger pipeline
        rejuvenator.ts              # content-rejuvenator query layer
        hashDedupe.ts
      elevenlabs/                    # NEW (Sprint 6)
      twilio/                        # NEW
    agents/
      packs/
        maya/                       # creator (existing)
        maya-service/                # NEW
          generateBusinessPicture.ts
          generateSoul.ts
          agents.template.md
          boot.template.md
          dreaming.template.md
          standingOrders.ts
          memorySeeds/
            hvac.md
            plumbing.md
            electrical.md
            landscaping.md
            cleaning.md
            roofing.md
            ...
      modelRouter/                  # existing — extend for voice thinkingBudget=0
    onboarding/
      maya/                          # creator (existing)
      business/                      # NEW
        pipeline.ts
        deployServiceMaya.ts
    voice/                           # NEW
      elevenlabsBridge.ts
      transcripts.ts
    lib/
      planFeatures.ts                # existing — add planFeaturesService
      photoBridge.ts                 # NEW (R3 § 2 — R2 attachment bridge)
  agents/
    skills/
      maya-platform/                 # creator shared
      maya-service-platform/         # NEW (shared service)
        AGENTS.md
        HEARTBEAT.md
        jobs.json
      maya-service-review-request-drafter/  # NEW
      maya-service-review-reply-drafter/    # NEW
      maya-service-gbp-post-optimizer/      # NEW
      maya-service-job-photo-curator/       # NEW
      maya-service-lead-response-nudger/    # NEW
      maya-service-brand-voice-applier/     # NEW
      maya-service-citation-firewall/       # NEW
      maya-service-packet-generator/        # NEW
      maya-service-content-arc-planner/     # NEW
      maya-service-contract-redflag/        # NEW
      maya-service-revenue-snapshot-renderer/  # NEW
      maya-service-voice-brevity-overlay/   # NEW
      maya-service-competitor-watcher/      # NEW
      maya-service-asset-cataloger/         # NEW (§ 10.5)
      maya-service-content-rejuvenator/     # NEW (§ 10.5)
  components/
    onboarding/
    creator/                          # existing
    business/                         # NEW (6-screen HQ components)
    ui/                               # shadcn primitives (shared)
  lib/                                # frontend utilities
  e2e/
    creator/                          # existing
    business/                         # NEW
  scripts/
    fixtures/
      creator-corpus/                 # existing
      business-corpus/                # NEW (50 businesses)
```

---

## 16. What this product is NOT

- **Not a CRM replacement.** Maya integrates with Jobber/HCP/QBO; she doesn't try to be them.
- **Not a marketing agency.** Maya advises + drafts. The operator approves and the operator is responsible.
- **Not a posting tool.** Maya schedules drafts pending operator approval; the operator can override.
- **Not auto-posting reviews.** R3 § 3 — Google's `ReviewReplyState` moderation rejects AI-generated replies. Drafts only, operator-approves to post.
- **Not a multi-agent crew.** Single agent (carries from creator product principle 5).
- **Not credits-metered.** Flat tiers + voice metering only.
- **Not a phone-only AI receptionist.** Goodcall/Avoca/Quo own that wedge. Maya's voice is part of the broader manager job.
- **Not a service-area replacement for the technician.** Maya never speaks for the operator on a live customer voice call without flagging that this is the AI assistant.
- **Not a billing/charging tool.** Maya never bills, never charges, never schedules without explicit operator confirmation (R3 § 3 boundaries).

---

## 17. Operator-required (not Claude-doable)

Start NOW (long lead times):

1. **Apply for Google Business Profile API partner access** — `developers.google.com/my-business/content/prereqs` (R1 § Tier 2). Free, but ~2-8 wk wait, no published SLA. Without this Maya can't reply to reviews — the most-differentiated feature.
2. **Apply for Meta App Review + Business Verification** — `developers.facebook.com/docs/instagram-platform/app-review/` (R1 § Tier 2). 2-6 wk effort. Annual Data Use Checkup. Required for FB+IG publishing at scale.
3. **ServiceTitan partner program application** — `developer.servicetitan.io/request-access/` (R2 § Tier 1). Multi-week. Eval call → Workflow Q'naire → Sandbox → Build → Cert. Apply Sprint 0 even though we don't ship until Sprint 7.
4. **Markate API approval** — email `api@markate.com` IF cleaning is in v0 ICP (R2 § Tier 2). $50/mo customer-side. Slow.
5. **Twilio account + phone number provisioning capability** — production-ready account, A2P 10DLC sole-prop registration ($4.50 one-time + $15 vetting + ~$10/mo amortized campaign).
6. **ElevenLabs paid tier for voice agents** — Standard or Premium plan. Required Sprint 6.
7. **Zernio account** — Build $19/mo or Accelerate $49/mo (R1 § Tier 1). Required Sprint 1.
8. **Decide:** account-type selector copy on landing page, marketing site split between creator and service products, brand-voice ID for service-Maya (R3 § 8 Q — distinct ElevenLabs voice for service vs creator, slightly warmer).
9. **Beta operator pipeline** — 5-10 service operators across HVAC/plumbing/electrical/landscaping/cleaning verticals, 1-15 trucks, willing to give weekly feedback for free Pro/Studio access. Begin recruiting Sprint 4-5.
10. **Confirm OpenClaw 2026.2.26 upgrade path** — current `4.23` predates the CalVer numbering change. Confirm alignment with `2026.2.26` security/reliability fixes (R3 § 1, § 2). If not, upgrade is Sprint 0 blocker.
11. **Cloud Pub/Sub project setup** for GBP review notifications (R1 § Tier 2). Topic + subscription + IAM.
12. **R2 (or S3-equivalent) bucket** for the photo attachment bridge (R3 § 2) AND the operator content library (§ 10.5). Confirm CORS + signed-URL config supports both ingest + serve. Estimate storage growth: ~80 photos + 12 videos/op/mo ≈ 500 MB-1 GB/op/year. At 100 ops, ~100 GB/yr — well within R2 free tier.
13. **OpenRouter capacity check** — model-router COGS at scale (50+ paying operators) needs capacity headroom on Gemini 3 Flash, including the new ~$3.40/op/mo cataloging load (§ 10.5).
14. **Apideck OR Unified.to account** — pick one for QBO universal accounting integration (~$200-500/mo at our expected scale). Sprint 4 spike (2 days) decides; Apideck is the default unless Unified.to wins on docs / latency / pricing.
15. **Nango account** — open-source self-host OR managed cloud (~$200/mo for 100 connections). Required Sprint 4 for Jobber + HCP connectors. Decision: managed cloud first (faster ship), self-host fallback if cost > $500/mo at 250+ ops.
16. **Stripe metered billing config for voice overage** — usage-based product on Studio with $5-increment metering at $0.15/min, hard 500-min/mo cap, PLUS the parallel Pro-tier 30-min-inclusion + $0.20/min overage product. Required Sprint 6.
17. **Sprint 0 spike: confirm OpenClaw native voice plugin + ElevenLabs realtime delivers sub-1s TTFT** in production conditions on a Studio test account. **If yes** → Option C (OpenClaw native voice + ElevenLabs as voice provider) is locked, simpler than the prior architecture. **If no** → fall back to ElevenLabs Agents as the inbound voice front-end with Maya as the custom-LLM endpoint (the architecture currently described in § 10). Voice-tier Sprint 6 work is gated on this decision.
18. **Sprint 0 / 1 spike: confirm Zernio review-reply API depth + GBP `ReviewReplyState` moderation pass-through** (per § 12.5 architecture lock). Subscribe to Zernio Build tier ($19/mo), post a real reply to a real test GBP review, confirm Zernio surfaces the moderation outcome. If green, drop direct GBP API from v0 stack; if shallow, keep direct GBP API as review-reply-only fallback. Operator-decision-blocking for the GBP API partner-application item above.
19. **Operator decision: confirm Gemini 3.1 Flash Lite is acceptable quality for the routine task class** (chat replies, comment triage, accountability nudges, niche scans, FB-group lead-classify per the model routing matrix in § 3). Recommend an A/B before commit: 50 morning briefs + 50 chat replies generated by both Flash and Flash Lite, blind-rated by 3 service-Maya beta operators. Decision before Sprint 7 ships.

---

## 18. Open research items / unverified claims

Carry forward from R1-R4 with operator action needed:

| Item | Source | Open Q | Operator action |
|---|---|---|---|
| Zernio's full GBP review-fetch + reply API depth | R1 § Zernio | Reply API documented; full review-fetch depth `[unverified]` | Spike: subscribe to Zernio Build tier ($19), test review-fetch end-to-end, decide if this can substitute for direct GBP API in any scenarios |
| ServiceTitan partner program fee structure | R2 § Tier 1 | Concrete dollar amounts not public | Submit access request; capture fee detail when partnership-agreement order form arrives |
| Specific webhook event lists for Housecall Pro | R2 § Tier 1, R3 § 6 | Categories confirmed (customer/job/estimate/invoice/payment) but full event-name enumeration `[unverified]` | Sign up for HCP dev dashboard, enumerate via `webhooks.list` endpoint |
| Specific webhook event lists for Jobber | R2 § Tier 1 | `WebHookTopicEnum` accessible via GraphQL introspection | Sprint 4: enumerate full topic list during integration build |
| OpenClaw voice cost at production scale | R3 § Cost envelope | $0.45/5-min call estimate, but real-world variance `[unverified]` at >50 ops | Sprint 6+: instrument every voice call with full cost telemetry; recheck Studio margin after 50 paying operators |
| OpenClaw ` >= 2026.2.26` availability | R3 § 1, § 2 | Project memory says "OpenClaw 4.23" — version naming mismatch | Operator confirms current numbering aligns with 2026.2.x CalVer + has the security/reliability fixes |
| Apple Maps Connect API access timeline | R1 § Tier 4 | Apple Business launched April 14 2026; partner-gated to 5 enterprises | Quarterly check; revisit if Apple opens direct access |
| Yelp reply API (none — TOS-violating workaround) | R1 § Tier 4 | No legal API for Yelp reply | Position to operators: "Maya monitors Yelp, you reply in the Yelp app" |
| FB+IG migration cost (Zernio → Composio direct) | R1 § Tier 2 | Meta BUC 200/user/hr at scale | Sprint 5: re-evaluate when active customer count >500 |
| ElevenLabs Premium ($0.12/min) vs Standard ($0.08/min) for Studio | R3 § 1 Q | Premium = "VIP voice" Studio add-on? | Decide after Sprint 7 beta voice telemetry |
| Apideck vs Unified.to for QBO | Operator addendum | Pricing parity, docs depth, latency parity not pre-validated | 2-day spike Sprint 4 day 1-2; locked decision before Sprint 5 |
| Nango managed cloud vs self-host | Operator addendum | $200/mo cloud sufficient through 100 ops; cost above that unknown | Start managed; review at 250 ops |
| Catalog accuracy on edge categories | § 10.5 | >85% gate validated on 20-photo synthetic set; real-world variance for restoration / specialty trades | Sprint 7 beta — capture mis-catalogs, refine prompts before public launch |
| **Gemini 3.1 Flash Lite quality on routine task class** (model routing matrix § 3) | New service-side principle | Operator-decide: 89% → ~85% MMLU-Pro drop is acceptable for chat replies, comment triage, accountability nudges, niche scans, FB-group lead-classify? `[operator-decide]` | Pre-Sprint-7 A/B: 50 morning briefs + 50 chat replies generated by both Flash and Flash Lite, blind-rated by 3 service-Maya beta operators. |
| **OpenClaw native voice plugin + ElevenLabs realtime sub-1s TTFT in production** | Sprint 0 spike | If sub-1s TTFT p95 confirmed → Option C (OpenClaw native voice) locked, simpler than ElevenLabs-Agents-as-front-end. If not → architecture per § 10 stays. `[unverified]` | **DEFERRED — operator decision 2026-04-27: trust OpenClaw documentation. If OpenClaw docs claim ElevenLabs realtime sub-1s, build against that assumption + verify in Sprint 6 acceptance gate (latency budget regression test).** |
| **Pricing experiments (post-launch)** | Operator note 2026-04-27 | After 50+ paying operators, revisit: (a) optional white-glove setup add-on $299–$999 one-time as upsell at Pro-trial-conversion point — funds margin, weeds out price-sensitive churners; (b) Studio bump from $199 → $249 if usage data shows we're leaving pricing power on the table (R4 anchor analysis suggests this is plausible). Conflicts with sub-5min self-serve onboarding principle for v0 — strictly post-launch experiment, not v0 scope. | Capture operator usage telemetry (chat turns/mo, voice min/mo, Library asset count, post-approval rate) from Sprint 7 beta forward; pricing-experiment design memo at 50-paying-op milestone. |
| **CRM data-binding hardening (validation report 2026-04-27)** | Validation agent + R2 § Tier 1 | Three concerns from data-binding validation: (a) HCP non-MAX is a hard wall — API-gated entirely, not just webhooks; (b) Jobber GraphQL points cost + HCP rate-limit ceiling unverified; (c) no-CRM NER extraction is Persona A's primary path and deserves first-class engineering. | **Sprint 0 add:** HCP non-MAX preflight check in onboarding (auto-route to no-CRM mode, never show a connect button that fails). **Pre-Sprint-5 spike (1 day):** Jobber GraphQL points cost on "today's jobs window" query + HCP rate-limit ceiling against a real HCP MAX sandbox. **Sprint 4 add:** lock the no-CRM NER grammar before behavior #16 ships — Persona A's signature path. |

---

## 19. Memory file index updates

After this plan lands, the following memory files MUST be added/updated so future agents pick up the service-product context:

1. **NEW:** `/memory/project_service_v0_plan.md` — short pointer to this doc. Mirrors `project_v0_plan.md` shape.
2. **NEW:** `/memory/feedback_service_voice_pin.md` — locked "OpenClaw >= 2026.2.26 mandatory; ElevenLabs as voice front-end, OpenClaw voice-call for outbound only; thinkingBudget=0 forced for voice."
3. **NEW:** `/memory/feedback_gbp_review_reply_no_auto_post.md` — locked "Maya NEVER auto-posts review replies — Google's `ReviewReplyState` moderation rejects AI-flavored replies. Always operator-approval gated."
4. **NEW:** `/memory/feedback_photo_bridge_r2.md` — locked "All inbound photos route through R2 bridge; OpenClaw never sees BlueBubbles localhost paths; HEIC→JPEG in bridge; 5MB cap; 1s debounce."
5. **NEW:** `/memory/project_service_crm_priority.md` — locked "CRM ship order: Jobber (Sprint 4) → HCP w/ MAX-detection (Sprint 5) → QBO (Sprint 5) → ServiceTitan (Sprint 7+, partner program in parallel from Sprint 0)."
6. **NEW:** `/memory/project_service_pricing_anchor.md` — locked "Starter $99 (no voice, 200 chat turns/mo) / Pro $149 (30 voice min/mo + $0.20/min overage, 1000 chat turns/mo) / Studio $199 (100 voice min/mo + $0.15/min overage in $5 Stripe-metered increments + 500-min hard cap, unlimited chat); Marketing Pro add-on +$299/mo for Module A/B/C ad management; rate-limit ≤4 unsolicited outbound/day in Convex middleware. Service product BREAKS creator-product principle 7 (single-model thinking-budget routing) — uses Gemini 3 Flash + Gemini 3.1 Flash Lite split routed at the action level."
7. **NEW:** `/memory/project_service_content_library.md` — locked "Every operator-sent photo/video/audio persists in R2 + cataloged once via Gemini multimodal into `mediaAssets`. Hash-dedupe before catalog cost. Rate-limited cataloger queue (5 concurrent/business). >85% accuracy gate. Library tab on Posts screen. Rejuvenator skill surfaces unused assets when content cadence is light. See § 10.5 of SPRINT_PLAN_SERVICE_V0.md."
8. **NEW:** `/memory/project_service_crm_aggregators.md` — locked "Jobber + HCP via Nango (managed cloud first, self-host fallback >250 ops). QBO via Apideck OR Unified.to (Sprint 4 spike decides). ServiceTitan direct only (no aggregator covers it; partner program is the gate). Each adapter still gets a thin Convex normalizer to our uniform job-event schema."
9. **UPDATED:** `/memory/MEMORY.md` — add "Service-Business v0" section pointing to this doc and the 8 new memory files above.
10. **UPDATED:** `/memory/session_handoff_*.md` (next handoff) — add "Service product Sprint 0 prerequisites in flight: GBP API application, Meta App Review, ServiceTitan partner program, ElevenLabs paid, Zernio account, Nango account, Apideck/Unified.to spike, R2 bucket for content library, OpenClaw 2026.2.26 confirmed."

---
