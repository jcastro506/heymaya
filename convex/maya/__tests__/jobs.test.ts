import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";
import { backoffMs, DEFAULT_MAX_ATTEMPTS } from "../jobs";

const NOW = Date.UTC(2026, 6, 31, 9, 0, 0);

/**
 * The schema is at TypeScript's instantiation ceiling, so `ctx.db.get()` no
 * longer narrows — it returns a union of every table's document type. This
 * re-narrows at the one place tests read a job back. See the PR body: it's a
 * standing constraint on the schema, not a quirk of this file.
 */
async function getJob(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"jobs">
): Promise<Doc<"jobs"> | null> {
  return (await t.run((ctx) => ctx.db.get(jobId))) as Doc<"jobs"> | null;
}

async function seedCustomer(t: ReturnType<typeof convexTest>, suffix: string) {
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
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

describe("enqueue — idempotent by key", () => {
  it("the same work enqueued twice runs once", async () => {
    // Watchers fire on overlapping schedules and retries race with crons.
    // Dedupe belongs in the queue, not in fifteen call sites.
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "morning_brief",
      idempotencyKey: "brief:2026-07-31",
    });
    const second = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "morning_brief",
      idempotencyKey: "brief:2026-07-31",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.jobId).toBe(first.jobId);

    const rows = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(rows).toHaveLength(1);
  });

  it("dedupes against a RUNNING job too, not just a queued one", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "sweep",
      idempotencyKey: "sweep:1",
    });
    await t.mutation(internal.maya.jobs.claimNext, {});
    const again = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "sweep",
      idempotencyKey: "sweep:1",
    });
    expect(again.created).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("jobs").collect())).toHaveLength(1);
  });

  it("but a key whose job already FINISHED can be enqueued again", async () => {
    // The key prevents concurrent duplicates, not a permanent one-time lock.
    // Uniqueness over time comes from date-stamping the key.
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "retryable",
      idempotencyKey: "k",
    });
    await t.mutation(internal.maya.jobs.claimNext, {});
    await t.mutation(internal.maya.jobs.succeed, { jobId: first.jobId });

    const second = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "retryable",
      idempotencyKey: "k",
    });
    expect(second.created).toBe(true);
    expect(second.jobId).not.toBe(first.jobId);
  });

  it("carries the customer through, and tolerates fleet-wide work with none", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "jobs_scope");
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "per_customer",
      idempotencyKey: "a",
      customerId,
    });
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "fleet_wide",
      idempotencyKey: "b",
    });
    const rows = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(rows.find((r) => r.kind === "per_customer")?.customerId).toBe(customerId);
    expect(rows.find((r) => r.kind === "fleet_wide")?.customerId).toBeUndefined();
  });
});

describe("claimNext — exclusive", () => {
  it("two claims never hand out the same job", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "only_one",
      idempotencyKey: "solo",
    });
    const a = await t.mutation(internal.maya.jobs.claimNext, {});
    const b = await t.mutation(internal.maya.jobs.claimNext, {});
    expect(a?._id).toBeDefined();
    expect(b).toBeNull();
  });

  it("claiming increments attempts and marks the job running", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "k",
      idempotencyKey: "i",
    });
    const claimed = await t.mutation(internal.maya.jobs.claimNext, {});
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
  });

  it("a job scheduled for later is not claimable yet", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "later",
      idempotencyKey: "l",
      runAfter: Date.now() + 60_000,
    });
    expect(await t.mutation(internal.maya.jobs.claimNext, {})).toBeNull();
  });

  it("kinds filter lets a specialized worker take only its own work", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "render_video",
      idempotencyKey: "v",
    });
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "send_message",
      idempotencyKey: "m",
    });
    const claimed = await t.mutation(internal.maya.jobs.claimNext, {
      kinds: ["send_message"],
    });
    expect(claimed?.kind).toBe("send_message");
  });

  it("an empty queue is null, not an error", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(internal.maya.jobs.claimNext, {})).toBeNull();
  });
});

