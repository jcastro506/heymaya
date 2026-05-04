/**
 * Size report — emits a console table of every emitted file's char count.
 * Not an assertion; just observability so the operator (and future
 * sprints) can see at a glance how close each file is to its caps.
 *
 * Use `npx vitest run convex/agents/packs/maya/workspace/__tests__/_sizeReport.test.ts`
 * to print the table.
 */

import { describe, it } from "vitest";
import { assembleWorkspaceBundle } from "../assembleWorkspaceBundle";
import type { Doc } from "../../../../../_generated/dataModel";
import type { WorkspaceInputs } from "../types";

function inputs(plan: "coach" | "manager"): WorkspaceInputs {
  const creator: Doc<"creators"> = {
    _id: "k_creator_size" as unknown as Doc<"creators">["_id"],
    _creationTime: 1_700_000_000_000,
    clerkUserId: "user_size",
    email: "size.report@example.com",
    channelPreference: "imessage",
    timezone: "America/Los_Angeles",
    status: "active",
    plan,
    createdAt: 1_700_000_000_000,
  };
  return {
    creator,
    picture: null,
    handles: [],
    connectedAccounts: [],
    plan,
    now: 1_700_000_000_000,
  };
}

describe("workspace size report (informational)", () => {
  it("prints char counts for every emitted file across all plans (production 28K cap)", () => {
    // Production uses MAYA_BOOTSTRAP_MAX_CHARS = 28_000 (Wave 5 — embed standing
    // orders inline per OpenClaw 2026.4.23 convention). Print under that cap so
    // the table matches what real Mayas ship.
    const PROD_CAP = 28_000;
    for (const plan of ["coach", "manager"] as const) {
      const bundle = assembleWorkspaceBundle(inputs(plan), {
        bootstrapMaxChars: PROD_CAP,
      });
      // eslint-disable-next-line no-console
      console.log(`\n--- ${plan} (cap ${PROD_CAP}) ---`);
      const rows: { file: string; chars: number }[] = [];
      for (const [name, content] of bundle.files) {
        rows.push({ file: name, chars: content.length });
      }
      rows.sort((a, b) => b.chars - a.chars);
      for (const r of rows) {
        // eslint-disable-next-line no-console
        console.log(`  ${r.chars.toString().padStart(6)}  ${r.file}`);
      }
      // eslint-disable-next-line no-console
      console.log(
        `  jobs.json: ${bundle.jobsJson.jobs.length} jobs; standingOrdersSplit=${bundle.standingOrdersSplit}`
      );
    }
  });
});
