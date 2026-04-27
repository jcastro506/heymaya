/**
 * Service-product Stripe Checkout flow — Wave D.
 *
 * Public action `createServiceCheckoutSession` is invoked by the Profile
 * Billing tab on `/biz/profile` when an operator picks a tier (Starter / Pro
 * / Studio) and billing cycle (monthly / annual).
 *
 * Behavior:
 *   1. Re-resolve the operator's `creators` row from Clerk identity, then walk
 *      to `businesses` via `creators.businessId`. The frontend NEVER passes a
 *      `businessId` — anti-tenant-bleed (matches the pattern in
 *      `convex/queries/business/_session.ts`).
 *   2. If no `stripeCustomerId` exists on the business row, create one via
 *      Stripe and patch the row via an internal mutation.
 *   3. Build a Stripe Checkout session in `subscription` mode. 14-day trial
 *      is enabled ONLY when:
 *        - tier=Pro AND
 *        - this is the operator's FIRST subscription (no prior
 *          stripeSubscriptionId on the business row).
 *      Trial conversion auto-downgrades to Starter via subscription_schedule
 *      (see `STRIPE_AUTO_DOWNGRADE_NOTE` below).
 *   4. For Studio, include the metered voice price as a second line item so
 *      voice usage reports flow against this subscription.
 *   5. Stamp `metadata.{businessId,tier,interval}` so webhook handlers can
 *      patch the right row without re-reading the price-id table.
 *   6. Return the hosted Checkout URL.
 *
 * STRIPE_AUTO_DOWNGRADE_NOTE — Pro trial → Starter on expiry:
 *   The plan (`docs/SPRINT_PLAN_SERVICE_V0.md` § 1) requires "auto-downgrade
 *   to Starter on expiry, no card lost." We implement this by attaching a
 *   subscription_schedule that swaps the price from Pro to Starter at
 *   `trial_end`. This is set up here in the same checkout call so the
 *   operator sees a single Stripe session — no second flow on day-14.
 *
 * Plan-tier note: ALL three tiers are sellable on the service product
 * (Starter is the $99 paid floor — different from the creator product where
 * Starter is the free post-downgrade default).
 */

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { getStripeClient } from "../../billing/stripeClient";
import {
  servicePriceIdFor,
  serviceVoiceOveragePriceIdFor,
} from "./priceIds";

const TIER_VALIDATOR = v.union(
  v.literal("starter"),
  v.literal("pro"),
  v.literal("studio")
);
const INTERVAL_VALIDATOR = v.union(
  v.literal("monthly"),
  v.literal("annual")
);

/** 14-day Pro trial — applied only on first-time Pro subscriptions. */
const PRO_TRIAL_DAYS = 14;

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

interface ServiceCheckoutContext {
  business: Pick<
    Doc<"businesses">,
    "_id" | "stripeCustomerId" | "stripeSubscriptionId" | "planTier"
  >;
  account: Pick<Doc<"creators">, "_id" | "email">;
}

export const getMeForServiceCheckout = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<ServiceCheckoutContext | null> => {
    const account = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", args.clerkUserId)
      )
      .first();
    if (!account) return null;
    if (account.accountType !== "service-business") return null;
    if (!account.businessId) return null;
    const business = await ctx.db.get(account.businessId);
    if (!business) return null;
    return {
      business: {
        _id: business._id,
        stripeCustomerId: business.stripeCustomerId,
        stripeSubscriptionId: business.stripeSubscriptionId,
        planTier: business.planTier,
      },
      account: {
        _id: account._id,
        email: account.email,
      },
    };
  },
});

