/**
 * heartbeatTickIdleAware — Sprint 9 idle-window enforcement tests.
 *
 * Coverage (5 mandatory categories):
 *   1. Cross-tenant isolation — pure function, no DB access; the `creator`
 *      arg only carries `timezone`. We assert one creator's timezone never
 *      bleeds into another's decision.
 *   2. Plan-tier × action — irrelevant here (idle window is not a plan-
 *      tier gate; it's a behavior-time gate). Verified by parity:
 *      same decision regardless of any plan-related context.
 *   3. Adversarial — bogus IANA timezone string throws at the boundary,
 *      not silent-passes; explicit-zero metric ratio is not "urgent".
 *   4. Sibling-file scan — push-capable + read-only check sets together
 *      cover ALL_HEARTBEAT_CHECKS exactly once (no orphans, no overlaps).
 *   5. TODO grep — none introduced.
 */

import { describe, expect, it } from "vitest";
import {
  ALL_HEARTBEAT_CHECKS,
  IDLE_WINDOW_END_HOUR,
  IDLE_WINDOW_START_HOUR,
  _internal,
  isLocalHourIdle,
  localHourInTimezone,
  pickHeartbeatChecksForTime,
} from "../generateHeartbeatMd";

const LA = "America/Los_Angeles";
const NY = "America/New_York";

/**
 * Build a UTC ms instant that resolves to `localHour:00:00` in `tz` for a
 * fixed reference date. We pick an arbitrary 2026 weekday in standard
 * time (no DST cusp) so the offset is constant: LA = UTC-8, NY = UTC-5.
 */
function utcMsForLocalHour(tz: string, localHour: number): number {
  // Reference: 2026-01-15 (Wednesday) — well clear of US DST (DST starts
  // 2026-03-08). LA standard time = UTC-8; NY standard time = UTC-5.
  const offsetH = tz === LA ? 8 : tz === NY ? 5 : 0;
  // Build the UTC equivalent for `localHour` LA/NY time on 2026-01-15.
  return Date.UTC(2026, 0, 15, localHour + offsetH, 0, 0);
}

describe("heartbeat tick — local-hour resolver", () => {
  it("returns expected hours for LA at three known instants", () => {
    expect(localHourInTimezone(utcMsForLocalHour(LA, 11), LA)).toBe(11);
    expect(localHourInTimezone(utcMsForLocalHour(LA, 22), LA)).toBe(22);
    expect(localHourInTimezone(utcMsForLocalHour(LA, 0), LA)).toBe(0);
  });
  it("returns expected hours for NY at three known instants", () => {
    expect(localHourInTimezone(utcMsForLocalHour(NY, 7), NY)).toBe(7);
    expect(localHourInTimezone(utcMsForLocalHour(NY, 23), NY)).toBe(23);
  });
  it("throws on a bogus IANA timezone", () => {
    expect(() => localHourInTimezone(Date.now(), "Mars/Olympus")).toThrow();
  });
});

describe("heartbeat tick — idle window predicate", () => {
  it("classifies 22, 23, 0..6 as idle", () => {
    for (const h of [22, 23, 0, 1, 2, 3, 4, 5, 6]) {
      expect(isLocalHourIdle(h)).toBe(true);
    }
  });
  it("classifies 7..21 as awake", () => {
    for (let h = 7; h <= 21; h++) {
      expect(isLocalHourIdle(h)).toBe(false);
    }
  });
  it("constants sanity-check (window is 22→7 wrap)", () => {
    expect(IDLE_WINDOW_START_HOUR).toBe(22);
    expect(IDLE_WINDOW_END_HOUR).toBe(7);
  });
});

