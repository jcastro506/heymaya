# R3 — OpenClaw service-business capability deep-dive (2026-04-27)

## TL;DR

OpenClaw covers ~70% of the wiring a service-business Maya needs out of the box: multi-channel gateway (SMS / iMessage via BlueBubbles / WhatsApp / web), heartbeat + cron + hooks for proactivity, soul.md / heartbeat.md / skill.md for shared persona+behavior, OAuth-based Calendar/Gmail via Composio, and a `voice-call` plugin that integrates with Twilio + ElevenLabs. The remaining 30% is what makes service-Maya different from creator-Maya: (1) **CRM webhook adapters** for ServiceTitan / Jobber / Housecall Pro do not exist as native OpenClaw integrations, so Convex must terminate the webhook, normalize, then POST `/hooks/wake` or `/hooks/agent` to the agent; (2) **inbound MMS/iMessage attachments have known reliability bugs** (SSRF guard, webhook race, HEIC) — we must pin OpenClaw >= v2026.2.26 plus bridge attachments through our own Fly worker; (3) **per-customer Twilio phone provisioning + A2P 10DLC** is operator infra we own; (4) **Google Business Profile review-reply automation now goes through Google's moderation system** that explicitly rejects scripted/AI-generated replies, so Maya must draft + send-on-approval, not auto-reply. The dominant architectural risk is **voice cost economics** at the $39.99 / $79.99 tier — at $0.10/min (ElevenLabs Standard) + $0.014/min (Twilio) + $1.15/mo number + Gemini 3 Flash inference, an operator who uses voice 30 min/day burns ~$110/mo of voice alone. Voice should be Studio-only or metered above a small inclusion bucket.

## Capability matrix

| Capability | Native OpenClaw support | What we build on top | Risk level |
|---|---|---|---|
| Voice (inbound + outbound) | `voice-call` plugin (Twilio/Telnyx/Plivo + ElevenLabs/Deepgram/OpenAI realtime). Inbound allowlist policy | ElevenLabs Agent as voice front-end with OpenClaw as custom-LLM endpoint; per-operator Twilio number provisioning; A2P registration; cost metering | **High** (cost + identity verification + 2026.2.x security bugs) |
| MMS / photo inbound | BlueBubbles/iMessage + Twilio MMS native; attachments downloaded into media cache (8MB default) | Pin >= v2026.2.26 to avoid SSRF/HEIC/race bugs; Convex media bridge for >8MB photos; multi-image grouping logic | **High** (multiple confirmed regressions in iMessage attachment path) |
| Soul / persona | `SOUL.md` + `IDENTITY.md` + `AGENTS.md` + `HEARTBEAT.md` + `USER.md` files injected at session start | Service-Maya soul template (friendlier, CRM-grounded, "from your office" voice); per-operator USER.md with crew names + service area | **Low** (well-documented pattern from creator-side Maya) |
| Heartbeat / proactive nudges | 30-min default cadence (1h on OAuth tier); `HEARTBEAT.md` checklist; `activeHours` window; queue-busy skip; `tasks:` interval gating | Convex emits `system event --mode now` on CRM webhook delivery; rate-limit middleware (max 4 outbound/day/operator); idempotency table keyed on (event_id, message_kind) | **Medium** (no native curiosity/inactivity trigger; we add it via Convex scheduler) |
| Multimodal Gemini Files API | Not OpenClaw-native; agent calls our skills | Reuse Wave 4 Fly worker pattern for photo curation, before/after pairing, framing assessment, Veo 3 video gen | **Low** (proven pattern, just new prompts + skills) |
| CRM webhook ingestion | Generic `/hooks/wake`, `/hooks/agent`, `/hooks/<name>` with HMAC token + payload transforms | Per-CRM normalizer in Convex (`integrations/crm/{servicetitan,jobber,housecallpro}.ts`); maps job-completed → wake event with structured context | **Medium** (reliability of CRM webhooks varies; ServiceTitan has replay UI shipping 2026, Housecall Pro requires MAX plan) |
| Calendar | Composio Google Calendar (OAuth2); ICS read-only fallback | Convex layer pulls upcoming jobs at heartbeat tick; quiet-hours derived from operator's busy windows | **Low** (Composio path is proven from creator-Maya) |
| Channel routing | `dmScope: per-channel-peer` + `session.identityLinks` for cross-channel continuity; replies route back to inbound channel deterministically | Operator-set channel preference per intent (routine/approval/photo/voice); `planFeatures()` server gate per channel × tier | **Low** (clean OpenClaw primitives; mostly UX work) |

## Detailed findings

### 1. Voice integration depth

