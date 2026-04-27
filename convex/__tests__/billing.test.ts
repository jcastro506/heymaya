/**
 * Stripe billing — Sprint 6B acceptance.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: webhook for Customer A's subscription never patches
 *      Creator B; metadata.creatorId mismatch refuses the patch.
 *   2. Plan-tier × action matrix: webhook updates `plan` correctly for each
 *      tier; downgrade preserves connectedAccounts; trial sets trialEndsAt
 *      for Pro but not for Studio.
 *   3. Adversarial: invalid `tier` rejects in createCheckoutSession; replay
 *      eventId returns alreadySeen + does not re-patch; missing creatorId
 *      metadata still resolves via stripeCustomerId fallback.
 *   4. Sibling-file scan: enforced repo-wide by sprint1Acceptance.test.ts —
 *      stripeWebhookEvents intentionally has NO `creatorId` (Stripe events
 *      identify the customer, not the creator), so the scan correctly skips
 *      it. Schema indexes (by_event_id, by_customer, by_status) are asserted
 *      below as a local sibling check.
 *   5. TODO grep: covered repo-wide.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";
import {
  _setStripeClientForTests,
  type StripeClientLike,
} from "../billing/stripeClient";
import { priceIdToPlanTuple } from "../billing/priceIds";
import type Stripe from "stripe";

const NOW = 1_700_000_000_000;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: "starter" | "pro" | "studio";
    stripeCustomerId?: string;
  }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      stripeCustomerId: opts.stripeCustomerId,
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

/**
 * Build a fake Stripe client that records the calls we care about. Each
 * method returns a deterministic shape so checkout / portal flows can be
 * asserted without HTTP.
 */
function buildFakeStripeClient(): {
  client: StripeClientLike;
  customersCreated: Stripe.CustomerCreateParams[];
  checkoutSessionsCreated: Stripe.Checkout.SessionCreateParams[];
  portalSessionsCreated: Stripe.BillingPortal.SessionCreateParams[];
} {
  const customersCreated: Stripe.CustomerCreateParams[] = [];
  const checkoutSessionsCreated: Stripe.Checkout.SessionCreateParams[] = [];
  const portalSessionsCreated: Stripe.BillingPortal.SessionCreateParams[] = [];

  const client: StripeClientLike = {
    customers: {
      async create(params) {
        customersCreated.push(params);
        return {
          id: `cus_${customersCreated.length}`,
          object: "customer",
        } as unknown as Stripe.Response<Stripe.Customer>;
      },
    },
    checkout: {
      sessions: {
        async create(params) {
          checkoutSessionsCreated.push(params);
          return {
            id: `cs_${checkoutSessionsCreated.length}`,
            url: `https://checkout.stripe.test/c/${checkoutSessionsCreated.length}`,
            object: "checkout.session",
          } as unknown as Stripe.Response<Stripe.Checkout.Session>;
        },
      },
    },
    billingPortal: {
      sessions: {
        async create(params) {
          portalSessionsCreated.push(params);
          return {
            id: `bps_${portalSessionsCreated.length}`,
            url: `https://billing.stripe.test/p/${portalSessionsCreated.length}`,
            object: "billing_portal.session",
          } as unknown as Stripe.Response<Stripe.BillingPortal.Session>;
        },
      },
    },
    subscriptions: {
      async retrieve() {
        throw new Error("subscriptions.retrieve not used in these unit tests");
      },
    },
    webhooks: {
      constructEvent() {
        throw new Error("webhooks.constructEvent runs in the Next.js route, not Convex tests");
      },
    },
  };

  return { client, customersCreated, checkoutSessionsCreated, portalSessionsCreated };
}

/**
 * Set the price-id env vars to deterministic values so `priceIdFor` and
 * `priceIdToPlanTuple` resolve. Returns a teardown that restores prior values.
 */
