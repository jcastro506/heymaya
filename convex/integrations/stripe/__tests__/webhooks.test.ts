/**
 * Wave D Stripe service-product webhook handler tests.
 *
 * Five mandatory categories + Stripe-specific:
 *   1. Cross-tenant: webhook for Customer A's stripeCustomerId never patches
 *      Business B; metadata.businessId mismatch refuses the patch.
 *   2. Plan-tier × action matrix: tier transitions (Starter→Pro upgrade,
 *      Pro→Studio upgrade, Studio→canceled) all land correct planTier values.
 *   3. Adversarial: replay (same eventId) returns alreadySeen + does not
 *      re-patch; webhook for unknown stripeCustomerId returns no_business
 *      without patching anything.
 *   4. Sibling-file scan: enforced repo-wide.
 *   5. TODO grep: covered repo-wide.
 *   6. Stripe-specific — idempotency on replay; trial_will_end queues a
 *      Maya nudge AND logs to mayaActionLog; payment_failed sets status to
 *      past_due AND queues a nudge.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function insertServiceBusiness(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    planTier?: "starter" | "pro" | "studio";
    stripeCustomerId?: string;
  }
): Promise<{ accountId: Id<"creators">; businessId: Id<"businesses"> }> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@biz.test`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "starter",
      accountType: "service-business",
      createdAt: NOW,
    });
    const businessId = await ctx.db.insert("businesses", {
      accountId,
      name: `${opts.suffix} Co.`,
      serviceTypes: ["hvac"],
      planTier: opts.planTier,
      stripeCustomerId: opts.stripeCustomerId,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.patch(accountId, { businessId });
    return { accountId, businessId };
  });
}

/* -------------------------------------------------------------------------- */
/* recordServiceWebhookEvent — idempotency                                     */
/* -------------------------------------------------------------------------- */

