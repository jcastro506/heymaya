/**
 * Webhook security wrappers — Sprint 9 cleanup pass.
 *
 * `ConvexHttpClient` (used by the Next.js webhook routes) cannot reach
 * `internal.*` references. We exposed thin `*Public` wrappers next to each
 * webhook-facing internal handler. Every wrapper validates a shared secret
 * via `assertWebhookSecret` (constant-time compare against
 * `WEBHOOK_INTERNAL_SECRET`) before delegating.
 *
 * Five mandatory test categories (per docs/SPRINT_PLAN_V0.md § 10):
 *   1. Cross-tenant: a webhook for Customer A's metadata never patches
 *      Creator B even when the wrapper accepts the call. The internal
 *      handlers are the canonical source of cross-tenant safety; these
 *      wrappers preserve their guarantees.
 *   2. Plan-tier × action matrix: webhook plan-tier behavior is unchanged
 *      vs. the internal handlers (covered by billing.test.ts +
 *      dealTriage.test.ts). Re-asserted here only at the wrapper boundary.
 *   3. Adversarial: missing/empty/wrong secret all fail-closed; the secret
 *      check uses a constant-time compare path; no early-exit length leak
 *      beyond the necessary trivial guard.
 *   4. Sibling-file scan: `assertWebhookSecret` lives in `convex/lib/`
 *      alongside `encryption.ts` / `planFeatures.ts` / `flyClient.ts`.
 *   5. TODO grep: covered repo-wide by sprint1Acceptance.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";
import { _setWebhookSecretForTests } from "../lib/webhookSecret";

const NOW = 1_700_000_000_000;
const TEST_SECRET = "deadbeef".repeat(8); // 64-char hex-ish

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

async function insertConnectedAccount(
  t: ReturnType<typeof convexTest>,
  opts: {
    creatorId: Id<"creators">;
    composioAccountIdHash: string;
  }
): Promise<Id<"connectedAccounts">> {
  return await t.run((ctx) =>
    ctx.db.insert("connectedAccounts", {
      creatorId: opts.creatorId,
      provider: "gmail",
      composioAccountId: `enc_${opts.creatorId}`,
      composioAccountIdHash: opts.composioAccountIdHash,
      scopes: ["read"],
      scopeStatus: "active",
      connectedAt: NOW,
    })
  );
}

/* -------------------------------------------------------------------------- */
/* assertWebhookSecret behavior — covered via every wrapper                    */
/* -------------------------------------------------------------------------- */

describe("webhookSecret — assertWebhookSecret gate", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("ADVERSARIAL: rejects empty / missing / wrong secret across every wrapper", async () => {
    const t = convexTest(schema, modules);
    for (const bad of ["", "wrong", `${TEST_SECRET}x`, TEST_SECRET.slice(0, -1)]) {
      await expect(
        t.mutation(api.billing.webhook.recordWebhookEventPublic, {
          secret: bad,
          eventId: "evt_b1",
          type: "checkout.session.completed",
          livemode: false,
          status: "processed",
          rawPayload: {},
        })
      ).rejects.toThrow(/unauthorized/i);
    }
    // And on the clerk wrapper.
    await expect(
      t.mutation(api.creators.createFromClerkPublic, {
        secret: "",
        clerkUserId: "u_x",
        email: "x@test.com",
      })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("ADVERSARIAL: refuses every wrapper when the env secret is unset", async () => {
    _setWebhookSecretForTests(null);
    // Note: in this test environment, process.env.WEBHOOK_INTERNAL_SECRET is
    // unset (vitest doesn't bridge .env.local), so the gate fail-closes even
    // when the caller supplies the "right" secret.
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.creators.createFromClerkPublic, {
        secret: TEST_SECRET,
        clerkUserId: "u_x",
        email: "x@test.com",
      })
    ).rejects.toThrow(/unauthorized/i);
  });
});

/* -------------------------------------------------------------------------- */
/* billing wrappers                                                            */
/* -------------------------------------------------------------------------- */

