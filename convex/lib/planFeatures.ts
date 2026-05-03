import { Doc } from "../_generated/dataModel";

/**
 * Plan-tier feature matrix — REVISED 2026-04-26.
 *
 * Tier philosophy:
 *   1. Channels (iMessage / WhatsApp / SMS / web) are OpenClaw-NATIVE. They
 *      cost us nothing per creator (the org configures them once, OpenClaw
 *      handles routing). Therefore: **every tier gets every channel.** No
 *      paywall on where Maya pings the creator.
 *   2. Composio Gmail is per-call cost, but small, and the brand-triage value
 *      is the headline reason creators sign up. Therefore: **every tier gets
 *      the Gmail deal desk** (`gmailDealDeskEnabled = true` for all).
 *   3. Apollo / Hunter ARE per-query paid lookups (real $$ per call). They
 *      only matter for outbound brand-contact DISCOVERY (finding emails for
 *      brands the creator doesn't already have a contact at). Therefore:
 *      **brandContactDiscoveryEnabled = Studio only**. Outbound pitching
 *      itself (`brandOutreachEnabled`) is universal — Maya can pitch from any
 *      tier; the difference is just whether she can DISCOVER contacts via
 *      paid lookups vs work from creator-supplied / opportunity-scout-surfaced
 *      addresses.
 *   4. Differentiation moves to where ACTUAL scaling cost lives:
 *        - `chatTurnsPerMonth`            — bounds inference cost per user
 *        - `maxThinkingBudget`            — bounds per-call cost (Starter "low")
 *        - `multiAccountSlots`            — bounds Fly + storage cost
 *        - `maxHandles`                   — bounds ScrapeCreators cost / creator
 *        - `postPublishReactionLatencySec` — bounds proactive cron volume
 *        - `allowedProviders` (apollo, hunter) — Studio-only paid lookups
 *        - `brandContactDiscoveryEnabled` — Studio-only paid lookups
 *
 * Note on `proactiveCronAll`: `false` for Starter does NOT mean "no cron."
 * It means "limited cron set." The actual cron-set definition lives in
 * `convex/agents/packs/maya/workspace/buildCronJobsJson.ts` and gets wired
 * per-tier when assembling the OpenClaw `jobs.json`. For Starter the limited
 * set is roughly: morning brief (7am), evening recap (7pm), weekly review
 * (Sun 9pm), post-publish reaction (at the slower 1800s latency — see
 * `postPublishReactionLatencySec`), and the daily niche scan. Pro/Studio get
 * the full set including the 2h performance check, brand email triage,
 * competitor watch, accountability nudge, hook library auto-build, comment
 * triage, weekly content plan, manager-readiness packet, contract red-flag
 * scan, revenue snapshot.
 */

export type Plan = "starter" | "pro" | "studio";
export type ThinkingBudget = "none" | "low" | "medium" | "high";
export type Channel = "imessage" | "whatsapp" | "sms" | "web";
export type Provider = "gmail" | "stripe" | "calendar" | "apollo" | "hunter";

export interface PlanFeatures {
  plan: Plan;
  /** Max distinct social handles ScrapeCreators is asked to track per creator. */
  maxHandles: number;
  /** Channels Maya can route outbound to. UNGATED — all 4 on every tier. */
  allowedChannels: ReadonlyArray<Channel>;
  /** Hard cap on per-call thinking budget. Starter clamped to 'low' for cost. */
  maxThinkingBudget: ThinkingBudget;
  allowedThinkingBudgets: ReadonlyArray<ThinkingBudget>;
  /** Conversational chat-turn cap. Starter capped, Pro/Studio unlimited. */
  chatTurnsPerMonth: number | "unlimited";
  /**
   * `true` = run the FULL proactive cron set; `false` = limited cron set
   * (morning brief, evening recap, weekly review, slower post-publish
   * reaction, daily niche scan). The actual job composition lives in
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
   * UNGATED. Maya can compose + send brand pitch emails via Gmail at every
   * tier (she pitches stage-appropriately — small/local for early creators).
   * Subject to the per-account auto-send threshold.
   */
  brandOutreachEnabled: boolean;
  /**
   * Studio-only. Maya uses Apollo/Hunter (paid per-query lookups) to discover
   * brand contacts before pitching. Pro/Starter still pitch — to creator-
   * supplied addresses or addresses surfaced by the opportunity scout.
   */
  brandContactDiscoveryEnabled: boolean;
  /** UNGATED. UGC-board + local brand search via Brave. */
  opportunityScoutEnabled: boolean;
  /** UNGATED. Monetization diversification milestone advisor. */
  monetizationAdvisorEnabled: boolean;
  /** UNGATED. Collab matchmaker proposes peer creators for collabs. */
  collabMatchEnabled: boolean;
  /** Distinct creator personas / accounts on one billing relationship. */
  multiAccountSlots: number;
  /** Bounds proactive cron volume — tighter latency = more cost. */
  postPublishReactionLatencySec: number;
  /**
   * Composio providers the creator may OAuth-connect. Apollo + Hunter are
   * Studio-only because they're per-query paid lookups; everyone gets gmail
   * + calendar + stripe.
   */
  allowedProviders: ReadonlyArray<Provider>;
}

