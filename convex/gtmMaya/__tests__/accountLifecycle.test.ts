/**
 * GTM account lifecycle — cancellation + hard-deletion tests.
 *
 * Covers the mandatory destructive-path categories:
 *   1. CROSS-TENANT ISOLATION — operator A can never cancel, resume, or
 *      hard-delete operator B. Every action resolves the caller's OWN account;
 *      B's rows survive A's delete and vice versa.
 *   2. CANCELLATION semantics — sets Stripe cancel_at_period_end + stamps
 *      gtmCanceledAt + period end; does NOT immediately lapse the plan.
 *   3. HARD-DELETE purge isolation — purges the caller's gtm* rows, leaves OTHER
 *      tenants' rows intact, and never touches the EXEMPT cross-tenant tables
 *      (gtmArchetypeLearnings etc.).
 *   4. RETENTION sweep — only targets canceled-30d+ / status-none accounts;
 *      never active / trialing / past_due / resubscribed.
 *
 * Stripe is injected via _setStripeClientForTests (no network). Fly is exercised
 * with FLY_API_TOKEN unset so the FlyClient ctor throws and the best-effort
 * catch path runs — proving the DB purge stays authoritative when Fly is down.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  _setStripeClientForTests,
  type StripeClientLike,
} from "../../billing/stripeClient";
import { buildGtmPlanJson } from "../planGtm";

/**
 * Fake timers so convex-test's scheduler never fires. These tests assert that
 * work was SCHEDULED (they query `_scheduled_functions`), never that it ran —
 * so letting a real timer fire it after teardown only produced
 * "Write outside of transaction" as an UNHANDLED rejection, which vitest
 * counts as a suite error and exits 1 even with every test green.
 */
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const NOW = Date.UTC(2026, 5, 16, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function authedGtm(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
}

/* ---------------------------- Stripe fake ---------------------------------- */

interface FakeStripeState {
  /** subId → { customer, status, cancel_at_period_end, periodEndMs } */
  subs: Map<
    string,
    {
      customer: string;
      status: string;
      cancelAtPeriodEnd: boolean;
      periodEndSec: number;
    }
  >;
  deletedCustomers: string[];
  updateCalls: Array<{ id: string; cancelAtPeriodEnd: boolean }>;
}

function makeFakeStripe(state: FakeStripeState): StripeClientLike {
  return {
    customers: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: (async () => ({ id: "cus_new" })) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      del: (async (id: string) => {
        state.deletedCustomers.push(id);
        return { id, deleted: true } as never;
      }) as any,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    checkout: { sessions: { create: (async () => ({ url: "x" })) as any } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    billingPortal: { sessions: { create: (async () => ({ url: "x" })) as any } },
    subscriptions: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      retrieve: (async () => ({})) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      list: (async (params: { customer?: string }) => {
        const data = [...state.subs.entries()]
          .filter(([, s]) => s.customer === params?.customer)
          .map(([id, s]) => ({
            id,
            status: s.status,
            cancel_at_period_end: s.cancelAtPeriodEnd,
            current_period_end: s.periodEndSec,
            items: { data: [{ current_period_end: s.periodEndSec }] },
          }));
        return { data } as never;
      }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: (async (
        id: string,
        params: { cancel_at_period_end?: boolean }
      ) => {
        const sub = state.subs.get(id);
        if (sub && typeof params?.cancel_at_period_end === "boolean") {
          sub.cancelAtPeriodEnd = params.cancel_at_period_end;
        }
        state.updateCalls.push({
          id,
          cancelAtPeriodEnd: Boolean(params?.cancel_at_period_end),
        });
        return {
          id,
          status: sub?.status ?? "active",
          cancel_at_period_end: sub?.cancelAtPeriodEnd ?? false,
          current_period_end: sub?.periodEndSec,
          items: { data: [{ current_period_end: sub?.periodEndSec }] },
        } as never;
      }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cancel: (async () => ({})) as any,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webhooks: { constructEvent: (() => ({})) as any },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    billing: { meterEvents: { create: (async () => ({})) as any } },
  };
}

function freshStripeState(): FakeStripeState {
  return { subs: new Map(), deletedCustomers: [], updateCalls: [] };
}

/* ----------------------------- Seeding ------------------------------------- */

async function seedGtmAgent(
  t: ReturnType<typeof convexTest>,
  opts: {
    subject: string;
    stripeCustomerId?: string;
    planStatus?: "active" | "trialing" | "past_due" | "none";
    canceledAt?: number;
    canceledPeriodEndMs?: number;
  }
): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> }> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: opts.subject,
      email: `${opts.subject}@clawlaunch.test`,
      primaryHandle: opts.subject,
      channelPreference: "web",
      timezone: "America/New_York",
      status: "active",
      plan: "coach",
      accountType: "gtm-agent",
      stripeCustomerId: opts.stripeCustomerId,
      createdAt: NOW,
    });
    const agentId = await ctx.db.insert("gtmAgents", {
      accountId,
      onboardingStep: "active",
      channelPreference: "telegram",
      timezone: "America/New_York",
      openClawFlyAppId: `clawlaunch-${opts.subject}`,
      gtmPlanJson: opts.planStatus
        ? buildGtmPlanJson({
            status: opts.planStatus === "none" ? "none" : opts.planStatus,
            tier: "starter",
            periodStartMs: NOW,
          })
        : undefined,
      gtmCanceledAt: opts.canceledAt,
      gtmCanceledPeriodEndMs: opts.canceledPeriodEndMs,
      createdAt: NOW,
      updatedAt: NOW,
    });
    // A representative account-scoped row so we can assert the purge.
    await ctx.db.insert("gtmConversions", {
      accountId,
      agentId,
      kind: "signup",
      count: 1,
      source: "self_report",
      occurredAt: NOW,
    });
    return { accountId, agentId };
  });
}

