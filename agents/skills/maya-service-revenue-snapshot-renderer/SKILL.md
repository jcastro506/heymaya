---
name: maya-service-revenue-snapshot-renderer
version: 0.1.0-sprint3
description: Compose a one-paragraph revenue snapshot from CRM data — completed jobs, paid invoices, outstanding balance, comparison to prior week.
when-to-use: Mondays 9am cron (`revenue_snapshot`, Pro+, CRM-required) + on-demand from chat.
plan-tier: pro+ (CRM-required).
model-routing: Gemini 3 Flash, HIGH thinking. Per § 3 routing matrix — high-stakes, multi-document grounding.
---

# maya-service-revenue-snapshot-renderer

## Purpose

Operators rarely look at last week's numbers. Maya pulls them, frames them ("$23k completed last week, $8k paid, $15k outstanding") + the story under them ("up 12% vs trailing 4-week average; 3 outstanding invoices > 30 days").

## Inputs

```ts
{
  crmJobs: Array<{
    id: string;
    customerLastName: string;
    serviceType: string;
    completedAt: number;
    ticketAmount: number;
  }>;
  crmInvoices: Array<{
    id: string;
    jobId: string;
    amount: number;
    paidAt: number | null;
    issuedAt: number;
  }>;
  priorWeekBaseline: {
    completedRevenue: number;
    paidRevenue: number;
    outstandingTotal: number;
    avgTicket: number;
  };
  windowStart: number;
  windowEnd: number;
}
```

## Outputs

```ts
{
  snapshotProse: string;                 // 80-150 words
  comparisons: {
    completedVsTrailing: { delta: number; direction: "up" | "down" | "flat" };
    paidVsTrailing: { delta: number; direction: "up" | "down" | "flat" };
    outstandingFlag: boolean;            // true if >30d aged invoices > 0
  };
  citationManifest: Array<{ jobId: string; invoiceId?: string }>;
}
```

## Plan-tier

Pro+ AND `crmConnections.provider != null`. Server-side gated. Skip silently if no CRM.

## Test categories

- Cross-tenant: Business A's CRM data never appears in Business B's snapshot.
- Citations: every number in `snapshotProse` resolves to an entry in `citationManifest`.
- Adversarial: empty `crmJobs` → snapshot states "no completed jobs in this window" + skips comparisons.

## Sibling files

Standing order: `revenue_snapshot`. Calls: CRM adapter (Pro+ only). Writes via callers to `revenueSnapshots`.
