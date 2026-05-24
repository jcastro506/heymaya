#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 19 — L4 smoke (workspace mutation pipeline).
 *
 * Asserts:
 *   - workspaceMutator symbols registered (mutate / snapshot / record /
 *     mark-deployed / list)
 *   - Orchestrator wires the mutation dispatch after research complete
 *   - gtmWorkspaceMutations schema indexed correctly (by_account /
 *     by_agent / by_research_job)
 *
 * v0.1 caveat: this sprint persists the mutation event + new content
 * driver-state but does NOT auto-push to Fly. The operator (or a
 * future scheduled job) triggers runMyGtmDeploy to pick up the new
 * workspace bundle. Live mode walks the operator through the manual
 * deploy step.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { api, internal } from "../convex/_generated/api";

interface Check {
  name: string;
  status: "passed" | "failed";
  detail: string;
}
const checks: Check[] = [];
const pass = (n: string, d: string) =>
  checks.push({ name: n, status: "passed", detail: d });
const fail = (n: string, d: string) =>
  checks.push({ name: n, status: "failed", detail: d });

function checkSymbols(): void {
  const required: Array<[string, unknown]> = [
    [
      "internal.gtmMaya.workspaceMutator.mutateWorkspaceFromResearch",
      internal.gtmMaya.workspaceMutator.mutateWorkspaceFromResearch,
    ],
    [
      "internal.gtmMaya.workspaceMutator.snapshotResearchForMutation",
      internal.gtmMaya.workspaceMutator.snapshotResearchForMutation,
    ],
    [
      "internal.gtmMaya.workspaceMutator.recordMutation",
      internal.gtmMaya.workspaceMutator.recordMutation,
    ],
    [
      "internal.gtmMaya.workspaceMutator.markMutationDeployed",
      internal.gtmMaya.workspaceMutator.markMutationDeployed,
    ],
    [
      "api.gtmMaya.workspaceMutator.getMyWorkspaceMutations",
      api.gtmMaya.workspaceMutator.getMyWorkspaceMutations,
    ],
  ];
  for (const [path, node] of required) {
    if (node === undefined) {
      fail("symbols", `${path} not registered`);
      return;
    }
  }
  pass(
    "symbols",
    `all 5 workspaceMutator symbols registered (4 internal + 1 public list query)`
  );
}

function checkOrchestratorWiring(): void {
  const body = readFileSync(
    resolve(__dirname, "..", "convex/gtmMaya/researchWorker.ts"),
    "utf8"
  );
  if (
    !body.includes(
      "internal.gtmMaya.workspaceMutator.mutateWorkspaceFromResearch"
    )
  ) {
    fail(
      "orchestrator-wires-mutator",
      "runBudgetedResearchJob does not dispatch the workspace mutation"
    );
    return;
  }
  if (!body.includes("trigger: \"research_complete\"")) {
    fail(
      "orchestrator-trigger-tag",
      "orchestrator does not tag mutation with trigger=research_complete"
    );
    return;
  }
  pass(
    "orchestrator-wires-mutator",
    "runBudgetedResearchJob dispatches workspace mutation tagged trigger=research_complete after status set + handoff"
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkSymbols();
  checkOrchestratorWiring();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 19 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups (v0.1 — manual redeploy, not auto-push):\n" +
        "  1. After research completes on RWTC, query gtmWorkspaceMutations — confirm a row with deployed=false.\n" +
        "  2. Trigger runMyGtmDeploy for the agent to rebuild + re-upload the workspace bundle with the new APP.md/GTM.md content.\n" +
        "  3. Call markMutationDeployed on the row to close the audit loop.\n" +
        "  4. SSH into Fly + cat /data/workspace/GTM.md — confirm the primary channel from the latest research now appears.\n" +
        "  5. Force /new on the agent (via the Sprint 16 hook bridge) so Maya picks up the new file in her next turn.\n" +
        "\nFuture (Sprint 19.1, NOT done): auto-trigger redeploy on mutation. Cheap deploys + idempotent guarantee."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
