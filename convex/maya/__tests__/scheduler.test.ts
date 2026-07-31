import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";

const MORNING = Date.UTC(2026, 6, 31, 7, 0, 0);
const EVENING = Date.UTC(2026, 6, 31, 20, 0, 0);

async function customer(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  over: Partial<Doc<"customers">> = {}
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: MORNING - 30 * 86_400_000,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: MORNING - 30 * 86_400_000,
      updatedAt: MORNING,
      ...over,
    });
  });
}

async function channel(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  ch: "x" | "tiktok" | "instagram" | "youtube",
  status: "connected" | "error" = "connected"
) {
  await t.run((ctx) =>
    ctx.db.insert("channels", {
      customerId,
      channel: ch,
      postingMode: "just_go",
      status,
      createdAt: MORNING,
      updatedAt: MORNING,
    })
  );
}

async function idea(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  angle: string,
  score: number
) {
  await t.run((ctx) =>
    ctx.db.insert("ideas", {
      customerId,
      angle,
      score,
      status: "bank",
      createdAt: MORNING,
      updatedAt: MORNING,
    })
  );
}

describe("activeV2Customers — who the loop runs for", () => {
  it("v1 customers are untouched — migration is per-customer, not a flag day", async () => {
    const t = convexTest(schema, modules);
    const v2 = await customer(t, "v2");
    await customer(t, "v1", { agentVersion: "v1" });
    const ids = await t.query(internal.maya.scheduler.activeV2Customers, {});
    expect(ids).toEqual([v2]);
  });

  it("paused and cancelled accounts are excluded once, here, not in five jobs", async () => {
    const t = convexTest(schema, modules);
    const active = await customer(t, "act");
    await customer(t, "pau", { state: "paused" });
    await customer(t, "can", { state: "cancelled" });
    await customer(t, "onb", { state: "onboarding" });
    const ids = await t.query(internal.maya.scheduler.activeV2Customers, {});
    expect(ids).toEqual([active]);
  });
});

describe("planTheDay — the seam where judgment will go", () => {
  it("is honest that it isn't Maya yet", async () => {
    // fromAgent: false so nothing downstream can mistake a deterministic
    // fallback for judgment.
    const t = convexTest(schema, modules);
    const c = await customer(t, "seam");
    const plan = await t.query(internal.maya.scheduler.planTheDay, {
      customerId: c,
    });
    expect(plan.fromAgent).toBe(false);
  });

  it("pairs the best ideas with connected channels", async () => {
    const t = convexTest(schema, modules);
    const c = await customer(t, "plan");
    await channel(t, c, "x");
    await channel(t, c, "tiktok");
    await idea(t, c, "the weak angle", 1);
    await idea(t, c, "the strong angle", 9);

    const plan = await t.query(internal.maya.scheduler.planTheDay, {
      customerId: c,
    });
    expect(plan.plannedPosts).toHaveLength(2);
    expect(plan.plannedPosts[0].angle).toBe("the strong angle");
  });

  it("names a broken channel as blocked rather than planning into it", async () => {
    const t = convexTest(schema, modules);
    const c = await customer(t, "blocked");
    await channel(t, c, "x", "error");
    await idea(t, c, "an angle", 5);

    const plan = await t.query(internal.maya.scheduler.planTheDay, {
      customerId: c,
    });
    expect(plan.plannedPosts).toEqual([]);
    expect(plan.blockedChannels).toEqual([
      { channel: "x", reason: "it needs reconnecting" },
    ]);
  });

  it("an empty idea bank plans nothing rather than inventing something", async () => {
    const t = convexTest(schema, modules);
    const c = await customer(t, "empty");
    await channel(t, c, "x");
    const plan = await t.query(internal.maya.scheduler.planTheDay, {
      customerId: c,
    });
    expect(plan.plannedPosts).toEqual([]);
  });
});

describe("morningRunAll — the fleet sweep", () => {
  it("runs every active v2 customer and sends each a brief", async () => {
    const t = convexTest(schema, modules);
    const a = await customer(t, "fleet_a");
    const b = await customer(t, "fleet_b");
    await channel(t, a, "x");
    await idea(t, a, "A's angle", 5);

    const result = await t.action(internal.maya.scheduler.morningRunAll, {
      now: MORNING,
    });
    expect(result.ran).toBe(2);
    expect(result.failed).toBe(0);

    const messages = (await t.run((ctx) =>
      ctx.db.query("messages").collect()
    )) as Doc<"messages">[];
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.customerId).sort()).toEqual([a, b].sort());
  });

  it("skips v1 and paused customers entirely", async () => {
    const t = convexTest(schema, modules);
    await customer(t, "v1_skip", { agentVersion: "v1" });
    await customer(t, "paused_skip", { state: "paused" });
    const result = await t.action(internal.maya.scheduler.morningRunAll, {
      now: MORNING,
    });
    expect(result.ran).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("messages").collect())).toEqual([]);
  });

  it("is idempotent — a second sweep the same day re-sends nothing", async () => {
    const t = convexTest(schema, modules);
    await customer(t, "idem");
    await t.action(internal.maya.scheduler.morningRunAll, { now: MORNING });
    await t.action(internal.maya.scheduler.morningRunAll, { now: MORNING });
    expect(
      await t.run((ctx) => ctx.db.query("messages").collect())
    ).toHaveLength(1);
  });

  it("ONE BROKEN CUSTOMER DOESN'T STOP THE FLEET", async () => {
    // A sweep that dies on the first error silently stops working the day one
    // customer gets into a weird state — and nobody notices until three days
    // of briefs are missing.
    const t = convexTest(schema, modules);
    const good = await customer(t, "good");
    const broken = await customer(t, "broken");
    // Delete the customer row out from under the sweep after it's listed.
    await t.run((ctx) => ctx.db.delete(broken));

    const result = await t.action(internal.maya.scheduler.morningRunAll, {
      now: MORNING,
    });
    expect(result.ran).toBe(1);
    const messages = (await t.run((ctx) =>
      ctx.db.query("messages").collect()
    )) as Doc<"messages">[];
    expect(messages[0].customerId).toBe(good);
  });
});

