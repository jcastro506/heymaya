import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  allowsKind,
  ALWAYS_ALLOWED_KINDS,
  judgeSpend,
  THROTTLEABLE_KINDS,
} from "../spendCeiling";

const NOW = Date.UTC(2026, 7, 1, 12, 0, 0);

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  state: "active" | "paused" = "active"
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state,
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function spend(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  costUsd: number,
  key: string,
  createdAt = NOW
) {
  await t.run((ctx) =>
    ctx.db.insert("jobs", {
      customerId,
      kind: "render_video",
      idempotencyKey: key,
      status: "succeeded",
      attempts: 1,
      maxAttempts: 3,
      runAfter: createdAt,
      deadlineAt: createdAt + 60_000,
      costUsd,
      createdAt,
      updatedAt: createdAt,
    })
  );
}

describe("CAPS THROTTLE, THEY NEVER DESTROY", () => {
  it("the module has no vocabulary for stopping anything", () => {
    // The previous implementation DESTROYED the Fly machine on a cost cap.
    // That doesn't save money, it deletes the employee — the founder texts and
    // nothing answers, forever, and the only symptom is silence. A closed
    // vocabulary is the guard, because the failure mode is someone reaching
    // for a plausible-sounding option under pressure.
    const source = readFileSync(join(__dirname, "../spendCeiling.ts"), "utf8");
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of [
      "destroyApp",
      "destroyMachine",
      "killMachine",
      "shutdown",
      "stopMachine",
      "deleteApp",
    ]) {
      expect(code, `spendCeiling must never ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("there are exactly two states, and neither is 'stopped'", () => {
    const verdicts = [
      judgeSpend({ spentUsd: 0, ceilingUsd: 5 }).state,
      judgeSpend({ spentUsd: 999, ceilingUsd: 5 }).state,
    ];
    expect(new Set(verdicts)).toEqual(new Set(["normal", "throttled"]));
  });

  it("A THROTTLED MACHINE STILL ANSWERS", () => {
    // The whole distinction. Throttling means "stop the expensive things",
    // never "stop talking". A cap that silences her is indistinguishable from
    // an outage.
    for (const kind of ALWAYS_ALLOWED_KINDS) {
      expect(allowsKind("throttled", kind), kind).toBe(true);
    }
  });

  it("but it stops the expensive, deferrable work", () => {
    for (const kind of THROTTLEABLE_KINDS) {
      expect(allowsKind("throttled", kind), kind).toBe(false);
    }
  });

  it("nothing is throttled while under the ceiling", () => {
    for (const kind of [...ALWAYS_ALLOWED_KINDS, ...THROTTLEABLE_KINDS]) {
      expect(allowsKind("normal", kind), kind).toBe(true);
    }
  });

  it("an unclassified job kind fails toward spending LESS", () => {
    // A new kind nobody classified shouldn't get an exemption by default.
    // Making it always-allowed requires a deliberate edit and a review.
    expect(allowsKind("throttled", "some_new_expensive_thing")).toBe(false);
  });

  it("delivering a message is never throttled — a queued brief still lands", () => {
    expect(allowsKind("throttled", "deliver_message")).toBe(true);
  });
});

describe("judgeSpend", () => {
  it("under the ceiling is normal", () => {
    const v = judgeSpend({ spentUsd: 2.5, ceilingUsd: 5 });
    expect(v.state).toBe("normal");
    expect(v.ratio).toBe(0.5);
  });

  it("exactly at the ceiling throttles — the off-by-one that lets a runaway through", () => {
    expect(judgeSpend({ spentUsd: 5, ceilingUsd: 5 }).state).toBe("throttled");
  });

  it("a zero ceiling doesn't divide by zero", () => {
    // A paused customer has a zero ceiling. Infinity is correct; NaN would
    // make every downstream comparison false and silently disable the cap.
    const v = judgeSpend({ spentUsd: 1, ceilingUsd: 0 });
    expect(v.state).toBe("throttled");
    expect(Number.isNaN(v.ratio)).toBe(false);
  });

  it("the detail says what's still happening, not just what stopped", () => {
    const v = judgeSpend({ spentUsd: 6, ceilingUsd: 5 });
    expect(v.detail).toMatch(/still answering/);
    expect(v.detail).not.toMatch(/destroy|stopped|shut/i);
  });
});

describe("spendToday — derived from rows, not a counter", () => {
  it("sums today's job costs", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "sum");
    await spend(t, customerId, 1.5, "j1");
    await spend(t, customerId, 2.0, "j2");

    const v = await t.query(internal.maya.spendCeiling.spendToday, {
      customerId,
      now: NOW,
    });
    expect(v.spentUsd).toBe(3.5);
    expect(v.state).toBe("normal");
  });

  it("throttles once the day's spend passes the ceiling", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "over");
    await spend(t, customerId, 6, "big");
    const v = await t.query(internal.maya.spendCeiling.spendToday, {
      customerId,
      now: NOW,
    });
    expect(v.state).toBe("throttled");
  });

  it("yesterday's spend doesn't count against today", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "rollover");
    await spend(t, customerId, 99, "yesterday", NOW - 86_400_000);
    const v = await t.query(internal.maya.spendCeiling.spendToday, {
      customerId,
      now: NOW,
    });
    expect(v.spentUsd).toBe(0);
    expect(v.state).toBe("normal");
  });

  it("THROTTLING IS PER CUSTOMER, never fleet-wide", async () => {
    // One runaway must not degrade the other 199.
    const t = convexTest(schema, modules);
    const runaway = await seed(t, "runaway");
    const innocent = await seed(t, "innocent");
    await spend(t, runaway, 50, "burn");

    expect(
      (
        await t.query(internal.maya.spendCeiling.spendToday, {
          customerId: runaway,
          now: NOW,
        })
      ).state
    ).toBe("throttled");
    expect(
      (
        await t.query(internal.maya.spendCeiling.spendToday, {
          customerId: innocent,
          now: NOW,
        })
      ).state
    ).toBe("normal");
  });

  it("a job with no recorded cost contributes nothing rather than NaN", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "nocost");
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "produce_post",
      idempotencyKey: "free",
      customerId,
    });
    const v = await t.query(internal.maya.spendCeiling.spendToday, {
      customerId,
      now: NOW,
    });
    expect(v.spentUsd).toBe(0);
  });
});

describe("recordCost", () => {
  it("accumulates rather than overwrites", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "accum");
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "render_video",
      idempotencyKey: "r1",
      customerId,
    });
    await t.mutation(internal.maya.spendCeiling.recordCost, { jobId, costUsd: 1 });
    await t.mutation(internal.maya.spendCeiling.recordCost, { jobId, costUsd: 0.5 });

    const job = (await t.run((ctx) => ctx.db.get(jobId))) as Doc<"jobs">;
    expect(job.costUsd).toBe(1.5);
  });

  it("A FAILED JOB STILL COUNTS ITS SPEND", async () => {
    // A render that errored after the vendor charged, or an LLM call that
    // timed out mid-stream, still cost money. Tying cost to success would
    // under-count exactly the runaway case the ceiling exists to catch.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "failed_spend");
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "render_video",
      idempotencyKey: "r2",
      customerId,
    });
    // ⚠️ `enqueue` stamps `createdAt` from the real clock while this asserts
    // against the frozen NOW. That mismatch was invisible while "today" was a
    // UTC division; now that spend is counted in the FOUNDER's day, a fixture
    // created today and read at a 2026 date is genuinely not the same day.
    // Pin it, rather than widening the window to hide it.
    await t.run((ctx) => ctx.db.patch(jobId, { createdAt: NOW }));
    await t.mutation(internal.maya.jobs.claimNext, {});
    await t.mutation(internal.maya.spendCeiling.recordCost, { jobId, costUsd: 7 });
    await t.mutation(internal.maya.jobs.fail, { jobId, error: "vendor 500" });

    const v = await t.query(internal.maya.spendCeiling.spendToday, {
      customerId,
      now: NOW,
    });
    expect(v.spentUsd).toBe(7);
    expect(v.state).toBe("throttled");
  });

  it("a missing job is reported, not thrown", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "gone_job");
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "x",
      idempotencyKey: "g",
      customerId,
    });
    await t.run((ctx) => ctx.db.delete(jobId));
    expect(
      await t.mutation(internal.maya.spendCeiling.recordCost, { jobId, costUsd: 1 })
    ).toEqual({ recorded: false });
  });
});

describe("alertThrottled", () => {
  it("alerts the operator once", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "alert");
    const first = await t.mutation(internal.maya.spendCeiling.alertThrottled, {
      customerId,
      detail: "over budget",
      now: NOW,
    });
    expect(first.alerted).toBe(true);

    const events = (await t.run((ctx) =>
      ctx.db.query("gtmAuditEvents").collect()
    )) as Doc<"gtmAuditEvents">[];
    expect(events[0].eventType).toBe("spend.throttled");
    // A working safeguard is not an error. Treating it as one starts alert
    // fatigue, and then real errors get skimmed past.
    expect(events[0].severity).toBe("warn");
  });

  it("doesn't re-alert the same day for a condition already known", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "repeat");
    await t.mutation(internal.maya.spendCeiling.alertThrottled, {
      customerId,
      detail: "over budget",
      now: NOW,
    });
    const second = await t.mutation(internal.maya.spendCeiling.alertThrottled, {
      customerId,
      detail: "over budget",
      now: NOW + 3600_000,
    });
    expect(second.alerted).toBe(false);
    expect(
      await t.run((ctx) => ctx.db.query("gtmAuditEvents").collect())
    ).toHaveLength(1);
  });

  it("alerts again the next day, because it's a new day's budget", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "nextday");
    await t.mutation(internal.maya.spendCeiling.alertThrottled, {
      customerId,
      detail: "over",
      now: NOW,
    });
    const tomorrow = await t.mutation(internal.maya.spendCeiling.alertThrottled, {
      customerId,
      detail: "over",
      now: NOW + 86_400_000,
    });
    expect(tomorrow.alerted).toBe(true);
  });
});

describe("the drainer enforces the ceiling — where it actually matters", () => {
  it("expensive work is DEFERRED when throttled, and the operator is told", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "drain_throttled");
    await spend(t, customerId, 20, "burned");
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "produce_post",
      idempotencyKey: "p1",
      customerId,
    });

    const result = await t.action(internal.maya.scheduler.drainJobs, { now: NOW });
    expect(result.throttled).toBe(1);
    expect(result.succeeded).toBe(0);

    const events = (await t.run((ctx) =>
      ctx.db.query("gtmAuditEvents").collect()
    )) as Doc<"gtmAuditEvents">[];
    expect(events.some((e) => e.eventType === "spend.throttled")).toBe(true);
  });

  it("BUT A QUEUED MESSAGE STILL GOES OUT", async () => {
    // The property that separates a throttle from an outage. She has burned
    // her budget and she is still talking to the founder.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "still_talks");
    await spend(t, customerId, 20, "burned");
    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "your X token expired",
      dedupeKey: "urgent",
    });

    const result = await t.action(internal.maya.scheduler.drainJobs, { now: NOW });
    expect(result.throttled).toBe(0);
    // It was attempted (and fails only because no chat is paired in this test),
    // rather than being deferred by the ceiling.
    expect(result.claimed).toBe(1);
    const delivery = (
      (await t.run((ctx) => ctx.db.query("jobs").collect())) as Doc<"jobs">[]
    ).find((j) => j.kind === "deliver_message")!;
    expect(delivery.lastError ?? "").not.toMatch(/deferred/);
  });

  it("a deferred job goes back to the QUEUE, not to dead — it runs tomorrow", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "deferred");
    await spend(t, customerId, 20, "burned");
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "render_video",
      idempotencyKey: "r9",
      customerId,
    });
    await t.action(internal.maya.scheduler.drainJobs, { now: NOW });

    const job = (await t.run((ctx) => ctx.db.get(jobId))) as Doc<"jobs">;
    expect(job.status).toBe("queued");
    expect(job.lastError).toMatch(/deferred/);
  });

  it("an under-budget customer runs normally alongside a throttled one", async () => {
    const t = convexTest(schema, modules);
    const broke = await seed(t, "broke");
    const fine = await seed(t, "fine");
    await spend(t, broke, 20, "burned");
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "produce_post",
      idempotencyKey: "b1",
      customerId: broke,
    });
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "produce_post",
      idempotencyKey: "f1",
      customerId: fine,
    });

    const result = await t.action(internal.maya.scheduler.drainJobs, { now: NOW });
    expect(result.throttled).toBe(1);
    // The other one reached its handler — no handler for produce_post yet, so
    // it fails on that rather than on the ceiling.
    expect(result.failed).toBe(1);
  });
});

describe("the ceiling is not a time bomb", () => {
  it("THROTTLES REGARDLESS OF WHEN THE SUITE RUNS", async () => {
    // This suite passed all day on 2026-08-01 and started failing at UTC
    // midnight. The drainer derived "today" from the real clock while the
    // fixtures seeded spend at a frozen date, so once UTC rolled past that
    // date the seeded spend fell outside today's window, read $0, and nothing
    // throttled. Green for hours, then red, with no code change.
    //
    // Fixed by threading `now` through the drainer — the same seam
    // `spendToday` already had. Pinned here across a day boundary so the bomb
    // can't be re-armed by someone dropping the argument.
    for (const at of [
      Date.UTC(2026, 0, 1, 0, 0, 0), // midnight exactly
      Date.UTC(2026, 0, 1, 23, 59, 59), // one second to rollover
      Date.UTC(2026, 11, 31, 23, 0, 0), // year boundary
    ]) {
      const t = convexTest(schema, modules);
      const customerId = await seed(t, `bomb_${at}`);
      await spend(t, customerId, 20, `burned_${at}`, at);
      await t.mutation(internal.maya.jobs.enqueue, {
        kind: "produce_post",
        idempotencyKey: `p_${at}`,
        customerId,
      });

      const result = await t.action(internal.maya.scheduler.drainJobs, {
        now: at,
      });
      expect(result.throttled, `not throttled at ${new Date(at).toISOString()}`).toBe(1);
    }
  });
});
