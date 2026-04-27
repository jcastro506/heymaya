---
name: maya-service-competitor-watcher
version: 0.1.0-sprint3
description: Weekly competitor digest from ScrapeCreators GBP sweeps — rating changes, new posts, promo prices, suspended listings.
when-to-use: `competitor_watch` cron Sundays 9am op-tz, Pro+. Folds into Monday morning brief.
plan-tier: pro+.
model-routing: Gemini 3.1 Flash Lite, LOW thinking. Per § 3 routing matrix — routine classification, cost-sensitive.
---

# maya-service-competitor-watcher

## Purpose

"X HVAC dropped to 4.4 stars; Y Heating just posted a $99 tune-up promo." Operators want the competitive intelligence in a single weekly digest folded into Monday's brief — not a separate ping.

## Inputs

```ts
{
  namedCompetitors: Array<{
    name: string;
    gbpPlaceId: string;
    reputationalNote?: string;
  }>;
  lastSweep: {
    sweepAt: number;
    competitorSnapshots: Array<{
      gbpPlaceId: string;
      rating: number;
      reviewCount: number;
      lastPostAt: number | null;
      visibleOffers: string[];
    }>;
  };
  currentSweep: {
    sweepAt: number;
    competitorSnapshots: Array<{
      gbpPlaceId: string;
      rating: number;
      reviewCount: number;
      lastPostAt: number | null;
      visibleOffers: string[];
      suspended?: boolean;
    }>;
  };
}
```

## Outputs

```ts
{
  digestProse: string;                   // 60-120 words; folds into Monday morning brief
  flags: Array<{
    competitorName: string;
    kind: "rating-drop" | "rating-rise" | "new-promo" | "cadence-spike" | "suspended" | "no-change";
    delta: string;
  }>;
  citationManifest: Array<{ gbpPlaceId: string; sweepRef: "last" | "current" }>;
}
```

## Plan-tier

Pro and Studio.

## Test categories

- Citations: every flag in `digestProse` resolves to a comparison between `lastSweep` and `currentSweep`.
- Adversarial: suspended competitor (`suspended: true`) drops from digest with note; never invented activity.
- Cross-tenant: Business A's namedCompetitors never sweep Business B's competitor list.

## Sibling files

Standing order: `competitor_watch`. Calls: ScrapeCreators read layer. Writes via callers to `competitorObservations`.
