#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 2.5 — L4 smoke (launch playbook codification).
 *
 * Asserts that PLAYBOOK.md + per-platform sub-playbooks ship in every Maya
 * workspace, that AGENTS.md instructs Maya to read them on every turn, and
 * that the byte-sync between on-disk `playbook/*.md` and the bundled
 * `convex/agents/packs/maya_gtm/bundledPlaybook.ts` stays consistent.
 *
 * `--live --confirm` adds operator follow-ups for L6 (read Maya's reasoning
 * chain on a fixture launch; confirm she cites playbook rules by number).
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMayaGtmWorkspace } from "../convex/agents/packs/maya_gtm/generators";
import { BUNDLED_PLAYBOOK_ENTRIES } from "../convex/agents/packs/maya_gtm/bundledPlaybook";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAYBOOK_DIR = join(REPO_ROOT, "playbook");

interface Check {
  name: string;
  status: "passed" | "failed";
  detail: string;
}

const checks: Check[] = [];

function pass(name: string, detail: string): void {
  checks.push({ name, status: "passed", detail });
}

function fail(name: string, detail: string): void {
  checks.push({ name, status: "failed", detail });
}

function fixtureInput() {
  return {
    accountEmail: "rwtc@heymaya.test",
    timezone: "America/New_York",
    bootKickoffAtMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    app: {
      name: "Sprint 2.5 Fixture",
      url: "https://sprint25.test/",
      stage: "live-beta" as const,
      weekGoal: "signups" as const,
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [] as string[],
    },
  };
}

function checkBundleByteSync(): void {
  const onDisk = readdirSync(PLAYBOOK_DIR)
    .filter((n) => n.endsWith(".md"))
    .sort();
  const bundled = BUNDLED_PLAYBOOK_ENTRIES.map((e) =>
    e.workspacePath.split("/").pop()
  ).sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(bundled)) {
    fail(
      "bundled-playbook-file-list",
      `on-disk vs bundled file lists diverge — on-disk=${JSON.stringify(onDisk)}, bundled=${JSON.stringify(bundled)}; re-run npm run sync:bundled-playbook`
    );
    return;
  }
  for (const entry of BUNDLED_PLAYBOOK_ENTRIES) {
    const fileName = entry.workspacePath.split("/").pop()!;
    const expected = readFileSync(join(PLAYBOOK_DIR, fileName), "utf8");
    if (expected !== entry.body) {
      fail(
        "bundled-playbook-byte-sync",
        `${fileName} on-disk content diverges from bundled module — re-run npm run sync:bundled-playbook`
      );
      return;
    }
  }
  pass(
    "bundled-playbook-byte-sync",
    `${BUNDLED_PLAYBOOK_ENTRIES.length} playbook entries byte-match between playbook/*.md and bundledPlaybook.ts`
  );
}

function checkPlaybookShipsInWorkspace(): void {
  const { files } = buildMayaGtmWorkspace(fixtureInput());
  const expected = [
    "PLAYBOOK.md",
    "playbook/reddit.md",
    "playbook/x.md",
    "playbook/tiktok.md",
    "playbook/instagram.md",
    "playbook/linkedin.md",
  ];
  const missing = expected.filter((p) => !files.has(p));
  if (missing.length > 0) {
    fail(
      "playbook-files-in-workspace",
      `workspace bundle missing playbook files: ${missing.join(", ")}`
    );
    return;
  }
  pass(
    "playbook-files-in-workspace",
    `all ${expected.length} playbook files ship in workspace bundle`
  );
}

function checkPlaybookSize(): void {
  const totalChars = BUNDLED_PLAYBOOK_ENTRIES.reduce(
    (sum, e) => sum + e.body.length,
    0
  );
  // Realism check: a top-tier launch playbook should be >150KB of doctrine,
  // not a 7-line stub each.
  if (totalChars < 150_000) {
    fail(
      "playbook-substantiveness",
      `bundled playbook is only ${totalChars} chars; expected >150,000 for a real launch playbook`
    );
    return;
  }
  pass(
    "playbook-substantiveness",
    `bundled playbook is ${totalChars} chars across ${BUNDLED_PLAYBOOK_ENTRIES.length} files`
  );
}

function checkAgentsMdReferencesPlaybook(): void {
  const { files } = buildMayaGtmWorkspace(fixtureInput());
  const agents = files.get("AGENTS.md") ?? "";
  if (!agents.includes("PLAYBOOK.md")) {
    fail(
      "agents-md-references-playbook",
      "AGENTS.md does not mention PLAYBOOK.md — Maya won't be told to read the launch doctrine"
    );
    return;
  }
  if (!agents.includes("Playbook first")) {
    fail(
      "agents-md-playbook-first-rule",
      "AGENTS.md Operating Contract is missing the 'Playbook first' rule (#1)"
    );
    return;
  }
  pass(
    "agents-md-references-playbook",
    "AGENTS.md operating contract names PLAYBOOK.md as rule #1 ('Playbook first')"
  );
}

function checkDecisionRulesPresent(): void {
  const playbook =
    BUNDLED_PLAYBOOK_ENTRIES.find((e) => e.workspacePath === "PLAYBOOK.md")?.body ?? "";
  const ruleCount = (playbook.match(/\*\*9\.\d+\*\*/g) ?? []).length;
  if (ruleCount < 20) {
    fail(
      "playbook-decision-rules",
      `PLAYBOOK.md has ${ruleCount} numbered decision rules; expected >=20`
    );
    return;
  }
  pass(
    "playbook-decision-rules",
    `PLAYBOOK.md has ${ruleCount} numbered decision rules (Section 9)`
  );
}

function checkBuildEngageOfferTriad(): void {
  const playbook =
    BUNDLED_PLAYBOOK_ENTRIES.find((e) => e.workspacePath === "PLAYBOOK.md")?.body ?? "";
  const hasTriad =
    /BUILD/i.test(playbook) &&
    /ENGAGE/i.test(playbook) &&
    /OFFER/i.test(playbook) &&
    /9:1/.test(playbook);
  if (!hasTriad) {
    fail(
      "playbook-triad-doctrine",
      "PLAYBOOK.md missing BUILD / ENGAGE / OFFER triad with 9:1 doctrine"
    );
    return;
  }
  pass(
    "playbook-triad-doctrine",
    "PLAYBOOK.md codifies BUILD / ENGAGE / OFFER triad with 9:1 ratio"
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkBundleByteSync();
  checkPlaybookShipsInWorkspace();
  checkPlaybookSize();
  checkAgentsMdReferencesPlaybook();
  checkDecisionRulesPresent();
  checkBuildEngageOfferTriad();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 2.5 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups:\n" +
        "  1. Deploy RWTC. SSH into Fly machine, `cat <workspace>/PLAYBOOK.md | wc -l`. Confirm ≥1000 lines.\n" +
        "  2. Ask Maya via Telegram: 'Walk me through the launch playbook for my product.' Inspect reply. Confirms she references concrete decision rules by number (e.g., 'applying rule 9.3').\n" +
        "  3. Trigger a research turn with a fixture product. Read Maya's channel-judge reasoning. Confirm she cites playbook rules and the relevant playbook/<platform>.md.\n" +
        "  4. Build a 10-launch regression corpus. For each, run channel-judge. Assert >=8/10 pick the documented primary channel.\n" +
        "  5. Spot-check 5 random source URLs from the playbook citations. Confirm they resolve and back the claim."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
