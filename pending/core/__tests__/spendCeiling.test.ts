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
  state: "active" | "paused" = "active",
): Promise<Id<"creators">> {
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
    return await ctx.db.insert("creators", {
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

/**
 * ⚠️ Seeds a `costEvents` row, NOT a job.
 *
 * These tests used to insert `jobs` with a `costUsd` — and passed, while
 * production was broken: nothing in the live module ever wrote that field.
 * `spendCeiling.recordCost` is its only writer and had no caller, so
 * `spentUsd` was always 0 and the ceiling could never fire.
 *
 * The fixture was validating a path production never takes. `costEvents` is
 * what `cogs.record` actually writes, from the sweeps, critics and renders
 * this ceiling exists to throttle.
 */
async function spend(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  costUsd: number,
  key: string,
  createdAt = NOW,
) {
  await t.run((ctx) =>
    ctx.db.insert("costEvents", {
      creatorId,
      at: createdAt,
      vendor: "openrouter",
      purpose: key,
      costUsd,
    }),
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
    const code = source
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const forbidden of [
      "destroyApp",
      "destroyMachine",
      "killMachine",
      "shutdown",
      "stopMachine",
      "deleteApp",
    ]) {
      expect(code, `spendCeiling must never ${forbidden}`).not.toContain(
        forbidden,
      );
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
    const creatorId = await seed(t, "sum");
    await spend(t, creatorId, 1.5, "j1");
    await spend(t, creatorId, 2.0, "j2");

    const v = await t.query(internal.maya.spendCeiling.spendToday, {
      creatorId,
      now: NOW,
    });
    expect(v.spentUsd).toBe(3.5);
    expect(v.state).toBe("normal");
  });

  it("throttles once the day's spend passes the ceiling", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "over");
    await spend(t, creatorId, 6, "big");
    const v = await t.query(internal.maya.spendCeiling.spendToday, {
      creatorId,
      now: NOW,
    });
    expect(v.state).toBe("throttled");
  });

  it("yesterday's spend doesn't count against today", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "rollover");
    await spend(t, creatorId, 99, "yesterday", NOW - 86_400_000);
    const v = await t.query(internal.maya.spendCeiling.spendToday, {
      creatorId,
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
          creatorId: runaway,
          now: NOW,
        })
      ).state,
    ).toBe("throttled");
    expect(
      (
        await t.query(internal.maya.spendCeiling.spendToday, {
          creatorId: innocent,
          now: NOW,
        })
      ).state,
    ).toBe("normal");
  });

  it("a job with no recorded cost contributes nothing rather than NaN", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "nocost");
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "produce_post",
      idempotencyKey: "free",
      creatorId,
    });
    const v = await t.query(internal.maya.spendCeiling.spendToday, {
      creatorId,
      now: NOW,
    });
    expect(v.spentUsd).toBe(0);
  });
});

/**
 * ⚠️ The `recordCost` suite was removed 2026-08-12 along with the function.
 *
 * It stamped cost onto `jobs.costUsd` — a ledger NOTHING reads since
 * `spendToday` was repointed at `costEvents`, which is what `cogs.record`
 * actually writes. These tests passed for months while the ceiling they
 * belonged to could never fire, because the fixture wrote a field production
 * never wrote.
 *
 * The property they protected — spend before a failure still counts — is kept
 * in "SPEND BEFORE A FAILURE STILL COUNTS" above, asserted through the real
 * ledger.
 */

describe("alertThrottled", () => {
  it("alerts the operator once", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "alert");
    const first = await t.mutation(internal.maya.spendCeiling.alertThrottled, {
      creatorId,
      detail: "over budget",
      now: NOW,
    });
    expect(first.alerted).toBe(true);

    const events = (await t.run((ctx) =>
      ctx.db.query("gtmAuditEvents").collect(),
    )) as Doc<"gtmAuditEvents">[];
    expect(events[0].eventType).toBe("spend.throttled");
    // A working safeguard is not an error. Treating it as one starts alert
    // fatigue, and then real errors get skimmed past.
    expect(events[0].severity).toBe("warn");
  });

  it("doesn't re-alert the same day for a condition already known", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "repeat");
    await t.mutation(internal.maya.spendCeiling.alertThrottled, {
      creatorId,
      detail: "over budget",
      now: NOW,
    });
    const second = await t.mutation(internal.maya.spendCeiling.alertThrottled, {
      creatorId,
      detail: "over budget",
      now: NOW + 3600_000,
    });
    expect(second.alerted).toBe(false);
    expect(
      await t.run((ctx) => ctx.db.query("gtmAuditEvents").collect()),
    ).toHaveLength(1);
  });

  it("alerts again the next day, because it's a new day's budget", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "nextday");
    await t.mutation(internal.maya.spendCeiling.alertThrottled, {
      creatorId,
      detail: "over",
      now: NOW,
    });
    const tomorrow = await t.mutation(
      internal.maya.spendCeiling.alertThrottled,
      {
        creatorId,
        detail: "over",
        now: NOW + 86_400_000,
      },
    );
    expect(tomorrow.alerted).toBe(true);
  });
});

