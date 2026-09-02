/** §3 budgets, never booleans: every priced event lands on the creator's day; the gate refuses proactive at the cap; replies are never throttled here. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { applyBump, budgetExhausted, emptyDay, kindForCost } from "../budgets";
import { THRESHOLDS } from "../../config/thresholds";
import type { Id } from "../../_generated/dataModel";

describe("budgets", () => {
  it("classifies cost events into budget kinds", () => {
    expect(kindForCost("scrapecreators", "read", "/v1/x")).toBe("credits");
    expect(kindForCost("gemini", "watch_own", "gemini-3.7-flash")).toBe("watch");
    expect(kindForCost("openrouter", "scout", "google/gemini-3.7-flash")).toBe("writer");
    expect(kindForCost("openrouter", "critic", "z-ai/glm-5.3-flash")).toBe("screener");
    expect(kindForCost("telegram", "send", "x")).toBeNull();
  });

  it("the rail trips at the caps and not before", () => {
    const id = "x" as Id<"creators">;
    let row = emptyDay(id, "2026-09-02");
    expect(budgetExhausted(row)).toBeNull();
    row = applyBump(row, "writer", 1000, THRESHOLDS.dailyUsdCap - 0.01);
    expect(budgetExhausted(row)).toBeNull();
    row = applyBump(row, "writer", 10, 0.02);
    expect(budgetExhausted(row)).toMatch(/spend/);
    let w = emptyDay(id, "d");
    for (let i = 0; i < THRESHOLDS.dailyWatchCap; i++) w = applyBump(w, "watch", 0, 0.001);
    expect(budgetExhausted(w)).toMatch(/watches/);
  });

  it("cost events land on the creator's day in their timezone, and the gate refuses proactive when spent", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "America/Los_Angeles", channel: { paired: true } }));
    const now = Date.UTC(2026, 8, 3, 5, 0); // 22:00 PDT on Sep 2
    await t.mutation(internal.core.costs.record, { creatorId, vendor: "openrouter", resource: "google/gemini-3.7-flash", purpose: "scout", costUsd: 0.5, promptTokens: 100, completionTokens: 50, now });
    await t.mutation(internal.core.costs.record, { creatorId, vendor: "openrouter", resource: "google/gemini-3.7-flash", purpose: "scout", costUsd: 0.3, promptTokens: 100, completionTokens: 50, now });
    const rows = await t.run((ctx) => ctx.db.query("budgets").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].day).toBe("2026-09-02");
    expect(rows[0].spentUsd).toBeCloseTo(0.8, 6);
    expect(rows[0].writerTokens).toBe(300);
    const g = await t.query(internal.scout.gate.railsFor, { creatorId, now: Date.UTC(2026, 8, 2, 20, 0) }); // 13:00 PDT same day
    expect(g?.rails.ok).toBe(false);
    expect(g?.rails.reason).toMatch(/budget exhausted/);
  });

  it("a proactive send counts a message on the day", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC" }));
    await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "hi", dedupeKey: "k1", proactive: true });
    await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "reply", dedupeKey: "k2", proactive: false });
    const rows = await t.run((ctx) => ctx.db.query("budgets").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].messages).toBe(1);
  });
});
