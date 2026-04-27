# HeyMaya

> **Maya is your AI manager — your operating layer before you can afford a human one.**

HeyMaya is a **dual-product** repo: one agent shape, two ICPs.

- **Creator product** — *Maya for creators (5K–500K followers).* Single-agent AI creator manager that lives in iMessage / WhatsApp / SMS / web chat. Plans content, watches posts, drafts brand-deal replies, holds the creator accountable. Grounded in real platform data via ScrapeCreators (27+ networks).
- **Service-business product** — *Maya for home-service businesses (1-25 trucks: plumbers, HVAC, roofers, electricians, cleaners, landscapers).* Same single-agent shape. Lives in the operator's text thread + on the phone (Studio voice). Turns every completed job into local marketing: GBP posts, review requests, brand-voice review replies, FB/IG content, lead-response nudges.

Single codebase, two product packs. Account-type fork at the routing layer (`accountType: 'creator' | 'service-business'` enum on the existing accounts table — additive, not a rename).

> **In v0, the creator product is flag-gated off in production.** `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT` defaults to `false`, which makes `/` the service-business landing and 308-redirects every creator URL (`/creators`, `/onboarding/maya`, creator HQ paths) to its service equivalent. All creator code, tests, schema, and Convex tables remain in the repo. Flip the env var to `true` to restore the dual-track public surface.

## Status

- **Creator product:** MVP-ready code-side but **suppressed behind `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT` (default `false`)** for v0. Sprints 0 → 6 done + Wave 6 smoke tests (1371/1371 tests, 0 TS errors). Code preserved in repo; one env flip re-exposes it. Operator-blocked on infra keys (see `CLAUDE.md` § Operator-required).
- **Service-business product:** Sprint 0 (scaffolding) **complete** on branch **`heymaya/service-v0`** (off `main`). Convex preview `heymaya-service-v0`. See `docs/SPRINT_PLAN_SERVICE_V0.md` for the locked 8-sprint v0 plan. Sprint 1 (Foundation) is next.

## Plans + working agreement

- `docs/SPRINT_PLAN_V0.md` — locked **creator** product v0 plan (8 sprints).
- `docs/SPRINT_PLAN_SERVICE_V0.md` — locked **service-business** product v0 plan (8 sprints, mirrors creator one-for-one for side-by-side compare).
- `CLAUDE.md` — coding conventions, architecture principles, what's NOT built, both-product status.

## Stack

Shared:
- Next.js 16 App Router · TypeScript · Tailwind · shadcn/ui
- Convex (backend, real-time, cron, storage)
- Clerk (auth, with `accountType` enum on user)
- Stripe (billing)
- OpenClaw single-agent on Fly.io (service product pins **>= 2026.2.26** for iMessage/voice CVE coverage)
- Composio v3 (Gmail, Stripe-as-data, Google Calendar)

Creator-only:
- Stripe tiers $19.99 / $39.99 / $79.99 + annual
- Gemini 3 Flash via OpenRouter with **thinking-budget routing (single model)**
- ScrapeCreators (27+ social platforms read layer)
- Composio brand-outreach writes (Apollo / Hunter)

Service-business-only:
- Stripe tiers $99 / $149 / $199 + annual
- **Dual-model routing** — Gemini 3 Flash (high/medium-stakes) + Gemini 3.1 Flash Lite (routine class). Action-level routing; service product breaks creator's single-model principle on purpose for cost economics.
- ElevenLabs Agents inbound voice + OpenClaw native outbound voice-call (Studio); Twilio per-customer number ($1.15/mo)
- Zernio (Late) MCP for FB/IG/TT/LI/YT/X/Pin/TG/Threads posting; **direct Google Business Profile API** for review-reply (high-stakes)
- CRM via aggregators: Jobber + HCP via Nango; QBO via Apideck or Unified.to (Sprint 4 spike); ServiceTitan direct (Sprint 7+, partner-gated)

## Local setup

```bash
npm install
cp .env.example .env.local   # then populate keys (see CLAUDE.md § Operator-required)
npx convex dev --configure   # creates fresh Convex project on first run
npm run dev
```

App runs at http://localhost:3000.

## Architecture in one sentence

The product is the agent — in the creator's messenger, or in the service operator's text thread + phone. The web app is the receipt. Maya is a single OpenClaw agent configured by per-account `soul.md` + shared `playbook.md` / `cron.md` / `skill.md` (creator) or `AGENTS.md` / `HEARTBEAT.md` / `jobs.json` (service). Convex stores what Maya writes; the 6-screen HQ reads.

## Repo

- `app/` — Next.js routes (`(creator)/` HQ, `(business)/` HQ, onboarding splits, marketing landing, API)
- `convex/` — backend (schema with both creator and service tables, integrations, agent packs, model router, onboarding pipelines)
- `agents/skills/` — Maya's shared `.md` files + custom skill packages (`maya-*` for creator, `maya-service-*` for service)
- `components/` — shadcn primitives + creator HQ + business HQ + onboarding
- `docs/` — sprint plans, architecture, research (`docs/research/`)
- `e2e/` — Playwright
- `scripts/` — fixture corpora (50-creator + 50-business), load tests

## Required reading before contributing

1. `CLAUDE.md` — coding conventions, architecture principles, dual-product status, what's NOT built
2. The sprint plan for the product you're working on:
   - Creator → `docs/SPRINT_PLAN_V0.md`
   - Service-business → `docs/SPRINT_PLAN_SERVICE_V0.md`
3. The behavioral spec when it exists:
   - Creator → `agents/skills/maya-platform/playbook.md` (Sprint 3)
   - Service → `agents/skills/maya-service-platform/AGENTS.md` (Sprint 3)

## Branches

- `main` — creator product trunk
- `heymaya/service-v0` — service-business product v0 work (currently active)

## License

Private. All rights reserved.
