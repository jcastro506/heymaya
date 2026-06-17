# COGS Pricing Reference — External APIs (HeyMaya GTM)

**Sourced from live vendor pages on 2026-06-16.** This is the canonical price reference for COGS modeling. Prices change without notice — re-verify quarterly. The **volumes** these prices multiply are modeled in `docs/SPRINT_PLAN_REALTIME_OPERATOR_V1.md` §9b; this file is the **unit-price source of truth only**.

> ⚠️ **Metering gap:** ScrapeCreators / TwitterAPI.io / DataForSEO currently log `costUsd: 0` in `gtmCostLedger` (`infra/.../maya-gtm-tools/index.js:170`). So we have **no measured volumes** for the three highest-frequency read providers. Provider-complete metering (SPRINT_PLAN §14 Phase-2 ⓪) is the prerequisite to replace modeled COGS with measured.

---

## Per-provider unit prices

| Provider | Unit | Price | Plan / tier | Source | Conf. |
|---|---|---|---|---|---|
| **OpenRouter — Kimi K2-0905** (main brain) | tokens | **$0.60 / 1M in · $2.50 / 1M out** | pass-through (no sub) | openrouter.ai/moonshotai/kimi-k2-0905 | High |
| **OpenRouter — Gemini 3 Flash** (workers) | tokens | **$0.50 / 1M in · $3.00 / 1M out** | slug `google/gemini-3-flash-preview` | openrouter.ai/google/gemini-3-flash-preview | High |
| **OpenRouter — Gemini 3.1 Flash-Lite** (cheap scan) | tokens | **$0.25 / 1M in · $1.50 / 1M out** | slug `google/gemini-3.1-flash-lite-preview` | openrouter.ai/google/gemini-3.1-flash-lite-preview | High |
| **ScrapeCreators** (Reddit/TikTok/IG/YT/LinkedIn reads) | request (≈1 credit) | **$0.00188/call** (Freelance) · **$0.00099/call** (Business) | Free 100cr · Solo $10/5k · Freelance $47/25k · Business $497/500k · Enterprise custom | scrapecreators.com | Med (no per-endpoint table; /pricing 404'd) |
| **TwitterAPI.io** (X reads) | per returned tweet | **$0.00015/tweet** ($0.15/1k); 15-cr per-call floor; profiles $0.18/1k | 100k credits = $1; pay-as-you-go | twitterapi.io/pricing | Med-High |
| **DataForSEO** (search_demand) | per request | Labs **$0.01/req + $0.0001/kw** · Google Organic SERP **$0.0006** (Standard)/$0.002 (Live) · Google Ads SV **$0.05/req** (≤1k kw) | prepaid, $50 min deposit | dataforseo.com/pricing | High |
| **Gemini 3.1 Flash Image** ("nano-banana 2", slideshows) | image-output tokens | **$0.067/image** @1024px ($60/1M img tokens); batch 50% off | pay-as-you-go | ai.google.dev/gemini-api/docs/pricing | High |
| **Fly.io** (per-tenant 24/7 agent) | compute/sec | **512MB $3.32/mo · 1GB $5.92/mo · 2GB $11.11/mo** (shared-cpu-1x); dedicated IPv4 **$2/mo**; shared IPv4 free | usage-based | fly.io/docs/about/pricing | High |
| **Convex** (shared backend) | seat + metered | **$25/dev/mo** Pro (25M calls + 250 GB-hr incl.); overage $2/1M calls, **$0.30/GB-hr** action compute, $0.20/GB DB+IO, $0.12/GB egress | Pro | convex.dev/pricing | Med-High (per-tenant GB-hr not knowable from pricing) |
| **Zernio** (posting; formerly "Late"/getlate.dev → zernio.com) | **per connected social account** | accounts **1-2 free · 3-10 $6/acct · 11-100 $3 · 101-2000 $1** · unlimited posts free | per-account (no tiers) | zernio.com/pricing | High |
| **Zernio — X/Twitter passthrough** | per X action | **$0.015/post · $0.005/read · $0.20/post-with-URL** (zero markup) | metered on top | zernio.com/pricing | High |

---

## Creatify — the load-bearing detail (CONSUMER seats vs. API tier)

**Use the API tier, not consumer seats.** Consumer seats ($39/$99) are per-seat, no-rollover, no-share → would force a $99 floor *per Studio tenant*. The **API tier is built for amortization across tenants:**

| Creatify tier | Price | Credits | Notes |
|---|---|---|---|
| API Starter | $99/mo | 500 cr | |
| **API Pro** | **$299/mo** | **2,000 cr** | **$0.1495/credit** — the working tier |
| API Enterprise | custom | custom | **multi-brand support, "built for agencies"**, volume discounts |

**Credit consumption (API docs — these differ from the consumer help-doc; use these):**
- URL→video / AI avatar / AI Shorts: **5 cr / 30s** → **$0.75/30s video** @ API Pro
- Aurora: 1 cr/sec · Aurora Fast: 0.5 cr/sec
- Text-to-Speech: 1 cr/30s · AI Scripts: 1 cr/request
- **Ad Clone: 12 cr / 5s** (= 36cr/15s ≈ $5.38 — the expensive path; keep clones short)
- Credits do **not** roll over.

**Amortization:** one API Pro account = 2,000 cr = ~400 URL→videos/mo. Held as a single shared API/Enterprise account → per Studio tenant video COGS ≈ **$10–12/mo** (not a $99 seat). This is what takes **$199 → ~$52/mo COGS / ~74% margin**.

⚠️ **OPEN — confirm with Creatify sales:** the billing docs don't *explicitly* address reselling/generating on behalf of paying end-customers. The API + Enterprise multi-brand framing is sold for exactly this, but get **written confirmation** before committing Studio pricing to a shared account.

Sources: docs.creatify.ai/billing · creatify.ai/pricing · creatify.ai/enterprise

---

## Cost-driver takeaways (for the COGS model)
1. **LLM is cheap** (~$20/mo) — Flash-Lite-on-pulse works. Not the constraint.
2. **Zernio = per connected channel** — channel count, not posting volume, is the cost. **Channels-per-tier is a pricing variable.**
3. **ScrapeCreators is cheap per call (~$0.001–0.002)** — only "high" under a naive 5-channels-every-tick sweep. Maya works only **bet channels (floor of 3) with weekly rotation** (`maya-continuous-research/SKILL.md:24,35,42`), so realistic load is **~$3–6/mo**, not $21.
4. **Creatify on the API tier** is the unlock for $199.
5. **TwitterAPI bills per returned tweet** — page size × pages is the dial.
