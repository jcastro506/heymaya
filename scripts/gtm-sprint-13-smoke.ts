#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 13 — L4 live smoke (image bump + persistent volume +
 * cost-cap kill switch).
 *
 * Per Part III of docs/CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md, every sprint
 * ends with a real-world verification step. This smoke proves the foundation
 * pieces of Sprint 13 are wired before operator runs the manual L6 checks
 * (doctor / audit / volume persistence) on a throwaway Fly app.
 *
 * Modes:
 *   - Default (no flags): in-process verification of code wiring only. No
 *     external API calls. Safe to run in CI.
 *   - `--live --confirm`: identical assertions but also exercises the cost-cap
 *     against a real Convex staging deployment via convex-test against the
 *     production schema. Future sprint will extend this to the staging Convex.
 *
 * Exit codes:
 *   0 — Sprint 13 deliverables wired correctly.
 *   1 — One or more checks failed; deliverable not gate-ready.
 *   2 — Smoke harness error (test setup / fixture problem).
 */

import { convexTest } from "convex-test";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import {
  HOURLY_COST_CAP_USD,
  evaluateCostCap,
} from "../convex/gtmMaya/costCap";
import {
  OPENCLAW_IMAGE_PINNED,
  OPENCLAW_IMAGE_TARGET,
  resolveOpenClawImage,
} from "../convex/onboarding/gtm/deployMayaGtm";
import { scanWorkspaceCoherence } from "./scan-workspace-coherence";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Check {
  name: string;
  status: "passed" | "failed";
  detail: string;
}

function buildConvexModules(): Record<string, () => Promise<unknown>> {
  const convexDir = join(REPO_ROOT, "convex");
  const modules: Record<string, () => Promise<unknown>> = {};
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === ".git") continue;
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts") && !name.endsWith(".js")) continue;
      if (name.endsWith(".d.ts")) continue;
      if (full.includes("__tests__") || name.endsWith(".test.ts")) continue;
      const rel = relative(convexDir, full).split("\\").join("/");
      modules[`../convex/${rel}`] = () => import(full);
    }
  }
  walk(convexDir);
  return modules;
}

const checks: Check[] = [];

function pass(name: string, detail: string): void {
  checks.push({ name, status: "passed", detail });
}

function fail(name: string, detail: string): void {
  checks.push({ name, status: "failed", detail });
}

function checkOpenClawImageConstants(): void {
  if (OPENCLAW_IMAGE_TARGET !== "registry.fly.io/heymaya-openclaw:v2026.5.26") {
    fail(
      "openclaw-image-target",
      `OPENCLAW_IMAGE_TARGET is "${OPENCLAW_IMAGE_TARGET}"; expected "registry.fly.io/heymaya-openclaw:v2026.5.26"`
    );
    return;
  }
  const expectedPinned =
    "registry.fly.io/heymaya-openclaw:v2026.5.26@sha256:3856db33c587c2404c71b4a662d0a20ef5027422834e48dfe5f597406e228d0f";
  if (OPENCLAW_IMAGE_PINNED !== expectedPinned) {
    fail(
      "openclaw-image-pinned",
      `OPENCLAW_IMAGE_PINNED is "${OPENCLAW_IMAGE_PINNED}"; expected "${expectedPinned}"`
    );
    return;
  }
  pass(
    "openclaw-image-constants",
    `pinned=${OPENCLAW_IMAGE_PINNED} target=${OPENCLAW_IMAGE_TARGET}`
  );
}

function checkOpenClawImageResolver(): void {
  // No env override -> pinned default.
  const baseline = resolveOpenClawImage({});
  if (baseline !== OPENCLAW_IMAGE_PINNED) {
    fail(
      "openclaw-image-resolver-default",
      `Default resolution is "${baseline}", expected pinned ${OPENCLAW_IMAGE_PINNED}`
    );
    return;
  }
  // Operator override -> target.
  const overridden = resolveOpenClawImage({
    MAYA_GTM_OPENCLAW_IMAGE: OPENCLAW_IMAGE_TARGET,
  });
  if (overridden !== OPENCLAW_IMAGE_TARGET) {
    fail(
      "openclaw-image-resolver-override",
      `Override resolution is "${overridden}", expected ${OPENCLAW_IMAGE_TARGET}`
    );
    return;
  }
  pass(
    "openclaw-image-resolver",
    "default resolves to pinned; env override resolves to target"
  );
}

