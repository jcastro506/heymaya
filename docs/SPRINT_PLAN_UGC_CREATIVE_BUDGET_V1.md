# SPRINT: Aurora UGC Video + Per-Tier Creative Credit Budget

**Branch off `main`. Convex staging `precise-canary-781`. Studio-tier feature.**

Switch on Creatify Aurora UGC avatar video, give each tier a **creative CREDIT budget** (not a video count), and **pace it across the billing month** so Maya can't blow it in week 1. Every paid render is preceded by a server-enforced, fail-closed budget check.

---

## 1. Goal + cost model

### Aurora cost facts (from `docs/CREATIFY_API_REFERENCE.md` §3.3 / `types.ts:97`)

| Model | Rate | 15s clip | 30s clip | Note |
|---|---|---|---|---|
| `aurora_v1` | 1 cr/s | 15 cr ≈ **$2.24** | 30 cr ≈ $4.49 | max realism |
| `aurora_v1_fast` | 0.5 cr/s | 7.5 cr ≈ **$1.12** | 15 cr ≈ $2.24 | **default** |

At **~$0.1495/cr**. UGC default = `aurora_v1_fast`, `9x16`, ~15s → **~$1.12 / ~7.5 cr** per render.

### Per-tier CREDIT budget (recommend credits, not a video count)

A video-count cap punishes short clips and rewards long ones. Bill in **credits** so a 15s fast clip is cheaper than a 30s realistic one, and Maya is incentivized to pick the cheap format. Add **`ugcCreditsMonth`** to the plan matrix, distinct from the existing `videoCreditsMonth` (which stays the Creatify standard/ad-clone ceiling).

| Tier | `ugcCreditsMonth` | `canUgc` | Approx renders (15s fast = 7.5cr) | Approx COGS ceiling |
|---|---|---|---|---|
| starter ($99) | 0 | false | — | $0 |
| growth ($149) | 0 | false | — | $0 |
| **studio ($199)** | **60** | **true** | ~8 fast clips / mo | **~$9 / mo** |

(60 credits ≈ $9 COGS on a $199 line — comfortable. Tune the number, keep the credit semantics.)

### Pacing model — drip + buffer + ceiling

Mirror `discoveryBudgetGate.ts` exactly, but window on the **billing period**, not a rolling 24h:

- **Daily pro-rata drip** — allowance-to-date = `ugcCreditsMonth × (msIntoPeriod / periodLengthMs)`. On day 5 of 30, ~10 of 60 credits are "unlocked." Spend past the unlocked line → degrade.
- **Burst buffer** — let the drip run a little ahead so a founder isn't blocked at 9am: allow up to **`+1 render worth` (≈8 cr) above the pro-rata line**, OR a per-hour soft cap of `ugcCreditsMonth/720` like discovery's `HOURLY_FRACTION`. Pick the per-render buffer; it's more legible to Maya.
- **Hard monthly ceiling** — `usedCreditsThisPeriod >= ugcCreditsMonth` → hard block, period, fail-closed.

Three stacked gates (§3). The prompt is never the only thing holding the line.

---

## 2. Build steps — layer by layer

### (a) Creatify client + `ugc_avatar` mode in `creatifyVideo.ts`

**Client (use the 1-step lipsync path — `docs/CREATIFY_API_REFERENCE.md` §3.3 recommends it over the 2-step Aurora flow):**

1. `convex/integrations/creatify/types.ts:97` — `CreatifyModelVersion` already has `aurora_v1` / `aurora_v1_fast`. No change.
2. `convex/integrations/creatify/types.ts` — add `LipsyncInput` type: `{ script: string; aspect_ratio?: '9x16'|'16x9'|'1x1'; model_version?: CreatifyModelVersion; override_avatar?: string; override_voice?: string; webhook_url?: string }`. (Avoids the untyped `createAurora` at `endpoints.ts:155`.)
3. `convex/integrations/creatify/endpoints.ts` — add `createLipsyncWithAurora(input: LipsyncInput): Promise<CreatifyJob>` → `POST /api/lipsyncs/` with `model_version: 'aurora_v1_fast'`. Returns the same `{id,status}` shape (`types.ts:19` `CreatifyJob`). Polling reuses **`getAurora` (`endpoints.ts:166`)** / the unified `getCreatifyJob` router (`endpoints.ts:302`) which already routes `mode='aurora'`.
4. (optional, Phase 2) `getPersonas()` / `getVoices()` wrappers (§3.5) for avatar/voice picking — defer; default avatar/voice for v1.

