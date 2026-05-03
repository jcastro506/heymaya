/**
 * Stripe price-id ↔ (tier, interval) mapping — Sprint 6B.
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
 * The lookup tables are built at module-load time from env vars. If an env
 * var is absent (e.g. operator hasn't created the annual SKU yet), that
 * (tier, interval) pair simply won't appear in the table — the consumer
 * either rejects the request or falls back to its `metadata.tier` source of
 * truth.
 */

import type { Plan } from "../lib/planFeatures";

export type BillingInterval = "monthly" | "annual";

/** Plans Stripe can sell. Starter is the post-downgrade default and is
 *  intentionally NOT a checkout target (creators land on Starter via
 *  trial-expiry / cancel — never via a Stripe Checkout flow). */
export type SellablePlan = Exclude<Plan, "starter">;

/** Pairs the operator must create in Stripe + ship in env. */
export const SELLABLE_PRICE_ENV_VARS: ReadonlyArray<{
  tier: SellablePlan;
  interval: BillingInterval;
  envVar: string;
}> = [
  { tier: "pro", interval: "monthly", envVar: "STRIPE_PRICE_PRO_MONTHLY" },
  { tier: "pro", interval: "annual", envVar: "STRIPE_PRICE_PRO_ANNUAL" },
  { tier: "studio", interval: "monthly", envVar: "STRIPE_PRICE_STUDIO_MONTHLY" },
  { tier: "studio", interval: "annual", envVar: "STRIPE_PRICE_STUDIO_ANNUAL" },
];

/** Starter price ids are tracked too — only used by the reverse lookup so a
 *  legacy "downgraded to starter via portal" subscription update can still
 *  be recovered without metadata. */
export const STARTER_PRICE_ENV_VARS: ReadonlyArray<{
  tier: "starter";
  interval: BillingInterval;
  envVar: string;
}> = [
  { tier: "starter", interval: "monthly", envVar: "STRIPE_PRICE_STARTER_MONTHLY" },
  { tier: "starter", interval: "annual", envVar: "STRIPE_PRICE_STARTER_ANNUAL" },
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
): { tier: Plan; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const entry of SELLABLE_PRICE_ENV_VARS) {
    if (process.env[entry.envVar] === priceId) {
      return { tier: entry.tier, interval: entry.interval };
    }
  }
  for (const entry of STARTER_PRICE_ENV_VARS) {
    if (process.env[entry.envVar] === priceId) {
      return { tier: entry.tier, interval: entry.interval };
    }
  }
  return null;
}