**Architecture:** OpenClaw `voice-call` plugin supports Twilio (Programmable Voice + Media Streams), Telnyx (Call Control v2), Plivo (Voice API + XML), and a `mock` provider. It exposes either streaming-transcription mode (Deepgram / ElevenLabs / Mistral / OpenAI / xAI for STT) **or** full-duplex realtime voice (Gemini Live / OpenAI Realtime), but not both simultaneously. The agent is wired in via a `voice_call` tool with actions `initiate_call`, `continue_call`, `speak_to_user`, `send_dtmf`, `get_status`. Realtime calls expose an `openclaw_agent_consult` tool so the realtime layer can punt deeper reasoning back to the brain without breaking flow.

**Recommended pattern (what the Medium tutorials and ElevenLabs docs converge on):** Run **ElevenLabs Agents as the voice front-end**, point its "custom LLM" config to a small OpenAI-compatible shim that wraps OpenClaw / our Convex action that calls Gemini 3 Flash. ElevenLabs handles turn-taking, barge-in, TTS, STT — sub-second response is realistic when we keep tool-calls below 300ms. Twilio just terminates the PSTN leg into ElevenLabs. This means **OpenClaw's `voice-call` plugin is technically optional in this setup** — the call never enters OpenClaw's gateway directly. The plugin is the right choice if we want OpenClaw to *initiate* outbound notification calls (e.g., "Maya calls you when a new $5K job comes in"), but ElevenLabs Agents is the right choice for inbound conversational calls.

**Inbound vs outbound:** Inbound calls require explicit `inboundPolicy: "allowlist"` with `allowFrom` numbers. **Critical:** versions <= 2026.2.1 have a published advisory (GHSA-4rj2-gpmh-qq5x) where suffix matching + empty caller-ID bypass the allowlist. Fixed in 2026.2.2; further hardened in 2026.2.3 with host-allowlist + proxy-trust webhook verification. **We must pin OpenClaw >= 2026.2.3 minimum, prefer >= 2026.2.26** to also clear the iMessage attachment regressions. Outbound has notify mode (one-way) and conversation mode (multi-turn with barge-in).

**Caller-ID auth — important:** OpenClaw docs explicitly state caller-ID matching "does not prove PSTN/VoIP caller-number ownership." It's a low-assurance screen. For service-Maya we have to assume the operator's phone could be spoofed. Mitigations: (a) PIN challenge before sensitive actions ("verify with the 4-digit code I just texted"), (b) rely on the *channel* (BlueBubbles iMessage with Apple ID is stronger than SMS), (c) gate destructive CRM actions on a confirmation web link.