describe("integrations.stripe.webhooks.recordServiceWebhookEvent", () => {
  it("first delivery returns alreadySeen=false; second delivery returns alreadySeen=true and adds replay row", async () => {
    const t = convexTest(schema, modules);
    const r1 = await t.mutation(
      internal.integrations.stripe.webhooks.recordServiceWebhookEvent,
      {
        eventId: "evt_dup",
        type: "checkout.session.completed",
        livemode: false,
        status: "processed",
        rawPayload: { id: "evt_dup" },
      }
    );
    expect(r1.alreadySeen).toBe(false);

    const r2 = await t.mutation(
      internal.integrations.stripe.webhooks.recordServiceWebhookEvent,
      {
        eventId: "evt_dup",
        type: "checkout.session.completed",
        livemode: false,
        status: "processed",
        rawPayload: { id: "evt_dup" },
      }
    );
    expect(r2.alreadySeen).toBe(true);

    const rows = await t.run((ctx) =>
      ctx.db.query("stripeWebhookEvents").collect()
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === "replay_dropped")).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* handleServiceCheckoutCompleted                                              */
/* -------------------------------------------------------------------------- */

describe("integrations.stripe.webhooks.handleServiceCheckoutCompleted", () => {
  it("patches planTier + subscription fields on the resolved business", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await insertServiceBusiness(t, {
      suffix: "ckp",
      stripeCustomerId: "cus_ckp",
    });
    const trialEnd = NOW + 14 * 86_400_000;
    const r = await t.mutation(
      internal.integrations.stripe.webhooks.handleServiceCheckoutCompleted,
      {
        stripeCustomerId: "cus_ckp",
        subscriptionId: "sub_pro",
        businessId,
        tier: "pro",
        interval: "monthly",
        status: "trialing",
        currentPeriodEnd: trialEnd,
        trialEnd,
      }
    );
    expect(r.patched).toBe(true);
    const after = await t.run((ctx) => ctx.db.get(businessId));
    expect(after?.planTier).toBe("pro");
    expect(after?.stripeSubscriptionId).toBe("sub_pro");
    expect(after?.subscriptionStatus).toBe("trialing");
    expect(after?.currentPlanPeriodEnd).toBe(trialEnd);
    expect(after?.trialEndsAt).toBe(trialEnd);
    expect(after?.billingInterval).toBe("monthly");
  });

  it("CROSS-TENANT — webhook for Customer A's id never patches Business B", async () => {
    const t = convexTest(schema, modules);
    const { businessId: a } = await insertServiceBusiness(t, {
      suffix: "tenA",
      stripeCustomerId: "cus_A",
    });
    const { businessId: b } = await insertServiceBusiness(t, {
      suffix: "tenB",
      stripeCustomerId: "cus_B",
    });
    await t.mutation(
      internal.integrations.stripe.webhooks.handleServiceCheckoutCompleted,
      {
        stripeCustomerId: "cus_A",
        subscriptionId: "sub_A",
        tier: "studio",
        interval: "monthly",
        status: "active",
      }
    );
    const aAfter = await t.run((ctx) => ctx.db.get(a));
    const bAfter = await t.run((ctx) => ctx.db.get(b));
    expect(aAfter?.planTier).toBe("studio");
    expect(bAfter?.planTier).toBeUndefined();
  });

  it("CROSS-TENANT — metadata.businessId mismatch refuses the patch", async () => {
    const t = convexTest(schema, modules);
    const { businessId: a } = await insertServiceBusiness(t, {
      suffix: "bA",
      stripeCustomerId: "cus_bA",
    });
    const { businessId: b } = await insertServiceBusiness(t, {
      suffix: "bB",
      stripeCustomerId: "cus_bB",
    });
    const r = await t.mutation(
      internal.integrations.stripe.webhooks.handleServiceCheckoutCompleted,
      {
        stripeCustomerId: "cus_bA", // resolves to A
        subscriptionId: "sub_forged",
        businessId: b, // claims to be B — refuse
        tier: "studio",
        interval: "monthly",
        status: "active",
      }
    );
    expect(r.patched).toBe(false);
    expect(r.reason).toBe("business_mismatch");
    const aAfter = await t.run((ctx) => ctx.db.get(a));
    expect(aAfter?.planTier).toBeUndefined();
  });

  it("ADVERSARIAL — unknown stripeCustomerId returns no_business without throwing", async () => {
    const t = convexTest(schema, modules);
    const r = await t.mutation(
      internal.integrations.stripe.webhooks.handleServiceCheckoutCompleted,
      {
        stripeCustomerId: "cus_nobody_home",
        subscriptionId: "sub_x",
        tier: "pro",
        interval: "monthly",
        status: "active",
      }
    );
    expect(r.patched).toBe(false);
    expect(r.reason).toBe("no_business");
  });
});

/* -------------------------------------------------------------------------- */
/* handleServiceSubscriptionUpdated                                            */
/* -------------------------------------------------------------------------- */

describe("integrations.stripe.webhooks.handleServiceSubscriptionUpdated", () => {
  it("UPGRADE: Pro → Studio tier change", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await insertServiceBusiness(t, {
      suffix: "upgrade",
      planTier: "pro",
      stripeCustomerId: "cus_upgrade",
    });
    await t.mutation(
      internal.integrations.stripe.webhooks.handleServiceSubscriptionUpdated,
      {
        stripeCustomerId: "cus_upgrade",
        subscriptionId: "sub_upgraded",
        tier: "studio",
        interval: "annual",
        status: "active",
        currentPeriodEnd: NOW + 365 * 86_400_000,
      }
    );
    const after = await t.run((ctx) => ctx.db.get(businessId));
    expect(after?.planTier).toBe("studio");
    expect(after?.billingInterval).toBe("annual");
    expect(after?.subscriptionStatus).toBe("active");
  });

  it("STATUS TRANSITION: active → past_due", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await insertServiceBusiness(t, {
      suffix: "dunning",
      planTier: "pro",
      stripeCustomerId: "cus_dunning",
    });
    await t.mutation(
      internal.integrations.stripe.webhooks.handleServiceSubscriptionUpdated,
      {
        stripeCustomerId: "cus_dunning",
        subscriptionId: "sub_pd",
        tier: "pro",
        interval: "monthly",
        status: "past_due",
      }
    );
    const after = await t.run((ctx) => ctx.db.get(businessId));
    expect(after?.subscriptionStatus).toBe("past_due");
    expect(after?.planTier).toBe("pro"); // tier unchanged during dunning
  });
});

