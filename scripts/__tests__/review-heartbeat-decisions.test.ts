/**
 * review-heartbeat-decisions CLI — Sprint 9 formatter tests.
 *
 * The CLI's transport (ConvexHttpClient) is exercised live by the operator;
 * this test pins the format-summary output so the operator's reading
 * convention doesn't drift accidentally between waves.
 */

import { describe, expect, it } from "vitest";
import { formatSummaryReport } from "../review-heartbeat-decisions";
import {
  summarizeTickDecisions,
} from "../../convex/mayaActionLog";
import type { Doc, Id } from "../../convex/_generated/dataModel";

const NOW = Date.UTC(2026, 4, 6, 12, 0, 0);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe("review-heartbeat-decisions — format output", () => {
  it("renders an empty-window report cleanly", () => {
    const summary = summarizeTickDecisions([]);
    const out = formatSummaryReport(
      "creator_abc",
      summary,
      NOW - SEVEN_DAYS_MS,
      NOW
    );
    expect(out).toContain("Total ticks: 0");
    expect(out).toContain("Distinct entries: 0");
    expect(out).toContain("(no entries — heartbeat may be dormant)");
    expect(out).toContain("creator_abc");
  });

  it("renders a populated report with per-entry breakdown", () => {
    const fakeRows: Array<Pick<Doc<"mayaActionLog">, "creatorId" | "entryId" | "outcome" | "ts">> = [
      mkRow("morning_brief", "ran"),
      mkRow("morning_brief", "ran"),
      mkRow("morning_brief", "skipped_condition_unmet"),
      mkRow("evening_recap", "ran"),
      mkRow("brand_email_triage", "failed"),
    ];
    const summary = summarizeTickDecisions(fakeRows as Doc<"mayaActionLog">[]);
    const out = formatSummaryReport(
      "creator_xyz",
      summary,
      NOW - SEVEN_DAYS_MS,
      NOW
    );
    expect(out).toContain("Total ticks: 5");
    expect(out).toContain("Distinct entries: 3");
    expect(out).toContain("morning_brief");
    expect(out).toContain("evening_recap");
    expect(out).toContain("brand_email_triage");
    // Most-active first ordering: morning_brief (3) before evening_recap (1).
    const mbIdx = out.indexOf("morning_brief");
    const erIdx = out.indexOf("evening_recap");
    expect(mbIdx).toBeLessThan(erIdx);
  });
});

function mkRow(
  entryId: string,
  outcome: Doc<"mayaActionLog">["outcome"]
): Pick<Doc<"mayaActionLog">, "creatorId" | "entryId" | "outcome" | "ts"> {
  return {
    creatorId: "fake" as unknown as Id<"creators">,
    entryId,
    outcome,
    ts: NOW,
  };
}
