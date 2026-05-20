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
 * 12 thresholds (e.g. >2× baseline, 60min cooldown) are guidance Maya
 * reads here, not gates in TypeScript. The file is short by design — it
 * is read every tick and token-burn matters (≤2K char soft cap).
 *
 * Pure function. Same content for every creator (heartbeat behavior is
 * per-Maya, not per-creator). Plan stays as input only for symmetry.
 *
 * Sprint 9 — added `pickHeartbeatChecksForTime` for the idle-aware push
 * window. Maya is allowed to run her tick at any cadence (the OpenClaw
 * heartbeat ticks every minute) but PUSHES — outbound messages to the
 * creator's primary channel — are suppressed inside the idle window
 * (10pm-7am local). The exception is URGENT signals that warrant waking
 * the creator. The decision lives in this module so it can be unit-tested
 * deterministically across timezones. Sprint 9 also folds wiki_mirror_sync
 * in as a 12th low-priority no-op — it batches new wiki entries to the
 * mirror endpoint when the wiki has changed and is silent otherwise.
 */

import type { Plan } from "../../../../lib/planFeatures";

export interface HeartbeatMdInputs {
  plan: Plan;
}

/**
 * Soft cap from the OpenClaw spec — heartbeat is read every tick.
 *
 * Sprint C.4 (2026-05-13) — landed at 2_400. The calendar-scan check
 * briefly lived in HEARTBEAT.md in C.3 (cap 3_000) with a ±5min window
 * around T-30min, but every-minute LLM invocation × 1440 ticks/day was
 * unsustainable for unit economics (~$14-56/creator/month with caching).
 * Moved to cron-driven `midday_calendar_check` (11am local) +
 * `afternoon_calendar_check` (3pm local); combined with existing
 * morning_brief (8:30am) + evening_recap (6pm) that's 4 calendar-aware
 * ticks/day at ~$0.02/day per creator. The remaining +400 char delta
 * vs the original 2_000 covers the cross-reference paragraph that tells
 * Maya where the calendar surface lives now — load-bearing pointer so
 * she doesn't go looking for a heartbeat check that no longer exists.
 */
export const HEARTBEAT_SOFT_CAP_CHARS = 2_400;

