/**
 * What a creator costs beyond the per-call ledger (docs/CREATOR_COGS_MODEL.md §4, §7). One
 * place for every rate so /ops and the model agree. Rates are the vendors' public prices as
 * of 2026-09-23; revisit with each invoice. Pure.
 */
import { TIERS, isTier } from "../billing/tiers";

/** Platform costs per month, shared by every creator (COGS §4.1). */
export const FIXED_MONTHLY_USD: Record<string, number> = {
  convex: 65, vercel: 20, clerk: 25, fly_relay: 5, sentry: 26, eas_or_ci: 19, apple_developer: 8.25, domain_email: 10,
  // Google CASA for Gmail's restricted scope: only while partnership Gmail send/read is on (off in v1, D7).
  google_casa: 0,
};

/** Claw agency plan: $199 per line, 1,000 messages included, $0.005 after (COGS §5.1). */
export const MESSAGING = { lineUsd: 199, includedPerLine: 1000, perMessageUsd: 0.005 };

/** Zernio, graduated per connected account (verified 2026-07-02). */
export function zernioMonthlyUsd(totalAccounts: number): number {
  const bands: Array<[number, number]> = [[2, 0], [10, 6], [100, 3], [2000, 1]];
  let cost = 0, prev = 0;
  for (const [top, price] of bands) {
    const n = Math.max(0, Math.min(totalAccounts, top) - prev);
    cost += n * price;
    prev = top;
  }
  return cost;
}

/** Stripe card fee + Billing, per monthly charge (estimated until fees come from the webhook). */
export function stripeFeeUsd(priceUsd: number): number {
  return priceUsd > 0 ? priceUsd * 0.029 + 0.3 + priceUsd * 0.007 : 0;
}

export function tierPriceUsd(plan: { status: string; tier?: string }): number {
  if (plan.status !== "active" && plan.status !== "trialing") return 0; // comped, paused, canceled pay nothing
  return isTier(plan.tier) ? TIERS[plan.tier].priceUsd : TIERS.solo.priceUsd;
}

/** Eval, scenario and dev-seed creators are never customers; their spend is ours, not COGS. */
export function isRealCreator(c: { clerkUserId: string }): boolean {
  return !/^(eval|devbare_|dev_|seed_)/.test(c.clerkUserId);
}

export interface CreatorCogs {
  ledgerUsd: number; messagingUsd: number; zernioUsd: number; stripeUsd: number; fixedShareUsd: number;
  totalUsd: number; priceUsd: number; marginPct: number | null;
}

/**
 * One creator's last-30-days cost, all lines. Messaging and Zernio are the creator's share of
 * the fleet bill (lines and bands are fleet-level), so they take fleet totals.
 */
export function creatorCogs(input: {
  ledgerUsd: number; messages: number; accounts: number; priceUsd: number;
  fleet: { creators: number; messages: number; accounts: number; lines: number };
}): CreatorCogs {
  const f = input.fleet;
  const fleetMessagingUsd = f.lines * MESSAGING.lineUsd + Math.max(0, f.messages - f.lines * MESSAGING.includedPerLine) * MESSAGING.perMessageUsd;
  const messagingUsd = f.messages > 0 ? fleetMessagingUsd * (input.messages / f.messages) : 0;
  const zernioUsd = f.accounts > 0 ? zernioMonthlyUsd(f.accounts) * (input.accounts / f.accounts) : 0;
  const stripeUsd = stripeFeeUsd(input.priceUsd);
  const fixed = Object.values(FIXED_MONTHLY_USD).reduce((s, x) => s + x, 0);
  const fixedShareUsd = f.creators > 0 ? fixed / f.creators : 0;
  const totalUsd = input.ledgerUsd + messagingUsd + zernioUsd + stripeUsd + fixedShareUsd;
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    ledgerUsd: r(input.ledgerUsd), messagingUsd: r(messagingUsd), zernioUsd: r(zernioUsd), stripeUsd: r(stripeUsd), fixedShareUsd: r(fixedShareUsd),
    totalUsd: r(totalUsd), priceUsd: input.priceUsd, marginPct: input.priceUsd > 0 ? Math.round((1 - totalUsd / input.priceUsd) * 100) : null,
  };
}
