/**
 * generateBootMd — per-creator startup checklist on gateway restart.
 *
 * Sprint 3.7 phase A. Optional but useful per OpenClaw spec
 * (`https://docs.openclaw.ai/concepts/agent-workspace.md`). Read once on
 * gateway boot to verify the runtime can reach every dependency before
 * proactive behaviors initiate.
 *
 * Pure function, deterministic. Shared across creators (same dependency
 * set every Maya needs).
 */

export interface BootMdInputs {
  creatorDisplayName: string;
}

export function generateBootMd(inputs: BootMdInputs): string {
  return [
    `# BOOT.md — startup checklist for Maya / ${inputs.creatorDisplayName}`,
    "",
    "Run on gateway restart, before any proactive behavior fires. If any check fails, do NOT initiate cron behaviors — message the operator via `/admin` channel and wait.",
    "",
    "## Read",
    "",
    "- Read `SOUL.md`, `USER.md`, and `AGENTS.md` fully. These set persona, identity, and operating instructions for the session.",
    "- Read `MEMORY.md` to load curated long-term memory.",
    "- Skim `standing-orders.md` if present — every cron tick references a program here.",
    "",
    "## Verify",
    "",
    "- ScrapeCreators agent skill is loaded — call `lc_maya.health_scrapecreators` and confirm a 200.",
    "- Composio universal runner can reach this creator's connected accounts — call `lc_maya.connected_accounts_health`. A revoked account is OK at boot (the playbook handles re-auth prompting); a transport error is not.",
    "- Model router endpoint is reachable — POST a noop to `agents/modelRouter/maya/callMaya` with `dryRun: true` and confirm the round-trip.",
    "- Cron config is installed — `openclaw cron list` should return the jobs.json entries assembled at deploy time.",
    "",
    "## Failure escalation",
    "",
    "- ScrapeCreators down → message `/admin` and wait. The creator gets no proactive behaviors until the read layer is back.",
    "- Composio down → continue without write surfaces; surface a one-line note in the next morning brief that 'Gmail/Calendar/Stripe is offline this morning, will retry on the next heartbeat.'",
    "- Model router down → block all behaviors; this is total. Page the operator immediately.",
    "- Cron not installed → page the operator; this means the deploy bundle did not land.",
    "",
  ].join("\n");
}
