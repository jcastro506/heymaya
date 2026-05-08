/**
 * Sprint 10 — brand-outreach daily/weekly cap enforcement.
 *
 * Operator-locked defaults (2026-05-08):
 *   - 5 cold outbound / day, scaling to 10/day after 30-day warm-up
 *   - 30 cold outbound / week (rolling 7d)
 *   - 7-day per-brand re-pitch cooldown
 *   - Warm follow-ups (creator already has a thread with the brand) do
 *     NOT count against the cold cap
 *   - Assistant tier: 0 sends, drafts only (enforced upstream by
 *     `planFeatures(creator).canAutoSendBrandEmails`)
 *
 * This file is pure-function only. No DB access. The caller passes in
 * the relevant pitchOutreach rows (already filtered by creator) and the
 * helper computes whether a NEW cold send would clear the caps.
 */
import type { Doc, Id } from "../_generated/dataModel";

// Sprint 10 — narrow row shape the cap helper needs. Defined inline
// (not via Pick<Doc<>>) so the helper compiles even when the schema
// fields it references are added in the same change.
export interface PitchOutreachRow {
  _id: Id<"pitchOutreach">;
  creatorId: Doc<"pitchOutreach">["creatorId"];
  brand: string;
  sentAt?: number;
  coldOrWarm?: "cold" | "warm";
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

export const COLD_DAILY_CAP_WARMUP = 5;
export const COLD_DAILY_CAP_STEADY = 10;
export const COLD_WEEKLY_CAP = 30;
export const PER_BRAND_COOLDOWN_DAYS = 7;
export const WARMUP_PERIOD_DAYS = 30;

export interface CapDecisionInput {
  creatorActivatedAt: number; // creators._creationTime or first send
  rows: ReadonlyArray<PitchOutreachRow>;
  candidateBrand: string;
  now: number;
}

export type CapDecision =
  | { allow: true; remaining: { today: number; week: number }; capInUse: number }
  | {
      allow: false;
      reason: "daily_cap" | "weekly_cap" | "brand_cooldown" | "tier_blocked";
      remaining: { today: number; week: number };
      capInUse: number;
      cooldownExpiresAt?: number;
    };

/**
 * Returns whether a new COLD outbound to `candidateBrand` is allowed
 * right now, plus how much headroom is left in the day/week buckets.
 *
 * The daily cap scales: first 30d after creator activation = 5/day,
 * after that = 10/day.
 *
 * Per-brand cooldown: if any prior send (cold or warm) to this brand
 * went out within the last 7 days, this returns "brand_cooldown".
 */
export function canSendColdOutreach(input: CapDecisionInput): CapDecision {
  const { creatorActivatedAt, rows, candidateBrand, now } = input;

  // Daily cap = 5 during warm-up window, 10 after.
  const inWarmup =
    now - creatorActivatedAt < WARMUP_PERIOD_DAYS * ONE_DAY_MS;
  const dailyCap = inWarmup ? COLD_DAILY_CAP_WARMUP : COLD_DAILY_CAP_STEADY;

  const dayCutoff = now - ONE_DAY_MS;
  const weekCutoff = now - ONE_WEEK_MS;
  const brandCutoff = now - PER_BRAND_COOLDOWN_DAYS * ONE_DAY_MS;
  const candidateBrandKey = normalizeBrand(candidateBrand);

  let coldToday = 0;
  let coldThisWeek = 0;
  let lastTouchToBrand: number | null = null;

  for (const row of rows) {
    const sentAt = row.sentAt;
    if (sentAt == null) continue;

    if (
      row.coldOrWarm === "cold" &&
      sentAt >= dayCutoff
    ) {
      coldToday += 1;
    }
    if (
      row.coldOrWarm === "cold" &&
      sentAt >= weekCutoff
    ) {
      coldThisWeek += 1;
    }
    // Per-brand cooldown applies regardless of cold/warm — touching the
    // same brand twice in 7d is what we're avoiding.
    if (normalizeBrand(row.brand) === candidateBrandKey && sentAt >= brandCutoff) {
      lastTouchToBrand = Math.max(lastTouchToBrand ?? 0, sentAt);
    }
  }

  const remaining = {
    today: Math.max(0, dailyCap - coldToday),
    week: Math.max(0, COLD_WEEKLY_CAP - coldThisWeek),
  };
  const capInUse = dailyCap;

  if (lastTouchToBrand != null) {
    return {
      allow: false,
      reason: "brand_cooldown",
      remaining,
      capInUse,
      cooldownExpiresAt: lastTouchToBrand + PER_BRAND_COOLDOWN_DAYS * ONE_DAY_MS,
    };
  }
  if (remaining.today === 0) {
    return { allow: false, reason: "daily_cap", remaining, capInUse };
  }
  if (remaining.week === 0) {
    return { allow: false, reason: "weekly_cap", remaining, capInUse };
  }
  return { allow: true, remaining, capInUse };
}

/**
 * Returns the quota line Maya should verbalize to the creator.
 * Format: "I'd send 3 more today (5/day cap, 12 left this week) — push or pause?"
 * Operator-tested phrasing.
 */
export function quotaLineForCreator(decision: CapDecision): string {
  if (decision.allow) {
    return `I'd send ${decision.remaining.today} more today (${decision.capInUse}/day cap, ${decision.remaining.week} left this week)`;
  }
  switch (decision.reason) {
    case "daily_cap":
      return `Hit today's outreach cap (${decision.capInUse}/day). Picking back up tomorrow — ${decision.remaining.week} left in the weekly bucket.`;
    case "weekly_cap":
      return `Hit this week's outreach cap (30/week rolling). Resumes once the week rolls over.`;
    case "brand_cooldown": {
      const days = decision.cooldownExpiresAt
        ? Math.ceil((decision.cooldownExpiresAt - Date.now()) / ONE_DAY_MS)
        : 7;
      return `Pitched this brand recently — sitting on it for ${days} more day${days === 1 ? "" : "s"} so we don't read as spam.`;
    }
    case "tier_blocked":
      return `On Assistant tier, I draft outreach but you send. Manager tier lets me send under your cap.`;
  }
}

function normalizeBrand(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
