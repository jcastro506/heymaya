# Sprint Plan — Trust, Thinking, and Product Accuracy (V1)

**Status:** PLANNED — not started. Branch off `main` (current working branch `feat/thinking-trace-redesign`).
**Owner:** Joshua Castro
**Created:** 2026-06-15
**Context:** First real prod signup demo'd on hey-maya.ai (Plausible Analytics). Demo surfaced: duplicate synthesis, kickstart timeout, a Thinking view that looks like Today, no autonomous-vs-confirm choice, and unverified product understanding. This sprint closes the trust + accuracy gaps that the demo exposed and makes the Thinking view actually impressive.

---

## 0. The thesis

Three asks, one spine:

1. **Maya must be provably accurate about the product** before we let her act autonomously. Accuracy the founder can *see and correct* is the prerequisite for trust.
2. **The founder chooses how much rope Maya gets** — confirm every post, or let her post autonomously — and can change their mind as trust grows.
3. **The Thinking view must show the depth of her reasoning, grounded** — not a reorganized action log. The grounded research she already does (and currently hides) is the "wow."

These connect: the "what Maya understands about your product" surface (W1) is *also* the verification UI that makes autonomy (W2) safe, *and* one of the richest cards in the redesigned Thinking view (W3). Build accuracy first, autonomy on top, and let the Thinking view render the proof of both.

---

## 1. Locked decisions

- **Ban-safety floor is absolute.** Reddit + TikTok stay always-confirm (`MANUAL_CONFIRM_CHANNELS`, [calendarWrite.ts:648](../convex/gtmMaya/calendarWrite.ts)). The new autonomy toggle can NEVER override this — TikTok's one-tap *is* the `express_consent_given` legal flag. The toggle only affects X / LinkedIn / Instagram / YouTube.
- **HN is unaffected** — always paste-delivery; the toggle is irrelevant there.
- **Plan tier is the ceiling, toggle is the preference within it.** `planFeaturesGtm.canAutoPost` ([planGtm.ts:59](../convex/gtmMaya/planGtm.ts)) is the hard gate; the user toggle is a softer preference layered inside it. Toggle=auto + plan=no-auto → still confirm.
- **The existing safety gate stays.** Even in autonomous mode, the 3-verdict gate ([publishEngine.ts:180](../convex/gtmMaya/publishEngine.ts)) bumps any failed-voice/slop/safety/hallucinated-claim draft to `needs_confirm`. "Autonomous" never means "unguarded."
- **Thinking view reads TWO data sources.** Keep `gtmAgentActivity` for the live pulse; add direct reads of the foundation tables (`gtmBuyerMap`, `gtmCompetitiveMap`, `gtmChannelScorecard`, `gtmContentAngles`, voice profile) for the grounded reasoning body. A flattened `post_activity` summary throws away the structure (quote + source URL + scorecard) that makes it impressive.
- **Today view stays the action feed.** The redesign differentiates Thinking by *content and data source*, not just layout.

---

## 2. W0 — Restore git/prod drift (do first, blocks all deploys)

**Problem:** A `git reset --hard` wiped uncommitted admin helpers from `convex/_admin/realWorldDeployGtm.ts`. They are DEPLOYED to prod Convex (`resilient-mandrill-621`) but ABSENT from git. Any `convex deploy` from `main` will drop them.

