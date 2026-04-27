# Operator action: A2P 10DLC registration for HeyMaya voice + SMS

**Status:** prerequisite for Wave D voice (service plan § 13 Sprint 6) and any
production SMS.

**Estimated wait time:** 1–2 weeks (Twilio + The Campaign Registry review).

**Owner:** operator (Joshua). Code-side cannot move past Sprint 6 acceptance
criteria until the brand campaign is approved + a Messaging Service SID is
generated.

---

## Why this exists

US carriers (T-Mobile, AT&T, Verizon) require Application-to-Person (A2P)
10-Digit Long Code (10DLC) registration for any business sending SMS at
volume. Voice is unaffected by 10DLC, but the SMS PIN-delivery path Maya uses
during the voice PIN-challenge flow (`voiceTools.send_sms_pin` per the plugin
docs) routes through the Twilio number's SMS capability, which IS gated by
A2P 10DLC.

Without 10DLC registration:

- SMS messages get filtered/dropped at carrier level (especially T-Mobile)
- Twilio rejects the message at submit time with error code 30034
- Maya's PIN-via-SMS flow silently fails — defeats the security design
- Inbound Voice still works (only outbound SMS is gated)

Service-business operators won't accept "Maya can't reliably text me my PIN
during a sensitive op call" as a v0 limitation, so this is on the critical
path.

---

## What to do

### 1. Register the HeyMaya brand under Twilio's A2P 10DLC console

URL: <https://console.twilio.com/us1/develop/sms/regulatory-compliance/brands>

Pick **Standard Brand** (not Sole Proprietor). HeyMaya is going to need the
higher trust score that Standard brings — Sole Proprietor caps message
throughput at ~3,000/day per phone number, which is fine now but throttles
us at scale.

Required fields:

| Field | Value |
|---|---|
| Legal business name | (your registered LLC / corp) |
| Brand display name | `HeyMaya` |
| Type | `PUBLIC_PROFIT` (LLC) |
| EIN | (your business EIN) |
| Industry | `TECHNOLOGY` |
| Website | `https://heymaya.app` (or current marketing domain) |
| Vertical | `TECHNOLOGY` |
| Business email | (operations email) |
| Business phone | (your business line — does NOT have to be the Twilio number) |
| Address | (registered business address) |

Brand registration fee: ~$44 one-time. Verification typically 1–3 business
days.

### 2. Create a Messaging Service

URL: <https://console.twilio.com/us1/develop/sms/services>

- Service name: `HeyMaya Service`
- Use case: `Customer notifications and verification` (this is what 10DLC
  classifies our PIN-delivery + appointment-reminder traffic as)
- Add the Twilio numbers you've provisioned for service-business operators
  to this service so they inherit the 10DLC trust score.

Save the **Messaging Service SID** (`MGxxxx...`). That goes in Convex env as
`TWILIO_MESSAGING_SERVICE_SID`. Without this set, our `provisionNumber.ts`
helper throws `TwilioA2PNotRegisteredError` on every SMS-capable number
provisioning attempt — fail-fast by design (see
`convex/integrations/twilio/provisionNumber.ts`).

### 3. Register an A2P Campaign under the Brand

URL: <https://console.twilio.com/us1/develop/sms/regulatory-compliance/campaigns>

- Campaign type: `LOW_VOLUME_MIXED` (covers both customer-notification +
  account-verification use cases under one campaign — simpler than two
  separate campaigns)
- Brand: `HeyMaya` (the one created in step 1)
- Description (template — copy verbatim, edit only as needed):

  > HeyMaya is an AI assistant for service-business operators (plumbers,
  > HVAC, roofers, etc.). The Maya assistant sends SMS messages to the
  > business operator (a single recipient, not customers) for:
  > (a) PIN delivery during voice-call sensitive operations,
  > (b) job-status nudges when the operator misses a customer's text,
  > (c) appointment reminders requested by the operator.
  > Recipients have explicitly opted in via account creation and can
  > reply STOP at any time. Volume: ~5–25 messages/operator/day.

- Sample messages (copy verbatim — Twilio reviews these literally):

  ```
  Maya: Your one-time PIN is 4729. Enter it on the call. — HeyMaya
  ```

  ```
  Maya: New review from Sarah K (5 stars). Want me to draft a reply?
  Reply Y to draft, N to skip, STOP to opt out. — HeyMaya
  ```

  ```
  Maya: Job at 432 Oak St marked complete. Want me to send a review
  request? Reply Y/N. — HeyMaya
  ```

- Help / opt-out / opt-in keywords: use Twilio defaults (`HELP` / `STOP` /
  `START`). Add to every operator-facing SMS template our skills generate
  (already enforced by `agents/skills/maya-service-platform/SOUL.md` SMS
  brevity rules).

Campaign registration fee: ~$10 one-time + $1.50/mo per number.
Verification: 5–10 business days.

### 4. Wait for approval, then set Convex env

Once the campaign clears `APPROVED` status:

```bash
npx convex env set TWILIO_MESSAGING_SERVICE_SID MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Restart the Convex dev/deploy to pick up the new env. Voice agent's
`provisionNumber.ts` and Wave D Stripe agent's outbound-notification path
both gate on this env var.

---

## What can move in parallel

While the campaign is in review (1–2 weeks):

- Wave D voice plugin config + transcripts persistence + PIN setup UI all
  ship without 10DLC (only outbound SMS is gated; voice + inbound work
  immediately).
- Wave D Stripe products + checkout flow ship without 10DLC.
- Wave D beta hardening can stage all telemetry + smoke tests against a
  pre-10DLC Twilio number — they'll just fail fast on the SMS path until
  the SID is set.

---

## Verification before declaring done

```bash
# Convex env should have all three:
npx convex env get TWILIO_ACCOUNT_SID         # ACxxxx...
npx convex env get TWILIO_AUTH_TOKEN          # xxxx (32-char hex)
npx convex env get TWILIO_MESSAGING_SERVICE_SID  # MGxxxx... — gate on this
```

Then trigger an SMS via `provisionNumber.provisionMyNumber` smoke
(`scripts/mvp-smoke.ts` extension during Wave D). Successful delivery to a
real phone confirms 10DLC is live.

---

## Failure modes

| Symptom | Fix |
|---|---|
| `TwilioA2PNotRegisteredError` from `provisionNumber.ts` | Set `TWILIO_MESSAGING_SERVICE_SID` in Convex env (step 4 above). |
| SMS delivers to operator but with `(SPAM?)` prefix on T-Mobile | Campaign description doesn't match actual sample message content. Edit campaign in console, re-submit (5–10 day re-review). |
| Twilio error 30034 on `Messages.create` | Number isn't enrolled in the messaging service. Add it to the service in the Twilio console. |
| Twilio error 21610 (`STOP` reply) | Recipient opted out. The recipient will not receive any future SMS from this Messaging Service until they reply `START`. Do NOT try to bypass — federal law. |

---

## Out of scope for this doc

- International SMS (we are US-only in v0; the international 10DLC equivalents — UK Short Code, Canada SMS aggregator pre-registration — land post-launch).
- Toll-free verification (we use 10DLC long codes, not toll-free).
- Voice CNAM registration (voice caller-name display — nice-to-have for Sprint 8+; not blocking).
