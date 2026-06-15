/**
 * GTM ($99 single-tier "gtm99") billing — reuses the creator-product Stripe
 * plumbing (stripeClient singleton, the signed webhook route, stripeWebhookEvents
 * idempotency) and adds the GTM-specific write path: subscription status →
 * `gtmAgents.gtmPlanJson` (parsed by planFeaturesGtm).
 *
 * Single tier, 7-day full-access trial (see planGtm.gtmTrialDays). The creator
 * row's `plan`/`stripeSubscriptionId` fields stay UNTOUCHED for gtm-agents —
 * the GTM plan lives entirely in gtmPlanJson so the two products never collide.
 *
 * Operator setup required before checkout works (can't be code-side):
 *   1. Create a $99/mo Stripe Product + Price (optional $999/yr).
 *   2. Set STRIPE_PRICE_GTM99_MONTHLY (and _ANNUAL) in Convex env.
 * Until then `gtmPriceId` returns null and checkout rejects with a clear error.
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getStripeClient } from "./stripeClient";
import { assertWebhookSecret } from "../lib/webhookSecret";
import {
  buildGtmPlanJson,
  gtmTrialDays,
  type GtmPlan,
  type GtmPlanStatus,
} from "../gtmMaya/planGtm";

export type GtmInterval = "monthly" | "annual";

/**
 * Resolve the Stripe price env var for a tier + interval → price id (null if
 * unset). gtm99 → STRIPE_PRICE_GTM99_<INTERVAL>; studio → STRIPE_PRICE_STUDIO_<INTERVAL>.
 */
export function gtmPriceId(
  interval: GtmInterval,
  tier: GtmPlan = "gtm99"
): string | null {
  const prefix = tier === "studio" ? "STUDIO" : "GTM99";
  const envVar = `STRIPE_PRICE_${prefix}_${interval.toUpperCase()}`;
  const value = process.env[envVar];
  return value && value.length > 0 ? value : null;
}

const GTM_STATUS = v.union(
  v.literal("active"),
  v.literal("past_due"),
  v.literal("trialing"),
  v.literal("none")
);

const GTM_PLAN = v.union(v.literal("gtm99"), v.literal("studio"));

/* -------------------------------------------------------------------------- */
/* Plan write — the single mutation the webhook AND the operator comp call.    */
/* -------------------------------------------------------------------------- */

/**
 * Write the GTM plan onto the agent. Resolves the agent by its OWNING creator
 * (the gtm-agent account). Idempotent; safe to call from webhook retries.
 */
export const applyGtmPlan = internalMutation({
  args: {
    accountId: v.id("creators"),
    status: GTM_STATUS,
    tier: v.optional(GTM_PLAN),
    periodEndMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ patched: boolean; reason?: string }> => {
    const creator = await ctx.db.get(args.accountId);
    if (!creator || creator.accountType !== "gtm-agent") {
      return { patched: false, reason: "not a gtm-agent account" };
    }
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    if (!agent) return { patched: false, reason: "no gtm agent row" };

    await ctx.db.patch(agent._id, {
      gtmPlanJson: buildGtmPlanJson({
        status: args.status as GtmPlanStatus,
        tier: (args.tier as GtmPlan | undefined) ?? "gtm99",
        periodStartMs: Date.now(),
      }),
      updatedAt: Date.now(),
    });
    return { patched: true };
  },
});

/**
 * Resolve a gtm-agent creator by Stripe customer id (webhook side). The GTM
 * checkout stamps metadata.product="gtm"; the route calls this to write the plan.
 */
export const applyGtmPlanByStripeCustomer = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    status: GTM_STATUS,
    tier: v.optional(GTM_PLAN),
    creatorId: v.optional(v.id("creators")),
    periodEndMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ patched: boolean; reason?: string }> => {
    // Linear filter-scan, mirroring billing/webhook.ts findCreatorByStripeCustomerId
    // (tiny table, 1 row per creator; not hot enough to warrant an index).
    const creator = await ctx.db
      .query("creators")
      .filter((q) => q.eq(q.field("stripeCustomerId"), args.stripeCustomerId))
      .first();
    if (!creator) return { patched: false, reason: "no_creator" };
    // Cross-tenant guard: metadata creatorId (if present) must match.
    if (args.creatorId && args.creatorId !== creator._id) {
      return { patched: false, reason: "creator_mismatch" };
    }
    return await ctx.runMutation(internal.billing.gtmBilling.applyGtmPlan, {
      accountId: creator._id,
      status: args.status,
      tier: args.tier,
      periodEndMs: args.periodEndMs,
    });
  },
});

/**
 * Public, bridge-secret-guarded wrapper the Stripe webhook route calls for
 * GTM subscribers (metadata.product === "gtm"). Maps a raw Stripe subscription
 * status to a GtmPlanStatus and writes the plan. Mirrors the creator
 * `*Public` handlers.
 */
export const applyGtmPlanFromWebhookPublic = mutation({
  args: {
    secret: v.string(),
    stripeCustomerId: v.string(),
    creatorId: v.optional(v.id("creators")),
    stripeStatus: v.string(),
    tier: v.optional(GTM_PLAN),
    periodEndMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ patched: boolean; reason?: string }> => {
    assertWebhookSecret(args.secret);
    const status = mapStripeStatusToGtm(args.stripeStatus);
    // Linear filter-scan (mirrors billing/webhook.ts).
    const creator = await ctx.db
      .query("creators")
      .filter((q) => q.eq(q.field("stripeCustomerId"), args.stripeCustomerId))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") {
      return { patched: false, reason: "no_gtm_creator" };
    }
    if (args.creatorId && args.creatorId !== creator._id) {
      return { patched: false, reason: "creator_mismatch" };
    }
    return await ctx.runMutation(internal.billing.gtmBilling.applyGtmPlan, {
      accountId: creator._id,
      status,
      tier: args.tier,
      periodEndMs: args.periodEndMs,
    });
  },
});

