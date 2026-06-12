# Maya Video Studio — Sprint Plan (AI short-form video for the $149 tier)

> **Status:** Research-complete, pre-build. Full implementation plan for giving Maya the ability to produce short-form UGC product videos. Built from an 8-agent research sweep across Higgsfield + Segmind (API / capabilities / pricing / COGS / scale / ToS), 2026-06-10. Supersedes the Higgsfield-only doc for the build plan; that doc remains the Higgsfield-specific reference.
>
> **Thesis unchanged:** Maya goes from "writes and posts for you" to "writes, **films**, and posts for you." Vendor is a generation backend behind an abstraction; Maya's orchestration + grounding is the moat.

---

## 0. TL;DR + two corrections from research

| | Finding |
|---|---|
| **Capability** | A full UGC pipeline (TTS → avatar image → lipsync talking-head → b-roll image-to-video → character consistency) is buildable on **one vendor**. Segmind covers all of it natively (incl. hosted ElevenLabs TTS) and can even chain it server-side via **Pixelflow**. Higgsfield-direct covers the same generation via REST. |
| **⚠️ Correction 1 — ToS** | **Segmind is NOT ToS-safe.** Its MCSA §3.3.3/§3.3.4 prohibit resale/sublicense/substitute-service exactly like Higgsfield. **Both vendors require a written reseller agreement.** Neither is a drop-in. |
| **⚠️ Correction 2 — Cost** | **Segmind is a reseller and is 1.8–3.7× more expensive per call than Higgsfield-direct** for the same models. |
| **COGS** | 15 videos/customer/mo = **~$36/mo with Kling-Avatar lipsync**, **~$79/mo with Higgsfield Speech2Video**. +$38 base → **~$74–$117 total/customer**. The **lipsync model is 70–85% of per-video cost** — the single biggest lever. |
| **Tier** | **$149 only.** At $99 the margin is 25–29% (too thin); at $149 with Kling-lipsync default it's ~50%. Premium video models are underwater at both prices — gate them. |
| **Scale** | 300–500 concurrent video agents is achievable but **needs real infra on our side** (job queue + token-bucket + centralized poller + dedicated GPU endpoints + enterprise SLA). Not a shared-tier drop-in. |
| **Recommendation** | Worth building **as a fast-follow after the $99 core is proven** (see Risks). Negotiate reseller terms with **both** vendors; build the backend **vendor-abstracted** so price/features/who-says-yes decides at deploy, not in code. |

---

## 1. ⛔ Legal gate (resolve BEFORE building — applies to BOTH vendors)

**1a. Reseller authorization (the go/no-go).** Both Higgsfield and Segmind prohibit one account serving many paying customers. Segmind §3.3.3 allows it only "to the extent explicitly authorized in writing by Segmind." → **Email both vendors' sales for a written reseller / OEM / platform agreement.** No integration ships without one.

**1b. Per-model license whitelist (second gate).** Underlying model licenses pass through regardless of the platform agreement. Confirmed conflicts:
- **FLUX.1 [dev]** — model is *non-commercial* (outputs OK, but running it in a commercial SaaS needs a BFL commercial license). → **Use FLUX.1 [schnell] (Apache 2.0)** instead.
- **Kling free/low tier** — non-commercial + mandatory "Kling AI" watermark + grants Kuaishou a sublicensable license over your content. → **Use a paid Kling tier; confirm watermark removal + commercial rights.**
- **Background Removal (CC-BY-NC-ND)** — non-commercial, no derivatives. → **Do not use.**
- **Seedance / ByteDance** — commercial via API "subject to Volcengine Ark terms." → confirm for resale.

→ **Get a written list of "models cleared for commercial multi-tenant resale" from the chosen vendor.** Whitelist enforced in code.

**1c. Likeness/deepfake** — talking-head avatars touch privacy/likeness rules (Segmind AUP item 7 + per-model policies). Use consented/synthetic avatars only; confirm avatar-model rules.

