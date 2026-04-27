/**
 * Stripe Checkout flow — Sprint 6B.
 *
 * Public action `createCheckoutSession` is invoked by the Profile screen's
 * billing tab when a creator picks Pro or Studio (monthly or annual).
 *
 * Behavior:
 *   1. Re-resolve creator from Clerk identity. The frontend NEVER passes a
 *      `creatorId` — anti-tenant-bleed.
 *   2. If no `stripeCustomerId` exists on the creator row, create one via
 *      Stripe and patch the row via an internal mutation.
 *   3. Build a Stripe Checkout session in `subscription` mode, with a 14-day
 *      trial ONLY for Pro (Studio is billed immediately).
 *   4. Stamp `metadata.{creatorId,tier,interval}` so the webhook handler can
 *      patch the right row even if our reverse-price-id table loses an entry.
 *   5. Return the hosted Checkout URL.
 *
 * Plan-tier note: anyone can checkout to ANY sellable tier (this is HOW
 * upgrades happen). Starter is rejected because Starter is the post-downgrade
 * default — creators reach it via trial-expiry / cancel, never via Checkout.
 */

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getStripeClient } from "./stripeClient";
import { priceIdFor } from "./priceIds";

const TIER_VALIDATOR = v.union(v.literal("pro"), v.literal("studio"));
const INTERVAL_VALIDATOR = v.union(
  v.literal("monthly"),
  v.literal("annual")
);

/** Trial gating: Pro only. Studio bills day-1. */
const TRIAL_DAYS_BY_TIER: Record<"pro" | "studio", number | undefined> = {
  pro: 14,
  studio: undefined,
};

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
    "_id" | "email" | "plan" | "stripeCustomerId"
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

    // 2. Build Checkout session params.
    const trialDays = TRIAL_DAYS_BY_TIER[args.tier];
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Pro = 14-day trial, Studio = immediate. Trial gating lives here, not
      // on the Stripe price object, so the operator can flip it without
      // re-creating the SKU.
      ...(trialDays !== undefined
        ? { subscription_data: { trial_period_days: trialDays } }
        : {}),
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
      // pair without re-reading the Checkout session.
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
