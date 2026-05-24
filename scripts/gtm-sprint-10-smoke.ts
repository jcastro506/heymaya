#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 10 — L4 smoke (Telegram handoff after research).
 *
 * Asserts:
 *   - handoffResearchToTelegram action registered
 *   - getHandoffContext query registered + getGtmAgentForJob too
 *   - buildHandoffPrompt requires Maya to read PLAYBOOK + APP/GTM
 *   - Prompt explicitly bans paid spend on the handoff turn
 *   - Orchestrator's runBudgetedResearchJob references the handoff path
 *
 * Live mode (`--live --confirm`): operator verifies Telegram receives
 * the summary after a real research run.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { api, internal } from "../convex/_generated/api";
import { buildHandoffPrompt } from "../convex/gtmMaya/telegramHandoff";

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

function checkRegistration(): void {
  const required: Array<[string, unknown]> = [
    [
      "internal.gtmMaya.telegramHandoff.handoffResearchToTelegram",
      internal.gtmMaya.telegramHandoff.handoffResearchToTelegram,
    ],
    [
      "internal.gtmMaya.telegramHandoff.getHandoffContext",
      internal.gtmMaya.telegramHandoff.getHandoffContext,
    ],
    [
      "internal.gtmMaya.researchWorker.getGtmAgentForJob",
      internal.gtmMaya.researchWorker.getGtmAgentForJob,
    ],
  ];
  for (const [path, node] of required) {
    if (node === undefined) {
      fail("registration", `${path} not registered`);
      return;
    }
  }
  pass("registration", `handoff + getGtmAgentForJob symbols registered`);
}

function checkPromptCoverage(): void {
  const prompt = buildHandoffPrompt({
    researchJobId: "j" as never,
    primaryChannel: "reddit",
    secondaryChannel: "x",
    evidenceCount: 12,
    spentUsd: 0.34,
    status: "ready_for_review",
    succeededPlatformCount: 3,
    insufficientPlatformCount: 1,
    topEvidenceUrls: [
      "https://reddit.com/r/SaaS/comments/x/",
      "https://x.com/founder/status/1",
    ],
  });

  const required = [
    "PLAYBOOK.md",
    "APP.md",
    "GTM.md",
    "Excited to announce",
    "Do NOT spend",
    "3-sentence Telegram message",
    "anti-slop",
    "reply approve",
    "reddit",
    "$0.34",
  ];
  for (const r of required) {
    if (!prompt.includes(r)) {
      fail("prompt-coverage", `prompt missing required text: '${r}'`);
      return;
    }
  }
  pass(
    "prompt-coverage",
    "handoff prompt names PLAYBOOK + APP/GTM, bans slop phrases + paid spend, mandates 3-sentence Telegram message + approval ask"
  );
}

function checkOrchestratorWiring(): void {
  const body = readFileSync(
    resolve(__dirname, "..", "convex/gtmMaya/researchWorker.ts"),
    "utf8"
  );
  if (
    !body.includes("internal.gtmMaya.telegramHandoff.handoffResearchToTelegram")
  ) {
    fail(
      "orchestrator-wiring",
      "runBudgetedResearchJob does not invoke handoffResearchToTelegram"
    );
    return;
  }
  if (!body.includes("getGtmAgentForJob")) {
    fail(
      "orchestrator-wiring",
      "runBudgetedResearchJob does not look up agent via getGtmAgentForJob"
    );
    return;
  }
  pass(
    "orchestrator-wiring",
    "runBudgetedResearchJob invokes handoffResearchToTelegram after marking job complete"
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkRegistration();
  checkPromptCoverage();
  checkOrchestratorWiring();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 10 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups:\n" +
        "  1. Ensure RWTC has: deployed Fly machine + paired Telegram + provisioned hookToken (all S15+S16).\n" +
        "  2. Trigger runMyResearch on RWTC. Wait for research to complete.\n" +
        "  3. Verify Maya sends a 3-sentence summary to RWTC's Telegram within 2 min of job complete.\n" +
        "  4. Summary should: cite a primary channel, reference ≥1 evidence URL, end with 'reply approve' / 'reply iterate' / 'reply more research'.\n" +
        "  5. Reply 'iterate' from Telegram. Verify Maya routes the reply back as a fresh agent turn (S15 webhook flow).\n" +
        "  6. Slop check: read the summary; confirm it doesn't say 'Excited to announce' or 'supercharge'."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