describe("drainJobs", () => {
  it("FAILS a job whose kind has no handler — never silently succeeds it", async () => {
    // Pretending to do work we can't do is the failure mode this whole product
    // is a reaction to. `produce_post` has no handler in this build because
    // production needs the Write model and the agent pack.
    const t = convexTest(schema, modules);
    const c = await customer(t, "drain");
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "produce_post",
      idempotencyKey: "k1",
      customerId: c,
    });

    const result = await t.action(internal.maya.scheduler.drainJobs, {});
    expect(result.claimed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);

    const job = (await t.run((ctx) => ctx.db.get(jobId))) as Doc<"jobs">;
    expect(job.lastError).toMatch(/no handler for job kind "produce_post"/);
  });

  it("reaps abandoned work before claiming anything new", async () => {
    const t = convexTest(schema, modules);
    const c = await customer(t, "reap");
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "stuck",
      idempotencyKey: "k2",
      customerId: c,
    });
    await t.mutation(internal.maya.jobs.claimNext, {});
    await t.run((ctx) => ctx.db.patch(jobId, { deadlineAt: Date.now() - 1 }));

    await t.action(internal.maya.scheduler.drainJobs, {});
    const job = (await t.run((ctx) => ctx.db.get(jobId))) as Doc<"jobs">;
    // Reaped back to queued with the reason recorded. It is NOT re-claimed in
    // the same sweep — the reaper applies backoff, so `runAfter` is in the
    // future. That's correct: an abandoned job retrying instantly is how a
    // crash-looping worker burns a whole queue.
    expect(job.status).toBe("queued");
    expect(job.lastError).toMatch(/lease expired/);
  });

  it("an empty queue is a no-op", async () => {
    const t = convexTest(schema, modules);
    expect(await t.action(internal.maya.scheduler.drainJobs, {})).toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
    });
  });

  it("is bounded, so one sweep can't spin forever", async () => {
    const t = convexTest(schema, modules);
    const c = await customer(t, "bounded");
    for (let i = 0; i < 5; i += 1) {
      await t.mutation(internal.maya.jobs.enqueue, {
        kind: "x",
        idempotencyKey: `k${i}`,
        customerId: c,
      });
    }
    const result = await t.action(internal.maya.scheduler.drainJobs, { max: 2 });
    expect(result.claimed).toBe(2);
  });
});

describe("livenessSweep — independent of everything it checks", () => {
  it("records a breach for a stalled customer", async () => {
    const t = convexTest(schema, modules);
    const c = await customer(t, "stalled");

    const result = await t.action(internal.maya.scheduler.livenessSweep, {
      now: EVENING,
    });
    expect(result.checked).toBe(1);
    expect(result.breached).toBe(1);

    const events = (await t.run((ctx) =>
      ctx.db.query("gtmAuditEvents").collect()
    )) as Doc<"gtmAuditEvents">[];
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].eventType).toMatch(/^liveness\./);
    expect(events[0].actor).toBe("system");
  });

  it("a healthy day records nothing", async () => {
    const t = convexTest(schema, modules);
    const c = await customer(t, "healthy");
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId: c,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        publishedAt: EVENING - 3600_000,
        snapshotText: "went out",
        idempotencyKey: "p1",
      })
    );
    await t.mutation(internal.maya.messages.send, {
      customerId: c,
      surface: "telegram",
      body: "brief",
      dedupeKey: "brief:2026-07-31",
      ts: MORNING,
    });
    await t.mutation(internal.maya.messages.send, {
      customerId: c,
      surface: "telegram",
      body: "recap",
      dedupeKey: "recap:2026-07-31",
      ts: EVENING - 60_000,
    });

    const result = await t.action(internal.maya.scheduler.livenessSweep, {
      now: EVENING,
    });
    expect(result.breached).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("gtmAuditEvents").collect())).toEqual(
      []
    );
  });

  it("a paused customer is never checked, so never noisy", async () => {
    const t = convexTest(schema, modules);
    await customer(t, "quiet", { state: "paused" });
    const result = await t.action(internal.maya.scheduler.livenessSweep, {
      now: EVENING,
    });
    expect(result.checked).toBe(0);
    expect(result.breached).toBe(0);
  });

  it("escalation severity reaches the audit row", async () => {
    const t = convexTest(schema, modules);
    const c = await customer(t, "escalate");
    // Published four days ago, silent since — a three-plus day streak.
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId: c,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        publishedAt: EVENING - 4 * 86_400_000,
        snapshotText: "old",
        idempotencyKey: "old",
      })
    );
    await t.action(internal.maya.scheduler.livenessSweep, { now: EVENING });

    const events = (await t.run((ctx) =>
      ctx.db.query("gtmAuditEvents").collect()
    )) as Doc<"gtmAuditEvents">[];
    const streak = events.find((e) => e.eventType === "liveness.zero_day_streak");
    expect(streak?.severity).toBe("error");
  });
});
