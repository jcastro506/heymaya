/**
 * Fleet jobs at scale (2026-11-12). The readback, the sampler and the sweep each looped the whole fleet inside one
 * action, and an action stops at ten minutes: past ~10–20 creators (readback) or ~100 (sampler) the people at the
 * end silently stopped being read. Each fleet run now only splits the work into separate actions. The cost
 * reconciliation read the whole ledger with a filter; it now pages through the `at` index.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { SAMPLE_BATCH, chunks } from "../sampler";
import { SWEEP_BATCH } from "../sweep";
import { LEDGER_PAGE } from "../../core/reconcile";

const scheduled = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

describe("fleet jobs split their work into separate actions", () => {
  it("chunks are whole and in order", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 3)).toEqual([]);
  });

  it("the readback schedules one pass per paired creator and reads nobody inline", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 5; i++) await t.run((ctx) => seedCreator(ctx, `c${i}`, { clerkUserId: `u${i}`, handles: { tiktok: `h${i}` }, channel: { paired: true } }));
    const r = await t.action(internal.scout.readback.run, {});
    expect(r.creators).toBe(5);
    const jobs = (await scheduled(t)).filter((j) => j.name.includes("readback") && j.name.includes("runOne"));
    expect(jobs).toHaveLength(5);
    expect(new Set(jobs.map((j) => String((j.args[0] as { creatorId: string }).creatorId))).size).toBe(5);
  });

  it("the sampler splits a big roster into batches, each a separate action", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const n = SAMPLE_BATCH * 2 + 3;
    await t.run(async (ctx) => {
      for (let i = 0; i < n; i++) await ctx.db.insert("trackedAccounts", { creatorId: a, platform: "tiktok", handle: `acct${i}`, addedBy: "creator", baselineN: 0, status: "active", createdAt: Date.now() } as never);
    });
    const r = await t.action(internal.scout.sampler.run, {});
    expect(r.batches).toBe(3);
    const jobs = (await scheduled(t)).filter((j) => j.name.includes("sampler"));
    expect(jobs.map((j) => (j.args[0] as { batch: unknown[] }).batch.length).sort((x, y) => x - y)).toEqual([3, SAMPLE_BATCH, SAMPLE_BATCH]);
    // Nothing was read inline: no account sampled yet.
    expect((await t.run((ctx) => ctx.db.query("trackedAccounts").collect())).every((x) => x.lastSampledAt === undefined)).toBe(true);
  });

  it("a small roster is still sampled in place (no needless scheduling)", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    await t.run((ctx) => ctx.db.insert("trackedAccounts", { creatorId: a, platform: "tiktok", handle: "solo", addedBy: "creator", baselineN: 0, status: "active", createdAt: Date.now() } as never));
    const r = await t.action(internal.scout.sampler.run, {});
    expect(r.batches).toBeUndefined();
    expect(r.accounts).toBe(1);
  });

  it("the sweep batch size leaves room in an action (two searches a keyword)", () => {
    expect(SWEEP_BATCH * 2).toBeLessThanOrEqual(40);
  });
});

describe("the ledger is summed in pages through the date index", () => {
  it("counts every credit and every OpenRouter dollar since the cut, across pages, and nothing before it", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const since = now - 3_600_000;
    await t.run(async (ctx) => {
      for (let i = 0; i < LEDGER_PAGE + 10; i++) await ctx.db.insert("costEvents", { vendor: i % 2 ? "scrapecreators" : "openrouter", kind: "k", environment: "test", costUsd: 0.01, units: 1, at: now - i, costSource: "tier_table" } as never);
      await ctx.db.insert("costEvents", { vendor: "scrapecreators", kind: "k", environment: "test", costUsd: 5, units: 999, at: since - 1, costSource: "tier_table" } as never);
    });
    const first = await t.query(internal.core.reconcile.ledgerPage, { since, cursor: null });
    expect(first.done).toBe(false);
    const second = await t.query(internal.core.reconcile.ledgerPage, { since, cursor: first.cursor });
    expect(second.done).toBe(true);
    const n = LEDGER_PAGE + 10;
    expect(first.credits + second.credits).toBe(Math.floor(n / 2));
    expect(Math.round((first.openRouterUsd + second.openRouterUsd) * 100)).toBe(Math.ceil(n / 2));
  });
});