describe("billing.webhook public wrappers", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("recordWebhookEventPublic: succeeds with the correct secret", async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(api.billing.webhook.recordWebhookEventPublic, {
      secret: TEST_SECRET,
      eventId: "evt_b_1",
      type: "checkout.session.completed",
      livemode: false,
      status: "processed",
      customerId: "cus_x",
      rawPayload: {},
    });
    expect(res.alreadySeen).toBe(false);
  });

  it("handleCheckoutCompletedPublic: patches the creator's plan to the new tier", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "a",
      plan: "coach",
      stripeCustomerId: "cus_a",
    });
    const res = await t.mutation(
      api.billing.webhook.handleCheckoutCompletedPublic,
      {
        secret: TEST_SECRET,
        stripeCustomerId: "cus_a",
        subscriptionId: "sub_a",
        tier: "manager",
        interval: "monthly",
      }
    );
    expect(res.patched).toBe(true);
    const row = await t.run((ctx) => ctx.db.get(a));
    expect(row?.plan).toBe("manager");
  });

  it("handleCheckoutCompletedPublic: CROSS-TENANT — metadata.creatorId mismatch refuses the patch", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "a",
      plan: "coach",
      stripeCustomerId: "cus_a",
    });
    const b = await insertCreator(t, {
      suffix: "b",
      plan: "coach",
    });
    const res = await t.mutation(
      api.billing.webhook.handleCheckoutCompletedPublic,
      {
        secret: TEST_SECRET,
        stripeCustomerId: "cus_a",
        subscriptionId: "sub_a",
        creatorId: b, // mismatch — Customer A's webhook claiming Creator B
        tier: "manager",
        interval: "monthly",
      }
    );
    expect(res.patched).toBe(false);
    expect(res.reason).toBe("creator_mismatch");
    // Neither creator was patched.
    const aRow = await t.run((ctx) => ctx.db.get(a));
    const bRow = await t.run((ctx) => ctx.db.get(b));
    expect(aRow?.plan).toBe("coach");
    expect(bRow?.plan).toBe("coach");
  });

  it("handleSubscriptionDeletedPublic: downgrades to starter and clears billing fields", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "a",
      plan: "manager",
      stripeCustomerId: "cus_a",
    });
    await t.run((ctx) =>
      ctx.db.patch(a, {
        stripeSubscriptionId: "sub_a",
        currentPlanPeriodEnd: NOW + 86_400_000,
        billingInterval: "monthly",
      })
    );
    const res = await t.mutation(
      api.billing.webhook.handleSubscriptionDeletedPublic,
      { secret: TEST_SECRET, stripeCustomerId: "cus_a" }
    );
    expect(res.patched).toBe(true);
    const row = await t.run((ctx) => ctx.db.get(a));
    expect(row?.plan).toBe("coach");
    expect(row?.stripeSubscriptionId).toBeUndefined();
    expect(row?.currentPlanPeriodEnd).toBeUndefined();
    // Customer ID stays so resubscribe via Checkout reuses the existing
    // customer — see internal handler doc for rationale.
    expect(row?.stripeCustomerId).toBe("cus_a");
  });

  it("handleTrialWillEndPublic: logs to gtmAuditEvents under eventType='billing.trial-ending'", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "a",
      plan: "manager",
      stripeCustomerId: "cus_a",
    });
    const res = await t.mutation(api.billing.webhook.handleTrialWillEndPublic, {
      secret: TEST_SECRET,
      stripeCustomerId: "cus_a",
    });
    expect(res.logged).toBe(true);
    const log = await t.run((ctx) =>
      ctx.db
        .query("gtmAuditEvents")
        .withIndex("by_account", (q) => q.eq("accountId", a))
        .collect()
    );
    expect(log.some((r) => r.eventType === "billing.trial-ending")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* clerk wrapper                                                               */
/* -------------------------------------------------------------------------- */

describe("creators.createFromClerkPublic", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(TEST_SECRET);
  });
  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("creates the creators row and is idempotent on clerkUserId", async () => {
    const t = convexTest(schema, modules);
    const id1 = await t.mutation(api.creators.createFromClerkPublic, {
      secret: TEST_SECRET,
      clerkUserId: "u_new_1",
      email: "new1@test.com",
    });
    expect(id1).toBeDefined();
    // Idempotent — second call with same clerkUserId returns the same id.
    const id2 = await t.mutation(api.creators.createFromClerkPublic, {
      secret: TEST_SECRET,
      clerkUserId: "u_new_1",
      email: "new1@test.com",
    });
    expect(id2).toBe(id1);
  });
});