describe("fail — bounded, and never silent", () => {
  it("retries with backoff while under the cap", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "flaky",
      idempotencyKey: "f",
    });
    await t.mutation(internal.maya.jobs.claimNext, {});
    const result = await t.mutation(internal.maya.jobs.fail, {
      jobId,
      error: "vendor 503",
    });

    expect(result.status).toBe("queued");
    const row = await getJob(t, jobId);
    expect(row?.lastError).toBe("vendor 503");
    expect(row?.runAfter).toBeGreaterThan(Date.now());
  });

  it("exhausting attempts moves the job to DEAD, keeping the error", async () => {
    // Dead is a queryable state on purpose. A job that ran out of attempts and
    // vanished is exactly the silent failure this module exists to prevent.
    const t = convexTest(schema, modules);
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "doomed",
      idempotencyKey: "d",
      maxAttempts: 2,
    });

    await t.mutation(internal.maya.jobs.claimNext, {});
    expect(
      (await t.mutation(internal.maya.jobs.fail, { jobId, error: "1st" })).status
    ).toBe("queued");

    await t.run((ctx) => ctx.db.patch(jobId, { runAfter: Date.now() - 1 }));
    await t.mutation(internal.maya.jobs.claimNext, {});
    const second = await t.mutation(internal.maya.jobs.fail, {
      jobId,
      error: "still broken",
    });

    expect(second.status).toBe("dead");
    const row = await getJob(t, jobId);
    expect(row?.status).toBe("dead");
    expect(row?.lastError).toBe("still broken");
  });

  it("a dead job surfaces in the dead-letter view", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seedCustomer(t, "dead_letters");
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "doomed",
      idempotencyKey: "dl",
      customerId,
      maxAttempts: 1,
    });
    await t.mutation(internal.maya.jobs.claimNext, {});
    await t.mutation(internal.maya.jobs.fail, { jobId, error: "gone" });

    const dead = await t.query(internal.maya.jobs.deadLetters, { customerId });
    expect(dead).toHaveLength(1);
    expect(dead[0].lastError).toBe("gone");
  });

  it("dead letters are filterable per customer", async () => {
    const t = convexTest(schema, modules);
    const a = await seedCustomer(t, "dl_a");
    const b = await seedCustomer(t, "dl_b");
    for (const [customerId, key] of [
      [a, "ka"],
      [b, "kb"],
    ] as const) {
      const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
        kind: "doomed",
        idempotencyKey: key,
        customerId,
        maxAttempts: 1,
      });
      await t.mutation(internal.maya.jobs.claimNext, {});
      await t.mutation(internal.maya.jobs.fail, { jobId, error: "x" });
    }
    const forA = await t.query(internal.maya.jobs.deadLetters, { customerId: a });
    expect(forA).toHaveLength(1);
    expect(forA[0].customerId).toBe(a);
  });

  it("failing an already-deleted job doesn't throw", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "k",
      idempotencyKey: "gone",
    });
    await t.run((ctx) => ctx.db.delete(jobId));
    await expect(
      t.mutation(internal.maya.jobs.fail, { jobId, error: "e" })
    ).resolves.toBeDefined();
  });
});

describe("reapExpired — running is not a place jobs can live forever", () => {
  it("requeues a job whose worker died mid-run", async () => {
    // Invariant 8: without the reaper, `running` is a permanent non-terminal
    // state — nothing else ever touches those rows again.
    const t = convexTest(schema, modules);
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "crashed",
      idempotencyKey: "c",
    });
    await t.mutation(internal.maya.jobs.claimNext, {});
    await t.run((ctx) => ctx.db.patch(jobId, { deadlineAt: Date.now() - 1 }));

    const result = await t.mutation(internal.maya.jobs.reapExpired, {});
    expect(result.requeued).toBe(1);
    const row = await getJob(t, jobId);
    expect(row?.status).toBe("queued");
    expect(row?.lastError).toMatch(/lease expired/);
  });

  it("declares it dead instead when attempts are already exhausted", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "crashed",
      idempotencyKey: "c2",
      maxAttempts: 1,
    });
    await t.mutation(internal.maya.jobs.claimNext, {});
    await t.run((ctx) => ctx.db.patch(jobId, { deadlineAt: Date.now() - 1 }));

    const result = await t.mutation(internal.maya.jobs.reapExpired, {});
    expect(result.dead).toBe(1);
    expect((await getJob(t, jobId))?.status).toBe("dead");
  });

  it("leaves a job whose lease is still valid alone", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.maya.jobs.enqueue, {
      kind: "healthy",
      idempotencyKey: "h",
    });
    await t.mutation(internal.maya.jobs.claimNext, {});
    const result = await t.mutation(internal.maya.jobs.reapExpired, {});
    expect(result).toEqual({ requeued: 0, dead: 0 });
  });

  it("a reclaimed job gets a fresh lease, not the dead worker's leftovers", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "relaunch",
      idempotencyKey: "r",
    });
    await t.mutation(internal.maya.jobs.claimNext, {});
    await t.run((ctx) =>
      ctx.db.patch(jobId, { deadlineAt: Date.now() - 1, runAfter: Date.now() - 1 })
    );
    await t.mutation(internal.maya.jobs.reapExpired, {});
    await t.run((ctx) => ctx.db.patch(jobId, { runAfter: Date.now() - 1 }));

    const reclaimed = await t.mutation(internal.maya.jobs.claimNext, {});
    expect(reclaimed?.deadlineAt).toBeGreaterThan(Date.now());
    expect(reclaimed?.attempts).toBe(2);
  });
});

describe("backoff", () => {
  it("grows with attempts and stops at a ceiling", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(99)).toBe(30 * 60 * 1000);
  });

  it("treats a zeroth attempt as the first rather than going negative", () => {
    expect(backoffMs(0)).toBe(30_000);
  });

  it("the default attempt cap is sane", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(DEFAULT_MAX_ATTEMPTS).toBeLessThan(10);
  });
});
