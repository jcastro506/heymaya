---
name: maya-service-packet-generator
version: 0.1.0-sprint3
description: Render the manager-readiness packet — the artifact an operator hands to a real marketing manager when they're ready to hire one. PDF via Anthropic `pdf` skill.
when-to-use: Quarterly cron (`manager_readiness_packet`, Studio) + on-demand from chat ("generate my packet").
plan-tier: studio.
model-routing: Gemini 3 Flash, HIGH thinking. Per § 3 routing matrix — high-stakes synthesis, multi-document grounding (businessPicture + 90d metrics + brand-voice + reviews + cadence + crew).
---

# maya-service-packet-generator

## Purpose

"If you ever want to hire a marketing manager, here's everything they'd inherit." 90-day metrics + brand voice + review patterns + content cadence + named crew + competitor positioning + local hooks — packaged as a PDF.

This is also Maya's quiet sales pitch: when an operator looks at the packet and realizes how much Maya actually does, the upgrade conversation writes itself.

## Inputs

```ts
{
  businessId: string;
  businessPicture: BusinessPicture;
  metrics90d: {
    jobsCompleted: number;
    revenue: number;
    avgTicket: number;
    reviewVolume: number;
    avgStarRating: number;
    gbpPostsPublished: number;
    leadResponseTimeMedian: number;
  };
  brandVoiceSamples: Array<{ source: string; text: string }>;
  reviewHighlights: Array<{ stars: number; body: string; reply: string }>;
  contentCadence: { gbpPerWeek: number; fbPerWeek: number; igPerWeek: number };
  crewNames: string[];
  competitorContext: Array<{ name: string; gbpRating: number; cadenceWeekly: number }>;
}
```

## Outputs

```ts
{
  pdfBase64: string;                     // produced via Anthropic `pdf` skill
  storageKey: string;                    // Convex R2 storage key
  pageCount: number;
  generatedAt: number;
  citationsManifest: Array<{ section: string; sourceCount: number }>;
}
```

## Plan-tier

Studio only. Server-side gated; Convex action refuses non-Studio callers.

## Model routing

Gemini 3 Flash, HIGH thinking. Multi-doc synthesis — high-stakes, multi-stakeholder output. Sub-30s render budget enforced upstream.

## Test categories

- Output quality (sub-30s render budget; non-empty page count).
- Adversarial (missing data sections fall back to "[insufficient data — operator action required]" placeholders, not silent dropouts).
- Cross-tenant (Business A's metrics never appear in Business B's packet).
- Citations: `citationsManifest` must show every section is grounded; the firewall runs over the prose before render.
