# Zernio capability audit — full surface coverage check

**Author:** Claude (Opus 4.7) on behalf of Joshua Castro
**Date:** 2026-04-27
**Scope:** Verify Zernio's documented capabilities against every HeyMaya service-product feature that depends on Zernio, BEFORE running the originally-planned review-reply spike.

**Why this audit exists:** the build agents (Sprint 0 → Wave D) took the operator decision "v0 routes everything through Zernio" as the architecture lock and built against the *claim*, not the *spec*. The plan flagged review-reply depth as the single open question, but never verified the *rest* of the Zernio surface area we depend on. This document closes that gap by reading Zernio's own docs (docs.zernio.com + their OpenAPI spec at /api/openapi) and characterizing every surface we depend on as 🟢 (verified working), 🟡 (works with constraints), or 🔴 (gone / requires architecture change).

**Sources:**
- `https://docs.zernio.com/platforms/google-business`
- `https://docs.zernio.com/platforms/facebook`
- `https://docs.zernio.com/platforms/instagram`
- `https://docs.zernio.com/platforms/tiktok`
- `https://docs.zernio.com/platforms/linkedin`
- `https://docs.zernio.com/platforms/youtube`
- `https://docs.zernio.com/pricing`
- `https://docs.zernio.com/webhooks`
- `https://docs.zernio.com/posts/create-post`
- `https://docs.zernio.com/api/openapi` (OpenAPI spec, fetched via WebFetch)

---

## TL;DR

**Verdict: 🟡 yellow — Zernio works for the core review + post + comment + DM workflow, but three product features we already shipped depend on capabilities Google/Zernio don't expose, and Zernio's local-post wrapper is photo-only even where Google's API supports more.** The right path is targeted product changes plus pursuing direct GBP API partner access in parallel. Zernio is still the right primary vendor for v0.

