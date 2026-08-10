/**
 * Fleet health — the gate, and the threshold.
 *
 * The join itself is exercised live; what is pinned here is the security
 * property and the one judgment call, because both fail quietly.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STUCK_AFTER_DAYS } from "../fleetHealth";

const SOURCE = readFileSync(
  join(process.cwd(), "convex", "founder", "fleetHealth.ts"),
  "utf8"
);

describe("the token gate", () => {
  /**
   * ⚠️ Must fail CLOSED when `ADMIN_DASH_TOKEN` is unset.
   *
   * An ops view that opens up because an environment variable is missing is
   * worse than one that is down: the failure is invisible, and this endpoint
   * returns per-customer spend and account ids.
   *
   * Asserted against the source because the check is a module-private function
   * reading `process.env` at call time — the shape of the comparison is the
   * thing that must not regress.
   */
  it("requires the variable to exist, not merely to match", () => {
    expect(SOURCE).toContain("Boolean(expected) && token === expected");
  });

  it("returns nothing but `ok: false` when unauthorised", () => {
    // No partial payload on the unauthorised path — a leaked count is still a
    // leak, and this runs before any read.
    expect(SOURCE).toContain("return { ok: false, notYetAnswered: [] };");
  });
});

describe("the stuck threshold", () => {
  /**
   * ⭐ Two days, not one.
   *
   * A single quiet day is a legitimate outcome — §12 is explicit that honest
   * silence beats fake activity. Alerting on it would flag the fleet most
   * mornings and train the operator to ignore the alert, which is how a real
   * outage gets missed.
   */
  it("is 2 days, so one quiet day isn't an alarm", () => {
    expect(STUCK_AFTER_DAYS).toBe(2);
  });

  it("measures from the last placement, not from the streak", () => {
    // A streak of 0 means "nothing yet today", true of everyone before their
    // first post — using it would flag the whole fleet every morning.
    expect(SOURCE).toContain("publishedAt");
    expect(SOURCE).toContain("Stuck is computed from the LAST PLACEMENT");
  });

  it("always lists an account that has never posted", () => {
    // `null` days-since is worse than stale, not unknown — so it bypasses the
    // threshold rather than being compared against it.
    expect(SOURCE).toContain("daysSince === null || daysSince >= STUCK_AFTER_DAYS");
  });
});

describe("honesty about gaps", () => {
  /**
   * §18's exit asks four questions; this answers two. A plausible-looking
   * number for the other two would be worse than a gap — this is the screen
   * someone opens when they already suspect something is wrong.
   */
  it("names what it cannot answer rather than omitting it", () => {
    expect(SOURCE).toContain("notYetAnswered");
    expect(SOURCE).toMatch(/diagnose|directive aggregation/);
  });
});
