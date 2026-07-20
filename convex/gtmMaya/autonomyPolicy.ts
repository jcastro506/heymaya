/**
 * W2 — autonomous-vs-confirm posting policy (pure logic).
 *
 * The founder chooses how much rope Maya gets on the AUTO channels
 * (X / LinkedIn / Instagram / YouTube). This is layered strictly INSIDE two
 * harder gates that this module never touches:
 *   - the ban-safety floor (Reddit + TikTok are ALWAYS confirm — MANUAL_CONFIRM_CHANNELS)
 *   - the plan-tier ceiling (planFeaturesGtm.canAutoPost)
 * The toggle can only ever TIGHTEN (require more confirmation), never loosen.
 *
 * Default is a trust ramp: confirm for the first week / few posts, then auto.
 * Fail-closed: an unknown / unset policy is treated as "confirm" (NOT auto), so
 * a missing field can never silently grant autonomy.
 */

export type AutonomousPosting =
  | "confirm_each"
  | "confirm_first_week"
  | "autonomous";

export const DEFAULT_AUTONOMOUS_POSTING: AutonomousPosting = "confirm_first_week";

/** Ramp graduation thresholds (operator-locked): 3 confirmed posts OR 7 days. */
export const RAMP_POST_THRESHOLD = 3;
export const RAMP_DAYS = 7;
const RAMP_MS = RAMP_DAYS * 24 * 60 * 60 * 1000;

/**
 * Has a `confirm_first_week` agent reached the ramp milestone (the founder has
 * confirmed RAMP_POST_THRESHOLD posts OR RAMP_DAYS have elapsed)? Since
 * 2026-07-20 this is the READY-TO-ASK signal, NOT a silent grant: Maya offers
 * ("you've been approving my stuff — want me to stop checking every time?")
 * and only the founder's yes (set_posting_mode 'autonomous') flips the mode.
 * A silent behavior change was a trust landmine — posts appearing that the
 * founder never approved — and contradicted the SOUL's own offer-first script.
 */
export function isRampGraduated(
  autonomousSince: number | undefined | null,
  confirmedPostCount: number | undefined | null,
  nowMs: number
): boolean {
  if ((confirmedPostCount ?? 0) >= RAMP_POST_THRESHOLD) return true;
  if (autonomousSince != null && nowMs - autonomousSince >= RAMP_MS) return true;
  return false;
}

/**
 * Has the founder granted Maya autonomy to auto-post the AUTO channels?
 * Ban-safety + plan ceiling are enforced by the publish engine separately —
 * this answers only the founder-preference question.
 *
 * ONLY an explicit 'autonomous' mode grants — set by the founder's own words
 * ("just post from now on") via set_posting_mode, or the Account toggle. The
 * ramp milestone triggers Maya's OFFER (see isRampGraduated), never the grant.
 *
 * Fail-closed: everything else → false (confirm).
 */
export function autonomyGranted(
  policy: string | undefined | null,
  _autonomousSince: number | undefined | null,
  _confirmedPostCount: number | undefined | null,
  _nowMs: number
): boolean {
  return policy === "autonomous";
}

/**
 * Resolve a channel's effective publish mode after layering the founder's
 * autonomy preference onto its base (ban-safety) mode. The ONE place the
 * toggle meets the floor:
 *   - founderConfirmed (the human one-tap) → always auto. Wins everything.
 *   - an otherwise-auto channel with autonomy NOT granted → tightened to confirm.
 *   - a manual_confirm (ban-safety) channel → stays confirm. Never loosened.
 * Pure so the plan×toggle×ban-safety matrix is unit-testable. The plan ceiling
 * (canAutoPost) is applied AFTER this, by composeAutoPostAction.
 */
export function resolvePublishMode(
  baseChannelMode: "auto" | "manual_confirm",
  founderConfirmed: boolean,
  autonomyIsGranted: boolean
): "auto" | "manual_confirm" {
  if (founderConfirmed) return "auto";
  if (baseChannelMode === "auto" && !autonomyIsGranted) return "manual_confirm";
  return baseChannelMode;
}

/**
 * Should Maya proactively offer to graduate (the "you can let me just post from
 * now on" nudge)? Only for a `confirm_first_week` agent that has met the ramp
 * but hasn't yet been flipped to `autonomous`.
 */
export function shouldOfferGraduation(
  policy: string | undefined | null,
  autonomousSince: number | undefined | null,
  confirmedPostCount: number | undefined | null,
  nowMs: number
): boolean {
  return (
    policy === "confirm_first_week" &&
    isRampGraduated(autonomousSince, confirmedPostCount, nowMs)
  );
}
