/**
 * The tiers (plan §26, 2026-09-12). One source for every price, cap and allowance: the
 * landing, the terms, Settings, her plan line and the three doors all read from here.
 * Budgets, never booleans: a tier without partnerships is an allowance of zero.
 */

export type Tier = "solo" | "duo" | "partner";
export const TIER_NAMES: readonly Tier[] = ["solo", "duo", "partner"] as const;

export interface Entitlements {
  tier: Tier;
  /** Connected TikTok + Instagram accounts she may read. */
  accounts: number;
  partnerships: { researchPerMonth: number; opportunitiesPerMonth: number; draftsPerMonth: number };
}

export const TIERS: Record<Tier, { label: string; priceUsd: number; annualUsd: number; blurb: string; accounts: number; partnerships: Entitlements["partnerships"] }> = {
  solo: { label: "One account", priceUsd: 19, annualUsd: 190, blurb: "Everything, for one TikTok or Instagram account.", accounts: 1, partnerships: { researchPerMonth: 0, opportunitiesPerMonth: 0, draftsPerMonth: 0 } },
  duo: { label: "Both accounts", priceUsd: 24.99, annualUsd: 249.9, blurb: "Everything, for your TikTok and your Instagram.", accounts: 2, partnerships: { researchPerMonth: 0, opportunitiesPerMonth: 0, draftsPerMonth: 0 } },
  partner: { label: "Both plus partnerships", priceUsd: 29.99, annualUsd: 299.9, blurb: "Both accounts, and she finds brand opportunities, drafts the pitch for your approval, and tracks the replies.", accounts: 2, partnerships: { researchPerMonth: 40, opportunitiesPerMonth: 10, draftsPerMonth: 30 } },
};

export const NO_PARTNERSHIPS: Entitlements["partnerships"] = { researchPerMonth: 0, opportunitiesPerMonth: 0, draftsPerMonth: 0 };

export function isTier(x: unknown): x is Tier {
  return x === "solo" || x === "duo" || x === "partner";
}

/** "$24.99", "$19". Pure. */
export function price(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/**
 * What a plan row allows. Unknown or missing tier is `solo`; a comped row without a tier is `duo`.
 * A plan that is not live keeps the account cap (their rows stay readable) and zeroes partnerships.
 */
export function entitlementsFor(plan: { status: string; tier?: string }): Entitlements {
  const tier: Tier = isTier(plan.tier) ? plan.tier : plan.status === "comped" ? "duo" : "solo";
  const live = plan.status === "active" || plan.status === "trialing" || plan.status === "comped" || plan.status === "past_due";
  return { tier, accounts: TIERS[tier].accounts, partnerships: live ? TIERS[tier].partnerships : NO_PARTNERSHIPS };
}

/** Env key for a price: STRIPE_PRICE_DUO_MONTHLY. Pure. */
export function priceEnvKey(tier: Tier, interval: "monthly" | "annual"): string {
  return `STRIPE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`;
}

/** The tier a Stripe price id belongs to, from the env. Unknown ids are null, never a guess. */
export function tierFromPriceId(priceId: string | undefined, env: Record<string, string | undefined> = process.env): Tier | null {
  if (!priceId) return null;
  for (const tier of TIER_NAMES) for (const interval of ["monthly", "annual"] as const) if (env[priceEnvKey(tier, interval)] === priceId) return tier;
  return null;
}

/** The only money facts she may state, for their tier. Pure. */
export function planLineFor(tier: Tier): string {
  const others = TIER_NAMES.filter((t) => t !== tier).map((t) => `${price(TIERS[t].priceUsd)} for ${TIERS[t].label.toLowerCase()}`).join(", ");
  return `${price(TIERS[tier].priceUsd)} a month on their plan (${TIERS[tier].label.toLowerCase()}); the others are ${others}. card on file, first charge on day seven, cancel or switch in one tap in Settings.`;
}

/** The accounts within the plan, in the order the vendor lists them (oldest first). Pure. */
export function accountsWithinPlan<T>(accounts: readonly T[], cap: number): T[] {
  return accounts.slice(0, Math.max(0, cap));
}
