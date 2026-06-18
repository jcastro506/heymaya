import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  discoveryDailyBudgetUsd,
  discoveryHourlyBudgetUsd,
  summarizeDiscoverySpend,
  evaluateDiscoveryBudget,
  gatingTierForAgent,
  type DiscoveryLedgerRow,
} from "../discoveryBudgetGate";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = 1_900_000_000_000;

// ───────────────────────────────────────────────────────────────────────────
// Per-tier budget table (pure)
// ───────────────────────────────────────────────────────────────────────────

describe("discovery budget table — per tier", () => {
  it("maps each tier to its daily budget", () => {
    expect(discoveryDailyBudgetUsd("starter")).toBe(1.0);
    expect(discoveryDailyBudgetUsd("growth")).toBe(1.5);
    expect(discoveryDailyBudgetUsd("studio")).toBe(2.0);
  });

  it("fail-closes an unknown / null tier to $0.10/day", () => {
    expect(discoveryDailyBudgetUsd(null)).toBe(0.1);
  });

  it("derives the hourly cap as 25% of the daily cap", () => {
    expect(discoveryHourlyBudgetUsd("starter")).toBeCloseTo(0.25, 4);
    expect(discoveryHourlyBudgetUsd("growth")).toBeCloseTo(0.375, 4);
    expect(discoveryHourlyBudgetUsd("studio")).toBeCloseTo(0.5, 4);
    expect(discoveryHourlyBudgetUsd(null)).toBeCloseTo(0.025, 4);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// summarizeDiscoverySpend — windowing (pure)
// ───────────────────────────────────────────────────────────────────────────

describe("summarizeDiscoverySpend — windowing", () => {
  it("sums only discovery=true rows; ignores non-discovery spend", () => {
    const rows: DiscoveryLedgerRow[] = [
      { discovery: true, costUsd: 0.1, createdAt: NOW - 5 * 60 * 1000 },
      { discovery: false, costUsd: 5.0, createdAt: NOW - 5 * 60 * 1000 },
      { discovery: undefined, costUsd: 9.0, createdAt: NOW - 5 * 60 * 1000 },
      { costUsd: 9.0, createdAt: NOW - 5 * 60 * 1000 }, // no discovery field
    ];
    const out = summarizeDiscoverySpend(rows, NOW);
    expect(out.spentHourUsd).toBeCloseTo(0.1, 4);
    expect(out.spentDayUsd).toBeCloseTo(0.1, 4);
  });

  it("splits hour vs day windows correctly", () => {
    const rows: DiscoveryLedgerRow[] = [
      // within the hour (also within the day)
      { discovery: true, costUsd: 0.2, createdAt: NOW - 30 * 60 * 1000 },
      // older than an hour but within the day
      { discovery: true, costUsd: 0.3, createdAt: NOW - 5 * HOUR_MS },
      // older than a day — excluded entirely
      { discovery: true, costUsd: 9.9, createdAt: NOW - 2 * DAY_MS },
    ];
    const out = summarizeDiscoverySpend(rows, NOW);
    expect(out.spentHourUsd).toBeCloseTo(0.2, 4);
    expect(out.spentDayUsd).toBeCloseTo(0.5, 4);
  });

  it("treats the window boundaries as inclusive lower bounds", () => {
    const rows: DiscoveryLedgerRow[] = [
      { discovery: true, costUsd: 0.11, createdAt: NOW - HOUR_MS }, // exactly 1h ago
      { discovery: true, costUsd: 0.22, createdAt: NOW - DAY_MS }, // exactly 24h ago
    ];
    const out = summarizeDiscoverySpend(rows, NOW);
    // The 1h-ago row counts toward both hour and day.
    expect(out.spentHourUsd).toBeCloseTo(0.11, 4);
    // Both the 1h-ago and the 24h-ago rows count toward the day.
    expect(out.spentDayUsd).toBeCloseTo(0.33, 4);
  });

  it("ignores future-dated rows", () => {
    const rows: DiscoveryLedgerRow[] = [
      { discovery: true, costUsd: 5.0, createdAt: NOW + HOUR_MS },
    ];
    const out = summarizeDiscoverySpend(rows, NOW);
    expect(out.spentHourUsd).toBe(0);
    expect(out.spentDayUsd).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// evaluateDiscoveryBudget — full vs monitoring_only (pure)
// ───────────────────────────────────────────────────────────────────────────

describe("evaluateDiscoveryBudget — degrade-to-monitoring", () => {
  it("allows full discovery under both caps", () => {
    const v = evaluateDiscoveryBudget({
      spentHourUsd: 0.1,
      spentDayUsd: 0.4,
      hourCapUsd: 0.25,
      dayCapUsd: 1.0,
    });
    expect(v.allowed).toBe(true);
    expect(v.mode).toBe("full");
  });

  it("degrades to monitoring_only at/over the HOUR cap", () => {
    const v = evaluateDiscoveryBudget({
      spentHourUsd: 0.25, // exactly the hour cap
      spentDayUsd: 0.3,
      hourCapUsd: 0.25,
      dayCapUsd: 1.0,
    });
    expect(v.allowed).toBe(false);
    expect(v.mode).toBe("monitoring_only");
    expect(v.reason).toContain("hourly discovery budget exhausted");
  });

  it("degrades to monitoring_only over the HOUR cap", () => {
    const v = evaluateDiscoveryBudget({
      spentHourUsd: 0.9,
      spentDayUsd: 0.95,
      hourCapUsd: 0.25,
      dayCapUsd: 1.0,
    });
    expect(v.mode).toBe("monitoring_only");
  });

  it("degrades to monitoring_only at/over the DAY cap even when the hour is fine", () => {
    const v = evaluateDiscoveryBudget({
      spentHourUsd: 0.0,
      spentDayUsd: 1.0, // exactly the day cap
      hourCapUsd: 0.25,
      dayCapUsd: 1.0,
    });
    expect(v.allowed).toBe(false);
    expect(v.mode).toBe("monitoring_only");
    expect(v.reason).toContain("daily discovery budget exhausted");
  });

  it("is a SOFT gate — never signals destruction, only mode", () => {
    const v = evaluateDiscoveryBudget({
      spentHourUsd: 9.0,
      spentDayUsd: 9.0,
      hourCapUsd: 0.25,
      dayCapUsd: 1.0,
    });
    expect(v.mode).toBe("monitoring_only");
    // The verdict surface has no kill/destroy concept — it only flips mode.
    expect(Object.keys(v)).not.toContain("shouldKill");
    expect(v.reason).toContain("monitoring-only");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// gatingTierForAgent — read-only tier resolution
// ───────────────────────────────────────────────────────────────────────────

describe("gatingTierForAgent — read-only plan resolution", () => {
  it("resolves an active starter plan", () => {
    expect(
      gatingTierForAgent({
        gtmPlanJson: JSON.stringify({ tier: "starter", status: "active" }),
      })
    ).toBe("starter");
  });

  it("resolves an active growth / studio plan", () => {
    expect(
      gatingTierForAgent({
        gtmPlanJson: JSON.stringify({ tier: "growth", status: "active" }),
      })
    ).toBe("growth");
    expect(
      gatingTierForAgent({
        gtmPlanJson: JSON.stringify({ tier: "studio", status: "active" }),
      })
    ).toBe("studio");
  });

  it("maps a missing / corrupt plan to null (the $0.10/day floor)", () => {
    expect(gatingTierForAgent({ gtmPlanJson: null })).toBeNull();
    expect(gatingTierForAgent({ gtmPlanJson: "not json" })).toBeNull();
    expect(
      gatingTierForAgent({
        gtmPlanJson: JSON.stringify({ tier: "starter", status: "none" }),
      })
    ).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// checkDiscoveryBudget — DB-backed (convex-test)
// ───────────────────────────────────────────────────────────────────────────

async function makeAccount(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<Id<"creators">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("creators", {
      clerkUserId: `clerk_${subject}`,
      email: `${subject}@clawlaunch.test`,
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      accountType: "gtm-agent",
      createdAt: NOW - 30 * DAY_MS,
    });
  });
}

async function insertDiscoveryRow(
  t: ReturnType<typeof convexTest>,
  accountId: Id<"creators">,
  costUsd: number,
  createdAt: number,
  discovery = true
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("gtmCostLedger", {
      accountId,
      provider: "scrapecreators",
      operation: "discovery.scan",
      reason: "discovery budget gate test",
      costUsd,
      cacheStatus: "called",
      discovery,
      lane: "buyer_intent",
      createdAt,
    });
  });
}

describe("checkDiscoveryBudget — DB-backed soft gate", () => {
  it("returns mode=full when discovery spend is under both caps", async () => {
    const t = convexTest(schema, modules);
    const accountId = await makeAccount(t, "disc_full");
    // $0.40 spent today on starter ($1.00/day, $0.25/hr) — well under the day,
    // but spread so the hour stays under too.
    await insertDiscoveryRow(t, accountId, 0.1, NOW - 3 * HOUR_MS);
    await insertDiscoveryRow(t, accountId, 0.1, NOW - 4 * HOUR_MS);
    await insertDiscoveryRow(t, accountId, 0.1, NOW - 5 * HOUR_MS);
    await insertDiscoveryRow(t, accountId, 0.1, NOW - 6 * HOUR_MS);

    const v = await t.query(
      internal.gtmMaya.discoveryBudgetGate.checkDiscoveryBudget,
      { accountId, planTier: "starter", nowMs: NOW }
    );
    expect(v.allowed).toBe(true);
    expect(v.mode).toBe("full");
    expect(v.spentDayUsd).toBeCloseTo(0.4, 4);
    expect(v.spentHourUsd).toBeCloseTo(0, 4);
    expect(v.dayCapUsd).toBe(1.0);
    expect(v.hourCapUsd).toBeCloseTo(0.25, 4);
  });

  it("degrades to monitoring_only when the HOUR cap is met", async () => {
    const t = convexTest(schema, modules);
    const accountId = await makeAccount(t, "disc_hour");
    // $0.30 spent in the last 30 min on starter ($0.25/hr cap) → hour exhausted.
    await insertDiscoveryRow(t, accountId, 0.15, NOW - 10 * 60 * 1000);
    await insertDiscoveryRow(t, accountId, 0.15, NOW - 20 * 60 * 1000);

    const v = await t.query(
      internal.gtmMaya.discoveryBudgetGate.checkDiscoveryBudget,
      { accountId, planTier: "starter", nowMs: NOW }
    );
    expect(v.allowed).toBe(false);
    expect(v.mode).toBe("monitoring_only");
    expect(v.spentHourUsd).toBeCloseTo(0.3, 4);
    expect(v.reason).toContain("hourly discovery budget exhausted");
  });

  it("degrades to monitoring_only when the DAY cap is met (hour fine)", async () => {
    const t = convexTest(schema, modules);
    const accountId = await makeAccount(t, "disc_day");
    // Spread $1.00 across the day so no single hour trips, but the day cap
    // ($1.00 on starter) is met.
    for (let i = 0; i < 10; i++) {
      await insertDiscoveryRow(t, accountId, 0.1, NOW - (2 + i) * HOUR_MS);
    }

    const v = await t.query(
      internal.gtmMaya.discoveryBudgetGate.checkDiscoveryBudget,
      { accountId, planTier: "starter", nowMs: NOW }
    );
    expect(v.allowed).toBe(false);
    expect(v.mode).toBe("monitoring_only");
    expect(v.spentDayUsd).toBeCloseTo(1.0, 4);
    expect(v.spentHourUsd).toBeCloseTo(0, 4);
    expect(v.reason).toContain("daily discovery budget exhausted");
  });

  it("ignores non-discovery spend entirely", async () => {
    const t = convexTest(schema, modules);
    const accountId = await makeAccount(t, "disc_nondisc");
    // $9 of NON-discovery spend in the last hour must not affect the gate.
    await insertDiscoveryRow(t, accountId, 9.0, NOW - 10 * 60 * 1000, false);

    const v = await t.query(
      internal.gtmMaya.discoveryBudgetGate.checkDiscoveryBudget,
      { accountId, planTier: "starter", nowMs: NOW }
    );
    expect(v.allowed).toBe(true);
    expect(v.mode).toBe("full");
    expect(v.spentDayUsd).toBe(0);
  });

  it("applies the fail-closed $0.10/day floor for an unknown (null) tier", async () => {
    const t = convexTest(schema, modules);
    const accountId = await makeAccount(t, "disc_failclosed");
    // Just $0.11 of discovery spread over the day → over the $0.10 floor.
    await insertDiscoveryRow(t, accountId, 0.06, NOW - 3 * HOUR_MS);
    await insertDiscoveryRow(t, accountId, 0.05, NOW - 5 * HOUR_MS);

    const v = await t.query(
      internal.gtmMaya.discoveryBudgetGate.checkDiscoveryBudget,
      { accountId, planTier: null, nowMs: NOW }
    );
    expect(v.dayCapUsd).toBe(0.1);
    expect(v.allowed).toBe(false);
    expect(v.mode).toBe("monitoring_only");
  });

  it("isolates discovery spend cross-tenant — A's burn never gates B", async () => {
    const t = convexTest(schema, modules);
    const a = await makeAccount(t, "disc_tenant_a");
    const b = await makeAccount(t, "disc_tenant_b");

    // A burns its whole day budget; B spends nothing.
    for (let i = 0; i < 12; i++) {
      await insertDiscoveryRow(t, a, 0.1, NOW - (2 + i) * HOUR_MS);
    }

    const va = await t.query(
      internal.gtmMaya.discoveryBudgetGate.checkDiscoveryBudget,
      { accountId: a, planTier: "starter", nowMs: NOW }
    );
    const vb = await t.query(
      internal.gtmMaya.discoveryBudgetGate.checkDiscoveryBudget,
      { accountId: b, planTier: "starter", nowMs: NOW }
    );
    expect(va.mode).toBe("monitoring_only");
    expect(vb.mode).toBe("full");
    expect(vb.spentDayUsd).toBe(0);
  });
});
