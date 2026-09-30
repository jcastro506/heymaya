/**
 * The Stripe customer portal Maya's plan changes run through (2026-09-29). Stripe's default portal
 * had plan switching off, so "Unlock with Partner" fell back to a page that only showed the current
 * plan. Rather than depend on a dashboard toggle (per mode, easy to forget before launch), code keeps
 * one tagged portal configuration that allows switching between exactly our plan prices, and every
 * portal session uses it. Recreated whenever the plan prices change.
 */
import type Stripe from "stripe";
import { priceEnvKey } from "./tiers";
import { TIER_NAMES } from "./tiers";

export const PORTAL_TAG = "maya-plan-switch";

/** Every configured plan price id (a missing env var is skipped, not an error here). */
export function planPriceIds(env: Record<string, string | undefined> = process.env): string[] {
  const ids: string[] = [];
  for (const tier of TIER_NAMES) for (const interval of ["monthly", "annual"] as const) {
    const id = env[priceEnvKey(tier, interval)];
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

/** Pure: prices grouped under their product, the shape the portal wants. */
export function productsFor(prices: Array<{ id: string; product: string }>): Array<{ product: string; prices: string[] }> {
  const by = new Map<string, string[]>();
  for (const p of prices) by.set(p.product, [...(by.get(p.product) ?? []), p.id]);
  return [...by.entries()].map(([product, ids]) => ({ product, prices: [...ids].sort() })).sort((a, b) => a.product.localeCompare(b.product));
}

/** A fingerprint of the switchable prices, so a price change gets a fresh configuration. */
export const fingerprintOf = (prices: string[]) => [...prices].sort().join(",");

/** Pure: the configuration itself. Card, invoices and cancelling stay as they were; switching is on, prorated. */
export function portalConfigParams(products: Array<{ product: string; prices: string[] }>, fingerprint: string): Stripe.BillingPortal.ConfigurationCreateParams {
  return {
    business_profile: { headline: "Your Maya plan" },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: { enabled: true, default_allowed_updates: ["price"], proration_behavior: "create_prorations", products },
    },
    metadata: { maya: PORTAL_TAG, prices: fingerprint.slice(0, 500) },
  };
}

/** The configuration id to use: the tagged one for the current prices, created if missing. */
export async function planSwitchConfigId(stripe: Stripe): Promise<string> {
  const priceIds = planPriceIds();
  const fingerprint = fingerprintOf(priceIds).slice(0, 500);
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const found = existing.data.find((c) => c.metadata?.maya === PORTAL_TAG && c.metadata?.prices === fingerprint);
  if (found) return found.id;
  const prices = await Promise.all(priceIds.map(async (id) => {
    const p = await stripe.prices.retrieve(id);
    return { id, product: typeof p.product === "string" ? p.product : p.product.id };
  }));
  const created = await stripe.billingPortal.configurations.create(portalConfigParams(productsFor(prices), fingerprint));
  return created.id;
}
