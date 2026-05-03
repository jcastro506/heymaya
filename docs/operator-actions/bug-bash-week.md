# Bug bash week — pre-beta hardening

**Status:** operator-actionable. **Owner:** Joshua Castro. **Wave:** D. **Runs:** the week before beta cohort signup.

## Goal

Five days, one focus area per day, structured surface-by-surface. By the
end of the week we've manually walked every screen and every Maya
behavior, and triaged every bug into 4 buckets so we know what blocks
beta launch vs what waits.

## Triage buckets

- **P0 ship-blocker.** Beta cannot start. Examples: cross-tenant data leak;
  Maya hallucinates in a review reply; signup completes but morning brief
  never fires; voice call disconnects mid-call without warning.
- **P1 fix-before-public-launch.** OK to start beta with this open; fix
  before Sprint 8 public-launch decision. Examples: Growth tab metrics
  off by an hour around DST boundary; `mayaTaskQueue` retry storm under
  Zernio outage; HCP non-MAX preflight UI confusing.
- **P2 post-launch.** Ship MVP with this open. Examples: cosmetic
  alignment on iPhone SE; missing skeleton flicker on cold-cached page
  load; sentiment chart axis labels.
- **P3 backlog.** Track in operator memory; revisit quarterly. Examples:
  TikTok integration for service ops; multi-language voice; bulk import
  from existing reviewers.

## Daily focus areas

### Monday — Onboarding

**Surface:** signup → Clerk → conversational onboarding → GBP connect →
businessPicture synth → first Maya message.

**Test cases:**

- [ ] Fresh signup with iMessage channel. Confirm channel preference round-trips to OpenClaw.
- [ ] Fresh signup with Android (WhatsApp) channel.
- [ ] Fresh signup with SMS-only channel (manual operator preference).
- [ ] GBP connect happy path — single location, claimed >1 year ago.
- [ ] GBP connect — unclaimed location (verify the soft-block + clear messaging).
- [ ] GBP connect — multi-location at Studio tier (1, 3, 5 locations).
- [ ] GBP connect — Pro tier requesting 2nd location (clamp to 1, banner explanation).
- [ ] Mid-onboarding abandonment + resume (operator closes browser at step 5, comes back hour later).
- [ ] Onboarding with NO photos in their GBP (does Maya gracefully accept "send me one when you can"?).

**Watch:** TTFM (time-to-first-message) ≤ 5 minutes. Anything over 8
minutes is P0.

### Tuesday — CRM integration

**Surface:** Jobber + HCP MAX + HCP non-MAX + QBO connections, webhook
flow, dedupe, attribution chain.

**Test cases:**

- [ ] Connect Jobber via Nango — first sync pulls last 30d jobs.
- [ ] Trigger a `JOB_COMPLETE` webhook → reviewRequest queues for approval.
- [ ] Re-deliver same webhook event (force a redelivery in Nango sandbox) → telemetry emits `crm-webhook-idempotency-hit`, no duplicate reviewRequest.
- [ ] HCP MAX customer connection — verify webhook URL registers with HCP.
- [ ] HCP non-MAX customer signup — preflight should auto-route to no-CRM mode + clear messaging.
- [ ] QBO connection via Apideck/Unified.to (whichever Sprint 4 spike picked).
- [ ] CRM token refresh edge: simulate Nango token expiry, verify auto-refresh + non-disruption.
- [ ] CRM disconnect: operator disconnects in our UI → no further webhook processing for that connection.

**Watch:** Idempotency-hit telemetry should accumulate during deliberate
redeliveries. Webhook ack latency ≤ 1s p99.

### Wednesday — Reviews end-to-end

**Surface:** review arrival → draft reply → operator approval → posted →
moderation outcome telemetry → attribution to reviewRequest.

**Test cases:**