**Orchestration in `convex/gtmMaya/creatifyVideo.ts`:**

5. Add **`startUgcVideoJob` internalAction**, mirroring `startVideoJob` (`creatifyVideo.ts:286-408`): args `{ agentId, productUrl, avatarScript, imageAssetIds?, modelVersion?, aspectRatio? }`.
   - Gate `canUgc` (new flag, §2d) — fail-closed if false.
   - **Call the budget preflight** (§2b `checkUgcBudget`) BEFORE rendering — `mode==='hard_block'` → return `{ok:false, reason}`; `mode==='graceful_degrade'` → return `{ok:false, reason, suggest:'static_asset'}`.
   - Ground the script via `imageAssetIds` (real screenshots), call `createLipsyncWithAurora`, append to `creatifyJobsJson` with **`mode:'ugc_avatar'`** via `appendJob` (`creatifyVideo.ts:131-213`), schedule `pollVideoJob`.
6. `pollVideoJob` (`creatifyVideo.ts:618-694`) — already routes `mode='aurora'`/unified poll; ensure the new `mode:'ugc_avatar'` maps to the Aurora/lipsync poll branch (one switch arm).
7. `finalizeDoneJob` (`creatifyVideo.ts:545-612`) — on done, re-host via `mediaAssets.ingestFromUrl`, then record cost (§2 below). Add the new `mode:'ugc_avatar'` to the finalize switch so it tags the right operation.
8. Add `countRecentUgc(jobsJson, since)` next to `countRecentVideos` (`creatifyVideo.ts:154-167`) — filter `mode==='ugc_avatar'` AND `status!=='failed'`, **sum `creditsUsed`** (NOT count — credit semantics).

**Cost ledger (`convex/gtmMaya/costLedger.ts:65-123`):**

9. In `finalizeDoneJob`, call `recordGtmCostInternal({ accountId, provider:'creatify', operation:'creatify_ugc_avatar', costUsd: fin.costUsd, units: fin.creditsUsed, creative: true, reason:\`Aurora UGC (${creditsUsed} cr)\`, metadata:{ mode:'ugc_avatar', creatifyId, mediaStorageId, modelVersion } })`. Set the **`creative:true` flag** (mirrors the existing `discovery` flag) — that flag is how the budget gate identifies countable rows. Add `'creatify_ugc_avatar'` to the operation labels if a union exists (`costLedger.ts:39-48` provider union already has `'creatify'`).

### (b) Credit-budget + pacing gate — new `convex/gtmMaya/creativeBudgetGate.ts`

Direct structural clone of `discoveryBudgetGate.ts`. Each function below maps to a discovery counterpart:

| New (creativeBudgetGate.ts) | Mirrors (discoveryBudgetGate.ts) |
|---|---|
| `creativeMonthlyBudgetCredits(tier)` → reads `features.ugcCreditsMonth` | `discoveryDailyBudgetUsd` (`:71-83`) |
| `proratedAllowanceCredits(monthlyCredits, periodStart, periodEnd, now)` | (new — the drip math) |
| `isCountableCreativeRow(row)` → `row.creative===true \|\| (row.provider==='creatify' && !row.researchJobId)` | `isCountableDiscoveryRow` (`:139-154`) |
| `summarizeCreativeSpend(rows, periodStart, now)` → `{usedCreditsThisPeriod, usedCreditsThisHour}` (sum `units`) | `summarizeDiscoverySpend` (`:199-218`) |
| `evaluateCreativeBudget({usedPeriod, usedHour, proratedAllowance, monthlyCap, perRenderBuffer})` → `{allowed, mode:'full'\|'graceful_degrade'\|'hard_block', usedPeriod, allowedThroughNow, monthlyCap, reason}` | `evaluateDiscoveryBudget` (`:226-264`) |
| `gatingTierForAgent` | reuse as-is (`:272-280`) — already reads `planFeaturesGtm` |
| `loadCreativeSpend(ctx, accountId, periodStart, now)` | `loadDiscoverySpend` (`:293-306`) |
| `checkCreativeBudget = internalQuery({accountId, planTier, periodStart, periodEnd, now})` | `checkDiscoveryBudget` (`:319-343`) |

Verdict logic (fail-closed):
```
if usedPeriod >= monthlyCap               → hard_block   (the ceiling)
elif usedPeriod > proratedAllowance + perRenderBuffer → graceful_degrade (the drip)
else                                       → full
```
Use the same `round4` precision. `monthlyCap===0` (starter/growth) → `hard_block` on first attempt (fail-closed, no credits ever).

**Billing window:** read `periodStart` from `gtmPlanJson` (`planGtm.ts buildGtmPlanJson:524-550`, `periodStart` field `:542`); `periodEnd = periodStart + 30d`. Add a `getBillingPeriodStart(gtmPlanJson): number` helper with a **rolling-30-day fallback** for back-compat agents whose `periodStart` is null (see §4.2).

### (c) The two new tools — full wiring path

**`make_ugc_video` + `check_creative_budget`. Both must touch all six layers or they won't appear in a deployed agent:**

1. **HTTP handlers** — `convex/gtmMaya/creatifyVideo.ts:821-928` (alongside `creatifyMakeAdHttp` etc.):
   - `makeUgcVideoHttp = httpAction(...)` → `authenticate(ctx,request)` → parse/validate `productUrl`+`avatarScript` → `ctx.runAction(internal.gtmMaya.creatifyVideo.startUgcVideoJob, {...})` → JSON.
   - `checkCreativeBudgetHttp = httpAction(...)` → authenticate → resolve tier server-side (`resolveAgentGatingTier`, `pulseCallbacks.ts:45-55`) + read `periodStart` → `ctx.runQuery(internal.gtmMaya.creativeBudgetGate.checkCreativeBudget, {...})` → return the verdict JSON. Read-only, POST with empty body (matches the discovery-gate pattern at `pulseCallbacks.ts:67-89`).
2. **Route registration** — `convex/http.ts`: import both at `:175-180`; register at `:322-348`:
   - `http.route({ path:'/lc_gtm/make_ugc_video', method:'POST', handler: makeUgcVideoHttp })`
   - `http.route({ path:'/lc_gtm/check_creative_budget', method:'POST', handler: checkCreativeBudgetHttp })`
3. **Plugin contract** — `infra/openclaw-runtime/plugins/maya-gtm-tools/openclaw.plugin.json:14-126`: add `make_ugc_video` + `check_creative_budget` to `contracts.tools` (alphabetical, ~`:107`). Names must match index.js exactly.
4. **Tool definitions** — `infra/openclaw-runtime/plugins/maya-gtm-tools/index.js` (after `:1960`, pattern of `make_static_asset` `:1942-1957`):
   - `tool({ name:'make_ugc_video', label:'Make UGC Avatar Video', description:'Studio-only. Aurora avatar performs a grounded script. ALWAYS call check_creative_budget first.', parameters: Type.Object({ productUrl: Type.String(), avatarScript: Type.String(), imageAssetIds: Type.Optional(Type.Array(Type.String())), modelVersion: Type.Optional(Type.String()), aspectRatio: Type.Optional(Type.String()) }), execute: async (p,_cfg,ctx) => postLc('make_ugc_video', p, ctx.signal) })`
   - `tool({ name:'check_creative_budget', label:'Check Creative Budget', description:'Read-only. Returns remaining creative credits + pacing mode. Call before any paid render.', parameters: Type.Object({}), execute: async (p,_cfg,ctx) => postLc('check_creative_budget', p, ctx.signal) })`
