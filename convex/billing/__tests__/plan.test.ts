/**
 * §19.4: every event idempotent (replay → one change) · out-of-order pair resolves to
 * the newer status · the trial → active → past_due → active → canceled walk with the
 * gate's rails asserted at every step · one message per state change, never for a
 * non-change · a tenant mismatch patches nothing · founding seats count paying rows.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { messageFor, statusFromStripe } from "../plan";
import type { Id } from "../../_generated/dataModel";

const NOON_UTC = Date.UTC(2026, 8, 2, 12, 0) / 1000; // seconds, like Stripe
const sub = (status: string, over: Partial<{ id: string; trial_end: number | null; current_period_end: number | null; founding: boolean }> = {}) => ({ id: "sub_1", status, trial_end: null, current_period_end: NOON_UTC + 30 * 86_400, ...over });

async function creatorWithCustomer(t: ReturnType<typeof convexTest>) {
  return await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true }, plan: { status: "onboarding", founding: false, stripeCustomerId: "cus_1" } }));
}

async function rails(t: ReturnType<typeof convexTest>, creatorId: Id<"creators">, atSeconds: number) {
  const g = await t.query(internal.scout.gate.railsFor, { creatorId, now: atSeconds * 1000 + 3600_000 }); // 13:00 UTC, outside quiet hours
  return g!.rails;
}

describe("statusFromStripe / messageFor", () => {
  it("maps Stripe's words to ours and says one line only on a change", () => {
    expect(statusFromStripe({ status: "trialing" })).toBe("trialing");
    expect(statusFromStripe({ status: "unpaid" })).toBe("past_due");
    expect(statusFromStripe({ status: "incomplete" })).toBeNull();
    expect(messageFor("active", "active", "")).toBeNull();
    expect(messageFor("trialing", "active", "")).toMatch(/official/);
    expect(messageFor("active", "canceled", "https://x")).toContain("https://x/api/account/export");
  });
});

describe("applyEvent", () => {
  it("replays change nothing and are audited", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await creatorWithCustomer(t);
    const ev = { eventId: "evt_1", type: "customer.subscription.created", livemode: false, createdAt: NOON_UTC, customerId: "cus_1", subscription: sub("trialing", { trial_end: NOON_UTC + 7 * 86_400 }) };
    const first = await t.mutation(internal.billing.plan.applyEvent, ev);
    expect(first.change).toEqual({ creatorId, prev: "onboarding", next: "trialing" });
    const again = await t.mutation(internal.billing.plan.applyEvent, ev);
    expect(again).toMatchObject({ handled: false, detail: "replay", change: null });
    const rows = await t.run((ctx) => ctx.db.query("stripeWebhookEvents").collect());
    expect(rows.map((r) => r.status).sort()).toEqual(["processed", "replay_dropped"]);
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.plan.trialEndsAt).toBe((NOON_UTC + 7 * 86_400) * 1000);
  });

  it("an out-of-order pair resolves to the newer status", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await creatorWithCustomer(t);
    await t.mutation(internal.billing.plan.applyEvent, { eventId: "evt_new", type: "customer.subscription.updated", livemode: false, createdAt: NOON_UTC + 100, customerId: "cus_1", subscription: sub("active") });
    const stale = await t.mutation(internal.billing.plan.applyEvent, { eventId: "evt_old", type: "customer.subscription.updated", livemode: false, createdAt: NOON_UTC + 50, customerId: "cus_1", subscription: sub("past_due") });
    expect(stale.detail).toBe("stale");
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.plan.status).toBe("active");
  });

  it("walks trial → active → past_due (grace, then paused proactive) → active → canceled, rails asserted each step", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await creatorWithCustomer(t);
    let tick = NOON_UTC;
    const apply = async (status: string, founding = false) => {
      tick += 60;
      return await t.mutation(internal.billing.plan.applyEvent, { eventId: `evt_${tick}`, type: "customer.subscription.updated", livemode: false, createdAt: tick, customerId: "cus_1", subscription: sub(status, { founding }) });
    };
    expect((await apply("trialing", true)).change?.next).toBe("trialing");
    expect((await rails(t, creatorId, tick)).ok).toBe(true);
    expect((await apply("active")).change?.next).toBe("active");
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.plan.founding).toBe(true); // locked while they stay
    expect((await rails(t, creatorId, tick)).ok).toBe(true);
    expect((await apply("past_due")).change?.next).toBe("past_due");
    expect((await rails(t, creatorId, tick)).ok).toBe(true); // day 1 of grace: proactive continues
    expect((await rails(t, creatorId, tick + 4 * 86_400)).ok).toBe(false); // day 4: paused
    expect((await rails(t, creatorId, tick + 4 * 86_400)).reason).toMatch(/past due/);
    expect((await apply("active")).change?.next).toBe("active");
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.plan.pastDueSince).toBeUndefined();
    expect((await rails(t, creatorId, tick + 10 * 86_400)).ok).toBe(true);
    expect((await apply("canceled")).change?.next).toBe("canceled");
    expect((await rails(t, creatorId, tick)).ok).toBe(false);
    expect((await apply("canceled")).change).toBeNull(); // no change, no message
  });

  it("a tenant mismatch patches nothing; deletion beats Stripe", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await creatorWithCustomer(t);
    const r = await t.mutation(internal.billing.plan.applyEvent, { eventId: "evt_x", type: "customer.subscription.updated", livemode: false, createdAt: NOON_UTC, customerId: "cus_1", creatorIdFromMetadata: "someone_else", subscription: sub("active") });
    expect(r.detail).toBe("tenant mismatch");
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.plan.status).toBe("onboarding");
    await t.run(async (ctx) => { const c = (await ctx.db.get(creatorId))!; await ctx.db.patch(creatorId, { plan: { ...c.plan, status: "deleting" } }); });
    await t.mutation(internal.billing.plan.applyEvent, { eventId: "evt_y", type: "customer.subscription.updated", livemode: false, createdAt: NOON_UTC + 5, customerId: "cus_1", subscription: sub("active") });
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.plan.status).toBe("deleting");
  });

  it("founding seats count creators with a subscription and the flag", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedCreator(ctx, "a", { plan: { status: "active", founding: true, stripeSubscriptionId: "sub_a" } }));
    await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" }, plan: { status: "trialing", founding: true } })); // no subscription yet: not a seat
    expect(await t.query(internal.billing.plan.seatsLeft, {})).toBe(99);
  });
});
