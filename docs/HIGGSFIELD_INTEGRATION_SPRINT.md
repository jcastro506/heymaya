# Higgsfield Integration — Sprint Plan ("Maya Studio")

> **Status:** Research-complete, pre-build. This is the full-coverage integration plan for adding AI short-form video production to Maya via Higgsfield AI. Built from a 4-agent research sweep (Cloud API / MCP+OpenClaw / capabilities / COGS+ToS), 2026-06-10.
>
> **One-line thesis:** Maya stops being "she posts text for you" and becomes "she runs your short-form video studio" — analyzing what's winning in your niche, generating product videos grounded in your real product + the Fact Sheet, and auto-publishing them. Higgsfield is the generation engine; Maya's orchestration + grounding is the moat.

---

## 0. Decision summary (read this first)

| Question | Answer |
|---|---|
| **Build it?** | **Conditional GO** — gated on the ToS/legal check (§1). The product value is high and COGS works; the licensing is the only real blocker. |
| **Integration path** | **Cloud REST API** (`platform.higgsfield.ai`, `Authorization: Key key:secret`), server-side from Convex. **NOT the hosted MCP** (interactive browser OAuth — incompatible with headless multi-tenant Fly agents). |
| **Reference-video ("make one like this winning TikTok")** | Use **our existing Gemini video-watching** (yt-dlp → Gemini vision) to extract the style recipe, feed it as a prompt to Higgsfield. Higgsfield's own "Video Analyzer" is MCP-only — we don't need it. |
| **Tier** | New **$149 "Maya + Studio"** tier = everything in $99 **+ ~15 grounded product videos/mo.** Margin ~60-65% after video COGS. |
| **COGS** | **~$12-20/customer/mo loaded** (mixed models + retries), on top of the ~$38 base. Default to Kling (~$0.70/video); gate premium (Veo/Sora ~$4-6/video). |
| **Hard prerequisite** | **A working server-side cost meter** (already on our build queue) — video makes per-tenant credit metering non-optional. |

---

## 0.5. Scope reality — the TWO Higgsfields (don't over-scope this)

There are two distinct Higgsfield surfaces, and the marketing-page "skills/connectors" belong to the one we **cannot** use:

1. **The "Supercomputer" / Hermes consumer agent** (web app). This is where **trend picker, product analyzer, marketing ideas, content strategy, UGC ad pipeline, and the social connectors (X / IG / Threads)** live. They are features of *Higgsfield's own agent*, driven by a human clicking in their web app. **None are exposed via the REST API or public MCP — Maya cannot call them headlessly.** This is effectively a competing "AI marketing employee," not a toolkit.
2. **The developer surface** (REST Cloud API / public MCP / CLI). **Generation-only:** image gen, video gen, SoulId training, virality scoring (MCP/CLI). This is all we can build on.

**Boundary map — what Higgsfield can/can't replace in our stack:**

| Our pillar | Replaceable by Higgsfield? |
|---|---|
| ScrapeCreators / X / HN read + buyer-thread discovery | **No** — no arbitrary social reading; its "trends" = video formats, not buyer demand |
| Gemini vision (watch a video → structured breakdown) | **No** — analyzer only feeds its own generation, MCP-only |
| Gemini reasoning (replies, niche analysis, strategy) | **No** — no LLM/chat endpoint |
| Posting + comment engagement (Zernio) | **No** — connectors are X/IG/Threads only, publish + own-post comment moderation, no discovery/reply-to-thread/DMs, app-only, not headless |
| Gemini/nano-banana image gen | **Yes (optional)** — but already working; low priority |
| **Video generation** | **New capability — the actual win** |

**Net:** Higgsfield consolidates ~1 pillar (image gen, optional) and adds a 6th (video). It's a **media factory, not a GTM brain.** Use it *only* as the video-generation backend. This boundary is settled — do not re-scope toward "Higgsfield replaces the stack." (Connectors note: Higgsfield's own X account was banned — no ban-safety guarantees; another reason to keep Zernio.)

