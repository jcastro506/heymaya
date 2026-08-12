/**
 * ⭐ The spend figure was wrong by ~50×.
 *
 * `cogs.forCustomer` sums `costEvents`, and `costEvents` only ever records
 * calls made **from Convex** — the gates, the sweeps, the critics. Measured
 * 2026-08-07 by the module's own comment: that is **2% of the LLM bill**. The
 * other 98% is the agent loop on Fly calling OpenRouter directly, where nothing
 * of ours can see it.
 *
 * ⚠️ `provisionKey`, `machineSpend` and `accountSpend` were all written to close
 * exactly this gap — and all three had **zero callers**. So every spend number
 * anyone has looked at, including the operator dashboard's, has been the 2%
 * one, presented as the bill.
 *
 * That is the number that answers "can we afford this customer at $99."
 */

import { describe, expect, it } from "vitest";
import { project } from "../convex/maya/cogs";

const BASE = { monthToDateUsd: 0.16, daysObserved: 10, daysInMonth: 30 };

describe("what gets reported as the bill", () => {
  it("⭐ prefers the vendor's figure over our own bookkeeping", () => {
    const out = project({ ...BASE, vendorMonthUsd: 8.0, vendorAsOf: 1 });

    // Projected from $8.00, not from $0.16.
    expect(out.projectedMonthUsd).toBeCloseTo(24, 5);
    expect(out.vendorMonthUsd).toBe(8.0);
    expect(out.partialOnly).toBe(false);
    // The raw ledger is still reported — it just isn't the headline.
    expect(out.monthToDateUsd).toBe(0.16);
  });

  it("⚠️ says outright when all it has is the partial figure", () => {
    /**
     * The load-bearing case. A confident, precise projection built from 2% of
     * the money is worse than admitting the gap — it is wrong by fifty times
     * and reads exactly like a real answer.
     */
    const out = project(BASE);

    expect(out.partialOnly).toBe(true);
    expect(out.detail).toMatch(/only what Convex spent/i);
    expect(out.detail).toMatch(/not the agent's own model calls/i);
    expect(out.vendorMonthUsd).toBeUndefined();
  });

  it("carries the age of the vendor number", () => {
    // §16.4 — a borrowed number with no date eventually lies with nothing to
    // give it away.
    const out = project({
      ...BASE,
      vendorMonthUsd: 8.0,
      vendorAsOf: 1_700_000,
    });
    expect(out.vendorAsOf).toBe(1_700_000);
  });

  it("adds no caveat once the real number is present", () => {
    const out = project({ ...BASE, vendorMonthUsd: 8.0, vendorAsOf: 1 });
    expect(out.detail).not.toMatch(/only what Convex spent/i);
  });

  it("still refuses to project too early in the month", () => {
    /**
     * Unchanged behaviour, and worth pinning: "not enough data to say" must
     * survive the vendor figure arriving. Two days of real spend extrapolated
     * across thirty is a guess dressed as a projection.
     */
    const out = project({
      monthToDateUsd: 0.02,
      daysObserved: 1,
      daysInMonth: 30,
      vendorMonthUsd: 1.5,
      vendorAsOf: 1,
    });
    expect(out.projectedMonthUsd).toBeNull();
    // But it reports the real spend so far, not the 2% one.
    expect(out.detail).toContain("1.50");
  });
});
