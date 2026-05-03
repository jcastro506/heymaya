/**
 * Service-product Stripe Customer Portal — Wave D.
 *
 * Public action `openServiceCustomerPortal` returns a one-shot Stripe-hosted
 * URL the Profile Billing tab redirects the operator to. The portal handles
 * plan changes / cancellation / payment-method updates / invoice history; we
 * react via the webhook handlers in `convex/integrations/stripe/webhooks.ts`.
 *
 * Pre-condition: the business MUST have a stripeCustomerId (i.e. has gone
 * through Checkout at least once). Calling this before subscribing is a UX
 * bug — we throw with a clear message.
 *
 * Cross-tenant: identical chain to `checkout.ts` — Clerk identity resolves
 * the `creators` row, then walks to `businesses` via `creators.businessId`.
 * The frontend NEVER passes a `businessId`.
 */

import { v } from "convex/values";
import { action, internalQuery } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { getStripeClient } from "../../billing/stripeClient";

export const getMeForServicePortal = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<Pick<
    Doc<"businesses">,
    "_id" | "stripeCustomerId" | "planTier"
  > | null> => {
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
      _id: business._id,
      stripeCustomerId: business.stripeCustomerId,
      planTier: business.planTier,
    };
  },
});

export const openServiceCustomerPortal = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("openServiceCustomerPortal: not authenticated.");
    }
    const me = await ctx.runQuery(
      internal.integrations.stripe.customerPortal.getMeForServicePortal,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      throw new Error(
        "openServiceCustomerPortal: business row not found for signed-in user."
      );
    }
    if (!me.stripeCustomerId) {
      // Frontend should hide the Portal button until subscribed. This is the
      // server-side fail-closed guard.
      throw new Error(
        "openServiceCustomerPortal: subscribe first — no Stripe customer on file."
      );
    }
    const baseUrl = process.env.APP_URL;
    if (!baseUrl) {
      throw new Error("openServiceCustomerPortal: APP_URL is not set.");
    }

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: me.stripeCustomerId,
      return_url: `${baseUrl}/biz/profile`,
    });

    if (!session.url) {
      throw new Error(
        "openServiceCustomerPortal: Stripe returned a session without a hosted URL."
      );
    }
    return { url: session.url };
  },
});
