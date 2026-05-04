/**
 * Stripe Checkout flow — Coach + Manager 2-tier model.
 *
 * Public action `createCheckoutSession` is invoked by the Profile screen's
 * billing tab when a creator picks Coach or Manager (monthly or annual).
 *
 * Behavior:
 *   1. Re-resolve creator from Clerk identity. The frontend NEVER passes a
 *      `creatorId` — anti-tenant-bleed.
 *   2. If no `stripeCustomerId` exists on the creator row, create one via
 *      Stripe and patch the row via an internal mutation.
 *   3. Build a Stripe Checkout session in `subscription` mode. 14-day trial
 *      ONLY for Manager AND only on the creator's FIRST subscription.
 *      Coach is billed immediately (no trial).
 *   4. Stamp `metadata.{creatorId,tier,interval}` so the webhook handler can
 *      patch the right row even if our reverse-price-id table loses an entry.
 *   5. Return the hosted Checkout URL.
 *
 * Plan-tier note: both Coach and Manager are sellable via Checkout (Coach
 * is the $29 paid floor — creators land there post-trial-expiry or via
 * direct selection, NOT as a free fallback).
 *
 * Trial-expiry handoff: when the 14-day Manager trial ends, Stripe needs to
 * auto-downgrade the subscription's price to Coach. That requires a
 * `subscription_schedule` to be attached at checkout (or wired post-checkout
 * via webhook). v0 of this checkout flow attaches the trial only — operator
 * must wire the auto-downgrade schedule (TODO: subscription_schedule on
 * trial_end → swap price to Coach monthly).
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

/** 14-day trial — applied only on first-time Manager subscriptions. */
const MANAGER_TRIAL_DAYS = 14;

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

    const me = await ctx.runQuery(
      internal.billing.checkout.getMeForCheckout,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      throw new Error(
        "createCheckoutSession: creator row not found for signed-in user."
      );
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

    // 2. Trial gating. ONLY first-time Manager subscriptions get the 14-day
    //    trial — re-subscribing to Manager after a cancel does NOT
    //    re-trigger. Coach is billed immediately at every checkout.
    const isFirstSubscription = !me.stripeSubscriptionId;
    const enableTrial = args.tier === "manager" && isFirstSubscription;
    const trialDays = enableTrial ? MANAGER_TRIAL_DAYS : undefined;

    // 3. Build Checkout session params.
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/profile?billing=success`,
      cancel_url: `${baseUrl}/profile?billing=cancelled`,
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