/* ------------------------------ Lifecycle ---------------------------------- */

describe("accountLifecycle — cancellation", () => {
  let stripeState: FakeStripeState;

  beforeEach(() => {
    stripeState = freshStripeState();
    _setStripeClientForTests(makeFakeStripe(stripeState));
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    _setStripeClientForTests(null);
    vi.restoreAllMocks();
  });

  it("CANCELLATION: sets cancel_at_period_end + stamps gtmCanceledAt; plan stays active", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await seedGtmAgent(t, {
      subject: "lc_cancel",
      stripeCustomerId: "cus_cancel",
      planStatus: "active",
    });
    const periodEndSec = Math.floor((NOW + 20 * DAY) / 1000);
    stripeState.subs.set("sub_cancel", {
      customer: "cus_cancel",
      status: "active",
      cancelAtPeriodEnd: false,
      periodEndSec,
    });

    const res = await authedGtm(t, "lc_cancel").action(
      api.gtmMaya.accountLifecycle.cancelMyGtmSubscription,
      {}
    );
    expect(res.ok).toBe(true);
    expect(res.periodEndMs).toBe(periodEndSec * 1000);
    // Stripe got cancel_at_period_end:true.
    expect(stripeState.subs.get("sub_cancel")?.cancelAtPeriodEnd).toBe(true);

    const agent = await t.run((ctx) => ctx.db.get(agentId));
    expect(agent?.gtmCanceledAt).toBe(NOW);
    expect(agent?.gtmCanceledPeriodEndMs).toBe(periodEndSec * 1000);
    // Plan is NOT lapsed — still active gtmPlanJson.
    expect(agent?.gtmPlanJson).toContain('"status":"active"');
  });

  it("RESUME: clears cancel_at_period_end + the gtmCanceledAt stamp", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await seedGtmAgent(t, {
      subject: "lc_resume",
      stripeCustomerId: "cus_resume",
      planStatus: "active",
      canceledAt: NOW - DAY,
      canceledPeriodEndMs: NOW + 10 * DAY,
    });
    stripeState.subs.set("sub_resume", {
      customer: "cus_resume",
      status: "active",
      cancelAtPeriodEnd: true,
      periodEndSec: Math.floor((NOW + 10 * DAY) / 1000),
    });

    const res = await authedGtm(t, "lc_resume").action(
      api.gtmMaya.accountLifecycle.resumeMyGtmSubscription,
      {}
    );
    expect(res.ok).toBe(true);
    expect(stripeState.subs.get("sub_resume")?.cancelAtPeriodEnd).toBe(false);
    const agent = await t.run((ctx) => ctx.db.get(agentId));
    expect(agent?.gtmCanceledAt).toBeUndefined();
    expect(agent?.gtmCanceledPeriodEndMs).toBeUndefined();
  });

  it("CROSS-TENANT: operator B cannot cancel operator A (resolves only own account)", async () => {
    const t = convexTest(schema, modules);
    const { agentId: agentA } = await seedGtmAgent(t, {
      subject: "lc_a",
      stripeCustomerId: "cus_a",
      planStatus: "active",
    });
    stripeState.subs.set("sub_a", {
      customer: "cus_a",
      status: "active",
      cancelAtPeriodEnd: false,
      periodEndSec: Math.floor((NOW + 20 * DAY) / 1000),
    });

    // B has NO stripe customer + a separate account.
    await seedGtmAgent(t, { subject: "lc_b", planStatus: "active" });

    // B cancels — resolves to B's own account (no stripe customer) → fail, and
    // crucially A's subscription is untouched.
    const res = await authedGtm(t, "lc_b").action(
      api.gtmMaya.accountLifecycle.cancelMyGtmSubscription,
      {}
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no-stripe-customer");
    expect(stripeState.subs.get("sub_a")?.cancelAtPeriodEnd).toBe(false);
    const a = await t.run((ctx) => ctx.db.get(agentA));
    expect(a?.gtmCanceledAt).toBeUndefined();
  });

  it("UNAUTHENTICATED / non-gtm caller cannot cancel (fail-closed)", async () => {
    const t = convexTest(schema, modules);
    const res = await t.action(
      api.gtmMaya.accountLifecycle.cancelMyGtmSubscription,
      {}
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not-a-gtm-account");
  });
});

