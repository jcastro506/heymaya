---
name: maya-service-review-request-drafter
version: 0.1.0-sprint3
description: Draft a job-specific review request in the operator's brand voice. Powers the `job_completion_review_request` and `review_followup` standing orders. SMS + email variants per channel; followup variants for day-3 + day-7.
when-to-use: Fired by CRM `job.completed` webhook (Pro+ auto / Starter manual queue) and by the daily `review_followup` cron when `reviewRequests.sentAt` is 3d or 7d old without a matching review. Also from chat when operator manually requests a draft.
plan-tier: all (Starter routes through manual approval; Pro+ may auto-send 24h after `completedAt` IF `business.approvalRules.review-request-auto-send` is enabled).
model-routing: Gemini 3 Flash, LOW thinking. Per § 3 routing matrix — routine drafting, fast latency, multi-doc grounding (job + customer + brandVoice).
---

# maya-service-review-request-drafter

## Purpose

Most service businesses fail at one thing: actually asking for the review. The job ends, the technician leaves, the customer's life moves on. By Tuesday they've forgotten how good the service was. By Friday they're 50% as likely to leave a 5-star review.

This skill drafts the ask — short, personal, in the operator's voice, citing the actual job they completed. SMS or email. Initial request OR day-3 followup OR day-7 followup. The drafts pass `maya-service-citation-firewall` before send.

## Inputs

```ts
{
  jobId: string;                         // serviceJobs row id
  customerFirstName: string;
  serviceType: string;                   // e.g. "AC tune-up", "water heater swap"
  technicianName: string | null;
  jobNotes: string;                      // free-form text from CRM
  brandVoice: string;                    // from businessPicture.brandVoice
  channel: "sms" | "email";
  variant: "initial" | "day3-followup" | "day7-followup";
  reviewLink: string;                    // GBP review URL (operator-specific)
  operatorFirstName: string;             // signature
}
```

## Outputs

```ts
{
  smsBody?: string;                      // ≤320 chars (2-segment SMS), present when channel === "sms"
  emailSubject?: string;                 // ≤80 chars
  emailBody?: string;                    // 80-200 words
  citationContext: {
    jobReference: string;                // "Henderson 14-SEER install on Oak Street"
    grounded: true;
  };
}
```

## Drafting rules

- **Cite the job specifically.** Customer last name + service type + neighborhood/street if available. NEVER "your recent service."
- **Name the technician** if `technicianName` is set. NEVER "our technician" if a name exists.
- **Match the brand voice.** `brandVoice` is the operator's stylometry; mirror it.
- **Initial vs followup tone.** Initial = warm + grateful. Day-3 = soft check-in. Day-7 = last try, no nag.
- **One review-link CTA.** No "click here" + "or this link" — single clear ask.
- **No stars suggestion.** "Leave a review" not "leave a 5-star review" — Google's review-bait policy.

## Plan-tier

All tiers. Starter routes through manual operator approval (Maya queues, operator sends). Pro+ auto-sends 24h after `completedAt` IF the business has `approvalRules.review-request-auto-send` enabled with the appropriate `delayHours` scope; otherwise queues for approval.

## Model routing

Gemini 3 Flash, LOW thinking. The draft is short + grounded + voiced — reasoning quality matters less than fast latency + voice mirroring. Per § 3 (Pricing) cost envelope, this routine class runs Flash at LOW (~$0.005/call).

## Test categories

1. **Cross-tenant isolation** — Business A's brandVoice never leaks into Business B's draft.
2. **Plan-tier** — Starter never auto-sends regardless of approvalRules; assertion fails closed.
3. **Adversarial inputs** — empty `jobNotes`, missing `technicianName`, malformed `reviewLink`, prompt-injection in `brandVoice`.
4. **Citation grounding** — `citationContext.jobReference` must match the input job; firewall rejects drafts that name a different job.

## Sibling files

- Standing orders: `job_completion_review_request` (event), `review_followup` (cron 11am daily) — defined in `convex/agents/packs/maya-service/standingOrders.ts`.
- Calls: `maya-service-citation-firewall` (mandatory pre-send), `maya-service-brand-voice-applier` (post-draft voice pass).
- Convex tables: writes `reviewRequests`, reads `serviceJobs` + `serviceCustomers` + `businessPicture`.