---

## 1. ⛔ THE GATE — ToS / legal (resolve BEFORE writing any code)

**Higgsfield's Terms of Use likely prohibit the exact pattern we'd build** (one Higgsfield account generating videos programmatically for many paying end-customers):

- §1.2 grants a **"non-transferable, non-sublicensable"** license for **"personal or internal business purposes"** only.
- §5.1(iii) prohibits using outputs to build **"products or services that compete."**
- A **"reselling access strictly prohibited"** clause appears tied to Unlimited features.

Outputs themselves carry **commercial-use rights on paid tiers** and Higgsfield does **not** claim ownership (§4.4) — but *commercial use for yourself ≠ resale-as-a-service to third parties.*

**Two ways through — pick one before Sprint 1:**
1. **Enterprise / reseller agreement** — contact Higgsfield sales (`support@higgsfield.ai`) for a written multi-tenant resale agreement + volume credit pricing. This is the clean path and also unlocks better $/credit.
2. **Source via an aggregator** — **Segmind** resells the same underlying models (Kling, Seedance, Soul i2i, Speak) on a **per-generation USD API whose terms permit resale** ($0.16-$0.70 image-to-video; $0.86-$4.22 speech-to-video; $0.12-$0.23 Soul image). Higher per-call cost, but contractually safe and still usage-metered. Trade-off: loses first-party features (SoulId training, virality predictor, marketing-studio URL→ad).

> **Owner action (operator):** email Higgsfield sales for a reseller/enterprise agreement. If they decline or stall, default to the Segmind aggregator path. **No integration code ships until this is resolved.**

---

## 2. Verified technical ground truth

### Cloud API (the path we're taking)
- **Base URL:** `https://platform.higgsfield.ai` (dashboard/keys at `cloud.higgsfield.ai`).
- **Auth:** `Authorization: Key {api_key}:{api_key_secret}` + `Content-Type: application/json`. (SDK env: `HF_KEY="key:secret"`.) **Not** a plain Bearer token; **not** `api.higgsfield.ai/v1/generations` (that apidog blog is inaccurate).
- **Official SDKs exist:** `higgsfield-js` (Node), `higgsfield-client` (Python) — we can read exact schemas from these.
- **Endpoints:** `POST /{model_slug}` (e.g. `/higgsfield-ai/dop/standard`, `/higgsfield-ai/soul/standard`, `/higgsfield-ai/speak/...`, `/kling-video/v2.1/pro/image-to-video`, `/bytedance/seedance/v1/pro/image-to-image`) → returns `request_id`. Poll `GET /requests/{request_id}/status`. Cancel `POST /requests/{request_id}/cancel` (queued only).
- **Webhooks:** append `?hf_webhook=<url>` to the generation request — fires on `completed`/`failed`/`nsfw`, retries up to 2h until 2xx. (Signature verification UNVERIFIED — treat as unsigned, gate by our own opaque job token.)
- **Inputs:** public URLs (`image_url`, `reference_image_urls`, `input_image`, `input_audio` [WAV only]) **or** SDK `upload_*` helpers that return a hosted URL. **Arbitrary self-hosted image/audio URLs are accepted.** **No REST endpoint accepts a video as input.**
- **Outputs:** `images:[{url}]` or `video:{url}` (MP4) from R2 CDN. URL TTL UNVERIFIED → **download + re-host every output to our R2.**
- **Statuses:** `queued / in_progress / completed / failed / nsfw / cancelled`. `failed` + `nsfw` auto-refund credits.

### MCP (rejected for production)
- `https://mcp.higgsfield.ai/mcp`, streamable-HTTP, **interactive browser OAuth** — a human must approve in a browser at least once per account. No documented headless path. Shared single-account credit pool, no per-tenant metering. **Incompatible with one-agent-per-customer on ephemeral Fly machines.** (If we ever want agent-native MCP tools, self-host a Cloud-API-backed MCP — `geopopos/higgsfield_ai_mcp` is a working reference using static `HF_API_KEY`/`HF_SECRET`.)