**Restore to git** (read from prod deployment or reconstruct):
- `compRealAgentByEmail` — comp an agent to gtm99 active by email (Stripe bypass for demos).
- `peekLatestRealAgent` — returns deploy state + plan + telegram + recent activity + recent `mayaMessages`.
- `attachLatestAgentToEmail` + `repointLatestTestCreator`.
- The `mayaMessages` / `gtmApps` reads added to `peek`.
- (`patchTelegramChatId` already exists — verify it's in git.)

**Acceptance:** `git grep` finds all five helpers; a dry `convex deploy --preview` doesn't report dropped functions; commit lands on a branch before any further prod deploy.

**Hygiene:** delete the stray `" 2.ts"` Finder-duplicate junk files littering the tree (do not commit them).

---

## 3. W1 — Product-accuracy & grounding hardening (prerequisite for autonomy)

**Goal:** Maya's understanding of the product is correct, verifiable by the founder, and correctable after onboarding.

### What exists (don't rebuild)
- Founder free-text `differentiator` + `founderWhy` → `gtmApps` → anchored in `APP.md`. ([generators.ts:857](../convex/agents/packs/maya_gtm/generators.ts))
- Walkthrough video → Gemini multimodal read → `diagnosis.walkthrough`. ([walkthrough.ts](../convex/gtmMaya/walkthrough.ts))
- URL keyword-scan → `diagnosis.summary`. ([appInspector.ts](../convex/gtmMaya/appInspector.ts)) — weak, regex-only.
- **Grounded web search already wired server-side:** `geminiGroundedSearch` ([groundedSearch.ts](../convex/integrations/gemini/groundedSearch.ts)) — cited, ~$0.035/query, soft-fails clean — exposed as the `webSearch` internalAction ([webSearch.ts:36](../convex/gtmMaya/webSearch.ts)). Used today by the monthly platform-algo cron and as the agent's `search_web` tool; NOT used at onboarding for the product picture. **This is the missing piece.**
- Maya re-reads the live URL herself via `web_fetch` at foundation and is told to correct the digest.
- Grounding guards: SOUL.md "I am NOT the product"; outbound firewall two-pass ([outboundFirewall.ts](../convex/gtmMaya/outboundFirewall.ts)); safety gate flags `hallucinated_claim`.

### Gaps to close
0. **The inspector is regex, not intelligence.** `appInspector.ts` keyword-scans HTML (`indexOf("pricing")`); it cannot read a differentiator or build a real picture. We have grounded web search sitting unused at onboarding.
1. **No post-onboarding product-fact correction.** Founder can't edit `differentiator`, `founderWhy`, `stage`, `weekGoal`, `userCountBand`, etc. after onboarding. Corrections in chat go to ephemeral memory, not `gtmApps`.
2. **"What Maya understands" is invisible.** The founder never sees Maya's working picture of the product, so they can't catch a misunderstanding before she posts.
3. **Mobile-only apps fail silently** — URL required + validated as `http…`, but App Store links yield empty `diagnosis`; no fallback to the App Store description.
4. **No claim ledger.** Drafts assert product capabilities with no persisted, founder-confirmed set of "things that are true about this product" to check against.

### Build
- **W1.0 — Intelligent product picture (LLM read + grounded web search). PRIMARY.** Upgrade `appInspector.ts` from regex to a synthesis pass that builds a real picture:
  1. Fetch the URL + key pages (already done — keep).
  2. Run `geminiGroundedSearch` on the product: name/domain → "what is `<product>`", "`<product>` vs", reviews, comparisons — i.e. how the *world* describes it, cited. (~$0.035)
  3. Feed fetched HTML + search results + the founder's `differentiator`/`founderWhy` into Gemini (via OpenRouter, already wired) → a **structured product picture**: one-sentence promise, what it does, who it's for, the real differentiator, category, pricing, named competitors, proof points, and a `confidence` + `gaps`/`unverified` list. Store on `gtmApps.diagnosis.picture` (next to `.summary`/`.walkthrough`).
  - Total ~$0.04. Keep the regex `summary` as a cheap fallback if search/LLM soft-fails. Render `picture` into `APP.md` as the strong prior (still "verify in research"), and surface it in the W1.1 product-brain surface so the founder confirms/corrects it.
  - **Mobile-app win:** the grounded search returns a picture even when the site is unscrapeable — feeds W1.3.
- **W1.1 — "Product brain" surface (read + edit).** A screen (Mission Control → Account/Product) that shows Maya's working picture: the differentiator (founder's words), the promise she reads from the site, core workflow, who it's for, what it does NOT do. Each field **editable**, writing back to `gtmApps`. This is the verification UI that makes autonomy safe.
  - New mutation `updateProductContext(agentId, { differentiator, founderWhy, stage, weekGoal, userCountBand, ... })` — auth-scoped, fail-closed.
  - On save, mark foundation as `needs_refresh` so the next pass re-grounds on corrected facts (or trigger a lightweight re-read).
