# HeyMaya — AI Creator Manager

## What this is

**Maya** is a single-agent AI creator manager. One creator → one Maya. Lives in iMessage / WhatsApp / SMS / web chat. Runs the operational layer of a creator career: content planning, performance analysis, brand-deal triage, accountability, growth strategy.

> **"Your AI creator manager before you can afford a human one."**

This is a fresh consumer SaaS product. Branded HeyMaya. Target customer: creators with 5K–500K followers who want the operational structure of a manager but aren't big enough to attract or afford one.

## Source of truth

**`docs/SPRINT_PLAN_V0.md`** is the locked v0 plan. Read it first. If a future suggestion contradicts something in there, default to the plan unless the operator explicitly revises it.

## Tech stack

- **Frontend:** Next.js 16 App Router, TypeScript, Tailwind CSS, shadcn/ui (initialize in Sprint 0)
- **Backend:** Convex (separate project from any prior LaunchCrew Convex)
- **Auth:** Clerk
- **Billing:** Stripe (Starter $19.99 / Pro $39.99 / Studio $79.99 + annual variants)
- **Agent runtime:** OpenClaw 4.12, single-agent solo deploy variant on Fly.io shared multi-tenant
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

**Current sprint:** Sprint 0 — Branch & infra (in progress during repo bootstrap).

**Next sprint after S0:** Sprint 1 — Foundation. ScrapeCreators integration, model + thinking router, solo OpenClaw deploy variant, schema, fixture corpus.

**See `docs/SPRINT_PLAN_V0.md` § 5 for the full 8-sprint roadmap and § 10 for testing strategy.**

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
