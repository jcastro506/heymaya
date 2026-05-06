import { Doc } from "../_generated/dataModel";

/**
 * Plan-tier feature matrix — REVISED 2026-05-04 (coach / manager migration).
 *
 * The creator product moved from a 3-tier (starter / pro / studio) shape to a
 * 2-tier (coach / manager) shape. The tier boundary is now AUTONOMY ON THE
 * CREATOR'S BEHALF, not breadth. Both tiers see every read/advisory behavior;
 * Coach is advisory-only and Manager is the same brain plus the autonomous
 * brand-deal back-and-forth.
 *
 *   - **Coach** ($19.99/mo / $199/yr) — advisory only. Maya NEVER auto-sends
 *     emails, NEVER pitches brands cold, NEVER reaches out via Apollo/Hunter.
 *     She still triages inbound brand emails into a draft for the creator and
 *     does every read/advisory cron behavior (morning brief, evening recap,
 *     weekly plan, niche scan, performance check, hook library, comment
 *     triage, calendar lookahead, manager-readiness packet, etc).
 *   - **Manager** ($49.99/mo / $499/yr) — everything in Coach + brand email
 *     auto-send under threshold + brand outreach (Apollo/Hunter discovery) +
 *     brand pitching (cold drafts) + brand-deal negotiation back-and-forth.
 *
 * 7-day free trial on BOTH tiers — first subscription only. Cancel after the
 * trial drops the creator to Coach via the cancel webhook handler (the
 * post-cancel floor).
 *
 * What did NOT survive the rewrite:
 *   - No more `maxThinkingBudget` per-tier clamp. Both tiers get full thinking
 *     budgets — the boundary is autonomy, not compute.
 *   - No more platform-count gating (`maxHandles`). Coach + Manager both reach
 *     all 5 platforms (TikTok / IG / YouTube / LinkedIn / X).
 *   - No more `proactiveCronAll = false` for the lower tier. Both tiers run
 *     the same proactive cron set; the difference is whether the brand-deal
 *     follow-ups in that cron set fire send actions on the creator's behalf
 *     or stop at draft.
 *   - No more `multiAccountSlots > 1`. Multi-account (manage multiple
 *     creators) is OFF for both tiers in v0.
 *
 * What remains as a cost lever:
 *   - `chatTurnsPerMonth` — bounds inference cost per user; Coach is capped,
 *     Manager unlimited (a separate ratchet from autonomy).
 *
 * The `canAutoSendBrandEmails` / `canDoBrandOutreach` / `canPitchBrands` flags
 * are the load-bearing gate signals callers should consult when checking
 * autonomy boundaries — they map 1:1 to product-locked autonomy semantics.
 *
 * Gate-helper semantics (`PlanGateError`, `requireFeature`, `providerAllowed`,
 * `channelAllowed`, `clampThinkingBudget`, `thinkingBudgetAllowed`) are
 * preserved verbatim so call sites compile unchanged. `clampThinkingBudget`
 * is a no-op on both tiers (both allow `high`); the helper is kept for
 * forward-compat if a future cost-lever wants to clamp again.
 */

export type Plan = "coach" | "manager";
export type ThinkingBudget = "none" | "low" | "medium" | "high";
export type Channel = "imessage" | "whatsapp" | "sms" | "telegram" | "web";
export type Provider =
  | "gmail"
  | "stripe"
  | "calendar"
  | "apollo"
  | "hunter"
  | "linkedin"
  | "twitter";

