# Beta cohort recruitment — service product

**Status:** operator-actionable. **Owner:** Joshua Castro. **Wave:** D (beta hardening pre-MVP).

## Goal

Recruit 5-10 home-service operators for a 30-day paid beta of HeyMaya's
service-business product. Outputs we want from beta:

1. **Outcome data.** Did jobs booked + 5-star reviews actually move? (North-star validation.)
2. **Onboarding friction map.** Where did the conversational flow snag?
3. **Voice ROI signal.** Did Studio voice actually save the operator time?
4. **CRM aggregator gaps.** Which Jobber/HCP/QBO edge cases blew up?
5. **Pricing willingness.** Will Mike pay $99/mo after the trial? Will Sarah pay $149?

## Cohort composition (5-10 operators)

| Slot | Vertical                | Size       | CRM             | Persona anchor         | Plan target |
| ---- | ----------------------- | ---------- | --------------- | ---------------------- | ----------- |
| 1    | HVAC                    | 1 truck    | None            | Mike Hansen (Persona A) | Starter $99 |
| 2    | HVAC                    | 3 trucks   | Housecall Pro MAX | (Sarah-adjacent)       | Pro $149    |
| 3    | Plumbing                | 5 trucks   | Jobber          | Sarah-like             | Pro $149    |
| 4    | Electrical              | 1 truck    | None — GBP only | Ed-adjacent            | Starter $99 |
| 5    | Landscaping             | 2 trucks   | Jobber          | Seasonal, FB-heavy     | Pro $149    |
| 6    | Cleaning                | 4 crews    | QuickBooks Online | Recurring-job-heavy    | Pro $149    |
| 7    | Roofing                 | 2 trucks   | Jobber          | Storm-driven           | Pro $149    |
| 8    | HVAC                    | 8 trucks   | HCP MAX         | Multi-location starter | Studio $199 |
| 9    | Plumbing                | 1 truck    | None            | No-CRM emergency       | Starter $99 |
| 10   | Cleaning                | 1-person   | None            | No-CRM solo            | Starter $99 |

Mix targets: ≥3 no-CRM operators (validate the no-CRM NER path); ≥2
HCP-MAX operators (validate the customer-side webhook path); 1+ Studio
voice user (validate per-call latency).

## Outreach template

Subject: `Quick thing for HVAC owners — your AI marketing manager (free 30 days)`

> Hi {{firstName}},
>
> I'm building HeyMaya — an AI marketing manager for home-service operators
> who don't have time to do their own marketing. She lives in your text
> thread, watches your Google Business Profile and reviews, drafts review
> replies and GBP posts, and reminds you about leads going cold. You
> approve everything; she just gets it ready.
>
> I'm looking for 5-10 operators to test her for 30 days, free, with a
> weekly 30-minute check-in so I can hear what's working and what's not.
> No commitment after — if you stay, $99-149/mo depending on what you
> need.
>
> {{firstName}}, would you have 15 minutes this week to see if it's a
> fit? I'd come in with three drafted replies for your last three reviews
> so you'd have something concrete to react to.
>
> — Josh

Three points the email hits intentionally:

1. **No platform-feature theater.** "Lives in your text thread" — channel is the value.
2. **Concrete prove-it offering.** Drafted replies for THEIR reviews, not a slide deck.
3. **Asymmetric ask.** 15 minutes for them; we already invested 30 minutes drafting their replies before they even signed up. Reciprocity wedge.

Send 80-100 outreaches; expect 30-40% reply rate; convert 5-10. Send via
LinkedIn DMs first (HVAC owners are surprisingly active there), then
GBP-listed direct emails as fallback.

## Selection rubric

Must-haves:

- [ ] Claimed Google Business Profile (no GBP = no Maya).
- [ ] At least 5 GBP reviews already in the bag.
- [ ] Active phone number for SMS / Twilio number provisioning.
- [ ] Will commit to weekly 30-minute Zoom for the 30 days.
- [ ] Reachable on iMessage, WhatsApp, OR SMS (channel preference set).
- [ ] If picking Pro/Studio: CRM is one of {Jobber, HCP MAX, HCP non-MAX, QBO, none}. ServiceTitan blocked — partner program isn't done.

Hard nice-to-haves:

- [ ] Has a brand-voice sample we can read (their last 3 review replies, written by them).
- [ ] At least one known competitor in the same metro (lets Maya populate competitor watch).
- [ ] Photos already arriving from the field (text-to-mediaAssets pipeline gets exercised).