const ALL_CHANNELS: ReadonlyArray<Channel> = [
  "web",
  "sms",
  "imessage",
  "whatsapp",
];

const STARTER: PlanFeatures = {
  plan: "starter",
  maxHandles: 1,
  // UNGATED — channels are OpenClaw-native, no per-tier cost.
  allowedChannels: ALL_CHANNELS,
  // Cost lever STAYS — Starter clamped to 'low' to bound per-call cost.
  maxThinkingBudget: "low",
  allowedThinkingBudgets: ["none", "low"],
  // Cost lever STAYS — Starter capped at 200 chat turns / month.
  chatTurnsPerMonth: 200,
  // Limited cron set (morning/evening/weekly + slower post-publish reaction +
  // daily niche scan). NOT "no cron" — see the file header for the full list.
  proactiveCronAll: false,
  // UNGATED — Gmail deal desk is the headline value prop.
  gmailDealDeskEnabled: true,
  // Small slot count, not zero. Maya watches 2 named peers on Starter.
  competitorWatchSlots: 2,
  readinessPacketCadence: "none",
  // UNGATED — Maya pitches from any tier. Stage-appropriately.
  brandOutreachEnabled: true,
  // Studio only — paid per-query Apollo/Hunter lookups.
  brandContactDiscoveryEnabled: false,
  opportunityScoutEnabled: true,
  monetizationAdvisorEnabled: true,
  collabMatchEnabled: true,
  // Cost lever STAYS — single account on Starter/Pro.
  multiAccountSlots: 1,
  // Cost lever STAYS — slower latency on Starter to bound proactive volume.
  postPublishReactionLatencySec: 1800,
  // No apollo / hunter on Starter (paid per-query). gmail + calendar + stripe.
  allowedProviders: ["gmail", "calendar", "stripe"],
};

const PRO: PlanFeatures = {
  plan: "pro",
  maxHandles: 3,
  allowedChannels: ALL_CHANNELS,
  maxThinkingBudget: "high",
  allowedThinkingBudgets: ["none", "low", "medium", "high"],
  chatTurnsPerMonth: "unlimited",
  proactiveCronAll: true,
  gmailDealDeskEnabled: true,
  competitorWatchSlots: 5,
  readinessPacketCadence: "quarterly",
  brandOutreachEnabled: true,
  // Pro can pitch — but Apollo/Hunter discovery is Studio-only.
  brandContactDiscoveryEnabled: false,
  opportunityScoutEnabled: true,
  monetizationAdvisorEnabled: true,
  collabMatchEnabled: true,
  multiAccountSlots: 1,
  postPublishReactionLatencySec: 600,
  allowedProviders: ["gmail", "calendar", "stripe"],
};

const STUDIO: PlanFeatures = {
  plan: "studio",
  maxHandles: 5,
  allowedChannels: ALL_CHANNELS,
  maxThinkingBudget: "high",
  allowedThinkingBudgets: ["none", "low", "medium", "high"],
  chatTurnsPerMonth: "unlimited",
  proactiveCronAll: true,
  gmailDealDeskEnabled: true,
  competitorWatchSlots: 10,
  readinessPacketCadence: "on-demand",
  brandOutreachEnabled: true,
  // Studio only — the real cost lever: paid per-query Apollo + Hunter lookups.
  brandContactDiscoveryEnabled: true,
  opportunityScoutEnabled: true,
  monetizationAdvisorEnabled: true,
  collabMatchEnabled: true,
  multiAccountSlots: 3,
  postPublishReactionLatencySec: 300,
  allowedProviders: ["gmail", "calendar", "stripe", "apollo", "hunter"],
};

const FEATURES_BY_PLAN: Record<Plan, PlanFeatures> = {
  starter: STARTER,
  pro: PRO,
  studio: STUDIO,
};

export function planFeatures(creator: Pick<Doc<"creators">, "plan">): PlanFeatures {
  const f = FEATURES_BY_PLAN[creator.plan];
  if (!f) {
    // Adversarial / corrupted plan field — fail closed with a typed error so
    // callers can't accidentally fall through to "no gate" behavior.
    throw new PlanGateError(
      creator.plan as Plan,
      "planFeatures:unknown-plan",
      "starter"
    );
  }
  return f;
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
