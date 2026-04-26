# HeyMaya

> **Maya is your AI creator manager — your operating layer before you can afford a human one.**

Single-agent AI manager that lives in iMessage / WhatsApp / SMS / web chat. Plans content, watches your posts, drafts brand-deal replies, holds you accountable. Grounded in your real platform data, not generic GPT advice.

## Status

**Sprint 0** — repo bootstrap. See `docs/SPRINT_PLAN_V0.md` for the locked 8-sprint v0 plan and `CLAUDE.md` for the working agreement.

## Stack

- Next.js 16 App Router · TypeScript · Tailwind · shadcn/ui
- Convex (backend, real-time, cron, storage)
- Clerk (auth)
- Stripe (billing — $19.99 / $39.99 / $79.99 + annual)
- OpenClaw 4.12 single-agent on Fly.io (Maya runtime)
- Gemini 3 Flash via OpenRouter with thinking-budget routing (single model)
- ScrapeCreators (27+ social platforms read layer)
- Composio v3 (Gmail, Stripe-as-data, Calendar, brand outreach write layer)

## Local setup

```bash
npm install
cp .env.example .env.local   # then populate keys (see CLAUDE.md § Operator-required)
npx convex dev --configure   # creates fresh Convex project on first run
npm run dev
```

App runs at http://localhost:3000.

## Architecture in one sentence

The product is the agent in the messenger. The web app is the receipt. Maya is a single OpenClaw agent configured by per-creator `soul.md` + shared `playbook.md` / `cron.md` / `skill.md`. Convex stores what Maya writes; the 6-screen Creator HQ reads.

## Repo

- `app/` — Next.js routes (creator HQ, onboarding, marketing landing, API)
- `convex/` — backend (schema, integrations, agent packs, model router, onboarding pipeline)
- `agents/skills/` — Maya's shared `.md` files + custom ClawHub-compatible skill packages
- `components/` — shadcn primitives + creator HQ + onboarding
- `docs/` — sprint plan and architecture
- `e2e/` — Playwright
- `scripts/` — fixture corpus, load tests

## Required reading before contributing

1. `CLAUDE.md` — coding conventions, architecture principles, what's NOT built
2. `docs/SPRINT_PLAN_V0.md` — current sprint, acceptance gates, test plans
3. `agents/skills/maya-platform/playbook.md` (when it exists, Sprint 3) — Maya's behavioral spec

## License

Private. All rights reserved.
