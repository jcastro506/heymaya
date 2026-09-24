@AGENTS.md

# HeyMaya — Maya for TikTok and Instagram creators

## What this is

**Maya is a social media expert who texts you.** She watches your lane on TikTok and Instagram, reads your own numbers, finds what's working, and texts you the idea worth making, in Messages. The **companion iPhone app** is the closet: every idea, your numbers, your plan, and deals. Messages is the only place she talks; the app has no chat box, and a push is never her voice.

> Grounded or silent. Trust her judgment; code gathers facts and enforces promises.

## Source of truth

- **`docs/CREATOR_MASTER_PLAN.md`**: every sprint in one dependency-ordered list, with status and operator blockers. Start here.
- `docs/CREATOR_COMPANION_APP_SPEC.md`: the app (decisions §0, sprints M/C/P/I).
- `docs/CREATOR_MAYA_EXPERTISE_AUDIT.md`: her brain (sprints B0–B6, the Expert Bench).
- `docs/CREATOR_COGS_MODEL.md` + `scripts/cogs/model.py`: costs and margin.
- `docs/CREATOR_SPRINT_PLAN.md`: the original build plan (history for the earlier sprints).

This branch replaced the **founder product** (Maya as a social media manager for founders, `convex/gtmMaya`, Mission Control) on `staging` on 2026-09-24. That product's history is kept in git, and its Convex tables are untouched on staging (Convex keeps tables a schema doesn't name). Don't resurrect its code from history without the operator.

## Architecture principles

1. **The product is the agent in Messages.** The app is inventory and receipts, never a second chat.
2. **The database is the truth; the model is a participant.** No fact lives only in a context window.
3. **Deterministic code watches; the model judges.** Collection, scheduling, rate limits and enforcement are code; causes, taste and wording are hers.
4. **Anything promised to the user is enforced by the server.** Prompts drift; rows don't. (The daily text cap is held inside `messages.send`; the crisis line is appended by code.)
5. **Nothing fails silently.** Every job produces a result or a named failure; the critic ladder never ends in silence.
6. **Grounded or silent**, extended to images, video and the real world. Never an invented number, cause, place or date.
7. **Every app action has a chat equivalent**, through one shared function (`core/ideaActs`, `calendar/tools`).
8. **One definition per fact:** "normal" (`core/normal`), "unseen" (`core/unseen`), "counts toward the cap" (`messages.countsTowardCap`).
9. **Budgets, never booleans.**

## Tech stack

- **Backend:** Convex (functions, crons, reactive queries). Mutations use the wrapped builders in `convex/lib/functions` (a trigger keeps the slim `schedule` rows in sync); a test fails if a module skips them.
- **iPhone app:** native SwiftUI, iOS 18+, in `apps/ios` (XcodeGen; `-MayaFixtures` launch argument for preview data). Targets: `Maya`, `MayaShare` (Send to Maya), `MayaWidget`.
- **Web:** Next.js App Router: landing, legal pages, `/o/*` link fallbacks, the AASA file, `/ops`.
- **Auth:** Clerk · **Billing:** Stripe (link-out from the app) · **Messages:** Claw/Linq (iMessage/RCS/SMS), Telegram for dev.
- **Reads:** ScrapeCreators (public), Zernio (their connected accounts). **Models:** OpenRouter (writer, critic, judge), Gemini (watching video).

## Coding conventions

- TypeScript strict. Convex `actions` for external calls, `mutations` for writes, `queries` for reads.
- A query must not call another query through `ctx.runQuery` (generated types collapse to `any`); share a helper function instead.
- Assert on structure and stable identifiers, never on generated prose.
- Justify every `TODO` / `FIXME` / `eslint-disable` on the line or the line above.
- User-facing copy: plain words, no "AI", no vendor names, no "baseline". `convex/core/__tests__/iosCopy.test.ts` checks the app's strings.

## Testing — non-negotiable

Five categories every sprint: cross-tenant isolation · budget/fail-closed · adversarial input · sibling-file coherence · TODO grep.

**Her brain is measured, not assumed:** `eval/expertBench:start` runs the Expert Bench (TikTok, Instagram, safety, both-platform cases) on scenario personas with a correctness judge; `eval/expertBench:scorecard` reads a run. Run it before and after any prompt or model change. A green unit suite has never been proof a behaviour works: run it live.

## Environments

| | Git branch | Convex | Web |
|---|---|---|---|
| Creator dev | `codex/*`, `claude/*` | `dev:impressive-roadrunner-997` | local |
| Staging | `staging` | `dev:precise-canary-781` | Vercel preview |
| Production | `main` | prod (`resilient-mandrill-621`) | `hey-maya.ai` |

Work reaches `staging` and `main` **only by PR and merge**; Vercel deploys on the merge.

> ### ⚠️ `npx convex deploy` deploys to **PRODUCTION**
> It ignores `CONVEX_DEPLOYMENT` entirely (2026-08-11: 27 unreleased commits reached prod).
> - Creator dev: `CONVEX_DEPLOYMENT=dev:impressive-roadrunner-997 npx convex dev --once --typecheck disable`
> - Staging: `npm run convex:staging`
> - Production: `npm run convex:prod`, which refuses unless you're on `main` with a clean tree.

After a deploy that adds the `schedule` table to a deployment, run `npx convex run core/schedule:reconcile` once (it's also the nightly repair).