- [ ] New 5-star GBP review arrives via Pub/Sub (or Zernio fallback) → Maya drafts reply within 30 min.
- [ ] Operator approves draft as-is → posted to GBP via direct API → telemetry: `review-reply-moderation` outcome=`pass`.
- [ ] Operator EDITS draft before approval → telemetry: `review-reply-moderation` outcome=`edited`.
- [ ] Google rejects the reply (simulated `ReviewReplyState=REJECTED`) → telemetry: `outcome=fail`.
- [ ] 2-star review arrives — Maya drafts a softer reply, never claims fault that wasn't established.
- [ ] Profane review arrives — Maya skips drafting + flags `riskFlags=['operator-only']`.
- [ ] Review arrives that matches a recent reviewRequest by name → `attributedReviewId` gets set; Growth tab attribution count increments.
- [ ] Review arrives that DOESN'T match — surfaces in "unmatched" section.

**Watch:** Drafts cite the actual review body. Hallucinated technician
names = P0.

### Thursday — GBP posting + Growth tab

**Surface:** GBP cadence watch → post draft → operator approval →
publish → engagement metrics poll → Growth tab attribution.

**Test cases:**

- [ ] Last GBP post >5 days old → Maya drafts a new post via gbp-post-optimizer.
- [ ] Draft references a real recent job photo from `mediaAssets` (no fake content).
- [ ] Operator approves → post publishes to GBP within 1 minute.
- [ ] After 24h, GBP Insights poll runs → `engagementMetrics` populates on the post row.
- [ ] Growth tab "GBP" metrics card shows the engagement counts.
- [ ] Growth tab "Maya: X of Y" attribution badge shows correctly.
- [ ] Window selector — Starter clamps 90d/YTD to 30d with banner.
- [ ] Window selector — Pro/Studio honor all 4 windows.
- [ ] GBP SEO auditor runs on morning brief → `gbpHealthScores` row materializes.
- [ ] Score reasoning is grounded in actual review/post/competitor data (no phantom claims).
- [ ] Telemetry audit log section visible Pro/Studio, hidden Starter.

**Watch:** Maya's GBP score reasoning cites concrete observations. Generic
"keep posting!" advice = P1.

### Friday — Voice + Stripe

**Surface:** Studio voice setup, inbound call answering, transcript
finalize, Stripe metering, post-call rating.

**Test cases:**

- [ ] Studio operator goes through voice setup in Profile.
- [ ] Twilio number provisions; operator saves contact "Maya — HeyMaya".
- [ ] Inbound call from operator's allowlisted number → Maya answers within 2 seconds.
- [ ] First-token latency ≤ 300ms (verified by ElevenLabs Agents dashboard or console log).
- [ ] In-call PIN challenge for sensitive op (e.g. "schedule a refund") → blocks until PIN provided.
- [ ] Call ends → `voiceCallTranscripts` finalized → minutes counted in `voiceUsage`.
- [ ] Reach Pro tier overage (>30 min in period) → first $5 chunk reports to Stripe meter.
- [ ] Reach Studio hard cap (500 min) → outbound calls blocked + operator nudge fires.
- [ ] Post-call SMS rating "1-5" — operator replies → `voice-satisfaction` telemetry emits.
- [ ] Stripe checkout — fresh signup → 14-day Pro trial → auto-downgrade to Starter on day 15 if no card.
- [ ] Plan upgrade — Starter → Pro mid-month → prorate correctly via Stripe.
- [ ] Plan downgrade — Studio → Pro at period boundary → voice channel deprovisions cleanly.

**Watch:** Voice latency, billing accuracy. Either >2s answer or wrong $$
on invoice = P0.

## Bug template

When a bug is found, file in the operator's tracker (Linear / Notion / wherever):

```
Title: [P{0|1|2|3}] [Surface] One-line summary

Surface: onboarding | crm | reviews | gbp | growth | voice | billing | other
Reproducible: yes / sometimes / once
Repro steps:
1.
2.
3.
Expected:
Actual:
Telemetry signal (if any):
Observed at: <timestamp>
Operator (test or real): <id or 'self'>
Notes:
```

## End-of-week deliverable

- Bug count by P-bucket (P0 / P1 / P2 / P3).
- All P0s have an owner + ETA.
- Beta launch decision: GO if P0 = 0; WAIT if P0 > 0.
- Top 3 P1s slotted into the first beta-week sprint backlog.
