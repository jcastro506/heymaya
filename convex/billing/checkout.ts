/**
 * Stripe Checkout flow — Coach + Manager 2-tier model.
 *
 * Public action `createCheckoutSession` is invoked by the landing page CTAs
 * AND by the Profile screen's billing tab when a creator picks Coach or
 * Manager (monthly or annual).
 *
 * Behavior:
 *   1. Re-resolve creator from Clerk identity. The frontend NEVER passes a
 *      `creatorId` — anti-tenant-bleed.
 *   2. If no `stripeCustomerId` exists on the creator row, create one via
 *      Stripe and patch the row via an internal mutation.
 *   3. Build a Stripe Checkout session in `subscription` mode. 7-day free
 *      trial on BOTH Coach and Manager — but only on the creator's FIRST
 *      subscription. Re-subscribers (post-cancel) are billed immediately.
 *   4. Stamp `metadata.{creatorId,tier,interval}` so the webhook handler can
 *      patch the right row even if our reverse-price-id table loses an entry.
 *   5. Return the hosted Checkout URL.
 *
 * Plan-tier note: both Coach and Manager are sellable via Checkout (Coach
 * is the $19.99 paid floor — creators land there post-cancel via the cancel
 * webhook handler, NOT as a free fallback).
 */

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getStripeClient } from "./stripeClient";
import { priceIdFor } from "./priceIds";

const TIER_VALIDATOR = v.union(v.literal("coach"), v.literal("manager"));
const INTERVAL_VALIDATOR = v.union(
  v.literal("monthly"),
  v.literal("annual")
);

/** 7-day free trial — applied on first subscription only, both tiers. */
const FIRST_SUBSCRIPTION_TRIAL_DAYS = 7;

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

export const getMeForCheckout = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<Pick<
    Doc<"creators">,
    "_id" | "email" | "plan" | "stripeCustomerId" | "stripeSubscriptionId"
  > | null> => {
    const c = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!c) return null;
    return {
      _id: c._id,
      email: c.email,
      plan: c.plan,
      stripeCustomerId: c.stripeCustomerId,
      stripeSubscriptionId: c.stripeSubscriptionId,
    };
  },
});

export const setStripeCustomerId = internalMutation({
  args: {
    creatorId: v.id("creators"),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.creatorId);
    if (!c) throw new Error("setStripeCustomerId: creator not found");
    // Idempotency: if already set, only overwrite when the value differs (rare,
    // happens if a Stripe customer is recreated after a manual deletion).
    if (c.stripeCustomerId === args.stripeCustomerId) return;
    await ctx.db.patch(args.creatorId, {
      stripeCustomerId: args.stripeCustomerId,
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Public action — createCheckoutSession                                       */
/* -------------------------------------------------------------------------- */

export const createCheckoutSession = action({
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
      throw new Error("createCheckoutSession: not authenticated.");
    }

    let me = await ctx.runQuery(
      internal.billing.checkout.getMeForCheckout,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      // The Clerk → Convex `user.created` webhook is the canonical path that
      // populates the creators row. In local dev (and any prod hiccup where
      // the webhook missed), the row may not exist yet by the time the user
      // clicks Start trial. Lazy-create it from the authenticated Clerk
      // identity so checkout never dead-ends. The row insert is idempotent
      // by clerkUserId.
      const fallbackEmail =
        (identity.email as string | undefined) ?? `${identity.subject}@unknown`;
      await ctx.runMutation(internal.creators.createFromClerk, {
        clerkUserId: identity.subject,
        email: fallbackEmail,
      });
      me = await ctx.runQuery(
        internal.billing.checkout.getMeForCheckout,
        { clerkUserId: identity.subject }
      );
      if (!me) {
        throw new Error(
          "createCheckoutSession: failed to create creator row from Clerk identity."
        );
      }
    }

    // Argument shape is enforced by validators above, but we double-check
    // the (tier, interval) pair resolves to a real Stripe price id. Reject
    // with a precise message rather than handing Stripe an empty `price`.
    const priceId = priceIdFor(args.tier, args.interval);
    if (!priceId) {
      throw new Error(
        `createCheckoutSession: STRIPE_PRICE_${args.tier.toUpperCase()}_${args.interval.toUpperCase()} is not set in Convex env.`
      );
    }

    const baseUrl = process.env.APP_URL;
    if (!baseUrl) {
      throw new Error("createCheckoutSession: APP_URL is not set.");
    }

    const stripe = getStripeClient();

    // 1. Resolve / create Stripe customer.
    let stripeCustomerId = me.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: me.email,
        metadata: {
          creatorId: String(me._id),
        },
      });
      stripeCustomerId = customer.id;
      await ctx.runMutation(internal.billing.checkout.setStripeCustomerId, {
        creatorId: me._id as Id<"creators">,
        stripeCustomerId,
      });
    }

    // 2. Trial gating. BOTH Coach and Manager get a 7-day free trial — but
    //    only on the creator's FIRST subscription. Re-subscribing after a
    //    cancel does NOT re-trigger the trial.
    const isFirstSubscription = !me.stripeSubscriptionId;
    const enableTrial = isFirstSubscription;
    const trialDays = enableTrial ? FIRST_SUBSCRIPTION_TRIAL_DAYS : undefined;

    // 3. Build Checkout session params.
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Post-checkout: route every paying creator into onboarding. The
      // /onboarding/maya page bounces creators with status:"active" through
      // to /today, so returning subscribers don't see the new-user flow.
      // Net-new creators land in onboarding to enter handles + phone +
      // channel pairing. Without this, a fresh signup paid for a Maya they
      // never finished setting up.
      success_url: `${baseUrl}/onboarding/maya?billing=success`,
      cancel_url: `${baseUrl}/creators?billing=cancelled`,
      client_reference_id: String(me._id),
      metadata: {
        creatorId: String(me._id),
        tier: args.tier,
        interval: args.interval,
      },
      // Mirror metadata onto the subscription so future webhook events
      // (subscription.updated/deleted) can resolve the (tier, interval)
      // pair without re-reading the Checkout session. Trial days, when set,
      // are applied here (not at the price level — see file-level docstring).
      subscription_data: {
        ...(trialDays !== undefined
          ? { trial_period_days: trialDays }
          : {}),
        metadata: {
          creatorId: String(me._id),
          tier: args.tier,
          interval: args.interval,
        },
      },
    });

    if (!session.url) {
      throw new Error(
        "createCheckoutSession: Stripe returned a session without a hosted URL."
      );
    }

    return { url: session.url };
  },
});
