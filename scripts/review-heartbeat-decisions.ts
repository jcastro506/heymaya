#!/usr/bin/env tsx
/**
 * review-heartbeat-decisions — Sprint 9 operator CLI.
 *
 * Reads `mayaActionLog:tickDecisionsLast7Days(creatorId)` over the public
 * Convex client and prints a readable summary: total ticks, breakdown by
 * outcome, and per-entry counts ranked most-active first.
 *
 * Usage:
 *   npx tsx scripts/review-heartbeat-decisions.ts <creatorId>
 *   npx tsx scripts/review-heartbeat-decisions.ts <creatorId> --json
 *
 * Env:
 *   NEXT_PUBLIC_CONVEX_URL — required, points at the deployment to query.
 *
 * The summarizer logic itself lives in `convex/mayaActionLog.ts`
 * (`summarizeTickDecisions`); this script is a thin transport + format
 * shell so the same summary contract gets unit-tested.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import {
  summarizeTickDecisions,
  type TickDecisionSummary,
} from "../convex/mayaActionLog";
import type { Doc } from "../convex/_generated/dataModel";

interface CliFlags {
  creatorId: string | null;
  json: boolean;
  help: boolean;
}

function parseFlags(argv: ReadonlyArray<string>): CliFlags {
  const flags: CliFlags = { creatorId: null, json: false, help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--json") flags.json = true;
    else if (!arg.startsWith("--") && !flags.creatorId) flags.creatorId = arg;
  }
  return flags;
}

function printHelp(): void {
  console.log(
    [
      "review-heartbeat-decisions — last-7-days Maya tick summary",
      "",
      "Usage:",
      "  npx tsx scripts/review-heartbeat-decisions.ts <creatorId>",
      "  npx tsx scripts/review-heartbeat-decisions.ts <creatorId> --json",
      "",
      "Reads `mayaActionLog:tickDecisionsLast7Days` and prints counts.",
      "Requires NEXT_PUBLIC_CONVEX_URL env var pointing at the deployment.",
    ].join("\n")
  );
}

/** Pretty-prints a TickDecisionSummary. Exported for unit tests so the
 *  CLI's output formatting is verifiable without spinning a Convex client. */
export function formatSummaryReport(
  creatorId: string,
  summary: TickDecisionSummary,
  windowStartMs: number,
  windowEndMs: number
): string {
  const lines: string[] = [];
  lines.push(`Heartbeat tick decisions — last 7 days`);
  lines.push(`Creator: ${creatorId}`);
  lines.push(
    `Window:  ${new Date(windowStartMs).toISOString()} → ${new Date(windowEndMs).toISOString()}`
  );
  lines.push("");
  lines.push(`Total ticks: ${summary.totalTicks}`);
  lines.push(`Distinct entries: ${summary.distinctEntries}`);
  lines.push("");
  lines.push("By outcome:");
  for (const [k, v] of Object.entries(summary.byOutcome)) {
    lines.push(`  ${k.padEnd(28)} ${v}`);
  }
  lines.push("");
  lines.push("By entry (most active first):");
  const entries = Object.entries(summary.byEntry).sort(
    (a, b) =>
      b[1].ran +
      b[1].skipped +
      b[1].retried +
      b[1].failed -
      (a[1].ran + a[1].skipped + a[1].retried + a[1].failed)
  );
  if (entries.length === 0) {
    lines.push("  (no entries — heartbeat may be dormant)");
  } else {
    lines.push(
      `  ${"entryId".padEnd(36)} ran    skipped retried failed`
    );
    for (const [id, counts] of entries) {
      lines.push(
        `  ${id.padEnd(36)} ${pad(counts.ran)} ${pad(counts.skipped)} ${pad(counts.retried)} ${pad(counts.failed)}`
      );
    }
  }
  return lines.join("\n");
}

function pad(n: number): string {
  return String(n).padStart(6, " ").padEnd(7, " ");
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }
  if (!flags.creatorId) {
    console.error("Missing creatorId. Run with --help for usage.");
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    console.error("NEXT_PUBLIC_CONVEX_URL is not set.");
    process.exit(1);
  }
  const client = new ConvexHttpClient(url);
  // Cast the user-supplied string into the branded id type. The query
  // validator will reject ill-formed ids at the server side.
  const result = await client.query(api.mayaActionLog.tickDecisionsLast7Days, {
    creatorId: flags.creatorId as Doc<"creators">["_id"],
  });
  const summary = summarizeTickDecisions(result.rows);
  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          creatorId: flags.creatorId,
          windowStartMs: result.windowStartMs,
          windowEndMs: result.windowEndMs,
          summary,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      formatSummaryReport(
        flags.creatorId,
        summary,
        result.windowStartMs,
        result.windowEndMs
      )
    );
  }
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("review-heartbeat-decisions.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error("FATAL:", err);
    process.exit(2);
  });
}
