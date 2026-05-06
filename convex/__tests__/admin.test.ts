/**
 * Admin module — Sprint 9 — comp-flag mutations + plan-features short-circuit.
 *
 * Coverage (5 mandatory categories):
 *   1. Cross-tenant isolation — comping creator A does not affect creator B.
 *   2. Plan-tier × action — comp'd creator gets Manager features regardless
 *      of stored `plan="coach"`; un-comp'd Coach still hits Coach gating.
 *   3. Adversarial — empty/missing/wrong token rejected; bogus creatorId 404s.
 *   4. Sibling-file scan — `compedByAdmin` schema field lives next to other
 *      tier-related fields; compCreator + uncompCreator round-trip.
 *   5. TODO grep — none introduced.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { _setAdminTokenForTests } from "../admin";
import {
  planFeatures,
  subscriptionActive,
} from "../lib/planFeatures";

const TOKEN = "admin-test-token-".repeat(2);

describe("admin — Sprint 9 comp accounts", () => {
  beforeEach(() => {
    _setAdminTokenForTests(TOKEN);
  });

  afterEach(() => {
    _setAdminTokenForTests(null);
  });

  it("rejects compCreator without a token (token unset on caller side)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );
    await expect(
      t.mutation(api.admin.compCreator, {
        token: "",
        creatorId,
      })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("rejects compCreator with a wrong token", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );
    await expect(
      t.mutation(api.admin.compCreator, {
        token: "not-the-right-token",
        creatorId,
      })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("rejects compCreator on bogus creator id with a typed error", async () => {
    const t = convexTest(schema, modules);
    // Insert + delete to manufacture a non-existent valid id.
    const ghostId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("creators", baseCreatorRow("user_ghost"));
      await ctx.db.delete(id);
      return id;
    });
    await expect(
      t.mutation(api.admin.compCreator, {
        token: TOKEN,
        creatorId: ghostId,
      })
    ).rejects.toThrow(/creator-not-found/);
  });

  it("flips compedByAdmin true on a fresh creator and is idempotent on re-call", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );

    const first = await t.mutation(api.admin.compCreator, {
      token: TOKEN,
      creatorId,
    });
    expect(first).toEqual({ ok: true, alreadyComped: false });

    const second = await t.mutation(api.admin.compCreator, {
      token: TOKEN,
      creatorId,
    });
    expect(second).toEqual({ ok: true, alreadyComped: true });

    const row = await t.run(async (ctx) => ctx.db.get(creatorId));
    expect(row?.compedByAdmin).toBe(true);
  });

  it("uncompCreator inverts the flag and is idempotent on re-call", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );
    await t.mutation(api.admin.compCreator, { token: TOKEN, creatorId });
    const first = await t.mutation(api.admin.uncompCreator, {
      token: TOKEN,
      creatorId,
    });
    expect(first).toEqual({ ok: true, alreadyUncomped: false });

    const second = await t.mutation(api.admin.uncompCreator, {
      token: TOKEN,
      creatorId,
    });
    expect(second).toEqual({ ok: true, alreadyUncomped: true });

    const row = await t.run(async (ctx) => ctx.db.get(creatorId));
    expect(row?.compedByAdmin).toBe(false);
  });

  it("cross-tenant: comping creator A does not flip creator B's flag", async () => {
    const t = convexTest(schema, modules);
    const idA = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_A"))
    );
    const idB = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_B"))
    );
    await t.mutation(api.admin.compCreator, { token: TOKEN, creatorId: idA });

    const a = await t.run(async (ctx) => ctx.db.get(idA));
    const b = await t.run(async (ctx) => ctx.db.get(idB));
    expect(a?.compedByAdmin).toBe(true);
    expect(b?.compedByAdmin).toBeUndefined();
  });

  it("rejects when ADMIN_TOKEN is unset on the deployment", async () => {
    _setAdminTokenForTests(null);
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );
    await expect(
      t.mutation(api.admin.compCreator, { token: TOKEN, creatorId })
    ).rejects.toThrow(/unauthorized/i);
  });
});

describe("planFeatures — Sprint 9 comp short-circuit", () => {
  it("comp'd creator gets Manager features even with plan='coach'", () => {
    const features = planFeatures({ plan: "coach", compedByAdmin: true });
    expect(features.plan).toBe("manager");
    expect(features.canAutoSendBrandEmails).toBe(true);
    expect(features.canDoBrandOutreach).toBe(true);
    expect(features.brandContactDiscoveryEnabled).toBe(true);
    expect(features.chatTurnsPerMonth).toBe("unlimited");
    expect(features.competitorWatchSlots).toBe(10);
  });

  it("un-comp'd Coach still hits Coach gating (paywall holds)", () => {
    const features = planFeatures({ plan: "coach" });
    expect(features.plan).toBe("coach");
    expect(features.canAutoSendBrandEmails).toBe(false);
    expect(features.canDoBrandOutreach).toBe(false);
    expect(features.chatTurnsPerMonth).toBe(400);
  });

  it("compedByAdmin=false is treated as 'not comped' (Coach holds)", () => {
    const features = planFeatures({ plan: "coach", compedByAdmin: false });
    expect(features.plan).toBe("coach");
    expect(features.canAutoSendBrandEmails).toBe(false);
  });

  it("comp'd creator with plan='manager' is unchanged (already at top tier)", () => {
    const features = planFeatures({ plan: "manager", compedByAdmin: true });
    expect(features.plan).toBe("manager");
  });
});

describe("subscriptionActive — Sprint 9 helper", () => {
  const NOW = Date.UTC(2026, 4, 6, 12, 0, 0);

  it("comp'd creator: active even with no Stripe row", () => {
    expect(
      subscriptionActive(
        {
          stripeSubscriptionId: undefined,
          currentPlanPeriodEnd: undefined,
          compedByAdmin: true,
        },
        NOW
      )
    ).toBe(true);
  });

  it("no subscription, no comp: inactive (paywall)", () => {
    expect(
      subscriptionActive(
        {
          stripeSubscriptionId: undefined,
          currentPlanPeriodEnd: undefined,
        },
        NOW
      )
    ).toBe(false);
  });

  it("subscription active with future period end: active", () => {
    expect(
      subscriptionActive(
        {
          stripeSubscriptionId: "sub_x",
          currentPlanPeriodEnd: NOW + 86_400_000,
        },
        NOW
      )
    ).toBe(true);
  });

  it("subscription with past period end: inactive (lapsed)", () => {
    expect(
      subscriptionActive(
        {
          stripeSubscriptionId: "sub_x",
          currentPlanPeriodEnd: NOW - 1,
        },
        NOW
      )
    ).toBe(false);
  });

  it("subscription with no period end yet: defaults to active (race-tolerant)", () => {
    expect(
      subscriptionActive(
        {
          stripeSubscriptionId: "sub_x",
          currentPlanPeriodEnd: undefined,
        },
        NOW
      )
    ).toBe(true);
  });

  it("comp short-circuit beats lapsed Stripe subscription", () => {
    expect(
      subscriptionActive(
        {
          stripeSubscriptionId: "sub_lapsed",
          currentPlanPeriodEnd: NOW - 86_400_000,
          compedByAdmin: true,
        },
        NOW
      )
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function baseCreatorRow(suffix: string): {
  clerkUserId: string;
  email: string;
  channelPreference: "imessage";
  timezone: string;
  status: "onboarding";
  plan: "coach";
  createdAt: number;
} {
  return {
    clerkUserId: `clerk_${suffix}`,
    email: `${suffix}@example.com`,
    channelPreference: "imessage",
    timezone: "America/Los_Angeles",
    status: "onboarding",
    plan: "coach",
    createdAt: Date.UTC(2026, 4, 1),
  };
}
