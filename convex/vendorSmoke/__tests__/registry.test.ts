import { describe, expect, it } from "vitest";
import { findNonStrictObjects } from "../drift";
import { SMOKE_CHECKS, checksForTier } from "../registry";
import { ALL_VENDORS } from "../types";

describe("smoke registry", () => {
  it("every vendor has tier-1 reachability coverage", () => {
    // Tier 1 is the 3am question — "is anything reachable". A vendor with no
    // tier-1 check is a vendor whose outage we learn about from a customer.
    const covered = new Set(checksForTier(1).map((c) => c.vendor));
    expect([...ALL_VENDORS].filter((v) => !covered.has(v))).toEqual([]);
  });

  it("check ids are unique — history hangs off them", () => {
    const ids = SMOKE_CHECKS.map((c) => c.check);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("check ids are namespaced by vendor so the report reads cleanly", () => {
    for (const check of SMOKE_CHECKS) {
      expect(check.check, check.check).toMatch(/^[a-z0-9]+\./);
    }
  });

  it("every check declares the env it needs — otherwise it fails instead of skipping", () => {
    for (const check of SMOKE_CHECKS) {
      expect(check.requiredEnv.length, check.check).toBeGreaterThan(0);
      for (const key of check.requiredEnv) {
        expect(key, check.check).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  it("THE CONTRACT: a schema is strict at every level, or it says why not", () => {
    // This is the guard on the guard. A `z.object()` nested inside a
    // `z.strictObject()` would let a brand-new vendor field sail through — the
    // exact blind spot that hid six days of Zernio publish failures. The only
    // way past it is an explicit `laxReason`, which shows up in review.
    for (const check of SMOKE_CHECKS) {
      const holes = findNonStrictObjects(check.schema);
      if (holes.length > 0) {
        expect(
          check.laxReason,
          `${check.check} has non-strict objects at [${holes.join(
            ", "
          )}] and must declare a laxReason`
        ).toBeTruthy();
      }
    }
  });

  it("a laxReason is a real sentence, not a shrug", () => {
    for (const check of SMOKE_CHECKS) {
      if (!check.laxReason) continue;
      expect(check.laxReason.length, check.check).toBeGreaterThan(40);
    }
  });

  it("a laxReason is only allowed where the schema is actually non-strict", () => {
    // Stops the waiver from becoming boilerplate that gets pasted everywhere.
    for (const check of SMOKE_CHECKS) {
      if (!check.laxReason) continue;
      expect(
        findNonStrictObjects(check.schema).length,
        `${check.check} declares a laxReason but its schema is already strict`
      ).toBeGreaterThan(0);
    }
  });

  it("tier-1 checks are free or near-free — they run hourly, forever", () => {
    for (const check of checksForTier(1)) {
      expect(check.estCostUsd, check.check).toBeLessThan(0.01);
    }
  });

  it("checksForTier partitions the registry with nothing lost", () => {
    const total =
      checksForTier(1).length + checksForTier(2).length + checksForTier(3).length;
    expect(total).toBe(SMOKE_CHECKS.length);
  });
});
