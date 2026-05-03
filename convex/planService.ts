/**
 * Service-product plan-tier feature matrix.
 *
 * Mirrors `convex/lib/planFeatures.ts` (creator side) but is a SEPARATE matrix
 * because the service product's headline pricing + voice metering + multi-
 * location story diverge sharply from the creator product.
 *
 * Source of truth: `docs/SPRINT_PLAN_SERVICE_V0.md`
 *   § 3   — pricing tiers + voice economics (Starter $99 / Pro $149 / Studio $199)
 *   § 6   — behaviors + plan-tier columns (per-behavior gating)
 *   § 8   — schema additions, including the `approvalRules` table
 *   § 10.5 — content rejuvenation surface (Pro+ rejuvenator suggestions)
 *   § 12.5.7 — Maya video editing (Studio-only)
 *
 * Fail-closed contract:
 *   - `planFeaturesService(business)` accepts a `Pick<Doc<"businesses">,
 *     "planTier">` shape. Unknown / undefined / corrupted `planTier` values
 *     fall through to the STARTER matrix (the most-restrictive valid plan)
 *     so a corrupt row can never accidentally unlock a paid feature.
 *   - `requireFeatureService(...)` THROWS a `PlanGateError` so callers can't
 *     silently fall through to "no gate" behavior.
 *
 * The intentional asymmetry vs creator side:
 *   - Service tiers gate `voice` (Studio-only) — creator side has no voice.
 *   - Service tiers gate `crmIntegration` (Pro+) — creator side has no CRM.
 *   - Service tiers gate `serviceTitanIntegration` (Studio-only) — creator
 *     side has no equivalent.
 *   - Service tiers expose `approvalRulesEnableable` — creator side has no
 *     approval-rules concept.
 *
 * Cross-product separation rationale: keeping the two matrices isolated means
 * a creator-side rev-share / pricing change can't accidentally widen
 * service-side gates and vice versa. The two products share infra (Convex,
 * Clerk, Stripe) but not plan logic.
 */

import { Doc } from "./_generated/dataModel";

export type ServicePlan = "starter" | "pro" | "studio";

/**
 * The four `approvalRules.ruleType` values from § 8 + § 13 Sprint 5. The
 * `review-reply-auto-publish-allowlist` value EXISTS at the schema level but
 * is FORBIDDEN at every plan tier — Google `ReviewReplyState` moderation
 * requires operator approval on every reply, full stop.
 */
export type ApprovalRuleType =
  | "review-request-auto-send"
  | "gbp-post-auto-publish"
  | "review-reply-auto-publish-allowlist"
  | "content-rejuvenation-auto-publish";

export interface ServicePlanFeatures {
  plan: ServicePlan;

  // ── Voice (§ 3 voice economics) ────────────────────────────────────────
  /** Whether the operator can provision a voice channel at all. Studio only. */
  voice: boolean;
  /** Inclusive monthly voice minutes — 0 (Starter), 30 (Pro), 100 (Studio). */
  voiceMinIncluded: number;
  /** Per-minute overage rate after `voiceMinIncluded` runs out. */
  voiceOverageRate: number | null;
  /** Hard ceiling — Studio is capped at 500/mo to bound runaway bills. */
  voiceHardCap: number | null;

  // ── Chat metering (§ 3 cost envelope) ──────────────────────────────────
  /** Conversational chat-turn cap. Starter 200, Pro 1000, Studio unlimited. */
  chatTurnsPerMonth: number | "unlimited";

  // ── Locations + platforms (§ 3 + § 8 gbpLocations) ─────────────────────
  /** Max claimed GBP locations. Starter 1, Pro 1, Studio 5. */
  maxGbpLocations: number;
  /** Max social platforms beyond GBP. Starter 0, Pro 2, Studio unlimited. */
  maxSocialPlatforms: number | "unlimited";

  // ── CRM + integrations (§ 3 headline + § 5 onboarding step 5) ──────────
  /** Whether ANY CRM integration is allowed at all. Pro+. */
  crmIntegration: boolean;
  /** ServiceTitan tier — Studio only (deferred to Sprint 7+ but gated now). */
  serviceTitanIntegration: boolean;

  // ── Content + media (§ 6 behavior #6 + § 12.5.7) ───────────────────────
  /** Content rejuvenation skill (§ 6 behavior #6 + § 10.5 rejuvenator). Pro+. */
  contentRejuvenation: boolean;
  /** Maya video editing (§ 12.5.7 Wave-4 worker, Studio-only). */
  mayaVideoEditing: boolean;

