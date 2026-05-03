/**
 * generateBoot — per-business BOOT.md generator for service-product Maya.
 *
 * Mirror of creator-side `generateBootMd.ts` but tuned for the service
 * product's first-message pattern: cite ≥2 grounded data points from the
 * onboarding bulk pull, open with the fix, close with one specific Q the
 * operator can answer in one tap. Per § 9 + § 5 (sub-5-min onboarding).
 *
 * Pure function, deterministic. Soft cap 3K chars (per § 9, BOOT.md is the
 * smallest of the author-owned files).
 */

import type { ServiceWorkspaceInputs } from "./types";

export interface BootInputs {
  operator: ServiceWorkspaceInputs["operator"];
  business: ServiceWorkspaceInputs["business"];
}

export function generateBoot(inputs: BootInputs): string {
  const { operator, business } = inputs;

  return [
    `# BOOT.md — startup checklist for Maya / ${business.name}`,
    "",
    `Run on gateway restart, before any proactive behavior fires. If any check fails, do NOT initiate cron behaviors — message ${operator.firstName} via the \`/admin\` channel and wait.`,
    "",
    "## Read",
    "",
    "- Read `SOUL.md`, `USER.md`, and `AGENTS.md` fully. These set persona, identity, and operating instructions for the session.",
    "- Read `MEMORY.md` to load curated long-term memory (service-type domain priors + brand-safety rules).",
    "- Skim `standing-orders.md` if present — every cron tick references a program inlined in AGENTS.md or split out here.",
    "",
    "## Verify dependencies",
    "",
    "- Zernio MCP is reachable — call `lc_maya_service.health_zernio` and confirm a 200. GBP read/write/reply, FB/IG/TT publishing all route through Zernio in v0.",
    "- Composio universal runner can reach the operator's connected accounts — call `lc_maya_service.connected_accounts_health`. Gmail/Calendar revoked is OK at boot (the playbook handles re-auth prompting); a transport error is not.",
    "- Model router is reachable — POST a noop to `agents/modelRouter/maya/callMayaService` with `dryRun: true`. Both Gemini 3 Flash AND Gemini 3.1 Flash Lite must round-trip.",
    "- CRM adapter (if `crmConnections.provider != null`) — call `lc_maya_service.crm_health` and confirm last-sync within 24h.",
    "- Cron config is installed — `openclaw cron list` should return the 15 service jobs assembled at deploy.",
    "",
    "## First-message instructions (initial deploy only)",
    "",
    "When the per-business workspace is freshly bootstrapped (no prior `chatMessages` rows), I open the conversation with the operator. The first message MUST:",
    "",
    `- Cite ≥2 grounded data points from the onboarding bulk pull. Examples: "I see ${operator.firstName} has 47 reviews on GBP at 4.7 stars" + "your last GBP post was 11 days ago."`,
    '- **Open with the fix**, not the introduction. Pattern: "I see 6 of your last 30 jobs didn\'t get review requests — I\'ll fix that." Not "Hi! I\'m Maya, your AI office manager!"',
    "- Close with **one specific question** the operator can answer in one tap or a single-word reply. Pattern: 'What's the one job from this week you'd want to highlight?' or 'Should I draft those 6 review requests now or queue them for tomorrow?'",
    "- Match `business.tonePreference` exactly. Friendly-neighborhood-pro reads differently than authoritative-expert.",
    "",
    "## Failure escalation",
    "",
    "- Zernio down → message `/admin`. The operator gets no proactive behaviors until the read layer is back.",
    "- Composio down → continue without write surfaces; surface a one-line note in the next morning brief that 'Gmail/Calendar is offline, will retry on next heartbeat.'",
    "- Model router down → block all behaviors; this is total. Page the operator immediately.",
    "- Cron not installed → page the operator; the deploy bundle did not land cleanly.",
    "",
  ].join("\n");
}
