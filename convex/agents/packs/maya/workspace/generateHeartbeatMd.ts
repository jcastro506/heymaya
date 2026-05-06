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
 *
 * Sprint 9 — added `pickHeartbeatChecksForTime` for the idle-aware push
 * window. Maya is allowed to run her tick at any cadence (the OpenClaw
 * heartbeat ticks every minute) but PUSHES — outbound messages to the
 * creator's primary channel — are suppressed inside the idle window
 * (10pm-7am local). The exception is URGENT signals that warrant waking
 * the creator. The decision lives in this module so it can be unit-tested
 * deterministically across timezones.
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
  // Sprint 8.5 — wiki mirror sync. Folded into heartbeat, cooldown 6h.
  // Silent no-op when nothing new in the wiki.
  items.push(
    "If 6h+ since last `wiki_mirror_sync`, scan the memory-wiki for new trend / competitor / weekly-learning entries; batch deltas into one POST to `lc_maya/sync_wiki_observations` (idempotent on `(creatorId, wikiVaultPath)`). Silent no-op if wiki unchanged."
  );
  // Sprint 9 — idle-aware push window reminder.
  items.push(
    "Idle window enforcement: between 10:00pm and 7:00am LOCAL time, NEVER push a non-URGENT outbound message. Read-only checks still run; outbound pings defer to the next morning brief unless the trigger is URGENT (post crashed >50% baseline, OAuth revoked mid-deal, contract red-flag escalation). When in doubt about urgency, defer."
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