  // ── Approval rules (§ 8 approvalRules table + § 13 Sprint 5) ──────────
  /**
   * Which `approvalRules.ruleType` values can be ENABLED for a business at
   * this tier. CRITICAL: `review-reply-auto-publish-allowlist` is NEVER in
   * this list at any tier — Google ReviewReplyState lock.
   *
   * Server-side enforcement: every mutation that flips `approvalRules.enabled`
   * to true must check inclusion in this list FIRST and reject otherwise.
   */
  approvalRulesEnableable: ReadonlyArray<ApprovalRuleType>;
}

const STARTER: ServicePlanFeatures = {
  plan: "starter",
  // Voice: § 3 — "Starter ($99): no voice access at all — text-only."
  voice: false,
  voiceMinIncluded: 0,
  voiceOverageRate: null,
  voiceHardCap: null,
  // Chat: § 3 — Starter capped at 200/mo to bound inference cost.
  chatTurnsPerMonth: 200,
  // Locations: § 3 + § 8 — single GBP on Starter.
  maxGbpLocations: 1,
  // Platforms: § 3 — Starter is GBP-only.
  maxSocialPlatforms: 0,
  // CRM: § 3 — "no CRM integration" on Starter.
  crmIntegration: false,
  serviceTitanIntegration: false,
  // Rejuvenation: § 6 #6 — Pro+ only.
  contentRejuvenation: false,
  // Video editing: § 12.5.7 — Studio only.
  mayaVideoEditing: false,
  // Approval rules: § 13 Sprint 5 — "Starter has zero rules — every action
  // operator-approved." Every Starter action is operator-gated by default.
  approvalRulesEnableable: [],
};

const PRO: ServicePlanFeatures = {
  plan: "pro",
  // Voice: § 3 — "Pro ($149) includes 30 voice min/mo + $0.20/min overage".
  // Note: `voice: false` on Pro because the headline framing ($149 = "30 min/mo
  // INCLUDED") gives Pro voice access by inclusion, but Pro is text-first +
  // voice-sample-only. Studio is the dedicated voice tier. Per § 3:
  // "Voice never tanks Studio's economics" — Studio owns the voice surface.
  // Pro gets minutes for sampling but the voice CHANNEL provisioning UI is
  // surfaced as Studio-only in Profile. Updated 2026-04-27: `voice: true` for
  // Pro because the inclusion is a real feature, not just a number — see also
  // service plan § 3 voice tier economics + § 5 onboarding Q8 ("Default: skip
  // on Starter/Pro, set up now on Studio") which surfaces the Pro inclusion
  // for sampling.
  voice: true,
  voiceMinIncluded: 30,
  voiceOverageRate: 0.2,
  voiceHardCap: null,
  // Chat: § 3 — "1000 chat turns/mo".
  chatTurnsPerMonth: 1000,
  // Locations: § 3 — "1 GBP + 2 social" — single location, multi-platform.
  maxGbpLocations: 1,
  maxSocialPlatforms: 2,
  // CRM: § 3 — "CRM integration (Jobber / HCP / QBO)".
  crmIntegration: true,
  // ServiceTitan: § 3 — Studio-tier-only.
  serviceTitanIntegration: false,
  // Rejuvenation: § 6 #6 — Pro+.
  contentRejuvenation: true,
  // Video editing: § 12.5.7 — Studio only.
  mayaVideoEditing: false,
  // Approval rules: § 13 Sprint 5 — "Pro can enable specific rule types
  // (review-request-auto-send + gbp-post-auto-publish)."
  approvalRulesEnableable: [
    "review-request-auto-send",
    "gbp-post-auto-publish",
  ],
};