describe("accountLifecycle — hard delete", () => {
  let stripeState: FakeStripeState;
  const priorFlyToken = process.env.FLY_API_TOKEN;

  beforeEach(() => {
    stripeState = freshStripeState();
    _setStripeClientForTests(makeFakeStripe(stripeState));
    // Force the Fly best-effort path: ctor throws on missing token → DB purge
    // must still be authoritative.
    delete process.env.FLY_API_TOKEN;
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    _setStripeClientForTests(null);
    if (priorFlyToken === undefined) delete process.env.FLY_API_TOKEN;
    else process.env.FLY_API_TOKEN = priorFlyToken;
    vi.restoreAllMocks();
  });

  it("PURGE ISOLATION: deletes caller's gtm* rows, leaves other tenant intact, exempt tables untouched", async () => {
    const t = convexTest(schema, modules);
    const { accountId: accA, agentId: agentA } = await seedGtmAgent(t, {
      subject: "del_a",
      stripeCustomerId: "cus_del_a",
      planStatus: "active",
    });
    const { accountId: accB } = await seedGtmAgent(t, {
      subject: "del_b",
      stripeCustomerId: "cus_del_b",
      planStatus: "active",
    });

    // Seed a CROSS-TENANT EXEMPT row that must survive any tenant's delete.
    const learningId = await t.run((ctx) =>
      ctx.db.insert("gtmArchetypeLearnings", {
        archetype: "dev-tool",
        kind: "channel",
        learning: "Reddit converts for dev tools.",
        supportingTenantCount: 7,
        evidenceCount: 42,
        confidence: 0.9,
        updatedAt: NOW,
      })
    );

    const res = await authedGtm(t, "del_a").action(
      api.gtmMaya.accountLifecycle.hardDeleteMyGtmAccount,
      {}
    );
    expect(res.deleted).toBe(true);
    // Stripe customer deleted.
    expect(stripeState.deletedCustomers).toContain("cus_del_a");
    // Fly was attempted but token missing → counted as errors, not a throw.
    expect(res.flyErrors).toBeGreaterThanOrEqual(1);

    await t.run(async (ctx) => {
      // A is gone — creator + agent + its conversions.
      expect(await ctx.db.get(accA)).toBeNull();
      expect(await ctx.db.get(agentA)).toBeNull();
      expect(
        await ctx.db
          .query("gtmConversions")
          .withIndex("by_account", (q) => q.eq("accountId", accA))
          .collect()
      ).toHaveLength(0);
      // B is fully intact.
      expect(await ctx.db.get(accB)).not.toBeNull();
      expect(
        await ctx.db
          .query("gtmConversions")
          .withIndex("by_account", (q) => q.eq("accountId", accB))
          .collect()
      ).toHaveLength(1);
      // EXEMPT cross-tenant table NOT purged.
      expect(await ctx.db.get(learningId)).not.toBeNull();
    });
  });

  it("CROSS-TENANT: operator B's hard-delete never touches operator A", async () => {
    const t = convexTest(schema, modules);
    const { accountId: accA, agentId: agentA } = await seedGtmAgent(t, {
      subject: "iso_a",
      stripeCustomerId: "cus_iso_a",
      planStatus: "active",
    });
    await seedGtmAgent(t, {
      subject: "iso_b",
      stripeCustomerId: "cus_iso_b",
      planStatus: "active",
    });

    await authedGtm(t, "iso_b").action(
      api.gtmMaya.accountLifecycle.hardDeleteMyGtmAccount,
      {}
    );
    // A's Stripe customer NOT deleted; A's rows intact.
    expect(stripeState.deletedCustomers).not.toContain("cus_iso_a");
    expect(stripeState.deletedCustomers).toContain("cus_iso_b");
    await t.run(async (ctx) => {
      expect(await ctx.db.get(accA)).not.toBeNull();
      expect(await ctx.db.get(agentA)).not.toBeNull();
    });
  });

  it("IDEMPOTENT: a second hard-delete returns deleted:false (account gone)", async () => {
    const t = convexTest(schema, modules);
    await seedGtmAgent(t, {
      subject: "idem",
      stripeCustomerId: "cus_idem",
      planStatus: "active",
    });
    const first = await authedGtm(t, "idem").action(
      api.gtmMaya.accountLifecycle.hardDeleteMyGtmAccount,
      {}
    );
    expect(first.deleted).toBe(true);
    const second = await authedGtm(t, "idem").action(
      api.gtmMaya.accountLifecycle.hardDeleteMyGtmAccount,
      {}
    );
    expect(second.deleted).toBe(false);
    expect(second.reason).toBe("not-a-gtm-account");
  });
});