- **W1.2 — Maya can update product facts conversationally.** A `update_product_fact` tool the agent calls when the founder corrects her in chat ("no, it's for teams not solos") → persists to `gtmApps`, not just session memory. Closes the loop the demo memory flagged ("she logs to MEMORY.md, doesn't persist").
- **W1.3 — Mobile-app store scraping (no-landing-page path). VERIFIED-FEASIBLE.** Today a mobile-only founder is blocked: `canSubmit` ([page.tsx:228](../app/onboarding/gtm/page.tsx)) hard-requires an `http` web `url`, and `inspectApp` ([appInspector.ts:90](../convex/gtmMaya/appInspector.ts)) only crawls that `url` — the optional `appStoreUrl`/`playStoreUrl` fields are captured but **never consumed** (`git grep` confirms zero reads). A founder with an app and no website cannot onboard with a real product picture. Fix:
  1. **Relax the onboarding gate.** `canSubmit` accepts a store URL *or* a web `url` (require at least one + a name). A mobile founder submits with just an App/Play link.
  2. **Parse the store ID from the URL.** Apple: `/id(\d+)/` from `apps.apple.com/.../id6448385721`. Google: `[?&]id=([\w.]+)` from `play.google.com/store/apps/details?id=com.company.app`.
  3. **Apple → iTunes Lookup API (clean, free, no key).** `https://itunes.apple.com/lookup?id=<id>` returns JSON: full marketing `description`, `trackName`, `genres`, `averageUserRating` + `userRatingCount`, `screenshotUrls`, price/IAP, release notes. **The `apps.apple.com` *web page* is client-hydrated — do NOT scrape its HTML; use the Lookup API.** *(Live-verified 2026-06-15 against Duolingo id 570060128: returned name, genres [Education, Social Networking], 4.73★/5.24M, full description.)*
  4. **Google Play → parse the server-rendered listing.** Play has **no official public metadata API** (the Play Developer API is auth-gated to your own apps). The listing HTML IS server-rendered, **but the description/category/rating live in the embedded `AF_initDataCallback` JSON blob, NOT in `og:` meta tags** (`og:description` is empty — verified live). Parse the `AF_initDataCallback` blob (or use the `google-play-scraper` npm lib for resilience to markup drift). *(Live-verified 2026-06-15 against `com.duolingo`: 1.27MB server-rendered HTML, `AF_initDataCallback` blob present, category resolvable; naive `og:` scraping fails.)*
  5. **`inspectApp` branches on `appType`.** When `mobile` (or the web scan is empty), fetch store metadata instead of crawling a dead `url`, normalize to the same shape, and feed it into the W1.0 grounded-picture synthesis alongside `geminiGroundedSearch` (`"<product> app"` reviews/comparisons) + the walkthrough video. Result: a full picture with no landing page.
  - **Not via ScrapeCreators** (social-only). W1.3 adds a small new fetch path in `convex/integrations/` (Apple Lookup + Play blob parse). Apple is free; Play is one fetch. Net-new code, not a config flip.
- **W1.4 — Confirmed-claims ledger (stretch).** A small set of founder-confirmed true claims (features, metrics, customers) that the pre-publish gate can check a draft against — turns "hallucinated_claim" from an LLM guess into a grounded check. Defer if W1.1–W1.3 fill the sprint.

