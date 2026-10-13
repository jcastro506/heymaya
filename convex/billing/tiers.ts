/**
 * The tiers (plan §26, 2026-09-12). One source for every price, cap and allowance: the
 * landing, the terms, Settings, her plan line and the three doors all read from here.
 * Budgets, never booleans: a tier without partnerships is an allowance of zero.
 */
import { enabledPlatforms, instagramOn, platformOn } from "../config/platforms";

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

/**
 * TikTok only (config/platforms, 2026-10-12): two plans, the assistant and the assistant plus deals. The tier ids
 * and prices stay (no Stripe change, no migration); only what people see changes, and "duo" is no longer offered.
 */
const TIKTOK_ONLY_COPY: Record<Tier, { label: string; blurb: string }> = {
  solo: { label: "Maya", blurb: "Your content assistant: ideas worth making, your week planned around your life, and what's working, by text." },
  duo: { label: "Maya", blurb: "Your content assistant: ideas worth making, your week planned around your life, and what's working, by text." },
  partner: { label: "Maya + Deals", blurb: "Everything in Maya, plus she finds brands that pay creators like you, drafts the pitch, and tracks the replies." },
};

/** What a tier is called and promises, for the platforms that are on. Pure. */
export function tierCopy(tier: Tier, igOn: boolean = instagramOn()): { label: string; blurb: string } {
  return igOn ? { label: TIERS[tier].label, blurb: TIERS[tier].blurb } : TIKTOK_ONLY_COPY[tier];
}

/** The tiers offered to someone choosing a plan now. Pure. */
export function offeredTiers(igOn: boolean = instagramOn()): Tier[] {
  return igOn ? [...TIER_NAMES] : ["solo", "partner"];
}

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
  const live = plan.status === "active" || plan.status === "trialing" || plan.status === "comped";
  // TikTok only: one account is all there is to read.
  return { tier, accounts: Math.min(TIERS[tier].accounts, enabledPlatforms().length), partnerships: live ? TIERS[tier].partnerships : NO_PARTNERSHIPS };
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
  const others = offeredTiers().filter((t) => t !== tier).map((t) => `${price(TIERS[t].priceUsd)} for ${tierCopy(t).label}`).join(", ");
  return `${price(TIERS[tier].priceUsd)} a month on their plan (${tierCopy(tier).label}); ${others ? `the other plan${offeredTiers().length > 2 ? "s are" : " is"} ${others}` : "it's the only plan"}. card on file, first charge on day seven, cancel or switch in one tap in Settings.`;
}

/** The accounts within the plan, in the order the vendor lists them (oldest first). Pure. */
export function accountsWithinPlan<T>(accounts: readonly T[], cap: number): T[] {
  // Only platforms that are on (config/platforms): with Instagram off, a solo plan's one account is their TikTok.
  const on = (x: T) => { const p = typeof x === "object" && x !== null ? (x as { platform?: string }).platform : undefined; return p === undefined || platformOn(p); };
  return accounts.filter(on).slice(0, Math.max(0, cap));
}
