/**
 * generateHeartbeat — per-business HEARTBEAT.md generator for service-product Maya.
 *
 * Mirror of creator-side `generateHeartbeatMd.ts`. Read on every heartbeat
 * tick — keep terse to avoid token burn. Per R3 § 4 + § 9, hard cap 2K chars.
 *
 * Pure function, deterministic. Plan-tier conditioned: Starter skips the
 * Pro+ checklist items.
 */

import { HEARTBEAT_MAX_CHARS, type ServiceWorkspaceInputs } from "./types";

export interface HeartbeatInputs {
  business: ServiceWorkspaceInputs["business"];
  plan: ServiceWorkspaceInputs["plan"];
}

export const HEARTBEAT_SOFT_CAP_CHARS = HEARTBEAT_MAX_CHARS;

export function generateHeartbeat(inputs: HeartbeatInputs): string {
  const { business, plan } = inputs;

  const items: string[] = [
    "Read today's morning brief if not yet processed; surface unresolved approvals.",
    "Scan `inboundLeads` for any aged > 2h with no operator response — fire `lead_response_alarm` if found AND today's unsolicited count < 4.",
    "Check `reviews` for new entries since last tick — if any, draft replies via `maya-service-review-reply-drafter` and ping operator (NEVER auto-post).",
    "Check `serviceJobs.status='completed'` since last tick — queue review requests per the `job_completion_review_request` standing order.",
    "Scan `mediaAssets.catalog` for newly-cataloged inbound media — surface multi-media disambiguation prompt if 60-sec window contains >1 asset.",
    "If a recent `chatMessages` row from the operator is unread, prioritize the reply over any cron-driven push.",
  ];
  if (plan !== "starter") {
    items.push(
      "Skim Zernio webhook backlog — fold notable engagement into next brief, not separate ping."
    );
    items.push(
      "If `crmConnections` last-sync > 24h, log to `mayaActionLog` (do not bother operator unless 48h+)."
    );
  } else {
    items.push("Starter: skip engagement-watch, competitor, revenue-snapshot ticks (Pro+ only).");
  }

  const out = [
    "# HEARTBEAT.md",
    "",
    `Tiny per-tick checklist for ${business.name}. Read every tick — keep this file under 2K chars (token-burn matters).`,
    "",
    `Active hours: ${business.businessHours} (fallback 7am-9pm op-tz if business hours unset).`,
    "",
    ...items.map((b) => `- ${b}`),
    "",
    "Quiet ticks are fine. If nothing in the checklist surfaced action, do nothing.",
    "",
  ].join("\n");

  return out;
}