### Tests
- Cross-tenant: founder A cannot read/edit founder B's product context.
- Edit round-trips to `gtmApps` and re-renders into `APP.md` on next deploy.
- Mobile-only app (no web URL) onboards without empty `diagnosis`.
- Adversarial: edit payloads with injection / oversized strings are clamped.
- **W1.3 store-scrape effectiveness (must PROVE we can scrape, not assume):**
  - **Store-ID parse:** Apple `/id(\d+)/` and Play `[?&]id=([\w.]+)` extract correctly from real + messy URLs (trailing slugs, query params, country prefixes, `?hl=` suffixes); reject non-store URLs.
  - **Apple Lookup integration:** a live/recorded `itunes.apple.com/lookup?id=<id>` response parses into a non-empty picture (description + genres + rating). Soft-fail (network/404/`resultCount:0`) → clean fallback to grounded search, never a thrown onboarding error.
  - **Play blob parse:** the `AF_initDataCallback` extractor yields description + category + rating from a real listing fixture; assert it does NOT rely on `og:description` (which is empty). Markup-drift guard: if the blob shape changes, soft-fail to grounded search rather than crash.
  - **End-to-end mobile onboard:** `appType: "mobile"` + store URL + no web `url` passes `canSubmit`, runs `inspectApp` down the store path, and lands a non-empty `gtmApps.diagnosis.picture`.
  - **Gate relaxation:** web-only and mobile-only both submit; neither-URL is still rejected.
  - **Live smoke (manual, pre-merge):** run the Apple Lookup + Play fetch against 2–3 real apps and eyeball the picture — the "know we can scrape effectively" check, not just mocked unit tests.

---

## 4. W2 — Autonomous-vs-confirm posting toggle

**Goal:** Founder chooses whether Maya posts autonomously (X/LI/IG/YT) or confirms each one, set at onboarding and changeable later, with a trust-ramp default.

### Build
- **W2.1 — Schema.** Add `autonomousPosting` to `gtmAgents` as a small enum, not a bare bool:
  - `"confirm_each"` — every auto-channel post routes to a one-tap confirm card.
  - `"confirm_first_week"` (DEFAULT) — confirm for N days / first M successful posts, then auto. The trust ramp.
  - `"autonomous"` — auto-post the auto-channels (Reddit/TikTok still confirm).
  - Store the ramp counters (`autonomousSince`, `confirmedPostCount`) needed to graduate `confirm_first_week → autonomous`.
- **W2.2 — Onboarding capture.** Add to `IntakeDraft` + the form ([app/onboarding/gtm/page.tsx:34](../app/onboarding/gtm/page.tsx)). Frame it plainly: "Want to approve each post first, or let me just handle it?" Default to confirm-first-week.
- **W2.3 — Generator render.** Thread `autonomousPosting` through `MayaGtmWorkspaceInput` → render the policy into `USER.md`/`SOUL.md` so the agent knows whether to expect to confirm. ([generators.ts](../convex/agents/packs/maya_gtm/generators.ts))
- **W2.4 — Publish-engine gate.** In `publishContentDirect` ([publishEngine.ts](../convex/gtmMaya/publishEngine.ts)): read the agent's `autonomousPosting`; if `confirm_each` (or `confirm_first_week` not yet graduated), force `needs_confirm` on the auto-channels too. `founderConfirmed: true` still overrides (their tap is consent). Ban-safety channels unchanged.
- **W2.5 — Conversational + settings change.** A `set_posting_mode` tool so Maya can flip it when the founder says "you can just post from now on," plus a control on the W1 Product/Account surface. Maya proactively offers graduation once a few posts land well.

### Open product decisions (operator)
- **Per-post vs per-batch confirm.** Confirm-each can mean 15 Telegram taps/week. Alternative: approve the *week's calendar* once. Decide granularity. *(Recommendation: per-post for v1, revisit batch approval if the tap tax bites.)*
- **Ramp threshold** for `confirm_first_week` graduation — days, successful-post count, or both. *(Recommendation: 3 confirmed posts OR 7 days, whichever first, then offer to graduate.)*

