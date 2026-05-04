/**
 * Stripe price-id ↔ (tier, interval) mapping — Coach + Manager 2-tier model.
 *
 * Pure function used by:
 *   - `convex/billing/checkout.ts` to resolve the `line_items[0].price` for a
 *     given (tier, interval) pair before calling Stripe Checkout.
 *   - `convex/billing/webhook.ts` as defense-in-depth: if a Stripe webhook
 *     arrives with `metadata.tier` missing (e.g. legacy subscription, billing
 *     portal change-plan flow that doesn't carry our metadata), the handler
 *     falls back to looking up the subscription's price id and recovering
 *     the (tier, interval) pair from this table.
 *
 * Sellable tiers:
 *   - Coach   — $19.99/mo, $199/yr
 *   - Manager — $49.99/mo, $499/yr
 *
 * Both tiers are sellable via Checkout, and BOTH get a 7-day free trial
 * on the creator's first subscription only (re-subscribers post-cancel are
 * billed immediately). There is no free post-downgrade tier in this model —
 * Coach is the floor; the cancel webhook handler downgrades to Coach.
 *
 * The lookup tables are built at module-load time from env vars. If an env
 * var is absent (e.g. operator hasn't created the annual SKU yet), that
 * (tier, interval) pair simply won't appear in the table — the consumer
 * either rejects the request or falls back to its `metadata.tier` source of
 * truth.
 */

/**
 * Creator tier names for billing — Coach + Manager 2-tier model.
 *
 * Defined locally rather than imported from `../lib/planFeatures` so this
 * module is self-contained at the type level and can be edited
 * independently of the plan-features matrix. The canonical `Plan` type
 * in `convex/lib/planFeatures.ts` should be kept in sync with these
 * literals (`"coach" | "manager"`); when the plan-features matrix is
 * updated to the new tier names, downstream callers can re-anchor on
 * `Plan` directly.
 */
export type CreatorTier = "coach" | "manager";
export type BillingInterval = "monthly" | "annual";

/** Plans Stripe can sell. Both Coach and Manager are sellable in the v1
 *  2-tier model — both with a 7-day free trial on first subscription. */
export type SellablePlan = CreatorTier;

/** Pairs the operator must create in Stripe + ship in env. */
export const SELLABLE_PRICE_ENV_VARS: ReadonlyArray<{
  tier: SellablePlan;
  interval: BillingInterval;
  envVar: string;
}> = [
  { tier: "coach", interval: "monthly", envVar: "STRIPE_PRICE_COACH_MONTHLY" },
  { tier: "coach", interval: "annual", envVar: "STRIPE_PRICE_COACH_ANNUAL" },
  { tier: "manager", interval: "monthly", envVar: "STRIPE_PRICE_MANAGER_MONTHLY" },
  { tier: "manager", interval: "annual", envVar: "STRIPE_PRICE_MANAGER_ANNUAL" },
];

/**
 * Resolve `STRIPE_PRICE_<TIER>_<INTERVAL>` → price id. Returns null if the
 * env var is unset; callers should reject the user-facing flow with a clear
 * "operator must configure that price" error rather than guessing a fallback.
 */
export function priceIdFor(
  tier: SellablePlan,
  interval: BillingInterval
): string | null {
  const envVar = `STRIPE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`;
  const value = process.env[envVar];
  return value && value.length > 0 ? value : null;
}

/**
 * Reverse lookup — given a price id observed on a Stripe subscription, return
 * the (tier, interval) tuple. Returns null if the id isn't one we recognize
 * (e.g. operator-created test SKU, deleted price). Webhook handlers fall
 * back to `metadata.tier` when this returns null.
 *
 * NOTE: env vars are read on every call (not cached) so tests that stub env
 * vars via `vi.stubEnv` see fresh values without an extra reset hook.
 */
export function priceIdToPlanTuple(
  priceId: string
): { tier: CreatorTier; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const entry of SELLABLE_PRICE_ENV_VARS) {
    if (process.env[entry.envVar] === priceId) {
      return { tier: entry.tier, interval: entry.interval };
    }
  }
  return null;
}