**Update 2026-04-27 (post-Path-A verification):** Per-post GBP analytics deprecation **confirmed at Google level** via [Google's own deprecation schedule](https://developers.google.com/my-business/content/sunset-dates) — `LOCAL_POST_VIEWS_SEARCH` and `LOCAL_POST_ACTIONS_CALL_TO_ACTION` deprecated 2022-11-21, discontinued 2023-02-20, no replacement. Direct GBP partner access does NOT bring per-post metrics back.

**Update 2026-04-27 (video correction):** Video CAN go to a GBP via the **Media gallery** (`accounts.locations.media.create` with `mediaFormat: VIDEO`) per Google's own [MediaItem schema](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.media). What's photo-only in practice is the **Local Posts** surface (the timeline-style "What's New" feed) — Google's examples are all `PHOTO`, no callouts for `VIDEO`, and Zernio's wrapper matches that. Distribution-wise: gallery videos appear on the listing's Photos tab and are visible to anyone browsing the listing's media; local-post videos would have appeared in the timeline feed (~7 day visibility) but don't.

**Three shipped features need correction before beta** (the fourth — clip-composer's GBP target — was walked back per operator correction; Maya decides per-moment which platform makes sense for any given asset, including GBP gallery video once direct GBP API lands):

| What we built | Why it doesn't work | Fix |
|---|---|---|
| C.6 Q&A monitoring fold-in into review-reply-drafter | Google deprecated the GBP Q&A API ("replaced by AI-powered 'Ask Maps'"). Not Zernio's fault — gone at the source. | Drop Q&A from review-reply-drafter SKILL.md + Zernio webhook subscriptions. |
| `inboundLeads.source: "gbp-msg"` enum value | [Google sunset Business Messages on 2024-07-31](https://support.google.com/business/answer/14919056). The `gbp-msg` source can never fire. | Annotate enum value as deprecated/never-fires. Lead-response-nudger relies on FB-DM, twilio-missed-call, twilio-sms — unaffected. |
| `gbpPosts.engagementMetrics` per-post (callsClicked / directionsClicked / websiteClicked / postViews) | Google deprecated the per-post insights endpoint (2022-11-21 → 2023-02-20). Only **location-level** metrics survive. Direct GBP partner access does NOT bring this back. | Schema field stays but is null on GBP. Outcome attribution for GBP posts becomes "during weeks Maya posted N times, location calls went up X%" — correlational, not per-post causal. Update outcome attribution + Growth tab metric labels. |

**One walked-back recommendation** (operator correction 2026-04-27): I previously said "drop GBP from clip composer targets." That was wrong on two counts. (1) Clip composer is a JUDGMENT wrapper — Maya decides per-moment whether to invoke it and for what target, not at code-time. The "GBP at 16:9" entry in the SKILL.md is platform-physics knowledge, not a hardcoded rule that Maya must always output. (2) Video CAN go to a GBP via the Media gallery once direct GBP API partner access lands. So GBP video isn't dead — it's gated on direct API access, not on a clip-composer-target list.

**One known constraint already understood from prior reads:**
- 🟡 Review-reply moderation pass-through is silent — Zernio's response and webhooks never surface Google's `ReviewReplyState`. Spike still required to characterize the silent-failure mode behaviorally, but the architecture decision is already made: assume operator-approval-only, don't trust auto-publish to actually land.

**One pricing reality we didn't account for:**
- Build tier ($19/mo) is too small for even 5 beta operators (10-profile cap, 120-post/mo cap). Realistic vendor cost = Accelerate $49 + Inbox $50 + Analytics $50 = **$149/mo** to run beta.

---

## Surface-by-surface audit

### Google Business Profile

#### Reviews

| Capability | Status | Evidence |
|---|---|---|
| Read reviews | 🟢 | `GET /v1/inbox/reviews?platform=googlebusiness` and `GET /v1/accounts/{accountId}/gmb-reviews` both documented |
| Reply to reviews | 🟢 (mechanically) | `POST /v1/inbox/reviews/{reviewId}/reply` with body `{ accountId, message }` |
| Delete review reply | 🟢 | `DELETE /v1/inbox/reviews/{reviewId}/reply` |
| Surface Google's `ReviewReplyState` rejection | 🔴 | No field in response or webhook payload. The `ReviewWebhookReview` schema only has `hasReply: boolean` and `reply: { text, createdAt }` — no rejection reason, no moderation state. **Silent-failure risk for AI-flavored or policy-violating replies.** |
| Webhook events | 🟡 | `review.new` and `review.updated` only. No `review.reply.failed`. The only post-hoc signal that a reply was rejected is `review.updated` firing later with `hasReply=false`. |
| Required Zernio addon | 🟡 | Inbox add-on required (`+$10/mo on Build`, `+$50/unit on Accelerate`) |

**Product impact:** review-reply moderation gap remains a real risk. The operator-approval requirement we already enforce (Google `ReviewReplyState` lock at every plan tier per `convex/planService.ts:approvalRulesEnableable`) is correct *defensively* — it limits silent-failure blast radius to the manual approval step. But our HQ Reviews screen "✅ posted" indicator may lie if Google later strips the reply. **Add a passive verification poll**: 24h after `replyStatus="posted"`, re-fetch the review and confirm `hasReply: true`. If it flipped to false, mark `replyStatus="rejected-by-google"` and surface to the operator.

---

#### GBP local posts

| Capability | Status | Evidence |
|---|---|---|
| Create local post (text + image) | 🟢 | "Text + Image (default, recommended)" |
| Text-only post | 🟡 | Supported but "lower visibility on Google Search and Maps" per docs |
| CTA button post | 🟢 | Documented |
| Event post | 🟢 | Documented |
| Offer post | 🟢 | Documented |
| Video post | 🔴 | "Videos are **not supported**" verbatim |
| Carousel / multi-image | 🔴 | "Images per post: 1" |
| Scheduling | 🟢 | "Scheduling: Yes" in Quick Reference table |
| Photo upload (cover/profile/exterior/etc.) | 🟢 | Categories: COVER, PROFILE, LOGO, EXTERIOR, INTERIOR, FOOD_AND_DRINK, MENU, PRODUCT, TEAMS, ADDITIONAL |
| Post visibility window | 🟡 | "Posts are visible for about 7 days before being archived" — affects content cadence planning |

**Product impact:**
- **Clip composer (C.6)** targeted GBP at 16:9 — needs to be dropped. Update `agents/skills/maya-service-clip-composer/SKILL.md` to remove GBP from platform targets. Reels (IG, FB), TikTok, YouTube Shorts remain.
- **Content-arc-planner** must respect single-image-only on GBP. If carousel content is desired for cross-platform posting, GBP gets the cover image only, FB/IG get the full carousel.
- **GBP-post-optimizer** behavior at 7-day archive window: cadence guidance (the auditor's nudges) should account for this — a 14-day-old post is invisible, so "post X-times-per-week" is the right framing not "post X total in the last month."

---

#### GBP analytics (Performance)

| Metric | Available | Granularity |
|---|---|---|
| Calls (CALL_CLICKS) | 🟢 | Location-level |
| Direction requests (BUSINESS_DIRECTION_REQUESTS) | 🟢 | Location-level |
| Website clicks (WEBSITE_CLICKS) | 🟢 | Location-level |
| Impressions (mobile/desktop, search/maps) | 🟢 | Location-level |
| Bookings | 🟢 | Location-level |
| Search keywords | 🟢 | Monthly aggregation |
| **Per-post engagement (post views, post calls, post directions)** | 🔴 | **Deprecated by Google.** "Per-post analytics are not available for Google Business Profile. Google deprecated the per-post insights endpoint." |

**Product impact:** This is the biggest gap. Our `gbpPosts` schema (lines 1610-1657 in `convex/schema.ts`) has an `engagementMetrics` object with `callsClicked / directionsClicked / websiteClicked / postViews` per post + `attributedLeadIds` linking back to specific posts. Per Google's own deprecation, **none of these per-post fields can ever be populated.**

What we keep:
- ✅ Schema fields stay (don't remove — empty/null is harmless and forward-compatible if Google ever re-exposes)
- ✅ Location-level metrics on Growth tab (calls, directions, website-clicks) — still our Maya-attribution surface
- ✅ Search-keyword data is a real win we hadn't planned for — operators love seeing what queries land on their GBP

What we change:
- 🔧 Outcome attribution model in `convex/outcomes/attribution.ts` — for GBP posts specifically, attribution becomes "during the period Maya posted N times, location calls went up X%" (correlational), not "post P drove these K calls" (causal). For non-GBP posts (FB, IG) per-post metrics still work and the causal link holds.
- 🔧 Growth tab `MetricCard` for GBP metrics: add a "location-level" caption so operators understand the reasoning isn't per-post.
- 🔧 `MayaContributionCard` "X of Y jobs from Maya-drafted posts" attribution is still computable for FB+IG posts. For GBP posts attributable through reviewers' subsequent jobs, we still have the chain via `inboundLeads.originatingActionKind="gbp-post"` set when a lead arrives within a GBP post's visibility window.

---

#### GBP messages / DMs / chat

| Capability | Status | Evidence |
|---|---|---|
| GBP messaging | 🔴 | "**No DMs** - Google Business does not have a messaging system accessible via API" verbatim |
| GBP comments on posts | 🔴 | "**No comments** - Posts on Google Business do not support comments" verbatim |

**Product impact:**
- **`inboundLeads.source: "gbp-msg"` enum value is dead** — the source can never fire. Schema additive lift: leave the enum value in place to avoid a breaking schema change, but remove from any UI surface that suggests it's a real source. Lead-response-nudger workflow is unaffected — it relies on `fb-dm`, `twilio-missed-call`, `twilio-sms`. Once the enum is confirmed dead, plan a Phase 1.5 schema migration to drop the value.
- **The "always reachable" service-product framing** doesn't change — operators still get FB Messenger DMs + missed-call texts + GBP review notifications (which are different from messages). They just don't get GBP-native messages because Google doesn't expose them.

---

#### GBP Q&A

| Capability | Status | Evidence |
|---|---|---|
| Q&A read + answer | 🔴 | "Respond to Q&A (deprecated by Google, replaced by AI-powered 'Ask Maps')" verbatim |

**Product impact:** Wave C.6's Q&A monitoring fold-in into `review-reply-drafter` is impossible. Specifically:
- Drop the Zernio webhook subscriptions for `question.created` / `question.updated` from the C.6 wiring (verify whether those subscriptions actually exist — Zernio's doc-listed events are reviews + posts + comments + messages + accounts; no question events listed in the webhooks catalog. The C.6 agent may have inferred them from the plan rather than the Zernio docs.)
- Update `agents/skills/maya-service-review-reply-drafter/SKILL.md` to remove the Q&A intent classifier section and the "Q&A intent" hard-rule branch.
- The Q&A capability was a "nice to have" that the operator never asked for explicitly — losing it changes nothing in the north-star metric chain (jobs + 5-star reviews).

---

### Facebook (Pages)

| Capability | Status | Notes |
|---|---|---|
| Text post | 🟢 | |
| Image post | 🟢 | Single + multi-image (up to 10) |
| Video | 🟢 | |
| Story | 🟢 | Image or video |
| Reel | 🟢 | |
| Scheduling | 🟢 | |
| First comment auto-post | 🟢 | Useful for hashtag-stacking on FB |
| Multi-page posting | 🟢 | |
| Comments — read / reply / hide / like / delete | 🟢 | All four operations |
| Comments — private reply (DM the commenter) | ⚠️ | Not in FB platform page checklist; `/v1/inbox/comments/{postId}/{commentId}/private-reply` exists in OpenAPI spec — verify in the live spike |
| Messenger DMs — list / fetch / send | 🟢 | Including attachments + quick replies + buttons |
| Page Insights analytics | 🟢 | Post-level + page-level |
| Webhook events | 🟢 | `message.received`, `message.sent`, `message.edited`, `message.delivered`, `message.read` |
| 24-hour messaging window (Meta policy) | ⚠️ | Not Zernio-specific — Meta enforces a 24h window for non-promotional DM replies. Lead-response-nudger needs to know this. |

**Product impact:** Facebook is fully covered for our use cases. The 24h messaging window is a Meta platform constraint to bake into lead-response-nudger's response-latency rules — if the inbound lead is >24h old, the reply must use a paid promotional message tag or fall back to SMS.

---

### Instagram (Business accounts)

| Capability | Status | Notes |
|---|---|---|
| Feed post / Carousel / Story / Reel / Video / Image | 🟢 | All supported |
| Scheduling | 🟢 | |
| Comments — list / reply / delete / hide-unhide | 🟢 | |
| Comments — like | 🔴 | Not supported by Meta's API |
| Comments — post new top-level comment | 🔴 | Not supported by Meta's API |
| DMs — list / fetch / send / attachments | 🟢 | |
| Account analytics — impressions, reach, likes, comments, shares, saves, views | 🟢 | Add-on required |
| Follower history + demographics | 🟢 | Add-on required |
| Webhook events — `message.received/sent/edited/deleted/read` | 🟢 | |
| Story replies / hashtag monitoring / mention monitoring | ⚠️ | Not documented; Meta exposes some of this via Graph API but Zernio's surface is unclear |

**Product impact:** Instagram is fully covered for posting + DMs + comments. The "no like / no top-level comment" gaps don't hurt us — Maya never auto-likes comments (wouldn't pass operator-trust gate) and never posts top-level comments on FB/IG (that's promotional spam territory).

---

### TikTok

| Capability | Status | Notes |
|---|---|---|
| Video post | 🟢 | 3-10 minute videos |
| Photo carousel | 🟢 | Up to 35 photos |
| Scheduling | 🟢 | |
| Comments — list / reply / delete / new | 🔴 | "Not supported" — TikTok platform restriction |
| DMs | 🔴 | "No DMs" |
| Analytics | 🟢 | Likes / comments / shares / views — add-on required |
| Webhook events | ⚠️ | Not mentioned in TikTok platform docs |

**Product impact:** TikTok is post-only via Zernio. Service-business operators barely use TikTok for inbound DMs anyway, so the lack-of-DM doesn't hurt the lead-response-nudger story. Maya treats TikTok as a post-and-monitor-engagement channel, not a conversation channel. Acceptable.

---

### LinkedIn

| Capability | Status | Notes |
|---|---|---|
| Posts (text / image / multi-image / video / document carousel) | 🟢 | |
| Scheduling | 🟢 | |
| Comments | 🟢 | Org/company pages only; add-on required |
| Analytics | 🟢 | Add-on required |
| External-link suppression warning | ⚠️ | "LinkedIn actively suppresses posts containing external links" — recommend `firstComment` field instead. Service businesses rarely need LinkedIn anyway. |

**Product impact:** LinkedIn is a "have if you have it" platform for service businesses (commercial-leaning operators — restoration, larger HVAC). Marginal but functional.

---

### YouTube

| Capability | Status | Notes |
|---|---|---|
| Video upload | 🟢 | |
| Shorts | 🟢 | |
| Community posts | 🔴 | Not supported |
| Scheduling | 🟢 | "uploads as private, goes public at scheduled time" |
| Comments — list / reply / delete | 🟢 | |
| Comments — like | 🔴 | "no API available" |
| Analytics | 🟢 | Add-on required; views, likes, comments, shares, demographics |
| Webhook events | ⚠️ | Not documented |

**Product impact:** YouTube Shorts is the meaningful surface for service businesses (before-after job videos). Acceptable.

---

### Webhooks (cross-platform)

| Event family | Coverage | Notes |
|---|---|---|
| Posts (`post.published`, `post.failed`, `post.partial`, `post.cancelled`, `post.scheduled`, `post.recycled`) | 🟢 | |
| Comments (`comment.received`) | 🟢 | New comment on tracked post |
| Messages (`message.received/sent/edited/deleted/delivered/read/failed`) | 🟢 | Per-platform support varies (e.g. `message.failed` is WhatsApp-only) |
| Reviews (`review.new`, `review.updated`) | 🟢 | GBP only |
| Accounts (`account.connected`, `account.disconnected`, `account.ads.initial_sync_completed`) | 🟢 | |
| Webhook test (`webhook.test`) | 🟢 | |
| **Mention events** | 🔴 | Not in catalog |
| **Token expiry events** | 🔴 | Not in catalog — must observe `account.disconnected` instead |
| **Q&A events (review-adjacent)** | 🔴 | None — confirms Q&A is gone |
| Signature verification | 🟢 | `X-Zernio-Signature` header, lowercase hex HMAC-SHA256 of raw body keyed by webhook secret |
| Delivery guarantees | 🟢 | At-least-once, 7-attempt exponential backoff to 24h, dead-letter after. `payload.id` is the dedupe key. 5s timeout per attempt. |

**Product impact:** Webhook surface is solid. The signature scheme matches our existing `convex/webhooks/crm.ts` HMAC-SHA256 pattern — no new primitives needed. Dead-letter behavior means we don't need to build a retry queue ourselves; just receive `2xx` within 5s and we're covered.

---

### Pricing — real cost to run beta

The plan referenced "Build tier $19/mo" without addon math. Real cost based on docs.zernio.com/pricing as of 2026-04-27:

| Tier | Price | Profiles | Posts/mo | Req/min |
|---|---|---|---|---|
| Free | $0 | 2 | 20 | 60 |
| **Build** | **$19/mo** ($16 annual) | 10 | 120 | 120 |
| **Accelerate** | **$49/mo** ($41 annual) | 50 | Unlimited | 600 |
| Unlimited | $999/mo | ∞ | ∞ | 1200 |

**Add-ons (each):**
- **Inbox** (Comments + DMs + Reviews) — required for review-reply, comment-reply, DM-send
  - Build: +$10/mo
  - Accelerate: +$50/unit (per profile? unclear; verify with sales)
  - Unlimited: +$1,000/mo
- **Analytics** — required for any analytics endpoint
  - Build: +$10/mo
  - Accelerate: +$50/unit
  - Unlimited: +$1,000/mo

**Beta math (5-10 operators × ~4 profiles each = 20-40 profiles):**
- Build at 10 profiles is too small from operator #3 onward
- Accelerate ($49) covers up to 50 profiles + unlimited posts
- + Inbox ($50) + Analytics ($50) = **~$149/mo total Zernio cost to run beta**

That's well within the unit economics of $99–$199/mo customer pricing × 5–10 ops. Zernio cost amortized across all operators is $15-30/op/mo. Healthy.

**One thing to clarify with Zernio sales:** "Accelerate +$50/unit" wording on add-ons — is "unit" = per profile, per add-on (i.e. flat $50 for the whole tier)? Email/chat them; the answer changes whether $149 stays or becomes $149 + 50× per profile.

---

### Service-tier pricing implications

Our plan-tier matrix in `convex/planService.ts`:

| Plan | Headline | Voice min | Locations | Platforms |
|---|---|---|---|---|
| Starter | $99 | 0 | 1 GBP | 0 social |
| Pro | $149 | 30 | 1 GBP | 2 social |
| Studio | $199 | 100 | 5 GBP | unlimited |

A Starter operator (GBP only) costs us under Zernio: 1 profile × $50/Build-Inbox-only = trivial. Margin healthy.

A Studio operator (5 GBP + unlimited social, say 20 profiles total) requires Accelerate's 50-profile cap, plus Inbox + Analytics. That's still inside the ~$149 Zernio cost spread across all operators. Margin healthy at scale.

---

## Verdict + concrete actions

### 🟢 Keep Zernio as v0 primary vendor
The core surfaces (post + read reviews + reply to reviews + read+reply comments + DMs + analytics + webhooks) all check out. The 4 gaps are either at-Google-not-at-Zernio (Q&A, GBP messaging, per-post insights) or we already over-engineered around (clip composer's GBP target). None require a vendor switch.

### 🔴 Do not run the originally-planned review-reply spike yet — fix the 4 product gaps first
Running the spike against a Q&A-folded skill or a per-post-attribution Growth tab would just re-confirm broken assumptions. Land the corrections first, *then* run the behavioral spike to characterize Zernio's silent-failure mode on Google moderation rejections.

### Concrete code changes (in priority order — none break tests)

1. **Drop GBP from clip composer targets**
   - File: `agents/skills/maya-service-clip-composer/SKILL.md` — remove GBP from platform target list
   - File: `agents/skills/maya-service-clip-composer/script.ts` (or wherever the wrapper lives) — remove 16:9 GBP variant generation
   - Tests: clip-composer skill test should assert GBP is no longer in the targets

2. **Drop Q&A from review-reply-drafter**
   - File: `agents/skills/maya-service-review-reply-drafter/SKILL.md` — remove Q&A intent classifier section + Q&A intent branch + the `question.created`/`question.updated` Zernio webhook references
   - File: wherever those Zernio webhook subscriptions are configured — remove them (likely doesn't exist; agent may have only added them to the SKILL.md)
   - Tests: review-reply-drafter skill test should not reference Q&A

3. **Fix outcome attribution for GBP posts**
   - File: `convex/outcomes/attribution.ts` — `linkLeadToAction` for `originatingActionKind="gbp-post"` already works because it's based on time-window correlation, not per-post insights. Keep as is. But add a code comment that the per-post path is correlational-only because Google deprecated the per-post API.
   - File: `convex/outcomes/gbpInsightsPoller.ts` — verify it's polling location-level metrics, not per-post. If it tries per-post, fix to location-level only.
   - File: `convex/queries/business/growth.ts` — `getAttributionBreakdown` for GBP posts should label its attribution method as "correlational" to be honest with operators.
   - File: `components/business/growth/MetricCard.tsx` (or wherever GBP metrics render) — add caption "Location-level — Google doesn't expose per-post engagement" under the GBP metric cards.

4. **Mark `inboundLeads.source: "gbp-msg"` as never-fires**
   - File: `convex/schema.ts` — comment the enum value as deprecated/never-fires (don't remove yet — additive-only schema rule)
   - File: any UI that lists lead sources — drop "GBP message" from the list
   - File: `convex/queries/business/today.ts:humanSource` — the case is harmless (will never fire) but can be removed as cleanup

5. **Add passive review-reply verification poll**
   - New file: `convex/outcomes/reviewReplyVerifier.ts` — internal action that runs 24h after a `reviews.replyStatus` flips to `posted`. Re-fetches the review via Zernio and checks `hasReply` is still true. If false, sets `replyStatus="rejected-by-google"` + emits a `review-reply-moderation` telemetry signal with `outcome: "silent-rejection"`.
   - Wire-in: trigger from `reviews.replyStatus` mutation flip; uses `internal.scheduler.runAfter(24*60*60*1000, ...)`
   - Tests: cross-tenant isolation, plan-tier × action (no gating, runs for everyone), adversarial inputs (fake `hasReply: true` from Zernio webhook should still cause us to verify), sibling-file scan.

6. **Pricing reality update**
   - File: `docs/SPRINT_PLAN_SERVICE_V0.md` — replace "$19/mo Build tier" references with the real Zernio cost projection ($149/mo Accelerate + Inbox + Analytics) once operator confirms the "+$50/unit" interpretation with Zernio sales.
   - File: `docs/operator-actions/beta-cohort-recruitment.md` — note the per-operator amortized vendor cost so operator can include in financial planning.

### Then-and-only-then: the original review-reply spike

Once the 4 corrections land, run the behavioral spike per the prior plan:
1. Confirm Zernio Build/Accelerate tier covers the Inbox add-on
2. Connect operator's old GBP via `/v1/connect/googlebusiness?profileId=...` → list locations → select location
3. List reviews via `/v1/inbox/reviews?platform=googlebusiness&accountId=...`
4. Plant a real review (operator) → measure webhook latency to `review.new`
5. Post a clean-language reply → confirm 200 + manually verify reply renders on actual GBP
6. Post a known-rejectable reply (promotional language Google's `ReviewReplyState` typically blocks) → observe Zernio response → manually check whether it landed on GBP → wait 24h → check `review.updated` webhook fires and whether the passive verifier from action #5 above catches the silent rejection
7. Post an AI-flavored reply (overtly templated tone) → same observation chain

Output: `docs/spikes/zernio-review-reply-depth.md` with verdict on Zernio's silent-failure mode AND the passive verifier's effectiveness as a mitigation.

---

## Open questions (only what genuinely needs operator action)

1. **Confirm with Zernio sales:** "Accelerate +$50/unit" add-on wording — is "unit" per-profile or flat-tier? Affects beta cost calc.
2. **Verify Inbox add-on availability** on the operator's current Build account before running the live review-reply spike — first call returns 403 "Inbox addon required" if not.
3. **Plant a real test review** when the spike runs (not before — measures webhook freshness).
4. **Decide:** keep the dead `gbp-msg` enum value or migrate-out in a Phase 1.5 schema change? (Recommendation: leave for now; revisit when the schema gets a real cleanup pass.)

---

## What this audit does NOT cover (out of scope for v0)

- **Zernio Ads API depth** — Phase 1.5 deferral per plan; don't audit until we get there.
- **ServiceTitan integration** — partner-gated, Sprint 7+, not Zernio's surface.
- **Direct GBP API as fallback** — only relevant if review-reply spike returns red. Code parked at `convex/integrations/gbp/direct/`.
- **Live behavioral testing of any surface** — this audit is docs-only. The review-reply spike + the corrections above are the next code work.
