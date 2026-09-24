/**
 * Checkout and the portal (plan §19.2–19.3). The creator is re-resolved from the
 * Clerk identity, never passed in. Seven-day trial, card required, charged on day
 * seven; the founding price while seats remain; Stripe Tax on. The portal handles
 * card, plan switch and cancellation; webhooks tell us what they did.
 */

import { v } from "convex/values";
import { action, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { getStripe, priceIdFor, TRIAL_DAYS } from "./stripe";
import type { Tier } from "./tiers";

/** Where Stripe hands them back when they came from the iPhone app: a page that returns them to it (P1). */
export const APP_RETURN = "/o/billing";

/** Pure: what a plan change needs, from the subscription's current price and the tier asked for. */
export function planChange(current: { tier?: string; status: string; subscriptionId?: string }, want: Tier): { kind: "checkout" } | { kind: "same" } | { kind: "update" } {
  const live = current.subscriptionId && (current.status === "active" || current.status === "trialing" || current.status === "past_due");
  if (!live) return { kind: "checkout" };
  return current.tier === want ? { kind: "same" } : { kind: "update" };
}

export const meForBilling = internalQuery({
  args: {},
  handler: async (ctx): Promise<Pick<Doc<"creators">, "_id" | "email" | "plan"> | null> => {
    const c = await creatorForIdentity(ctx);
    return c ? { _id: c._id, email: c.email, plan: c.plan } : null;
  },
});

export const createCheckout = action({
  args: { interval: v.union(v.literal("monthly"), v.literal("annual")), tier: v.union(v.literal("solo"), v.literal("duo"), v.literal("partner")), returnTo: v.optional(v.union(v.literal("onboarding"), v.literal("settings"), v.literal("app"))) },
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
    const successPath = a.returnTo === "app" ? `${APP_RETURN}?state=started` : a.returnTo === "onboarding" ? "/start?step=2&billing=started" : "/app/settings?billing=started";
    const cancelPath = a.returnTo === "app" ? `${APP_RETURN}?state=canceled` : a.returnTo === "onboarding" ? "/start?step=1&billing=canceled" : "/app/settings?billing=canceled";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceIdFor(a.tier, a.interval), quantity: 1 }],
      subscription_data: { ...(firstTime ? { trial_period_days: TRIAL_DAYS } : {}), metadata: { creatorId: me._id, founding: founding ? "1" : "0", interval: a.interval, tier: a.tier } },
      payment_method_collection: "always",
      automatic_tax: { enabled: true },
      allow_promotion_codes: true,
      metadata: { creatorId: me._id, founding: founding ? "1" : "0" },
      success_url: `${appUrl}${successPath}`,
      cancel_url: `${appUrl}${cancelPath}`,
    });
    if (!session.url) return { ok: false, reason: "no checkout url" };
    return { ok: true, url: session.url };
  },
});

export const openPortal = action({
  args: { returnTo: v.optional(v.literal("app")) },
  handler: async (ctx, a): Promise<{ ok: true; url: string } | { ok: false; reason: string }> => {
    const me = await ctx.runQuery(internal.billing.checkout.meForBilling, {});
    if (!me) return { ok: false, reason: "no account" };
    if (!me.plan.stripeCustomerId) return { ok: false, reason: "no billing yet" };
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const session = await getStripe().billingPortal.sessions.create({ customer: me.plan.stripeCustomerId, return_url: a.returnTo === "app" ? `${appUrl}${APP_RETURN}?state=done` : `${appUrl}/app/settings` });
    return { ok: true, url: session.url };
  },
});

/**
 * P1: change tier from the app (§11.1). A subscriber goes to Stripe's plan-change confirmation
 * for the new price (proration shown, no second subscription, nobody double-billed); someone
 * without a live subscription gets Checkout. Either way Stripe returns them to the app, and the
 * tier lands from the webhook, never from here.
 */
export const changePlan = action({
  args: { tier: v.union(v.literal("solo"), v.literal("duo"), v.literal("partner")), interval: v.optional(v.union(v.literal("monthly"), v.literal("annual"))) },
  handler: async (ctx, a): Promise<{ ok: true; url: string } | { ok: false; reason: string }> => {
    const me = await ctx.runQuery(internal.billing.checkout.meForBilling, {});
    if (!me) return { ok: false, reason: "no account" };
    const step = planChange({ tier: me.plan.tier, status: me.plan.status, subscriptionId: me.plan.stripeSubscriptionId }, a.tier);
    if (step.kind === "same") return { ok: false, reason: "you're already on that plan" };
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    if (step.kind === "checkout") {
      const r: { ok: true; url: string } | { ok: false; reason: string } = await ctx.runAction(api.billing.checkout.createCheckout, { tier: a.tier, interval: a.interval ?? "monthly", returnTo: "app" });
      return r;
    }
    const stripe = getStripe();
    try {
      const sub = await stripe.subscriptions.retrieve(me.plan.stripeSubscriptionId!);
      const item = sub.items.data[0];
      const interval = a.interval ?? (item?.price.recurring?.interval === "year" ? "annual" : "monthly");
      const session = await stripe.billingPortal.sessions.create({
        customer: me.plan.stripeCustomerId!,
        return_url: `${appUrl}${APP_RETURN}?state=done`,
        flow_data: {
          type: "subscription_update_confirm",
          subscription_update_confirm: { subscription: sub.id, items: [{ id: item.id, price: priceIdFor(a.tier, interval), quantity: 1 }] },
          after_completion: { type: "redirect", redirect: { return_url: `${appUrl}${APP_RETURN}?state=changed` } },
        },
      });
      return { ok: true, url: session.url };
    } catch (e) {
      // Named, not silent: the portal may not allow plan switches for these prices yet.
      console.error(`[billing] changePlan ${me._id} → ${a.tier}: ${e instanceof Error ? e.message : String(e)}`);
      const portal = await stripe.billingPortal.sessions.create({ customer: me.plan.stripeCustomerId!, return_url: `${appUrl}${APP_RETURN}?state=done` });
      return { ok: true, url: portal.url };
    }
  },
});