---

## 2. Vendor decision — Segmind vs Higgsfield-direct

Both need a written agreement, so choose on price × features × who says yes:

| | **Segmind** | **Higgsfield-direct** |
|---|---|---|
| ToS | Resale prohibited; written waiver via §3.3.3 | Resale prohibited; needs enterprise/reseller deal |
| Cost/call | Reseller markup (1.8–3.7× higher) | Cheaper (bundled credits ~$0.033) |
| Breadth | **One API for everything** — TTS (ElevenLabs), image, i2v, lipsync (Higgsfield/HeyGen/Kling), trained chars (Flux LoRA, HeyGen twin), Pixelflow chaining | Generation primitives only; SoulId + virality first-party; Marketing Studio app-only |
| Billing | **Pay-as-you-go USD, per-inference** (no credit-pool waste) | Subscription credit pool, no rollover |
| Scale | Dedicated GPU endpoints, Scale tier (1000 RPM), Enterprise 99.99% SLA | Shared pool; per-tenant metering we build |
| Auth | `x-api-key`, headless ✓ | `Key key:secret`, headless ✓ (MCP is OAuth — avoid) |

**Lean:** **Build vendor-abstracted; pilot on Segmind** (single-vendor breadth + Pixelflow + pay-as-you-go + dedicated endpoints make it the cleaner *engineering* path), but **price the dominant lipsync/i2v stages against Higgsfield-direct** and route there if the markup hurts at scale. Whoever grants the cleaner reseller agreement wins the tie.

---

## 3. Verified capabilities + the UGC pipeline (Segmind primary)

- **Base:** `https://api.segmind.com/v1/<model-slug>`, POST, header `x-api-key`. v1 sync (<60s, returns bytes); v2/workflows async (poll `poll_url` ~7s until `COMPLETED`). **Webhooks: finetune/Pixelflow only — video inference is poll-based.** Output URL TTL unknown → **download to our R2 immediately.**
- **TTS:** `/tts-eleven-labs` (hosted ElevenLabs) — ~$0.169/1k chars. **No separate ElevenLabs account needed.**
- **Image:** Flux Schnell ($0.008), Seedream 4 ($0.035), Nano Banana ($0.06).
- **Image→video (b-roll):** Higgsfield DoP lite/turbo/preview ($0.16/$0.51/$0.70), Kling, Seedance. 5–15s, 9:16, up to 1080p.
- **Lipsync/talking-head:** **Kling Avatar V2 Std ($0.071/sec — the cheap default)**, Higgsfield Speech2Video ($0.17–0.28/sec), HeyGen Avatar V (720p/1080p/4k). Input = image + audio.
- **Character consistency:** Flux LoRA fine-tune (12–25 imgs, ~15–20 min) or **HeyGen Digital Twin** (reusable `avatar_id`, $1.25 one-time) — the persistent brand spokesperson.
- **Pixelflow:** node graph that chains TTS→image→lipsync→composite and **publishes the whole chain as ONE API endpoint** (`/workflows/<id>-v1`). Lets us run the full UGC pipeline server-side in one async call instead of orchestrating 5.

---

## 4. Architecture (vendor-abstracted + scale-ready)

```
Maya decides "make a video"  (skill: maya-video-producer)
   │  builds: script (Fact Sheet) + style recipe (her Gemini analysis of a winning niche video)
   ▼
ENQUEUE a videoJob in Convex   ← agents NEVER call the vendor directly
   ▼
Worker pool (token-bucket rate-limited)  →  generation backend ADAPTER
   │                                          ├─ Segmind adapter  (api.segmind.com)
   │                                          └─ Higgsfield adapter (platform.higgsfield.ai)
   │   pipeline: TTS → hero/avatar image → lipsync talking-head → b-roll i2v
   ▼
Centralized poll manager (no webhooks for video)  →  download assets → R2
   ▼
gtmCostLedger { provider:"segmind"|"higgsfield", stage, $cost, agentId }  ← per-tenant meter
   ▼
mediaLibraryJson → Maya posts via Zernio (Reel / TikTok / Story)
```