export function generateHeartbeatMd(_inputs: HeartbeatMdInputs): string {
  // Plan unused: Coach vs Manager differ on AUTONOMY (auto-send), not
  // on which checks I run. Auto-send arms are gated inside each
  // standing order, not here.
  const lines = [
    "# HEARTBEAT.md",
    "",
    "What I check each tick. OpenClaw owns the clock.",
    "",
    "## Tick rules",
    "",
    "- **Max 1 push per tick.** Stop on first ACT unless silent. Quiet ticks are fine.",
    "- **10pm-7am local: no push.** Override only if URGENT: post <0.3× baseline OR brand email flagged paid-deal-pending.",
    "- **Citation firewall on every send.** Cannot cite → silent or rewrite.",
    "- **Anti-sycophancy.** Tone tunes delivery; never honesty.",
    "- **Cooldowns via `mayaActionLog`.** Latest row for `entryId`; honor windows below.",
    "",
    "## Ordered checks (stop on first ACT)",
    "",
    "1. **Unread `chatMessages`** — reply; skip rest of tick.",
    "2. **Past-due `contentPlans` post** — elapsed, no `posts` row, no nudge today → nudge once.",
    "3. **Post-outlier** (60m cd). vs 30-post baseline at matched window: >2× ping, >1.5× annotate, <0.3× ping, <0.5× annotate → `posts.mayaAnnotation`.",
    "4. **Brand-email triage** (30m cd). New thread → `maya-brand-deal-triager`. Auto-send only if `autoSendThreshold` set, under it, firewall+voice pass.",
    "5. **Niche + trend scan** (6h cd). → `trendObservations`. No push; folds into brief.",
    "6. **Competitor pull** (6h cd). Each named peer's 24h → `competitorObservations`. Folds into brief.",
    "7. **Comment triage** (6h cd). Last 5 posts → `commentTriage`. Surfaces qs in brief.",
    "8. **Calendar peek** (12h cd; if connected). 1-14d → `maya-calendar-classifier`; relevant → propose arc.",
    "9. **Opportunity scout** (12h cd). UGC marketplaces + creator-call hashtags + local Brave; dedupe `opportunityScoutSeen`; top 3 → brief.",
    "10. **Collab matchmaker** (7d cd). namedPeers + niche; score overlap; propose format + first-DM. I never DM.",
    "11. **Industry intel** (12h cd). `maya-industry-intel`; dedupe `industryIntelSeen`; inline ≥0.7 into brief.",
    "12. **Wiki mirror sync** (6h cd). Batch new wiki entries → POST `lc_maya/sync_wiki_observations` (idem on `(creatorId, wikiVaultPath)`). Silent.",
    "",
    "## Calendar nudges (cron, not heartbeat)",
    "",
    "`mayaCalendarEvents` pre/post nudges live on 4 calendar-aware ticks per day: `morning_brief` 8:30am + `midday_calendar_check` 11am + `afternoon_calendar_check` 3pm + `evening_recap` 6pm. Native Google Calendar `reminders.overrides` (set by `maya-calendar-planner`) covers the T-30min device popup.",
    "",
    "## Telemetry",
    "",
    "Every fired check → 1 `mayaActionLog` row: `entryId`, `outcome`, `pushed`, `tickKind`='heartbeat'. Cooldown skips don't log.",
    "",
  ];

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Sprint 9 — idle-aware push decision                                         */
/* -------------------------------------------------------------------------- */

/**
 * Heartbeat-tick check identifiers. These are stable handles the tick
 * decision function returns; the heartbeat runtime reads them and runs the
 * matching code paths. Keep aligned with the bullets above (one identifier
 * per check the runtime can short-circuit on).
 */
export type HeartbeatCheck =
  | "morning_brief_followup"
  | "scheduled_post_check"
  | "outlier_scan"
  | "unread_chat_priority"
  | "evening_recap_seed"
  | "brand_email_triage"
  | "competitor_skim"
  | "wiki_mirror_sync";

/** Push-allowed checks — these can result in an outbound message. */
const PUSH_CAPABLE_CHECKS: ReadonlySet<HeartbeatCheck> = new Set<HeartbeatCheck>([
  "morning_brief_followup",
  "outlier_scan",
  "unread_chat_priority",
  "brand_email_triage",
]);

/** Read-only checks — never push (always safe to run during idle hours). */
const READ_ONLY_CHECKS: ReadonlySet<HeartbeatCheck> = new Set<HeartbeatCheck>([
  "scheduled_post_check",
  "evening_recap_seed",
  "competitor_skim",
  "wiki_mirror_sync",
]);

/** All checks in canonical order — matches the bullets in HEARTBEAT.md. */
export const ALL_HEARTBEAT_CHECKS: ReadonlyArray<HeartbeatCheck> = [
  "morning_brief_followup",
  "scheduled_post_check",
  "outlier_scan",
  "unread_chat_priority",
  "evening_recap_seed",
  "brand_email_triage",
  "competitor_skim",
  "wiki_mirror_sync",
];

/**
 * Idle window: 22:00 (inclusive) → 07:00 (exclusive) LOCAL. Push-capable
 * checks are suppressed unless an URGENT context overrides. Read-only
 * checks always run.
 */
export const IDLE_WINDOW_START_HOUR = 22;
export const IDLE_WINDOW_END_HOUR = 7;

export interface HeartbeatTickContext {
  /**
   * Latest 2h-perf-check ratio observed for the creator's most recent post.
   * Values < 0.5 (post is at <50% baseline) qualify as URGENT and unlock
   * push during the idle window. Undefined / ≥ 0.5 → not urgent.
   */
  latestPostMetric?: { ratio: number };
  /**
   * Brand-deal red-flag escalation flag. True when the deal triager hit a
   * contract red-flag that needs creator eyes today. Unlocks idle push.
   */
  brandDealRedFlag?: boolean;
  /**
   * OAuth revoked mid-deal — the creator needs to reconnect or a deal
   * thread will die. Unlocks idle push.
   */
  oauthRevokedMidDeal?: boolean;
}

export interface HeartbeatTickDecision {
  /** Checks the runtime should EXECUTE this tick. */
  checksToRun: ReadonlyArray<HeartbeatCheck>;
  /** Whether outbound pushes are allowed this tick. */
  pushAllowed: boolean;
  /** Whether the current local time is in the idle window. */
  isIdleHour: boolean;
  /** Whether an URGENT context override unlocked the push. */
  urgentOverride: boolean;
  /** Local hour used for the decision (0-23). */
  localHour: number;
}

/**
 * Returns the local hour (0-23) for a given UTC ms instant in the
 * specified IANA timezone. Uses Intl.DateTimeFormat under the hood — this
 * is the only timezone primitive Convex's runtime exposes that handles DST
 * correctly without bundling a tz library.
 *
 * Exposed for tests so they can verify hour resolution at known instants
 * without re-implementing the math.
 */
export function localHourInTimezone(
  utcMs: number,
  timezone: string
): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  // `formatToParts` returns the hour as a string. In some en-US 24h
  // outputs the value is "24" at midnight — normalize back to 0.
  const parts = fmt.formatToParts(new Date(utcMs));
  const hourPart = parts.find((p) => p.type === "hour");
  if (!hourPart) {
    throw new Error(
      `localHourInTimezone: failed to extract hour for tz=${timezone}.`
    );
  }
  const h = parseInt(hourPart.value, 10);
  if (!Number.isFinite(h) || h < 0 || h > 24) {
    throw new Error(
      `localHourInTimezone: parsed hour ${h} out of range for tz=${timezone}.`
    );
  }
  return h === 24 ? 0 : h;
}