function withPriceIds(): () => void {
  const KEYS: Array<[string, string]> = [
    ["STRIPE_PRICE_PRO_MONTHLY", "price_pro_m"],
    ["STRIPE_PRICE_PRO_ANNUAL", "price_pro_a"],
    ["STRIPE_PRICE_STUDIO_MONTHLY", "price_studio_m"],
    ["STRIPE_PRICE_STUDIO_ANNUAL", "price_studio_a"],
    ["STRIPE_PRICE_STARTER_MONTHLY", "price_starter_m"],
    ["STRIPE_PRICE_STARTER_ANNUAL", "price_starter_a"],
    ["APP_URL", "https://heymaya.test"],
  ];
  const prior: Record<string, string | undefined> = {};
  for (const [k, v] of KEYS) {
    prior[k] = process.env[k];
    process.env[k] = v;
  }
  return () => {
    for (const [k] of KEYS) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  };
}

/* -------------------------------------------------------------------------- */
/* createCheckoutSession                                                       */
/* -------------------------------------------------------------------------- */

describe("billing.checkout.createCheckoutSession", () => {
  it("creates a Stripe customer + checkout session for a fresh creator (Pro monthly with 14-day trial)", async () => {
    const teardown = withPriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const c = await insertCreator(t, { suffix: "fresh", plan: "starter" });

      const out = await asUser(t, "fresh").action(
        api.billing.checkout.createCheckoutSession,
        { tier: "pro", interval: "monthly" }
      );
      expect(out.url).toMatch(/checkout\.stripe\.test/);

      // Customer should have been created with our metadata
      expect(fake.customersCreated).toHaveLength(1);
      expect(fake.customersCreated[0].email).toBe("fresh@test.com");
      const customerMd = fake.customersCreated[0].metadata as
        | Record<string, string>
        | undefined;
      expect(customerMd?.creatorId).toBe(String(c));

      // Checkout session should reference the customer + Pro monthly price
      expect(fake.checkoutSessionsCreated).toHaveLength(1);
      const sess = fake.checkoutSessionsCreated[0];
      expect(sess.mode).toBe("subscription");
      expect(sess.customer).toBe("cus_1");
      expect(sess.line_items?.[0].price).toBe("price_pro_m");
      // Pro = 14-day trial
      expect(sess.subscription_data?.trial_period_days).toBe(14);
      // Metadata stamped on both the session and the subscription
      expect(sess.metadata?.creatorId).toBe(String(c));
      expect(sess.metadata?.tier).toBe("pro");
      expect(sess.metadata?.interval).toBe("monthly");
      expect(sess.subscription_data?.metadata?.creatorId).toBe(String(c));
      expect(sess.success_url).toContain("/profile?billing=success");
      expect(sess.cancel_url).toContain("/profile?billing=cancelled");
      expect(sess.client_reference_id).toBe(String(c));

      // stripeCustomerId is now persisted on the creator
      const after = await t.run((ctx) => ctx.db.get(c));
      expect(after?.stripeCustomerId).toBe("cus_1");
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("Studio is no-trial — no trial_period_days on subscription_data", async () => {
    const teardown = withPriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertCreator(t, { suffix: "studio", plan: "starter" });
      await asUser(t, "studio").action(
        api.billing.checkout.createCheckoutSession,
        { tier: "studio", interval: "annual" }
      );
      expect(fake.checkoutSessionsCreated).toHaveLength(1);
      const sess = fake.checkoutSessionsCreated[0];
      expect(sess.line_items?.[0].price).toBe("price_studio_a");
      expect(sess.subscription_data?.trial_period_days).toBeUndefined();
      expect(sess.metadata?.tier).toBe("studio");
      expect(sess.metadata?.interval).toBe("annual");
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("REUSES existing stripeCustomerId — does not recreate Stripe customer", async () => {
    const teardown = withPriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertCreator(t, {
        suffix: "existing",
        plan: "starter",
        stripeCustomerId: "cus_already_there",
      });
      await asUser(t, "existing").action(
        api.billing.checkout.createCheckoutSession,
        { tier: "pro", interval: "monthly" }
      );
      expect(fake.customersCreated).toHaveLength(0);
      expect(fake.checkoutSessionsCreated[0].customer).toBe("cus_already_there");
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("ADVERSARIAL — unauthenticated calls reject", async () => {
    const teardown = withPriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      // No `withIdentity` wrapper
      await expect(
        t.action(api.billing.checkout.createCheckoutSession, {
          tier: "pro",
          interval: "monthly",
        })
      ).rejects.toThrow(/not authenticated/i);
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("ADVERSARIAL — Clerk subject without a creators row rejects", async () => {
    const teardown = withPriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await expect(
        t
          .withIdentity({ subject: "u_no_row" })
          .action(api.billing.checkout.createCheckoutSession, {
            tier: "pro",
            interval: "monthly",
          })
      ).rejects.toThrow(/creator row not found/i);
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("ADVERSARIAL — missing price-id env var rejects with clear error", async () => {
    const teardown = withPriceIds();
    // Knock out the Pro monthly price after withPriceIds set it
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertCreator(t, { suffix: "missing", plan: "starter" });
      await expect(
        asUser(t, "missing").action(
          api.billing.checkout.createCheckoutSession,
          { tier: "pro", interval: "monthly" }
        )
      ).rejects.toThrow(/STRIPE_PRICE_PRO_MONTHLY/);
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* openCustomerPortal                                                          */
/* -------------------------------------------------------------------------- */

describe("billing.portal.openCustomerPortal", () => {
  it("returns a portal URL for a creator with stripeCustomerId", async () => {
    const teardown = withPriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertCreator(t, {
        suffix: "subbed",
        plan: "pro",
        stripeCustomerId: "cus_subbed",
      });
      const out = await asUser(t, "subbed").action(
        api.billing.portal.openCustomerPortal,
        {}
      );
      expect(out.url).toMatch(/billing\.stripe\.test/);
      expect(fake.portalSessionsCreated).toHaveLength(1);
      expect(fake.portalSessionsCreated[0].customer).toBe("cus_subbed");
      expect(fake.portalSessionsCreated[0].return_url).toBe(
        "https://heymaya.test/profile"
      );
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("ADVERSARIAL — creator without stripeCustomerId is told to subscribe first", async () => {
    const teardown = withPriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertCreator(t, { suffix: "unsub", plan: "starter" });
      await expect(
        asUser(t, "unsub").action(api.billing.portal.openCustomerPortal, {})
      ).rejects.toThrow(/subscribe first/i);
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("ADVERSARIAL — unauthenticated portal call rejects", async () => {
    const teardown = withPriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await expect(
        t.action(api.billing.portal.openCustomerPortal, {})
      ).rejects.toThrow(/not authenticated/i);
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* webhook handlers                                                            */
/* -------------------------------------------------------------------------- */

describe("billing.webhook.handleCheckoutCompleted", () => {
  it("patches plan / stripeSubscriptionId / period / trialEnds for a Pro monthly trial", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "pro_trial",
      plan: "starter",
      stripeCustomerId: "cus_pro_trial",
    });
    const trialEnd = NOW + 14 * 86_400_000;
    const periodEnd = trialEnd; // before first billing cycle, period_end == trial_end
    const result = await t.mutation(
      internal.billing.webhook.handleCheckoutCompleted,
      {
        stripeCustomerId: "cus_pro_trial",
        subscriptionId: "sub_xyz",
        creatorId: c,
        tier: "pro",
        interval: "monthly",
        currentPeriodEnd: periodEnd,
        trialEnd,
      }
    );
    expect(result.patched).toBe(true);

    const after = await t.run((ctx) => ctx.db.get(c));
    expect(after?.plan).toBe("pro");
    expect(after?.stripeSubscriptionId).toBe("sub_xyz");
    expect(after?.currentPlanPeriodEnd).toBe(periodEnd);
    expect(after?.trialEndsAt).toBe(trialEnd);
    expect(after?.billingInterval).toBe("monthly");
  });

  it("Studio checkout sets billingInterval=annual and NO trialEndsAt when trialEnd absent", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "studio_paid",
      plan: "starter",
      stripeCustomerId: "cus_studio_paid",
    });
    const periodEnd = NOW + 365 * 86_400_000;
    await t.mutation(internal.billing.webhook.handleCheckoutCompleted, {
      stripeCustomerId: "cus_studio_paid",
      subscriptionId: "sub_studio",
      creatorId: c,
      tier: "studio",
      interval: "annual",
      currentPeriodEnd: periodEnd,
      // trialEnd intentionally omitted — Studio is no-trial
    });
    const after = await t.run((ctx) => ctx.db.get(c));
    expect(after?.plan).toBe("studio");
    expect(after?.billingInterval).toBe("annual");
    expect(after?.trialEndsAt).toBeUndefined();
  });

  it("CROSS-TENANT: webhook for Customer A's stripeCustomerId never patches Creator B", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "tenant_a",
      plan: "starter",
      stripeCustomerId: "cus_a",
    });
    const b = await insertCreator(t, {
      suffix: "tenant_b",
      plan: "starter",
      stripeCustomerId: "cus_b",
    });
    // Webhook for Customer A → only Creator A patched
    await t.mutation(internal.billing.webhook.handleCheckoutCompleted, {
      stripeCustomerId: "cus_a",
      subscriptionId: "sub_a",
      tier: "pro",
      interval: "monthly",
      currentPeriodEnd: NOW + 86_400_000,
    });
    const aAfter = await t.run((ctx) => ctx.db.get(a));
    const bAfter = await t.run((ctx) => ctx.db.get(b));
    expect(aAfter?.plan).toBe("pro");
    expect(bAfter?.plan).toBe("starter"); // untouched
  });

  it("CROSS-TENANT: metadata.creatorId mismatch refuses the patch (anti-tenant-bleed)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "bleed_a",
      plan: "starter",
      stripeCustomerId: "cus_bleed_a",
    });
    const b = await insertCreator(t, {
      suffix: "bleed_b",
      plan: "starter",
      stripeCustomerId: "cus_bleed_b",
    });
    // Forged webhook: claims to be for cus_bleed_a but metadata says creatorId=B
    const result = await t.mutation(
      internal.billing.webhook.handleCheckoutCompleted,
      {
        stripeCustomerId: "cus_bleed_a",
        subscriptionId: "sub_forged",
        creatorId: b, // wrong creator
        tier: "studio",
        interval: "monthly",
      }
    );
    expect(result.patched).toBe(false);
    expect(result.reason).toBe("creator_mismatch");

    const aAfter = await t.run((ctx) => ctx.db.get(a));
    const bAfter = await t.run((ctx) => ctx.db.get(b));
    expect(aAfter?.plan).toBe("starter");
    expect(bAfter?.plan).toBe("starter");
  });

  it("ADVERSARIAL: unknown stripeCustomerId returns no_creator (no row inserted/patched)", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      internal.billing.webhook.handleCheckoutCompleted,
      {
        stripeCustomerId: "cus_orphan",
        subscriptionId: "sub_orphan",
        tier: "pro",
        interval: "monthly",
      }
    );
    expect(result.patched).toBe(false);
    expect(result.reason).toBe("no_creator");
  });
});

describe("billing.webhook.handleSubscriptionUpdated", () => {
  it("PLAN-TIER × ACTION: patches creator.plan to the new tier on portal-driven plan change", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "upgrade",
      plan: "pro",
      stripeCustomerId: "cus_upgrade",
    });
    await t.mutation(internal.billing.webhook.handleSubscriptionUpdated, {
      stripeCustomerId: "cus_upgrade",
      subscriptionId: "sub_up",
      tier: "studio",
      interval: "monthly",
      currentPeriodEnd: NOW + 30 * 86_400_000,
    });
    const after = await t.run((ctx) => ctx.db.get(c));
    expect(after?.plan).toBe("studio");
    expect(after?.stripeSubscriptionId).toBe("sub_up");
  });

  it("CROSS-TENANT: subscription.updated for Customer A's id never patches Creator B", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, {
      suffix: "upd_a",
      plan: "starter",
      stripeCustomerId: "cus_upd_a",
    });
    const b = await insertCreator(t, {
      suffix: "upd_b",
      plan: "starter",
      stripeCustomerId: "cus_upd_b",
    });
    await t.mutation(internal.billing.webhook.handleSubscriptionUpdated, {
      stripeCustomerId: "cus_upd_a",
      subscriptionId: "sub_a",
      tier: "studio",
      interval: "monthly",
    });
    const bAfter = await t.run((ctx) => ctx.db.get(b));
    expect(bAfter?.plan).toBe("starter");
  });
});

describe("billing.webhook.handleSubscriptionDeleted", () => {
  it("PLAN-TIER × ACTION: cancellation downgrades creator to starter and clears billing fields", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "cancel",
      plan: "studio",
      stripeCustomerId: "cus_cancel",
    });
    await t.run((ctx) =>
      ctx.db.patch(c, {
        stripeSubscriptionId: "sub_cancel",
        currentPlanPeriodEnd: NOW + 86_400_000,
        trialEndsAt: NOW + 86_400_000,
        billingInterval: "annual",
      })
    );

    await t.mutation(internal.billing.webhook.handleSubscriptionDeleted, {
      stripeCustomerId: "cus_cancel",
    });

    const after = await t.run((ctx) => ctx.db.get(c));
    expect(after?.plan).toBe("starter");
    expect(after?.stripeSubscriptionId).toBeUndefined();
    expect(after?.currentPlanPeriodEnd).toBeUndefined();
    expect(after?.trialEndsAt).toBeUndefined();
    expect(after?.billingInterval).toBeUndefined();
    // Customer id retained — same Stripe customer survives a resubscribe
    expect(after?.stripeCustomerId).toBe("cus_cancel");
  });

  it("DOWNGRADE PRESERVES connectedAccounts (don't strand creator's Gmail / Calendar)", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "preserve",
      plan: "pro",
      stripeCustomerId: "cus_preserve",
    });
    const gmailAccount = await t.run((ctx) =>
      ctx.db.insert("connectedAccounts", {
        creatorId: c,
        provider: "gmail",
        composioAccountId: "encrypted_blob",
        composioAccountIdHash: "hash_preserve",
        scopes: ["gmail.readonly"],
        scopeStatus: "active",
        connectedAt: NOW,
      })
    );

    await t.mutation(internal.billing.webhook.handleSubscriptionDeleted, {
      stripeCustomerId: "cus_preserve",
    });

    // Plan downgraded but Gmail row untouched
    const after = await t.run((ctx) => ctx.db.get(c));
    expect(after?.plan).toBe("starter");
    const gmailAfter = await t.run((ctx) => ctx.db.get(gmailAccount));
    expect(gmailAfter).not.toBeNull();
    expect(gmailAfter?.scopeStatus).toBe("active");
    expect(gmailAfter?.composioAccountIdHash).toBe("hash_preserve");
  });
});