Two load-bearing principles:
1. **Vendor adapter interface** — `generateVideo(jobSpec)` abstracts Segmind vs Higgsfield. Swap without touching the skill/pipeline.
2. **Agents never call the vendor inline** — they enqueue. The queue + poller + rate-limiter is what makes 300–500 concurrent agents safe (§10).

---

## 5. Data model (Convex — JSON-on-row, at the TS ceiling)
- `gtmAgents.videoJobsJson` — `[{ jobId, vendor, stage, vendorRequestId, status, inputAssetIds, script, pollUrl, resultUrl, costUsd, attempts, createdAt }]`.
- `gtmAgents.brandAvatarId` — trained HeyGen twin / Flux-LoRA id (the persistent spokesperson).
- `gtmCostLedger.provider` union → add `"segmind"` + `"higgsfield"`; log **every stage** (TTS, image, lipsync, i2v) with USD.
- `gtmAgents.videoMonthlyCount` — for the per-tier cap.
- Reuse `mediaLibraryJson` for finished assets (feeds `send_media_to_user` + `post_to_channel`).

## 6. Integration layer — `convex/integrations/videoGen/`
- `adapter.ts` — the vendor-agnostic interface (`submitTts`, `submitImage`, `submitImageToVideo`, `submitLipsync`, `pollJob`, `cancel`).
- `segmind.ts` — `x-api-key`, v1-sync + v2-poll, Pixelflow workflow invoke, file-upload helper.
- `higgsfield.ts` — `Key key:secret`, per-model slug, `?hf_webhook=`.
- `queue.ts` — enqueue/drain, token-bucket, 429 backoff+jitter, idempotency key `(agentId, contentId, attempt)`.
- `poller.ts` — centralized poll manager (batch GET `poll_url` every ~7s; write back to Convex; reactive subscription to the agent).
- `webhooks.ts` — receiver (Higgsfield `?hf_webhook=` / Segmind Pixelflow), R2 re-host.
- **Env:** `SEGMIND_API_KEY` (or `HIGGSFIELD_API_KEY`/`_SECRET`), `VIDEOGEN_VENDOR` flag, R2 creds.

## 7. The skill — `maya-video-producer` (FULL spec — this is the intelligence)

The skill is where the *craft* lives. A bare prompt produces dead output; the difference between "not great" and a video worth a founder's brand is entirely in the prompt structure + the two-step technique below. **All of this is encoded in `agents/skills/maya-gtm/maya-video-producer/SKILL.md`** (per the principle: Maya's expertise lives in `.md`, never hardcoded). The hand-authored Tidy prompts (in chat history / the Higgsfield doc) are the canonical worked examples — codify exactly that quality.

### 7.1 When Maya makes a video
A video is worth the COGS only when: a high-intent moment or a format winning in the niche right now + a warm, connected video channel (TikTok/Reels/Shorts/Stories) + within the monthly Studio cap. Otherwise she stays on text/image. Never burn a premium generation on a routine post.

### 7.2 Grounding inputs — where every variable comes from (NO guessing)
| Prompt variable | Source | Dependency |
|---|---|---|
| Product specifics (what it does, key features, the differentiator) | **Product Fact Sheet** | ⚠️ Fact Sheet must exist (separate build — §7.7) |
| The message / script angle | **Angle library** (durable pain-themes) | from foundation research |
| Price / claims (if spoken) | Fact Sheet, **verified-only** | never invented |
| Style / energy / format / hook pacing | **Maya's Gemini analysis of a winning niche video** (`style recipe`) | ⚠️ Gemini-recipe step must be wired (§7.7) |
| Product / hero / avatar images | `search_my_media`; generate via image-gen; `request_media` if missing | ⚠️ image-gen step (§7.7) |
| Brand spokesperson (consistent face) | `brandAvatarId` (trained once) | `train_brand_spokesperson` |

