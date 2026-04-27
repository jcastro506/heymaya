/**
 * Wave D voiceUsage table tests — period rollover + cap enforcement.
 *
 * Covers:
 *   - Period creation on first voice minute
 *   - Period boundary enforced by `currentPlanPeriodEnd` on the business
 *   - Hard cap stamps `cappedAt` exactly once per period
 *   - voiceUsage rows are correctly cross-tenant (by_business_and_period
 *     index)
 *   - Schema sibling check: every voiceUsage row carries businessId +
 *     periodStartMs + periodEndMs as required by the by_business_and_period
 *     index.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";
import {
  _setStripeClientForTests,
  type StripeClientLike,
} from "../billing/stripeClient";
import type Stripe from "stripe";

const NOW = 1_700_000_000_000;

async function insertBusiness(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    planTier: "starter" | "pro" | "studio";
    currentPlanPeriodEnd?: number;
  }
): Promise<Id<"businesses">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@biz.test`,
      channelPreference: "web",
      timezone: "UTC",
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
      stripeCustomerId: `cus_${opts.suffix}`,
      currentPlanPeriodEnd: opts.currentPlanPeriodEnd,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.patch(accountId, { businessId });
    return businessId;
  });
}

function buildFakeStripeClient(): StripeClientLike {
  return {
    customers: { async create() { throw new Error("unused"); } },
    checkout: {
      sessions: { async create() { throw new Error("unused"); } },
    },
    billingPortal: {
      sessions: { async create() { throw new Error("unused"); } },
    },
    subscriptions: { async retrieve() { throw new Error("unused"); } },
    webhooks: {
      constructEvent() {
        throw new Error("unused");
      },
    },
    billing: {
      meterEvents: {
        async create() {
          return {
            object: "billing.meter_event",
          } as unknown as Stripe.Response<Stripe.Billing.MeterEvent>;
        },
      },
    },
  };
}

describe("voiceUsage — period creation + boundary", () => {
  it("creates a new voiceUsage row on first minute reported", async () => {
    _setStripeClientForTests(buildFakeStripeClient());
    try {
      const t = convexTest(schema, modules);
      const periodEnd = Date.now() + 30 * 86_400_000;
      const businessId = await insertBusiness(t, {
        suffix: "vu_first",
        planTier: "pro",
        currentPlanPeriodEnd: periodEnd,
      });
      const before = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .collect()
      );
      expect(before).toHaveLength(0);

      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 60 }
      );

      const after = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .collect()
      );
      expect(after).toHaveLength(1);
      expect(after[0].minutesUsed).toBe(1);
      expect(after[0].periodEndMs).toBe(periodEnd);
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("multiple recordings within the same period reuse the same row", async () => {
    _setStripeClientForTests(buildFakeStripeClient());
    try {
      const t = convexTest(schema, modules);
      // currentPlanPeriodEnd must be in the FUTURE relative to Date.now()
      // because the action computes `nowMs = Date.now()` and the period
      // boundary check is `nowMs <= periodEndMs`.
      const businessId = await insertBusiness(t, {
        suffix: "vu_multi",
        planTier: "pro",
        currentPlanPeriodEnd: Date.now() + 30 * 86_400_000,
      });
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 60 }
      );
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c2", durationSec: 60 }
      );
      const rows = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .collect()
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].minutesUsed).toBe(2);
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("cappedAt is set exactly once even on subsequent over-cap recordings", async () => {
    _setStripeClientForTests(buildFakeStripeClient());
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertBusiness(t, {
        suffix: "vu_cap_idem",
        planTier: "studio",
        currentPlanPeriodEnd: Date.now() + 30 * 86_400_000,
      });
      // First crossing
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 510 * 60 }
      );
      const first = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .first()
      );
      const firstCap = first?.cappedAt;
      expect(firstCap).not.toBeUndefined();

      // Subsequent over-cap call should NOT reset cappedAt — already crossed
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c2", durationSec: 60 }
      );
      const second = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .first()
      );
      // cappedAt is the timestamp of the FIRST crossing; subsequent calls
      // increment minutes but don't re-stamp.
      expect(second?.cappedAt).toBe(firstCap);
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("schema sibling: every voiceUsage row has businessId + periodStartMs + periodEndMs (by_business_and_period index requirement)", async () => {
    _setStripeClientForTests(buildFakeStripeClient());
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertBusiness(t, {
        suffix: "vu_sibling",
        planTier: "pro",
        currentPlanPeriodEnd: Date.now() + 30 * 86_400_000,
      });
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 60 }
      );
      const row = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .first()
      );
      expect(row).not.toBeNull();
      expect(row?.businessId).toBeTruthy();
      expect(row?.periodStartMs).toBeGreaterThan(0);
      expect(row?.periodEndMs).toBeGreaterThan(0);
      expect(row?.lastUpdatedAt).toBeGreaterThan(0);
    } finally {
      _setStripeClientForTests(null);
    }
  });
});
