#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 22 — L4 smoke (production readiness).
 *
 * Verifies the readiness check works against ENV state. Prints a
 * structured report so the operator can see at-a-glance which features
 * are wired vs which need env config.
 */

import { convexTest } from "convex-test";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

interface ReadinessReport {
  productionReady: boolean;
  features: Array<{
    feature: string;
    ready: boolean;
    requiredEnv: string[];
    missingEnv: string[];
    note?: string;
  }>;
  missingEnvSummary: string[];
}

async function checkReportShape(): Promise<ReadinessReport | null> {
  const t = convexTest(schema, buildConvexModules());
  const report = (await t.query(
    api.gtmMaya.productionReadiness.getProductionReadinessReport,
    {}
  )) as ReadinessReport;
  if (typeof report.productionReady !== "boolean") {
    fail("report-shape", "productionReady must be boolean");
    return null;
  }
  if (!Array.isArray(report.features) || report.features.length < 5) {
    fail("report-shape", `expected ≥5 features, got ${report.features?.length}`);
    return null;
  }
  for (const f of report.features) {
    if (typeof f.ready !== "boolean") {
      fail("report-feature-ready", `${f.feature}.ready is not boolean`);
      return null;
    }
  }
  pass(
    "report-shape",
    `production-readiness report contains ${report.features.length} feature checks`
  );
  return report;
}

function checkExpectedFeaturesPresent(report: ReadinessReport): void {
  const required = [
    "real_research",
    "calendar_oauth_write",
    "telegram_channel",
    "memory_search_embeddings",
    "openclaw_image_target",
    "hook_bridge_callbacks",
    "fly_deploy",
  ];
  const got = report.features.map((f) => f.feature);
  for (const r of required) {
    if (!got.some((g) => g.includes(r))) {
      fail("expected-features", `missing feature in report: ${r}`);
      return;
    }
  }
  pass(
    "expected-features",
    `all ${required.length} expected feature gates appear in the readiness report`
  );
}

function printReport(report: ReadinessReport): void {
  console.log("");
  console.log("Production readiness report (in-process):");
  console.log("─".repeat(70));
  for (const f of report.features) {
    const glyph = f.ready ? "✓" : "✗";
    console.log(`${glyph} ${f.feature}`);
    if (f.note) console.log(`    ${f.note}`);
    if (f.missingEnv.length > 0) {
      console.log(`    missing: ${f.missingEnv.join(", ")}`);
    }
  }
  console.log("─".repeat(70));
  console.log(
    report.productionReady
      ? "PRODUCTION READY (all features wired)"
      : `NOT PRODUCTION READY — missing: ${report.missingEnvSummary.join(", ")}`
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  const report = await checkReportShape();
  if (!report) {
    printSummary();
    process.exit(1);
    return;
  }
  checkExpectedFeaturesPresent(report);
  printReport(report);

  printSummary();
  const failed = checks.filter((c) => c.status === "failed");
  process.exit(failed.length === 0 ? 0 : 1);
}

function printSummary(): void {
  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 22 L4 smoke: ${passed}/${checks.length} checks passed.`
  );
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