/* -------------------------------------------------------------------------- */
/* handleServiceSubscriptionDeleted                                            */
/* -------------------------------------------------------------------------- */

describe("integrations.stripe.webhooks.handleServiceSubscriptionDeleted", () => {
  it("clears tier + sets subscriptionStatus=canceled but keeps stripeCustomerId", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await insertServiceBusiness(t, {
      suffix: "del",
      planTier: "studio",
      stripeCustomerId: "cus_del",
    });
    await t.mutation(
      internal.integrations.stripe.webhooks.handleServiceSubscriptionDeleted,
      { stripeCustomerId: "cus_del" }
    );
    const after = await t.run((ctx) => ctx.db.get(businessId));
    expect(after?.planTier).toBeUndefined();
    expect(after?.stripeSubscriptionId).toBeUndefined();
    expect(after?.subscriptionStatus).toBe("canceled");
    expect(after?.stripeCustomerId).toBe("cus_del"); // preserved for resub
  });
});

/* -------------------------------------------------------------------------- */
/* handleServiceTrialWillEnd                                                   */
/* -------------------------------------------------------------------------- */

describe("integrations.stripe.webhooks.handleServiceTrialWillEnd", () => {
  it("logs to mayaActionLog AND queues a Maya nudge", async () => {
    const t = convexTest(schema, modules);
    const { businessId, accountId } = await insertServiceBusiness(t, {
      suffix: "trialnotify",
      planTier: "pro",
      stripeCustomerId: "cus_trialnotify",
    });
    const r = await t.mutation(
      internal.integrations.stripe.webhooks.handleServiceTrialWillEnd,
      { stripeCustomerId: "cus_trialnotify" }
    );
    expect(r.logged).toBe(true);
    expect(r.queued).toBe(true);

    const logs = await t.run((ctx) =>
      ctx.db
        .query("mayaActionLog")
        .filter((q) => q.eq(q.field("creatorId"), accountId))
        .collect()
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].entryId).toBe("billing.service-trial-ending");

    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .filter((q) => q.eq(q.field("businessId"), businessId))
        .collect()
    );
    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe("trial.ending");
  });
});

/* -------------------------------------------------------------------------- */
/* handleServicePaymentFailed                                                  */
/* -------------------------------------------------------------------------- */

describe("integrations.stripe.webhooks.handleServicePaymentFailed", () => {
  it("sets subscriptionStatus=past_due AND queues a Maya nudge", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await insertServiceBusiness(t, {
      suffix: "pf",
      planTier: "pro",
      stripeCustomerId: "cus_pf",
    });
    const r = await t.mutation(
      internal.integrations.stripe.webhooks.handleServicePaymentFailed,
      { stripeCustomerId: "cus_pf" }
    );
    expect(r.patched).toBe(true);
    expect(r.queued).toBe(true);
    const after = await t.run((ctx) => ctx.db.get(businessId));
    expect(after?.subscriptionStatus).toBe("past_due");
    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .filter((q) => q.eq(q.field("businessId"), businessId))
        .collect()
    );
    expect(queue.some((q) => q.kind === "billing.payment-failed")).toBe(true);
  });

  it("ADVERSARIAL — payment_failed for unknown customer is a graceful no-op", async () => {
    const t = convexTest(schema, modules);
    const r = await t.mutation(
      internal.integrations.stripe.webhooks.handleServicePaymentFailed,
      { stripeCustomerId: "cus_unknown" }
    );
    expect(r.patched).toBe(false);
    expect(r.queued).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Public wrapper secret-gate                                                  */
/* -------------------------------------------------------------------------- */

describe("integrations.stripe.webhooks public wrappers — secret gate", () => {
  it("rejects when WEBHOOK_INTERNAL_SECRET unconfigured", async () => {
    const t = convexTest(schema, modules);
    // No env / no test-injected secret
    await expect(
      t.mutation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the secret gate
        (
          await import("../../../_generated/api")
        ).api.integrations.stripe.webhooks.recordServiceWebhookEventPublic,
        {
          secret: "wrong",
          eventId: "evt_unauth",
          type: "x",
          livemode: false,
          status: "processed",
          rawPayload: {},
        }
      )
    ).rejects.toThrow(/unauthorized/i);
  });
});
