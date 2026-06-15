# Creatify API — Canonical Reference & Playbook (HeyMaya)

> **Status:** Creatify is the chosen video engine for the **$149 Studio tier** (the $99 core has NO video). This is the source of truth for `convex/integrations/creatify/` and Maya's video skills. **Supersedes** the now-stale `docs/MAYA_VIDEO_STUDIO_SPRINT.md` and `docs/HIGGSFIELD_INTEGRATION_SPRINT.md` (Veo/Segmind/Higgsfield — abandoned).
>
> Researched 2026-06-14 from `docs.creatify.ai` raw OpenAPI (`.md` per page) + Terms/billing. Facts are sourced; doc-ambiguous items are marked **⚠ CONFIRM LIVE**.

---

## 0. TL;DR — what Creatify gives us

Hand off a **product URL + real screenshots** (Maya already has both) and optionally a **winning TikTok URL**, and Creatify returns a **finished, edited 9:16 ad** — it writes the script, picks/generates b-roll, adds captions + music + CTA. Four capabilities we use:

| Capability | What Maya hands off | Endpoint chain | The unlock |
|---|---|---|---|
| **Ad Clone** ⭐ | product Link + a winning TikTok URL | `links` → `ads_clone` → poll | **Copy a proven ad's format onto the product.** The differentiator. |
| **URL → ad** | product URL (+ optional Maya script) | `links` → `link_to_videos` → poll | Auto-written, fully edited ad |
| **Aurora talking head** | one photo + audio | `text_to_speech` → `aurora` → poll | Ultra-realistic avatar |
| **Product video** | a product/screenshot image | `product_to_videos/gen_image` → `gen_video` | Cheap product demo |

---

## 1. Operational facts (the must-knows)

