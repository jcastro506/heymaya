/**
 * Queue starvation (live 2026-09-24): a shared reel's turn sat queued and never ran.
 * Turns drained one after another inline, 275 deliveries to never-paired bench clones
 * re-deferred forever at the head of the queue, and no inbound door kicked the drain.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { DEFER_GIVE_UP_MS, SERIAL_KINDS } from "../jobs";
import { TURN_KINDS } from "../scheduler";

type T = ReturnType<typeof convexTest>;

async function queueTurn(t: T, creatorId: Id<"creators">, key: string, createdAt: number) {
  return await t.run((ctx) => ctx.db.insert("jobs", { creatorId, kind: "converse", idempotencyKey: key, status: "queued", attempts: 0, maxAttempts: 3, payloadJson: "{}", runAfter: createdAt, deadlineAt: createdAt + 300_000, createdAt, updatedAt: createdAt }));
}

describe("turns: one at a time per creator, in parallel across creators", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("a creator's second text waits for the first; another creator's turn does not", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b"));
    const now = Date.now();
    const a2 = await queueTurn(t, a, "converse:a2", now - 1000);
    const a1 = await queueTurn(t, a, "converse:a1", now - 2000);
    const b1 = await queueTurn(t, b, "converse:b1", now - 500);

    const first = await t.mutation(internal.core.jobs.claimNext, { kinds: ["converse"] });
    const second = await t.mutation(internal.core.jobs.claimNext, { kinds: ["converse"] });
    expect(new Set([first?._id, second?._id]), "A's oldest and B's run together").toEqual(new Set([a1, b1]));
    expect(await t.mutation(internal.core.jobs.claimNext, { kinds: ["converse"] }), "A's second waits").toBeNull();

    await t.mutation(internal.core.jobs.succeed, { jobId: a1 });
    expect((await t.mutation(internal.core.jobs.claimNext, { kinds: ["converse"] }))?._id, "then A's second, in order").toBe(a2);
  });

  it("the drain hands every turn to its own action instead of running it inline", async () => {
    expect(TURN_KINDS.has("converse")).toBe(true);
    expect(SERIAL_KINDS.has("converse")).toBe(true);
    const t = convexTest(schema, modules);
    const now = Date.now();
    for (const s of ["a", "b", "c"]) {
      const id = await t.run((ctx) => seedCreator(ctx, s));
      await queueTurn(t, id, `converse:${s}`, now - 1000);
    }
    const r = await t.action(internal.core.scheduler.drainJobs, { kinds: ["converse"] });
    expect(r).toEqual({ claimed: 3, succeeded: 0, failed: 0 });
    const running = (await t.run((ctx) => ctx.db.query("jobs").collect())).filter((j) => j.status === "running");
    expect(running.length, "three creators, three turns in flight at once").toBe(3);
  });

  it("a queued turn kicks the drain itself; nothing waits for the cron tick", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    await t.mutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: "converse:kick", creatorId: a, payloadJson: "{}" });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((s) => s.name)).toContain("core/scheduler:drainJobs");
    // A delivery is not a turn: it does not kick (deliverNow covers the senders that wait on one).
    const t2 = convexTest(schema, modules);
    const b = await t2.run((ctx) => seedCreator(ctx, "b"));
    await t2.mutation(internal.core.jobs.enqueue, { kind: "deliver_message", idempotencyKey: "deliver:x", creatorId: b, payloadJson: "{}" });
    expect(await t2.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });
});

describe("a delivery that can never land stops being retried after 24h", () => {
  it("defers under 24h, then dies with a named reason; pairing still revives it", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const now = Date.now();
    const base = { creatorId: a, kind: "deliver_message", status: "running" as const, attempts: 1, maxAttempts: 5, payloadJson: "{}", runAfter: now, deadlineAt: now + 300_000, updatedAt: now };
    const young = await t.run((ctx) => ctx.db.insert("jobs", { ...base, idempotencyKey: "deliver:young", createdAt: now - 60_000 }));
    const old = await t.run((ctx) => ctx.db.insert("jobs", { ...base, idempotencyKey: "deliver:old", createdAt: now - DEFER_GIVE_UP_MS - 1 }));
    for (const jobId of [young, old]) await t.mutation(internal.core.jobs.defer, { jobId, delayMs: 600_000, reason: "no Telegram chat paired" });

    expect((await t.run((ctx) => ctx.db.get(young)))?.status).toBe("queued");
    const dead = await t.run((ctx) => ctx.db.get(old));
    expect(dead?.status).toBe("dead");
    expect(dead?.lastError).toContain("no Telegram chat paired");

    await t.mutation(internal.core.jobs.wakeDeliveries, { creatorId: a });
    expect((await t.run((ctx) => ctx.db.get(old)))?.status, "they paired after all: it goes").toBe("queued");
  });
});

describe("an eval persona never queues a delivery", () => {
  it("a bench clone's message is written but not queued; a real creator's is both (cross-tenant)", async () => {
    const t = convexTest(schema, modules);
    const clone = await t.run((ctx) => seedCreator(ctx, "clone", { clerkUserId: "eval-run:r1:abc" }));
    const persona = await t.run((ctx) => seedCreator(ctx, "persona", { clerkUserId: "eval:brettconti" }));
    const real = await t.run((ctx) => seedCreator(ctx, "real", { clerkUserId: "user_evalyn" }));
    for (const creatorId of [clone, persona, real]) {
      await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "hi", dedupeKey: `hi:${creatorId}`, proactive: false, kind: "reply" });
    }
    const messages = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(messages.length).toBe(3);
    const deliveries = (await t.run((ctx) => ctx.db.query("jobs").collect())).filter((j) => j.kind === "deliver_message");
    expect(deliveries.map((j) => j.creatorId)).toEqual([real]);
  });
});