5. **Re-bundle** — `npm run sync:bundled-gtm-plugin` (`scripts/sync-bundled-gtm-plugin.ts:1-117`). Regenerates `convex/agents/packs/maya_gtm/bundledGtmPlugin.ts` (DO NOT hand-edit; `:24-130`). Commit plugin source **and** regenerated bundle together.
6. **Verify count** — `BUNDLED_GTM_PLUGIN_TOOLS` should grow 125 → **127**.

### (d) Studio gating — `convex/gtmMaya/planGtm.ts`

- `GtmPlanFeatures` interface (`:71-127`): add `ugcCreditsMonth: number;` (next to `videoCreditsMonth` `:89`) and `canUgc: boolean;` (next to `canVideo` `:120`).
- `GTM_STARTER_ACTIVE` (`:134-152`): `ugcCreditsMonth: 0, canUgc: false`.
- `GTM_GROWTH_ACTIVE` (`:158-167`): inherits 0 / false.
- `GTM_STUDIO_ACTIVE` (`:173-181`): `ugcCreditsMonth: 60, canUgc: true`.
- `FAIL_CLOSED_DEFAULT` (`:196+`): `ugcCreditsMonth: 0, canUgc: false`.
- Surface in `describePlanForMaya` so the plan summary mentions UGC capability on Studio.
- `startUgcVideoJob` checks `features.canUgc` server-side, fail-closed. (No client trust — tier resolved from `gtmPlanJson` only.)

### (e) Skill rewrite — `maya-ugc-system-advisor` → generative `maya-ugc-producer`

Replace the advisory skill with a producing one. Create `agents/skills/maya-gtm/maya-ugc-producer/SKILL.md` (mirror `maya-static-asset-producer/SKILL.md:1-51`):

- **Purpose:** Maya makes a grounded Aurora UGC clip when a talking-head/testimonial format beats a static asset or slideshow for the validated angle.
- **HARD RULE (top of file):** *"ALWAYS call `check_creative_budget` BEFORE `make_ugc_video`. Never render blind."*
- **Pacing:** *"If mode is `full`, proceed. If `graceful_degrade`, you've run ahead of this month's pace — wait, OR degrade to a cheaper format (`make_static_asset` / your own Gemini slideshow). If `hard_block`, the monthly ceiling is hit — do not attempt; tell the founder UGC resumes next billing period."*
- **Grounding:** pull the script from the grounded fact sheet; pass `imageAssetIds` (real founder screenshots via `search_my_media`) for the product screen. Never invent product claims.
- **Lifecycle:** `check_creative_budget` → `make_ugc_video` → poll `check_video_job` → `send_media_to_user`.
- **Tier honesty:** server-gated to Studio (`canUgc`); on non-Studio Maya never claims to have made a video she can't.
- **Cost cue:** default `aurora_v1_fast`, `9x16`, ~15s ≈ $1.12 — prefer fast over realistic unless budget is flush.
- **Tools reference section** (`SKILL.md:50` pattern):
  ```
  ## Tools reference
  - check_creative_budget — poll budget + pacing mode FIRST
  - make_ugc_video — start Aurora UGC render
  - check_video_job — poll job to terminal
  - send_media_to_user — deliver finished video
  - search_my_media — ground with founder screenshots
  ```
- Update `bundledLocalSkills.ts` (`aurora_v1_fast` mention `~:58-62`): point `go_founder_talking_head` at `make_ugc_video` (not `make_ad_from_url`), default `aurora_v1_fast`.

### (f) Tests (five mandatory categories + creative-specific)

