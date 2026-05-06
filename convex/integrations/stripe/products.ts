/**
 * Creator-tier product config — single source of truth for the Stripe
 * seeder script (`scripts/stripe/createCreatorProducts.ts`) AND for any
 * test or runtime that needs to validate the spec.
 *
 * Sprint 9. The seeder script previously inlined this data; pulling it
 * here lets us:
 *   - Unit-test the spec (price points, lookup keys) without spinning up
 *     a real Stripe SDK call.
 *   - Validate at deploy time that env vars + price ids match the locked
 *     spec (a future drift detector can read this and assert).
 *
 * Pricing (locked per `docs/SPRINT_PLAN_V0.md` § 3 + 2026-05-04 coach/
 * manager rewrite):
 *   - Coach   — $19.99/mo, $199/yr
 *   - Manager — $49.99/mo, $499/yr
 *
 * Trial: 7 days free on BOTH tiers for new sign-ups (first subscription
 * only). Trials are applied at SUBSCRIPTION creation time (not on the
 * price), so the seeder does NOT encode the trial — see
 * `convex/billing/checkout.ts` for the gating logic.
 */

export type CreatorTierKey = "coach" | "manager";
export type StripeInterval = "month" | "year";

export interface CreatorProductTierConfig {
  key: CreatorTierKey;
  productName: string;
  /** Stripe `statement_descriptor` — must be ≤ 22 chars, uppercase. */
  statementDescriptor: string;
  description: string;
  monthlyCents: number;
  annualCents: number;
  /** Per-interval `lookup_key` filter values used by the dashboard. */
  metadataLookupKey: {
    monthly: string;
    annual: string;
  };
}

export const CREATOR_TIER_CONFIGS: ReadonlyArray<CreatorProductTierConfig> = [
  {
    key: "coach",
    productName: "HeyMaya Coach",
    statementDescriptor: "HEYMAYA COACH",
    description:
      "Maya as your AI creator coach. Daily proactive guidance across iMessage. Limited cron set, capped chat, cost-bounded thinking budget. The post-trial default.",
    monthlyCents: 1999,
    annualCents: 19900,
    metadataLookupKey: {
      monthly: "heymaya_creator_coach_monthly",
      annual: "heymaya_creator_coach_annual",
    },
  },
  {
    key: "manager",
    productName: "HeyMaya Manager",
    statementDescriptor: "HEYMAYA MANAGER",
    description:
      "Maya as your full-time AI creator manager. Full proactive cron set, unlimited chat, all thinking budgets, full Gmail deal desk, brand-contact discovery via Apollo/Hunter. New sign-ups get 7 days free.",
    monthlyCents: 4999,
    annualCents: 49900,
    metadataLookupKey: {
      monthly: "heymaya_creator_manager_monthly",
      annual: "heymaya_creator_manager_annual",
    },
  },
];

/** Tag attached to every product/price the seeder creates so reruns can
 *  detect existing rows rather than duplicating. */
export const HEYMAYA_CREATOR_TIER_TAG = "heymaya_creator_tier_v0";

/** Returns the canonical lookup_key for a tier-product. */
export function productLookupKey(tier: CreatorTierKey): string {
  return `creator-${tier}`;
}

/** Returns the canonical lookup_key for a tier-price (interval-specific). */
export function priceLookupKey(
  tier: CreatorTierKey,
  interval: StripeInterval
): string {
  const suffix = interval === "month" ? "monthly" : "annual";
  return `creator-${tier}-${suffix}`;
}

/** Returns the env-var name that must hold this tier-interval price id. */
export function priceEnvVarName(
  tier: CreatorTierKey,
  interval: StripeInterval
): string {
  const suffix = interval === "month" ? "MONTHLY" : "ANNUAL";
  return `STRIPE_PRICE_${tier.toUpperCase()}_${suffix}`;
}
