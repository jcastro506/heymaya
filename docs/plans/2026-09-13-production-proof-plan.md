# Maya production-proof plan — 2026-09-13

## Goal

Prove that Maya's personalization, proactivity, calendar, social analytics, iOS messaging, and partnership workflows survive real providers and repeated clean runs. A feature is launch-ready only when its real external round trip passes, its failure path is visible, and its user-facing message remains truthful.

## Current state

The `creator` branch passes typecheck, lint, 676 tests, repository guards, and the web build. The controlled partnership gauntlet passes 11/11. The corrected high-risk memory rerun passes 2/2, and the final eligible proactive scout passes 1/1 while the second scenario correctly stays quiet.

Development Convex currently has Google OAuth/model credentials, Zernio, Tavily, OpenRouter, ScrapeCreators, Telegram, Stripe, and the partnership send switch. It does not currently expose the Claw API key, line number, relay URL, or webhook secret, and it lacks the Gmail redirect URI required by the partnership mailbox OAuth path. Environment presence is not proof that a credential is valid; every provider below gets a live smoke and a functional round trip.

## Workstream 1 — isolated, reproducible live evaluations

### Changes

1. Replace the two mutable, shared scenario creators with a run-scoped fixture model. Each run receives a `runId`, clones an immutable scenario into new creator-owned rows, and tears it down or expires it after the report is saved.
2. Make every live suite checkpoint after each probe. A CLI disconnect or Convex action timeout must resume at the next unfinished probe rather than restarting the bank.
3. Store latency, model route, tool calls, provider failures, token/cost totals, reply text, deterministic checks, and judge scores per probe.
4. Split behavioral grades into factual correctness, evidence discipline, task completion, human quality, personalization, and latency. A single aggregate score must not hide a factual failure.
5. Require at least one eligible output before a content-quality gate can compare or record a baseline. Keep “correctly stayed quiet” as a separately scored outcome.
6. Add a small manually labeled golden set and track judge/operator agreement. Do not freeze a baseline until agreement is acceptable.

### Exit criteria

- Twenty consecutive clean scenario runs complete without manual cleanup or state leakage.
- The complete conversation bank runs from one command and can resume after forced interruption.
- No cross-run setting, message, partnership, memory, or calendar row is visible.
- Factual/evidence checks pass 100%; task completion is at least 95%; human “would send” average is at least 2.5/3; p95 ordinary reply latency is below 12 seconds.

## Workstream 2 — real iOS Messages, iMessage, and SMS fallback

### Setup

Use one company-owned Claw/Linq line, one disposable iPhone number, and one non-iMessage number. Configure `CLAW_API_KEY`, `CLAW_LINE_NUMBER`, `CLAW_WEBHOOK_SECRET`, and `CLAW_RELAY_URL` in the target Convex deployment and matching relay secrets on Fly. Never use a customer number for certification.

### Changes

1. Add a health assertion that distinguishes vendor REST health, relay process health, active WebSocket connection, age of the last inbound event, and the ability to send on the configured line.
2. Persist outbound delivery-status events instead of treating initial acceptance as final delivery.
3. Add an ops-only certification action that sends a uniquely tagged message to an allowlisted test number, waits for delivery status and echo reply, and saves a redacted result.
4. Measure pairing-link behavior on iOS, first inbound `START`, normal conversation, numbered menu reply, yes/no reply, tapbacks, photo, voice note, duplicate webhook, delayed webhook, and restart/reconnect.
5. Force service selection through iMessage and SMS where the vendor permits it; otherwise verify the returned service and delivery status. Confirm Maya never claims “iMessage” when the vendor reports SMS.
6. Add retry/idempotency tests around a timeout that occurs after the vendor accepts a message.

### Exit criteria

- Real outbound and inbound iMessage pass from a fresh phone.
- A non-iMessage recipient receives the same conversation over SMS fallback.
- Relay restart reconnects without duplicate user-visible messages.
- Tapback, attachment, menu, unknown number, invalid signature, and vendor outage paths produce the expected row and user-facing behavior.
- Health turns red when the WebSocket is stale even if the REST `/health` endpoint is green.

## Workstream 3 — real Google Calendar lifecycle

### Setup

Create a dedicated Google Workspace test user and two calendars: selected `Maya Test` and unselected `Private Test`. Use unique event prefixes and delete all test events after the run.

### Changes

1. Add a resumable calendar certification script/action covering OAuth, calendar listing, selection, initial sync, token refresh, and revoke/disconnect.
2. Seed public, routine, private, all-day, recurring, moved, and canceled events. Verify private titles do not enter model context or content signals.
3. Generate a weekly plan around known busy windows; approve it through the same message/button path a user uses; verify every Google event's title, time, description, private Maya marker, and link.
4. Move and delete created events in Google, run sync, and verify Maya updates reminders and says what changed exactly once.
5. Expire the access token deliberately and prove refresh works. Revoke the refresh token and prove the connection enters `attention` with a useful recovery path.
6. Add calendar provider checks to vendor health without storing token material or event titles.

### Exit criteria

- Selected calendars sync; unselected calendars and private details do not leak.
- Planning respects timezone, daylight-saving boundaries, all-day events, and existing commitments.
- No event is written before explicit approval.
- Create, move, delete, refresh, revoke, reconnect, and forget all pass on the real account.

## Workstream 4 — real Zernio social-account proof

### Setup

Use disposable TikTok and Instagram creator accounts with a small known catalogue. Record expected native-app values immediately before the run because platform analytics change over time.

### Changes

