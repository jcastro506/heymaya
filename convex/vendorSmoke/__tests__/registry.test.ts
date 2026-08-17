import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/* -------------------------------------------------------------------------- */

describe("tier 3 is not an empty cron", () => {
  /**
   * ⭐ `runTier3` has been on a weekly cron since the suite was built and
   * `checksForTier(3)` returned an EMPTY ARRAY — a job firing every Sunday and
   * testing nothing.
   *
   * ⚠️ It is the tier that catches the failure that actually costs money:
   * credits accepted, job queued, nothing ever completing. Tier 2 proves the
   * shape of a READ; only a write proves the account can still do anything —
   * which is §18.0.5's entire argument, since the Zernio incident returned 200s
   * for six days while publishing nothing.
   */
  it("⭐ has at least one round-trip check", () => {
    expect(checksForTier(3).length).toBeGreaterThan(0);
  });

  it("⭐ exercises the one call every render depends on", () => {
    /**
     * §7.6.2: we ALWAYS use `link_with_params` and never let Creatify scrape.
     * If that call breaks, every video breaks — and the storyboard the founder
     * approved would describe frames the vendor never received.
     */
    const checks = checksForTier(3).map((c) => c.check);
    expect(checks).toContain("creatify.links.link_with_params");
  });

  it("⚠️ tier 3 is the only tier that admits to costing money", () => {
    // §18.0.5: reads are ~0, tier 3 is real money. A tier-3 check reporting
    // zero cost is one whose spend nobody is tracking.
    for (const check of checksForTier(3)) {
      expect(check.estCostUsd, `${check.check} claims to be free`).toBeGreaterThan(0);
    }
  });

  it("⚠️ never points a fleet-wide health check at a customer's site", () => {
    /**
     * This runs unattended across the fleet. Pointing it at a founder's URL
     * would spend their vendor's time on our health check and make a smoke run
     * indistinguishable from real work in the vendor's logs.
     */
    const src = readFileSync(
      join(process.cwd(), "convex/vendorSmoke/registry.ts"),
      "utf8"
    );
    const block = src.slice(src.indexOf("const creatifyLinkRoundTrip"));
    expect(block.slice(0, 3000)).toContain("placehold.co");
  });
});
