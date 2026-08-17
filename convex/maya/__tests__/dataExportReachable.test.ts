/**
 * ⭐ §18 Sprint 10 lists "account deletion + data export" under the operational
 * essentials — *"without these it is not handable."*
 *
 * ⚠️ Deletion had a page and export had NOTHING. `requestMyDataExport` was
 * built, tested, and had no caller anywhere in `app/`, so a founder could
 * delete everything and never get a copy of it first. That ordering is exactly
 * backwards: the irreversible action shipped and the reversible one didn't.
 *
 * This asserts the reachability, not the export logic — `dataExport.test.ts`
 * already covers the scoping and the truncation. A perfectly correct exporter
 * nobody can invoke is the defect class this whole codebase keeps producing.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS = readFileSync(
  join(process.cwd(), "app/clawlaunch/mission/settings/page.tsx"),
  "utf8",
);

describe("a founder can actually get their data out", () => {
  it("⭐ settings calls the export action", () => {
    expect(SETTINGS).toContain("api.maya.dataExport.requestMyDataExport");
  });

  it("⭐ and offers the file when it comes back", () => {
    // An action that runs and returns a URL nobody renders is the same gap one
    // layer further in.
    expect(SETTINGS).toMatch(/exportUrl/);
    expect(SETTINGS).toMatch(/download/i);
  });

  it("⚠️ surfaces truncation rather than swallowing it", () => {
    /**
     * The export caps the longest histories. A file that silently dropped the
     * tail of a table is one the founder would reasonably believe is complete —
     * §14.45's rule that a partial figure is never presented as the whole
     * applies to their data as much as to their results.
     */
    expect(SETTINGS).toContain("exportTruncated");
  });

  it("⚠️ export sits BEFORE the danger zone on the page", () => {
    /**
     * Ordering as a safety property, not decoration. The founder who scrolls to
     * "delete my account" passes "get your data out" on the way — which is the
     * one sequence that makes the irreversible action recoverable.
     */
    expect(SETTINGS.indexOf('title="Your data"')).toBeGreaterThan(-1);
    expect(SETTINGS.indexOf('title="Your data"')).toBeLessThan(
      SETTINGS.indexOf('title="Danger zone"'),
    );
  });
});
