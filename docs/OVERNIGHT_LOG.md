# Overnight log — Sprint 0 → Sprint 2, night of 2026-09-01

Running handoff. Newest at the bottom. Read the **Blocked on you** section first.

## Blocked on you (morning list)

1. **ScrapeCreators credits: balance is 0.** Every live read, fixture recording, the social-URL reliability spike and the 20-clip watch probe are blocked. $47 buys 25,000 credits at scrapecreators.com. Until then, wrappers and fixtures are built from the vendor's OpenAPI examples and marked `fixture: spec-example`; swap to `fixture: recorded` after purchase (one script: `npm run fixtures:record`).
2. **Telegram bots.** Tonight uses the local test bot `@mayatesstteest_bot` (the token in the legacy `.env.local`) for the new dev deployment. Create two more through BotFather for `creator` (staging) and `creator-main` (prod) when you're up.
3. **Clerk.** Tonight reuses the legacy `pk_test`/`sk_test` development instance. A production instance is needed before Sprint 3.
4. **Google Cloud.** An OAuth client already exists (localhost redirect). It needs the staging/prod redirect URIs added and the sensitive-scope verification video submitted.
5. **Meta developer app + Business Verification** for the Instagram App Review (6–8 weeks; the long pole). **Apple Messages for Business** application through an MSP.
6. Stripe products/prices for §19 can be created by API in test mode tonight; **live-mode** products need you.

## Guardrails held tonight

- Nothing touches `main`, `staging`, the production Convex deployment, or the production Telegram bot.
- Vendor spend cap ≈ $25, itemised below. (ScrapeCreators spend is $0 tonight by necessity.)
- No secrets committed. `.env.local` in the worktree is gitignored; keys copied from the legacy tree by hand.
- Commits go straight to `creator` tonight; every commit message says what and why.

## Environment facts verified at 2026-09-01 late evening

| Thing | State |
|---|---|
| `gh` | logged in as jcastro506 |
| `vercel` | logged in as jcastro506 |
| Convex CLI | logged in (`~/.convex/config.json`) |
| Gemini key | live; `gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemini-3-flash-preview` visible; 3.7 to be confirmed |
| OpenRouter key | live |
| ScrapeCreators key | live, **0 credits** |
| Telegram | local token = `@mayatesstteest_bot` (test bot) |
| Stripe | `sk_test_…` (test mode), webhook secret present |
| Clerk | `pk_test_…` (development instance) |
| Google OAuth client | exists, localhost redirect only |
| Zernio key | present (not exercised tonight; Sprint 4) |

## Git

- `legacy` branch + tag `legacy-2026-09-01` = today's `main` (`347899e`).
- `creator` = orphan branch, worktree at `../heymaya-creator`.
- `codex/creator-sprint-plan` = the plan on the legacy tree (for the PR record).

## Timeline

- 23:xx — decision: same repo, orphan branch. Worktree created. Four salvage audits running (web/infra done; maya/agents, integrations/schema, tests/scar pending).