/** Returns true if `localHour` falls inside the idle window
 *  [IDLE_WINDOW_START_HOUR, IDLE_WINDOW_END_HOUR). The window wraps
 *  midnight (22, 23, 0, 1, 2, 3, 4, 5, 6 are all idle). */
export function isLocalHourIdle(localHour: number): boolean {
  return (
    localHour >= IDLE_WINDOW_START_HOUR || localHour < IDLE_WINDOW_END_HOUR
  );
}

/**
 * Decides which heartbeat checks should run at `nowMs` for a creator in
 * `timezone`, given the optional URGENT context flags.
 *
 * Behavior:
 *   - Inside idle window AND no URGENT override → only READ_ONLY_CHECKS run;
 *     `pushAllowed: false`. The push-capable checks are skipped this tick
 *     (they'll fire on the next non-idle tick).
 *   - Inside idle window AND URGENT override (post crashed > 50% baseline,
 *     brand-deal red flag, OAuth revoked mid-deal) → ALL checks run;
 *     `pushAllowed: true`, `urgentOverride: true`.
 *   - Outside idle window → ALL checks run; `pushAllowed: true`.
 *
 * Pure function. Tests assert the contract at 11pm / 3am / 6:30am / 7am
 * local for a fixture creator + URGENT-on / URGENT-off.
 */
export function pickHeartbeatChecksForTime(
  creator: { timezone: string },
  nowMs: number,
  context: HeartbeatTickContext = {}
): HeartbeatTickDecision {
  const localHour = localHourInTimezone(nowMs, creator.timezone);
  const isIdleHour = isLocalHourIdle(localHour);

  const urgentOverride = isUrgent(context);

  if (isIdleHour && !urgentOverride) {
    return {
      checksToRun: ALL_HEARTBEAT_CHECKS.filter((c) =>
        READ_ONLY_CHECKS.has(c)
      ),
      pushAllowed: false,
      isIdleHour,
      urgentOverride: false,
      localHour,
    };
  }

  return {
    checksToRun: ALL_HEARTBEAT_CHECKS,
    pushAllowed: true,
    isIdleHour,
    urgentOverride: isIdleHour && urgentOverride,
    localHour,
  };
}

function isUrgent(ctx: HeartbeatTickContext): boolean {
  if (
    ctx.latestPostMetric &&
    Number.isFinite(ctx.latestPostMetric.ratio) &&
    ctx.latestPostMetric.ratio < 0.5
  ) {
    return true;
  }
  if (ctx.brandDealRedFlag === true) return true;
  if (ctx.oauthRevokedMidDeal === true) return true;
  return false;
}

// Exported for tests.
export const _internal = {
  PUSH_CAPABLE_CHECKS,
  READ_ONLY_CHECKS,
};
