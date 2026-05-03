---
name: maya-service-job-photo-curator
version: 0.1.0-sprint3
description: Pick best photos from a job batch with reasoning + before/after pairing. Multimodal Gemini Files API.
when-to-use: Inbound media batch from operator; called by GBP post optimizer + content rejuvenator + asset cataloger.
plan-tier: all (Starter limited to 3 photos/day curation; Pro+ unlimited).
model-routing: Gemini 3 Flash, MEDIUM thinking. Multimodal vision.
---

# maya-service-job-photo-curator

## Purpose

A 30-photo MMS dump from the operator becomes a 3-photo set worth posting. This skill ranks, filters out face/license-plate detections, identifies before/after pairs, and surfaces reasoning operators can override.

## Inputs

```ts
{
  photoUrls: string[];                   // R2 public URLs (post-bridge)
  jobContext?: {
    jobId: string;
    serviceType: string;
    customerLastName?: string;
  };
  geminiFilesApiClient: unknown;         // injected at orchestration layer
  /** Plan-tier cap on output photos. */
  maxPhotosOut: number;
}
```

## Outputs

```ts
{
  bestPhotos: Array<{
    url: string;
    reasoning: string;                   // ≤140 chars; why this one
    qualityScore: number;                // 0..1
    flags: Array<"face-detected" | "license-plate" | "blurry" | "uninteresting">;
  }>;
  rejected: Array<{ url: string; reason: string }>;
  beforeAfterPairs: Array<{ beforeUrl: string; afterUrl: string; rationale: string }>;
}
```

## Plan-tier

Starter: `maxPhotosOut <= 3` enforced upstream.
Pro+: no cap.

## Test categories

- Adversarial: face-detected photos surface in `flags`; license-plates likewise.
- Photo-bridge integrity (R3 § 2): all input URLs are R2 public URLs (no `file://`, no `data:`).
- Cross-tenant: photos from one business's R2 namespace never appear in another's output.

## Sibling files

Calls: `media.gemini.files.process`. Writes via callers to `gbpPosts.imageUrl` + `mediaAssets.usageHistory`.