export interface PlanFeatures {
  plan: Plan;
  /** Max distinct social handles ScrapeCreators is asked to track per creator. */
  maxHandles: number;
  /** Channels Maya can route outbound to. UNGATED — all 5 on every tier. */
  allowedChannels: ReadonlyArray<Channel>;
  /** Hard cap on per-call thinking budget. Both tiers = 'high' in v0. */
  maxThinkingBudget: ThinkingBudget;
  allowedThinkingBudgets: ReadonlyArray<ThinkingBudget>;
  /** Conversational chat-turn cap. Coach capped, Manager unlimited. */
  chatTurnsPerMonth: number | "unlimited";
  /**
   * `true` = run the FULL proactive cron set; both tiers = true now (the old
   * "limited cron set" tier is gone). The actual job composition lives in
   * `buildCronJobsJson.ts`.
   */
  proactiveCronAll: boolean;
  /** Composio Gmail webhook → triage → 4-variant drafts. UNGATED. */
  gmailDealDeskEnabled: boolean;
  /** How many named-peer competitors Maya tracks. Bounded so cost scales. */
  competitorWatchSlots: number;
  /** Manager-readiness packet — none / quarterly cron / on-demand. */
  readinessPacketCadence: "none" | "quarterly" | "on-demand";
  /**
   * Coach: false. Manager: true. Maya may auto-send firm-decline / accept
   * variants under the per-account `autoSendThreshold` only on Manager.
   * Coach always stops at draft.
   */
  canAutoSendBrandEmails: boolean;
  /**
   * Coach: false. Manager: true. Apollo/Hunter discovery + cold pitch drafts
   * are Manager-only autonomy.
   */
  canDoBrandOutreach: boolean;
  /**
   * Coach: false. Manager: true. Maya drafts + sends cold pitches on Manager.
   * Coach can suggest brands for the creator to pitch but won't draft + send.
   */
  canPitchBrands: boolean;
  /**
   * Maya can compose brand pitch emails. Coach = false (advisory only),
   * Manager = true. Distinct from `canPitchBrands` only in name; we keep
   * both for back-compat with existing call sites that read this field.
   */
  brandOutreachEnabled: boolean;
  /**
   * Manager-only. Apollo/Hunter paid per-query lookups for brand contact
   * discovery. Coach never reaches out, so this is irrelevant to Coach.
   */
  brandContactDiscoveryEnabled: boolean;
  /** UNGATED. UGC-board + local brand search via Brave (read-only). */
  opportunityScoutEnabled: boolean;
  /** UNGATED. Monetization diversification milestone advisor (read-only). */
  monetizationAdvisorEnabled: boolean;
  /** UNGATED. Collab matchmaker proposes peer creators (read-only). */
  collabMatchEnabled: boolean;
  /**
   * Multi-account (manage multiple creators on one billing). v0: BOTH tiers
   * cap at 1. The product spec defers multi-account to a later release.
   */
  multiAccountSlots: number;
  /** Bounds proactive cron volume — same on both tiers in v0. */
  postPublishReactionLatencySec: number;
  /**
   * Composio providers the creator may OAuth-connect. Apollo + Hunter are
   * Manager-only because they're per-query paid lookups or public social
   * action channels; everyone gets gmail + calendar + stripe.
   */
  allowedProviders: ReadonlyArray<Provider>;
}

const ALL_CHANNELS: ReadonlyArray<Channel> = [
  "web",
  "sms",
  "imessage",
  "whatsapp",
  "telegram",
];

const COACH: PlanFeatures = {
  plan: "coach",
  // Same platform reach as Manager — boundary is autonomy, not breadth.
  maxHandles: 5,
  // UNGATED — channels are OpenClaw-native, no per-tier cost.
  allowedChannels: ALL_CHANNELS,
  // Both tiers get full thinking budgets — boundary is autonomy, not compute.
  maxThinkingBudget: "high",
  allowedThinkingBudgets: ["none", "low", "medium", "high"],
  // Coach is the entry tier — cap inbound chat to bound inference cost.
  chatTurnsPerMonth: 400,
  // Same proactive cron set as Manager — Coach runs every read/advisory job;
  // the difference is what those jobs DO at the autonomy edge (draft vs send).
  proactiveCronAll: true,
  // UNGATED — Coach DOES triage inbound brand emails (just doesn't auto-send).
  gmailDealDeskEnabled: true,
  // 5 named peers on Coach (vs 10 on Manager — manager = more aggressive
  // outbound posture, larger watch set is part of that).
  competitorWatchSlots: 5,
  // Quarterly cron-cadence packet on Coach. Manager gets it on-demand.
  readinessPacketCadence: "quarterly",
  // ─── Autonomy gates — the load-bearing tier boundary ─────────────────────
  canAutoSendBrandEmails: false,
  canDoBrandOutreach: false,
  canPitchBrands: false,
  // brandOutreachEnabled is kept as a back-compat alias of canPitchBrands.
  brandOutreachEnabled: false,
  brandContactDiscoveryEnabled: false,
  // ─── End autonomy gates ──────────────────────────────────────────────────
  opportunityScoutEnabled: true,
  monetizationAdvisorEnabled: true,
  collabMatchEnabled: true,
  multiAccountSlots: 1,
  postPublishReactionLatencySec: 600,
  // No apollo / hunter on Coach (no autonomous outreach).
  allowedProviders: ["gmail", "calendar", "stripe"],
};

const MANAGER: PlanFeatures = {
  plan: "manager",
  maxHandles: 5,
  allowedChannels: ALL_CHANNELS,
  maxThinkingBudget: "high",
  allowedThinkingBudgets: ["none", "low", "medium", "high"],
  chatTurnsPerMonth: "unlimited",
  proactiveCronAll: true,
  gmailDealDeskEnabled: true,
  competitorWatchSlots: 10,
  readinessPacketCadence: "on-demand",
  // ─── Autonomy gates — Manager is the autonomous tier ─────────────────────
  canAutoSendBrandEmails: true,
  canDoBrandOutreach: true,
  canPitchBrands: true,
  brandOutreachEnabled: true,
  brandContactDiscoveryEnabled: true,
  // ─── End autonomy gates ──────────────────────────────────────────────────
  opportunityScoutEnabled: true,
  monetizationAdvisorEnabled: true,
  collabMatchEnabled: true,
  multiAccountSlots: 1,
  postPublishReactionLatencySec: 300,
  allowedProviders: [
    "gmail",
    "calendar",
    "stripe",
    "apollo",
    "hunter",
    "linkedin",
    "twitter",
  ],
};

const FEATURES_BY_PLAN: Record<Plan, PlanFeatures> = {
  coach: COACH,
  manager: MANAGER,
};

