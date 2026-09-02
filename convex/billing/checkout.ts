/**
 * Checkout and the portal (plan §19.2–19.3). The creator is re-resolved from the
 * Clerk identity, never passed in. Seven-day trial, card required, charged on day
 * seven; the founding price while seats remain; Stripe Tax on. The portal handles
 * card, plan switch and cancellation; webhooks tell us what they did.
 */

import { v } from "convex/values";
import { action, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { getStripe, priceIdFor, TRIAL_DAYS } from "./stripe";

export const meForBilling = internalQuery({
  args: {},
  handler: async (ctx): Promise<Pick<Doc<"creators">, "_id" | "email" | "plan"> | null> => {
    const c = await creatorForIdentity(ctx);
    return c ? { _id: c._id, email: c.email, plan: c.plan } : null;
  },
});

export const createCheckout = action({
  args: { interval: v.union(v.literal("monthly"), v.literal("annual")) },
  handler: async (ctx, a): Promise<{ ok: true; url: string } | { ok: false; reason: string }> => {
    const me = await ctx.runQuery(internal.billing.checkout.meForBilling, {});
    if (!me) return { ok: false, reason: "no account" };
    if (me.plan.stripeSubscriptionId && (me.plan.status === "active" || me.plan.status === "trialing")) return { ok: false, reason: "already subscribed" };
    const stripe = getStripe();
    let customerId = me.plan.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: me.email, metadata: { creatorId: me._id } });
      customerId = customer.id;
      await ctx.runMutation(internal.billing.plan.setStripeCustomer, { creatorId: me._id, stripeCustomerId: customerId });
    }
    const founding = (await ctx.runQuery(internal.billing.plan.seatsLeft, {})) > 0;
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const firstTime = !me.plan.stripeSubscriptionId; // a re-subscriber after cancel is billed now (§19.3)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceIdFor(a.interval, founding), quantity: 1 }],
      subscription_data: { ...(firstTime ? { trial_period_days: TRIAL_DAYS } : {}), metadata: { creatorId: me._id, founding: founding ? "1" : "0", interval: a.interval } },
      payment_method_collection: "always",
      automatic_tax: { enabled: true },
      allow_promotion_codes: true,
      metadata: { creatorId: me._id, founding: founding ? "1" : "0" },
      success_url: `${appUrl}/app/settings?billing=started`,
      cancel_url: `${appUrl}/app/settings?billing=canceled`,
    });
    if (!session.url) return { ok: false, reason: "no checkout url" };
    return { ok: true, url: session.url };
  },
});

export const openPortal = action({
  args: {},
  handler: async (ctx): Promise<{ ok: true; url: string } | { ok: false; reason: string }> => {
    const me = await ctx.runQuery(internal.billing.checkout.meForBilling, {});
    if (!me) return { ok: false, reason: "no account" };
    if (!me.plan.stripeCustomerId) return { ok: false, reason: "no billing yet" };
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const session = await getStripe().billingPortal.sessions.create({ customer: me.plan.stripeCustomerId, return_url: `${appUrl}/app/settings` });
    return { ok: true, url: session.url };
  },
});