const STUDIO: ServicePlanFeatures = {
  plan: "studio",
  // Voice: § 3 — "Studio ($199) includes 100 voice min/mo + $0.15/min overage,
  // hard cap 500 min/mo."
  voice: true,
  voiceMinIncluded: 100,
  voiceOverageRate: 0.15,
  voiceHardCap: 500,
  // Chat: § 3 — "unlimited chat".
  chatTurnsPerMonth: "unlimited",
  // Locations: § 3 — "Multi-location (up to 5 GBPs)".
  maxGbpLocations: 5,
  // Platforms: § 3 — "all channels", interpreted as unlimited social platforms.
  maxSocialPlatforms: "unlimited",
  // CRM: § 3 — universal at Studio.
  crmIntegration: true,
  // ServiceTitan: § 3 — Studio-only ("when available", deferred to Sprint 7+).
  serviceTitanIntegration: true,
  // Rejuvenation: § 6 #6 — Pro+; Studio gets it too.
  contentRejuvenation: true,
  // Video editing: § 12.5.7 — Studio only.
  mayaVideoEditing: true,
  // Approval rules: § 13 Sprint 5 — "Studio can enable broader auto-publish
  // rules on a curated allowlist of safe content classes." Adds
  // content-rejuvenation-auto-publish to Pro's set. CRITICAL:
  // review-reply-auto-publish-allowlist is FORBIDDEN at every tier (Google
  // ReviewReplyState lock).
  approvalRulesEnableable: [
    "review-request-auto-send",
    "gbp-post-auto-publish",
    "content-rejuvenation-auto-publish",
  ],
};

const FEATURES_BY_PLAN: Record<ServicePlan, ServicePlanFeatures> = {
  starter: STARTER,
  pro: PRO,
  studio: STUDIO,
};

/**
 * Plan-tier resolver for a service-business row.
 *
 * Fail-closed semantics: an unset, unknown, or corrupted `planTier` returns
 * the STARTER feature set — the safest "no paid features unlocked" default.
 * This means any business row with a missing planTier (e.g. mid-onboarding,
 * pre-Stripe-checkout) is always treated as Starter for gating purposes.
 *
 * NOTE on the input shape: we accept `Pick<..., "planTier">` so test fixtures
 * can pass minimal stubs without filling out every business field. Production
 * call sites pass the full doc — TypeScript narrows correctly either way.
 */
export function planFeaturesService(
  business: Pick<Doc<"businesses">, "planTier"> | { planTier?: string | null }
): ServicePlanFeatures {
  const tier = business.planTier;
  if (tier === "starter" || tier === "pro" || tier === "studio") {
    return FEATURES_BY_PLAN[tier];
  }
  // Adversarial / unset / corrupted — fail closed to the most-restrictive
  // matrix. This intentionally does NOT throw because reads against this
  // helper happen all over the codebase and we want consistent gating
  // semantics rather than crashing the request. Mutations that need to
  // ENFORCE a tier should use `requireFeatureService(...)` which throws.
  return STARTER;
}

/**
 * Approval-rule enable predicate.
 *
 * Returns true iff the business's plan tier permits enabling `ruleType`.
 * The `review-reply-auto-publish-allowlist` ruleType is hard-rejected at
 * every tier — Google ReviewReplyState moderation requires operator
 * approval on every review reply.
 */
export function approvalRuleEnableable(
  business: Pick<Doc<"businesses">, "planTier"> | { planTier?: string | null },
  ruleType: ApprovalRuleType
): boolean {
  // Hard-reject the Google-moderation-locked rule type at every tier,
  // independent of plan-tier inclusion in the per-tier list.
  if (ruleType === "review-reply-auto-publish-allowlist") return false;
  return planFeaturesService(business).approvalRulesEnableable.includes(
    ruleType
  );
}

export class PlanServiceGateError extends Error {
  constructor(
    public plan: ServicePlan,
    public attemptedFeature: string,
    public requiredPlan: ServicePlan
  ) {
    super(
      `Service plan '${plan}' cannot access '${attemptedFeature}'. Requires '${requiredPlan}' or higher.`
    );
    this.name = "PlanServiceGateError";
  }
}

/**
 * Throwing-form gate. Mutations that must ENFORCE a tier wrap their entry
 * point in this helper so a missed-gate mistake fails loud. The `predicate`
 * is a function over the resolved features matrix so callers can express
 * arbitrary gate logic (e.g. `f => f.crmIntegration && f.maxGbpLocations >= 5`).
 */
export function requireFeatureService(
  business: Pick<Doc<"businesses">, "planTier"> | { planTier?: string | null },
  predicate: (f: ServicePlanFeatures) => boolean,
  attemptedFeature: string,
  requiredPlan: ServicePlan
): void {
  const features = planFeaturesService(business);
  if (!predicate(features)) {
    throw new PlanServiceGateError(features.plan, attemptedFeature, requiredPlan);
  }
}
