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
- 20:44 — New Convex project **heymaya-creator** (team castrojoshua805), dev deployment `impressive-roadrunner-997`. Created with `arch -arm64 npx convex dev --once --configure new` (the Rosetta esbuild mismatch from the legacy repo applies here too: always `arch -arm64 npx convex …`). A separate **staging** project per §20 is still to be created.
- 20:50 — Scaffold committed on `creator`: Next 16.3 + Convex + Clerk + Stripe + PostHog + Zod; vitest + convex-test; deploy guards; CI. Dev keys copied from legacy `.env.local` with a real parser (the naive `source` echoed a Fly token into a shell error — rotate `FLY_API_TOKEN` for the retired product as hygiene). Server-side keys set on the dev deployment via `convex env set`.
- Confirmed `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.1-flash-lite` are all available on the key.
- ScrapeCreators endpoint additions for the doc after reading the full catalogue: **TikTok collection videos** (a creator's public collections = their own swipe file) and **Instagram story highlights** (what they choose to keep on their profile), both 1 credit at onboarding → dossier `interests`.
- 21:1x — ScrapeCreators wrappers pruned to the plan's set and extended: TikTok +`searchSuggestions`, `profileRegion`, `collectionVideos`, `popularCreators` with filters, `searchTop` with time/sort, `songVideos` cursor; retired `popularVideos/Hashtags/Songs` removed; `extractClipId` reads `music.id_str` and refuses unsafe numeric ids (scar tissue: TikTok ids > MAX_SAFE_INTEGER). Instagram +`search`, `searchPopular`, `searchProfiles`, `searchHashtag`, `reelsTrending`, `profilePostCount`, `highlights`, `highlightDetail`, `audioReels`; `profile`/`mediaTranscript` always pass `cache_max_age`; `post` takes a URL. New `platforms/cross.ts`: `findSocialProfiles`, `redditSearch`, `creditBalance`, `dailyUsage`, `mostUsedRoutes`, and `CREDITS_BY_PATH` (the endpoint cost table that `costEvents` reads; no endpoint without a cost). tsc clean, 12 tests green.
- Two audits (maya/agents, tests/scar) were killed by the session rate limit (resets 12:40am ET); relaunched. If they die again I finish them by hand after the reset.
- **Claw Messenger** (clawmessenger.com), asked about by Josh: an iMessage/RCS/SMS relay API, no Mac required, $5–50/mo by message volume, Agency $199/mo per subtenant; sends over a persistent WebSocket, inbound as WebSocket events (webhooks only for "approved managed setups"); an "agent line" can text a new number first (auto-registers it); registered-number caps per plan (1/5/20/50); throttles new-recipient conversations with 429s; no mention of Apple approval. The legacy product used it via an OpenClaw channel plugin and hit a real defect: the shared key is single-tenant, so a second creator's socket stole inbound and routed it to the wrong creator (observed 2026-05-16); isolation needs one tenant + key + route per creator via their `/api/tenants`, `/api/keys`, `/api/routes`. Verdict in the reply to Josh.
- 08:0x (machine clock) — **All four salvage audits done → `docs/SALVAGE_MANIFEST.md` (1,296 lines).** Part 4 has the numbered scar-tissue list (30 items with the guard each needs); Part 1 lists 50 more with file:line. Two items have no guard anywhere today: TikTok ids > MAX_SAFE_INTEGER (now guarded by `extractClipId`) and the half-dead ScrapeCreators cache (now replaced by `read()`).
- **`read()` cache layer live in code:** stable keys, in-flight claim (5 concurrent reads → 1 vendor call, tested), TTL per kind, `costEvents` per call. Finding: ScrapeCreators responses carry `credits_charged` (37 of 39 spec examples) → cost is **vendor-reported** when present, endpoint table otherwise. Spec corrections: Instagram comments cost **15** credits, Find Social Profiles **10** (both were 1 in the plan; fixed in §12.1).
- Legacy TikTok search option types were wrong (`this_week`, `likes`); replaced with the spec's `this-week`, `most-liked`, `date-posted`.
- Next: port the core PORT modules (llm, jobs, messages, plainLanguage, spendCeiling, breaker, directives, benchmarks, quality) adapted to the new schema; then Telegram webhook/pairing; then onboarding ingest.
- 08:1x — **Core modules ported and green: 180 tests, 0 type errors.** `convex/core/`: llm (with `costs.record` replacing the Fly-era cogs hook), jobs, messages (drafts hook removed; own-handle carve-out for the leak guard), pairing (Fly image tests dropped), plainLanguage, directives (legacy account→customer double lookup collapsed), breaker, quality, embeddings, delivery, cadence (timezone helpers only), plus founderDay/llmBudget tests. Schema aligned to the proven modules' field and index names (`messages.ts/body/awaitingAnswer/deliveredAt`, `jobs.deadlineAt/updatedAt/status succeeded`, `directives.verbatim/active/supersedesId`, `creators.pairingToken/telegramChatId`). Tests seed through one helper (`tests/lib/creatorRow.ts`) so a schema change is one edit.
- Parked in `pending/` (excluded from tsc/vitest) for adaptation: benchmarks (nicheCache→readCache), spendCeiling (planFeatures/gtmAuditEvents), cadence.test, modelSwap.test (needs directiveGate/publishDecision shapes), embeddings.test (buyerMap), sweepMapIsSingular.test (needs watchers).
- 08:3x — **Telegram layer adapted and green (183 tests).** `integrations/telegram/client.ts` ported and extended: inline-keyboard `buttons`, `message_reaction` updates, `answerCallbackQuery`, `setMessageReaction` (bot-side reactions, §21.5). `core/telegram.ts`: delivery as a job with `deliveredAt`/`deliveryError` proof, typing before slow work, `update_id` dedupe, inbound → `converse` job (no machine hand-off). `core/telegramFiles.ts`: oversize refused before the fetch, bytes to Convex storage, row + job. `telegram/webhook.ts` + `http.ts`: secret check, pairing with a talk-back on failure, first_read job on pair, buttons acked immediately, reactions recorded, unknown senders get the signup link. Pairing now also sets `channel.paired`.
- 08:5x — **Dispatcher + first real turns (185 tests).** `core/scheduler.ts`: `HANDLED_KINDS` = deliver_message · converse · first_read · ingest_catalogue, with a static test that every enqueued kind has a handler and every handler a producer. `crons.ts`: drain every minute. `agent/soul.ts` (§21 verbatim, versioned), `agent/registry.ts` (§4; writer google/gemini-3.7-flash via OpenRouter tonight, screener/critic z-ai/glm-5.3-flash, watch gemini-3.1-flash-lite direct), `agent/context.ts` (stable prefix → suffix, `produced` stamp), `agent/converse.ts` (minimal real turn; classifier/tools/critic are Sprint 3), `onboarding/firstRead.ts`, `onboarding/ingest.ts` (catalogue via `read()`, baseline + multiples, §13.1 sample, transcripts for the sample, one writer call → Zod-validated dossier → `first_read`). `contracts/dossier.ts` is the §14.1 schema. Watching (Gemini) is the next block.