**Phone number provisioning UX:** Each operator needs a unique number (no shared inbound — Maya needs to know which operator she's talking to). Plan: at onboarding, Convex action calls Twilio API to provision a US local number ($1.15/mo), assign to operator, push number to ElevenLabs Agent config + display in app ("Your Maya: +1 555 123 4567"). Operator saves to phone contacts. A2P 10DLC registration: $4.50 one-time per brand (sole-prop, which most plumbers/HVAC are) + $15 vetting + $1.50–$10/mo per campaign — we register one shared messaging campaign, all numbers ride on it, ~$10/mo amortized infra cost.

**Per-call cost estimate (specific):**
- Twilio inbound voice: $0.0085/min
- Twilio outbound voice: $0.014/min
- Twilio US local number: $1.15/mo
- ElevenLabs Agents Standard: $0.08/min (95% silence discount applies)
- ElevenLabs Agents Premium (gpt-4o + Flash v2.5): $0.12/min
- Gemini 3 Flash inference: $0.50/M input, $3.00/M output. A 5-min voice call with ~3K input tokens of context and ~1K output tokens ≈ $0.0045 in inference. Negligible vs voice spend.
- **Total cost per inbound 5-min call:** ~$0.043 (Twilio) + ~$0.40 (ElevenLabs Standard) + ~$0.005 (Gemini) ≈ **$0.45 per call**
- **At 6 calls/day × 30 days = 180 calls/mo × $0.45 = $81/mo voice spend per operator** before number rental. This blows up the Pro tier ($39.99) margin instantly.

**Latency:** ElevenLabs claims sub-second response with their Twilio integration; this is achievable when the custom-LLM shim returns first token in <300ms. Gemini 3 Flash with low/zero thinking budget is fast enough. Anything triggering thinking budget breaks the conversational rhythm — for voice we should pin `thinkingBudget: 0`.

### 2. MMS / photo inbound routing

**Native channels:**
- **Twilio SMS/MMS** — MMS is a real channel; up to 10 media files per message; ~$0.022 to send, ~$0.0165 to receive (US local).
- **BlueBubbles iMessage** — native attachment ingestion; downloads to media cache; default 8MB cap.
- **WhatsApp** — native rich media.

**Documented bugs (these are real and they're in production OpenClaw releases — this is the highest-risk surface area):**
1. **SSRF guard blocks BlueBubbles localhost downloads** (Issues #34749, #24457, #24948, #26831). BlueBubbles serves attachments at `http://127.0.0.1:1234/...`; OpenClaw's SSRF guard treats this as a private/internal IP and silently drops. Multiple regressions across v2026.2.20–.22.
2. **Webhook race condition** (Issue #4848) — BlueBubbles fires webhook twice (text-only first, then ~350ms later with attachment). OpenClaw processes the first webhook immediately, attachment is dropped.
3. **HEIC images not delivered to agent context** (Issue #17670). iPhones default to HEIC.
4. **Image tool `attachmentRoots` / `mediaLocalRoots` mismatch** (Issue #30170, regression in 2026.2.26) — attachments pass channel validation then fail image-tool path check.

**Mitigation strategy:** Don't rely on BlueBubbles localhost path. Have the BlueBubbles host server upload attachments to a Convex-controlled S3/R2 bucket immediately on receipt, then pass *only the public URL* through the OpenClaw webhook. Add HEIC→JPEG conversion in the bridge worker. Group multi-image messages via a 1-second debounce window. Cap our user-facing limit at 5MB to stay safely under the 8MB default.

**Agent context for attachments:** OpenClaw docs are thin on the wire format; from issue threads it appears attachments arrive as media references that the agent reads via the `image` tool (path-based). For Gemini multimodal vision, we'll bypass the OpenClaw image tool path entirely and pass image URLs directly into the Gemini Files API at the model boundary — same pattern as the Wave 4 video synth worker.

**Multi-image (operator sends 5 pics from one job):** Combine 1-second debounce + Gemini Files API batch upload; pass all images in a single Gemini turn so Maya can curate ("the 3rd photo is the best — clean lighting, full unit visible, no cars in frame").

### 3. Soul.md / persona design for service-business Maya

**OpenClaw file model:** `SOUL.md` is the persona (200–500 words, who-the-agent-is). `IDENTITY.md` is the user-facing presentation (name, emoji, nickname). `AGENTS.md` is operating instructions. `HEARTBEAT.md` is the proactive checklist. `USER.md` is per-operator context. `MEMORY.md` is persistence. These are all plain markdown injected into the system prompt at session start. Soul/identity separation is deliberate — internal behavior can be precise while external presentation is warm.

**Service-Maya persona blueprint** (different from creator-Maya):
- **Voice:** "Maya from the office" — calm, practical, slightly dry humor. Not the "creative-direction strategist" energy.
- **Anti-sycophancy still on**, but the failure mode is different: creator-Maya must avoid empty validation; service-Maya must avoid *fake-busy chatter* ("I'm on it!" with no actual progress). Default is short confirmations + receipts.
- **Always grounded in CRM:** every reference to a job uses the actual job name + customer name from CRM, not generic placeholders. If Maya doesn't know the job, she asks rather than guesses.
- **Knows the crew:** USER.md lists technician names, service area, business hours, brand voice samples (what does the operator's "thanks for the great review" sound like in their own writing?).
- **Rate-of-speech matters in voice:** for voice calls, prepend SOUL with a brevity directive — "Spoken responses ≤20 words unless asked to elaborate." ElevenLabs custom-LLM endpoint should enforce this in the system prompt overlay.

**Industry pattern reference:** Birdeye's "Review Response Agent" and Podium's "AI Employee" both lean on (a) sentiment-first analysis before drafting, (b) consistent on-brand voice trained from operator samples, (c) urgency triage. Critically: Google now actively rejects "automated or AI-generated replies that do not meet content standards" via the new ReviewReplyState moderation system. So Maya's review-reply pattern must be: draft → operator approves in iMessage → Maya posts → Google moderates → status reported back. **Never auto-post review replies.**

**SOUL.md structural recommendation** (service-Maya):
```
## Identity
You are Maya, [Operator]'s back-office for [Business]. You're not a chatbot;
you're the person they'd hire if they could afford one.

## Voice
- Calm, practical, dry humor when earned.
- Short by default. Long only when asked.
- Never start with "I'm on it" or "Great question."
- Cite the job: "Henderson 14-SEER install" not "the job."

## Boundaries
- Never bill, never charge, never schedule without operator confirmation.
- Never auto-post to Google reviews. Draft, send for approval, post on yes.
- Never speak for the operator on a live customer call without flagging it.

## Defaults
- Voice replies ≤20 words.
- Text replies ≤2 sentences unless asked.
- Photos: pick the 3 best of any batch; explain why in one line.
```

### 4. Heartbeat patterns for proactive AI agents

**OpenClaw heartbeat (well-documented):**
- Default cadence 30 min (1h on OAuth tier). Configurable via `every`.
- `target` controls delivery: `last` (most recent channel), `none` (silent run), or specific channel ID.
- `lightContext` mode loads only `HEARTBEAT.md` to save tokens. `isolatedSession` for fresh-session-per-tick.
- **Queue-busy skip:** if main queue is processing, heartbeat is dropped, retried next tick. No backpressure on operator.
- **Empty-file skip:** if HEARTBEAT.md has only headers/whitespace, skipped with `reason=empty-heartbeat-file`.
- **`tasks:` interval gating** inside HEARTBEAT.md — only "due" tasks trigger work; cuts noise.
- **`activeHours`** with timezone — heartbeats deferred outside the window.
- **Response contract:** agent returns `HEARTBEAT_OK` (start or end of message) for silent ticks; anything else is treated as an alert and delivered.

**Critical gap for service-Maya:** OpenClaw heartbeat is *time-based*, not *inactivity-based*. The "Maya gets curious when you go quiet" pattern is **not** native. We build it via Convex scheduler: track last operator-initiated message; if >X hours and we have a known job-in-progress, enqueue a `system event --mode now` to wake heartbeat with a focused prompt ("Operator has been quiet 6h with Henderson job in active state — check if a status update would be useful").

**Event-driven (hooks):** OpenClaw exposes `POST /hooks/wake` (system event), `POST /hooks/agent` (isolated agent run), `POST /hooks/<name>` (custom mapped). Auth via `Authorization: Bearer` or `x-openclaw-token` header (query-string tokens explicitly rejected). Mappings transform inbound payloads via JS/TS functions returning normalized actions. **This is where CRM webhooks land** — Convex normalizes ServiceTitan / Jobber / Housecall Pro payloads into a uniform shape and POSTs to `/hooks/wake` with structured context.

**Idempotency:** OpenClaw doesn't natively dedupe webhook events. We add a Convex `webhookEvents` table keyed on (provider, event_id, kind), with a 24h TTL, fail-closed on duplicate.

**Operator-facing rate limits:** Hard requirement — Maya cannot text >4 unsolicited messages per day per operator (research shows >5/day is the unsubscribe threshold for service-business AI per Hatch / Regal benchmarks). Implement as Convex middleware on the outbound channel layer, not inside the agent prompt (prompts can be jailbroken; rate limits cannot).

### 5. Multimodal Gemini Files API integration

**Reuse Wave 4 pattern (Fly worker):** Photo curation, before/after pairing, quality assessment all flow through the same Fly worker that does video synth in creator-Maya. Worker accepts `{operator_id, job_id, photo_urls[]}`, uploads to Gemini Files API, calls Gemini 3 Flash with curation prompt, returns `{best_photos[], reasoning, before_after_pairs[]}`.

**Specific tasks and prompts:**
- **Curation:** "Here are 8 photos from a finished AC install. Pick the 3 best for posting to social. Criteria: clean composition, full equipment visible, no people's faces, no license plates, no clutter. Cite each pick with a one-line reason."
- **Before/after:** "Pair each before with its after. Output JSON `[{before_url, after_url, caption}]`. Skip photos that have no clear pair."
- **Quality:** "Rate each photo 1–5 on framing, lighting, professionalism. Reject anything <3."

**Video generation:** Veo 3 Fast at $0.15/sec, Veo 3.1 Standard $0.40/sec including audio. An 8-second before/after montage = $1.20–$3.20 per video. **At even 5 videos/operator/month this is $6–$16 unrecoverable cost** — bake into Pro/Studio tier or meter as overage. Veo 3.1 Fast via third parties (fal.ai, Replicate) drops to ~$0.10/sec; consider as default provider with Google direct as fallback.

**Cost on photo curation:** 8 photos × 560 tokens/image ≈ 4480 input tokens + 800 output tokens ≈ **$0.005/curation run**. Negligible.

**File size:** Gemini Files API now supports up to 100MB per file (was 20MB). HEIC supported via conversion in our bridge worker, but Gemini Files API itself prefers JPEG/PNG.

### 6. CRM webhook handling

**OpenClaw is webhook-receiver-capable but CRM-agnostic.** No native ServiceTitan / Jobber / Housecall Pro adapters. Pattern: Convex action terminates the webhook, verifies signature, normalizes, then POSTs `/hooks/wake` to the operator's Maya with a structured payload.

**Per-CRM specifics confirmed:**

- **ServiceTitan:** Robust webhook system at `developer-next.servicetitan.io/docs/webhooks/`. Events include `customer.created`, `job.created`, `job.updated`, `job.completed`, estimate updates, membership changes. **Failed-event replay UI shipping 2026** — useful for our reliability story. ServiceTitan is enterprise-tier (typically ~$300+/seat); fewer of our operators will be on it.
- **Jobber:** GraphQL `WebHookTopicEnum`; webhooks must be ack'd within **1 second** (tight; use Convex action with quick 200 + async processing); HMAC-SHA256 signature in `X-Jobber-Hmac-SHA256` header using OAuth client secret. No explicit `JOB_COMPLETE` topic confirmed in docs — likely subsumed by `JOB_UPDATE` with state field.
- **Housecall Pro:** Webhooks at `docs.housecallpro.com/docs/housecall-public-api/.../webhooks`. **Only "Job Scheduled" and "Job Finished" trigger events documented.** Webhooks are **MAX-plan-only** — many Housecall Pro users are on lower tiers and won't have access. Mitigation: polling fallback via API for non-MAX customers.

**Agent context on `job.completed`:** Convex normalizer constructs `{ job_id, customer_name, address, technician, service_type, scheduled_at, completed_at, total, notes, photo_urls[] }` and POSTs to `/hooks/wake` with prompt template "Job [name] just closed. Decide if a review request is appropriate, draft it for operator approval, queue 24h follow-up." The agent has all CRM context in the wake payload and doesn't have to call back into the CRM unless reviewing history.

**Follow-up scheduling pattern:** OpenClaw cron + Convex scheduler combo. Initial review-request webhook fires Maya immediately. Maya drafts message, awaits operator OK. On OK, Maya schedules `cron` for `now + 24h` to check delivery + draft followup if no response, plus `now + 72h` for second followup. Cron entries must be tagged with job_id so they auto-cancel if customer responds in the meantime.

### 7. Calendar integration patterns

**Composio Google Calendar via OAuth2** is the proven path (already used in creator-Maya). For service-Maya:

- **Read upcoming jobs** from operator's CRM (preferred) or calendar (fallback if CRM has no API). Some operators run pure Google Calendar — that's fine, ICS feed gives read-only access without OAuth.
- **Quiet windows** derived from calendar: if operator has a job 8a–11a, Maya doesn't text at 9a unless urgent.
- **Scheduling follow-up nudges:** Maya creates calendar reminders for the operator (not separate cron entries) when an item needs human attention later — "Henderson invoice followup" appears on the operator's Google Calendar.
- **Outlook fallback:** Composio supports Microsoft 365; same OAuth pattern, useful for the small subset of operators on Outlook.

**Security:** OAuth tokens stored in Convex (encrypted at rest, same pattern as creator-Maya Stripe/Gmail). Tokens never leave Convex → OpenClaw boundary; agent gets ephemeral access via Composio MCP.

### 8. Channel routing per operator

**OpenClaw primitives are sufficient:**
- Set `dmScope: "per-channel-peer"` so the same operator on iMessage vs SMS vs voice doesn't mix contexts inappropriately.
- Enable `session.identityLinks` to link those identities for *cross-channel continuity* of the underlying session — the operator can start an iMessage thread, switch to voice, and Maya knows the context.
- Replies route back to inbound channel deterministically. We override only when we *push* (heartbeat / hook-driven) — at that point we pick channel based on operator preference + intent.

**Per-intent routing logic (lives in Convex, not OpenClaw):**
```
intent: routine_update     → SMS (cheap, async)
intent: quick_approval     → iMessage if iPhone else WhatsApp/SMS
intent: photo_heavy        → iMessage / WhatsApp (rich media native)
intent: voice_required     → outbound voice call via voice-call plugin
intent: review_draft       → channel of last interaction
```

Plan-tier gating: Starter = SMS + web only; Pro = + iMessage + WhatsApp; Studio = + voice (inbound + outbound).

**Session expiry:** Default fresh session at 4am local. For service-Maya we bump idle to `idleMinutes: 720` (12h) so an operator's morning text and afternoon text on the same job stay in the same context window. This costs more tokens but is correct for a "back-office" persona.

## Architectural recommendations

### 1. Voice integration depth
**Architecture: ElevenLabs Agents as voice front-end + custom-LLM to Convex shim that wraps Gemini 3 Flash. OpenClaw `voice-call` plugin only for outbound notification calls.** Pin OpenClaw >= 2026.2.3 (for the allowlist CVE fix), prefer >= 2026.2.26. Make voice **Studio-tier only** with a 100-min/mo inclusion bucket; meter overage at $0.15/min (covers our $0.10 ElevenLabs + $0.014 Twilio + margin). Per-operator Twilio number provisioned on signup, $1.15/mo carry cost.

### 2. MMS / photo inbound
**Wrap OpenClaw with our own bridge.** BlueBubbles host server uploads attachments to Convex-controlled R2 immediately, OpenClaw receives only public URLs (sidesteps SSRF guard, race condition, HEIC issues, mediaLocalRoots bug all in one move). HEIC→JPEG conversion in the bridge. 1-second debounce for multi-image messages. Cap at 5MB per image for safety margin. Gemini Files API path same as Wave 4.

### 3. Soul / persona
**Use OpenClaw native (SOUL/IDENTITY/AGENTS/HEARTBEAT/USER).** Build a service-Maya soul template under `convex/agents/packs/maya_service/`. Per-operator USER.md generated from onboarding (crew names, service area, business hours, sample reply voice). Voice-mode SOUL adds brevity directive overlay.

### 4. Heartbeat / proactive
**Use OpenClaw native + Convex scheduler for the inactivity trigger.** OpenClaw heartbeat handles all time-based and condition-due cases. Convex scheduler tracks `last_operator_message_at` + `active_jobs` and emits `system event --mode now` when curiosity should fire. Hard-cap unsolicited outbound at 4/day/operator in Convex middleware (not in prompt).

### 5. Multimodal Gemini Files API
**Build separate Fly worker (reuse Wave 4 pattern).** Photo curation, before/after pairing, quality assessment, Veo video gen all flow through one worker with multiple endpoints. Default video provider: fal.ai or Replicate Veo 3.1 Fast (~$0.10/sec) with Google direct fallback.

### 6. CRM webhooks
**Wrap OpenClaw with Convex.** Convex terminates webhook, verifies provider signature (each provider different — ServiceTitan API key, Jobber HMAC-SHA256, Housecall Pro signature), normalizes to a uniform job-event schema, POSTs `/hooks/wake` with structured payload + idempotency key. Per-CRM adapter under `convex/integrations/crm/{servicetitan,jobber,housecallpro}.ts`. Polling fallback for Housecall Pro non-MAX customers.

### 7. Calendar
**Use Composio (port from creator-Maya).** Read CRM jobs first, calendar second. ICS fallback for operators not on Google. Composio MCP path means no token management in OpenClaw.

### 8. Channel routing
**Use OpenClaw native (per-channel-peer + identityLinks).** Per-intent channel selection lives in Convex outbound layer. Plan-tier gating in `planFeatures(operator)` server-side.

## Cost envelope estimates

For a typical service-business operator at scale (steady-state, 30 days):

| Cost line | Quantity | Unit cost | Monthly |
|---|---|---|---|
| Gemini 3 Flash text inference (chat + drafts + heartbeats) | ~3M input + 800K output tokens | $0.50/M in, $3.00/M out | **$3.90** |
| Gemini 3 Flash vision (photo curation, ~50 batches × 8 photos) | ~225K image tokens | $0.50/M | **$0.12** |
| Veo 3.1 Fast video gen (5 short montages) | 5 × 8 sec | $0.10/sec | **$4.00** |
| Twilio US local number | 1 | $1.15/mo | **$1.15** |
| Twilio inbound voice (200 min Studio operator) | 200 min | $0.0085 | **$1.70** |
| Twilio outbound voice (50 min) | 50 min | $0.014 | **$0.70** |
| ElevenLabs Agents Standard (250 min total) | 250 min | $0.08/min | **$20.00** |
| Twilio SMS in/out (~600 messages) | 600 | ~$0.0079 avg | **$4.74** |
| Twilio MMS in (~80 photo messages from operator) | 80 | $0.0165 | **$1.32** |
| A2P 10DLC campaign amortized (1 campaign across all operators) | per-op share | ~$0.05–$0.20 | **$0.10** |
| Composio v3 (Gmail + Calendar + Stripe-as-data) | flat | varies; budget | **$3.00** |
| Fly.io shared multi-tenant agent compute (per-op share) | shared infra | varies | **$2.00** |
| ScrapeCreators (read layer, lighter than creator-side) | metered | budget | **$1.50** |
| Google Business Profile API | free tier | $0 | **$0.00** |
| CRM API (most CRMs free for tenant's own data) | free | $0 | **$0.00** |
| **Total infra cost / Studio operator / mo** | | | **~$44** |
| **Total infra cost / Pro operator (no voice) / mo** | | | **~$15** |
| **Total infra cost / Starter operator (SMS only) / mo** | | | **~$9** |

**Margin reality:**
- Studio at $79.99 — $44 infra = **$36 gross / op / mo** (45% margin). Tight but workable.
- Pro at $39.99 — $15 infra = **$25 gross / op / mo** (62% margin).
- Starter at $19.99 — $9 infra = **$11 gross / op / mo** (55% margin).

**Voice is the load-bearing variable.** A heavy-voice operator (500 min/mo) on Studio adds +$22 in ElevenLabs spend, dropping Studio margin to ~$14 (18%). The 100-min inclusion + $0.15/min overage proposed in §1 keeps margin honest.

## Open questions for operator

1. **Per-customer Twilio number provisioning** — confirm we want unique numbers per operator (vs shared inbound + DTMF identification). Strong recommendation: unique numbers, $1.15/mo carry, baked into all tiers. UX is "Your Maya: +1 555 …" displayed in app + auto-suggested as iPhone contact.
2. **A2P 10DLC sole-prop registration** — operator must confirm we register a single shared messaging campaign (~$10/mo amortized) under HeyMaya the brand vs per-operator (impractical).
3. **ElevenLabs tier** — Standard ($0.08/min) vs Premium ($0.12/min). Standard is the right default for service-Maya; Premium for "VIP voice" Studio add-on if there's demand.
4. **Voice availability per tier** — confirm voice = Studio only with a 100-min inclusion bucket and $0.15/min overage. Alternative: voice on Pro at +$10/mo.
5. **Default video provider for Veo** — Google direct ($0.15/sec Fast) for reliability vs fal.ai/Replicate ($0.10/sec) for cost. Recommend fal.ai with Google fallback.
6. **CRM coverage matrix** — ServiceTitan + Jobber + Housecall Pro is the v1 set. Confirm that Workiz, Kickserv, FieldEdge are deferred to v2 (they're 2nd-tier in market share).
7. **Google Business Profile review reply** — confirm Maya **drafts then operator approves** never auto-posts, given Google's new ReviewReplyState moderation explicitly rejects AI-generated replies.
8. **Voice persona** — use the same Maya voice across creator-Maya and service-Maya, or a different ElevenLabs voice ID for service so the brand reads "your office" not "your strategist"? Recommend distinct voice for service-Maya, slightly warmer.
9. **Per-operator phone hardware** — service-Maya assumes operator has an iPhone (iMessage native). Android operators get WhatsApp + SMS; voice still works. Acceptable v1 limitation?
10. **OpenClaw version pin** — pin >= 2026.2.26 is mandatory (covers all known iMessage attachment + voice-call CVEs documented above). Confirm we own the upgrade cadence.

## Sources

### OpenClaw documentation
- [Voice call plugin — OpenClaw](https://docs.openclaw.ai/plugins/voice-call)
- [Heartbeat — OpenClaw](https://docs.openclaw.ai/gateway/heartbeat)
- [BlueBubbles — OpenClaw](https://docs.openclaw.ai/channels/bluebubbles)
- [Webhooks — OpenClaw](https://docs.openclaw.ai/automation/webhook)
- [Session management — OpenClaw](https://docs.openclaw.ai/concepts/session)
- [OpenClaw root docs](https://docs.openclaw.ai)

### OpenClaw security advisories & issues
- [GHSA-4rj2-gpmh-qq5x — Inbound allowlist policy bypass in voice-call extension](https://github.com/openclaw/openclaw/security/advisories/GHSA-4rj2-gpmh-qq5x)
- [Issue #34749 — BlueBubbles image attachments blocked by SSRF guard](https://github.com/openclaw/openclaw/issues/34749)
- [Issue #4848 — BlueBubbles webhook race condition for text + image messages](https://github.com/openclaw/openclaw/issues/4848)
- [Issue #17670 — iMessage HEIC attachments not delivered to agent context](https://github.com/openclaw/openclaw/issues/17670)
- [Issue #30170 — Image tool can't read iMessage attachments (mediaLocalRoots regression)](https://github.com/openclaw/openclaw/issues/30170)
- [Issue #24457 — BlueBubbles inbound attachment download blocked by SSRF guard](https://github.com/openclaw/openclaw/issues/24457)

### Soul / persona pattern
- [SOUL.md System: Technical Deep Dive](https://openclawsoul.org/soul-md-system.html)
- [aaronjmars/soul.md GitHub](https://github.com/aaronjmars/soul.md)
- [OpenClaw SOUL.md — Agent Persona Guide (Stanza)](https://www.stanza.dev/concepts/openclaw-soul-persona)
- [AI Agents 003 — OpenClaw Workspace Files Explained (Capodieci, Medium)](https://capodieci.medium.com/ai-agents-003-openclaw-workspace-files-explained-soul-md-agents-md-heartbeat-md-and-more-5bdfbee4827a)

### Heartbeat & cron patterns
- [Heartbeat vs Cron in OpenClaw: Ultimate 2026 Guide](https://www.clawnify.com/resources/heartbeat-vs-cron-openclaw-guide-2026)
- [The 3 Superpowers of OpenClaw for a Truly Autonomous Agent](https://blog.kryll.io/openclaw-hooks-cron-heartbeat-ai-agent-automation/)
- [OpenClaw Heartbeat Guide — Proactive System (2026)](https://claw.mobile/blog/openclaw-heartbeat-guide)

### Voice + ElevenLabs integration
- [OpenClaw and Voice AI (Garcia, Medium)](https://medium.com/@ggarciabernardo/openclaw-and-voice-ai-ee3ce4fffcea)
- [Call Your OpenClaw Over the Phone Using ElevenLabs Agents (Tarang, Medium)](https://medium.com/@tarangtattva2/call-your-openclaw-over-the-phone-using-elevenlabs-agents-598b32273a8b)
- [ElevenLabs Agents Platform overview](https://elevenlabs.io/docs/agents-platform/overview)
- [ElevenLabs custom LLM integration](https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm)
- [Twilio + ElevenLabs ConversationRelay integration](https://www.twilio.com/en-us/blog/integrate-elevenlabs-voices-with-twilios-conversationrelay)
- [Twilio Voice + ElevenLabs Agents tutorial](https://www.twilio.com/en-us/blog/developers/tutorials/integrations/build-twilio-voice-elevenlabs-agents-integration)
- [Core Latency in AI Voice Agents (Twilio)](https://www.twilio.com/en-us/blog/developers/best-practices/guide-core-latency-ai-voice-agents)

### Pricing references
- [Twilio US Voice Pricing](https://www.twilio.com/en-us/voice/pricing/us)
- [Twilio US SMS Pricing](https://www.twilio.com/en-us/sms/pricing/us)
- [Twilio Pricing Guide 2026 (Get AI Perks)](https://www.getaiperks.com/en/articles/twilio-pricing)
- [Twilio Call Rates & Phone Number Pricing 2026 (VBWebSol)](https://www.vbwebsol.com/twilio-call-rates-phone-number-pricing/)
- [A2P 10DLC pricing (Twilio Help)](https://help.twilio.com/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service-)
- [ElevenLabs Pricing](https://elevenlabs.io/pricing)
- [ElevenLabs Agents pricing breakdown (PxlPeak)](https://pxlpeak.com/blog/ai-tools/elevenlabs-pricing-guide)
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini 3 Flash Preview Pricing (PricePerToken)](https://pricepertoken.com/pricing-page/model/google-gemini-3-flash-preview)
- [Veo 3 API Pricing 2026 (veo3ai.io)](https://www.veo3ai.io/blog/veo-3-api-pricing-2026)
- [Veo 3.1 Pricing Guide (veo3gen.app)](https://www.veo3gen.app/blog/veo-3-1-pricing-plans)

### CRM webhook references
- [Housecall Pro Webhooks API docs](https://docs.housecallpro.com/docs/housecall-public-api/46e9e1be07621-webhooks)
- [ServiceTitan Webhooks docs](https://developer-next.servicetitan.io/docs/webhooks/)
- [ServiceTitan FAQs: V2 Webhooks](https://developer-next.servicetitan.io/docs/faqs-v2-webhooks/)
- [Jobber Setting up Webhooks](https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks/)

### Reviews & service-business AI patterns
- [Google Business Profile review reply API](https://developers.google.com/my-business/content/review-data)
- [Google Business Profile Review Reply Moderation 2026](https://news.opositive.io/google/google-is-now-moderating-business-review-replies/)
- [Google Business Profile Update: Review Reply Moderation (gmbapi.com)](https://gmbapi.com/news/gbp-review-moderation/)
- [Birdeye Agentic marketing 2026](https://birdeye.com/blog/agentic-marketing/)
- [Birdeye AI online reputation management software 2026](https://birdeye.com/blog/ai-online-reputation-management-software/)
- [Podium vs Birdeye 2026 (SocialPilot)](https://www.socialpilot.co/reviews/comparison/birdeye-vs-podium)
- [AI SMS Agents — Regal](https://www.regal.ai/sms-ai-agents)
- [Hatch AI Voice, SMS, Email](https://www.usehatchapp.com)

### Multimodal / Files API
- [Gemini Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Gemini Video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
- [Gemini API release notes](https://ai.google.dev/gemini-api/docs/changelog)

### Channel routing
- [OpenClaw Channel Routing — Playbook](https://www.openclawplaybook.ai/blog/openclaw-channel-routing-multi-app-agent/)
- [Understanding OpenClaw multi-channel gateway (Wang, Medium)](https://medium.com/@ozbillwang/understanding-openclaw-a-comprehensive-guide-to-the-multi-channel-ai-gateway-ad8857cd1121)

### Composio Calendar
- [Composio Google Calendar + OpenClaw](https://composio.dev/toolkits/googlecalendar/framework/openclaw)
- [OpenClaw + Google Calendar guide (LumaDock)](https://lumadock.com/tutorials/openclaw-google-calendar-integration)
