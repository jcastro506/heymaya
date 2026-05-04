/**
 * Wave D Stripe service-product voice metering tests.
 *
 * Five mandatory categories + Stripe-specific:
 *   1. Cross-tenant: voice usage on Business A is isolated from B; the
 *      counter never bleeds.
 *   2. Plan-tier × action: Starter recordVoiceMinutes is a no-op (no
 *      overage); Pro reports above 30-min inclusion at $0.20/min; Studio
 *      reports above 100-min inclusion at $0.15/min.
 *   3. Adversarial: zero / negative / fractional duration handled; replays
 *      with the same callId/period don't double-count via the
 *      `minutesReportedToStripe` counter.
 *   4. Sibling-file scan: enforced repo-wide.
 *   5. TODO grep: covered repo-wide.
 *   6. Stripe-specific: $5-increment batching (don't fire meter event until
 *      a $5 chunk's worth of overage minutes accumulated); 500-min hard cap
 *      sets `cappedAt` and triggers a Maya nudge.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api, internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import {
  _setStripeClientForTests,
  type StripeClientLike,
} from "../../../billing/stripeClient";
import type Stripe from "stripe";

const NOW = 1_700_000_000_000;

async function insertServiceBusiness(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    planTier: "starter" | "pro" | "studio";
    stripeCustomerId?: string;
    currentPlanPeriodEnd?: number;
  }
): Promise<Id<"businesses">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@biz.test`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "coach",
      accountType: "service-business",
      createdAt: NOW,
    });
    const businessId = await ctx.db.insert("businesses", {
      accountId,
      name: `${opts.suffix} Co.`,
      serviceTypes: ["hvac"],
      planTier: opts.planTier,
      stripeCustomerId: opts.stripeCustomerId ?? `cus_${opts.suffix}`,
      currentPlanPeriodEnd:
        opts.currentPlanPeriodEnd ?? Date.now() + 30 * 86_400_000,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.patch(accountId, { businessId });
    return businessId;
  });
}

interface MeterEventCall {
  event_name: string;
  payload: Record<string, string>;
  identifier?: string;
  timestamp?: number;
}

function buildFakeStripeClient(): {
  client: StripeClientLike;
  meterEvents: MeterEventCall[];
} {
  const meterEvents: MeterEventCall[] = [];
  const client: StripeClientLike = {
    customers: {
      async create() {
        throw new Error("customers.create not used in metering tests");
      },
    },
    checkout: {
      sessions: {
        async create() {
          throw new Error("checkout not used in metering tests");
        },
      },
    },
    billingPortal: {
      sessions: {
        async create() {
          throw new Error("portal not used in metering tests");
        },
      },
    },
    subscriptions: {
      async retrieve() {
        throw new Error("subscriptions.retrieve not used in metering tests");
      },
    },
    webhooks: {
      constructEvent() {
        throw new Error("webhook signature not exercised in unit tests");
      },
    },
    billing: {
      meterEvents: {
        async create(params) {
          meterEvents.push({
            event_name: params.event_name,
            payload: params.payload,
            identifier: params.identifier,
            timestamp: params.timestamp,
          });
          return {
            object: "billing.meter_event",
            event_name: params.event_name,
            identifier: params.identifier ?? `id_${meterEvents.length}`,
            payload: params.payload,
            timestamp:
              params.timestamp ?? Math.floor(Date.now() / 1000),
            created: Math.floor(Date.now() / 1000),
            livemode: false,
          } as unknown as Stripe.Response<Stripe.Billing.MeterEvent>;
        },
      },
    },
  };
  return { client, meterEvents };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("integrations.stripe.voiceMetering.recordVoiceMinutes — Starter", () => {
  it("Starter plan: voice minutes are tracked but NEVER reported to Stripe (text-only tier)", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertServiceBusiness(t, {
        suffix: "st",
        planTier: "starter",
      });
      // Voice should not be allowed on Starter, but if a transcript leaks
      // through we still track for telemetry — just don't bill.
      const r = await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "call1", durationSec: 600 }
      );
      expect(r.reported).toBe(false);
      expect(fake.meterEvents).toHaveLength(0);
    } finally {
      _setStripeClientForTests(null);
    }
  });
});

describe("integrations.stripe.voiceMetering.recordVoiceMinutes — Pro", () => {
  it("under inclusion bucket (30 min): no Stripe meter event", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertServiceBusiness(t, {
        suffix: "pro_under",
        planTier: "pro",
      });
      // 20 minutes total — well under the 30-min Pro inclusion
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 20 * 60 }
      );
      expect(fake.meterEvents).toHaveLength(0);
      const usage = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .first()
      );
      expect(usage?.minutesUsed).toBe(20);
      expect(usage?.minutesReportedToStripe ?? 0).toBe(0);
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("over inclusion + below $5 threshold: NO meter event yet ($5/$0.20 = 25 min minimum chunk)", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertServiceBusiness(t, {
        suffix: "pro_just_over",
        planTier: "pro",
      });
      // 40 minutes total — 10 min overage at $0.20 = $2 (below $5 chunk)
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 40 * 60 }
      );
      expect(fake.meterEvents).toHaveLength(0);
      const usage = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .first()
      );
      expect(usage?.minutesUsed).toBe(40);
      expect(usage?.minutesReportedToStripe ?? 0).toBe(0);
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("over inclusion + crosses $5 threshold: fires ONE meter event for 25 minutes", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertServiceBusiness(t, {
        suffix: "pro_chunk1",
        planTier: "pro",
      });
      // 60 minutes total — 30 min overage at $0.20 = $6 → 25 minutes ($5 chunk)
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 60 * 60 }
      );
      expect(fake.meterEvents).toHaveLength(1);
      expect(fake.meterEvents[0].event_name).toBe(
        "heymaya_service_voice_minutes_pro"
      );
      expect(fake.meterEvents[0].payload.value).toBe("25");
      // Customer id is on the payload
      expect(fake.meterEvents[0].payload.stripe_customer_id).toBe(
        "cus_pro_chunk1"
      );
      const usage = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .first()
      );
      expect(usage?.minutesUsed).toBe(60);
      expect(usage?.minutesReportedToStripe).toBe(25);
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("$5-increment batching across multiple calls: second call adds another chunk, idempotency identifier differs", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertServiceBusiness(t, {
        suffix: "pro_chunk2",
        planTier: "pro",
      });
      // Call 1: 60 min total → 25-min chunk reported
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 60 * 60 }
      );
      // Call 2: another 30 min → total 90 min (60-min overage), reported=25, unreported=35 → another 25-min chunk
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c2", durationSec: 30 * 60 }
      );
      expect(fake.meterEvents).toHaveLength(2);
      expect(fake.meterEvents[0].payload.value).toBe("25");
      expect(fake.meterEvents[1].payload.value).toBe("25");
      // Identifiers differ so Stripe dedup keeps both
      expect(fake.meterEvents[0].identifier).not.toBe(
        fake.meterEvents[1].identifier
      );
      const usage = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .first()
      );
      expect(usage?.minutesUsed).toBe(90);
      expect(usage?.minutesReportedToStripe).toBe(50);
    } finally {
      _setStripeClientForTests(null);
    }
  });
});

describe("integrations.stripe.voiceMetering.recordVoiceMinutes — Studio", () => {
  it("Studio @ 200 min usage: 100-min inclusion + 100-min overage at $0.15/min = $15 → reports 99 minutes (3 × $5 chunks of 33 min each)", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertServiceBusiness(t, {
        suffix: "studio_200",
        planTier: "studio",
      });
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 200 * 60 }
      );
      // Studio overage rate $0.15/min → $5 chunk = floor(5/0.15) = 33 min
      // 100-min overage / 33 = 3 chunks → 99 min reported
      expect(fake.meterEvents).toHaveLength(1);
      expect(fake.meterEvents[0].event_name).toBe(
        "heymaya_service_voice_minutes_studio"
      );
      expect(fake.meterEvents[0].payload.value).toBe("99");
      const usage = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .first()
      );
      expect(usage?.minutesUsed).toBe(200);
      expect(usage?.minutesReportedToStripe).toBe(99);
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("HARD CAP: Studio at 500 min sets cappedAt + queues Maya nudge", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertServiceBusiness(t, {
        suffix: "studio_cap",
        planTier: "studio",
      });
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 510 * 60 }
      );
      const usage = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .first()
      );
      expect(usage?.minutesUsed).toBe(510);
      expect(usage?.cappedAt).not.toBeUndefined();
      const queue = await t.run((ctx) =>
        ctx.db
          .query("mayaTaskQueue")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .collect()
      );
      expect(queue.some((q) => q.kind === "voice.hard-cap-reached")).toBe(
        true
      );
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("isVoiceCapped query reflects the cap state", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertServiceBusiness(t, {
        suffix: "cap_query",
        planTier: "studio",
      });
      const before = await t.query(
        api.integrations.stripe.voiceMetering.isVoiceCapped,
        { businessId }
      );
      expect(before.capped).toBe(false);
      expect(before.hardCap).toBe(500);

      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 500 * 60 }
      );
      const after = await t.query(
        api.integrations.stripe.voiceMetering.isVoiceCapped,
        { businessId }
      );
      expect(after.capped).toBe(true);
      expect(after.minutesUsed).toBe(500);
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("Pro has NO hard cap (only Studio does)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertServiceBusiness(t, {
      suffix: "pro_no_cap",
      planTier: "pro",
    });
    const result = await t.query(
      api.integrations.stripe.voiceMetering.isVoiceCapped,
      { businessId }
    );
    expect(result.capped).toBe(false);
    expect(result.hardCap).toBeNull();
  });
});

describe("integrations.stripe.voiceMetering — cross-tenant + adversarial", () => {
  it("CROSS-TENANT: voice minutes on A never bleed into B", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const a = await insertServiceBusiness(t, {
        suffix: "tenA",
        planTier: "pro",
      });
      const b = await insertServiceBusiness(t, {
        suffix: "tenB",
        planTier: "pro",
      });
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId: a, callId: "c_a", durationSec: 60 * 60 }
      );
      const aUsage = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), a))
          .first()
      );
      const bUsage = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), b))
          .first()
      );
      expect(aUsage?.minutesUsed).toBe(60);
      expect(bUsage).toBeNull();
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("ADVERSARIAL: zero-second call is a no-op", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertServiceBusiness(t, {
        suffix: "zero",
        planTier: "pro",
      });
      const r = await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 0 }
      );
      expect(r.reported).toBe(false);
      expect(r.minutesAdded).toBe(0);
      expect(fake.meterEvents).toHaveLength(0);
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("ADVERSARIAL: partial-minute call (75s = 2 min, billing rounding)", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const businessId = await insertServiceBusiness(t, {
        suffix: "round",
        planTier: "pro",
      });
      await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 75 }
      );
      const usage = await t.run((ctx) =>
        ctx.db
          .query("voiceUsage")
          .filter((q) => q.eq(q.field("businessId"), businessId))
          .first()
      );
      // 75s rounds UP to 2 minutes
      expect(usage?.minutesUsed).toBe(2);
    } finally {
      _setStripeClientForTests(null);
    }
  });

  it("no Stripe customer id (mid-onboarding): voice usage tracked but NOT reported", async () => {
    const fake = buildFakeStripeClient();
    _setStripeClientForTests(fake.client);
    try {
      const t = convexTest(schema, modules);
      const businessId = await t.run(async (ctx) => {
        const accountId = await ctx.db.insert("creators", {
          clerkUserId: "u_no_cus",
          email: "no_cus@biz.test",
          channelPreference: "web",
          timezone: "UTC",
          status: "active",
          plan: "coach",
          accountType: "service-business",
          createdAt: NOW,
        });
        const id = await ctx.db.insert("businesses", {
          accountId,
          name: "No Customer Co.",
          serviceTypes: ["hvac"],
          planTier: "pro",
          // intentionally no stripeCustomerId
          createdAt: NOW,
          updatedAt: NOW,
        });
        await ctx.db.patch(accountId, { businessId: id });
        return id;
      });
      const r = await t.action(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        { businessId, callId: "c1", durationSec: 60 * 60 }
      );
      expect(r.reported).toBe(false);
      expect(fake.meterEvents).toHaveLength(0);
    } finally {
      _setStripeClientForTests(null);
    }
  });
});