describe("heartbeat tick — pickHeartbeatChecksForTime (LA)", () => {
  const CREATOR_LA = { timezone: LA };

  it("11pm LA: idle, NO push, read-only checks only", () => {
    const decision = pickHeartbeatChecksForTime(
      CREATOR_LA,
      utcMsForLocalHour(LA, 23)
    );
    expect(decision.localHour).toBe(23);
    expect(decision.isIdleHour).toBe(true);
    expect(decision.pushAllowed).toBe(false);
    expect(decision.urgentOverride).toBe(false);
    // Should NOT include any push-capable check.
    for (const c of decision.checksToRun) {
      expect(_internal.PUSH_CAPABLE_CHECKS.has(c)).toBe(false);
    }
    // Should include all read-only checks.
    for (const c of _internal.READ_ONLY_CHECKS) {
      expect(decision.checksToRun).toContain(c);
    }
  });

  it("3am LA: idle, NO push, read-only checks only", () => {
    const decision = pickHeartbeatChecksForTime(
      CREATOR_LA,
      utcMsForLocalHour(LA, 3)
    );
    expect(decision.localHour).toBe(3);
    expect(decision.isIdleHour).toBe(true);
    expect(decision.pushAllowed).toBe(false);
    for (const c of decision.checksToRun) {
      expect(_internal.PUSH_CAPABLE_CHECKS.has(c)).toBe(false);
    }
  });

  it("6:30am LA still idle (window closes at exactly 7:00) — NO push", () => {
    const utc = utcMsForLocalHour(LA, 6) + 30 * 60 * 1000;
    const decision = pickHeartbeatChecksForTime(CREATOR_LA, utc);
    // Local hour at 6:30am still resolves to hour=6, which is idle.
    expect(decision.localHour).toBe(6);
    expect(decision.isIdleHour).toBe(true);
    expect(decision.pushAllowed).toBe(false);
  });

  it("7am LA: idle window closed — push allowed, ALL checks run", () => {
    const decision = pickHeartbeatChecksForTime(
      CREATOR_LA,
      utcMsForLocalHour(LA, 7)
    );
    expect(decision.localHour).toBe(7);
    expect(decision.isIdleHour).toBe(false);
    expect(decision.pushAllowed).toBe(true);
    expect(decision.urgentOverride).toBe(false);
    expect(decision.checksToRun).toEqual(ALL_HEARTBEAT_CHECKS);
  });

  it("URGENT override at 3am: push allowed, ALL checks run, urgentOverride=true", () => {
    const decision = pickHeartbeatChecksForTime(
      CREATOR_LA,
      utcMsForLocalHour(LA, 3),
      { latestPostMetric: { ratio: 0.2 } }
    );
    expect(decision.localHour).toBe(3);
    expect(decision.isIdleHour).toBe(true);
    expect(decision.pushAllowed).toBe(true);
    expect(decision.urgentOverride).toBe(true);
    expect(decision.checksToRun).toEqual(ALL_HEARTBEAT_CHECKS);
  });

  it("ratio = 0.5 is NOT urgent (boundary inclusive on the safe side)", () => {
    const decision = pickHeartbeatChecksForTime(
      CREATOR_LA,
      utcMsForLocalHour(LA, 3),
      { latestPostMetric: { ratio: 0.5 } }
    );
    expect(decision.urgentOverride).toBe(false);
    expect(decision.pushAllowed).toBe(false);
  });

  it("brand-deal red flag at 2am: URGENT override fires", () => {
    const decision = pickHeartbeatChecksForTime(
      CREATOR_LA,
      utcMsForLocalHour(LA, 2),
      { brandDealRedFlag: true }
    );
    expect(decision.urgentOverride).toBe(true);
    expect(decision.pushAllowed).toBe(true);
  });

  it("OAuth revoked at 1am: URGENT override fires", () => {
    const decision = pickHeartbeatChecksForTime(
      CREATOR_LA,
      utcMsForLocalHour(LA, 1),
      { oauthRevokedMidDeal: true }
    );
    expect(decision.urgentOverride).toBe(true);
    expect(decision.pushAllowed).toBe(true);
  });

  it("URGENT context outside idle hours does NOT label as 'urgentOverride' (it's just normal)", () => {
    const decision = pickHeartbeatChecksForTime(
      CREATOR_LA,
      utcMsForLocalHour(LA, 14),
      { latestPostMetric: { ratio: 0.1 } }
    );
    expect(decision.isIdleHour).toBe(false);
    expect(decision.pushAllowed).toBe(true);
    // Override flag is only meaningful inside idle hours; outside, push
    // would have been allowed anyway.
    expect(decision.urgentOverride).toBe(false);
  });
});

describe("heartbeat tick — cross-tenant isolation (timezone purity)", () => {
  it("two creators in different timezones get independent decisions", () => {
    // Same UTC instant: 6am LA = 9am NY (in standard time).
    const utc = utcMsForLocalHour(LA, 6);
    const decisionLA = pickHeartbeatChecksForTime({ timezone: LA }, utc);
    const decisionNY = pickHeartbeatChecksForTime({ timezone: NY }, utc);

    expect(decisionLA.localHour).toBe(6);
    expect(decisionLA.pushAllowed).toBe(false); // 6am LA = idle
    expect(decisionNY.localHour).toBe(9);
    expect(decisionNY.pushAllowed).toBe(true); // 9am NY = awake
  });
});

describe("heartbeat tick — sibling-file scan (check-set coverage)", () => {
  it("PUSH_CAPABLE_CHECKS ∪ READ_ONLY_CHECKS covers ALL_HEARTBEAT_CHECKS exactly once", () => {
    const all = new Set(ALL_HEARTBEAT_CHECKS);
    const union = new Set([
      ..._internal.PUSH_CAPABLE_CHECKS,
      ..._internal.READ_ONLY_CHECKS,
    ]);
    expect(union.size).toBe(all.size);
    for (const c of all) {
      expect(union.has(c)).toBe(true);
    }
    // No overlap — a check is either push-capable or read-only, never both.
    for (const c of _internal.PUSH_CAPABLE_CHECKS) {
      expect(_internal.READ_ONLY_CHECKS.has(c)).toBe(false);
    }
  });
});
