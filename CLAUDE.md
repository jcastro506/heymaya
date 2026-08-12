# HeyMaya

## What this is

**Maya is a social media manager you employ.** She runs one business's social accounts — watches the niche, makes the content, posts it, and answers everyone who replies — in the founder's voice. You manage her by text, in Telegram.

> **"An employee, not a tool."**

Target customer: a solo founder who built something good and can't get customers.

The pitch is **not** "she posts for you" — open-source schedulers do that for free. It's that **she does the homework**: she watches what's actually working in the niche, mines what buyers are complaining about, and *then* writes.

**Channels: TikTok · Instagram · YouTube · X.** Three of the four take the same 9:16 vertical asset, so the media pipeline is a 3× multiplier rather than a cost centre. X carries text and conversation.

## Source of truth

**`docs/CLEAN_SHEET_SPEC.md`** is the product and technical spec; the sprint plan is its §18. Read it before any substantive work. If a suggestion contradicts it, default to the spec unless the operator explicitly revises it.

`docs/AGENT_REDESIGN_V2.md` is the *previous* design (intent-hunting on Reddit/X). Superseded — history, not decisions.

## Deleted products — do not resurrect

Two earlier products were removed in Sprint 0 (~380 files, ~126k lines):

- **Creator Maya** — an AI manager for content creators. Suppressed, then deleted.
- **Maya for service businesses** — plumbers/HVAC/roofers, GBP-driven. Abandoned, then deleted.

Their code, tests, routes, skills, and docs are gone (recoverable from git history). **71 of the 142 Convex tables belong to them and remain in `schema.ts`** — orphaned and inert, pending Sprint 0b.

Everything under `convex/gtmMaya/` is the **current** product. It is **frozen** — bug fixes only — and is replaced module-by-module by `convex/maya/` per the sprint plan.

## Architecture principles

1. **The product is the agent in the messenger.** The dashboard is connect + receipts, never a workbench.
2. **The database is the truth; the model is a participant.** No fact lives only in a context window.
3. **Deterministic code watches; the model judges.** Collection, scheduling, rate-limiting, and enforcement are code.
4. **Anything promised to the user is enforced by the server.** Prompts drift; rows don't.
5. **Nothing fails silently.** Every job produces a result or a named failure that reaches the user.
6. **The unit of work is a placement** — something live, with a URL. Drafts and found threads are inventory, not results.
7. **Grounded or silent**, extended to images and video. Never a fabricated UI or an invented number.
8. **Choreography rides in tool responses, never prompts.** `{ok, data, next, why}` reaches every model on every turn.
9. **Exactly one function decides publish-or-hold.** Any other code path that can hold a post is a bug.
10. **Budgets, never booleans.** `videosPerMonth: 0` degrades gracefully; `canVideo: false` ships a broken tier.

## Tech stack

- **Frontend:** Next.js 16 App Router, TypeScript, Tailwind, shadcn/ui, dark by default
- **Backend:** Convex — functions, crons, reactive queries
- **Auth:** Clerk · **Billing:** Stripe
- **Agent runtime:** OpenClaw on Fly.io, one persistent session per customer
- **Messenger:** Telegram
- **Publish + own-account reads:** Zernio — ⚠️ **TikTok exposes no comment API at all**, so TikTok is publish-only
- **Outside-world reads:** ScrapeCreators, plus twitterapi.io for X — the perception layer, and the moat
- **Creative:** direct model calls for static/daily; Creatify for weekly assembled video
- **Storage:** Cloudflare R2

## Coding conventions

- TypeScript strict mode everywhere
- Convex `actions` for external calls, `mutations` for writes, `queries` for reads
- External API clients live in `convex/integrations/` — vendor SDKs, never product logic
- Platform expertise lives in `.md` files, **never** in `if (channel === …)` branches
- Environment variables for all keys; never hardcoded
- **Assert on structure and stable identifiers, never on generated prose.** Prompt text changes weekly; a test that substring-matches it is a false-alarm generator.
- **Justify every `TODO`/`FIXME`/`eslint-disable`** — on the line, or on a comment line directly above it

## Testing — non-negotiable

Five mandatory categories every sprint: cross-tenant isolation · budget × action fail-closed · adversarial input · sibling-file coherence · TODO grep.

Plus the gates in `docs/CLEAN_SHEET_SPEC.md` §18.0 — most importantly: **the exit criterion must be demonstrated on a live deploy, not in a test harness.** Every failure in this product's history passed its tests and broke in production.

CI (`.github/workflows/ci.yml`) runs typecheck + tests on `staging` and `main`. Lint is non-blocking pending cleanup of ~1,178 pre-existing violations.

**Gotcha:** a stale `.next` cache produces phantom `tsc` errors after deleting routes. `rm -rf .next`.

## Environments

| | Branch | Convex | Vercel |
|---|---|---|---|
| Local | `codex/*` | `dev:vibrant-platypus-264` | no build |
| Staging | `staging` | `dev:precise-canary-781` | Preview |
| Production | `main` | prod | `hey-maya.ai` |

Repo `jcastro506/heymaya` · Vercel project `hey-ava-web`. Pushes to `staging` and `main` deploy; `codex/*` does not. Detail in `docs/DEPLOYMENT_ENVIRONMENTS.md`.

> ### ⚠️ `npx convex deploy` deploys to **PRODUCTION**
>
> It ignores `CONVEX_DEPLOYMENT` entirely. Running it after merging a PR — from
> `staging`, where you already are — ships every unreleased commit to prod.
> This happened on 2026-08-11: 27 commits reached prod's backend while prod's
> Vercel was still serving `main`.
>
> - **Staging:** `npm run convex:staging`
> - **Production:** `npm run convex:prod` — refuses unless you are on `main` with a clean tree



## Status

**Sprint 0a complete** (branch `codex/sprint0-test-baseline`): test baseline greened, dead products deleted, CI added, orphan scripts and the legacy second dashboard removed. 0 typecheck errors, all tests passing.

**Next — Sprint 0b:** prune the 71 orphaned tables. Requires careful surgery on the shared `stripe` / `zernio` / `billing` / `accountDeletion` modules the live product depends on, which is why it wasn't bundled with the module deletion.

**Then Sprints 1–12** per §18. **Sprint 3 is the gamble** — one channel, a placement a day, seven days straight, verified. Nothing past it is worth building until it holds.

## Operator-required (not Claude-doable)

1. Creatify API access **and written commercial resale rights** — blocks generated video
2. ScrapeCreators Enterprise conversation — ~330k requests/month at 200 customers
3. Decide the Fly runtime shape — **auto-stop vs always-on is a 10× cost difference** (§17.36)
4. Run the scrape-reliability spike (§6.4.6) — 20 URLs, one afternoon, decides whether a headless browser is needed at all