**If a grounding source is empty (e.g. no Fact Sheet, no product image), Maya does NOT fabricate — she requests the missing asset/fact from the founder, or falls back to a format that doesn't need it.** Grounded-or-silent applies to video too.

### 7.3 The prompt architecture (the standard Maya writes to)
Every generation prompt is layered in this order — this structure is the quality unlock:
**subject → specific action → camera move (named + speed) → lighting (temp + direction) → environment → mood → technical (lens / fps / DoF) → color grade → format (9:16) → + a negative prompt.**
A vague prompt gives the model nothing to hold; this gives it a shot list. **Every generation carries a negative prompt** (the failure modes to suppress). No prompt ships without one.

### 7.4 The two-step technique (mandatory for product video)
A flat app screenshot has nothing to animate — that's *why* naive tests look dead. Maya never animates a bare screenshot. She:
1. **Hero image** (text-to-image): place the product in a real, lit scene (in-hand, on a desk, lifestyle context) with crisp legible UI.
2. **Animate the hero** (image-to-video): subtle premium motion (slow dolly, a tap, a notification slide, ambient motion) — micro-parallax only, no whip pans.
This two-step is the single biggest quality lever; the skill enforces it for product/animated formats.

### 7.5 The script formula (UGC)
Hook → relatable pain → the product/mechanic (lead with the *differentiator*) → proof/specific → punchy CTA. Creator voice, not corporate. ~15-18s. The hook is everything — first line earns the watch. (Tidy is the worked example.)

### 7.6 Per-format prompt templates (embedded in SKILL.md)
The skill ships three reusable templates, each with its layered structure + negative prompt:
- **Talking-head UGC** — selfie-style creator delivering the script; authentic handheld, expression beats matched to script (hook=exasperated, payoff=satisfied), tight chest-up 9:16. *(The make-or-break format; default.)*
- **Animated product (two-step)** — hero image → premium camera motion on the product in-scene; UI stays sharp/readable.
- **B-roll insert** — screen-recording-style demo of the actual mechanic, to intercut under the talking head.
Each template names its default models, its negative prompt, and the Fact-Sheet/angle/style-recipe variables it interpolates.

### 7.7 Model selection (the COGS gate)
Default **Kling-Avatar lipsync + Flux-schnell/Seedream images + DoP-lite b-roll** (the cheap, COGS-safe path). Premium lipsync/i2v (Higgsfield Speech2Video high, Veo) is **gated** behind remaining budget + a "this is a hero moment" judgment. Model whitelist (commercial-cleared only) enforced server-side.