### Tests
- Plan-tier × toggle matrix: plan=no-auto + toggle=autonomous → still confirms (fail-closed).
- Reddit/TikTok always confirm regardless of toggle.
- `founderConfirmed` overrides toggle.
- Ramp graduation logic: counters increment, graduation fires once, doesn't regress.
- Cross-tenant: toggle change scoped to owner.

---

## 5. W3 — Thinking view redesign (grounded reasoning, the "wow")

**Goal:** The Thinking view shows *what Maya figured out and why*, grounded in verbatim quotes + clickable sources — categorically different from the Today action feed.

### Root problem
Thinking and Today read the **same** table (`gtmAgentActivity`) with the **same** query (`getMyAgentActivity`). The redesign changed layout, not data. The rich reasoning lives in foundation tables the Thinking view never touches, and the foundation pass never even calls `post_activity`, so its best work is invisible.

### Two streams → two surfaces
- **Live pulse** (`gtmAgentActivity`): the real-time spine — "thinking now," what she's doing this minute. Keep.
- **Grounded reasoning** (foundation tables, queried directly): rich insight cards — **Observation → Insight → Decision, grounded**. The headline judgment, the reasoning, the verbatim buyer quote, the clickable source chip, the channel scorecard bars.

### Build
- **W3.1 — Foundation reasoning query.** New auth-scoped query (e.g. `getMyFoundationInsights`) reading `gtmBuyerMap`, `gtmCompetitiveMap`, `gtmChannelScorecard` (incl. `icpKnowledge` + `styleExemplarsJson`), `gtmContentAngles` (`painCitation` quote + URL), and `voiceProfileJson`. Returns structured insight cards, not flattened text.
- **W3.2 — Insight-card UI.** Render each as Observation → Insight → Decision with a verbatim quote block + source hostname chip (reuse the redesign's source-chip pattern). Group by theme: *Your buyer*, *Who you compete with + your wedge*, *Why these channels*, *Your voice*, *Angles I'll use*.
- **W3.3 — Foundation `post_activity` breadcrumbs.** Have each `save_foundation_*` write ALSO drop a lightweight `post_activity` line ("mapped your competitive landscape — 18 competitors, found your wedge") so the live rail narrates the impressive work as it happens. The breadcrumb gives the "watch it happen" feel; the W3.2 card gives the depth on click. ([managerCallbacks.ts](../convex/gtmMaya/openclaw/managerCallbacks.ts) + the `save_foundation_*` HTTP handlers.)
- **W3.4 — Product-understanding card.** Surface Maya's working picture of the product (from W1) as the top card — "here's what I understand you do, and here's the proof I read it right" — with an inline link to the W1 edit surface. This is the verification + wow moment in one.
- **W3.5 — Layout.** Live pulse rail (left/top) + grounded reasoning body. Keep Hour/Day/Week + kind chips for the pulse; reasoning cards are state-of-knowledge, not time-bound.

### Tests
- Cross-tenant: foundation insights scoped to owner only.
- Empty-foundation state renders gracefully (new agent, pre-foundation).
- Source chips only render for real `http` URLs; verbatim quotes are never fabricated (they come straight from the stored `sourceUrl` rows).
- Breadcrumbs respect the same Gate-1b "say only what landed in the DB" rule.

---

## 5b. W4 — Onboarding tightening & field audit (CORRECTED)

**Goal:** Cut onboarding burden and remove genuinely-useless options — WITHOUT changing behavior we rely on. An audit of the GTM intake form ([app/onboarding/gtm/page.tsx](../app/onboarding/gtm/page.tsx)).

### ⚠️ Safe-delete lesson (read before touching any field)
A first-pass audit called several fields "dead." A full grep across `convex/` (including `bundledPlaybook.ts` / `bundledLocalSkills.ts`), the generators, and tests proved that **wrong**: fields with no form UI are still consumed downstream via their *defaults*. **Rule: no onboarding field gets deleted without a repo-wide grep across convex code + bundled skill/playbook strings + tests + scripts, and a tsc + full gtm suite run.** "No form input" ≠ "unused."

### Verified field reality
- **`canPostTikTokManually` / `canPostInstagramManually` — LOAD-BEARING, do NOT delete.** Hard gate baked into the bundled playbook ("IF `canPostTikTokManually !== true` → park TikTok; V1 has no auto-post"). Consumed by `channelScoring`, `tiktokWarmup`, `productionReality`, `distributionMotions`, `researchWorker`, `channelAgents`, `walkthrough` + `generators` (APP.md render). **Action: reconcile/relabel in W2** — `canPostInstagramManually` is labeled "Maya posts for me" (opposite of its name); the auto-vs-confirm question W2 adds partially subsumes these. Keep the gate, fix the framing.
- **`openToUgcCreators` / `creatorBudgetMonthlyUsd` / `maxWeeklyVisualPosts` — USED, not dead.** No form UI → run on silent defaults (`UGC: no`, `3 visuals/wk`). Consumed by `channelScoring` (UGC unlocks a TikTok visual path), `tiktokWarmup` (weekly posting cap), `productionReality`, `researchTasks`, `channelAgents`, `generators`. **DECISION NEEDED** (see below).
- **`appStoreUrl` / `playStoreUrl` — genuinely unused downstream today**, but slated for W1.3 (mobile-app fallback). **Keep + wire in W1.3**, do not delete.
- **`differentiator` — optional, but it's THE anchor.** Make it confirm-required, pre-filled from the W1.0 grounded picture.
- **Walkthrough upload — mislabeled "Mobile" + buried.** It's our best accuracy signal for *any* app type. Relabel + promote for all app types.
- **No X / Reddit handle captured** — only TikTok/IG/YT/LinkedIn. Reddit + X are her primary posting channels, so voice extraction runs blind there. Consider adding an X handle (Reddit username optional).
- **`stage` vs `userCountBand` overlap** — two stage selectors; consider consolidating.
- **Junk removed (done this session):** stray untracked `" 2"` Finder-duplicate files (`generators 2.ts`, `bundledLocalSkills 2.ts`, creatify dupes, demo media dupes, `CREATIFY_API_REFERENCE 2.md`) deleted. They were never tracked; deletion is safe and changes nothing.

### Decisions for the operator
1. **UGC trio** (`openToUgcCreators`/`creatorBudget`/`maxWeeklyVisualPosts`): (A) wire into the form (they're useful — UGC budget gates visual channels, capacity sets cadence); (B) **intentionally** remove the logic + fields (deliberate behavior change across ~5 modules + ~6 test files — NOT a "safe delete"); or (C) leave on documented defaults for now. *(Recommendation: C now, A if/when UGC-hiring becomes a real MVP path — it's a "later" feature per strategy.)*
2. **Capability toggles**: confirm they get relabeled + reconciled with the W2 toggle (keep the gate).
3. **Add X / Reddit handle capture** for voice grounding? *(Recommendation: yes — add X handle; cheap, big voice-accuracy win.)*
4. **Consolidate `stage` + `userCountBand`?** *(Recommendation: keep both for now; userCountBand is the ground truth, stage is the founder's self-label — they diverge usefully.)*

Net: with W1.0 pre-filling the differentiator and the picture, we can make the form *shorter and more accurate* — drop confusing toggles, pre-fill the anchor, surface the walkthrough — rather than just adding fields.

---

## 6. Adjacent live-bug fix cluster (from the 2026-06-15 demo)

Tracked here because W3.3 (foundation `post_activity`) overlaps. Decide whether to fold into this sprint or run parallel:

1. **Idempotent synthesis send** — stamp `synthesisDeliveredAt` atomically; send path refuses a 2nd strategic synthesis (fixes the 3× duplicate handover).
2. **Fast-dispatcher kickstart** — `0001_kickstart` returns in seconds (cheap setup + spawn workers), heavy reasoning in bounded parallel workers (fixes the 5-min cron timeout + the re-entry that caused duplicates).
3. **Provider reliability for Kimi K2** — route to a fast provider / mid-stream failover (we've hit Groq stalls before; Novita reliable). Config noise: "thinking level medium not supported for kimi-k2-0905."
4. **Boot hello race** — fires before `telegramChatId` is set on the skip-Telegram path.

> (1) and (2) are the same fix the prior handoff identified and remain the highest-leverage reliability work; W3.3 makes (2)'s worker output visible.

---

## 7. Sequencing

1. **W0** — restore git drift (blocks deploys; do immediately).
2. **W1** — product-accuracy surface (prerequisite for safe autonomy; also feeds W3.4).
3. **W3** — Thinking redesign (demo-facing wow; mostly additive; W3.4 reuses W1).
4. **W2** — autonomy toggle (smaller; safe to ship once W1 verification exists).
5. **§6 fix cluster** — fold (1)+(2)+W3.3 together; (3)+(4) can trail.

Rationale: W0 unblocks, W1 de-risks W2, W3 is the highest-visibility win and shares W3.4 with W1.

---

## 8. Testing — the 5 mandatory categories (per CLAUDE.md)

Every workstream above must satisfy:
1. **Cross-tenant isolation** — A's product context / toggle / insights never reachable by B.
2. **Plan-tier × action matrix** — fail-closed server-side, incl. reads (the autonomy gate especially).
3. **Adversarial inputs** — edit payloads, injection, oversized strings, malformed URLs.
4. **Sibling-file scan** — new tool ⇒ generators TOOLS.md entry ⇒ skill entry ⇒ schema field, all coherent.
5. **TODO grep** — no unjustified `TODO`/`FIXME`/`eslint-disable`.

Plus: `convex` tsc 0 + root tsc 0, full gtmMaya suite green, before any merge.

---

## 8b. Deployment discipline — staging vs main (RESPECT THIS)

Two separate Convex deployments, each with its own env vars/secrets. Do not cross wires.

| Surface | Convex deployment | How it's reached | Env/secrets |
|---|---|---|---|
| Local dev + **staging** | `precise-canary-781` (`dev:` in `.env.local`) | default `npx convex …` (no flag); staging branch | staging set |
| **main / production** (hey-maya.ai) | `resilient-mandrill-621` | `npx convex … --prod` ONLY | prod set (distinct) |

**Branch → deploy flow:** feature branch → PR to `staging` (→ `precise-canary-781`) → PR `staging` → `main` (→ `resilient-mandrill-621`, go-live). Never push schema/functions straight to `main`/prod.

**Rules for this sprint:**
- **All testing/comping happens on staging** (`precise-canary-781`), never prod. (Per operator: real signups test on STAGING, not prod.)
- **Restore the W0 git/prod drift BEFORE any `--prod` deploy.** The admin helpers are deployed to prod but absent from git; a `convex deploy --prod` from a branch missing them would drop them. W0 is the prerequisite for touching prod at all.
- **Schema changes deploy to staging first**, verified, before they ever reach prod. New optional fields are additive-safe; field *removals* need a migration (see W4 safe-delete rule) and must go staging → main, never direct.
- **Env vars are per-deployment.** Any new secret (e.g. a new env key for W1.0 grounded search, if needed) must be set on BOTH `precise-canary-781` and `resilient-mandrill-621` — setting it once does not propagate.
- **`--prod` is explicit and deliberate.** Default `npx convex run/deploy` targets staging; only add `--prod` when the intent is production, and say so.

---

## 9. Open decisions for the operator (collected)

- **W2:** per-post vs per-batch confirm; ramp graduation threshold.
- **W2:** is `confirm_first_week` the right default, or start at `confirm_each`?
- **§6:** fold the live-bug fix cluster into this sprint, or run it parallel?
- **W1.4:** build the confirmed-claims ledger now, or defer past this sprint?