### Capabilities & limits (corrected)
- **Max video length: 15s.** Aspect ratios: any, incl. **9:16**. Resolution: up to **4K** (the earlier "8K upscale" is **false** — 4K is the ceiling). Watermark on **free tier only**; paid output is clean.
- **Marketing Studio** (URL→ad, Seedance 2.0, 40+ avatars, auto script+voiceover+captions) and **Video Analyzer** + **Viral Clip Generator** + **Virality Predictor** are **MCP/CLI features — NOT in the REST API.**
- **Soul ID:** train from ~15-20 photos (~3-5 min, ~$3); reusable `character_id`. Drifts on rapid motion.
- **Speak/Lipsync:** script → TTS voiceover → lip-synced talking head from a still; 40+ languages, 1080p. (`input_image` + `input_audio` WAV + `prompt`; duration 5/10/15s.) **This is in the REST API.**
- **Virality Predictor:** beta, 0-100 hook/hold score; a *soft pre-publish filter*, not an oracle (a 7K-view clip once outscored a 2.1M-view clip). MCP-only.
- **Multi-input is a CHAIN, not one atomic call.**

### Quality verdict (honest)
Genuinely good at controlled/conversational shots, photoreal stills, talking-head/UGC product ads, and **speed + format breadth**. Weak at complex/dynamic motion and not-fully-solved cross-clip character consistency. Independent reviews: "wins on convenience + templates, loses on raw quality" vs Kling/Runway. **Good enough to auto-produce high-volume decent short-form ads; not reliably indistinguishable from human-shot brand film.** → favor controlled compositions + talking-head, generate-many + virality-screen + pick.

---

## 3. Architecture

```
Winning niche video (TikTok/YT URL, found by Maya's research)
        │  yt-dlp download → R2 → Gemini vision  ← OUR existing video-watching
        ▼
   Style recipe (hook, pacing, structure, shot list)   ← replaces Higgsfield's MCP-only analyzer
        │
        ├── Product images (founder's texted screenshots, in mediaLibraryJson)
        ├── Script (grounded in the Fact Sheet: what-it-does / price / angle)
        └── Model choice (COGS gate: default Kling)
        ▼
  Convex action → Higgsfield Cloud API (Key auth, POST /{model_slug}, ?hf_webhook=)
        │  async
        ▼
  Webhook → /lc_gtm/higgsfield_webhook → mark job done → download asset → R2
        ▼
  save_media → (optional) Virality screen → Maya posts via Zernio (Reel/TikTok/Story)
        ▼
  gtmCostLedger { provider:"higgsfield", credits, $cost, agentId }  ← per-tenant meter
```

**Key insight that keeps us fully on the headless REST API:** Higgsfield's killer "make one like this winning video" lives only in the OAuth-gated MCP. But **Maya already watches videos with Gemini** (the format-intel feature). So *our own Gemini pass is the reference analyzer* — it extracts the style recipe and we feed it to Higgsfield's image-to-video as a prompt. We get the "in the style of what's working" behavior without touching the MCP.

**Integration mirrors the Zernio pattern** (`convex/integrations/zernio/`): `client.ts` (Key auth + backoff), `endpoints.ts` (per-model submit / poll / cancel / upload), `webhooks.ts` (receiver), `types.ts`. Single Higgsfield account/key in env; **we build the per-tenant attribution layer** (their account has no sub-tenancy).

---

## 4. Data model (Convex)