### 7.8 The tools (full spec — agent → Convex queue → adapter)
| Tool | Input | Output | Behavior |
|---|---|---|---|
| `produce_ugc_video` | `{ script, productImageIds, avatar?\|brandAvatarId?, styleRecipe, modelTier? }` | `{ jobId }` | Runs the full chain (TTS→avatar→lipsync→b-roll). Server validates Studio tier + cap + model whitelist + budget, then enqueues. |
| `produce_product_video` | `{ productImageIds, styleRecipe, modelTier? }` | `{ jobId }` | Two-step hero→animate, no talking head. Same gates. |
| `check_video_job` | `{ jobId }` | `{ status, resultUrl?, error? }` | Reads job state (poller-updated). |
| `train_brand_spokesperson` | `{ imageIds \| sampleVideoUrl }` | `{ brandAvatarId }` | One-time; trains the persistent face (HeyGen twin / Flux LoRA). |
| `analyze_reference_video` | `{ videoUrl }` | `{ styleRecipe }` | yt-dlp→R2→Gemini → structured style recipe (the §7.2 style source). |
| `generate_video_image` | `{ prompt, refImageIds? }` | `{ mediaId }` | Hero/avatar/product image gen (the two-step's step 1). |

**Reuses existing:** `save_media`, the **Fact Sheet** (read), `post_to_channel` (publish the finished video), `get_my_attribution` (did the video drive signups). Every tool is `planFeaturesGtm`-gated to the Studio tier, fail-closed.

### 7.9 Dependencies that must be set up FIRST (not optional)
The rich-prompt capability is only as good as what feeds it. These are prerequisites and are sprinted explicitly (§12):
1. **Product Fact Sheet** — the product-knowledge source for every prompt. *(Shared with the DM/escalation work.)*
2. **Gemini style-recipe step** (`analyze_reference_video`) — turns a winning niche video into the prompt's style/format.
3. **Image-gen step** (`generate_video_image`) — the hero/avatar/product images the two-step needs.
Without these, Maya guesses → weak prompts → bad video. They gate "Maya-ready."

## 8. Production pipeline (one UGC video, step by step)
1. Script (Fact Sheet + angle) → 2. TTS (`/tts-eleven-labs`) → WAV → 3. avatar image (Seedream, or reuse `brandAvatarId`) → 4. lipsync talking-head (Kling Avatar, image+WAV) → 5. b-roll: product hero image → image-to-video (DoP lite) → 6. download all to R2 → 7. (optional) virality screen → 8. two-clip assembly → 9. Maya posts via Zernio. *(Pixelflow can collapse 2–5 into one async call.)*

## 9. COGS + metering + tiering
**Per finished video (1.4× retry):** cheap ~$2.11 · **mixed (Kling lipsync) ~$5.24** · premium ~$8.47.
**×15/mo:** ~$32 / **~$36 (Kling) / ~$79 (Higgsfield lipsync)** / ~$127.

| Tier | Price | COGS (video + $38 base) | Margin |
|---|---|---|---|
| Maya | $99 | ~$38 | ~62% |
| **Maya + Studio** | **$149** | **~$74 (Kling-default)** | **~50%** |

**Guardrails (mandatory):** Kling-Avatar lipsync default; premium lipsync/i2v gated; hard monthly video cap; **every stage metered to `gtmCostLedger` + the spend kill-switch** (video is the most expensive line — a runaway agent here is far worse than the research-loop incident). Migrate dominant lipsync/i2v to **dedicated GPU endpoints** past ~100–200 active Studio customers (30–60% cheaper than serverless).

## 10. Scale architecture — 300–500 concurrent video agents
The "morning push" is a thundering herd of long jobs. Shared tiers 429 and have unpredictable latency; **no webhooks for video → polling**. Build:
1. **Central Convex job queue** — agents enqueue, never call the vendor. (Single most important thing.)
2. **Token-bucket rate limiter** sized to plan RPM (Business 500 / Scale 1000 pooled). Video only consumes a slot at *submit*, so submit-RPM ≫ in-flight jobs.
3. **429/5xx backoff + jitter**, re-enqueue; 406 (no credits)/400/401 fail-fast + alert.
4. **Centralized poll manager** — one batched poller, not 500 agents polling. Results → Convex subscription → agent.
5. **Backpressure** — "your video is queued, ~N min" instead of blocking. Short-form isn't real-time.
6. **Capacity:** Dedicated GPU endpoint (baseline + autoscale, ~10 RPM/worker, idle-timeout 300s in the morning window) as the floor; **Scale-tier shared key as burst overflow**; route dedicated-first.
7. **Idempotency/dedup** `(agentId, contentId, attempt)` so a retry never double-spends.
8. **Enterprise SLA** (99.99%) before ~300 concurrent — the public status page shows 100%/30d but third-party monitoring logged 70+ blips since Nov 2024; get it in writing.

## 11. Testing — every skill + tool + the prompting itself must be proven

The 5 mandatory categories **plus** video-specific **plus** skill/prompt-quality coverage. "Maya-ready" means all of this is green.

**A. The 5 mandatory categories**
- **Cross-tenant isolation** — one vendor key, many founders; Founder A's avatar/videos/credits never reach B.
- **Plan-tier × action** — every video tool fail-closed for non-Studio accounts, server-side, including reads.
- **Adversarial** — malicious script/image input; NSFW job-status handling (don't post, refund, surface); prompt-injection in the script.
- **Sibling-file scan** — skill ↔ tool ↔ cron ↔ ledger ↔ planFeatures coherence.
- **TODO grep.**

**B. Video-pipeline tests**
- Per-stage cost-metering accuracy (logged $ == vendor dashboard).
- Queue + poller under a simulated 300-agent burst; 429 backoff + re-enqueue; no dropped jobs.
- Idempotent retries — a timeout-retry never double-spends (one finished video per `(agentId, contentId)`).
- R2 re-host of every asset; no hot-linking ephemeral vendor URLs.
- Model-whitelist enforcement (a non-cleared model is refused server-side).
- Monthly-cap enforcement; budget gate on premium models.
- Dedicated-endpoint → shared-tier failover.

**C. Skill + tool behavioral tests (the new, load-bearing ones)**
- **Each tool**: `produce_ugc_video` / `produce_product_video` / `check_video_job` / `train_brand_spokesperson` / `analyze_reference_video` / `generate_video_image` — happy path + each gate (tier, cap, whitelist, budget, missing-asset).
- **Prompt-structure assertion**: generated prompts always carry all layers + a negative prompt (lint the prompt the skill emits).
- **Two-step enforcement**: product/animated formats never animate a bare screenshot — a hero image is generated first.
- **Grounding firewall**: with an empty Fact Sheet / missing product image, Maya requests the asset and does NOT fabricate product facts or price (verified-only honored).
- **Style-recipe round-trip**: `analyze_reference_video` on a known clip returns a usable structured recipe that materially changes the output prompt.
- **End-to-end behavioral sim** (Tideline-style): a fixture founder → Maya decides to make a video → grounds it → produces → posts via Zernio → attribution wired. Run on the fixture corpus.
- **Quality gate**: the S0/beta human-eyeball rubric (lip-sync tight, legible UI, on-brand, not uncanny) is recorded per video; a Studio video that fails the rubric is not auto-posted.

## 12. Sprint breakdown (each sprint: **done = tested**)
- **S-1 — Legal/vendor (operator, blocking):** reseller agreement (Segmind and/or Higgsfield) + written commercial-cleared model list. *No production ship until signed.* **Done:** signed terms + model whitelist on file.
- **S0 — Quality spike:** valid key → generate 5–10 real videos (Tidy + HeyMaya + fixture) with the Maya-grade prompts on the chosen vendor. **Done:** human-eyeball go/no-go passed + measured latency + confirmed async contract + vendor/lipsync-model locked.
- **S0.5 — Grounding dependencies (prereq for good prompts):** build/confirm (1) **Product Fact Sheet**, (2) `analyze_reference_video` (Gemini style-recipe), (3) `generate_video_image` (image-gen). **Done:** each returns real, grounded output; tests C-grounding + C-style-recipe green.
- **S1 — Integration layer + adapter:** `convex/integrations/videoGen/` (adapter + vendor + queue + poller + webhooks + R2) + `provider` ledger. **Done:** live single-video smoke + cross-tenant + metering tests green.
- **S2 — Skill + tools:** author `maya-video-producer/SKILL.md` with the full §7 craft (architecture, two-step, script formula, 3 templates) + all 6 tools wired. **Done:** all tool behavioral tests (C) + prompt-structure/two-step lints green; one end-to-end UGC video from a real product posts via Zernio.
- **S3 — Scale infra:** queue hardening, token-bucket, centralized poller, dedicated endpoint. **Done:** simulated 300-agent burst passes (no drops, no double-spend, backoff works).
- **S4 — Metering, caps, tiering:** monthly cap + model-gating + cost-meter join; **`$149` Studio tier in `planFeaturesGtm` + new Stripe product**; fail-closed gating. **Done:** plan-tier × action matrix green; a non-Studio account cannot call any video tool.
- **S5 — Beta:** Studio tier on 5–10 founders; measure real COGS vs model; tune default-model policy; quality rubric tracked. **Done:** real COGS within plan, quality rubric pass-rate acceptable.
- **S6 — Scale-out:** dedicated endpoints + Enterprise SLA as adoption grows.

## 12.5 Definition of Done — "Maya is ready to go with video"
Maya is ready **only when ALL of these are true** (this is the acceptance gate the doc promises):
1. ☐ Reseller agreement signed + model whitelist enforced (S-1).
2. ☐ S0 quality go: real videos pass the human-eyeball rubric on the locked vendor/model.
3. ☐ Grounding deps live: Fact Sheet + `analyze_reference_video` + `generate_video_image` all return grounded output (S0.5).
4. ☐ `maya-video-producer/SKILL.md` ships the full §7 craft — architecture, two-step, script formula, 3 templates, negative prompts — and the prompt-structure/two-step/grounding lints are green (S2).
5. ☐ All 6 tools pass behavioral tests incl. every gate (tier/cap/whitelist/budget/missing-asset) (S2).
6. ☐ Full pipeline goes end-to-end on a fixture founder: decide → ground → produce → post via Zernio → attribution wired (Tideline sim) (S2).
7. ☐ Every stage metered to `gtmCostLedger`; spend kill-switch sees video cost; monthly cap + premium-gating enforced (S4).
8. ☐ `$149` Studio tier gates all video tools server-side, fail-closed; new Stripe product live (S4).
9. ☐ 300-agent burst test passes — no drops, no double-spend (S3).
10. ☐ Beta cohort COGS within plan + quality rubric pass-rate acceptable (S5).
**Until all 10 are checked, the Studio tier does not go on sale.**

## 13. Open decisions
1. **Vendor:** Segmind (breadth/pay-go) vs Higgsfield-direct (cheaper) — decided by reseller terms + S0 quality.
2. **Lipsync model default:** Kling-Avatar (cheap, COGS-safe) vs Higgsfield Speech2Video (better?) — S0 decides quality-vs-cost.
3. **Pixelflow vs our own orchestration** — single-call simplicity vs our control/observability.
4. **Talking-head vs animated-product-photo** as Maya's default format.
5. **Studio at launch vs fast-follow** — recommend fast-follow after the $99 core is proven.

## 14. Risks
- **Core not proven** — base Maya (daily loop, replies, attribution) still being dogfooded; video is a second floor. **Build only after the $99 product works.**
- **Legal (both vendors)** — no reseller agreement = no product. Model-license pass-through is a second gate.
- **COGS** — ~$36–79/mo video alone; viable only with Kling-default + gating + caps + the cost meter (hard dependency).
- **Scale** — real infra (queue/poller/dedicated endpoints); shared tiers 429 under burst; no video webhooks → polling.
- **Quality** — uncanny-valley risk; mitigate with talking-head default + generate-many + virality screen + human-or-agent pick.
- **Vendor dependency** — Segmind logged 70+ blips since Nov 2024; new async vendor in the critical path. Adapter abstraction is the hedge.

## 15. UNVERIFIED — close before/at build
- Async contract (poll_url shape, status enum, request_id) — one live call.
- Which models are v1-sync vs v2-async; output URL TTL.
- Real generation latency under concurrent load (load test).
- Rate-limit/concurrency specifics; "pooled" Scale semantics; webhook availability on Enterprise.
- Reseller agreement terms + cleared-model list (both vendors).
- Kling paid-tier watermark removal + commercial rights via the API.
- 18s lipsync pricing (published tiers are 5/10/15s — extrapolated).