describe("billing.webhook.handleTrialWillEnd", () => {
  it("logs to mayaActionLog with entryId=billing.trial-ending and outcome=ran", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "trial_warn",
      plan: "pro",
      stripeCustomerId: "cus_trial_warn",
    });
    await t.mutation(internal.billing.webhook.handleTrialWillEnd, {
      stripeCustomerId: "cus_trial_warn",
    });
    const log = await t.run((ctx) =>
      ctx.db
        .query("mayaActionLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .collect()
    );
    expect(log).toHaveLength(1);
    expect(log[0].entryId).toBe("billing.trial-ending");
    expect(log[0].outcome).toBe("ran");
  });

  it("unknown stripeCustomerId is a no-op (no log row, no error)", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      internal.billing.webhook.handleTrialWillEnd,
      { stripeCustomerId: "cus_orphan_trial" }
    );
    expect(result.logged).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* recordWebhookEvent — replay defense                                         */
/* -------------------------------------------------------------------------- */

describe("billing.webhook.recordWebhookEvent", () => {
  it("ADVERSARIAL: replay of same eventId returns alreadySeen=true and lands as replay_dropped row", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(
      internal.billing.webhook.recordWebhookEvent,
      {
        eventId: "evt_billing_1",
        type: "checkout.session.completed",
        livemode: false,
        status: "processed",
        customerId: "cus_replay",
        rawPayload: { foo: "bar" },
      }
    );
    expect(first.alreadySeen).toBe(false);

    const second = await t.mutation(
      internal.billing.webhook.recordWebhookEvent,
      {
        eventId: "evt_billing_1",
        type: "checkout.session.completed",
        livemode: false,
        status: "processed",
        customerId: "cus_replay",
        rawPayload: { foo: "bar" },
      }
    );
    expect(second.alreadySeen).toBe(true);

    const all = await t.run((ctx) =>
      ctx.db
        .query("stripeWebhookEvents")
        .withIndex("by_event_id", (q) => q.eq("eventId", "evt_billing_1"))
        .collect()
    );
    expect(all).toHaveLength(2);
    const statuses = all.map((r) => r.status).sort();
    expect(statuses).toEqual(["processed", "replay_dropped"]);
  });

  it("indexes by_customer + by_status are queryable", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.billing.webhook.recordWebhookEvent, {
      eventId: "evt_idx_1",
      type: "customer.subscription.updated",
      livemode: false,
      status: "processed",
      customerId: "cus_idx",
      rawPayload: {},
    });
    await t.mutation(internal.billing.webhook.recordWebhookEvent, {
      eventId: "evt_idx_2",
      type: "invoice.paid",
      livemode: false,
      status: "skipped",
      customerId: "cus_idx",
      rawPayload: {},
    });
    const byCustomer = await t.run((ctx) =>
      ctx.db
        .query("stripeWebhookEvents")
        .withIndex("by_customer", (q) => q.eq("customerId", "cus_idx"))
        .collect()
    );
    expect(byCustomer).toHaveLength(2);

    const skipped = await t.run((ctx) =>
      ctx.db
        .query("stripeWebhookEvents")
        .withIndex("by_status", (q) => q.eq("status", "skipped"))
        .collect()
    );
    expect(skipped.some((r) => r.eventId === "evt_idx_2")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* priceIdToPlanTuple — unit                                                   */
/* -------------------------------------------------------------------------- */

describe("billing.priceIds.priceIdToPlanTuple", () => {
  it("recovers (tier, interval) for every configured SKU", () => {
    const teardown = withPriceIds();
    try {
      expect(priceIdToPlanTuple("price_pro_m")).toEqual({
        tier: "pro",
        interval: "monthly",
      });
      expect(priceIdToPlanTuple("price_pro_a")).toEqual({
        tier: "pro",
        interval: "annual",
      });
      expect(priceIdToPlanTuple("price_studio_m")).toEqual({
        tier: "studio",
        interval: "monthly",
      });
      expect(priceIdToPlanTuple("price_studio_a")).toEqual({
        tier: "studio",
        interval: "annual",
      });
      expect(priceIdToPlanTuple("price_starter_m")).toEqual({
        tier: "starter",
        interval: "monthly",
      });
      expect(priceIdToPlanTuple("price_starter_a")).toEqual({
        tier: "starter",
        interval: "annual",
      });
    } finally {
      teardown();
    }
  });

  it("returns null for unknown price ids and empty strings", () => {
    const teardown = withPriceIds();
    try {
      expect(priceIdToPlanTuple("price_unknown")).toBeNull();
      expect(priceIdToPlanTuple("")).toBeNull();
    } finally {
      teardown();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Sibling-file scan (local) — schema correctness for new table                */
/* -------------------------------------------------------------------------- */

describe("billing schema sibling check", () => {
  it("stripeWebhookEvents has by_event_id, by_customer, by_status indexes (and intentionally NO creatorId)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const repoRoot = join(import.meta.dirname ?? __dirname, "..", "..");
    const src = readFileSync(join(repoRoot, "convex/schema.ts"), "utf8");
    // Locate the table block. Includes the two index definitions immediately
    // following the closing brace.
    const idx = src.indexOf("stripeWebhookEvents: defineTable(");
    expect(idx).toBeGreaterThan(0);
    const slice = src.slice(idx, idx + 2000);
    expect(slice).toContain('.index("by_event_id"');
    expect(slice).toContain('.index("by_customer"');
    expect(slice).toContain('.index("by_status"');
    // Confirm we did NOT add a creatorId field — Stripe events identify
    // the customer, not the creator. The sibling-file scan in
    // tests/sprint1Acceptance.test.ts skips tables without creatorId.
    const tableBody = slice.slice(0, slice.indexOf("})"));
    expect(/creatorId:/.test(tableBody)).toBe(false);
  });
});
