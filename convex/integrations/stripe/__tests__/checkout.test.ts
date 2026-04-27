/**
 * Wave D Stripe service-product checkout tests.
 *
 * Five mandatory categories + Stripe-specific:
 *   1. Cross-tenant: signed-in operator A can't checkout against operator B's
 *      business. Tested via Clerk subject mismatch.
 *   2. Plan-tier × billing matrix: every (tier, interval) pair routes to its
 *      env-var-mapped price id. Pro adds metered voice item; Studio adds
 *      metered voice item; Starter does not.
 *   3. Adversarial: unauthenticated rejects; missing price-id env var rejects;
 *      creator-side account hitting service-side checkout rejects.
 *   4. Sibling-file scan: enforced repo-wide.
 *   5. TODO grep: covered repo-wide.
 *   6. Stripe-specific — 14-day Pro trial gating: enabled on FIRST Pro
 *      checkout only; absent on second-time checkout if a prior subscription
 *      id exists; absent on Studio in all cases.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import {
  _setStripeClientForTests,
  type StripeClientLike,
} from "../../../billing/stripeClient";
import type Stripe from "stripe";

const NOW = 1_700_000_000_000;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

async function insertServiceBusiness(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    planTier?: "starter" | "pro" | "studio";
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  }
): Promise<{ accountId: Id<"creators">; businessId: Id<"businesses"> }> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@biz.test`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "starter", // creator-side default — irrelevant to service flow
      accountType: "service-business",
      createdAt: NOW,
    });
    const businessId = await ctx.db.insert("businesses", {
      accountId,
      name: `${opts.suffix} Co.`,
      serviceTypes: ["hvac"],
      planTier: opts.planTier,
      stripeCustomerId: opts.stripeCustomerId,
      stripeSubscriptionId: opts.stripeSubscriptionId,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.patch(accountId, { businessId });
    return { accountId, businessId };
  });
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

function buildFakeStripeClient(): {
  client: StripeClientLike;
  customersCreated: Stripe.CustomerCreateParams[];
  checkoutSessionsCreated: Stripe.Checkout.SessionCreateParams[];
} {
  const customersCreated: Stripe.CustomerCreateParams[] = [];
  const checkoutSessionsCreated: Stripe.Checkout.SessionCreateParams[] = [];
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
            url: `https://checkout.stripe.test/svc/${checkoutSessionsCreated.length}`,
            object: "checkout.session",
          } as unknown as Stripe.Response<Stripe.Checkout.Session>;
        },
      },
    },
    billingPortal: {
      sessions: {
        async create() {
          throw new Error("portal not used in checkout tests");
        },
      },
    },
    subscriptions: {
      async retrieve() {
        throw new Error("subscriptions.retrieve not used in checkout tests");
      },
    },
    webhooks: {
      constructEvent() {
        throw new Error("webhook signature not exercised in unit tests");
      },
    },
    billing: {
      meterEvents: {
        async create() {
          throw new Error("meterEvents not used in checkout tests");
        },
      },
    },
  };
  return { client, customersCreated, checkoutSessionsCreated };
}

function withServicePriceIds(): () => void {
  const KEYS: Array<[string, string]> = [
    ["STRIPE_SERVICE_PRICE_STARTER_MONTHLY", "price_svc_starter_m"],
    ["STRIPE_SERVICE_PRICE_STARTER_ANNUAL", "price_svc_starter_a"],
    ["STRIPE_SERVICE_PRICE_PRO_MONTHLY", "price_svc_pro_m"],
    ["STRIPE_SERVICE_PRICE_PRO_ANNUAL", "price_svc_pro_a"],
    ["STRIPE_SERVICE_PRICE_STUDIO_MONTHLY", "price_svc_studio_m"],
    ["STRIPE_SERVICE_PRICE_STUDIO_ANNUAL", "price_svc_studio_a"],
    ["STRIPE_SERVICE_PRICE_VOICE_OVERAGE_PRO", "price_svc_voice_pro"],
    ["STRIPE_SERVICE_PRICE_VOICE_OVERAGE_STUDIO", "price_svc_voice_studio"],
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
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("integrations.stripe.checkout.createServiceCheckoutSession", () => {
  it("creates a Stripe customer + 14-day Pro trial on FIRST Pro checkout", async () => {
    const teardown = withServicePriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const { businessId, accountId } = await insertServiceBusiness(t, {
        suffix: "pro_first",
      });

      const out = await asUser(t, "pro_first").action(
        api.integrations.stripe.checkout.createServiceCheckoutSession,
        { tier: "pro", interval: "monthly" }
      );
      expect(out.url).toMatch(/checkout\.stripe\.test\/svc/);
      expect(fake.customersCreated).toHaveLength(1);
      expect(fake.customersCreated[0].email).toBe("pro_first@biz.test");
      const customerMd = fake.customersCreated[0].metadata as
        | Record<string, string>
        | undefined;
      expect(customerMd?.businessId).toBe(String(businessId));
      expect(customerMd?.heymaya_product).toBe("service");

      expect(fake.checkoutSessionsCreated).toHaveLength(1);
      const sess = fake.checkoutSessionsCreated[0];
      expect(sess.mode).toBe("subscription");
      expect(sess.customer).toBe("cus_1");
      expect(sess.line_items?.[0].price).toBe("price_svc_pro_m");
      // Pro has metered voice attached as a 2nd line item
      expect(sess.line_items?.[1]?.price).toBe("price_svc_voice_pro");
      expect(sess.subscription_data?.trial_period_days).toBe(14);
      expect(sess.metadata?.tier).toBe("pro");
      expect(sess.metadata?.interval).toBe("monthly");
      expect(sess.metadata?.heymaya_product).toBe("service");
      expect(sess.metadata?.businessId).toBe(String(businessId));
      expect(sess.metadata?.accountId).toBe(String(accountId));

      const after = await t.run((ctx) => ctx.db.get(businessId));
      expect(after?.stripeCustomerId).toBe("cus_1");
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("Pro re-checkout (existing subscription) does NOT enable trial", async () => {
    const teardown = withServicePriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertServiceBusiness(t, {
        suffix: "pro_repeat",
        stripeCustomerId: "cus_existing",
        stripeSubscriptionId: "sub_prev",
      });
      await asUser(t, "pro_repeat").action(
        api.integrations.stripe.checkout.createServiceCheckoutSession,
        { tier: "pro", interval: "monthly" }
      );
      expect(fake.customersCreated).toHaveLength(0); // reuses existing
      const sess = fake.checkoutSessionsCreated[0];
      expect(sess.subscription_data?.trial_period_days).toBeUndefined();
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("Studio adds metered voice line item but NO trial", async () => {
    const teardown = withServicePriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertServiceBusiness(t, { suffix: "studio_first" });
      await asUser(t, "studio_first").action(
        api.integrations.stripe.checkout.createServiceCheckoutSession,
        { tier: "studio", interval: "annual" }
      );
      const sess = fake.checkoutSessionsCreated[0];
      expect(sess.line_items?.[0].price).toBe("price_svc_studio_a");
      expect(sess.line_items?.[1]?.price).toBe("price_svc_voice_studio");
      expect(sess.subscription_data?.trial_period_days).toBeUndefined();
      expect(sess.metadata?.tier).toBe("studio");
      expect(sess.metadata?.interval).toBe("annual");
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("Starter has NO metered voice line item and NO trial", async () => {
    const teardown = withServicePriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertServiceBusiness(t, { suffix: "starter_first" });
      await asUser(t, "starter_first").action(
        api.integrations.stripe.checkout.createServiceCheckoutSession,
        { tier: "starter", interval: "monthly" }
      );
      const sess = fake.checkoutSessionsCreated[0];
      expect(sess.line_items).toHaveLength(1);
      expect(sess.line_items?.[0].price).toBe("price_svc_starter_m");
      expect(sess.subscription_data?.trial_period_days).toBeUndefined();
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("annual Pro is also trial-enabled on first checkout", async () => {
    const teardown = withServicePriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertServiceBusiness(t, { suffix: "pro_annual" });
      await asUser(t, "pro_annual").action(
        api.integrations.stripe.checkout.createServiceCheckoutSession,
        { tier: "pro", interval: "annual" }
      );
      const sess = fake.checkoutSessionsCreated[0];
      expect(sess.line_items?.[0].price).toBe("price_svc_pro_a");
      expect(sess.subscription_data?.trial_period_days).toBe(14);
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("ADVERSARIAL — unauthenticated rejects", async () => {
    const teardown = withServicePriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await expect(
        t.action(
          api.integrations.stripe.checkout.createServiceCheckoutSession,
          { tier: "pro", interval: "monthly" }
        )
      ).rejects.toThrow(/not authenticated/i);
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("ADVERSARIAL — creator-side account (accountType=creator) rejects", async () => {
    const teardown = withServicePriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await t.run((ctx) =>
        ctx.db.insert("creators", {
          clerkUserId: "u_creator",
          email: "creator@x.test",
          channelPreference: "web",
          timezone: "UTC",
          status: "active",
          plan: "pro",
          accountType: "creator", // <-- not service-business
          createdAt: NOW,
        })
      );
      await expect(
        t
          .withIdentity({ subject: "u_creator" })
          .action(
            api.integrations.stripe.checkout.createServiceCheckoutSession,
            { tier: "pro", interval: "monthly" }
          )
      ).rejects.toThrow(/business row not found/i);
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("ADVERSARIAL — missing price-id env var rejects with clear error", async () => {
    const teardown = withServicePriceIds();
    delete process.env.STRIPE_SERVICE_PRICE_PRO_MONTHLY;
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertServiceBusiness(t, { suffix: "missing" });
      await expect(
        asUser(t, "missing").action(
          api.integrations.stripe.checkout.createServiceCheckoutSession,
          { tier: "pro", interval: "monthly" }
        )
      ).rejects.toThrow(/STRIPE_SERVICE_PRICE_PRO_MONTHLY/);
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("CROSS-TENANT — operator A authenticated as B can't override B's businessId", async () => {
    // The frontend can only pass (tier, interval). businessId is resolved
    // server-side from the Clerk subject. The strongest cross-tenant
    // assertion we can make at the action surface is: signing in as A
    // produces metadata.businessId === A's business id, NOT B's — even
    // when B has an existing customer.
    const teardown = withServicePriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const { businessId: bizA } = await insertServiceBusiness(t, {
        suffix: "tenant_a",
      });
      await insertServiceBusiness(t, {
        suffix: "tenant_b",
        stripeCustomerId: "cus_b",
      });
      await asUser(t, "tenant_a").action(
        api.integrations.stripe.checkout.createServiceCheckoutSession,
        { tier: "pro", interval: "monthly" }
      );
      // Customer must have been freshly created for A, NOT reused from B
      expect(fake.customersCreated).toHaveLength(1);
      const customerMd = fake.customersCreated[0].metadata as
        | Record<string, string>
        | undefined;
      expect(customerMd?.businessId).toBe(String(bizA));
      expect(fake.checkoutSessionsCreated[0].customer).toBe("cus_1");
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });
});
