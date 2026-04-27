---
name: maya-service-content-rejuvenator
version: 0.1.0-sprint3
description: When the operator is light on new content, surface unposted-or-stale catalog assets ranked for repurposing. Input is the operator's content library + posting history; output is a ranked list of suggested actions.
when-to-use: `content_rejuvenation` cron Sundays 2pm Pro+; on-demand from chat ("anything from the library worth posting today?").
plan-tier: all (Pro+ scheduled cron; Starter on-demand only).
model-routing: Gemini 3 Flash, MEDIUM thinking. Multimodal — consults `mediaAssets.catalog` (already cataloged).
---

# maya-service-content-rejuvenator

## Purpose

Operators have hundreds of photos / videos sitting in their library. Most never get used. This skill ranks the unposted-or-stale ones for repurposing — with a draft caption, a target platform, and a "why this one" reasoning.

## Inputs

```ts
{
  businessId: string;
  mediaAssets: Array<{                   // full library subset
    assetId: string;
    catalog: {
      primarySubject: string;
      serviceCategory: string;
      visualQuality: number;
      suggestedUses: string[];
      captionDraft?: string;
    };
    receivedAt: number;
    usageHistory: Array<{ platform: string; postedAt: number }>;
  }>;
  recentCadence: {
    gbpLastPostAt: number | null;
    fbLastPostAt: number | null;
    igLastPostAt: number | null;
    tiktokLastPostAt: number | null;
  };
  targetPostCount: number;               // typically 3
}
```

## Outputs

```ts
{
  suggestions: Array<{
    assetId: string;
    suggestedAction: "post-to-gbp-as-scrollable" | "post-to-instagram-single" | "post-to-instagram-carousel" | "post-to-facebook-carousel" | "edit-to-tiktok-clip" | "pair-as-before-after";
    targetPlatform: "gbp" | "instagram" | "facebook" | "tiktok";
    draftCaption: string;
    reasoning: string;                   // ≤100 chars; "why this one"
    confidence: number;                  // 0..1
  }>;
  skippedAssets: Array<{ assetId: string; reason: "low-quality" | "recently-used" | "private-content" | "incomplete-catalog" }>;
}
```

## Plan-tier

All tiers. Cron-driven only on Pro+; Starter operators get it on-demand.

## Test categories

- Citations: every `assetId` in suggestions exists + is unposted on `targetPlatform` (cross-check `usageHistory`).
- Cross-tenant: Business A's mediaAssets never appear in Business B's suggestions.
- Adversarial: empty mediaAssets → empty suggestions + `reason='empty-content-library'` upstream.

## Sibling files

Standing order: `content_rejuvenation`. Reads: `mediaAssets`. Calls: `maya-service-job-photo-curator` (when before/after pairing), `maya-service-citation-firewall`. Writes via callers to `gbpPosts.suggestions[]`.
