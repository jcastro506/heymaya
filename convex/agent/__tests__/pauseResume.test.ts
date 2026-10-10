/**
 * Stop and resume (2026-10-06, a real tester): STOP wrote "paused" into the billing status, a routine
 * Stripe event wrote "trialing" over it and she was texted again, then "resume" found nothing to undo
 * and its "back on!" was followed by nothing. Their pause is its own field now.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { pausedByThem, statusAfterLegacyPause } from "../../core/paused";

const NOON = Date.UTC(2026, 9, 6, 12, 0);
const trial = { status: "trialing", founding: true, stripeCustomerId: "cus_p", stripeSubscriptionId: "sub_p", trialEndsAt: NOON + 3 * 86_400_000 };

async function proactive(t: ReturnType<typeof convexTest>, creatorId: unknown, key: string) {
  return await t.mutation(internal.core.messages.send, { creatorId: creatorId as never, surface: "telegram", body: "an idea", dedupeKey: key, proactive: true, kind: "scout", ts: NOON });
}

describe("stop and resume", () => {
  it("stop holds every proactive text and a billing event can't undo it; replies still go", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "pa", { channel: { paired: true }, plan: trial }));
    const b = await t.run((ctx) => seedCreator(ctx, "pb", { channel: { paired: true }, plan: { ...trial, stripeCustomerId: "cus_q", stripeSubscriptionId: "sub_q" } }));

    const stop = await t.mutation(internal.agent.commands.apply, { creatorId: a, command: "stop" });
    expect(stop.body).toMatch(/stop texting you first/);
    expect(stop.body).toMatch(/resume/);
    const row = await t.run((ctx) => ctx.db.get(a));
    expect(row?.messagingPausedAt).toBeTypeOf("number");
    expect(row?.plan.status, "billing is untouched").toBe("trialing");

    expect(await proactive(t, a, "s1")).toMatchObject({ sent: false, held: expect.stringMatching(/stop texting/) });
    // The thing that broke it live: Stripe says "trialing" again.
    await t.mutation(internal.billing.plan.applyEvent, { eventId: "evt_p", type: "customer.subscription.updated", livemode: false, createdAt: NOON / 1000, customerId: "cus_p", subscription: { id: "sub_p", status: "trialing", trial_end: NOON / 1000 + 3 * 86_400, current_period_end: NOON / 1000 + 3 * 86_400 } });
    expect(await proactive(t, a, "s2")).toMatchObject({ sent: false });
    // A reply to them always goes.
    expect(await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: "here", dedupeKey: "r1", proactive: false, kind: "reply", ts: NOON })).toMatchObject({ sent: true });
    // Cross-tenant: someone else's pause holds nothing of theirs.
    expect(await proactive(t, b, "s3")).toMatchObject({ sent: true });
    // The fleet's schedule row reads them as paused.
    const sched = await t.run((ctx) => ctx.db.query("schedule").collect());
    expect(sched.find((s) => s.creatorId === a)?.status).toBe("paused");
  });

  it("resume clears it, keeps the trial a trial, and plans the week again", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "pr", { channel: { paired: true }, plan: trial, messagingPausedAt: NOON - 86_400_000 }));
    const r = await t.mutation(internal.agent.commands.apply, { creatorId: a, command: "resume" });
    expect(r.resumed).toBe(true);
    expect(r.body).not.toMatch(/back on!/);
    const row = await t.run((ctx) => ctx.db.get(a));
    expect(row?.messagingPausedAt).toBeUndefined();
    expect(row?.plan.status).toBe("trialing");
    expect(await proactive(t, a, "s4")).toMatchObject({ sent: true });
    // Resume when nothing was paused isn't a fake "back".
    expect((await t.mutation(internal.agent.commands.apply, { creatorId: a, command: "resume" })).resumed).toBeUndefined();
  });

  it("an old pause (in the plan status) resumes to what billing says", async () => {
    expect(statusAfterLegacyPause({ ...trial, status: "paused" } as never, NOON)).toBe("trialing");
    expect(statusAfterLegacyPause({ ...trial, status: "paused", trialEndsAt: NOON - 1 } as never, NOON)).toBe("active");
    expect(statusAfterLegacyPause({ status: "paused", founding: true } as never, NOON)).toBe("active");
    expect(pausedByThem({ plan: { status: "trialing" }, messagingPausedAt: undefined } as never)).toBe(false);
    expect(pausedByThem({ plan: { status: "paused" } } as never)).toBe(true);
  });
});
