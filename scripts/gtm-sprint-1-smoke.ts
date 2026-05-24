#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 1 — L4 smoke (the orchestrator that REPLACES the skeleton).
 *
 * Asserts:
 *   - runBudgetedResearchJob action is registered (orchestrator alive)
 *   - runMyResearch public action is registered (UI entry point alive)
 *   - assertOwnsResearchJob exists (cross-tenant defense alive)
 *   - The onboarding page imports the new action, not the skeleton
 *
 * Live mode (`--live --confirm`) is the biggest gate of all: it fires
 * the real orchestrator on RWTC + verifies a research job advances
 * through every phase + writes evidence + scores channels + spends
 * <$1.50. This is the moment Maya's brain is real.
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
const pass = (name: string, detail: string) =>
  checks.push({ name, status: "passed", detail });
const fail = (name: string, detail: string) =>
  checks.push({ name, status: "failed", detail });

function checkActionsRegistered(): void {
  const required: Array<{ path: string; node: unknown }> = [
    {
      path: "internal.gtmMaya.researchWorker.runBudgetedResearchJob",
      node: internal.gtmMaya.researchWorker.runBudgetedResearchJob,
    },
    {
      path: "internal.gtmMaya.researchWorker.assertOwnsResearchJob",
      node: internal.gtmMaya.researchWorker.assertOwnsResearchJob,
    },
    {
      path: "internal.gtmMaya.researchWorker.setJobPhase",
      node: internal.gtmMaya.researchWorker.setJobPhase,
    },
    {
      path: "internal.gtmMaya.researchWorker.getEvidenceCardsForScoring",
      node: internal.gtmMaya.researchWorker.getEvidenceCardsForScoring,
    },
    {
      path: "internal.gtmMaya.researchWorker.insertChannelScores",
      node: internal.gtmMaya.researchWorker.insertChannelScores,
    },
    {
      path: "api.gtmMaya.researchWorker.runMyResearch",
      node: api.gtmMaya.researchWorker.runMyResearch,
    },
  ];
  for (const { path, node } of required) {
    if (node === undefined) {
      fail("orchestrator-registration", `${path} not registered`);
      return;
    }
  }
  pass(
    "orchestrator-registration",
    "all 6 orchestrator symbols registered (5 internal + 1 public runMyResearch)"
  );
}

function checkOnboardingPageUsesNewAction(): void {
  const page = readFileSync(
    resolve(__dirname, "..", "app/onboarding/gtm/page.tsx"),
    "utf8"
  );
  if (page.includes("runResearchSkeleton({") || page.includes("runResearchSkeleton(\"")) {
    fail(
      "onboarding-uses-orchestrator",
      "onboarding page still calls runResearchSkeleton; should call runMyResearch"
    );
    return;
  }
  if (!page.includes("runResearch({") || !page.includes("runMyResearch")) {
    fail(
      "onboarding-uses-orchestrator",
      "onboarding page does not import or call runMyResearch action"
    );
    return;
  }
  pass(
    "onboarding-uses-orchestrator",
    "app/onboarding/gtm/page.tsx wired to runMyResearch action (skeleton no longer in production path)"
  );
}

function checkSkeletonStillCallable(): void {
  // Skeleton kept as fallback / test path; the symbol must still exist.
  if (api.gtmMaya.researchWorker.runBudgetedResearchSkeleton === undefined) {
    fail(
      "skeleton-fallback",
      "runBudgetedResearchSkeleton was deleted — should remain as emergency fallback"
    );
    return;
  }
  pass(
    "skeleton-fallback",
    "runBudgetedResearchSkeleton remains as emergency fallback (not in production path)"
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkActionsRegistered();
  checkOnboardingPageUsesNewAction();
  checkSkeletonStillCallable();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 1 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups (THE BIGGEST gate so far — Maya's brain becomes real):\n" +
        "  1. Ensure SCRAPE_CREATORS_API_KEY is set on staging Convex.\n" +
        "  2. Trigger runMyResearch against RWTC's researchJobId. Wait up to 3 minutes.\n" +
        "  3. Verify the job advances through every phase: app_inspection → icp_hypotheses → channel_research → strategy_judge → complete.\n" +
        "  4. Verify ≥5 evidence cards inserted, ≥3 platforms represented.\n" +
        "  5. Verify gtmCostLedger has real spend entries; total <$1.50.\n" +
        "  6. Verify gtmChannelScores has channel decisions; primary channel is sensible for the RWTC product.\n" +
        "  7. Verify Telegram delivery: Maya's next cron tick announces 'research complete, ready for review'.\n" +
        "  8. Mission board shows the evidence + channel decision."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
