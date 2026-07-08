# HeyMaya — AI Creator Manager

## What this is

**Maya** is a single-agent AI creator manager. One creator → one Maya. Lives in iMessage / WhatsApp / SMS / web chat. Runs the operational layer of a creator career: content planning, performance analysis, brand-deal triage, accountability, growth strategy.

> **"Your AI creator manager before you can afford a human one."**

This is a fresh consumer SaaS product. Branded HeyMaya. Target customer: creators with 5K–500K followers who want the operational structure of a manager but aren't big enough to attract or afford one.

## Service-business product (parallel track)

**Maya for home-service businesses (1-25 trucks). Plumbers, HVAC, roofers, electricians, cleaners, landscapers.**

> **"Maya turns every completed job into local marketing."**

> **Creator product is suppressed behind `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT` (default `false`). Code, tests, and Convex tables are preserved — flipping the env var to `true` restores the dual-track surface.** Default new signups during suppression are `accountType: 'service-business'`. Implementation: `middleware.ts` 308-redirects `/creators`, `/onboarding/maya`, and creator HQ paths (`/today`, `/performance`, `/plan`, `/trends`, `/deals`, `/profile`) to their service equivalents; `app/page.tsx` server-renders the business landing in-place at `/` when the flag is off.

The wedge: photos / voice in (from a job site, via text or voice call) → GBP posts + review requests + FB/IG content + brand-voice review replies out, all driven through the operator's text thread or phone. Same single-agent shape as the creator product; different ICP, different stack edges, different pricing.

**Source of truth:** **`docs/SPRINT_PLAN_SERVICE_V0.md`** is the locked v0 plan for the service product. Read it before any service-side work. Sections mirror `SPRINT_PLAN_V0.md` one-for-one for side-by-side comparison.

### Key locked decisions (service product)

