/**
 * Stripe Customer Portal — Sprint 6B.
 *
 * Public action `openCustomerPortal` returns a one-shot Stripe-hosted URL the
 * Profile screen redirects to. The portal handles plan changes / cancellation
 * / payment-method updates / invoice history server-side; we react to whatever
 * the creator does via the webhook handlers in `convex/billing/webhook.ts`.
 *
 * Pre-condition: the creator MUST have a stripeCustomerId (i.e. has gone
 * through Checkout at least once). Calling this before subscribing is a
 * UX bug — we throw with a clear message.
 */

import { action, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getStripeClient } from "./stripeClient";

export const getMeForPortal = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<Pick<
    Doc<"creators">,
    "_id" | "stripeCustomerId" | "plan"
  > | null> => {
    const c = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!c) return null;
    return {
      _id: c._id,
      stripeCustomerId: c.stripeCustomerId,
      plan: c.plan,
    };
  },
});

export const openCustomerPortal = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("openCustomerPortal: not authenticated.");
    }
    const me = await ctx.runQuery(
      internal.billing.portal.getMeForPortal,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      throw new Error(
        "openCustomerPortal: creator row not found for signed-in user."
      );
    }
    if (!me.stripeCustomerId) {
      // Frontend should hide the Portal button until subscribed. This is the
      // server-side fail-closed guard.
      throw new Error(
        "openCustomerPortal: subscribe first — no Stripe customer on file."
      );
    }
    const baseUrl = process.env.APP_URL;
    if (!baseUrl) {
      throw new Error("openCustomerPortal: APP_URL is not set.");
    }

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: me.stripeCustomerId,
      return_url: `${baseUrl}/profile`,
    });

    if (!session.url) {
      throw new Error(
        "openCustomerPortal: Stripe returned a session without a hosted URL."
      );
    }
    return { url: session.url };
  },
});
