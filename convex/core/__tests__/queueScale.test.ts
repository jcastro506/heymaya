/**
 * Found by the 1,000-creator test (2026-09-24): with 219 turns "running" the busy check (a scan of
 * the first 200 running rows) missed creators, and a lease that expired while a turn waited in the
 * scheduler re-queued it, so two turns ran for one person. Categories: fail-closed, coherence.
 */
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { maxTurnsInFlight } from "../jobs";

async function world(nCreators: number) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => { const out = []; for (let i = 0; i < nCreators; i++) out.push(await seedCreator(ctx, `q${i}`)); return out; });
  return { t, ids };
}
const enqueue = (t: Awaited<ReturnType<typeof world>>["t"], creatorId: string, key: string) =>
  t.mutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: key, creatorId: creatorId as never, payloadJson: "{}" });

describe("the queue at scale", () => {
  it("never claims a second turn for a creator whose turn is running, even with 200+ others running", async () => {
    vi.stubEnv("MAX_TURNS_IN_FLIGHT", "1000");
    const { t, ids } = await world(3);
    // 210 running turns from other creators, older than the busy one
    await t.run(async (ctx) => { for (let i = 0; i < 210; i++) await ctx.db.insert("jobs", { kind: "converse", idempotencyKey: `x${i}`, creatorId: ids[1], payloadJson: "{}", status: "running", attempts: 1, maxAttempts: 3, runAfter: 0, deadlineAt: Date.now() + 60_000, createdAt: i, updatedAt: 0 } as never); });
    await t.run(async (ctx) => { await ctx.db.insert("jobs", { kind: "converse", idempotencyKey: "busy", creatorId: ids[0], payloadJson: "{}", status: "running", attempts: 1, maxAttempts: 3, runAfter: 0, deadlineAt: Date.now() + 60_000, createdAt: 999, updatedAt: 0 } as never); });
    await enqueue(t, ids[0], "a-next");
    await enqueue(t, ids[2], "c-first");
    const claimed = await t.mutation(internal.core.jobs.claimNext, {});
    expect(claimed?.idempotencyKey).toBe("c-first");
    expect(await t.mutation(internal.core.jobs.claimNext, {})).toBeNull();
    vi.unstubAllEnvs();
  });
  it("claims no more turns than the in-flight cap", async () => {
    vi.stubEnv("MAX_TURNS_IN_FLIGHT", "2");
    const { t, ids } = await world(4);
    for (const [i, id] of ids.entries()) await enqueue(t, id, `k${i}`);
    expect(await t.mutation(internal.core.jobs.claimNext, {})).not.toBeNull();
    expect(await t.mutation(internal.core.jobs.claimNext, {})).not.toBeNull();
    expect(await t.mutation(internal.core.jobs.claimNext, {})).toBeNull();
    expect(maxTurnsInFlight({})).toBe(12);
    vi.unstubAllEnvs();
  });
  it("a copy scheduled before its job was re-claimed refuses to start", async () => {
    const { t, ids } = await world(1);
    await enqueue(t, ids[0], "k");
    const job = (await t.mutation(internal.core.jobs.claimNext, {}))!;
    expect(await t.mutation(internal.core.jobs.start, { jobId: job._id, attempt: job.attempts })).toBe(true);
    expect(await t.mutation(internal.core.jobs.start, { jobId: job._id, attempt: job.attempts - 1 })).toBe(false);
  });
});
