/**
 * Service-product Stripe price-id ↔ (tier, interval) mapping — Wave D.
 *
 * Mirrors `convex/billing/priceIds.ts` (creator side) but is a SEPARATE table
 * because:
 *   - Service products have different headline pricing ($99 / $149 / $199 vs
 *     creator $19.99 / $39.99 / $79.99) → different Stripe SKUs.
 *   - Service product additionally has METERED voice prices on Pro + Studio
 *     (creator has none).
 *
 * Source of truth for the env var names: `scripts/stripe/createServiceProducts.ts`
 * outputs a `stripe-products.json` mapping; the operator pastes the price ids
 * into env vars (or copies the JSON into Convex env via the script's `--write-env`
 * flag).
 *
 * Lookups happen at every call (no caching) so `vi.stubEnv` works in tests
 * without manual reset hooks.
 */

export type ServicePlan = "starter" | "pro" | "studio";
export type SellableServicePlan = ServicePlan; // all three are sellable in v0
export type BillingInterval = "monthly" | "annual";

/**
 * Subscription price env vars the operator MUST set after running
 * `createServiceProducts.ts`. Starter is sellable on the service product
 * because it is the $99 paid floor (NOT a free downgrade target like the
 * creator-side starter). On subscription cancellation, the service product
 * sets `subscriptionStatus="canceled"` rather than auto-downgrading the
 * tier — operator must reactivate via Checkout.
 */
export const SERVICE_PRICE_ENV_VARS: ReadonlyArray<{
  tier: SellableServicePlan;
  interval: BillingInterval;
  envVar: string;
}> = [
  { tier: "starter", interval: "monthly", envVar: "STRIPE_SERVICE_PRICE_STARTER_MONTHLY" },
  { tier: "starter", interval: "annual", envVar: "STRIPE_SERVICE_PRICE_STARTER_ANNUAL" },
  { tier: "pro", interval: "monthly", envVar: "STRIPE_SERVICE_PRICE_PRO_MONTHLY" },
  { tier: "pro", interval: "annual", envVar: "STRIPE_SERVICE_PRICE_PRO_ANNUAL" },
  { tier: "studio", interval: "monthly", envVar: "STRIPE_SERVICE_PRICE_STUDIO_MONTHLY" },
  { tier: "studio", interval: "annual", envVar: "STRIPE_SERVICE_PRICE_STUDIO_ANNUAL" },
];

/**
 * Metered voice-overage prices. Pro overage at $0.20/min (no inclusion bucket
 * is enforced on the Stripe side — we report metered minutes only when usage
 * exceeds the inclusion). Studio overage at $0.15/min (above 100-min inclusion).
 *
 * The Stripe meter event_name (NOT the price id) is what drives reporting in
 * voiceMetering.ts. The price ids surface only when the subscription is
 * created with metered items attached.
 */
export const SERVICE_METERED_VOICE_ENV_VARS: ReadonlyArray<{
  tier: "pro" | "studio";
  envVar: string;
}> = [
  { tier: "pro", envVar: "STRIPE_SERVICE_PRICE_VOICE_OVERAGE_PRO" },
  { tier: "studio", envVar: "STRIPE_SERVICE_PRICE_VOICE_OVERAGE_STUDIO" },
];

/**
 * The Stripe billing meter event names. Operator creates these in the Stripe
 * dashboard (or via the script). The names are intentionally tier-specific so
 * a misrouted event lands on the right meter.
 */
export const SERVICE_VOICE_METER_EVENT_NAMES = {
  pro: "heymaya_service_voice_minutes_pro",
  studio: "heymaya_service_voice_minutes_studio",
} as const;

/** Resolve recurring subscription price id for a (tier, interval) pair. */
export function servicePriceIdFor(
  tier: SellableServicePlan,
  interval: BillingInterval
): string | null {
  const envVar = `STRIPE_SERVICE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`;
  const value = process.env[envVar];
  return value && value.length > 0 ? value : null;
}

/** Resolve metered voice-overage price id for a tier. Pro/Studio only. */
export function serviceVoiceOveragePriceIdFor(
  tier: "pro" | "studio"
): string | null {
  const envVar = `STRIPE_SERVICE_PRICE_VOICE_OVERAGE_${tier.toUpperCase()}`;
  const value = process.env[envVar];
  return value && value.length > 0 ? value : null;
}

/**
 * Reverse lookup — given a price id observed on a Stripe subscription, return
 * the (tier, interval) tuple. Returns null if not recognized.
 */
export function servicePriceIdToPlanTuple(
  priceId: string
): { tier: SellableServicePlan; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const entry of SERVICE_PRICE_ENV_VARS) {
    if (process.env[entry.envVar] === priceId) {
      return { tier: entry.tier, interval: entry.interval };
    }
  }
  return null;
}
