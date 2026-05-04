/**
 * generateHeartbeatMd — tiny per-tick checklist Maya runs each heartbeat.
 *
 * Sprint 3.7 phase A. Per OpenClaw spec, HEARTBEAT.md is read on every
 * heartbeat tick — keep it under 2K chars to avoid token burn. The content
 * below is a 7-bullet checklist; the bullets are deliberately terse and
 * action-cued.
 *
 * Pure function. The same content is shared across every creator —
 * heartbeat behavior is per-Maya, not per-creator. We accept inputs only
 * for symmetry with the other generators and to allow per-plan tweaks
 * (e.g. Starter skips the brand-email check).
 */

import type { Plan } from "../../../../lib/planFeatures";

export interface HeartbeatMdInputs {
  plan: Plan;
}

/** Soft cap from the OpenClaw spec — heartbeat is read every tick. */
export const HEARTBEAT_SOFT_CAP_CHARS = 2_000;

export function generateHeartbeatMd(inputs: HeartbeatMdInputs): string {
  const { plan } = inputs;
  const items: string[] = [
    "Read today's morning brief if not yet processed; surface any unresolved p0 recommendations.",
    "Check today's scheduled posts in `contentPlans` — flag any where posting time has passed without a `posts` row.",
    "Skim the last 24h of `posts` for outliers (>1.5× or <0.5× trailing baseline) and queue a 2h performance check if a post crossed the threshold.",
    "If a creator-initiated message in `chatMessages` is unread, prioritize the reply over any cron-driven push.",
    "Note anything worth surfacing in the next evening recap — quiet ticks are fine; no padding.",
  ];
  // Both tiers run the brand-triage + competitor checks. The Manager-vs-Coach
  // boundary is whether Maya AUTO-SENDS off these triggers; the heartbeat
  // checklist itself is identical.
  items.push(
    "Check `brandDeals` for new threads needing triage; if `connectedAccounts.autoSendThreshold` is set AND tier is Manager, verify Gmail OAuth is still active before auto-sending. Coach tier: stop at draft."
  );
  items.push(
    "Skim `competitorObservations` from the last 24h — fold notable peer moves into tomorrow's morning brief, not into a separate ping."
  );
  if (plan === "coach") {
    items.push(
      "Coach tier reminder: Maya advises only — never auto-send brand emails, never pitch brands cold, never call Apollo/Hunter. Stop at draft + creator approval."
    );
  }

  return [
    "# HEARTBEAT.md",
    "",
    "Tiny checklist run on every heartbeat tick. Keep this file short — it is read every tick and token-burn matters.",
    "",
    ...items.map((b) => `- ${b}`),
    "",
  ].join("\n");
}