- **Plan-tier × action** (`planGtm.test.ts`): `canUgc` true only on Studio; `ugcCreditsMonth` 0/0/60; `FAIL_CLOSED_DEFAULT` → false/0. starter+growth `make_ugc_video` → fail-closed `ok:false`.
- **Budget gate unit** (`creativeBudgetGate.test.ts`): pure-function tests — `proratedAllowanceCredits` day-1 vs day-15 vs day-30; `evaluateCreativeBudget` → `full` under drip, `graceful_degrade` over drip+buffer, `hard_block` at ceiling; `monthlyCap:0` → hard_block on first credit; back-compat null `periodStart` → rolling-30-day fallback.
- **Cross-tenant isolation:** creative spend summed per `accountId` only; agent A's renders never count against B (verify `isCountableCreativeRow` + index scoping).
- **Ledger semantics:** UGC row lands `provider:'creatify'`, `operation:'creatify_ugc_avatar'`, `creative:true`, `units=creditsUsed`; **excluded from spend-kill** (assert `sumLedgerForAccountSince` with `excludeCreatifyVideo` skips it — `costCap.ts:129`).
- **Adversarial:** failed render (`status:'failed'`) consumes 0 credits (free retry, `countRecentUgc` filters failed); negative/huge `video_length`; missing `periodStart`.
- **Sibling-file scan:** plugin contract (`openclaw.plugin.json`) ↔ index.js tool ↔ HTTP route ↔ skill ref all name `make_ugc_video`/`check_creative_budget` identically; `BUNDLED_GTM_PLUGIN_TOOLS` count = 127.
- **TODO grep:** no new `TODO`/`FIXME`/`eslint-disable`.

### (g) Asset lands in the Assets gallery

`finalizeDoneJob` already calls `mediaAssets.ingestFromUrl` and stamps `mediaStorageId` on the job entry — the finished UGC clip flows into the same `mediaAssets`/Assets surface as static assets and standard video. Confirm the Assets gallery query includes `mode:'ugc_avatar'` jobs (no filter that drops it) and renders video playback for the UGC `mediaStorageId`. No new storage path; reuse the existing ingest.

---

## 3. The cost guards, stacked (all server-enforced, fail-closed)

The prompt instruction ("always check budget first") is layer 0 — convenience, not enforcement. Three server gates sit underneath so a jailbroken or buggy prompt still can't overspend:

| # | Guard | Where | Behavior |
|---|---|---|---|
| **1** | **Per-render ceiling** | `startUgcVideoJob` validates `video_length`/model before render; one `aurora_v1_fast` 15s clip ≈ 7.5cr is the unit | Bounds a single render's blast radius. No unbounded-length renders. |
| **2** | **Daily pro-rata drip** | `evaluateCreativeBudget` → `graceful_degrade` when `usedPeriod > proratedAllowance + perRenderBuffer` (`creativeBudgetGate.ts`) | **Soft.** Maya can't burn the month in week 1. Degrades to cheap formats; never destroys. Recovers as the drip line advances each day. |
| **3** | **Hard monthly ceiling** | `evaluateCreativeBudget` → `hard_block` at `usedPeriod >= ugcCreditsMonth`; `startUgcVideoJob` refuses; `canUgc:false`/`cap:0` blocks on attempt #1 | **Hard.** Absolute COGS cap per tier. Fail-closed: missing/corrupt plan → 0 credits. |

**Separation of concerns (do NOT collapse these):**
- Creative spend stays **excluded from the operational spend-kill** ($1/hr, $6/24h) — `costCap.ts:129` `excludeCreatifyVideo` skips `provider:'creatify'`, and `spendKill.ts:145` keeps it out of the Fly-machine-destroy decision. A burst of renders must never destroy the agent; the three creative guards above are its only ceiling.
- Conversely, the creative budget must NOT gate research/operational reads. Guards 2–3 only count `creative:true` / un-jobbed `creatify` rows (`isCountableCreativeRow`).
- Optional backstop: a separate `evaluateCreativeSpendKill()` with a high daily ceiling (e.g. $50/day, far above 60cr/mo) as a runaway tripwire distinct from the operational kill — defer unless live data shows a need.

