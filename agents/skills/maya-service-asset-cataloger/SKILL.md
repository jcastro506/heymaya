---
name: maya-service-asset-cataloger
version: 0.1.0-sprint3
description: One-time multimodal catalog of an inbound photo / video / audio asset. Hash-deduped at orchestration layer. Output is the persistent `mediaAssets.catalog` record consulted by every future content-generating skill.
when-to-use: Event-driven on any inbound media (iMessage / WhatsApp / SMS-MMS / web-upload). Runs once per asset; never re-cataloged.
plan-tier: all.
model-routing: Gemini 3 Flash, MEDIUM thinking. Multimodal vision.
---

# maya-service-asset-cataloger

## Purpose

The operator's content library is built from media they've already sent. This skill catalogs each new asset once: primarySubject, serviceCategory, visualQuality, framingNotes, suggestedUses, pairableWithAssetId, captionDraft. Every future content-generating skill consults the catalog instead of re-analyzing the asset.

Cost discipline: hash-dedupe BEFORE catalog cost. A re-sent photo is a $0 op. Failure to catalog stores `catalog.primarySubject = "[uncataloged]"` + retry queue — never lose the file. Rate-limit so a 50-photo flood doesn't burn $1 in 10s.

## Inputs

```ts
{
  assetUrl: string;                      // R2 public URL
  mimeType: string;
  businessId: string;
  serviceJobId?: string;                 // CRM linkage if recently completed
  geminiFilesApiClient: unknown;
}
```

## Outputs

```ts
{
  catalog: {
    primarySubject: string;              // "HVAC condenser unit", "interior of clean kitchen"
    serviceCategory: string;              // matches business.serviceTypes
    visualQuality: number;               // 0..1
    framingNotes: string;                // ≤140 chars
    suggestedUses: Array<                // ranked
      "gbp-post" | "gbp-scrollable" | "instagram-single" | "instagram-carousel" | "instagram-reel" | "facebook-carousel" | "tiktok-clip" | "before-after-pair" | "internal-reference-only"
    >;
    pairableWithAssetId?: string;        // when this is half of a before/after pair
    captionDraft?: string;               // optional starter caption
    catalogedAt: number;
    catalogModel: "gemini-3-flash-medium";
    catalogCostUsd: number;
  };
  flags: Array<                          // surfaces face / plate / sensitive content
    "face-detected" | "license-plate" | "customer-identifying" | "blurry" | "private-document"
  >;
}
```

## Memory-wiki integration (§ 9.5)

- **First-catalog vault write**: after cataloging succeeds (i.e. catalog.primarySubject is non-placeholder), call `wiki_apply` to materialize a `sources/media-assets/<assetId>` page. Claim shape: `${primarySubject} (${serviceCategory}) — ${visualQuality} quality, suggested for ${suggestedUses.join(", ")}`. Provenance: `[{ sourceId: "r2:<assetId>", path: "$", weight: 1.0, note: "operator-supplied via <source channel>" }]`. Confidence = `visualQuality` mapped to [0..1].
- **Service-job linkage**: when `serviceJobId` is present, also call `wiki_apply` against `sources/jobs/<jobId>` to append the photo as evidence on the job's source page (the wiki's structured-claim `evidence[]` array supports multiple entries; the apply call is additive). Lets future revenue snapshots / packet generators cite the photo as job-context.
- **Idempotency**: `wiki_apply` is upsert-keyed by vault path; re-cataloging a hash-deduped asset returns early (the catalog runs only once) so the wiki page is also written only once.
- MEDIUM-thinking budget applies to the multimodal Gemini call; `wiki_apply` is a direct plugin call (no thinking budget consumed).

## Plan-tier

All tiers. Asset cataloging is integrity infrastructure — every operator gets it.

## Test categories

- Adversarial: corrupted bytes, oversized video → graceful failure with `[uncataloged]` placeholder + retry queue.
- Idempotency: same `assetUrl` (after content-hash) returns existing catalog without re-running.
- Catalog quality: >85% accuracy on synthetic test set (Sprint 3.5 fixture corpus).
- Cross-tenant: catalog never leaks businessId across boundaries.

## Sibling files

Standing order: `daily_content_check` (downstream consumer). Calls: `media.gemini.files.process`. Writes `mediaAssets.catalog`.