/**
 * Reverse-map a Stripe price id → GTM tier, for the webhook route's defense-in-
 * depth when subscription metadata is absent (e.g. a portal-initiated plan
 * change). Returns null if the price matches no configured GTM price.
 */
export function gtmTierFromPriceId(priceId: string | null | undefined): GtmPlan | null {
  if (!priceId) return null;
  for (const tier of ["studio", "gtm99"] as const) {
    for (const interval of ["monthly", "annual"] as const) {
      if (gtmPriceId(interval, tier) === priceId) return tier;
    }
  }
  return null;
}

/** Stripe subscription.status → our GtmPlanStatus. Unknown/ended → none. */
export function mapStripeStatusToGtm(stripeStatus: string): GtmPlanStatus {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    default:
      // canceled, incomplete, incomplete_expired, paused, etc. → no entitlement.
      return "none";
  }
}

/* -------------------------------------------------------------------------- */
/* Checkout                                                                    */
/* -------------------------------------------------------------------------- */

export const getGtmAgentForCheckout = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    accountId: Id<"creators">;
    email: string;
    stripeCustomerId?: string;
    hasPriorSubscription: boolean;
  } | null> => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    return {
      accountId: creator._id,
      email: creator.email,
      stripeCustomerId: creator.stripeCustomerId,
      hasPriorSubscription: Boolean(creator.stripeSubscriptionId),
    };
  },
});

export const setGtmStripeCustomerId = internalMutation({
  args: { accountId: v.id("creators"), stripeCustomerId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.accountId, {
      stripeCustomerId: args.stripeCustomerId,
    });
  },
});

/**
 * Create a Stripe Checkout session for the signed-in gtm-agent. 7-day full
 * trial on the first subscription. Stamps metadata.product="gtm" on BOTH the
 * session and the subscription so the webhook route can branch to the GTM path.
 */
export const createGtmCheckoutSession = action({
  args: {
    interval: v.optional(v.union(v.literal("monthly"), v.literal("annual"))),
    tier: v.optional(GTM_PLAN),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("createGtmCheckoutSession: not authenticated.");

    const me = await ctx.runQuery(
      internal.billing.gtmBilling.getGtmAgentForCheckout,
      { clerkUserId: identity.subject }
    );
    if (!me) throw new Error("createGtmCheckoutSession: no gtm-agent account.");

    const interval: GtmInterval = args.interval ?? "monthly";
    const tier: GtmPlan = (args.tier as GtmPlan | undefined) ?? "gtm99";
    const priceId = gtmPriceId(interval, tier);
    if (!priceId) {
      const prefix = tier === "studio" ? "STUDIO" : "GTM99";
      throw new Error(
        `createGtmCheckoutSession: STRIPE_PRICE_${prefix}_${interval.toUpperCase()} is not set — operator must create the Stripe product + set the env var.`
      );
    }
    const baseUrl = process.env.APP_URL;
    if (!baseUrl) throw new Error("createGtmCheckoutSession: APP_URL is not set.");

    const stripe = getStripeClient();

    let stripeCustomerId = me.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: me.email,
        metadata: { creatorId: String(me.accountId), product: "gtm" },
      });
      stripeCustomerId = customer.id;
      await ctx.runMutation(internal.billing.gtmBilling.setGtmStripeCustomerId, {
        accountId: me.accountId,
        stripeCustomerId,
      });
    }

    // First-subscription-only full trial. Re-subscribers bill immediately.
    const trialDays = me.hasPriorSubscription ? undefined : gtmTrialDays();
    // Stamp the tier so the webhook resolves entitlement (with a price-id
    // fallback via gtmTierFromPriceId for portal-initiated changes).
    const gtmMeta = { product: "gtm", tier, creatorId: String(me.accountId) };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: gtmMeta,
      subscription_data: {
        metadata: gtmMeta,
        ...(trialDays ? { trial_period_days: trialDays } : {}),
      },
      success_url: `${baseUrl}/clawlaunch/mission/account?checkout=success`,
      cancel_url: `${baseUrl}/clawlaunch/mission/account?checkout=cancelled`,
    });
    if (!session.url) throw new Error("createGtmCheckoutSession: Stripe returned no URL.");
    return { url: session.url };
  },
});

/* -------------------------------------------------------------------------- */
/* Operator comp — flip a test/beta agent to a status without Stripe.          */
/* -------------------------------------------------------------------------- */

/**
 * Operator-only comp: write a GTM plan status onto one agent directly (no
 * Stripe). For dogfood/beta agents + the operator's own test agent so it can
 * auto-post before the Stripe product exists. Run via
 * `npx convex run billing/gtmBilling:compGtmPlanByAgent '{"agentId":"...","status":"active"}'`.
 */
export const compGtmPlanByAgent = internalMutation({
  args: { agentId: v.id("gtmAgents"), status: GTM_STATUS, tier: v.optional(GTM_PLAN) },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return { ok: false };
    await ctx.db.patch(args.agentId, {
      gtmPlanJson: buildGtmPlanJson({
        status: args.status as GtmPlanStatus,
        tier: (args.tier as GtmPlan | undefined) ?? "gtm99",
        periodStartMs: Date.now(),
      }),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});