Schema is at the TS DataModel ceiling → **JSON-on-row, not a new table** (same constraint as `connectedAccountsJson` / `mediaLibraryJson`):
- `gtmAgents.videoJobsJson` — array of `{ jobId, hfRequestId, kind, model, status, inputAssetIds, script, resultUrl, credits, costUsd, createdAt }`.
- `gtmCostLedger.provider` union → **add `"higgsfield"`.** Every generation logs credits + USD + agentId (this is the per-tenant meter).
- `gtmAgents.soulCharacterId` — the trained Soul `character_id` (one per founder brand, optional).
- Reuse `mediaLibraryJson` for finished video assets (already feeds `send_media_to_user` + `post_to_channel`).

---

## 5. Integration layer — `convex/integrations/higgsfield/`
- **`client.ts`** — `Authorization: Key key:secret`, base `platform.higgsfield.ai`, full-jitter backoff (same shape as zernio client).
- **`endpoints.ts`** — `submitImageToVideo` (dop/kling/seedance slugs), `submitSpeak` (lipsync), `submitSoulImage`, `createSoulId`, `getStatus`, `cancel`, `uploadAsset`. Each tags `?hf_webhook=` with our callback + opaque job token.
- **`webhooks.ts`** — Convex mutation + httpAction at `/lc_gtm/higgsfield_webhook`; resolves opaque token → jobId → agent, downloads `video.url` to R2, marks job complete, pings Maya. (No trusted input but our token; re-fetch status from Higgsfield to confirm.)
- **`types.ts`** — request/response shapes (pull exact fields from `higgsfield-js` SDK).
- **Env:** `HIGGSFIELD_API_KEY`, `HIGGSFIELD_API_SECRET` (or combined `HF_KEY`), `HIGGSFIELD_WEBHOOK_TOKEN_SECRET`.

---

## 6. Agent — skills + tools

**New skill `maya-video-producer/SKILL.md`** — the director pipeline:
1. *When* a video is worth making (high-intent moment, a winning niche format, a warm channel).
2. Watch the winning reference via Gemini → extract the recipe.
3. Pull product images (`search_my_media`; `request_media` if missing — guarded).
4. Write the script from the **Fact Sheet** (real value + price + the durable angle).
5. Pick the model — **default Kling (cheap); premium gated** behind COGS budget + a "hero moment" judgment.
6. Generate → poll/webhook → (optional virality screen) → post via Zernio.
7. **COGS discipline:** respect the monthly video cap; log every generation; never burn premium on a routine post.

**New plugin tools** (agent → our Convex → Higgsfield):
- `generate_product_video({ productImageIds, styleRecipe, script, model?, aspectRatio? })` → `{ jobId }`
- `generate_talking_head({ avatarImageId | soulCharacterId, script, lang? })` → `{ jobId }` (Speak/lipsync)
- `check_video_job({ jobId })` → status/resultUrl
- `train_brand_spokesperson({ imageIds })` → `soulCharacterId` (once per founder)
- *(Virality screen is MCP-only; v1 skips it or we self-host a thin scorer later.)*

**Reuses:** `save_media`, the Fact Sheet, `post_to_channel` (Reel/TikTok/Story), the Gemini video-watch.

---

## 7. COGS, metering & tiering

**Verified credit economics** (Ultra ~$0.033/credit; 15s video = 3×5s clips):

| Model tier | Credits/video | ~$/video | Use |
|---|---|---|---|
| Kling 3.0 (cheap) | 21 | **~$0.70** | default for most videos |
| Seedance 2.0 (mid) | 75 | ~$2.48 | better motion/native audio |
| Veo 3 + audio (premium) | 116 | ~$3.83 | hero moments only, gated |
| Speak lipsync (5s) | 14 | ~$0.46 | talking-head add-on |
| Soul training (once) | ~$3 | one-time | brand spokesperson |

**Per-customer COGS for 15 videos/mo:** all-cheap ~$3-5 · **mixed ~$8-14** · all-premium ~$40-70. With a 1.3-1.5× retry multiplier → **loaded planning number ~$12-20/mo.** Note: **credits don't roll over** — size the subscription to baseline demand, eat idle-month waste, use top-ups only for spikes.

**Tiering:**

