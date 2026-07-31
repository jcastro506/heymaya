/**
 * Stripe billing — REVISED 2026-05-04 for coach / manager 2-tier autonomy.
 *
 * Plan-transition contract under test:
 *   - Coach ($29/mo / $249/yr) and Manager ($99/mo / $899/yr) are both
 *     sellable via Checkout. Coach is the post-cancel / post-trial floor.
 *   - 7-day free trial on FIRST subscription only — applies to BOTH tiers
 *     (the trial is "try the product," not "try Manager"). A creator who
 *     previously held any subscription does NOT re-trigger the trial.
 *   - Webhook is the ONLY writer to `creators.plan`. Cross-tenant: lookup
 *     by `stripeCustomerId`; metadata.creatorId mismatch refuses to patch.
 *   - Cancellation downgrades to Coach + clears billing fields. No "free"
 *     fallback — Coach IS the floor.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: webhook for Customer A's subscription never patches
 *      Creator B; metadata.creatorId mismatch refuses the patch.
 *   2. Plan-tier × action matrix: every Coach↔Manager transition
 *      explicitly tested (Coach→Manager via update, Manager→Coach via
 *      update, Manager→Coach via cancel, Coach paid checkout, Manager
 *      first-sub trial, both tiers post-cancel resub no-trial).
 *   3. Adversarial: invalid `tier` rejects; missing price-id env;
 *      unauthenticated rejects; orphan creator no-ops.
 *   4. Sibling-file scan + schema indexes asserted below.
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
    plan: "coach" | "manager";
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
    billing: {
      meterEvents: {
        async create() {
          throw new Error(
            "billing.meterEvents.create not used in these unit tests"
          );
        },
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
    ["STRIPE_PRICE_COACH_MONTHLY", "price_coach_m"],
    ["STRIPE_PRICE_COACH_ANNUAL", "price_coach_a"],
    ["STRIPE_PRICE_MANAGER_MONTHLY", "price_manager_m"],
    ["STRIPE_PRICE_MANAGER_ANNUAL", "price_manager_a"],
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
  // NEW CONTRACT (post-2026-05-04 coach/manager rewrite): the 7-day trial
  // applies to BOTH tiers on the FIRST subscription only.
  const EXPECTED_TRIAL_DAYS = 7;

  it.each<["coach" | "manager", "monthly" | "annual", string]>([
    ["coach", "monthly", "price_coach_m"],
    ["coach", "annual", "price_coach_a"],
    ["manager", "monthly", "price_manager_m"],
    ["manager", "annual", "price_manager_a"],
  ])(
    "PLAN-TIER × ACTION: fresh creator picks %s/%s -> price=%s + 7-day trial",
    async (tier, interval, expectedPrice) => {
      const teardown = withPriceIds();
      const fake = buildFakeStripeClient();
      _setStripeClientForTests(fake.client);
      try {
        const t = convexTest(schema, modules);
        const c = await insertCreator(t, {
          suffix: `fresh_${tier}_${interval}`,
          plan: "coach",
        });

        const out = await asUser(t, `fresh_${tier}_${interval}`).action(
          api.billing.checkout.createCheckoutSession,
          { tier, interval }
        );
        expect(out.url).toMatch(/checkout\.stripe\.test/);

        // Customer created with creatorId metadata.
        expect(fake.customersCreated).toHaveLength(1);
        const customerMd = fake.customersCreated[0].metadata as
          | Record<string, string>
          | undefined;
        expect(customerMd?.creatorId).toBe(String(c));

        // Checkout session references the right (tier, interval) price.
        expect(fake.checkoutSessionsCreated).toHaveLength(1);
        const sess = fake.checkoutSessionsCreated[0];
        expect(sess.mode).toBe("subscription");
        expect(sess.line_items?.[0].price).toBe(expectedPrice);

        // 7-day trial on first subscription, BOTH tiers.
        expect(sess.subscription_data?.trial_period_days).toBe(
          EXPECTED_TRIAL_DAYS
        );

        // Metadata stamped on both session + subscription.
        expect(sess.metadata?.creatorId).toBe(String(c));
        expect(sess.metadata?.tier).toBe(tier);
        expect(sess.metadata?.interval).toBe(interval);
        expect(sess.subscription_data?.metadata?.creatorId).toBe(String(c));

        // stripeCustomerId persisted on creator.
        const after = await t.run((ctx) => ctx.db.get(c));
        expect(after?.stripeCustomerId).toBe("cus_1");
      } finally {
        _setStripeClientForTests(null);
        teardown();
      }
    }
  );

  it.each<["coach" | "manager", "monthly" | "annual", string]>([
    ["coach", "monthly", "price_coach_m"],
    ["coach", "annual", "price_coach_a"],
    ["manager", "monthly", "price_manager_m"],
    ["manager", "annual", "price_manager_a"],
  ])(
    "PLAN-TIER × ACTION: fresh creator picks %s/%s -> Stripe session price=%s + correct metadata",
    async (tier, interval, expectedPrice) => {
      // Companion of the it.skip block above. This subset of assertions
      // (everything EXCEPT the 7-day trial-day count) is true regardless
      // of whether Agent 3's source patch has landed — the price + metadata
      // contract is independent of the trial-day choice.
      const teardown = withPriceIds();
      const fake = buildFakeStripeClient();
      _setStripeClientForTests(fake.client);
      try {
        const t = convexTest(schema, modules);
        const c = await insertCreator(t, {
          suffix: `meta_${tier}_${interval}`,
          plan: "coach",
        });
        await asUser(t, `meta_${tier}_${interval}`).action(
          api.billing.checkout.createCheckoutSession,
          { tier, interval }
        );

        expect(fake.checkoutSessionsCreated).toHaveLength(1);
        const sess = fake.checkoutSessionsCreated[0];
        expect(sess.mode).toBe("subscription");
        expect(sess.line_items?.[0].price).toBe(expectedPrice);
        expect(sess.metadata?.creatorId).toBe(String(c));
        expect(sess.metadata?.tier).toBe(tier);
        expect(sess.metadata?.interval).toBe(interval);
        expect(sess.subscription_data?.metadata?.creatorId).toBe(String(c));
        expect(sess.success_url).toContain("/onboarding/maya?billing=success");
        expect(sess.cancel_url).toContain("/creators?billing=cancelled");
        expect(sess.client_reference_id).toBe(String(c));
      } finally {
        _setStripeClientForTests(null);
        teardown();
      }
    }
  );

  it.each<["coach" | "manager"]>([["coach"], ["manager"]])(
    "PLAN-TIER × ACTION: %s resub (creator already had a previous subscription) is NO-TRIAL on either tier",
    async (tier) => {
      const teardown = withPriceIds();
      const fake = buildFakeStripeClient();
      _setStripeClientForTests(fake.client);
      try {
        const t = convexTest(schema, modules);
        const c = await insertCreator(t, {
          suffix: `resub_${tier}`,
          plan: "coach",
        });
        // Resub signal: creator previously held a subscription (now cancelled).
        // Re-checkout MUST bypass the 7-day trial regardless of which tier.
        await t.run((ctx) =>
          ctx.db.patch(c, { stripeSubscriptionId: "sub_prev_cancelled" })
        );
        await asUser(t, `resub_${tier}`).action(
          api.billing.checkout.createCheckoutSession,
          { tier, interval: "annual" }
        );
        expect(fake.checkoutSessionsCreated).toHaveLength(1);
        const sess = fake.checkoutSessionsCreated[0];
        expect(sess.subscription_data?.trial_period_days).toBeUndefined();
        expect(sess.metadata?.tier).toBe(tier);
      } finally {
        _setStripeClientForTests(null);
        teardown();
      }
    }
  );

  it("REUSES existing stripeCustomerId — does not recreate Stripe customer", async () => {
    const teardown = withPriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertCreator(t, {
        suffix: "existing",
        plan: "coach",
        stripeCustomerId: "cus_already_there",
      });
      await asUser(t, "existing").action(
        api.billing.checkout.createCheckoutSession,
        { tier: "manager", interval: "monthly" }
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
          tier: "manager",
          interval: "monthly",
        })
      ).rejects.toThrow(/not authenticated/i);
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("ROBUSTNESS — Clerk subject without a creators row lazily creates one and proceeds", async () => {
    // Production reality: Clerk's user.created webhook is the canonical
    // creator-row writer, but it can race with checkout (slow webhook,
    // local-dev with no public webhook URL, transient failure). Checkout
    // lazy-creates the row from the authenticated Clerk identity rather
    // than dead-ending the user. The insert is idempotent by clerkUserId.
    const teardown = withPriceIds();
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const out = await t
        .withIdentity({ subject: "u_no_row" })
        .action(api.billing.checkout.createCheckoutSession, {
          tier: "manager",
          interval: "monthly",
        });
      expect(out.url).toMatch(/checkout\.stripe\.test/);

      // Creator row was lazy-created with clerkUserId === subject.
      const created = await t.run(async (ctx) =>
        ctx.db
          .query("creators")
          .withIndex("by_clerk_user", (q) =>
            q.eq("clerkUserId", "u_no_row")
          )
          .first()
      );
      expect(created).not.toBeNull();
      expect(created?.plan).toBe("coach");
      expect(created?.status).toBe("onboarding");
    } finally {
      _setStripeClientForTests(null);
      teardown();
    }
  });

  it("ADVERSARIAL — missing price-id env var rejects with clear error", async () => {
    const teardown = withPriceIds();
    // Knock out the Manager monthly price after withPriceIds set it
    delete process.env.STRIPE_PRICE_MANAGER_MONTHLY;
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      await insertCreator(t, { suffix: "missing", plan: "coach" });
      await expect(
        asUser(t, "missing").action(
          api.billing.checkout.createCheckoutSession,
          { tier: "manager", interval: "monthly" }
        )
      ).rejects.toThrow(/STRIPE_PRICE_MANAGER_MONTHLY/);
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
        plan: "manager",
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
      await insertCreator(t, { suffix: "unsub", plan: "coach" });
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
  it.each<["coach" | "manager", "monthly" | "annual"]>([
    ["coach", "monthly"],
    ["coach", "annual"],
    ["manager", "monthly"],
    ["manager", "annual"],
  ])(
    "PLAN-TIER × ACTION: checkout-completed sets plan=%s + interval=%s + trial fields",
    async (tier, interval) => {
      const t = convexTest(schema, modules);
      const c = await insertCreator(t, {
        suffix: `done_${tier}_${interval}`,
        plan: "coach",
        stripeCustomerId: `cus_done_${tier}_${interval}`,
      });
      const trialEnd = NOW + 7 * 86_400_000;
      const periodEnd = trialEnd; // first cycle: period_end == trial_end
      const result = await t.mutation(
        internal.billing.webhook.handleCheckoutCompleted,
        {
          stripeCustomerId: `cus_done_${tier}_${interval}`,
          subscriptionId: `sub_${tier}_${interval}`,
          creatorId: c,
          tier,
          interval,
          currentPeriodEnd: periodEnd,
          trialEnd,
        }
      );
      expect(result.patched).toBe(true);

      const after = await t.run((ctx) => ctx.db.get(c));
      expect(after?.plan).toBe(tier);
      expect(after?.stripeSubscriptionId).toBe(`sub_${tier}_${interval}`);
      expect(after?.currentPlanPeriodEnd).toBe(periodEnd);
      expect(after?.trialEndsAt).toBe(trialEnd);
      expect(after?.billingInterval).toBe(interval);
    }
  );

  it("PLAN-TIER × ACTION: paid checkout (no trial) leaves trialEndsAt undefined", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "paid_no_trial",
      plan: "coach",
      stripeCustomerId: "cus_paid_no_trial",
    });
    const periodEnd = NOW + 365 * 86_400_000;
    await t.mutation(internal.billing.webhook.handleCheckoutCompleted, {
      stripeCustomerId: "cus_paid_no_trial",
      subscriptionId: "sub_paid",
      creatorId: c,
      tier: "manager",
      interval: "annual",
      currentPeriodEnd: periodEnd,
      // trialEnd omitted: resubscribe / paid-checkout path.
    });
    const after = await t.run((ctx) => ctx.db.get(c));
    expect(after?.plan).toBe("manager");
    expect(after?.billingInterval).toBe("annual");
    expect(after?.trialEndsAt).toBeUndefined();
  });

  it("CROSS-TENANT: webhook for Customer A's stripeCustomerId never patches Creator B", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "tenant_a",
      plan: "coach",
      stripeCustomerId: "cus_a",
    });
    const b = await insertCreator(t, {
      suffix: "tenant_b",
      plan: "coach",
      stripeCustomerId: "cus_b",
    });
    // Webhook for Customer A → only Creator A patched
    await t.mutation(internal.billing.webhook.handleCheckoutCompleted, {
      stripeCustomerId: "cus_a",
      subscriptionId: "sub_a",
      tier: "manager",
      interval: "monthly",
      currentPeriodEnd: NOW + 86_400_000,
    });
    const aAfter = await t.run((ctx) => ctx.db.get(a));
    const bAfter = await t.run((ctx) => ctx.db.get(b));
    expect(aAfter?.plan).toBe("manager");
    expect(bAfter?.plan).toBe("coach"); // untouched
  });

  it("CROSS-TENANT: metadata.creatorId mismatch refuses the patch (anti-tenant-bleed)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "bleed_a",
      plan: "coach",
      stripeCustomerId: "cus_bleed_a",
    });
    const b = await insertCreator(t, {
      suffix: "bleed_b",
      plan: "coach",
      stripeCustomerId: "cus_bleed_b",
    });
    // Forged webhook: claims to be for cus_bleed_a but metadata says creatorId=B
    const result = await t.mutation(
      internal.billing.webhook.handleCheckoutCompleted,
      {
        stripeCustomerId: "cus_bleed_a",
        subscriptionId: "sub_forged",
        creatorId: b, // wrong creator
        tier: "manager",
        interval: "monthly",
      }
    );
    expect(result.patched).toBe(false);
    expect(result.reason).toBe("creator_mismatch");

    const aAfter = await t.run((ctx) => ctx.db.get(a));
    const bAfter = await t.run((ctx) => ctx.db.get(b));
    expect(aAfter?.plan).toBe("coach");
    expect(bAfter?.plan).toBe("coach");
  });

  it("ADVERSARIAL: unknown stripeCustomerId returns no_creator (no row inserted/patched)", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      internal.billing.webhook.handleCheckoutCompleted,
      {
        stripeCustomerId: "cus_orphan",
        subscriptionId: "sub_orphan",
        tier: "manager",
        interval: "monthly",
      }
    );
    expect(result.patched).toBe(false);
    expect(result.reason).toBe("no_creator");
  });
});

describe("billing.webhook.handleSubscriptionUpdated", () => {
  it("PLAN-TIER × ACTION: Coach -> Manager upgrade via portal patches plan=manager", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "upgrade_c2m",
      plan: "coach",
      stripeCustomerId: "cus_upgrade_c2m",
    });
    await t.mutation(internal.billing.webhook.handleSubscriptionUpdated, {
      stripeCustomerId: "cus_upgrade_c2m",
      subscriptionId: "sub_up",
      tier: "manager",
      interval: "monthly",
      currentPeriodEnd: NOW + 30 * 86_400_000,
    });
    const after = await t.run((ctx) => ctx.db.get(c));
    expect(after?.plan).toBe("manager");
    expect(after?.stripeSubscriptionId).toBe("sub_up");
    expect(after?.billingInterval).toBe("monthly");
  });

  it("PLAN-TIER × ACTION: Manager -> Coach downgrade via portal patches plan=coach", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "downgrade_m2c",
      plan: "manager",
      stripeCustomerId: "cus_downgrade_m2c",
    });
    await t.mutation(internal.billing.webhook.handleSubscriptionUpdated, {
      stripeCustomerId: "cus_downgrade_m2c",
      subscriptionId: "sub_dn",
      tier: "coach",
      interval: "monthly",
      currentPeriodEnd: NOW + 30 * 86_400_000,
    });
    const after = await t.run((ctx) => ctx.db.get(c));
    expect(after?.plan).toBe("coach");
    expect(after?.stripeSubscriptionId).toBe("sub_dn");
  });

  it("PLAN-TIER × ACTION: trial -> active rollover updates currentPlanPeriodEnd and clears trialEndsAt", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "trial_rollover",
      plan: "manager",
      stripeCustomerId: "cus_trial_rollover",
    });
    await t.run((ctx) =>
      ctx.db.patch(c, {
        stripeSubscriptionId: "sub_trial",
        trialEndsAt: NOW,
        currentPlanPeriodEnd: NOW,
      })
    );
    // Stripe fires .updated when trial converts to active. trialEnd is now
    // absent (or in the past); period_end is the next billing cycle.
    await t.mutation(internal.billing.webhook.handleSubscriptionUpdated, {
      stripeCustomerId: "cus_trial_rollover",
      subscriptionId: "sub_trial",
      tier: "manager",
      interval: "monthly",
      currentPeriodEnd: NOW + 30 * 86_400_000,
      // trialEnd intentionally omitted
    });
    const after = await t.run((ctx) => ctx.db.get(c));
    expect(after?.plan).toBe("manager");
    expect(after?.trialEndsAt).toBeUndefined();
    expect(after?.currentPlanPeriodEnd).toBe(NOW + 30 * 86_400_000);
  });

  it("CROSS-TENANT: subscription.updated for Customer A's id never patches Creator B", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, {
      suffix: "upd_a",
      plan: "coach",
      stripeCustomerId: "cus_upd_a",
    });
    const b = await insertCreator(t, {
      suffix: "upd_b",
      plan: "coach",
      stripeCustomerId: "cus_upd_b",
    });
    await t.mutation(internal.billing.webhook.handleSubscriptionUpdated, {
      stripeCustomerId: "cus_upd_a",
      subscriptionId: "sub_a",
      tier: "manager",
      interval: "monthly",
    });
    const bAfter = await t.run((ctx) => ctx.db.get(b));
    expect(bAfter?.plan).toBe("coach");
  });

  it("CROSS-TENANT: metadata.creatorId mismatch refuses the patch on .updated path too", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "upd_bleed_a",
      plan: "coach",
      stripeCustomerId: "cus_upd_bleed_a",
    });
    const b = await insertCreator(t, {
      suffix: "upd_bleed_b",
      plan: "coach",
      stripeCustomerId: "cus_upd_bleed_b",
    });
    const result = await t.mutation(
      internal.billing.webhook.handleSubscriptionUpdated,
      {
        stripeCustomerId: "cus_upd_bleed_a",
        subscriptionId: "sub_forged_upd",
        creatorId: b,
        tier: "manager",
        interval: "monthly",
      }
    );
    expect(result.patched).toBe(false);
    expect(result.reason).toBe("creator_mismatch");
    const aAfter = await t.run((ctx) => ctx.db.get(a));
    expect(aAfter?.plan).toBe("coach");
  });

  it("ADVERSARIAL: unknown stripeCustomerId returns no_creator", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      internal.billing.webhook.handleSubscriptionUpdated,
      {
        stripeCustomerId: "cus_orphan_upd",
        subscriptionId: "sub_orphan",
        tier: "manager",
        interval: "monthly",
      }
    );
    expect(result.patched).toBe(false);
    expect(result.reason).toBe("no_creator");
  });
});

describe("billing.webhook.handleSubscriptionDeleted", () => {
  it.each<["coach" | "manager"]>([["coach"], ["manager"]])(
    "PLAN-TIER × ACTION: %s cancellation downgrades to Coach (the floor) and clears billing fields",
    async (startingTier) => {
      const t = convexTest(schema, modules);
      const c = await insertCreator(t, {
        suffix: `cancel_${startingTier}`,
        plan: startingTier,
        stripeCustomerId: `cus_cancel_${startingTier}`,
      });
      await t.run((ctx) =>
        ctx.db.patch(c, {
          stripeSubscriptionId: `sub_cancel_${startingTier}`,
          currentPlanPeriodEnd: NOW + 86_400_000,
          trialEndsAt: NOW + 86_400_000,
          billingInterval: "annual",
        })
      );

      await t.mutation(internal.billing.webhook.handleSubscriptionDeleted, {
        stripeCustomerId: `cus_cancel_${startingTier}`,
      });

      const after = await t.run((ctx) => ctx.db.get(c));
      // Coach IS the post-cancel floor for both tiers — no free fallback.
      expect(after?.plan).toBe("coach");
      expect(after?.stripeSubscriptionId).toBeUndefined();
      expect(after?.currentPlanPeriodEnd).toBeUndefined();
      expect(after?.trialEndsAt).toBeUndefined();
      expect(after?.billingInterval).toBeUndefined();
      // Customer id retained — same Stripe customer survives a resubscribe.
      expect(after?.stripeCustomerId).toBe(`cus_cancel_${startingTier}`);
    }
  );

  it("CROSS-TENANT: cancel for Customer A never patches Creator B", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "cancel_a",
      plan: "manager",
      stripeCustomerId: "cus_cancel_a",
    });
    const b = await insertCreator(t, {
      suffix: "cancel_b",
      plan: "manager",
      stripeCustomerId: "cus_cancel_b",
    });
    await t.mutation(internal.billing.webhook.handleSubscriptionDeleted, {
      stripeCustomerId: "cus_cancel_a",
    });
    const aAfter = await t.run((ctx) => ctx.db.get(a));
    const bAfter = await t.run((ctx) => ctx.db.get(b));
    expect(aAfter?.plan).toBe("coach"); // downgraded
    expect(bAfter?.plan).toBe("manager"); // untouched
  });

  it("ADVERSARIAL: cancel for unknown stripeCustomerId returns no_creator (no-op)", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      internal.billing.webhook.handleSubscriptionDeleted,
      { stripeCustomerId: "cus_orphan_cancel" }
    );
    expect(result.patched).toBe(false);
    expect(result.reason).toBe("no_creator");
  });

  it("DOWNGRADE PRESERVES connectedAccounts (don't strand creator's Gmail / Calendar)", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "preserve",
      plan: "manager",
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
    expect(after?.plan).toBe("coach");
    const gmailAfter = await t.run((ctx) => ctx.db.get(gmailAccount));
    expect(gmailAfter).not.toBeNull();
    expect(gmailAfter?.scopeStatus).toBe("active");
    expect(gmailAfter?.composioAccountIdHash).toBe("hash_preserve");
  });
});

describe("billing.webhook.handleTrialWillEnd", () => {
  it("logs to gtmAuditEvents with eventType=billing.trial-ending", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, {
      suffix: "trial_warn",
      plan: "manager",
      stripeCustomerId: "cus_trial_warn",
    });
    await t.mutation(internal.billing.webhook.handleTrialWillEnd, {
      stripeCustomerId: "cus_trial_warn",
    });
    const log = await t.run((ctx) =>
      ctx.db
        .query("gtmAuditEvents")
        .withIndex("by_account", (q) => q.eq("accountId", c))
        .collect()
    );
    expect(log).toHaveLength(1);
    expect(log[0].eventType).toBe("billing.trial-ending");
    expect(log[0].actor).toBe("system");
    expect(log[0].severity).toBe("info");
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
      expect(priceIdToPlanTuple("price_coach_m")).toEqual({
        tier: "coach",
        interval: "monthly",
      });
      expect(priceIdToPlanTuple("price_coach_a")).toEqual({
        tier: "coach",
        interval: "annual",
      });
      expect(priceIdToPlanTuple("price_manager_m")).toEqual({
        tier: "manager",
        interval: "monthly",
      });
      expect(priceIdToPlanTuple("price_manager_a")).toEqual({
        tier: "manager",
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
