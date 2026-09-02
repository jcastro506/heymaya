/**
 * ⭐ Every "per day" boundary belongs to the FOUNDER's day, not UTC's.
 *
 * On 2026-08-06 this codebase had **seven** copies of
 *
 *     Math.floor(now / 86_400_000) * 86_400_000
 *
 * across five files. In `America/New_York` that expression starts "today" at
 * **20:00 the previous evening**, and every instance was silently wrong in the
 * same direction:
 *
 *  - `liveness.gatherFacts` — counted last night's posts as today's, so the
 *    zero-placement alert could not fire on a day she posted nothing. She posts
 *    in the evening, so this was the normal case, not an edge case.
 *  - `dailyReport.sendEveningRecap` — the recap fires at 20:00 local, which IS
 *    00:00 UTC, so its window was milliseconds wide: "Nothing went out today"
 *    on a four-post day.
 *  - `messages.proactiveSentToday` — her daily interruption allowance reset at
 *    20:00, so she could spend it and spend it again two hours later.
 *  - `spendCeiling.spendToday` — an evening runaway got a fresh budget at 8pm.
 *  - `spendCeiling.alertThrottled` — "one alert per day" became two.
 *  - `planFeatures` post and video budgets — same, for posts and renders.
 *
 * Each was individually plausible and collectively a class. This file exists so
 * the eighth one fails the build instead of the creator.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dayKeyInZone,
  dayScanFloor,
  isSameDayInZone,
  isSameMonthInZone,
  monthScanFloor,
} from "../cadence";

const MAYA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const NY = "America/New_York";

function sourceFiles(): Array<{ name: string; text: string }> {
  return readdirSync(MAYA_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ name: f, text: readFileSync(join(MAYA_DIR, f), "utf8") }));
}

describe("no module reinvents the UTC day", () => {
  it("finds the modules at all", () => {
    // A zero-file scan would pass the rule below forever.
    expect(sourceFiles().length).toBeGreaterThan(8); // core/ is smaller than the old maya/ tree
  });

  /**
   * ⚠️ THE GUARD MISSED THE EIGHTH INSTANCE, because it only knew one spelling.
   *
   * `hooks.ts` built day keys with `new Date().toISOString().slice(0, 10)` in
   * three places — same UTC bug, different syntax, invisible to the check
   * below. The 20:00 recap on 2026-08-07 was filed as `recap:2026-08-08`, and
   * the next evening's recap would have been deduped away against it.
   *
   * A guard that knows one spelling of a mistake catches one spelling of it.
   */
  /**
   * Two legitimate uses, named rather than pattern-matched around.
   *
   * The rule is about deriving a DAY BOUNDARY from a timestamp. Neither of
   * these does:
   *
   * - `cadence.previousDay` steps back one calendar day on a YYYY-MM-DD key
   *   that has ALREADY been resolved in the founder's zone. The `Date.UTC`
   *   construction is what makes that arithmetic exact.
   * - `voice.ts` buckets samples by day to pick a spread across sessions.
   *   It needs days to be *distinguishable*, not aligned to anyone — any
   *   consistent split does the job.
   *
   * Listed by file and reason so adding a third costs a sentence of
   * justification, which is the point.
   */
  const GROUPING_NOT_BOUNDARIES = new Set(["cadence.ts", "voice.ts"]);

  it("nothing derives a day key from an ISO string either", () => {
    const offenders: string[] = [];
    for (const { name, text } of sourceFiles()) {
      if (GROUPING_NOT_BOUNDARIES.has(name)) continue;
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
        .replace(/^\s*\/\/.*$/gm, "");
      code.split("\n").forEach((line, i) => {
        if (/toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/.test(line)) {
          offenders.push(`${name}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      "Use dayKeyInZone(ts, timezone) — an ISO slice is UTC, and 20:00 in New " +
        "York is already tomorrow there.\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("nothing computes a day boundary by dividing by 86_400_000", () => {
    const offenders: string[] = [];
    for (const { name, text } of sourceFiles()) {
      // Strip comments first — cadence.ts documents the bug on purpose, and a
      // rule that forbids describing itself is a rule people delete.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
        .replace(/^\s*\/\/.*$/gm, "");
      code.split("\n").forEach((line, i) => {
        if (/Math\.floor\(\s*\w+\s*\/\s*86_?400_?000\s*\)/.test(line)) {
          offenders.push(`${name}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      "Use isSameDayInZone/dayScanFloor from cadence.ts — a UTC midnight " +
        "boundary starts the day at 20:00 the previous evening in New York.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

describe("the founder's day, across the boundary that caused this", () => {
  // 2026-08-05 20:30 New York === 2026-08-06 00:30 UTC. The evening window
  // where UTC and the founder disagree about which day it is.
  const eveningNY = Date.UTC(2026, 7, 6, 0, 30);
  const nextNoonNY = Date.UTC(2026, 7, 6, 16, 0); // 12:00 on the 6th in NY

  it("an evening post belongs to the evening, not to tomorrow", () => {
    expect(dayKeyInZone(eveningNY, NY)).toBe("2026-08-05");
    // What the old arithmetic said, kept visible so the difference is plain.
    expect(dayKeyInZone(eveningNY, "UTC")).toBe("2026-08-06");
  });

  it("last night's activity is NOT part of today", () => {
    expect(isSameDayInZone(eveningNY, nextNoonNY, NY)).toBe(false);
    // The bug, stated as an assertion: in UTC it looks like the same day.
    expect(isSameDayInZone(eveningNY, nextNoonNY, "UTC")).toBe(true);
  });

  it("the same evening IS part of that evening's day", () => {
    const sameEveningLater = Date.UTC(2026, 7, 6, 2, 0); // 22:00 on the 5th, NY
    expect(isSameDayInZone(eveningNY, sameEveningLater, NY)).toBe(true);
  });

  it("works for a zone ahead of UTC too, not just behind", () => {
    // 23:00 UTC on the 5th is already the 6th in Tokyo.
    const lateUtc = Date.UTC(2026, 7, 5, 23, 0);
    expect(dayKeyInZone(lateUtc, "Asia/Tokyo")).toBe("2026-08-06");
    expect(isSameDayInZone(lateUtc, Date.UTC(2026, 7, 6, 3, 0), "Asia/Tokyo")).toBe(
      true,
    );
  });

  it("month boundaries move with the zone as well", () => {
    // 2026-08-01 00:30 UTC is still July 31st in New York.
    const firstUtc = Date.UTC(2026, 7, 1, 0, 30);
    const midAugustNY = Date.UTC(2026, 7, 15, 16, 0);
    expect(isSameMonthInZone(firstUtc, midAugustNY, NY)).toBe(false);
    expect(isSameMonthInZone(firstUtc, midAugustNY, "UTC")).toBe(true);
  });
});

describe("the scan floors are wide enough to be safe", () => {
  it("a day scan reaches back past every timezone offset", () => {
    const now = Date.UTC(2026, 7, 6, 12, 0);
    // No zone is more than 26h from UTC; two days is comfortably beyond it, so
    // the founder's whole day is always inside the scanned range.
    expect(now - dayScanFloor(now)).toBeGreaterThan(26 * 3_600_000);
  });

  it("a month scan covers the longest month plus slack", () => {
    const now = Date.UTC(2026, 7, 6, 12, 0);
    expect(now - monthScanFloor(now)).toBeGreaterThan(31 * 86_400_000);
  });
});
