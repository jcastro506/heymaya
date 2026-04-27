---
name: maya-service-lead-response-nudger
version: 0.1.0-sprint3
description: Compose an SMS nudge when the operator has missed a lead. ≤120 chars. Rate-limited at the orchestration layer to ≤4 unsolicited/day.
when-to-use: `lead_response_alarm` cron (every 30 min, 24/7) and `engagement_watch` cron (every 2h waking). Never sends customer replies — only operator nudges.
plan-tier: all (Pro+ engagement watch is Pro+ only).
model-routing: Gemini 3.1 Flash Lite, LOW thinking. Per § 3 routing matrix — routine, fast, cost-sensitive.
---

# maya-service-lead-response-nudger

## Purpose

Service operators lose 2-3 leads/week to missed calls + slow replies. This skill writes the nudge to the operator: short, specific, with a one-tap action.

## Inputs

```ts
{
  leadSource: "gbp-msg" | "fb-dm" | "ig-comment" | "twilio-missed-call" | "twilio-sms";
  leadName: string | null;               // contactName from inboundLeads, may be null
  leadAge: number;                       // ms since capturedAt
  lastChannel: "sms" | "imessage" | "whatsapp" | "voice" | "web";
  zipOrNeighborhood?: string;            // for context cite
  unsolicitedTodayCount: number;         // upstream-injected; skill confirms < 4 before returning
}
```

## Outputs

```ts
{
  smsBody: string;                       // ≤120 chars
  urgencyTag: "p0" | "p1" | "p2";        // p0 = >2h, missed call; p1 = >2h, missed text; p2 = soft check-in
  rateLimitOk: boolean;                  // false = caller must NOT send (cap hit)
}
```

## Drafting rules

- **Specific.** "Missed call from Henderson in 68506 — want me to draft a callback?" beats "you have a missed lead."
- **One-tap close.** Yes/no, or single-word answer.
- **No nag tone.** Operators on jobs are busy; the nudge is a reminder, not a guilt trip.
- **Rate-limit confirm.** If `unsolicitedTodayCount >= 4`, return `rateLimitOk: false` and an empty body. The orchestrating action MUST respect this.

## Plan-tier

All tiers. Cron schedule differs (`engagement_watch` is Pro+; `lead_response_alarm` is all-tier).

## Model routing

Gemini 3.1 Flash Lite, LOW thinking. Routine class — short, formulaic, no high-stakes reasoning.

## Test categories

- Rate-limit: `unsolicitedTodayCount >= 4` always returns `rateLimitOk: false`.
- Cross-tenant: lead from Business A never surfaced in Business B's nudge.
- Adversarial: prompt-injection in `leadName` ignored; `leadAge < 0` rejected.

## Sibling files

Standing orders: `lead_response_alarm`, `engagement_watch`. Calls: `twilio.sms.send` (orchestration). Writes `inboundLeads.mayaNudgedAt`.