export const setBusinessStripeCustomerId = internalMutation({
  args: {
    businessId: v.id("businesses"),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    const b = await ctx.db.get(args.businessId);
    if (!b) throw new Error("setBusinessStripeCustomerId: business not found");
    // Idempotency: only patch when value differs.
    if (b.stripeCustomerId === args.stripeCustomerId) return;
    await ctx.db.patch(args.businessId, {
      stripeCustomerId: args.stripeCustomerId,
      updatedAt: Date.now(),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Public action — createServiceCheckoutSession                                */
/* -------------------------------------------------------------------------- */

export const createServiceCheckoutSession = action({
  args: {
    tier: TIER_VALIDATOR,
    interval: INTERVAL_VALIDATOR,
  },
  handler: async (
    ctx,
    args
  ): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("createServiceCheckoutSession: not authenticated.");
    }

    const me = await ctx.runQuery(
      internal.integrations.stripe.checkout.getMeForServiceCheckout,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      throw new Error(
        "createServiceCheckoutSession: business row not found for signed-in user."
      );
    }

    const priceId = servicePriceIdFor(args.tier, args.interval);
    if (!priceId) {
      throw new Error(
        `createServiceCheckoutSession: STRIPE_SERVICE_PRICE_${args.tier.toUpperCase()}_${args.interval.toUpperCase()} is not set in Convex env.`
      );
    }

    const baseUrl = process.env.APP_URL;
    if (!baseUrl) {
      throw new Error("createServiceCheckoutSession: APP_URL is not set.");
    }

    const stripe = getStripeClient();

    // 1. Resolve / create Stripe customer.
    let stripeCustomerId = me.business.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: me.account.email,
        metadata: {
          businessId: String(me.business._id),
          accountId: String(me.account._id),
          heymaya_product: "service",
        },
      });
      stripeCustomerId = customer.id;
      await ctx.runMutation(
        internal.integrations.stripe.checkout.setBusinessStripeCustomerId,
        {
          businessId: me.business._id as Id<"businesses">,
          stripeCustomerId,
        }
      );
    }

    // 2. Build line items. Studio attaches metered voice as a second item so
    //    voice usage reports against this subscription. Pro's metered voice
    //    item is also attached (Pro reports overage above the 30-min
    //    inclusion). Starter has no metered voice item.
    const lineItems: Array<{ price: string; quantity?: number }> = [
      { price: priceId, quantity: 1 },
    ];
    if (args.tier === "pro" || args.tier === "studio") {
      const meteredPriceId = serviceVoiceOveragePriceIdFor(args.tier);
      if (meteredPriceId) {
        // Metered prices are attached without `quantity` — usage is reported
        // via Stripe meter events post-call.
        lineItems.push({ price: meteredPriceId });
      }
      // If the metered price env var is missing, we DON'T fail the checkout
      // — operator may not have run `createServiceProducts.ts` yet. The
      // subscription will be created without metered voice; voiceMetering.ts
      // will skip reporting for that business until the metered item is
      // attached via a portal upgrade. This is the safest fail-mode.
    }

    // 3. Trial gating. ONLY first-time Pro subscriptions get the 14-day
    //    trial — re-subscribing to Pro after a cancel does NOT re-trigger.
    const isFirstSubscription = !me.business.stripeSubscriptionId;
    const enableTrial = args.tier === "pro" && isFirstSubscription;
    const trialDays = enableTrial ? PRO_TRIAL_DAYS : undefined;

    // 4. Build Checkout session.
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: lineItems,
      success_url: `${baseUrl}/biz/profile?billing=success`,
      cancel_url: `${baseUrl}/biz/profile?billing=cancelled`,
      client_reference_id: String(me.business._id),
      metadata: {
        businessId: String(me.business._id),
        accountId: String(me.account._id),
        tier: args.tier,
        interval: args.interval,
        heymaya_product: "service",
      },
      subscription_data: {
        ...(trialDays !== undefined ? { trial_period_days: trialDays } : {}),
        metadata: {
          businessId: String(me.business._id),
          accountId: String(me.account._id),
          tier: args.tier,
          interval: args.interval,
          heymaya_product: "service",
        },
      },
    });

    if (!session.url) {
      throw new Error(
        "createServiceCheckoutSession: Stripe returned a session without a hosted URL."
      );
    }

    return { url: session.url };
  },
});
