import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { seedCreator as seedCreatorRow } from "../../../tests/lib/creatorRow";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";
import { backoffMs, DEFAULT_MAX_ATTEMPTS } from "../jobs";
import { minimalRow, type InsertCtx } from "../../../tests/lib/minimalRow";

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

async function seedCreator(t: ReturnType<typeof convexTest>, suffix: string) {
  return await t.run(async (ctx) => seedCreatorRow(ctx, suffix, { timezone: "UTC" }));
}

describe("enqueue — idempotent by key", () => {
  it("the same work enqueued twice runs once", async () => {
    // Watchers fire on overlapping schedules and retries race with crons.
    // Dedupe belongs in the queue, not in fifteen call sites.
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.core.jobs.enqueue, {
      kind: "morning_brief",
      idempotencyKey: "brief:2026-07-31",
    });
    const second = await t.mutation(internal.core.jobs.enqueue, {
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
    await t.mutation(internal.core.jobs.enqueue, {
      kind: "sweep",
      idempotencyKey: "sweep:1",
    });
    await t.mutation(internal.core.jobs.claimNext, {});
    const again = await t.mutation(internal.core.jobs.enqueue, {
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
    const first = await t.mutation(internal.core.jobs.enqueue, {
      kind: "retryable",
      idempotencyKey: "k",
    });
    await t.mutation(internal.core.jobs.claimNext, {});
    await t.mutation(internal.core.jobs.succeed, { jobId: first.jobId });

    const second = await t.mutation(internal.core.jobs.enqueue, {
      kind: "retryable",
      idempotencyKey: "k",
    });
    expect(second.created).toBe(true);
    expect(second.jobId).not.toBe(first.jobId);
  });

  it("carries the creator through, and tolerates fleet-wide work with none", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seedCreator(t, "jobs_scope");
    await t.mutation(internal.core.jobs.enqueue, {
      kind: "per_creator",
      idempotencyKey: "a",
      creatorId,
    });
    await t.mutation(internal.core.jobs.enqueue, {
      kind: "fleet_wide",
      idempotencyKey: "b",
    });
    const rows = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(rows.find((r) => r.kind === "per_creator")?.creatorId).toBe(creatorId);
    expect(rows.find((r) => r.kind === "fleet_wide")?.creatorId).toBeUndefined();
  });
});

describe("claimNext — exclusive", () => {
  it("two claims never hand out the same job", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.core.jobs.enqueue, {
      kind: "only_one",
      idempotencyKey: "solo",
    });
    const a = await t.mutation(internal.core.jobs.claimNext, {});
    const b = await t.mutation(internal.core.jobs.claimNext, {});
    expect(a?._id).toBeDefined();
    expect(b).toBeNull();
  });

  it("claiming increments attempts and marks the job running", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.core.jobs.enqueue, {
      kind: "k",
      idempotencyKey: "i",
    });
    const claimed = await t.mutation(internal.core.jobs.claimNext, {});
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
  });

  it("a job scheduled for later is not claimable yet", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.core.jobs.enqueue, {
      kind: "later",
      idempotencyKey: "l",
      runAfter: Date.now() + 60_000,
    });
    expect(await t.mutation(internal.core.jobs.claimNext, {})).toBeNull();
  });

  it("kinds filter lets a specialized worker take only its own work", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.core.jobs.enqueue, {
      kind: "render_video",
      idempotencyKey: "v",
    });
    await t.mutation(internal.core.jobs.enqueue, {
      kind: "send_message",
      idempotencyKey: "m",
    });
    const claimed = await t.mutation(internal.core.jobs.claimNext, {
      kinds: ["send_message"],
    });
    expect(claimed?.kind).toBe("send_message");
  });

  it("an empty queue is null, not an error", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(internal.core.jobs.claimNext, {})).toBeNull();
  });
});