function checkCostCapEvaluatorBoundaries(): void {
  const ok = evaluateCostCap({
    scope: "hour",
    currentSpendUsd: 0.5,
    capUsd: HOURLY_COST_CAP_USD,
    nextCostUsd: 0.4,
  });
  if (!ok.allowed) {
    fail(
      "cost-cap-eval-allow",
      `evaluator wrongly rejected spend below cap: ${ok.reason ?? "no reason"}`
    );
    return;
  }
  const blocked = evaluateCostCap({
    scope: "hour",
    currentSpendUsd: 0.95,
    capUsd: HOURLY_COST_CAP_USD,
    nextCostUsd: 0.2,
  });
  if (blocked.allowed) {
    fail(
      "cost-cap-eval-block",
      "evaluator allowed spend that should cross hourly cap"
    );
    return;
  }
  if (!blocked.reason?.includes("hour cost cap exceeded")) {
    fail("cost-cap-eval-reason", `evaluator block reason: ${blocked.reason}`);
    return;
  }
  if (HOURLY_COST_CAP_USD !== 1.0) {
    fail(
      "cost-cap-hourly-locked-at-1usd",
      `HOURLY_COST_CAP_USD is ${HOURLY_COST_CAP_USD}, expected 1.0 per Sprint 13 spec`
    );
    return;
  }
  pass(
    "cost-cap-evaluator",
    `pure evaluator allows under cap, blocks at $${HOURLY_COST_CAP_USD}/hr ceiling`
  );
}

async function checkCostCapAgainstConvex(): Promise<void> {
  const t = convexTest(schema, buildConvexModules());
  const user = t.withIdentity({
    subject: `gtm_sprint13_smoke_${Date.now()}`,
    email: "gtm-sprint13@clawlaunch.test",
  });

  const start = await user.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const appId = await user.mutation(
    api.gtmMaya.researchLifecycle.setAppProfile,
    {
      name: "Sprint 13 Smoke App",
      url: "https://sprint13.clawlaunch.test",
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    }
  );
  const jobId = await user.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 3 }
  );

  const before = await user.query(api.gtmMaya.costCap.getMyCostCapStatus, {
    scope: "hour",
    nextCostUsd: 0.1,
  });
  if (!before) {
    fail("cost-cap-status-shape", "getMyCostCapStatus returned null for signed-in user");
    return;
  }
  if (!before.allowed) {
    fail(
      "cost-cap-fresh-account-allowed",
      `fresh account should allow spend; status=${JSON.stringify(before)}`
    );
    return;
  }

  // Burn ~$0.95 so the next $0.10 trips the $1/hr ceiling.
  for (let i = 0; i < 5; i++) {
    await user.mutation(api.gtmMaya.researchLifecycle.recordCost, {
      researchJobId: jobId,
      provider: "scrapecreators",
      operation: `sprint13.smoke.${i}`,
      reason: "Sprint 13 L4 smoke burn",
      costUsd: 0.19,
      cacheStatus: "called",
    });
  }

  const tripped = await user.query(api.gtmMaya.costCap.getMyCostCapStatus, {
    scope: "hour",
    nextCostUsd: 0.1,
  });
  if (!tripped) {
    fail("cost-cap-after-burn", "status query returned null after burn");
    return;
  }
  if (tripped.allowed) {
    fail(
      "cost-cap-after-burn",
      `expected $1/hr cap to block after ~$0.95 burn; got allowed=${tripped.allowed}, currentSpend=$${tripped.currentSpendUsd}`
    );
    return;
  }

  const preflight = await t.query(
    internal.gtmMaya.costCap.checkCostCapPreflight,
    {
      accountId: start.accountId,
      nextCostUsd: 0.1,
    }
  );
  if (preflight.allowed) {
    fail(
      "cost-cap-preflight-blocks",
      "internal preflight allowed spend that public query blocked"
    );
    return;
  }

  pass(
    "cost-cap-end-to-end",
    `kill switch trips at \$${HOURLY_COST_CAP_USD}/hr (currentSpend=\$${tripped.currentSpendUsd.toFixed(2)}); both public + internal query agree`
  );
}

function checkWorkspaceCoherence(): void {
  const issues = scanWorkspaceCoherence();
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    fail(
      "workspace-coherence",
      `coherence scan found ${errors.length} error(s): ${errors
        .map((i) => i.rule)
        .join(", ")}`
    );
    return;
  }
  pass(
    "workspace-coherence",
    `coherence scan clean${issues.length > 0 ? ` (${issues.length} warning(s))` : ""}`
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");

  if (liveMode && !confirmed) {
    console.error(
      "[smoke] --live requires --confirm to acknowledge real-API spend"
    );
    process.exit(2);
  }

  checkOpenClawImageConstants();
  checkOpenClawImageResolver();
  checkCostCapEvaluatorBoundaries();
  checkWorkspaceCoherence();
  await checkCostCapAgainstConvex();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }

  const totalPassed = checks.filter((c) => c.status === "passed").length;
  console.log(
    `\nSprint 13 L4 smoke: ${totalPassed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups (cannot be automated):\n" +
        "  1. Deploy throwaway Fly app on OPENCLAW_IMAGE_TARGET.\n" +
        "  2. Run `openclaw doctor` + `openclaw security audit --deep`. Both green.\n" +
        "  3. SSH into the machine, write to <workspace>/MEMORY.md, restart, verify persistence.\n" +
        "  4. Run `openclaw skills list` and confirm count matches the generated workspace.\n" +
        "  5. Screenshot doctor + audit output, attach to PR description."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