describe("accountLifecycle — 30-day retention sweep", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => vi.restoreAllMocks());

  it("targets ONLY canceled-30d+ / status-none accounts; never active/trialing/recent", async () => {
    const t = convexTest(schema, modules);
    // Eligible: canceled 31d ago, plan lapsed to none.
    const { agentId: eligible } = await seedGtmAgent(t, {
      subject: "ret_eligible",
      planStatus: "none",
      canceledAt: NOW - 31 * DAY,
    });
    // NOT eligible — canceled but only 10 days ago.
    await seedGtmAgent(t, {
      subject: "ret_recent",
      planStatus: "none",
      canceledAt: NOW - 10 * DAY,
    });
    // NOT eligible — canceled 40d ago BUT resubscribed (plan active again).
    await seedGtmAgent(t, {
      subject: "ret_resub",
      planStatus: "active",
      canceledAt: NOW - 40 * DAY,
    });
    // NOT eligible — never canceled.
    await seedGtmAgent(t, { subject: "ret_active", planStatus: "active" });

    const targets = await t.query(
      internal.gtmMaya.accountLifecycle.listRetentionPurgeTargets,
      {}
    );
    expect(targets.map((x) => x.agentId)).toEqual([eligible]);
  });

  it("sweep purges only the eligible account", async () => {
    const t = convexTest(schema, modules);
    const { accountId: accEligible } = await seedGtmAgent(t, {
      subject: "sweep_eligible",
      planStatus: "none",
      canceledAt: NOW - 31 * DAY,
    });
    const { accountId: accSafe } = await seedGtmAgent(t, {
      subject: "sweep_safe",
      planStatus: "active",
    });

    const result = await t.action(
      internal.gtmMaya.accountLifecycle.sweepCanceledRetention,
      {}
    );
    expect(result.scanned).toBe(1);
    expect(result.purged).toBe(1);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(accEligible)).toBeNull();
      expect(await ctx.db.get(accSafe)).not.toBeNull();
    });
  });
});
