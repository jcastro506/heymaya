/**
 * S0: the fleet jobs at scale. Mandatory categories: budget fail-closed (the daily cap holds
 * inside the send transaction, whoever sends), sibling coherence (one definition of what counts
 * toward the cap, used by the rails, the counter and the hold), cross-tenant (one creator's
 * spent allowance never holds another's), and the fan-out (no job loops creators inside one action).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { HOURLY_SPREAD_MS, spreadDelays } from "../fanout";
import { countsTowardCap } from "../messages";
import { THRESHOLDS } from "../../config/thresholds";

beforeEach(() => { vi.stubEnv("MODEL_FAKE", "1"); vi.stubEnv("OPENROUTER_API_KEY", "fake"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("the daily cap is enforced inside send (fail-closed)", () => {
  it("capped sends past the cap are held with a reason; nothing is written", async () => {
    const t = convexTest(schema, modules);
    const [a, b] = await t.run(async (ctx) => [await seedCreator(ctx, "a", { clerkUserId: "user_a", channel: { paired: true } }), await seedCreator(ctx, "b", { clerkUserId: "user_b", channel: { paired: true } })]);
    const results = [];
    for (let i = 0; i < THRESHOLDS.dailyMessageCap + 2; i++) results.push(await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: `idea ${i}`, dedupeKey: `s:${i}`, proactive: true, capped: true, kind: "scout" }));
    expect(results.filter((r) => r.sent)).toHaveLength(THRESHOLDS.dailyMessageCap);
    expect(results.filter((r) => r.held)).toHaveLength(2);
    expect(results.find((r) => r.held)?.messageId).toBeNull();
    const rows = await t.run((ctx) => ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a)).collect());
    expect(rows.filter((r) => r.direction === "out")).toHaveLength(THRESHOLDS.dailyMessageCap);
    // cross-tenant: A's spent day doesn't hold B
    expect((await t.mutation(internal.core.messages.send, { creatorId: b, surface: "telegram", body: "hi", dedupeKey: "s:0", proactive: true, capped: true, kind: "scout" })).sent).toBe(true);
  });

  it("reminders for blocks they booked, status notes and replies are never held", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a", channel: { paired: true } }));
    for (let i = 0; i < THRESHOLDS.dailyMessageCap; i++) await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: `idea ${i}`, dedupeKey: `s:${i}`, proactive: true, capped: true, kind: "scout" });
    expect((await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: "filming in 1h", dedupeKey: "r:1", proactive: true, kind: "reminder" })).sent).toBe(true);
    expect((await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: "sure", dedupeKey: "reply:1", proactive: false, kind: "reply" })).sent).toBe(true);
  });
});

describe("one definition of what counts (sibling coherence)", () => {
  it("the rails, the counter and the hold agree", async () => {
    expect(countsTowardCap({ direction: "out", proactive: true, kind: "scout" })).toBe(true);
    expect(countsTowardCap({ direction: "out", proactive: true, kind: "reminder" })).toBe(false);
    expect(countsTowardCap({ direction: "out", proactive: true, kind: "status" })).toBe(false);
    expect(countsTowardCap({ direction: "out", proactive: false, kind: "reply" })).toBe(false);
    const gate = readFileSync(join(__dirname, "../../scout/gate.ts"), "utf8");
    expect(gate).not.toMatch(/m\.proactive && dayKeyInZone/); // the old hand-rolled count
    expect(gate.match(/countsTowardCap\(m\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("fan-out, not a loop", () => {
  it("spreads creators across the window", () => {
    expect(spreadDelays(0, HOURLY_SPREAD_MS)).toEqual([]);
    expect(spreadDelays(1, HOURLY_SPREAD_MS)).toEqual([0]);
    const d = spreadDelays(1000, HOURLY_SPREAD_MS);
    expect(d).toHaveLength(1000);
    expect(Math.max(...d)).toBeLessThan(HOURLY_SPREAD_MS);
    expect(new Set(d).size).toBe(1000);
  });

  it("no hourly job runs creators one after another inside its own action", () => {
    for (const f of ["scout/scout.ts", "calendar/weekPlan.ts", "review/weekly.ts", "agent/cadence.ts"]) {
      const src = readFileSync(join(__dirname, "../..", f), "utf8");
      const runAll = src.slice(src.indexOf("export const runAll"), src.indexOf("\n});", src.indexOf("export const runAll")));
      expect(runAll, f).not.toMatch(/for \([^)]*\) \{?\s*(const \w+ = )?await ctx\.runAction/);
    }
  });

  it("the scout's runAll schedules one pass per due creator", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => { for (let i = 0; i < 5; i++) await seedCreator(ctx, `c${i}`, { clerkUserId: `user_${i}`, channel: { paired: true }, dossier: {} as never, timezone: "UTC" }); });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 23, 12, 5)));
    const r = await t.action(internal.scout.scout.runAll, {});
    vi.useRealTimers();
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(r.scheduled).toBe(5);
    expect(scheduled.filter((s) => s.name.includes("runOne"))).toHaveLength(5);
  });
});
