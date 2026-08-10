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

describe("aggregate learning (§16.9.3)", () => {
  const SOURCE_AGG = readFileSync(
    join(process.cwd(), "convex", "founder", "fleetHealth.ts"),
    "utf8"
  );

  /**
   * ⭐ §14.2.1: "`unknown` is a real answer" — it means no numbers came back.
   * Folding it into the fleet picture would make "we can't see" look like a
   * diagnosis, and at low customer counts it would usually win.
   */
  it("excludes `unknown` from the fleet ladder rather than counting it", () => {
    expect(SOURCE_AGG).toContain('verdict.rung === "unknown"');
    expect(SOURCE_AGG).toContain("continue");
  });

  /**
   * `healthy` is the good outcome. A mostly-healthy fleet would otherwise
   * report "healthy" as the thing to go and fix.
   */
  it("never reports `healthy` as the most common break", () => {
    expect(SOURCE_AGG).toContain('r.rung !== "healthy"');
  });

  /**
   * ⭐ One founder restating a rule five times is one signal, not five —
   * otherwise the loudest customer sets the roadmap.
   */
  it("counts directives per account, not per row", () => {
    expect(SOURCE_AGG).toContain("Set<string>");
    expect(SOURCE_AGG).toContain("accounts: accounts.size");
  });

  /**
   * The fleet number and every per-customer number must be the same
   * arithmetic, or the operator view and the founder's own recap disagree
   * about the same week.
   */
  it("uses the same pure verdict the weekly report and nextIdea use", () => {
    expect(SOURCE_AGG).toContain("diagnoseFrom");
    /**
     * ⚠️ Static import — a dynamic one typechecks and dies at runtime.
     *
     * Built by concatenation rather than written literally: the sibling-file
     * scanner in `tests/sprint1Acceptance.test.ts` reads every `from "…"` in
     * `convex/` and checks it resolves. A literal here looks like an import
     * from `convex/founder/__tests__/`, which would resolve nowhere — the
     * scanner was right to flag it, so the assertion is what changes.
     */
    const ladderPath = "../maya/" + "ladder";
    expect(SOURCE_AGG).toContain(`from "${ladderPath}"`);
    expect(SOURCE_AGG).not.toContain(`await import("${ladderPath}")`);
  });

  it("keeps `notYetAnswered` as a field even when empty", () => {
    // The next thing this view can't answer belongs there. A screen that
    // silently covers three of four questions is how someone concludes the
    // fourth is fine.
    expect(SOURCE_AGG).toContain("notYetAnswered: []");
  });
});
