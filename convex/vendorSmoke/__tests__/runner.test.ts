import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { VendorStatus } from "../report";
import { SMOKE_CHECKS } from "../registry";

describe("runTier — the Convex shell", () => {
  it("with no vendor keys configured, every check skips and NOTHING hits the network", async () => {
    // The state this repo is actually in right now, and the one most likely to
    // mislead: a suite that "passes" because it never ran. It must produce a
    // full set of skipped rows, not an empty run and not a failure.
    const t = convexTest(schema, modules);
    const result = await t.action(internal.vendorSmoke.runner.runTier, {
      tier: 1,
    });

    const tier1Count = SMOKE_CHECKS.filter((c) => c.tier === 1).length;
    expect(result.skipped).toBe(tier1Count);
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(0);
    expect(result.spentUsd).toBe(0);

    const rows = await t.run((ctx) => ctx.db.query("vendorHealth").collect());
    expect(rows).toHaveLength(tier1Count);
    expect(rows.every((row) => row.status === "skipped")).toBe(true);
    // Every skip names the missing var, so the operator can act on it.
    expect(rows.every((row) => /missing [A-Z]/.test(row.detail ?? ""))).toBe(true);
  });

  it("and the report calls that state unverified — not healthy", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.vendorSmoke.runner.runTier, { tier: 1 });

    const fleet = await t.query(internal.vendorSmoke.report.fleetHealth, {});
    expect(fleet.every((v: VendorStatus) => v.verdict === "unverified")).toBe(true);
    expect(fleet.some((v: VendorStatus) => v.verdict === "healthy")).toBe(false);
  });

  it("groups a run under one runId so it can be read whole", async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(internal.vendorSmoke.runner.runTier, {
      tier: 1,
    });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("vendorHealth")
        .withIndex("by_run", (q) => q.eq("runId", result.runId))
        .collect()
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.runId)).size).toBe(1);
  });

  it("narrowing to one vendor runs only that vendor's checks", async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(internal.vendorSmoke.runner.runTier, {
      tier: 1,
      vendor: "zernio",
    });
    expect(result.skipped).toBe(1);
    const rows = await t.run((ctx) => ctx.db.query("vendorHealth").collect());
    expect(rows.every((row) => row.vendor === "zernio")).toBe(true);
  });

  it("a tier with no checks yet records nothing and doesn't throw", async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(internal.vendorSmoke.runner.runTier, {
      tier: 3,
    });
    expect(result.passed + result.failed + result.skipped).toBe(
      SMOKE_CHECKS.filter((c) => c.tier === 3).length
    );
  });

  it("recordRun writes one row per outcome with drift preserved", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.vendorSmoke.runner.recordRun, {
      runId: "run_manual",
      ranAt: 1_700_000_000_000,
      outcomes: [
        {
          vendor: "zernio",
          tier: 2,
          check: "zernio.publish",
          status: "fail",
          detail: "shape drift — 1 unexpected",
          drifts: ["unexpected:platformResults"],
          latencyMs: 120,
          costUsd: 0,
        },
      ],
    });
    const rows = await t.run((ctx) => ctx.db.query("vendorHealth").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].drifts).toEqual(["unexpected:platformResults"]);
    expect(rows[0].tier).toBe(2);
  });
});