| Tier | Price | What | COGS | Margin |
|---|---|---|---|---|
| Maya | $99 | research + replies + posts + attribution | ~$38 | ~62% |
| **Maya + Studio** | **$149** | + ~15 grounded product videos/mo | **~$50-58** | **~60-66%** |

**Guardrails (mandatory):** (1) cap videos/mo, (2) default to Kling, premium gated by budget + judgment, (3) every generation metered to `gtmCostLedger` → the spend kill-switch finally sees video cost. **Without the cost meter, video is a margin landmine.**

---

## 8. Testing (5 mandatory categories + video-specific)
- **Cross-tenant isolation** — Founder A's Soul character / videos / credits never bleed to B (we own the tenancy layer on a single HF account — test hard).
- **Plan-tier × action** — video tools fail-closed for non-Studio accounts, server-side.
- **Adversarial** — malicious image/script inputs; NSFW-status handling (auto-refund + don't post + surface).
- **Sibling-file scan** — skill ↔ tool ↔ cron ↔ ledger coherence.
- **TODO grep.**
- **Video-specific:** credit-metering accuracy (logged $ matches HF dashboard), webhook round-trip (signed token, replay-safe), render-timeout + retry, model-gating (premium refused over budget), monthly-cap enforcement, R2 re-host of every asset.

---

## 9. Sprint breakdown

- **S-1 — Legal gate (operator, blocking).** Higgsfield enterprise/reseller agreement OR confirm Segmind fallback. *No code until cleared.*
- **S0 — Quality spike (cheap, do first).** Manually generate 3-5 real product videos (HeyMaya + a fixture) across Kling/Seedance/Speak. **Operator + I look at them.** Go/no-go on quality before building anything.
- **S1 — Integration layer.** `convex/integrations/higgsfield/` (client/endpoints/webhooks/types), env, `provider:"higgsfield"` ledger, webhook route, R2 re-host. Cross-tenant + metering tests.
- **S2 — Pipeline + skill.** `maya-video-producer` SKILL + plugin tools; wire Gemini-recipe → generate → poll → save_media → Zernio post. Live-test one end-to-end video from a real product.
- **S3 — Metering, caps, tiering.** Monthly cap + model-gating + the cost-meter join; `$149` Studio tier in `planFeaturesGtm` + Stripe product; fail-closed gating.
- **S4 — Beta.** Studio tier on 3-5 real founders; measure actual COGS vs model; tune the default-model policy from real spend.

---

## 10. Open decisions
1. **Legal path:** direct Higgsfield reseller agreement vs Segmind aggregator. (Decides supply + COGS + features.)
2. **Talking-head as default?** Speak/lipsync (founder spokesperson) is the most reliable-quality format — make it Maya's default video style vs animated-product-photo?
3. **Virality screen:** skip in v1 (MCP-only) or self-host a scorer later?
4. **Studio at launch vs fast-follow:** ship $99 Maya first, add $149 Studio once quality is proven (recommended).

## 11. UNVERIFIED — needs live testing (before committing COGS/quality)
- Multi-tenant key legality (the §1 gate) — **highest priority.**
- Exact official request schemas per model slug (pull from `higgsfield-js` SDK against a real key).
- Per-model credit costs live (Sora 2, Soul training, upscaling not published).
- Render latency per model/duration.
- Webhook signature scheme.
- Output URL TTL (assume short → re-host).
- Real output quality on actual founder products (the S0 spike answers this).

## 12. Risks
- **ToS/legal** (the gate) — could kill the direct path; Segmind is the hedge.
- **Quality variance** — uncanny-valley risk for brand work; mitigate with talking-head default + generate-many + screen.
- **COGS blowout** — premium models + retries; mitigate with metering + gating + caps (hard dependency on the cost meter).
- **Vendor dependency** — new product (MCP launched Apr 2026), async renders, peak-hour queues, "generate one output forfeits refund."
- **Credit waste** — no rollover; size subscription carefully.