1. Add a certification runner for profile creation, connection URL, account connection, account health, webhook subscription/signature, profile and post reads, owner analytics, follower snapshots, reconnect, disconnect, and profile deletion.
2. Compare each Zernio field with the native app and store a field-level result with observation timestamps and permitted tolerances.
3. Exercise partial availability: TikTok hidden retention, Instagram reach/retention, missing post, deleted post, expired connection, rate limit, zero credits, malformed vendor response, and delayed webhook.
4. Verify tier account caps at both UI and server doors using the real callback flow.
5. Expand smoke checks from credential/credit presence to one cheap schema-contract read whose response is validated before it is marked healthy.

### Exit criteria

- TikTok and Instagram complete connection, data sync, reconnect, and deletion.
- Maya labels public views versus owner-only reach correctly and never invents unavailable metrics.
- Known native-app figures match within a documented freshness tolerance.
- Webhook replay, wrong signature, over-cap account, and vendor failure cannot cross tenant or silently disappear.

## Workstream 5 — partnership mailbox and real research proof

### Setup

Use two company-owned mailboxes: creator sender and controlled brand recipient. Configure `GMAIL_REDIRECT_URI` for the target environment and confirm the Google OAuth consent configuration includes the required Gmail scopes. Keep external brand sending disabled during certification.

### Changes

1. Run the existing 11-step partnership gauntlet unchanged as the deterministic precondition.
2. Add a real-mailbox certification flow: connect Gmail, research a controlled brand page with Tavily, save the opportunity, explain fit and concern, draft from real creator evidence, reject ambiguous approval, accept the exact code, send once, receive a reply, sync it, and schedule a follow-up.
3. Verify Gmail thread IDs, message IDs, From identity, reply association, bounce, revoked OAuth, expired token refresh, duplicate approval, and delayed reply polling.
4. Add an evidence-quality rubric for pitches: creator claims sourced, brand program official, contact confidence stated, no invented usage/audience/results, and a DM fallback with an official social link when no verified email exists.
5. Keep a global external-send kill switch, per-user monthly allowance, per-domain cooldown, and auditable consent record.

### Exit criteria

- One controlled email and reply complete through the real Gmail API with a single send.
- Duplicate or altered approval codes cannot send.
- Missing or unverifiable email produces a useful official-application or DM route rather than guessed contact data.
- No real brand can be contacted until the controlled mailbox run and Gmail compliance work are complete.

## Workstream 6 — memory quality and human conversation

### Changes

1. Expand the long-tenure suite with contradictory evidence, repeated themes, corrected goals, temporary life facts, changing account lanes, multiple similar commitments, and deliberate forgetting.
2. Test evidence precedence directly: current setting, explicit correction, recorded action outcome, recent statement, historical statement, model inference.
3. Add adversarial prompts that try to make Maya claim she watched media she only transcribed, infer demographics, invent causality, expose another creator's data, or resurrect forgotten facts.
4. Evaluate onboarding across creators with 100 followers, established creators with 100k followers, partnership-first goals, consistency goals, no niche, multiple platforms, and users who refuse questions.
5. Keep onboarding conversational: ask one clear question at a time, save the answer immediately, adapt the next question, and begin useful work before the profile is “complete.”
6. Add week-over-week relationship tests: callbacks should be sparse and useful; Maya should recognize progress, explain changed advice, and avoid repeatedly announcing that she remembers.

### Exit criteria

- No hallucinated number, causal claim, completed action, personal fact, or cross-tenant memory in the clean bank.
- Current corrections and settings win in every conflict case.
- Forgetting removes direct and derived recall without blanking unrelated identity.
- Human reviewers prefer the personalized reply over a context-free control in at least 80% of blinded comparisons.

## Workstream 7 — latency and operational readiness

### Changes

1. Instrument each turn segment: context gather, first model token/full response, each tool, critic primary/fallback, persistence, delivery, and memory extraction.
2. Move nonessential memory extraction fully off the response path and confirm user delivery does not wait for it.
3. Run the critic only for proactive/high-risk artifacts and actions that need it; keep deterministic guards on every path. Measure before changing the current 25-second timeout.
4. Add provider timeout, fallback, and circuit-breaker dashboards by purpose rather than one aggregate model-health number.
5. Define latency budgets: normal text p50 under 5 seconds/p95 under 12; one-tool answers p95 under 18; research and partnership work sends an immediate acknowledgement and completes durably in the background.
6. Alert on stale calendar sync, stale Zernio sync, relay disconnect, failed send, critic skips, dead jobs, zero judged eval output, and unexpected cost per creator.

### Exit criteria

- Latency targets hold over at least 100 test turns with no factual-quality regression.
- Every external operation is idempotent, resumable, and visible in Mission Control.
- A provider outage yields an honest user message and actionable operator alert without duplicate sends.

## Delivery order

1. Build run-scoped eval fixtures, checkpointing, latency traces, and fail-closed gates.
2. Configure and certify the real iOS messaging line because Messages is the primary product surface.
3. Certify Google Calendar and Zernio in parallel once disposable accounts exist.
4. Run the clean conversation/memory bank on data produced by those real integrations and fix factual failures.
5. Certify the controlled Gmail partnership loop and complete required Google verification work.
6. Optimize latency from measured traces, rerun the full bank, manually label the launch set, and freeze rubric-7 baselines.

## Launch decision

The product may enter a tightly controlled pilot after iOS messaging, Google Calendar, and Zernio each pass one real disposable-account round trip and the clean factual suite is perfect. Partnership sending remains closed until the real controlled-mailbox test and Gmail compliance requirements pass. Broader launch requires the repeated-run, human-quality, latency, monitoring, and failure-recovery criteria above.