## Operators to NOT recruit

- **No GBP.** GBP is the always-on data anchor; no GBP = Maya has nothing to read.
- **Currently using Birdeye/Podium with strong attachment.** They'll bench-mark Maya against feature parity, not outcome value. We lose on parity in v0.
- **Multi-location enterprise (>10 locations).** Wrong tier; ServiceTitan partner-gated.
- **Pure inbound spam services** (lead-gen aggregators selling leads). Not the ICP.
- **Operators on tilt.** If their reviews are 60%+ negative, fix-the-business is the higher-leverage play and Maya can't help that.

## Onboarding checklist (per operator)

Day 0 (before signup):

- [ ] Operator confirms GBP claim status.
- [ ] We pre-pull the GBP via ScrapeCreators to draft 3 reply samples.
- [ ] We share those samples on the kickoff Zoom — first impression matters.

Day 0 (signup):

- [ ] Operator runs the conversational onboarding (sub-5-min target).
- [ ] We watch over Zoom — capture every friction point in a Notion doc.
- [ ] We provision the Twilio number, share it: "save this as 'Maya — HeyMaya'."
- [ ] If Studio: we provision voice. Otherwise voice setup is post-day-7.
- [ ] We run the GBP SEO auditor manually so the first morning brief has data.

Day 1-7:

- [ ] Daily Slack check-in (we're in their Slack or just monitoring our telemetry dashboard).
- [ ] We watch the `serviceTelemetry` feed for signal anomalies.
- [ ] First weekly Zoom on day 7 — review what landed.

Day 8-30:

- [ ] Weekly 30-min Zoom.
- [ ] At day 14, soft-pitch the conversion: "want to keep going at $X/mo after day 30?"
- [ ] Day 30: convert or churn cleanly. Either is information.

## Failure modes

- **Operator ghosts after signup.** Send 1 nudge SMS via Twilio; don't chase.
- **CRM dies mid-beta.** Operator's CRM rep is OUR problem — own the escalation.
- **Maya makes a hallucinated claim in a review reply.** P0 bug. Pause that operator's auto-publish, ship a fix in <24h, manually apologize.
- **Voice latency >300ms first-token.** Surface to ElevenLabs immediately; if not fixable in 48h, downgrade that operator off Studio voice for the remainder of the beta.

## Pre-beta env var checklist (operator-blocked)

Before any beta operator's Maya can boot cleanly, these env vars must be set on the Convex deployment:

- `DEEPREAD_API_KEY` — for the OCR skill (`uday390/deepread-ocr` from ClawHub baseline). Free tier 2000 pages/month, 10 req/min, no credit card. Get from [deepread.ai](https://deepread.ai). Per-operator usage at beta scale (5-10 ops × ~30 receipts/op/mo) sits well under the free cap.
- `ZERNIO_API_KEY` — for review monitoring + reply + posting. Build tier $19/mo + Inbox addon $10/mo (or scale to Accelerate $49/mo + Inbox $50 + Analytics $50 = ~$149/mo total).
- `ELEVENLABS_API_KEY` — for Studio voice tier.
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` — for billing.
- `CONVEX_SITE_URL` — for webhook receivers.
- `VOICE_TRANSCRIPT_HMAC_SECRET` — `openssl rand -hex 32`.
- `OPENROUTER_API_KEY` — for Maya's Gemini 3 Flash brain.
- `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — for auth.

The full v0 ClawHub + Anthropic baseline skill list lives in `convex/agents/packs/maya_service/{clawhubManifest,anthropicSkillsManifest}.ts`. Every Maya gets the same 24 skills (4 Anthropic public + 2 ClawHub baseline + 18 custom maya-service-*). Variation per operator is `soul.md` + memory-wiki + connected accounts only.

## Reporting

Weekly digest, internal:

- Count of operators active.
- Telemetry signal counts (per-operator + cohort total).
- Outcome attribution: jobs booked + 5-star reviews this week, attributed counts.
- Top 3 friction points (qualitative).
- Pricing-willingness signal (any conversion conversation that happened).

Day 30 cohort report:

- Activation rate (signed up → ran the morning brief on day 1).
- Retention rate (day 30 conversion).
- North-star delta (median jobs/5-stars/wk pre vs post Maya).
- Voice ROI (calls handled, time saved per operator interview).
- Three biggest themes from the qualitative interviews.