describe("the drainer enforces the ceiling — where it actually matters", () => {
  it("expensive work is DEFERRED when throttled, and the operator is told", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "drain_throttled");
    await spend(t, creatorId, 20, "burned");
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "produce_post",
      idempotencyKey: "p1",
      creatorId,
    });

    const result = await t.action(internal.maya.scheduler.drainJobs, {
      now: NOW,
    });
    expect(result.throttled).toBe(1);
    expect(result.succeeded).toBe(0);

    const events = (await t.run((ctx) =>
      ctx.db.query("gtmAuditEvents").collect(),
    )) as Doc<"gtmAuditEvents">[];
    expect(events.some((e) => e.eventType === "spend.throttled")).toBe(true);
  });

  it("BUT A QUEUED MESSAGE STILL GOES OUT", async () => {
    // The property that separates a throttle from an outage. She has burned
    // her budget and she is still talking to the founder.
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "still_talks");
    await spend(t, creatorId, 20, "burned");
    await t.mutation(internal.maya.messages.send, {
      creatorId,
      surface: "telegram",
      body: "your X token expired",
      dedupeKey: "urgent",
    });

    const result = await t.action(internal.maya.scheduler.drainJobs, {
      now: NOW,
    });
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
    const creatorId = await seed(t, "deferred");
    await spend(t, creatorId, 20, "burned");
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "render_video",
      idempotencyKey: "r9",
      creatorId,
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
      creatorId: broke,
    });
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "produce_post",
      idempotencyKey: "f1",
      creatorId: fine,
    });

    const result = await t.action(internal.maya.scheduler.drainJobs, {
      now: NOW,
    });
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
      const creatorId = await seed(t, `bomb_${at}`);
      await spend(t, creatorId, 20, `burned_${at}`, at);
      await t.mutation(internal.maya.jobs.enqueue, {
        kind: "produce_post",
        idempotencyKey: `p_${at}`,
        creatorId,
      });

      const result = await t.action(internal.maya.scheduler.drainJobs, {
        now: at,
      });
      expect(
        result.throttled,
        `not throttled at ${new Date(at).toISOString()}`,
      ).toBe(1);
    }
  });
});

/* -------------------------------------------------------------------------- */

/**
 * ⭐ The loop the old suite never closed.
 *
 * Every existing test seeded the ledger by hand. None of them went through the
 * function production actually calls — so the suite was green while
 * `spendToday` read a field nothing wrote, and the ceiling could never fire.
 */
describe("the ceiling fires from the writer production uses", () => {
  it("⭐ cogs.record reaches spendToday", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "real_writer");

    // The real writer — called from llm.ts, imagery.ts and formats.ts.
    await t.mutation(internal.maya.cogs.record, {
      creatorId,
      vendor: "openrouter",
      purpose: "safety_critic",
      costUsd: 2.5,
      now: NOW,
    });

    const v = await t.query(internal.maya.spendCeiling.spendToday, {
      creatorId,
      now: NOW,
    });
    expect(v.spentUsd).toBe(2.5);
  });

  it("⚠️ throttles once real recorded spend passes the ceiling", async () => {
    /**
     * The property the whole module exists for, asserted end to end for the
     * first time. Previously `spentUsd` was structurally 0, so `state` was
     * structurally "normal" — the valve was decoration.
     */
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "real_throttle");

    const ceiling = (
      await t.query(internal.maya.spendCeiling.spendToday, {
        creatorId,
        now: NOW,
      })
    ).ceilingUsd;

    await t.mutation(internal.maya.cogs.record, {
      creatorId,
      vendor: "openrouter",
      purpose: "research_sweep",
      costUsd: ceiling + 1,
      now: NOW,
    });

    const v = await t.query(internal.maya.spendCeiling.spendToday, {
      creatorId,
      now: NOW,
    });
    expect(v.state).toBe("throttled");
  });
});
