# HeyMaya (GTM / Maya) — Prod-Readiness Checklist

**Last updated:** 2026-06-07. Grounded in the actual `convex env list` on staging (`precise-canary-781`) + every `process.env.*` the code requires. This is the definitive "what must be true to go live" list.

**Legend:** ✅ set/working on staging · 🔴 missing/blocked · 👤 operator action (account/key/dashboard) · 🛠️ Claude/code · ⚠️ test→prod swap needed

---

## PART A — Zernio (social connect + posting) — the current hard blocker

Maya generates valid connect links and our webhook/reconcile work, but **OAuth completions are not landing accounts in Zernio** (reconcile against Zernio's API = 0 accounts; X fails outright). Our code side is done; the gap is Zernio-platform OAuth/app config.

### A1. Verify Zernio account + plan (👤)
1. Log into the **Late / Zernio dashboard** (the account that owns `ZERNIO_API_KEY = sk_aecc...`).
2. Confirm a **payment method** is on file (✅ done per prior session — X connect needs it).
3. Confirm which **add-ons** are enabled — these gate features that otherwise fail-closed:
   - **Analytics add-on** → `get_account_analytics`, `get_post_timeline`, `get_best_time`, `get_follower_stats` (the closed-loop attribution moat + scheduling).
   - **Inbox add-on** → `list_inbox`, `reply_to_comment`, comment-to-DM (engagement loop).

### A2. The connect diagnostic — DO THIS FIRST (👤, 5 min)
This single observation tells us whether the remaining fix is ours or Zernio's:
1. Have Maya send a connect link (or generate one). Tap it on a device, complete "Allow".
2. **Open the Zernio dashboard → Accounts/Profiles. Does the account appear there?**
   - **YES (in Zernio)** → it's OUR webhook/reconcile. Tell Claude — fast fix. (Unlikely; reconcile already returns 0.)
   - **NO (not in Zernio)** → it's **Zernio's OAuth/app config** (A3 below).
3. Start with **Reddit or LinkedIn** (not X) — they're the least finicky OAuth. If Reddit lands and X doesn't, it confirms an **X-app-specific** problem.

### A3. Per-platform OAuth setup in Zernio (👤)
Each platform must be enabled/configured in the Zernio dashboard. Known gotchas:
- **X (Twitter):** the link requests broad scopes (`tweet.write`, `media.write`, `dm.read`, `dm.write`). These require **elevated X API access** on Zernio's X app. Verify Zernio's X integration is fully set up; this is the most likely reason X "doesn't work."
- **TikTok:** requires content-posting consent + creator-info; verify TikTok is enabled in Zernio.
- **Instagram / YouTube / LinkedIn / Reddit:** confirm each is enabled.
- If accounts never appear in Zernio after authorizing → **contact Late/Zernio support**: "OAuth completes but the account doesn't attach to my profile."

### A4. Webhook (✅ done — keep)
- `ZERNIO_WEBHOOK_SECRET` ✅ set. Webhook registered (id `6a24a420242a7c2a73efd096`) → `/lc_gtm/zernio_webhook`.
- Re-run if ever needed: `arch -arm64 npx convex run gtmMaya/zernioWebhook:ensureZernioGtmWebhook '{}'`
- On prod: must re-register against the **prod** `CONVEX_SITE_URL` (see Part C).

### A5. Code side (✅ done — no action)
- `get_connect_links` mints per-agent-profile OAuth URLs · per-agent Zernio profile auto-created · webhook + reconcile + callback wired · `twitter`→`x` slug fix · don't-burn-token-on-empty. Verified.

---

## PART B — External services + keys (what the product needs)

All ✅ are set on **staging**. For **prod** every one must be re-set on the prod Convex deployment (Part C), and the ⚠️ ones swapped from test→live.

| Service | Env var(s) | Staging | Prod action |
|---|---|---|---|
| **Convex** (backend) | (deployment itself) | ✅ `precise-canary-781` | 👤 create **prod** deployment (`npx convex deploy --prod`) |
| **Clerk** (auth) | `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ (dev instance) | ⚠️👤 create Clerk **production instance**, swap to prod keys, set the prod JWT issuer + allowed origins for the prod domain |
| **Stripe** (billing) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, **`STRIPE_PRICE_GTM99_MONTHLY`** (+ optional `_ANNUAL`) | ✅ secret/webhook (test) · 🔴 **GTM99 price MISSING** | ⚠️👤 create the **$99/mo product + price** (test now, **live** for prod), set `STRIPE_PRICE_GTM99_MONTHLY`; swap to **live** secret + a **live** webhook endpoint pointed at the prod domain |
| **OpenRouter** (brain — Gemini 3 Flash) | `OPENROUTER_API_KEY`, `OPENROUTER_DEFAULT_MODEL` | ✅ | 👤 set a **spend cap + alerts** in the OpenRouter dashboard before scale |
| **Gemini** (video-watch, image) | `GEMINI_API_KEY` | ✅ | 👤 confirm quota for prod scale |
| **ScrapeCreators** (read layer) | `SCRAPE_CREATORS_API_KEY`, `SCRAPE_CREATORS_BASE_URL` | ✅ | 👤 confirm tier covers prod volume |
| **twitterapi.io** (X research) | `TWITTERAPI_IO_KEY` | ✅ | — |
| **DataForSEO** (demand/search) | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | ✅ | — |
| **Zernio/Late** (post+analytics) | `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET` | ✅ | 👤 Part A; re-register webhook on prod URL |
| **Fly.io** (agent machines) | `FLY_API_TOKEN`, `FLY_ORG_SLUG`, `FLY_REGION` | ✅ | 👤 confirm prod org + billing; the OpenClaw image pin |
| **video-synth-worker** (yt-dlp→Gemini watch + video gen) | `VIDEO_SYNTH_WORKER_URL`, `USE_VIDEO_SYNTH_WORKER`, `WORKER_SHARED_SECRET` | ✅ (`heymaya-video-synth.fly.dev`) | 👤 confirm the worker is deployed + healthy for prod |
| **Telegram** (the messenger) | `TELEGRAM_BOT_TOKEN(_PRODUCTION)`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | ✅ (shared test bot @Tommymmymmymm_bot) | ⚠️👤 **per-user bots** for real multi-tenant (see Part D), or a prod shared bot |
| **PostHog** (telemetry) | `POSTHOG_KEY`, `POSTHOG_HOST` | ✅ | — |
| **R2** (media/attachment bridge) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | ⚠️ verify set | 👤 confirm bucket for prod |
| **Encryption / secrets** | `ENCRYPTION_KEY`, `WEBHOOK_INTERNAL_SECRET`, `CRON_SECRET`, `ADMIN_DASH_TOKEN` | ✅ | 👤 generate **fresh** values for prod (do not reuse staging) |
| **App URL** | `APP_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` | ✅ (staging URLs) | ⚠️👤 set to the **prod domain** |
| `CONVEX_SITE_URL` | (auto-provided by Convex) | ✅ auto | auto on prod |

**Spend-cap knobs (optional, code-defaulted):** `GTM_AGENT_KILL_HOURLY_USD` ($3), `GTM_AGENT_KILL_DAILY_USD` ($6), `GTM_TRIAL_DAYS` (7). Set explicitly on prod if you want different ceilings.

---

## PART C — Prod cutover (the actual go-live sequence)

1. 👤 **Convex prod:** `npx convex deploy` to a prod deployment. Note its `.convex.site` URL.
2. 👤 **Set every env var from Part B** on the prod deployment (live Stripe, prod Clerk, fresh secrets, prod `APP_URL`).
3. 👤 **Create the $99 Stripe product** (live mode) → set `STRIPE_PRICE_GTM99_MONTHLY`.
4. 👤 **Stripe webhook (live):** add an endpoint → `https://<prod-domain>/api/billing/stripe-webhook`, copy its signing secret → `STRIPE_WEBHOOK_SECRET`. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`.
5. 👤 **Clerk prod:** production instance, set publishable/secret + JWT issuer; add the prod domain to allowed origins.
6. 👤 **Zernio webhook on prod:** `npx convex run gtmMaya/zernioWebhook:ensureZernioGtmWebhook` against prod (re-registers to the prod URL) + finish Part A.
7. 👤 **Telegram on prod:** per-user bots (Part D) or a prod shared bot; set the webhook to the prod machine URL.
8. 👤 **Frontend (Vercel):** point the prod domain (`www.hey-maya.ai`) at the current branch (it's on an 11-day-old `main` — merge + deploy current).
9. 🛠️ **Push the branch:** `sprint/data-collection` is 4+ commits ahead, unpushed → push + merge to `main`.
10. 👤 **Spend alerts:** OpenRouter cap, Fly billing alerts, Stripe radar.

---

## PART D — Known launch prereqs still open (from PRE_LAUNCH_TODO / GO_LIVE)

- 🟡 **Per-user Telegram** — code built + tested (each user sets their own BotFather token, encrypted, used at deploy). Needs a real per-user bot live-verified. Today it's the shared test bot.
- 🔴 **Zernio connect landing** (Part A) — the active blocker for posting.
- 🟡 **Format-intel / channel-policy in the LIVE agent path** — currently in the server-side research path; the live agent researches natively. Enhancement, not core-blocking.
- 🟡 **Cron day-to-day delivery** via `send_update` (reliable) instead of the native channel.
- 🔴 **Legal:** ToS + Privacy, explicit "Maya posts under your name" consent at connect, X/TikTok platform-compliance review.
- 🟡 **Cross-tenant isolation + ban-safety tests** (mandatory test category) green for prod.

---

## What's already DONE + live-verified (2026-06-07)

✅ Onboarding engine: research → grounded buyer map + channels + threads + drafts → synthesis plan, **delivered to Telegram** (delivery blackhole fixed). ✅ Grounding guard (no hallucination). ✅ Hard spend kill-switch ($3/hr·$6/24h). ✅ $99 billing code (checkout + webhook→gtmPlanJson + comp), trial=full/7d. ✅ Server-side gating (`planFeaturesGtm` + publishEngine). ✅ Format intel with Gemini video-watching (server-research path). ✅ Per-user Telegram (code).
