# Service-Maya MVP — Design Notes

**Date:** 2026-05-13
**Branch:** `heymaya/service-v0`
**Companion to:** `docs/SPRINT_PLAN_SERVICE_V0.md` (the locked 8-sprint v0 plan)
**Purpose:** Captures the latest MVP scoping + channel-architecture decisions from a working session reviewing the existing service-v0 codebase with a fresh-eyes audit. The locked sprint plan stays the source of truth; this doc layers MVP-specific decisions on top of it.

---

## 1. The product, restated cleanly

Service-Maya is a phone number the operator saves to their contacts. They text her job updates with photos or audio notes. She posts their social, replies to their Google reviews, sends review requests, and once a week texts them a one-line summary of the work with the magic line: *"X new customers said they found you on Google this week."*

That line is the entire product. Without it the operator pays for "stuff that happens." With it they pay for "this is making me money."

**One contact. One phone number. Zero dashboards. Zero approvals (most of the time). The fact that Maya is AI is invisible — she's a marketing employee.**

The marketing-side positioning ("AI" never appears in copy) treats Maya as the marketing employee the operator can afford. The runtime is OpenClaw + Convex + Gemini 3 Flash + Twilio.

---

## 2. The wedge phrase, sharpened

The locked plan calls it: *"Maya turns every completed job into local marketing."*

The MVP success criterion sharpens it: **new customers who found the operator online.** The operator doesn't care about a cool demo. They care that their phone rings more with people who say *"saw you on Google."* That is the deliverable.

Every MVP behavior maps to either (a) ranking the operator higher in local pack search results, (b) accumulating positive review signal, or (c) closing the loop on who came in from online so the operator hears it back.

GBP is the highest-leverage local channel for service trades. People search *"plumber near me"* on Google, not on Facebook. GBP review count + recency + post cadence directly affects local pack ranking. Voice and proximity affect ranking too, but those are platform mechanics we accept.

**For MVP: GBP is the entire output surface.** Facebook, Instagram, TikTok, LinkedIn etc. defer to post-MVP via Composio toolkit additions.

---

## 3. ICP — Mike (Persona A) is the MVP target

Per existing `SPRINT_PLAN_SERVICE_V0.md` § 4, three personas:

- **Mike** — 1-truck HVAC owner-op, $200-500K rev, **no CRM**, GBP-claimed, dormant Facebook, $99 Starter target
- **Sarah** — 5-15 trucks plumber, Jobber or HCP, GBP + active FB, $149 Pro
- **Ed** — 20-50 trucks multi-location electrical, ServiceTitan, multi-location GBP, $199 Studio

**MVP proves out on Mike.** Reasons:
- Hardest persona (no CRM data to lean on — pure operator-text-driven)
- If wedge works on Mike, CRM-tier integrations for Sarah/Ed are amplification, not invention
- Smallest operational surface to test (no CRM webhooks, no multi-location, no voice)

If MVP wedge fires on 3 Mike-class operators in a 4-week window, the path to Sarah's tier (CRM integration) is high-confidence. If it doesn't fire, no CRM integration saves it.

---

## 4. MVP scope — six behaviors

Cut from the locked plan's 15 standing orders. The MVP behavior set:

