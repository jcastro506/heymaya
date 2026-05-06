/**
 * generateHeartbeatMd — per-tick playbook Maya consults each heartbeat.
 *
 * Sprint 3 Slice 2 rewrite. Sprint 1 collapsed cron to 6 precise-timing
 * entries; the 9 standing orders that were previously cron-driven (plus
 * 2 always-on items) now run through this checklist on every heartbeat
 * tick. OpenClaw owns the tick cadence — this file is the playbook Maya
 * reads when the tick fires.
 *
 * Hard rules baked into the prose (so Maya enforces them, not TypeScript):
 *   - Idle window: no push 10pm-7am local UNLESS URGENT (post crashed
 *     below 0.3× baseline, or brand email flagged paid-deal-pending).
 *   - One push per tick maximum. Stop on the first ACT unless the action
 *     is silent (write-only).
 *   - Citation firewall mandatory. Grounded or silent.
 *   - Skip-if-recent cooldowns are guidance to Maya — she queries
 *     `mayaActionLog` to honor them; this file states the windows.
 *   - Tone is anti-sycophancy. Tone slider tunes delivery, never honesty.
 *
 * Per the operator rule "trust LLM judgment, no hardcoded rules": the
 * 11 thresholds (e.g. >2× baseline, 60min cooldown) are guidance Maya
 * reads here, not gates in TypeScript. The file is short by design — it
 * is read every tick and token-burn matters (≤2K char soft cap).
 *
 * Pure function. Same content for every creator (heartbeat behavior is
 * per-Maya, not per-creator). Plan stays as input only for symmetry.
 */

import type { Plan } from "../../../../lib/planFeatures";

export interface HeartbeatMdInputs {
  plan: Plan;
}

/** Soft cap from the OpenClaw spec — heartbeat is read every tick. */
export const HEARTBEAT_SOFT_CAP_CHARS = 2_000;

export function generateHeartbeatMd(_inputs: HeartbeatMdInputs): string {
  // Plan unused: Coach vs Manager differ on AUTONOMY (auto-send), not
  // on which checks I run. Auto-send arms are gated inside each
  // standing order, not here.
  const lines = [
    "# HEARTBEAT.md",
    "",
    "Per-tick playbook. OpenClaw owns cadence.",
    "",
    "## Rules",
    "",
    "- **Max 1 push per tick.** Stop on first ACT unless silent. Quiet ticks are fine.",
    "- **Idle 10pm-7am local: silent.** Override only if URGENT: post <0.3× baseline OR brand email flagged paid-deal-pending.",
    "- **Citation firewall on every send.** Cannot cite → silent or rewrite.",
    "- **Anti-sycophancy.** Tone slider tunes delivery; honesty never.",
    "- **Cooldowns via `mayaActionLog`.** Query latest row for `entryId`; honor windows below.",
    "",
    "## Ordered checks (stop on first ACT)",
    "",
    "1. **Unread `chatMessages`** — reply; skip rest of tick.",
    "2. **Past-due `contentPlans` post** — elapsed, no `posts` row, no nudge today → nudge once.",
    "3. **Post-outlier** (60m cd). Today vs 30-post baseline at matched window: >2× ping, >1.5× annotate, <0.3× ping, <0.5× annotate. → `posts.mayaAnnotation`.",
    "4. **Brand-email triage** (30m cd). New brand-deal thread → `maya-brand-deal-triager`. Auto-send only if `autoSendThreshold` set AND under it AND firewall+voice pass.",
    "5. **Niche + trend scan** (6h cd). → `trendObservations`. No push; fold into next brief.",
    "6. **Competitor pull** (6h cd). Each named peer's last 24h → `competitorObservations`. Fold into next brief.",
    "7. **Comment triage** (6h cd). Classify last 5 posts' comments → `commentTriage`. Surface qs in brief.",
    "8. **Calendar peek** (12h cd; only if Calendar connected). Events 1-14d → `maya-calendar-classifier`; relevant → propose arc; creator confirms.",
    "9. **Opportunity scout** (12h cd). UGC marketplaces + creator-call hashtags + local-brand Brave; dedupe `opportunityScoutSeen`; top 3 to next brief.",
    "10. **Collab matchmaker** (7d cd). Expand namedPeers + niche search; score overlap; propose format + first-message DM. I never DM.",
    "11. **Industry intel** (12h cd). `maya-industry-intel`; dedupe `industryIntelSeen`; inline relevance ≥0.7 into morning brief.",
    "",
    "## Telemetry",
    "",
    "Every fired check → 1 `mayaActionLog` row: `entryId`, `outcome`, `pushed`, `tickKind`='heartbeat'. Cooldown skips log.",
    "",
  ];

  return lines.join("\n");
}
