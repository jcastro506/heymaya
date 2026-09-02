/**
 * The Stripe seam (plan §19.3). One lazily built client for the isolate (fetch HTTP
 * client, Web Crypto for signatures), pinned API version, and the narrow interface
 * billing code is allowed to touch, so tests inject a fake and never hit the network.
 * Adapted from legacy `convex/billing/stripeClient.ts` (salvage verdict ADAPT).
 */

import Stripe from "stripe";

export const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;

export interface StripeLike {
  customers: { create(params: Stripe.CustomerCreateParams): Promise<{ id: string }> };
  checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }> } };
  billingPortal: { sessions: { create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }> } };
  subscriptions: { cancel(id: string): Promise<{ id: string; status: string }> };
}

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  cached = new Stripe(key, { apiVersion: STRIPE_API_VERSION as never, httpClient: Stripe.createFetchHttpClient() });
  return cached;
}

/** Verify a webhook's signature over the raw bytes, with Web Crypto (no Node crypto in the isolate). */
export async function constructEvent(rawBody: string, signature: string, secret: string): Promise<Stripe.Event> {
  return await getStripe().webhooks.constructEventAsync(rawBody, signature, secret, undefined, Stripe.createSubtleCryptoProvider());
}

/** Price ids live in the deployment env, one per interval and tier; founding is the first hundred (§19.1). */
export function priceIdFor(interval: "monthly" | "annual", founding: boolean): string {
  const key = founding ? (interval === "monthly" ? "STRIPE_PRICE_FOUNDING_MONTHLY" : "STRIPE_PRICE_FOUNDING_ANNUAL") : interval === "monthly" ? "STRIPE_PRICE_LIST_MONTHLY" : "STRIPE_PRICE_LIST_ANNUAL";
  const id = process.env[key];
  if (!id) throw new Error(`${key} is not set`);
  return id;
}

export const FOUNDING_SEATS = 100;
export const TRIAL_DAYS = 7;
export const GRACE_DAYS = 7; // past_due: Stripe Smart Retries; proactive continues 3 days, then pauses
export const PAST_DUE_PROACTIVE_DAYS = 3;
