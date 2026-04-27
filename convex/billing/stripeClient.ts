/**
 * Stripe SDK singleton + test seam — Sprint 6B.
 *
 * Wraps the Stripe Node SDK so:
 *   - we instantiate it lazily (the v8 isolate boots fast on cold-start)
 *   - tests can inject a fake client without HTTP traffic to Stripe (mirrors
 *     the `getDefaultComposioClient()` / `resetDefaultComposioClient()` pattern
 *     in `convex/integrations/composio/client.ts`)
 *   - we centralise the API version + secret resolution
 *
 * The Stripe SDK ships with a thin `fetch`-based HTTP client that runs cleanly
 * in the Convex V8 isolate. We do NOT use any Node-only Stripe extensions.
 */

import Stripe from "stripe";

/**
 * Pin the API version once. Bumping this is a deliberate decision (Stripe
 * changes response shapes between versions, so an unpinned client can break
 * silently). Update only with a paired test pass + changelog review.
 */
export const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;

/**
 * Subset of the Stripe SDK we actually use. Tests inject a duck-typed mock
 * conforming to this shape so we never make a real network call from a test.
 *
 * Adding a new API surface here is the canonical way to widen the seam — do
 * NOT reach into `Stripe` directly from billing code.
 */
export interface StripeClientLike {
  customers: {
    create(
      params: Stripe.CustomerCreateParams,
      options?: Stripe.RequestOptions
    ): Promise<Stripe.Response<Stripe.Customer>>;
  };
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options?: Stripe.RequestOptions
      ): Promise<Stripe.Response<Stripe.Checkout.Session>>;
    };
  };
  billingPortal: {
    sessions: {
      create(
        params: Stripe.BillingPortal.SessionCreateParams,
        options?: Stripe.RequestOptions
      ): Promise<Stripe.Response<Stripe.BillingPortal.Session>>;
    };
  };
  subscriptions: {
    retrieve(
      id: string,
      params?: Stripe.SubscriptionRetrieveParams,
      options?: Stripe.RequestOptions
    ): Promise<Stripe.Response<Stripe.Subscription>>;
  };
  webhooks: {
    constructEvent(
      payload: string | Buffer,
      header: string | string[] | Buffer,
      secret: string,
      tolerance?: number
    ): Stripe.Event;
  };
  // ─── Wave D — service voice metering surface (additive) ───────────────────
  // The Stripe v22+ Billing Meter Events API replaces the legacy
  // `subscriptionItems.createUsageRecord` flow. We report voice-overage
  // minutes via `billing.meterEvents.create({ event_name, payload })` where
  // `event_name` is one of `SERVICE_VOICE_METER_EVENT_NAMES.{pro,studio}` and
  // payload includes `stripe_customer_id` + `value`. See:
  // https://docs.stripe.com/billing/subscriptions/usage-based/meters
  billing: {
    meterEvents: {
      create(
        params: Stripe.Billing.MeterEventCreateParams,
        options?: Stripe.RequestOptions
      ): Promise<Stripe.Response<Stripe.Billing.MeterEvent>>;
    };
  };
}

let cachedClient: StripeClientLike | null = null;
let injectedForTests: StripeClientLike | null = null;

/**
 * Resolve the Stripe client used by billing actions. Tests can inject one via
 * `_setStripeClientForTests(...)`; production reads `STRIPE_SECRET_KEY` from
 * the Convex env and lazy-instantiates the SDK.
 */
export function getStripeClient(): StripeClientLike {
  if (injectedForTests) return injectedForTests;
  if (cachedClient) return cachedClient;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Configure it in the Convex deployment env."
    );
  }
  // The SDK's TS types narrow `apiVersion` to a literal — the constant above
  // is intentionally typed via `as const` so the assignment compiles cleanly
  // without a cast.
  const stripe = new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION,
    // Convex runs on V8 / fetch — disable the Node-specific HTTP agent setting.
    typescript: true,
  });
  cachedClient = stripe as unknown as StripeClientLike;
  return cachedClient;
}

/**
 * Test seam — inject a fake Stripe client. Call with `null` in `afterEach` to
 * restore the production lazy-singleton behavior.
 */
export function _setStripeClientForTests(
  client: StripeClientLike | null
): void {
  injectedForTests = client;
}

/**
 * Drop the cached production client (e.g. after env var changes mid-suite).
 * Tests should prefer `_setStripeClientForTests` for explicit injection.
 */
export function _resetStripeClientCache(): void {
  cachedClient = null;
}