describe("fail — bounded, and never silent", () => {
  it("retries with backoff while under the cap", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await t.mutation(internal.core.jobs.enqueue, {
      kind: "flaky",
      idempotencyKey: "f",
    });
    await t.mutation(internal.core.jobs.claimNext, {});
    const result = await t.mutation(internal.core.jobs.fail, {
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
    const { jobId } = await t.mutation(internal.core.jobs.enqueue, {
      kind: "doomed",
      idempotencyKey: "d",
      maxAttempts: 2,
    });

    await t.mutation(internal.core.jobs.claimNext, {});
    expect(
      (await t.mutation(internal.core.jobs.fail, { jobId, error: "1st" })).status
    ).toBe("queued");

    await t.run((ctx) => ctx.db.patch(jobId, { runAfter: Date.now() - 1 }));
    await t.mutation(internal.core.jobs.claimNext, {});
    const second = await t.mutation(internal.core.jobs.fail, {
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
    const creatorId = await seedCreator(t, "dead_letters");
    const { jobId } = await t.mutation(internal.core.jobs.enqueue, {
      kind: "doomed",
      idempotencyKey: "dl",
      creatorId,
      maxAttempts: 1,
    });
    await t.mutation(internal.core.jobs.claimNext, {});
    await t.mutation(internal.core.jobs.fail, { jobId, error: "gone" });

    const dead = await t.query(internal.core.jobs.deadLetters, { creatorId });
    expect(dead).toHaveLength(1);
    expect(dead[0].lastError).toBe("gone");
  });

  it("dead letters are filterable per creator", async () => {
    const t = convexTest(schema, modules);
    const a = await seedCreator(t, "dl_a");
    const b = await seedCreator(t, "dl_b");
    for (const [creatorId, key] of [
      [a, "ka"],
      [b, "kb"],
    ] as const) {
      const { jobId } = await t.mutation(internal.core.jobs.enqueue, {
        kind: "doomed",
        idempotencyKey: key,
        creatorId,
        maxAttempts: 1,
      });
      await t.mutation(internal.core.jobs.claimNext, {});
      await t.mutation(internal.core.jobs.fail, { jobId, error: "x" });
    }
    const forA = await t.query(internal.core.jobs.deadLetters, { creatorId: a });
    expect(forA).toHaveLength(1);
    expect(forA[0].creatorId).toBe(a);
  });

  it("failing an already-deleted job doesn't throw", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await t.mutation(internal.core.jobs.enqueue, {
      kind: "k",
      idempotencyKey: "gone",
    });
    await t.run((ctx) => ctx.db.delete(jobId));
    await expect(
      t.mutation(internal.core.jobs.fail, { jobId, error: "e" })
    ).resolves.toBeDefined();
  });
});

describe("reapExpired — running is not a place jobs can live forever", () => {
  it("requeues a job whose worker died mid-run", async () => {
    // Invariant 8: without the reaper, `running` is a permanent non-terminal
    // state — nothing else ever touches those rows again.
    const t = convexTest(schema, modules);
    const { jobId } = await t.mutation(internal.core.jobs.enqueue, {
      kind: "crashed",
      idempotencyKey: "c",
    });
    await t.mutation(internal.core.jobs.claimNext, {});
    await t.run((ctx) => ctx.db.patch(jobId, { deadlineAt: Date.now() - 1 }));

    const result = await t.mutation(internal.core.jobs.reapExpired, {});
    expect(result.requeued).toBe(1);
    const row = await getJob(t, jobId);
    expect(row?.status).toBe("queued");
    expect(row?.lastError).toMatch(/lease expired/);
  });

  it("declares it dead instead when attempts are already exhausted", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await t.mutation(internal.core.jobs.enqueue, {
      kind: "crashed",
      idempotencyKey: "c2",
      maxAttempts: 1,
    });
    await t.mutation(internal.core.jobs.claimNext, {});
    await t.run((ctx) => ctx.db.patch(jobId, { deadlineAt: Date.now() - 1 }));

    const result = await t.mutation(internal.core.jobs.reapExpired, {});
    expect(result.dead).toBe(1);
    expect((await getJob(t, jobId))?.status).toBe("dead");
  });

  it("leaves a job whose lease is still valid alone", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.core.jobs.enqueue, {
      kind: "healthy",
      idempotencyKey: "h",
    });
    await t.mutation(internal.core.jobs.claimNext, {});
    const result = await t.mutation(internal.core.jobs.reapExpired, {});
    expect(result).toEqual({ requeued: 0, dead: 0 });
  });

  it("a reclaimed job gets a fresh lease, not the dead worker's leftovers", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await t.mutation(internal.core.jobs.enqueue, {
      kind: "relaunch",
      idempotencyKey: "r",
    });
    await t.mutation(internal.core.jobs.claimNext, {});
    await t.run((ctx) =>
      ctx.db.patch(jobId, { deadlineAt: Date.now() - 1, runAfter: Date.now() - 1 })
    );
    await t.mutation(internal.core.jobs.reapExpired, {});
    await t.run((ctx) => ctx.db.patch(jobId, { runAfter: Date.now() - 1 }));

    const reclaimed = await t.mutation(internal.core.jobs.claimNext, {});
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

/* -------------------------------------------------------------------------- */

/**
 * ⭐ Sprint 9's render queue: *"fair-share, deadline priority"*.
 *
 * ⚠️ The failure this prevents is starvation, not slowness. Until now
 * `claimNext` took whatever sorted first by `runAfter` — first-come-first-
 * served — so one founder approving twenty videos in a burst would occupy the
 * queue in arrival order and the other 199 would wait behind them. Nothing
 * looks broken: every job succeeds and the log is clean. The only symptom is
 * that everyone else's placement is late, on the one day the queue is under
 * load, which is when a missed slot costs the most.
 */
describe("the queue is fair before it is fast", () => {
  const seedJob = async (
    t: ReturnType<typeof convexTest>,
    creatorId: string,
    over: Record<string, unknown>
  ) =>
    await t.run(async (ctx) => {
      const c = ctx as unknown as {
        db: { insert: (table: string, value: unknown) => Promise<string> };
      };
      return await c.db.insert("jobs", {
        creatorId,
        kind: "render_video",
        idempotencyKey: `k_${Math.round(Number(over.runAfter ?? 0))}_${creatorId}`,
        status: "queued",
        attempts: 0,
        maxAttempts: 3,
        runAfter: 0,
        deadlineAt: 10_000_000,
        createdAt: 0,
        updatedAt: 0,
        ...over,
      });
    });

  it("⭐ a busy creator does not starve an idle one", async () => {
    const t = convexTest(schema, modules);
    const { busy, idle } = await t.run(async (ctx) => {
      const c = ctx as unknown as {
        db: { insert: (table: string, value: unknown) => Promise<string> };
      };
      const mk = async (who: string) => {
        const creator = await c.db.insert(
          "creators",
          await minimalRow(ctx as InsertCtx, "creators", {
            clerkUserId: who,
            email: `${who}@e.com`,
          })
        );
        return await c.db.insert(
          "creators",
          await minimalRow(ctx as InsertCtx, "creators", { clerkUserId: creator })
        );
      };
      return { busy: await mk("busy"), idle: await mk("idle") };
    });

    // The busy account already has one in flight, and queued FIRST.
    await seedJob(t, busy, { status: "running", runAfter: 0 });
    await seedJob(t, busy, { runAfter: 1 });
    // The idle account queued later — and should still go next.
    await seedJob(t, idle, { runAfter: 2 });

    const claimed = await t.mutation(internal.core.jobs.claimNext, {});
    expect(claimed?.creatorId).toBe(idle);
  });

  it("⭐ within one creator, the tightest deadline goes first", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) => {
      const c = ctx as unknown as {
        db: { insert: (table: string, value: unknown) => Promise<string> };
      };
      const creator = await c.db.insert(
        "creators",
        await minimalRow(ctx as InsertCtx, "creators", {
          clerkUserId: "solo",
          email: "solo@e.com",
        })
      );
      return await c.db.insert(
        "creators",
        await minimalRow(ctx as InsertCtx, "creators", { clerkUserId: creator })
      );
    });

    // Queued first, but due in six hours.
    await seedJob(t, creatorId, { runAfter: 0, deadlineAt: 9_000_000 });
    // Queued second, due in thirty minutes — this one is about to miss its slot.
    const urgent = await seedJob(t, creatorId, {
      runAfter: 1,
      deadlineAt: 1_000,
    });

    const claimed = await t.mutation(internal.core.jobs.claimNext, {});
    expect(claimed?._id).toBe(urgent);
  });

  it("⚠️ still refuses work that isn't due yet", async () => {
    // Fair-share must not reach past `runAfter`. A staged render sits at
    // MAX_SAFE_INTEGER precisely so no worker can claim it before the founder
    // approves — an ordering change that ignored that would render unapproved
    // videos, which is the one failure §7.5.36 exists to prevent.
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) => {
      const c = ctx as unknown as {
        db: { insert: (table: string, value: unknown) => Promise<string> };
      };
      const creator = await c.db.insert(
        "creators",
        await minimalRow(ctx as InsertCtx, "creators", {
          clerkUserId: "staged",
          email: "staged@e.com",
        })
      );
      return await c.db.insert(
        "creators",
        await minimalRow(ctx as InsertCtx, "creators", { clerkUserId: creator })
      );
    });

    await seedJob(t, creatorId, { runAfter: Number.MAX_SAFE_INTEGER });
    expect(await t.mutation(internal.core.jobs.claimNext, {})).toBeNull();
  });
});