/**
 * Sprint 9 — admin-flagged comp accounts.
 *
 * The operator can comp a creator (no Stripe subscription required) by
 * flipping `creators.compedByAdmin = true` via the `admin.compCreator`
 * mutation. A comp'd creator is treated as a Manager-tier subscriber:
 *
 *   - `planFeatures(creator)` returns Manager features regardless of the
 *     stored `plan` field (so we don't have to also patch `plan` to
 *     "manager" — the comp flag is the source of truth).
 *   - `subscriptionActive(creator)` short-circuits to `true` so any caller
 *     gating on "is the subscription active?" lets the comp'd creator
 *     through without a Stripe row.
 *
 * The flag exists so the operator can sign up friends without a Stripe
 * card. Tests must verify both: comp'd creator gets full Manager features,
 * un-comp'd creator still hits the paywall.
 *
 * IMPORTANT: only the COMP flag overrides the plan. We DO NOT default to
 * Manager features on missing data — corrupted/unknown `plan` still throws
 * via `PlanGateError`. The override is opt-in (operator-driven) only.
 */
export function planFeatures(
  creator: Pick<Doc<"creators">, "plan"> & {
    compedByAdmin?: boolean;
  }
): PlanFeatures {
  // Sprint 9: comp short-circuit. Operator-flagged comp creators get the
  // full Manager features regardless of stored plan. This is the load-
  // bearing gate the friend-cohort beta relies on.
  if (creator.compedByAdmin === true) {
    return MANAGER;
  }
  const f = FEATURES_BY_PLAN[creator.plan];
  if (!f) {
    // Adversarial / corrupted plan field — fail closed with a typed error so
    // callers can't accidentally fall through to "no gate" behavior.
    throw new PlanGateError(
      creator.plan as Plan,
      "planFeatures:unknown-plan",
      "coach"
    );
  }
  return f;
}

/**
 * Sprint 9 — `subscriptionActive(creator)` returns the operator-comp /
 * Stripe-subscription status as a single boolean. Sources of truth:
 *
 *   1. `creator.compedByAdmin === true` → active (operator-comped beta).
 *   2. `creator.stripeSubscriptionId` set AND `currentPlanPeriodEnd` is in
 *      the future (or unset, which means we're inside an open-ended
 *      subscription window) → active.
 *   3. Otherwise → inactive (creator hit the paywall, must subscribe).
 *
 * Callers that gate ANY feature on "must have an active subscription"
 * should call this helper rather than hand-rolling a check — the comp
 * short-circuit lives here so it can never be missed.
 */
export function subscriptionActive(
  creator: Pick<
    Doc<"creators">,
    "stripeSubscriptionId" | "currentPlanPeriodEnd"
  > & {
    compedByAdmin?: boolean;
  },
  nowMs: number = Date.now()
): boolean {
  // Sprint 9 comp short-circuit — first check, never bypassed.
  if (creator.compedByAdmin === true) return true;
  if (!creator.stripeSubscriptionId) return false;
  // If `currentPlanPeriodEnd` is unset, treat as still-active (Stripe webhook
  // hasn't landed the period boundary yet — defaulting to "blocked" would
  // strand creators mid-subscription on missing-data races).
  if (creator.currentPlanPeriodEnd === undefined) return true;
  return creator.currentPlanPeriodEnd > nowMs;
}

const BUDGET_RANK: Record<ThinkingBudget, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export function thinkingBudgetAllowed(
  creator: Pick<Doc<"creators">, "plan">,
  requested: ThinkingBudget
): boolean {
  const max = planFeatures(creator).maxThinkingBudget;
  return BUDGET_RANK[requested] <= BUDGET_RANK[max];
}

export function clampThinkingBudget(
  creator: Pick<Doc<"creators">, "plan">,
  requested: ThinkingBudget
): ThinkingBudget {
  const max = planFeatures(creator).maxThinkingBudget;
  return BUDGET_RANK[requested] <= BUDGET_RANK[max] ? requested : max;
}

export function channelAllowed(
  creator: Pick<Doc<"creators">, "plan">,
  channel: Channel
): boolean {
  return planFeatures(creator).allowedChannels.includes(channel);
}

export function providerAllowed(
  creator: Pick<Doc<"creators">, "plan">,
  provider: Provider
): boolean {
  return planFeatures(creator).allowedProviders.includes(provider);
}

export class PlanGateError extends Error {
  constructor(
    public plan: Plan,
    public attemptedFeature: string,
    public requiredPlan: Plan
  ) {
    super(
      `Plan '${plan}' cannot access '${attemptedFeature}'. Requires '${requiredPlan}' or higher.`
    );
    this.name = "PlanGateError";
  }
}

export function requireFeature(
  creator: Pick<Doc<"creators">, "plan">,
  predicate: (f: PlanFeatures) => boolean,
  attemptedFeature: string,
  requiredPlan: Plan
): void {
  if (!predicate(planFeatures(creator))) {
    throw new PlanGateError(creator.plan, attemptedFeature, requiredPlan);
  }
}
