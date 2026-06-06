# HeyMaya — Pre-Launch TODO (the work to do before we go live)

Action list to get the GTM product (Maya) live at MVP. Companion to `GO_LIVE_MVP_CHECKLIST.md` (status) and `CLAWLAUNCH_API_DEPTH_SPRINT_PLAN.md` (API build).

**Priority:** **P0** = hard launch blocker · **P1** = needed for a good launch · **P2** = fast-follow
**Owner:** 🛠️ build (Claude) · 👤 operator (account/key/decision) · 🤝 both

---

## A. Agent correctness (the product has to work)
- **P0 🛠️ Grounds the RIGHT product.** Force a landing-page read first; build the buyer map from the real landing + `founderWhy`; add "you are not the product, never describe your own runtime." *(Observed a run hallucinate a fictional product.)*
- **P0 🛠️ Synthesis reliably DELIVERS the plan.** Deterministic safety-net: if `foundationComplete` but no synthesis delivered in N min (or the LLM turn keeps failing), assemble the plan from stored foundation data and send it. The plan = who buys, WHERE I post (bets + why), WHAT posts, connect ask.
- **P1 🛠️ Grounded status answers** (already prompt-fixed) — verify live: "how's it going?" mid-onboarding reports real state, no fake "quiet week."
- **P1 🤝 Clean full-day cadence run** — morning brief / midday pulse / evening recap fire once each, grounded, no duplicate/fabricated brief, no loop, heartbeat quiet.
- **P2 🛠️ Tighten path-guessing** (`~/workspace` vs `/data/workspace`) and the native `web_search`-is-off confusion (steer to `search_web`).

## B. ZERNIO (posting + analytics backbone) — its own section
- **P0 👤 Account + payment method.** ✅ Card added + verified (X connect now works). Confirm it's on the account that owns our `ZERNIO_API_KEY` (it is).
- **P0 👤 Enable the ADD-ONS we depend on.** Several features fail-closed to `addonRequired` without them:
  - **Analytics add-on** → `get_account_analytics`, `get_post_timeline`, `get_best_time`, `get_follower_stats` (the closed-loop moat + scheduling).
  - **Inbox add-on** → `list_inbox`, `reply_to_comment`, comment-to-DM (the engagement loop).
  - Decide which are MVP vs fast-follow; enable the MVP ones.
- **P0 🤝 Live-verify posting per channel** (needs a connected account):
  - X / LinkedIn / IG / YouTube **auto-post** actually publishes.
  - **first-comment** drops the link in a comment (LinkedIn/IG/YT), caption clean.
  - **Reddit / TikTok** one-tap-confirm card fires + posts on tap; ban-safety FORCE gate holds.
  - **Spread across the day** (scheduling / best-time), not all at 9am.
- **P1 🛠️ Reddit flair pre-flight** (`reddit-flairs`/`reddit-subreddits`/validate) — cuts Reddit's ~54% post-failure rate. (S1 tail.)
- **P1 🛠️ TikTok consent + creator-info** pre-fetch (`contentPreviewConfirmed`/`expressConsentGiven` camelCase) so the one-tap card carries valid settings.
- **P0 🤝 Turn on the connection webhook (2 operator steps).** The reliable connect path is BUILT (`/lc_gtm/zernio_webhook` receiver + `account.connected` reconcile + read-path self-heal + don't-burn-token-on-empty + `twitter`→`x` fix). To activate: (1) set `ZERNIO_WEBHOOK_SECRET` in the Convex deployment env (any strong random string); (2) run `npx convex run gtmMaya/zernioWebhook:ensureZernioGtmWebhook` once to register the webhook with Zernio. Then re-test: tap a connect link, complete "Allow", confirm the account persists + Maya texts "an account just connected."
- **P1 🛠️ Zernio webhooks (remaining events)** — `post.published`/`post.failed` are already subscribed (audit-logged); wire them to flip calendar/draft post status, and add `comment.received` for lower-latency inbox vs polling. (S2.)
- **P1 🤝 Respect Zernio rate/velocity limits** — 15 posts/hr/account, daily platform caps; ensure Maya's cadence stays under them (graceful 429/Retry-After handling).
- **P1 🤝 X pass-through cost monitoring** — X charges per API call; with the card on file the operator covers it, so add cost visibility/caps so a runaway agent can't rack up X charges. (Also: prefer `quoteTweetId` over URL-in-text — 13× cheaper — S1 tail.)
- **P1 🛠️ Multi-tenant Zernio isolation** — each agent gets its own Zernio profile (`createProfile` per agent); verify one user's connected accounts are never reachable by another (cross-tenant test). The post path already resolves the account from the agent's own `connectedAccountsJson`.
- **P2 🛠️ Zernio outage / token-refresh handling** — reconnect-needed detection (`accounts/health`), graceful degrade when Zernio is down, surface "reconnect X" to the founder in plain words.
- **P2 🛠️ Delete dead legacy Zernio GBP paths** (`/api/v1/locations` etc. — 404, service product abandoned).

## C. Billing (can't charge without it)
- **P0 🛠️ Stripe $99 checkout** + subscription lifecycle (create products, checkout, webhook, trial→active→cancel).
- **P0 🛠️ `planFeaturesGtm` server-side gating** — GTM is currently UNGATED. Add fail-closed entitlement checks at every paid entry point.
- **P1 🤝 COGS model** — per-customer monthly: ScrapeCreators credits + twitterapi + DataForSEO + OpenRouter (now Groq `:nitro`, ~1.6×) + Zernio sub/add-ons + X pass-through + Fly machine. Confirm it clears under $99.

## D. Multi-tenant onboarding & infra
- **P0 👤🛠️ Per-user Telegram** — today it's ONE shared test bot (Tommy). Real users need their own bot token or a shared bot with per-user routing. (The S8 "multi-tenant Telegram" launch prereq.)
- **P0 👤 Production infra** — Convex prod, Clerk prod keys, Fly prod org/token, production API keys at scale, OpenRouter spend alerts.
- **P1 👤 Promote current code to prod** — `www.hey-maya.ai` is on an 11-day-old `main`; merge current → main → deploy.
- **P1 🛠️ Landing page cleanup** — remove the retired "tap, paste, post / Google Calendar" section (staging still shows it).
- **P1 🛠️ Connect flow in the web app** (not just Telegram) — a founder who's on the dashboard should be able to connect there too.
- **P2 🛠️ UI receipts (S6)** — render the per-channel scorecard ("where your buyers are") + competitor-ads view + closed-loop results.

## E. Trust, safety, legal
- **P0 👤 Legal** — ToS + Privacy; explicit "Maya posts under your name" consent at connect; X/TikTok platform-compliance review.
- **P1 🛠️ Cross-tenant isolation tests** green (mandatory category) — data + posting.
- **P1 🛠️ Ban-safety holds** — FORCE gate on Reddit/TikTok, safety-critic on every outbound, warmth gating on cold accounts.

---

## The P0 critical path (do these, in roughly this order)
1. 🛠️ Grounding fix + synthesis safety-net (A) → re-test with a **real non-AI-agent product**.
2. 🤝 Connect a Zernio account + enable Analytics/Inbox add-ons → **live-verify posting** (B).
3. 🛠️ Stripe + `planFeaturesGtm` (C).
4. 🛠️👤 Per-user Telegram + prod infra (D).
5. 🤝 One clean full-day cadence run (A) + cross-tenant tests (E).
6. 👤 Promote to prod, landing cleanup, legal.

Then: pilot with a handful of real founders before opening up.
