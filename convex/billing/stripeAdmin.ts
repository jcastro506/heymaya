/**
 * Operator-only Stripe housekeeping, run with the deployment's own key (so no one handles it):
 * `inventory` lists what exists; `ensurePlanProducts` gives each plan its own product (Stripe's
 * plan-switch page requires one product per plan, 2026-09-29). Internal: never reachable from a client.
 *
 *   npx convex run billing/stripeAdmin:inventory '{}'
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { getStripe } from "./stripe";
import { priceEnvKey, TIER_NAMES, TIERS } from "./tiers";

export const inventory = internalAction({
  args: {},
  handler: async (): Promise<{ mode: string; configured: Record<string, string | null>; products: Array<{ id: string; name: string; active: boolean; metadata: Record<string, string>; prices: Array<{ id: string; active: boolean; amount: number | null; currency: string; interval: string | null; nickname: string | null; lookupKey: string | null }> }> }> => {
    const stripe = getStripe();
    const configured: Record<string, string | null> = {};
    for (const tier of TIER_NAMES) for (const interval of ["monthly", "annual"] as const) configured[priceEnvKey(tier, interval)] = process.env[priceEnvKey(tier, interval)] ?? null;
    const products = await stripe.products.list({ limit: 100 });
    const prices = await stripe.prices.list({ limit: 100 });
    return {
      mode: (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live") ? "live" : "test",
      configured,
      products: products.data.map((p) => ({
        id: p.id, name: p.name, active: p.active, metadata: p.metadata,
        prices: prices.data.filter((x) => (typeof x.product === "string" ? x.product : x.product.id) === p.id).map((x) => ({ id: x.id, active: x.active, amount: x.unit_amount, currency: x.currency, interval: x.recurring?.interval ?? null, nickname: x.nickname, lookupKey: x.lookup_key })),
      })),
    };
  },
});

/** Pure: what each plan's product and prices should be, from tiers.ts (the one price source). */
export function planCatalog(): Array<{ tier: string; name: string; prices: Array<{ interval: "monthly" | "annual"; recurring: "month" | "year"; unitAmount: number; lookupKey: string; envKey: string }> }> {
  return TIER_NAMES.map((tier) => ({
    tier,
    name: `Maya: ${TIERS[tier].label}`,
    prices: (["monthly", "annual"] as const).map((interval) => ({
      interval,
      recurring: interval === "monthly" ? "month" as const : "year" as const,
      unitAmount: Math.round((interval === "monthly" ? TIERS[tier].priceUsd : TIERS[tier].annualUsd) * 100),
      lookupKey: `maya_plan_${tier}_${interval}`,
      envKey: priceEnvKey(tier, interval),
    })),
  }));
}

/**
 * One product per plan, each with its monthly and annual price (idempotent: reuses a product tagged
 * { app: "maya-creator", plan: <tier> } and a price by its lookup key). Never edits or archives
 * existing products or prices. `apply: false` (the default) only reports what it would do.
 * Returns the price ids to set as STRIPE_PRICE_* on this deployment.
 */
export const ensurePlanProducts = internalAction({
  args: { apply: v.optional(v.boolean()) },
  handler: async (_ctx, a): Promise<{ mode: string; applied: boolean; actions: string[]; env: Record<string, string> }> => {
    const stripe = getStripe();
    const mode = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live") ? "live" : "test";
    const apply = a.apply === true;
    const actions: string[] = [];
    const env: Record<string, string> = {};
    const products = (await stripe.products.list({ limit: 100, active: true })).data;
    for (const plan of planCatalog()) {
      let product = products.find((p) => p.metadata?.app === "maya-creator" && p.metadata?.plan === plan.tier);
      if (!product) {
        actions.push(`create product "${plan.name}"`);
        if (apply) product = await stripe.products.create({ name: plan.name, metadata: { app: "maya-creator", plan: plan.tier } });
      } else actions.push(`reuse product ${product.id} "${product.name}"`);
      for (const price of plan.prices) {
        const found = (await stripe.prices.list({ lookup_keys: [price.lookupKey], limit: 1 })).data[0];
        const productId = product?.id;
        if (found && productId && (typeof found.product === "string" ? found.product : found.product.id) === productId && found.unit_amount === price.unitAmount && found.recurring?.interval === price.recurring && found.active) {
          actions.push(`reuse ${price.lookupKey} ${found.id}`);
          env[price.envKey] = found.id;
          continue;
        }
        actions.push(`create price ${price.lookupKey} $${(price.unitAmount / 100).toFixed(2)}/${price.recurring}${found ? " (moving the lookup key off an old price)" : ""}`);
        if (apply && productId) {
          const created = await stripe.prices.create({ product: productId, currency: "usd", unit_amount: price.unitAmount, recurring: { interval: price.recurring }, lookup_key: price.lookupKey, transfer_lookup_key: true, nickname: `${plan.tier} · ${price.interval}`, metadata: { app: "maya-creator", plan: plan.tier, interval: price.interval } });
          env[price.envKey] = created.id;
        }
      }
    }
    return { mode, applied: apply, actions, env };
  },
});
