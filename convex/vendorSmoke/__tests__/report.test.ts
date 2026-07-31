import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { VendorStatus } from "../report";

type Row = {
  vendor: "zernio" | "scrapecreators" | "creatify";
  tier: 1 | 2 | 3;
  check: string;
  status: "pass" | "fail" | "skipped";
  detail?: string;
  drifts?: string[];
  ranAt: number;
  runId?: string;
};

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);

async function seed(t: ReturnType<typeof convexTest>, rows: Row[]) {
  await t.run(async (ctx) => {
    for (const row of rows) {
      await ctx.db.insert("vendorHealth", {
        vendor: row.vendor,
        tier: row.tier,
        check: row.check,
        status: row.status,
        detail: row.detail,
        drifts: row.drifts,
        runId: row.runId ?? "run_test",
        ranAt: row.ranAt,
      });
    }
  });
}

describe("fleetHealth", () => {
  it("a vendor with a failing check is degraded, and says what drifted", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      {
        vendor: "zernio",
        tier: 2,
        check: "zernio.publish",
        status: "fail",
        detail: "shape drift — 1 unexpected",
        drifts: ["unexpected:platformResults"],
        ranAt: NOW,
      },
    ]);
    const fleet = await t.query(internal.vendorSmoke.report.fleetHealth, {
      sinceMs: NOW - 1000,
    });
    const zernio = fleet.find((v: VendorStatus) => v.vendor === "zernio")!;
    expect(zernio.verdict).toBe("degraded");
    expect(zernio.failing[0].drifts).toEqual(["unexpected:platformResults"]);
  });

  it("A SKIP IS NOT A PASS — all-skipped reads as unverified, never healthy", async () => {
    // The failure mode this whole report exists to prevent: an unconfigured
    // vendor showing green because nothing ran.
    const t = convexTest(schema, modules);
    await seed(t, [
      {
        vendor: "creatify",
        tier: 1,
        check: "creatify.remaining_credits",
        status: "skipped",
        detail: "not configured — missing CREATIFY_API_KEY",
        ranAt: NOW,
      },
    ]);
    const fleet = await t.query(internal.vendorSmoke.report.fleetHealth, {
      sinceMs: NOW - 1000,
    });
    const creatify = fleet.find((v: VendorStatus) => v.vendor === "creatify")!;
    expect(creatify.verdict).toBe("unverified");
    expect(creatify.verdict).not.toBe("healthy");
    expect(creatify.unverified[0].detail).toMatch(/CREATIFY_API_KEY/);
  });

  it("a vendor the suite has never run for is unknown, not healthy", async () => {
    const t = convexTest(schema, modules);
    const fleet = await t.query(internal.vendorSmoke.report.fleetHealth, {});
    expect(fleet.every((v: VendorStatus) => v.verdict === "unknown")).toBe(true);
  });

  it("reports every vendor, including ones with no rows", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      { vendor: "zernio", tier: 1, check: "zernio.x", status: "pass", ranAt: NOW },
    ]);
    const fleet = await t.query(internal.vendorSmoke.report.fleetHealth, {
      sinceMs: NOW - 1000,
    });
    expect(fleet).toHaveLength(7);
  });

  it("a fixed failure stops holding the vendor red", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      { vendor: "zernio", tier: 2, check: "zernio.publish", status: "fail", ranAt: NOW },
      {
        vendor: "zernio",
        tier: 2,
        check: "zernio.publish",
        status: "pass",
        ranAt: NOW + 3_600_000,
      },
    ]);
    const fleet = await t.query(internal.vendorSmoke.report.fleetHealth, {
      sinceMs: NOW - 1000,
    });
    expect(fleet.find((v: VendorStatus) => v.vendor === "zernio")!.verdict).toBe("healthy");
  });

  it("one passing check doesn't mask another that's failing", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      { vendor: "zernio", tier: 2, check: "zernio.a", status: "pass", ranAt: NOW },
      { vendor: "zernio", tier: 2, check: "zernio.b", status: "fail", ranAt: NOW },
    ]);
    const fleet = await t.query(internal.vendorSmoke.report.fleetHealth, {
      sinceMs: NOW - 1000,
    });
    const zernio = fleet.find((v: VendorStatus) => v.vendor === "zernio")!;
    expect(zernio.verdict).toBe("degraded");
    expect(zernio.passing).toBe(1);
  });

  it("results outside the window are ignored", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      { vendor: "zernio", tier: 2, check: "zernio.old", status: "fail", ranAt: NOW },
    ]);
    const fleet = await t.query(internal.vendorSmoke.report.fleetHealth, {
      sinceMs: NOW + 1000,
    });
    expect(fleet.find((v: VendorStatus) => v.vendor === "zernio")!.verdict).toBe("unknown");
  });
});

describe("deployGate — fail-closed", () => {
  it("blocks when tier 2 has never run for the vendor", async () => {
    const t = convexTest(schema, modules);
    const gate = await t.query(internal.vendorSmoke.report.deployGate, {
      vendor: "zernio",
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/no tier-2 result/);
  });

  it("blocks on a failing tier-2 check and names it", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      {
        vendor: "zernio",
        tier: 2,
        check: "zernio.publish",
        status: "fail",
        detail: "shape drift",
        ranAt: Date.now(),
      },
    ]);
    const gate = await t.query(internal.vendorSmoke.report.deployGate, {
      vendor: "zernio",
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/zernio\.publish/);
  });

  it("BLOCKS when every tier-2 check was skipped — unverified is not green", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      {
        vendor: "zernio",
        tier: 2,
        check: "zernio.publish",
        status: "skipped",
        detail: "not configured",
        ranAt: Date.now(),
      },
    ]);
    const gate = await t.query(internal.vendorSmoke.report.deployGate, {
      vendor: "zernio",
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/unverified is not green/);
  });

  it("blocks on a result that's too old to trust", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      {
        vendor: "zernio",
        tier: 2,
        check: "zernio.publish",
        status: "pass",
        ranAt: Date.now() - 72 * 60 * 60 * 1000,
      },
    ]);
    const gate = await t.query(internal.vendorSmoke.report.deployGate, {
      vendor: "zernio",
      maxAgeMs: 48 * 60 * 60 * 1000,
    });
    expect(gate.ok).toBe(false);
  });

  it("passes on a fresh, green tier 2", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      {
        vendor: "zernio",
        tier: 2,
        check: "zernio.publish",
        status: "pass",
        ranAt: Date.now(),
      },
    ]);
    const gate = await t.query(internal.vendorSmoke.report.deployGate, {
      vendor: "zernio",
    });
    expect(gate.ok).toBe(true);
  });

  it("a tier-1 pass can't stand in for the tier-2 shape check", async () => {
    const t = convexTest(schema, modules);
    await seed(t, [
      {
        vendor: "zernio",
        tier: 1,
        check: "zernio.accounts-health",
        status: "pass",
        ranAt: Date.now(),
      },
    ]);
    const gate = await t.query(internal.vendorSmoke.report.deployGate, {
      vendor: "zernio",
    });
    expect(gate.ok).toBe(false);
  });
});