---

## 4. Open questions to confirm at build time

1. **UGC path: lipsync (1-step) vs Aurora (2-step).** Docs §3.3 recommend `POST /api/lipsyncs/` with `aurora_v1_fast` (TTS+avatar in one call) over the 2-step `text_to_speech` → `aurora`. Plan assumes lipsync. **Smoke-test both for quality/latency before locking** (`endpoints.ts:155` `createAurora` is currently untyped — type it or skip it for the lipsync wrapper).
2. **Billing window: `periodStart` vs rolling-30-day.** `periodStart` exists in `gtmPlanJson` (`planGtm.ts:542`) but `countRecent*` currently use a hard rolling-30-day window and never read it. Pro-rata pacing **requires** `periodStart`. Confirm: does it reset exactly at `periodStart+30d`, on Stripe renewal, or calendar-aligned? Confirm back-compat agents have it; ship the rolling-30-day fallback either way.
3. **Real UGC credit cost.** `aurora_v1_fast` = 0.5cr/s is the doc estimate; `estimatedCreatifyCostUsd` (`creatifyVideo.ts:175-180`) has no UGC entry. **Validate `credits_used` on a real lipsync job** before trusting the 60-credit ceiling — actual cost from the terminal Creatify response is authoritative, estimates are preflight-only.
4. **`ugcCreditsMonth` vs sharing `videoCreditsMonth`.** Plan recommends a **separate** `ugcCreditsMonth` field so Aurora paces independently of standard/ad-clone video. Confirm product wants separate budgets vs one combined creative pool. (60 is a starting number — tune against §3 real cost.)
5. **Graceful-degrade UX.** On `graceful_degrade`: queue for later, or immediately suggest `make_static_asset`/Gemini slideshow? Plan assumes "suggest cheaper format now." On `hard_block`: tell founder UGC resumes next period. Confirm copy/behavior with product.
6. **Burst buffer shape.** Plan uses per-render buffer (≈8cr above the drip line) over discovery's `HOURLY_FRACTION` (0.25) — more legible to Maya. Confirm; if abuse is a concern, add the per-hour `ugcCreditsMonth/720` cap too.
7. **Per-agent vs per-account budget.** `creatifyJobsJson` is per-`gtmAgents` row; `gtmCostLedger` is per-`accountId`. For multi-agent accounts the budget must be **per-account** → `checkCreativeBudget` must sum the **ledger** (not one agent's `creatifyJobsJson`). Plan assumes ledger-sourced per-account. Confirm.
8. **Failed-render credit.** `countRecentUgc` filters `status!=='failed'` → failed = free retry. Confirm that's the desired UX vs charging for partial renders.
9. **New ledger index.** Add `by_account_creative_created: ['accountId','creative','createdAt']` to `gtmCostLedger` (`schema.ts ~:4560`) mirroring `by_account_discovery_created` for fast period-windowed sums; confirm the `creative` optional-boolean field already exists in the schema union (discovery does — `creative` likely needs adding). Schema bump must land before deploying `checkCreativeBudget`.
10. **Studio scope.** Confirm Aurora ships to all Studio agents (not a separate add-on package) — plan assumes Studio-wide via `canUgc`.

**Files touched:** `convex/integrations/creatify/{endpoints,types}.ts` · `convex/gtmMaya/creatifyVideo.ts` · `convex/gtmMaya/creativeBudgetGate.ts` (new) · `convex/gtmMaya/{planGtm,costLedger,schema}.ts` · `convex/http.ts` · `infra/openclaw-runtime/plugins/maya-gtm-tools/{openclaw.plugin.json,index.js}` · `convex/agents/packs/maya_gtm/{bundledGtmPlugin.ts (gen),bundledLocalSkills.ts}` · `agents/skills/maya-gtm/maya-ugc-producer/SKILL.md` (new) · tests in `convex/gtmMaya/*.test.ts`.