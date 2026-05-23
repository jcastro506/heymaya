#!/usr/bin/env tsx
/**
 * ClawLaunch GTM cumulative sprint-gate E2E.
 *
 * Per Part III of docs/CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md (§ "Sprint-gate
 * E2E (L5)"), this is the single growing E2E that exercises every sprint's
 * deliverable end-to-end against staging. By the end of S22 it asserts the
 * full signup → onboarding → research → delivery → callback → mutation flow.
 *
 * Scaffolded at Sprint 13 with only the foundation checks. Each subsequent
 * sprint MUST add one section here before its sprint gate can pass.
 *
 * Modes:
 *   --mock-channels --mock-fly  CI mode — no real Fly / Telegram / paid APIs.
 *   --live --confirm            Operator mode — exercises real staging.
 *
 * Exit codes:
 *   0 — gate green for every shipped sprint section.
 *   1 — one or more sprint sections failed.
 *   2 — harness error.
 *
 * Section status legend:
 *   ✓ shipped + passing
 *   - shipped + skipped due to mode
 *   ? not yet shipped (sprint not started)
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type SprintStatus = "shipped-passing" | "shipped-skipped" | "not-yet-shipped";

interface SprintSection {
  sprint: string;
  title: string;
  status: SprintStatus;
  detail: string;
}

const liveMode = process.argv.includes("--live");
const confirmed = process.argv.includes("--confirm");
const mockChannels = process.argv.includes("--mock-channels");
const mockFly = process.argv.includes("--mock-fly");

function delegateToSmoke(
  sprint: string,
  title: string,
  scriptPath: string,
  summaryRegex: RegExp
): SprintSection {
  // Gate composes (not duplicates) per-sprint L4 smokes so additions stay
  // in one place.
  const args: string[] = [];
  if (liveMode) args.push("--live");
  if (confirmed) args.push("--confirm");
  const result = spawnSync("npx", ["tsx", scriptPath, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const out = (result.stdout ?? "") + (result.stderr ?? "");
  const lines = out.split(/\r?\n/).filter((l) => l.length > 0);
  const lastSummary =
    [...lines].reverse().find((l) => summaryRegex.test(l)) ?? "unknown";
  if (result.status === 0) {
    return { sprint, title, status: "shipped-passing", detail: lastSummary };
  }
  return {
    sprint,
    title,
    status: "shipped-skipped",
    detail: `smoke exited ${result.status}: ${lastSummary}`,
  };
}

function delegateToSprint13Smoke(): SprintSection {
  return delegateToSmoke(
    "S13",
    "OpenClaw image bump + persistent volume + cost-cap kill switch",
    "scripts/gtm-sprint-13-smoke.ts",
    /Sprint 13 L4 smoke:/i
  );
}

function delegateToSprint15Smoke(): SprintSection {
  return delegateToSmoke(
    "S15",
    "Telegram channel provisioning at signup",
    "scripts/gtm-sprint-15-smoke.ts",
    /Sprint 15 L4 smoke:/i
  );
}

function delegateToSprint14Smoke(): SprintSection {
  return delegateToSmoke(
    "S14",
    "Native cron delivery (kill mode:none)",
    "scripts/gtm-sprint-14-smoke.ts",
    /Sprint 14 L4 smoke:/i
  );
}

function placeholderSection(sprint: string, title: string): SprintSection {
  return {
    sprint,
    title,
    status: "not-yet-shipped",
    detail: "deliverable not yet shipped",
  };
}

function statusGlyph(status: SprintStatus): string {
  switch (status) {
    case "shipped-passing":
      return "✓";
    case "shipped-skipped":
      return "-";
    case "not-yet-shipped":
      return "?";
  }
}

async function main(): Promise<void> {
  if (liveMode && !confirmed) {
    console.error(
      "[gate] --live requires --confirm to acknowledge real-API spend"
    );
    process.exit(2);
  }
  if (!liveMode && !mockChannels && !mockFly) {
    console.log(
      "[gate] running in in-process mode (no --live, no --mock-* flags); use --live --confirm for the real sprint-gate run"
    );
  }

  const sections: SprintSection[] = [];

  // ─── Sprint 13 ─────────────────────────────────────────────────────────
  sections.push(delegateToSprint13Smoke());

  // ─── Sprint 15 ─────────────────────────────────────────────────────────
  sections.push(delegateToSprint15Smoke());

  // ─── Sprint 14 ─────────────────────────────────────────────────────────
  sections.push(delegateToSprint14Smoke());

  // ─── Sprints not yet shipped — placeholders ────────────────────────────
  sections.push(placeholderSection("S16", "Convex ↔ Maya hook bridge"));
  sections.push(
    placeholderSection("S17", "Real skill installation + ClawHub pinning")
  );
  sections.push(
    placeholderSection("S18", "Heartbeat tasks block (native primitive)")
  );
  sections.push(
    placeholderSection("S19", "Workspace mutation pipeline (post-research)")
  );
  sections.push(placeholderSection("S20", "Subagent lane for paid research"));
  sections.push(
    placeholderSection("S21", "Standing orders + hooks + Policy plugin")
  );
  sections.push(placeholderSection("S22", "Production guardrails"));
  // S1-S12 from the original doc come back here too once they're shipped,
  // in the order specified by Part II's "Updated implementation order".

  // ─── Report ────────────────────────────────────────────────────────────
  console.log("\nClawLaunch GTM Sprint Gate");
  console.log("──────────────────────────");
  for (const s of sections) {
    console.log(
      `${statusGlyph(s.status)}  ${s.sprint} ${s.title}\n   ${s.detail}`
    );
  }
  const passing = sections.filter((s) => s.status === "shipped-passing").length;
  const skipped = sections.filter((s) => s.status === "shipped-skipped").length;
  const pending = sections.filter((s) => s.status === "not-yet-shipped").length;
  console.log(
    `\nGate: ${passing} passing, ${skipped} shipped-but-blocked, ${pending} pending.`
  );
  if (liveMode) {
    console.log(
      "\nReminder — L6 operator follow-ups for each shipped sprint must be completed and attached to the PR before merging staging → main."
    );
  }
  process.exit(skipped === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[gate] harness error:", err);
  process.exit(2);
});