- **Base URL:** `https://api.creatify.ai`
- **Auth:** two headers on EVERY request — `X-API-ID` + `X-API-KEY`. Get them at `https://app.creatify.ai/settings/organization/api` (account name → API Dashboard → Show API Keys). Treat as a password; Convex env only, never client-side. ([quickstart](https://docs.creatify.ai/quickstart.md))
- **Plan gating — RESOLVED:** the API is a **standalone product line** ("API Starter/Pro/Enterprise"), NOT the consumer $33/$49 plans and **NOT Enterprise-only**. Any paid API plan unlocks it via self-serve (`?api=true` signup). The widely-cited "Business $99 / 250 credits" is **stale/wrong**. ([billing](https://docs.creatify.ai/billing.md))
- **Status lifecycle (canonical):** `pending → in_queue → running → done | failed` (Aurora/custom-avatar also emit `rejected`). Terminal = `done` (read `video_output`) or `failed` (read `failed_reason`). There is **no** `rendering`/`completed`/`error` string.
- **Async everywhere:** create returns `201` with `{id, status}`; then **poll** `GET /<resource>/{id}/` until terminal, **or** pass `webhook_url` (POST callback `{id, status, failed_reason, video_output}`, may fire >once → handlers must be idempotent).
- **Aspect ratios:** `9x16` (our default), `16x9`, `1x1`. **Languages:** ~76-value enum; `null` = keep original (used by ad-clone).
- **⚠ Output URLs are NOT durable:** `video_output` is a raw S3 URL with **no documented TTL**; the `editor_url` expires in **24h**. → **Always download + re-host every finished video to our Convex storage** the moment it's `done`. Never hand a customer a Creatify S3 URL.
- **GET/LIST are free; only generation deducts credits.**

### Two real blockers to clear before reselling at scale
1. **⚠ Commercial/resale rights** — Terms §6.2 give us ownership of output + commercial use "subject to subscription tier," and §7.3's "or permit to be made" *implies* customer use is allowed — but there is **no explicit "generate for paying end-customers who own/use it commercially" clause.** Get written confirmation from Creatify before we resell. ([terms](https://creatify.ai/terms))
2. **⚠ Rate / concurrency limits** — undocumented (only a generic `429` exists; the "5 QPM" figure is gone from current docs). Build a queue + backoff (our client already retries 429); confirm real QPM + max concurrent renders via live test before scale.

---

## 2. COGS — real numbers (the $149 Studio tier holds easily)

**Credit → dollar** (API plans): Starter **$99 / 500 cr = $0.198/cr**; Pro **$299 / 2,000 cr = $0.1495/cr**.

**Per-action cost (verbatim from [billing](https://docs.creatify.ai/billing.md)):**

| Action | Credit cost | A typical clip | $ (Starter) | $ (Pro) |
|---|---|---|---|---|
| Links / AI Scripts | 1 cr each | — | $0.20 | $0.15 |
| **URL → video** | 5 cr / 30s | 15s ≈ 2.5 cr | **$0.50** | $0.37 |
| **Ad Clone** ⭐ | **12 cr / 5s** | 10s ≈ 24 cr | **$4.75** | $3.59 |
| Aurora (`aurora_v1`) | 1 cr / sec | 15s = 15 cr | $2.97 | $2.24 |
| Aurora fast (`aurora_v1_fast`) | 0.5 cr / sec | 15s = 7.5 cr | $1.49 | $1.12 |
| Product video | 2 cr image + 10 cr/30s video | ~1+3 cr | $0.79 | $0.60 |
| Text-to-Speech | 1 cr / 30s | 15s = 1 cr | $0.20 | $0.15 |

**Per-customer at 15 videos/mo** (blended mix of URL→video, a few ad-clones, some aurora): realistically **~$15–35/customer/mo** → **~77–90% gross margin on $149**. Ad Clone is the expensive lever (keep clones short — 8–15s, which is ideal for TikTok anyway). **Margin is comfortable; video COGS does not threaten the tier.**

> **⚠ Spend-kill interaction (build gotcha):** the watchdog destroys the Fly machine at **$6 / 24h** of operational ledger spend. A burst of ad-clones could trip it. Video cost MUST be recorded to the cost ledger (`recordGtmCostInternal`, add a `"creatify"` provider) AND either bucketed off the runaway-velocity windows or covered by a per-agent `spendKillCapUsd` bump for Studio agents. Resolve before any live video deploy.

---

## 3. The flows we use (exact sequences)

### 3.1 Ad Clone ⭐ — copy a winning TikTok onto the product
The differentiator. `link` must contain ≥1 product image.
```
1. POST /api/links/                      { url }                         → { id: linkId }   (1 cr)
   PUT  /api/links/{linkId}/             { title, description, image_urls }                  (ground it)
2. POST /api/ads_clone/                  { link: linkId, video_url: <winning TikTok>,
                                           aspect_ratio: "9x16", language: null }  → { id, status }  (12 cr/5s)
3. GET  /api/ads_clone/{id}/  (poll)     until status=="done" → video_output
```
- `video_url` = the winning niche video Maya's `maya-tiktok-format-researcher` already captured (`exampleVideos[].url`).
- `language: null` keeps the reference's language; set a code to translate.

### 3.2 URL → ad (AUTO or HYBRID)
```
1. POST /api/links/  { url }  → linkId   (+ PUT to attach real screenshots)
2. POST /api/link_to_videos/  { link: linkId, aspect_ratio:"9x16", video_length: 15,
       script_style: "ProblemSolutionV2", visual_style: "DynamicProductTemplate",
       model_version: "standard",            // or "aurora_v1" / "aurora_v1_fast" for realism
       override_script: "<Maya's grounded script>",   // OMIT = Creatify auto-writes (AUTO mode)
       target_platform:"tiktok", target_audience:"...", webhook_url? }  → { id, status }   (5 cr/30s)
3. GET /api/link_to_videos/{id}/  (poll) → video_output
```
- **AUTO** = omit `override_script` (Creatify writes it from the link + `script_style`).
- **HYBRID** = pass `override_script` (Maya writes the grounded script — her strength).
- `video_length` ∈ {15,30,45,60}. `script_style` (48 options) / `visual_style` (~52 templates) — see §5.
- Pick a specific avatar/voice with `override_avatar` (a `persona id`) + `override_voice` (a `voice/accent id`).
- **Preview-then-render variant** (cheaper iteration): `POST .../preview_list_async/` with `visual_styles:[...]` → poll for `previews[].url` → `POST .../{id}/render_single_preview/ {media_job}`. Use only if we want to A/B templates.

### 3.3 Aurora talking head (needs pre-generated audio — IMPORTANT)
Aurora has **no internal TTS** — `image` + `audio` are both required URLs.
```
1. POST /api/text_to_speech/  { script, accent?: <voiceId> }  → poll → output (audio URL)   (1 cr/30s)
2. POST /api/aurora/  { image: <photo URL>, audio: <step-1 output>,
                        model_version:"aurora_v1"|"aurora_v1_fast", text_prompt?, webhook_url? } → { id }  (1 or 0.5 cr/sec)
3. GET /api/aurora/{id}/  (poll) → video_output
```
> **Shortcut:** `POST /api/lipsyncs/` accepts `text` directly (does TTS for you) AND supports `model_version: "aurora_v1_fast"` — i.e. **Aurora-grade realism + auto-TTS in ONE call**. Prefer lipsync-with-aurora-model over the raw 2-step Aurora unless we need a specific pre-made audio.

### 3.4 Product video (cheap demo from an image)
```
1. POST /api/product_to_videos/gen_image/  { product_url: <image URL>, type:"product_anyshot",
                                             aspect_ratio:"9x16" }  → { id }   (1 cr)
   GET  /api/product_to_videos/{id}/  → wait status "image_generated" (generated_photo_url)
2. POST /api/product_to_videos/{id}/gen_video/  { motion_style? }   (3 cr)
   GET  /api/product_to_videos/{id}/  → status "video_generated" → generated_video_url
```
Status enum here is its own: `initializing → image_generating → image_generated → video_generating → video_generated | failed`.

### 3.5 Picking avatars + voices programmatically
- **Avatars:** `GET /api/personas/` (filter by `gender`, `age_range`, `suitable_industries`, …) → use `Persona.id` as `creator`/`override_avatar`/`avatar_id`.
- **Voices:** `GET /api/voices/` → each voice has `accents[]`; use `Accent.id` as `accent`/`override_voice`/`voice_id`.

---

## 4. Endpoint catalog (condensed)

| Resource | Create | Poll / list | Cost | Notes |
|---|---|---|---|---|
| Links | `POST /api/links/` {url}; `POST /api/links/link_with_params/` | `GET /api/links/{id}/`, `PUT` to edit | 1 cr | InnerLink carries scraped title/desc/images/ai_summary |
| Ad Clone ⭐ | `POST /api/ads_clone/` | `GET /api/ads_clone/{id}/` | 12 cr/5s | {link, video_url, aspect_ratio, language?, webhook_url?} |
| URL→video | `POST /api/link_to_videos/` (+ `/preview/`, `/preview_list_async/`) | `GET …/{id}/`; render: `/{id}/render/`, `/{id}/render_single_preview/` {media_job} | 5/1/4 cr/30s | full param set §5 |
| Aurora | `POST /api/aurora/` | `GET /api/aurora/{id}/` | 1 / 0.5 cr/sec | image+audio URLs, no internal TTS |
| Lipsync v1 | `POST /api/lipsyncs/` (+`/preview/`,`/{id}/render/`) | `GET …/{id}/` | 5/1/4 cr/30s | `text` OR `audio`; `model_version` can be aurora |
| Lipsync v2 | `POST /api/lipsyncs_v2/` | … | 5/1/4 cr/30s | multi-scene; per-scene character/voice/background |
| Product video | `gen_image` → `{id}/gen_video/` (+ regen_*) | `GET /api/product_to_videos/{id}/` | 1+3 cr | own status enum |
| AI Scripts | `POST /api/ai_scripts/` | `GET …/{id}/` | 1 cr | script text in `generated_scripts[].paragraphs` |
| Text-to-Speech | `POST /api/text_to_speech/` | `GET …/{id}/` | 1 cr/30s | audio URL in `output` |
| AI Shorts | `POST /api/ai_shorts/` (+preview/render) | … | 5/1/4 cr/30s | text→viral; `style` enum (4K realistic, Cinematic, …) |
| AI Editing | `POST /api/ai_editing/` (+preview/render) | … | 5/1/4 cr/30s | raw footage → auto-edit; `editing_style` enum |
| Custom Template | `POST /api/custom_template_jobs/` (+preview/async/render) | `GET …/{id}/`; templates: `GET /api/custom_templates/` | 5/1/4 cr/30s | `variables` map (image/video/audio/text/avatar/voiceover) |
| IAB Images | `POST /api/iab_images/` | `GET …/{id}/` | 2 cr | banner set in `output[].url` |
| Personas | `GET /api/personas/` (+`/paginated/`, `/{id}/`); create `POST /api/personas/` or `/personas_v2/` (upload) | quota `GET /api/personas_v2/count/` | custom ⚠ | custom avatar takes 1–2 days |
| Voices | `GET /api/voices/` (+ clone endpoints) | — | clone ⚠ | `Accent.id` is the voice id |
| Inspiration | `GET /api/inspirations/` → `POST /api/inspiration_jobs/` | `GET …/{id}/` | per-recipe (4× in-app) | recipe catalog, NOT a competitor-ad feed |
| Asset Generator | `GET /api/asset_generator/schemas/` → `POST /api/asset_generator/` | `GET …/{id}/` | per-model ⚠ | raw image/video models; roster is runtime-only |

---

## 5. URL→video param cheat-sheet (the rich one)

`POST /api/link_to_videos/` writeable fields:
- **`link`** (req, uuid) · **`override_script`** (full VO script; omit→auto) · **`video_length`** {15,30,45,60} · **`aspect_ratio`** {9x16,16x9,1x1} · **`language`** (76 enum)
- **`script_style`** (48): `DiscoveryWriter`(default), `ProblemSolutionV2`, `BenefitsV2`, `ProductHighlightsV2`, `StoryTimeWriter`, `GenzWriter`, `ThreeReasonsWriter`, `EmotionalWriter`, `HowToV2`, `SpecialOffersV2`, + 28 hook styles (`SecretHook`, `NegativeHook`, `WhatHappensHook`, …)
- **`visual_style`** (~52 templates): `AvatarBubbleTemplate`(default), `DynamicProductTemplate`, `FullScreenTemplate`, `SimpleAvatarOverlayTemplate`(Product Presenter), `VlogTemplate`(9x16), `DramaticTemplate`(9x16), `GreenScreenEffectTemplate`, `MotionCardsTemplate`, … + Lego* styles
- **`model_version`** {`standard`(5cr/30s), `aurora_v1`(1cr/s), `aurora_v1_fast`(0.5cr/s)} — **this is how you get Aurora realism inside URL→video**
- **`override_avatar`** (persona id) · `override_avatar_by_image` (url) · **`override_voice`** (accent id)
- **`background_music_url`** + `_volume` · `voiceover_volume` · toggles: `no_background_music`, `no_caption`, `no_emotion`, `no_cta`, `no_stock_broll`
- **`caption_setting`** (style/font/colors/position) · `target_platform`(default tiktok) · `target_audience` · **`webhook_url`**

---

## 6. Corrections this research forces on the Phase-1 integration layer

Our `convex/integrations/creatify/` was built against inferred shapes; the harvest confirms most and corrects two:

1. ✅ **`override_script` / `visual_style` / `script_style` are REAL** on `link_to_videos` — our `LinkToVideoInput` was right. **Add** `model_version`, `video_length`, `target_platform`, `target_audience`, `override_avatar`, `override_voice` to the input type.
2. ❌ **`product_video` mode mis-routes.** Our `getVideoJob` sends `product_video` → `getLinkToVideo`, but Product Video is a **separate endpoint** (`/api/product_to_videos/`) with a **two-step gen_image→gen_video** flow and its **own status enum**. Fix: give it its own endpoints + poll route (or drop `product_video` from V1 and add later).
3. ➕ **Aurora** needs a real `createAurora` typed input (`image`, `audio`, `model_version`, `text_prompt`) — and the pipeline must call `text_to_speech` first (or prefer `lipsyncs` with `model_version: aurora_v1_fast` for one-call TTS+realism).
4. ✅ Status helpers are fine — real terminal set {`done`,`failed`,`rejected`} is covered by our regex.
5. ➕ Add `text_to_speech`, `personas` (list avatars), `voices` (list voices) wrappers.

---

## 7. Open items — ⚠ CONFIRM LIVE (first key-in run)
- Exact `credits_used` per flow (validate the COGS table) · ad-clone `video_thumbnail` on webhook · `link_to_videos` preview vs direct-create behavior · PTV `gen_image` `id`-on-create · AI Scripts sync-vs-async · AssetGen model roster + per-model cost · webhook retry/idempotency + signature · S3 URL TTL.
- **Blockers (non-API):** written resale rights; real rate/concurrency limits.

---

## 8. Build sequencing (where this slots)
Phase 1 ✅ integration layer (done; apply §6 corrections) → Phase 2 orchestration (`creatifyVideo.ts`: actions + scheduler poll → re-host to Convex storage → deliver; + spend-kill fix + `creatify` cost provider) → Phase 3 typed tools + routes → Phase 4 skill realignment (rewrite `maya-video-producer` to Creatify orchestration craft; wire the find-winner→ad-clone chain) → Phase 5 `studio` tier gating (flip `gtm99` video off; billing; deploy gate; server-side `canVideo`) → Phase 6 operator (Stripe Studio product $149 + `CREATIFY_API_*` keys).