- **Pricing:** Starter $99 / Pro $149 / Studio $199 (annual: $999 / $1,499 / $1,999). Voice metered above an inclusion bucket on Studio.
- **Architecture — dual-model routing.** Service product **deliberately breaks creator-product principle 7** ("one brain, thinking-budget routing"). Gemini 3 Flash for high/medium-stakes work; **Gemini 3.1 Flash Lite** for routine task class (chat, comment triage, niche scans, FB-group classify). Routing decided at the action level — every Convex action carries `modelTarget` + `thinkingBudget` + `routedReason`.
- **Voice:** ElevenLabs Agents inbound (custom-LLM endpoint, `thinkingBudget: 0` forced) + OpenClaw native `voice-call` plugin for outbound notifications. Studio-only. Twilio per-customer number ($1.15/mo carry baked into all tiers).
- **Social — third-party-first.** Zernio (Late) MCP primary for FB / IG / TT / LI / YT / X / Pin / TG / Threads posting. **Direct Google Business Profile API** for review-reply (high-stakes; Zernio's GBP review-reply depth unverified). Cloud Pub/Sub for `NEW_REVIEW`/`UPDATED_REVIEW`.
- **CRM — aggregator-layered.** Jobber + HCP via **Nango** (managed OAuth + token refresh). QBO via **Apideck or Unified.to** — Sprint 4 spike decides. ServiceTitan **direct integration** (Sprint 7+, partner-gated; aggregators don't cover it). HCP customer-side caveat: **MAX plan ($329/mo)** for API+webhooks; non-MAX preflight auto-routes to no-CRM mode.
- **Third-party-first for everything social, ads, and CRM.** HeyMaya's value-add is the agent orchestration + operator UX + cross-vendor coordination, not platform infrastructure.
- **Account-type fork at the routing layer; single codebase, two product packs.** Schema is **additive**: `accountType: 'creator' | 'service-business'` enum field on the existing `creators` table (NOT a rename). Service tables (jobs, reviews, gbpPosts, serviceJobs, mediaAssets, voiceChannels, approvalRules, etc.) live in `convex/schema.ts` alongside creator tables.
- **Beta target:** Mike Hansen — 1-truck HVAC owner, no CRM, GBP only (Persona A). Sprint 7 beta cohort.

### Service-product principles unique to the service track

(Full list in `docs/SPRINT_PLAN_SERVICE_V0.md` § 2; the most load-bearing:)

- **Minimum viable data, always.** Service operators have thin social + limited CRM data. Onboarding pulls bounded by COUNT not date, skips empty platforms, never blocks on data we don't need.
- **Maya's platform expertise lives in `.md` files (SOUL.md / AGENTS.md / per-skill SKILL.md), NOT hardcoded `if (platform === ...)` branches.** GBP / IG / FB differences are encoded in prompts + skill instructions.
- **Third-party-first for social / ads / CRM** (see above). No bespoke ad-platform logic, group monitors, or per-CRM OAuth.
- **CRM-agnostic + GBP-required.** GBP is the always-on data anchor. CRM is a high-value upgrade. The 60% of <10-truck operators with no FSM are still first-class.
- **Voice-first interface for the truck-bound operator.** Maya answers their phone (Studio); operators save "Maya — +1 555 …" to contacts.
- **Per-task voice latency lock.** Inbound voice forces `thinkingBudget: 0` for ElevenLabs sub-300ms first-token; the dual-model architecture is what makes this affordable at $99–$199 headline.

### 8-sprint roadmap (one-liner per sprint)

Full detail in `docs/SPRINT_PLAN_SERVICE_V0.md` § 13.

- **Sprint 0** — Service-product scaffolding: branch, dual-onboarding routing, schema additions, `planFeaturesService(business)` stub, OpenClaw 2026.2.26+ pin verification, HCP non-MAX preflight + no-CRM NER grammar specs, README + CLAUDE.md updates.
- **Sprint 1** — Foundation: GBP API + Pub/Sub, Zernio scaffold (interface-isolated), Composio FB/IG verify, schema, 50-business fixture corpus, full `planFeaturesService` matrix.
- **Sprint 2** — Onboarding: sub-5-min flow, `businessPicture` synthesis (high thinking), service-side SOUL.md generator, Twilio number provisioning, OpenClaw service deploy variant.
- **Sprint 3** — `.md` layer + first 5 service skills: shared AGENTS.md / HEARTBEAT.md / jobs.json + review-request, review-reply, GBP-post-optimizer, job-photo-curator, lead-response-nudger.
- **Sprint 3.5** — Remaining 10 skills + R2 attachment bridge (HEIC→JPEG, debounce) + `mediaAssets` cataloger pipeline (§ 10.5).
- **Sprint 4** — Jobber via Nango + Today/Jobs HQ screens + no-CRM NER extractor (Persona A's primary path) + Apideck-vs-Unified.to spike for QBO.
- **Sprint 5** — HCP via Nango + QBO via Apideck/Unified.to + Reviews/Posts (Library tab)/Customers screens + `approvalRules` table + "Trust Maya" Profile UI.
- **Sprint 6** — Voice: ElevenLabs Agents inbound, custom-LLM bridge, Twilio + Media Streams, A2P 10DLC, OpenClaw outbound notification calls, PIN challenge for sensitive CRM ops, Profile voice setup.
- **Sprint 7** — Beta hardening: 5-10 operators (HVAC / plumbing / electrical / landscaping / cleaning), telemetry, bug bash, ServiceTitan partner program kickoff, Stripe service-tier products + 14-day Pro trial.
- **Sprint 8** — Iterate from beta + public launch decision.

### Testing — same five mandatory categories, both products

The 5 mandatory categories (cross-tenant isolation / plan-tier × action / adversarial / sibling-file scan / TODO grep) apply identically to both products. Service-side adds CRM-aggregator-specific tests (HCP MAX detection, Nango token refresh, Zernio outage simulation, GBP `ReviewReplyState` round-trip). Service product has its own 50-business fixture corpus parallel to the creator's 50-creator corpus.

## Source of truth

**`docs/SPRINT_PLAN_V0.md`** is the locked v0 plan for the **creator product**. **`docs/SPRINT_PLAN_SERVICE_V0.md`** is the locked v0 plan for the **service-business product**. Read the relevant one first. If a future suggestion contradicts either plan, default to the plan unless the operator explicitly revises it.

## Tech stack

- **Frontend:** Next.js 16 App Router, TypeScript, Tailwind CSS, shadcn/ui (initialize in Sprint 0)
- **Backend:** Convex (separate project from any prior LaunchCrew Convex)
- **Auth:** Clerk
- **Billing:** Stripe (Starter $19.99 / Pro $39.99 / Studio $79.99 + annual variants)
- **Agent runtime:** OpenClaw 2026.4.23 (CalVer), single-agent solo deploy variant on Fly.io shared multi-tenant
- **Brain:** Gemini 3 Flash via OpenRouter, single model, configurable thinking budget per task
- **Read layer:** ScrapeCreators (27+ social platforms, agent skill installed in Maya's workspace)
- **Write layer:** Composio v3 (Gmail, Stripe-as-data, Calendar, Apollo/Hunter for brand outreach)

## Architecture principles

1. **The product is the agent in the messenger.** Web app is the receipt.
2. **Push, don't pull.** Maya tells the creator things proactively via cron + heartbeat.
3. **Grounded or silent.** Every recommendation cites the data. If she can't ground it, she doesn't say it.
4. **Anti-sycophancy is non-negotiable.** Tone-tunable, never dishonest.
5. **One agent, multi-skilled.** No team, no org chart, no delegation.
6. **Shared infra + per-creator soul.** `playbook.md` / `cron.md` / `skill.md` are shared across all Mayas. Only `soul.md` and connected accounts vary per creator.
7. **One brain, thinking-budget routing.** Single model = single voice = single telemetry profile. No model swapping in v0.
8. **Multi-platform from day one.** TikTok / IG / YouTube / LinkedIn / X. Maya is platform-aware.
9. **No credits theater.** Sell unlimited proactive + capped chat per tier.
10. **Plan-tier gating server-side.** Single `planFeatures(creator)` helper consulted by every gated entry point.

## Key product decisions

### Onboarding (sub-4-min, conversational, never a multi-step form)
1. Sign up via Clerk (Apple / Google / email)
2. Add handle(s) — multi-platform, ScrapeCreators-confirmed per handle
3. Background bulk pull (parallel) — profile + last 30 posts + audience + comments + bio links
4. Multimodal creator-picture synthesis (Gemini 3 Flash, high thinking, watches video frames + processes captions + comments + audience)
5. Maya's first message — specific, cited, grounded. Three Q's framed conversationally: goal / tone / brand-deal floor.
6. Phone number capture → channel routing (iPhone → iMessage; Android → WhatsApp recommended; SMS fallback)
7. Optional Composio connections (Gmail / Stripe / Calendar)
8. Deploy single-agent OpenClaw on Fly. Maya pings on chosen channel.

### Day-to-day behaviors (17 total — full spec in `docs/SPRINT_PLAN_V0.md` § 5 Sprint 3)
Driven by `playbook.md` + `cron.md`. Highlights:
- Morning brief (7am local), evening recap (7pm), weekly review (Sun 9pm)
- Post-publish reaction (event-driven, multimodal video watch)
- 2h performance check during waking hours
- Brand email triage (event-driven, high thinking)
- Daily niche scan + trend watcher
- Competitor watch (per-creator named peers)
- Accountability nudge (conditional on missed commitments)
- Hook library auto-build, comment triage
- Weekly content plan (Sun 4pm, high thinking)
- Manager-readiness packet (on-demand or quarterly)
- Contract red-flag scan (event: PDF upload)
- Revenue snapshot (Mon 9am)

### Pricing — consumer creator app

| Tier | $/mo | Annual | Headline |
|---|---|---|---|
| Starter | **$19.99** | $199 | 1 platform, web + SMS, none/low thinking, limited heartbeat, manual deals |
| Pro | **$39.99** | $399 | Up to 3 platforms, all 4 channels, all thinking, full Gmail deal desk |
| Studio | **$79.99** | $799 | Up to 5, priority routing, brand outreach (Apollo/Hunter), multi-account |

14-day Pro trial → auto-downgrade to Starter on expiry. Plan-tier enforced server-side.

## Coding conventions

- TypeScript strict mode everywhere
- Convex `actions` for external API calls, `mutations` for DB writes, `queries` for reads
- Tailwind + shadcn/ui for all UI — dark theme by default
- All backend logic in Convex — no separate Express/API server
- External API clients live in `convex/integrations/`
- Custom Maya skills live in `agents/skills/maya-*/` (ClawHub-compatible packages)
- Per-creator soul.md generated at deploy from `convex/agents/packs/maya/`
- Shared playbook/cron/skill .md files in `agents/skills/maya-platform/`
- Environment variables for all API keys (never hardcoded)
- Real-time UI via Convex subscriptions
- **Plan-tier gating must always be server-side** — fail-closed, including reads

## Testing — non-negotiable per sprint

Five mandatory categories every sprint:
1. Cross-tenant isolation (Creator A ≠ Creator B data, ever)
2. Plan-tier × action matrix (fail-closed server-side, including reads)
3. Adversarial inputs
4. Sibling-file scan (cron entry needs playbook entry needs skill entry — keep them coherent)
5. TODO grep (no `TODO`, `FIXME`, `// eslint-disable` without justification)

Test stack: Vitest, `convex-test`, `@testing-library/react`, Playwright, Tideline-style behavioral sim, citation-firewall hallucination check, k6 soak. Hallucination rate = 0% on the 50-creator fixture corpus before Sprint 2 ships.

## Repo structure (target — built out across Sprints 0–6)

```
heymaya/
  CLAUDE.md
  README.md
  docs/
    SPRINT_PLAN_V0.md       # locked v0 plan
  app/
    (creator)/              # the 6-screen Creator HQ
      page.tsx              # Today
      performance/
      plan/
      trends/
      deals/
      profile/
    onboarding/
      page.tsx              # one-field handle + chat overlay
    api/                    # webhooks, billing, lc_maya_* skill endpoints
    layout.tsx
    page.tsx                # marketing landing
  convex/
    schema.ts               # Maya-only schema, no LaunchCrew tables
    integrations/
      scrapeCreators/       # 27+ platform read layer
      composio/             # ported from LaunchCrew, simplified
    agents/
      packs/maya/           # soul template, voice extraction, deploy
      modelRouter/          # Gemini 3 Flash + thinking-budget routing
    onboarding/
      pipeline.ts           # handle → scrape → synth → soul → deploy
    crons/                  # infra crons only (Maya's own crons live in cron.md)
    lib/                    # ported helpers (encryption, stripe, fly client)
  agents/
    skills/
      maya-platform/        # shared playbook.md / cron.md / skill.md
      maya-rate-calculator/
      maya-packet-generator/
      maya-platform-best-practice/
      maya-contract-redflag/
      maya-hook-extractor/
  components/
    onboarding/
    creator/                # 6-screen HQ components
    ui/                     # shadcn primitives
  lib/                      # frontend utilities
  e2e/                      # Playwright
  scripts/                  # fixture corpus, load tests
```

## Status

**Creator product:** MVP-ready code-side but **suppressed behind `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT` (default `false`)** — preserved-but-hidden in v0. Sprints 0 → 6 done plus Wave 6 smoke tests (1371/1371 passing, 0 TS errors). All creator code, tests, Convex tables, and schema fields stay untouched; the flag only controls the public surface (routes + landing). Re-enabling is a one-line env flip. Nine operator-blocked infra items remain (Convex/Clerk/Stripe/Fly/etc. — see `docs/SPRINT_PLAN_V0.md` § 13 and operator memory for the list).

**Service-business product:** Sprint 0 (scaffolding) **complete** on branch **`heymaya/service-v0`** (off `main`). Convex preview deployment `heymaya-service-v0`. Schema additions, dual-onboarding routes, marketing landings, and feature-flag suppression of the creator product all in place. Sprint 1 (Foundation: GBP API + Pub/Sub, Zernio scaffold, fixture corpus, full `planFeaturesService`) is next.

**Next sprint after S0 (service):** Sprint 1 — Foundation. GBP API + Pub/Sub, Zernio scaffold (interface-isolated), schema, 50-business fixture corpus, full `planFeaturesService` matrix.

**See `docs/SPRINT_PLAN_V0.md` § 5 for the creator 8-sprint roadmap, `docs/SPRINT_PLAN_SERVICE_V0.md` § 13 for the service 8-sprint roadmap, and § 14 / § 10 of each for testing strategy.**

## What this product is NOT

- Not a multi-agent crew product — single agent only
- Not LaunchCrew-rebranded — built fresh, pricing/UX/positioning all consumer-creator
- Not a content scheduler / posting tool — Maya advises, the creator posts
- Not a licensed talent agency — drafts only, creator approves everything
- Not a credits-metered AI tool — flat tiers, capped chat, unlimited proactive

## Operator-required (not Claude-doable)

The operator must provide before Sprint 1 work:
1. Convex project login — run `npx convex dev --configure` interactively in this repo to create a fresh `heymaya` Convex project
2. Clerk publishable + secret keys in `.env.local`
3. ScrapeCreators API key (Freelance tier $47/mo)
4. OpenRouter API key with Gemini 3 Flash access
5. Stripe keys (test mode initial) — products created per `docs/SPRINT_PLAN_V0.md` § 3 (Sprint 6 will create the actual Stripe products)
6. Fly.io account + token (needed when Sprint 1 wires the deploy pipeline)
