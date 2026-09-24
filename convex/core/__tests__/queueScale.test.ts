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

describe("a burst schedules one drain, not one per message", () => {
  it("50 texts at once leave a single pending drain", async () => {
    const { t, ids } = await world(1);
    for (let i = 0; i < 50; i++) await enqueue(t, ids[0], `burst${i}`);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const drains = scheduled.filter((s) => s.name.includes("drainJobs") && s.state.kind === "pending");
    expect(drains.length).toBe(1);
  });
});

describe("a claim stays cheap and exact under a backlog", () => {
  it("a creator who sent 25 more texts while one turn runs is still busy (the newest-20 lookup could not see it)", async () => {
    vi.stubEnv("MAX_TURNS_IN_FLIGHT", "1000");
    const { t, ids } = await world(2);
    await t.run(async (ctx) => { await ctx.db.insert("jobs", { kind: "converse", idempotencyKey: "running", creatorId: ids[0], payloadJson: "{}", status: "running", attempts: 1, maxAttempts: 3, runAfter: 0, deadlineAt: Date.now() + 60_000, createdAt: 1, updatedAt: 0 } as never); });
    for (let i = 0; i < 25; i++) await enqueue(t, ids[0], `spam${i}`);
    await enqueue(t, ids[1], "other");
    expect((await t.mutation(internal.core.jobs.claimNext, {}))?.idempotencyKey).toBe("other");
    expect(await t.mutation(internal.core.jobs.claimNext, {}), "never a second turn for the busy creator").toBeNull();
    vi.unstubAllEnvs();
  });

  it("a full cap returns nothing, whatever the backlog", async () => {
    vi.stubEnv("MAX_TURNS_IN_FLIGHT", "1");
    const { t, ids } = await world(150);
    for (const [i, id] of ids.entries()) await enqueue(t, id, `b${i}`);
    expect(await t.mutation(internal.core.jobs.claimNext, {})).not.toBeNull();
    expect(await t.mutation(internal.core.jobs.claimNext, {})).toBeNull();
    vi.unstubAllEnvs();
  });

  it("the drain inside a turn (deliverNow) never claims turns; the kick and the finished turn do that", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("../scheduler.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function deliverNow"), src.indexOf("\n}\n", src.indexOf("export async function deliverNow")));
    expect(body).toMatch(/filter\(\(k\) => !TURN_KINDS\.has\(k\)\)/);
    const { t, ids } = await world(1);
    await enqueue(t, ids[0], "turn");
    const kinds = ["deliver_message", "first_read", "ingest_catalogue", "render_frames"];
    expect(await t.action(internal.core.scheduler.drainJobs, { kinds })).toMatchObject({ claimed: 0 });
  });
});