1. **Operator-content ingestion** — text + voice notes + photo/video barrages via Twilio SMS/MMS. Maya catalogs + transcribes audio + batches multi-asset arrivals as one job.
2. **GBP local post** — operator content (or library-pulled when feeds are quiet) → GBP post with required local hook. Auto-publishes; operator corrects after.
3. **GBP review monitoring + reply drafting** — Maya watches incoming reviews, drafts reply in operator's voice. Operator approval before publish (Google moderation lock, all tiers).
4. **Customer review request** — 24h after job (operator inferred from operator's text *"just left so-and-so"*) → SMS to customer via Twilio.
5. **GBP cadence watch** — if no post in 5+ days, Maya draws from the asset library + ships.
6. **Friday recap text** — *"This week: 5 posts, 3 reviews handled, GBP impressions up 18% vs last week, 2 new customers said they found you on Google."*

Deferred to post-MVP:
- Voice calls (Maya answering operator's phone) — Sprint S.MVP.4
- Facebook + Instagram + TikTok cross-posting — Sprint S.MVP.5+ via Composio toolkit wrappers
- CRM integration (Jobber/HCP/QBO/ServiceTitan) — Sprint S.5+
- Content arc planner, seasonal nudges, weather-triggered promos, competitor watch, revenue snapshot, manager-readiness packet, contract red-flag, brand-outreach
- Attribution loop ("how did you find us?") is included in the review-request SMS as ONE additional question to the customer; the *"2 new customers from Google"* line in the Friday recap is the proof-of-value loop

---

## 5. Channel architecture — Twilio SMS+MMS only at MVP

### The decision

**Service-Maya MVP drops Claw Messenger entirely. Twilio is the single channel.** One phone number per operator handles SMS, MMS, and (eventually, Sprint S.MVP.4) voice calls on the same number.

### Why not Claw Messenger

Claw Messenger is iMessage-relay-based. Investigated:

- **Claw Messenger does NOT do SMS reliably.** It's a BlueBubbles-style relay backed by a hosted Mac with one Apple ID. SMS via Continuity is technically possible but operationally fragile (paired iPhone must be active + cellular + on the same Apple ID; carrier rate limits; multi-tenant SPOF risk).
- **Locking out Android via Claw Messenger costs ~40-50% of the service-business market.** Trades-people skew Android-heavier than the general population. Fleet phones (5+ employees) often standardize on Android for cost. Office staff mix.
- **Claw Messenger's shared number is a multi-tenant SPOF.** Outages and rate limits affect every operator simultaneously.

Claw Messenger stays in service-v0 code paths (the prior plan had it) but is removed from service-Maya's runtime channel set. Creator-Maya keeps Claw Messenger (different ICP — iPhone-heavier creators care about iMessage richness; service operators don't).

### Why Twilio works

- One per-operator phone number ($1.15/mo carry, baked into all plan tiers per the locked pricing in § 3)
- SMS + MMS supported globally — works for iPhone + Android + flip phone + any cell phone
- iPhone users get green bubbles (auto-fallback to SMS); service operators don't materially care
- Photo / audio handled via MMS within the 5MB combined cap; larger files via upload-link fallback (one extra tap)
- **Voice calls integrate cleanly on the same number** — flip a single Twilio webhook URL update post-MVP and the number becomes callable
- Production-grade carrier infrastructure (not iMessage relay fragility)

### What we lose vs Claw Messenger / iMessage

| Trade | Impact |
|---|---|
| Blue bubble → green bubble for iPhone users | Operator cosmetic; doesn't affect business |
| iMessage reactions / read receipts | Use SMS "Delivered" indicator instead |
| Native multi-attachment bundle (text + 4 photos as one message) | We bundle on our side via 30s debounce |
| 4K video pass-through | Upload-link fallback for >5MB; one extra tap |
| iMessage encryption end-to-end | Twilio over standard SMS — acceptable for service-business operator data, not regulated |

### The bundle-and-debounce architecture

SMS sends each attachment as a separate message at the protocol layer. iPhone Messages.app fires multiple MMS over 5-20 seconds when an operator sends *"wrapped henderson on oak street + 4 photos"*. We rebuild the iMessage-style "one batch" experience on our side.

**Inbound flow:**

1. Each MMS → Twilio webhook → Convex `inboundSmsHttp` endpoint
2. Validate Twilio signature (HMAC)
3. Look up `businessId` from the `To` field (Twilio number → operator)
4. Find or create open batch for `(businessId, fromPhone)` within last 30s
5. Append item to batch
6. Schedule batch-close action for 30s from this arrival (auto-extends if new arrives before close, max 90s ceiling)
7. Acknowledge Twilio with 200 OK

**On first message of a new batch:** Maya sends content-aware ack within 3-5s. One LLM call on the operator's first message decides the ack shape based on intent:

| First message implies | Ack |
|---|---|
| Photos coming ("photos coming", "wrapped install", "got pics") | 📸 ok — drafting once they all land |
| Direct question ("what time tomorrow?") | Answers question; no ack |
| Solo photo with no text | 👍 |
| Voice note | 📸 got the voice note, transcribing |

**Subsequent messages in the batch get no per-message ack.** The carrier's "Delivered" indicator does the per-message signal work. Operator never feels ignored, never feels nagged.

**Batch close (30-90s after first inbound):**

1. Mark batch `closed`
2. Download media from Twilio CDN URLs (Twilio's URLs expire after 24h; we own the bytes by close time)
3. Store in Convex storage
4. Write each item as `mediaAssets` row with `batchId` linking them
5. Dispatch ONE event to Maya's session: *"batch of 5 items from operator"*
6. Asset cataloger processes as a unit
7. Maya drafts and ships (GBP post + queue review request) in one turn
8. Final result lands in operator's thread 2-3 min after the first inbound

**Two Maya messages per batch maximum:** content-aware ack at t=3-5s + final result at t=2-3min. No clutter.

### Large-file fallback

iPhone tries to compress videos for MMS. 1080p 30-sec clip is ~30-50MB; doesn't fit MMS. The carrier rejects; operator's iPhone shows red exclamation on the video send. Other items in the batch (text + photos) deliver normally.

Maya detects the gap (operator's text mentions a video that didn't arrive). Sends a single-use upload link with the final result message:

> *"got 4 photos + the text. video looked too big for SMS — upload here: heymaya.app/u/X9d4. one tap."*

Operator taps link → web upload form opens with native iPhone photo picker → uploads full-resolution to Convex storage → triggers a follow-on event linked to the batch → Maya processes the video and adds it to the GBP post or follow-up.

**No content is ever lost.** Worst case: one extra tap on the rare oversized video.

---

## 6. Voice — deferred to Sprint S.MVP.4 (post-MVP, 1 week)

Voice was the longest deliberation. The deferral is intentional, not architectural debt.

### What's deferred

Voice **calls** (operator calls Maya, ElevenLabs Realtime answers, sub-300ms conversation): deferred.

### What stays in MVP

Voice **notes** (operator records audio in Messages app, sends as MMS attachment, ElevenLabs Scribe transcribes, Maya treats transcript as job context): in MVP. This is Mike's primary input mode from the truck.

### Why voice calls defer cleanly

The OpenClaw `voice-call` plugin is **already wired** in service-v0 (`convex/agents/packs/maya_service/voiceCallConfig.ts`). It supports Twilio + ElevenLabs Realtime natively. Activating it post-MVP requires:

1. Update Twilio's Voice webhook URL on operator's existing number to point at their Fly machine's voice-call plugin endpoint
2. Flip plan-tier gating from Studio-only to Pro+
3. A2P 10DLC voice campaign registration (separate from SMS A2P, 2-4 weeks operator-side work; can start during MVP execution)

Zero new code beyond config flips. The same Twilio number that does SMS at MVP becomes callable at Sprint S.MVP.4. Operator's contact card doesn't change — Maya just suddenly answers when called.

### Why this is the right defer

| Voice calls add | Voice notes deliver |
|---|---|
| Real-time conversation | Async voice context (Mike dictates job updates from truck) |
| ElevenLabs Realtime production exposure | ElevenLabs Scribe transcription (~$0.006/min vs $0.10/min) |
| Per-minute billing surface in Stripe metered config | Bundled in flat plan tier |
| A2P voice approval timeline (2-4 weeks) | No additional approval needed |
| Sub-300ms latency SLO | Best-effort, ~1-2s |
| Customer-call-answering use case (operator forwards business line) | Not needed for MVP wedge |

The wedge ("new customers from Google") doesn't depend on Maya answering operator's phone. Mike's daily workflow is text + voice-notes; calls are a marginal addition that adds operational drag without proving the wedge faster.

---

## 7. GBP integration strategy — mock-then-real

Operator has applied for direct Google Business Profile API partner access. Approval timeline unknown (typically 2-8 weeks per Google's partner program). Cannot block MVP shipping on that.

### Architecture

`convex/integrations/gbp/` lives as a real wrapper with two modes:

- **`mode: "mock"`** — local fixtures returning realistic responses byte-for-byte matching the official GBP API spec. Drives all unit tests + smoke tests + Sprint S.MVP.3 end-to-end smoke against fake data. The mocks are written from Google's published API documentation (request/response shapes verified per docs at `developers.google.com/my-business`).
- **`mode: "real"`** — swap-in when partner access lands. Single env-var or feature-flag flip; no code changes elsewhere.

### Why not Zernio for MVP

Zernio is in service-v0 code (interface-isolated, swap-out-able). The locked sprint plan had it as the v0 GBP path. Operator-revised decision today: **drop Zernio from service-Maya MVP entirely.**

Reasons:
- Direct-API-with-mocks is cleaner architecturally — Maya learns Google's response shape from day 1; no Zernio-flavor refactor when real access lands
- One vendor dependency (Google) is simpler than two (Zernio + Google)
- Zernio's review-reply depth is unverified per the original sprint plan's open questions; if it turns out shallow, we already need the direct path anyway
- Mocks ARE testing infrastructure — every cron tick + smoke runs against them; real-money calls only fire when code is proven

Zernio code stays in repo for post-MVP Facebook / Instagram cross-posting (alongside Composio). It just doesn't gate MVP.

### GBP API surface to mock

Per official docs at `developers.google.com/my-business`:

| API | Used for | Partner-program-gated? |
|---|---|---|
| `accounts.list` + `locations.list` | List operator's GBP at onboarding | No (basic tier) |
| `locations.reviews.list` | Read reviews | No (basic tier) |
| `locations.reviews.updateReply` | Reply to reviews | **Yes** |
| `locations.localPosts.create` | Create GBP local posts | **Yes** |
| `locations.fetchVerificationOptions` + `verify` | Claim/verify | No (basic tier) |
| `locations.reportInsights` | GBP impressions / search queries / direction requests | Basic tier (limited) |
| Pub/Sub `NEW_REVIEW` notifications | Webhook-style review delivery | **Yes** |

Mock layer covers all 7. Real layer activates when partner access lands.

---

## 8. The other locked architecture decisions

### Auto-publish defaults — operator-corrects-after

Service-Maya MVP defaults: **GBP local posts auto-publish; operator corrects after via SMS.** Approve-each-time pattern is abandonment friction. The operator hired Maya to OWN this surface; review-after-shipping > approve-before-shipping.

Server-side safety rails catch bad output before publish:
- Citation firewall (no fabricated claims about the business)
- Local-hook check (every post must reference named neighborhood / landmark / weather / event / community — generic "in your area" is rejected by the firewall)
- Brand-voice consistency check

**Review-reply auto-publish remains FORBIDDEN at all tiers.** Google `ReviewReplyState` moderation rejects AI replies; the operator-approval lock is a Google requirement, not our choice.

`business.approvalRules` schema supports per-tier opt-out (operator can flip GBP post auto-publish off if they want approve-each-time). Default is on for Pro+ tier; Starter tier defaults are operator's call (probably also auto-publish for simplicity).

### One Twilio number per operator

$1.15/mo carry baked into all plan tiers. Provisioned during onboarding via existing `convex/integrations/twilio/provisionNumber.ts`. Operator saves to contacts as "Maya". Used for SMS at MVP, voice activates Sprint S.MVP.4 on the same number.

### Workspace shape — same as creator-Maya

Service-Maya's workspace bundle ships the same MD files as creator-Maya, tuned for service:

| File | What it carries |
|---|---|
| **SOUL.md** | "Maya, your marketing employee." Tune from current "back-office accountant" toward "owns the marketing function." Anti-fake-busy, anti-sycophancy, brevity defaults, tone matched to `business.tonePreference`. Operator's voice fingerprint. Hard rules. |
| **AGENTS.md** | Operating instructions: GBP-only output at MVP, citation firewall, local-hook hard rule, never auto-post review replies, never quote pricing. Per-platform best-practice section (GBP-only at MVP; FB/IG sections added when those launch). |
| **USER.md** | Business name, GBP location, served zips, top services, business size, tone, brand voice samples (extracted from existing GBP captions + review replies). |
| **HEARTBEAT.md** | Trimmed for MVP. 4 calendar-aware ticks per day (same Sprint C.4 architecture from creator-Maya: morning_brief + midday + afternoon + evening_recap). Maya doesn't invoke LLM every minute. |
| **BOOT.md** | Per-business first-message template. Sub-30-second first ping that cites 2 specific facts from the bulk pull. |
| **MEMORY.md seed** | Domain priors per service-type — HVAC operators care about cleanliness; plumbers about speed; electricians about certifications. |
| **TOOLS.md** | GBP tools (mocked → real), Twilio tools, asset-cataloger, transcription, claw-messenger send (not used in service-Maya — TOOLS.md still lists it as "not available on this plan" for clarity). |
| **DREAMING.md** | Domain consolidation patterns. |

### Skills inventory — six skills for MVP

1. `maya-service-asset-cataloger` — extended with `transcript` field for voice-note audio
2. `maya-service-gbp-post-optimizer` — MVP-trimmed: no FB/IG variants
3. `maya-service-review-request-drafter`
4. `maya-service-review-reply-drafter`
5. `maya-service-citation-firewall`
6. `maya-service-brand-voice-applier`

Cut from MVP (already in `agents/skills/maya-service-*/` per the audit but not bundled into workspace at MVP):
- content-arc-planner, packet-generator, contract-redflag, revenue-snapshot-renderer, voice-brevity-overlay, competitor-watcher, content-rejuvenator, job-photo-curator, clip-composer, lead-response-nudger, gbp-seo-auditor

These come back online incrementally in S.MVP.4+.

### Integrations inventory — five

1. **GBP API (mock → real)** — Sprint S.MVP.1
2. **Twilio** — number provisioning + SMS+MMS webhook (Voice webhook activates S.MVP.4)
3. **ElevenLabs Scribe** — voice-note transcription via the pinned `paulasjes/elevenlabs-transcribe` skill
4. **Gemini multimodal via OpenRouter** — asset cataloging + photo understanding + drafting
5. **R2 attachment bridge** — for inbound media routing into Convex storage

Out of MVP:
- ElevenLabs Realtime (voice calls — Sprint S.MVP.4)
- Composio Facebook / Instagram (Sprint S.MVP.5+)
- Nango Jobber / HCP (Sprint S.5)
- Apideck/Unified.to QuickBooks (Sprint S.5)
- ServiceTitan direct (Sprint S.7+)
- ScrapeCreators competitor watch (Sprint S.MVP.4+)
- Weather + local-events APIs (Sprint S.MVP.5+)

---

## 9. Sprint plan — three sprints to MVP

### Sprint S.MVP.1 — Foundation + workspace + GBP mocks (~1 week)

- `convex/integrations/gbp/` with mock/real mode toggle + 7 endpoints mocked against official spec
- Onboarding: 7Q flow (drop Q9/Q10/Q11 local-texture questions; backfill local positioning from data over 30 days), GBP OAuth, Twilio number provisioning
- `planFeaturesService` MVP matrix (3 tiers × 6 behaviors)
- Service-side workspace generators: SOUL/AGENTS/HEARTBEAT/USER/BOOT/MEMORY/DREAMING/TOOLS — extending the creator-Maya template patterns
- ElevenLabs Scribe pin (voice-note transcription)
- 4-tick-per-day heartbeat config (mirror Sprint C.4 architecture from creator-Maya)
- Pre-populated `businessPicture.localPositioning` from GBP city + served zip — enough to pass the local-hook firewall on day 1

### Sprint S.MVP.2 — Inbound pipeline + cataloger + GBP post (~1 week)

- Twilio SMS+MMS webhook handler (`convex/integrations/twilio/inboundSmsHttp.ts`) with HMAC signature validation
- `inboundSmsBatches` schema + 30s adaptive debounce + batch-close scheduled action
- Content-aware ack pattern (~500ms LLM call on first message of each batch)
- Media download from Twilio CDN → Convex storage
- `maya-service-asset-cataloger` extended with `transcript` field (calls ElevenLabs Scribe for audio)
- `maya-service-gbp-post-optimizer` (MVP-trimmed)
- `maya-service-citation-firewall` + `maya-service-brand-voice-applier`
- Large-file upload-link fallback (single-use token + web upload form + handler)
- Auto-publish defaults: GBP post auto-publishes; operator-corrects-after via SMS
- 7-day live smoke on 1 Mike-class operator (operator-built fixture or actual beta) against GBP mocks

### Sprint S.MVP.3 — Reviews + recap + end-to-end smoke (~1 week)

- `maya-service-review-request-drafter` (SMS via Twilio, 24h after job)
- Attribution question baked into review-request: *"Quick one — how'd you find [Business]?"* — customer answers; Maya records to `inboundLeads` or `reviewRequests.attributionSource`
- `maya-service-review-reply-drafter` (operator approval before publish, Google moderation lock at all tiers)
- GBP mock for review webhook (Pub/Sub `NEW_REVIEW` emulator)
- `weekly_recap` standing order (Friday 4pm op-tz) — the magic-line proof-of-value text
- GBP cadence watch — auto-rejuvenate from library if no post in 5+ days
- Full end-to-end smoke: operator texts photo → Maya posts to GBP mock → customer gets review request → review lands → Maya drafts reply → operator approves → Friday recap text fires with attribution

After Sprint S.MVP.3 wraps: **MVP live on 1-3 beta operators against mocked GBP.** If partner access lands during this window, mocks swap to real; same code path.

### Sprint S.MVP.4 (post-MVP) — Voice activation + first cross-posting (~1 week)

- Activate Twilio Voice webhook on each operator's number (config flip per operator via existing `configureWebhooks.ts`)
- Unlock voice gating on Pro tier ($149)
- A2P 10DLC voice campaign registration under shared HeyMaya brand
- ElevenLabs Realtime production enable
- PIN challenge surface for sensitive ops (already in `convex/voice/pinChallenge.ts`)
- Optional: first social platform beyond GBP via Composio (Facebook most likely — Composio toolkit wrapper, ~1 day)

### Sprint S.MVP.5+ (post-MVP, follow on locked sprint plan)

Resumes the locked `SPRINT_PLAN_SERVICE_V0.md` § 13 roadmap:

- Sprint S.5 — Jobber CRM via Nango + Today/Jobs HQ screens
- Sprint S.6 — HCP CRM + QBO + Reviews/Posts/Customers HQ screens
- Sprint S.7 — ServiceTitan partner kickoff (Studio tier) + voice expansion to customer-call-answering use case
- Sprint S.8 — Beta hardening + 5-10 operator cohort + Stripe service-tier products
- Sprint S.9 — Public launch decision

---

## 10. Locks pending operator confirmation

Three architecture locks before Sprint S.MVP.1 is formally scoped + agents queued:

1. **Twilio SMS+MMS only for service-Maya at MVP. Drop Claw Messenger from service-v0 runtime. Voice activates Sprint S.MVP.4 on the same number.** Creator-Maya keeps Claw Messenger separately.

2. **30s adaptive debounce window (auto-extend on each new inbound, 90s ceiling) with content-aware single-emoji-or-short-phrase first-ack at t=3-5s + quiet during composition + single delivered-result message when work is done.**

3. **GBP via mock-then-real (partner access pending). Drop Zernio from service-Maya MVP entirely (stays in code for post-MVP cross-platform via Composio alongside Zernio).**

Once locked, Sprint S.MVP.1 scopes formally and parallel agents queue.

---

## 11. The honest gap — what this MVP doesn't have

Worth stating plainly so the MVP isn't oversold:

- **No CRM integration.** Mike's jobs live in his head + Maya's text history + Maya's `serviceJobs` rows (populated by Maya parsing operator's messages, not by CRM webhooks). For Sarah/Ed this is a stronger experience because their CRM auto-populates. Sprint S.5 closes this.
- **No Facebook / Instagram posting.** GBP only at MVP. Post-MVP via Composio toolkit wrappers.
- **No voice calls.** Maya can't answer Mike's customer calls; she can't be called by Mike. Voice notes IN only. Sprint S.MVP.4 closes this.
- **No revenue snapshot.** Requires CRM. Sprint S.5.
- **No content arc planning.** Single posts only at MVP; no multi-day themed arcs.
- **No competitor watch.** Sprint S.MVP.5+.
- **No multi-location.** Single GBP per business at MVP. Studio multi-location is Sprint S.6+.
- **No brand outreach** (Apollo/Hunter for vendor / partnership leads). Service operators rarely need this; defers to post-launch when demand justifies.
- **No contract red-flag scan.** Niche feature; post-MVP.
- **No manager-readiness packet.** Studio tier polish; post-MVP.

If the MVP proves on 3 Mike-class operators in a 4-week window, each of these gets re-evaluated for the next sprint based on actual operator-requested features, not the original spec.

---

## 12. Maya identity tune from current code

The existing `convex/agents/packs/maya_service/generateSoul.ts` casts Maya as "Maya from the office" — back-office, calm, accountable, deferential. Sprint S.MVP.1 tunes this toward "marketing employee who owns the lane":

| Current SOUL framing | Target SOUL framing |
|---|---|
| "I run [operator]'s back-office" | "I run [operator]'s online presence" |
| "Calm, practical, accountable" | "Calm, practical, owns the work" |
| Brevity defaults | (keep) |
| Anti-fake-busy | (keep) |
| Anti-sycophancy | (keep) |
| "operator approves every draft" implicit posture | "operator corrects after" explicit posture for routine posts; "operator approves" explicit only for Google-moderation-locked review replies |

The change is subtle but compounding. The operator doesn't hire a back-office accountant; they hire a marketing employee. Maya's posture matches that shift.

---

## 13. Carry-forward to the locked sprint plan

This MVP design layer doesn't replace `SPRINT_PLAN_SERVICE_V0.md`. The locked plan's 8-sprint roadmap stays canonical. This doc captures the MVP-execution refinements based on:

- Service-v0 code audit (fresh-eyes review of what's actually shipped)
- Channel architecture decisions (Claw Messenger vs Twilio, voice-defer rationale)
- Operator-product framing ("marketing employee", "they just text Maya", "north star is new customers from online")

The MVP sprints (S.MVP.1 / S.MVP.2 / S.MVP.3) collapse the locked plan's Sprint 1 + Sprint 2 + Sprint 3 work into a tighter MVP shape. The locked plan's Sprint 4-8 carry forward unchanged as the post-MVP roadmap.

Both docs live in the repo, both stay updated.
