/**
 * GTM-product (creator-acquisition) plan-gating matrix.
 *
 * The GTM analog of `convex/planService.ts`. Same fail-closed philosophy, same
 * GateError class pattern, same `planFeatures*` + `requireFeature*` shape — but
 * a SEPARATE module because the GTM product is single-tier and its "caps" are
 * cost circuit-breakers rather than paywalls.
 *
 * Source of truth: `docs/MAYA_V2_ZERNIO_AUTOPOST_SPRINT_PLAN.md` + the
 * operator-ratified product decisions of 2026-06-02 (memory:
 * project_maya_v2_zernio_autopost_plan / project_gtm_tiers_locked_2026_06_01).
 *
 * LOCKED PRODUCT DECISIONS encoded here:
 *   - TWO TIERS (additive). `GtmPlan = 'gtm99' | 'studio'`. The $99 core
 *     (`gtm99`) is everything EXCEPT video; the $149 `studio` tier adds
 *     Creatify video generation (`canVideo` + `videoCreditsMonth`). The de-tier
 *     of 2026-06-02 still holds for the core caps (fair-use, not gates); the
 *     ONLY thing tier now gates is video (operator decision 2026-06-14).
 *   - For an ACTIVE gtm99 founder, every NON-VIDEO feature is true: research,
 *     drafts, autoPost, reads, monitoring, banSafety, attribution — but
 *     `canVideo` is FALSE and `videoCreditsMonth` is 0. Video is the studio
 *     upsell; gtm99 falls back to slideshow/text.
 *   - For an ACTIVE `studio` founder, ALL of the above PLUS `canVideo: true`
 *     and the monthly video ceiling.
 *   - `banSafetyManualGate` and `attributionEnabled` are CONST true — they can
 *     NEVER be turned off by any state. They are the anti-churn moats; even the
 *     fail-closed default keeps them true.
 *   - The CAPS are FAIR-USE COST CIRCUIT-BREAKERS (not paywalls), applied
 *     identically to every founder:
 *       connectedChannelCap   — 6 = all offered channels (X/Reddit/LinkedIn/
 *                               IG/TikTok/YouTube).
 *       autoPostChannelCap    — how many channels may auto-post.
 *       videoCreditsMonth     — monthly fair-use video ceiling.
 *       xUrlPostsSoftCapMonth — the X $0.20/link-post margin guard; doubles as
 *                               a ban-safe cadence ceiling.
 *
 * Fail-closed contract:
 *   - `planFeaturesGtm(agent)` returns the MOST-RESTRICTIVE VALID default on a
 *     missing / corrupt / none-status `gtmPlanJson`: the founder can still
 *     research + draft (research/draft/attribution must NEVER be blocked — that
 *     is not a paywall), but every cap = 0 so it CANNOT auto-post. banSafety +
 *     attribution stay const-true even in this default.
 *   - `requireFeatureGtm(...)` THROWS a `GtmPlanGateError` so callers can't
 *     silently fall through to "no gate" behavior.
 *
 * NOTE on the input shape: the param is typed STRUCTURALLY as
 * `{ gtmPlanJson?: string | null }`, NOT `Pick<Doc<'gtmAgents'>, 'gtmPlanJson'>`.
 * The `gtmPlanJson` field does NOT exist on the schema yet (it lands in a later
 * sprint), so referencing `Doc<'gtmAgents'>` would break `tsc`. A structural
 * param is satisfied by a real Doc later. This module intentionally does NOT
 * import `Doc`/`Id` from dataModel to stay schema-decoupled and tsc-safe.
 */

export type GtmPlan = "gtm99" | "studio";

/** Lifecycle status of the founder's GTM subscription. */
export type GtmPlanStatus = "active" | "past_due" | "trialing" | "none";

export interface GtmPlanFeatures {
  plan: GtmPlan;
  status: GtmPlanStatus;

  // ── Fair-use cost circuit-breakers (NOT paywalls) ──────────────────────
  /** Max channels the founder may CONNECT. 6 = all offered channels. */
  connectedChannelCap: number;
  /** Max channels that may AUTO-POST. */
  autoPostChannelCap: number;
  /** Monthly fair-use video-generation ceiling. */
  videoCreditsMonth: number;
  /**
   * Monthly soft cap on X URL/link posts — the $0.20/link-post margin guard
   * that doubles as a ban-safe cadence ceiling.
   */
  xUrlPostsSoftCapMonth: number;

  // ── Anti-churn moats — CONST true, can NEVER be turned off ──────────────
  /** Ban-safety manual gate. Always on, every state. */
  banSafetyManualGate: true;
  /** Closed-loop conversion attribution. Always on, every state. */
  attributionEnabled: true;

  // ── Boolean feature flags (gate-able via requireFeatureGtm) ─────────────
  /** Whether Maya may auto-post on the founder's behalf. */
  canAutoPost: boolean;
  /** Whether research is allowed. Never blocked — true in every valid state. */
  canResearch: boolean;
  /** Whether drafting is allowed. Never blocked — true in every valid state. */
  canDraft: boolean;
  /** Whether read-layer scraping / monitoring is allowed. */
  canRead: boolean;
  /** Whether ongoing channel monitoring is allowed. */
  canMonitor: boolean;
  /** Whether Maya may generate videos (subject to videoCreditsMonth cap). */
  canVideo: boolean;
}

/**
 * The full-product feature set for an ACTIVE $99 `gtm99` founder. Everything
 * EXCEPT video; caps are the fair-use ceilings. Video is the studio upsell, so
 * `canVideo: false` and `videoCreditsMonth: 0` here.
 */
const GTM99_ACTIVE: GtmPlanFeatures = {
  plan: "gtm99",
  status: "active",
  connectedChannelCap: 6,
  autoPostChannelCap: 6,
  videoCreditsMonth: 0,
  xUrlPostsSoftCapMonth: 30,
  banSafetyManualGate: true,
  attributionEnabled: true,
  canAutoPost: true,
  canResearch: true,
  canDraft: true,
  canRead: true,
  canMonitor: true,
  canVideo: false,
};

/**
 * The ACTIVE $149 `studio` feature set: everything in gtm99 PLUS Creatify video
 * generation, bounded by the monthly video ceiling.
 */
const GTM_STUDIO_ACTIVE: GtmPlanFeatures = {
  ...GTM99_ACTIVE,
  plan: "studio",
  videoCreditsMonth: 15,
  canVideo: true,
};

/** Resolve the base ACTIVE feature set for a tier. */
function tierBase(tier: GtmPlan): GtmPlanFeatures {
  return tier === "studio" ? GTM_STUDIO_ACTIVE : GTM99_ACTIVE;
}

/**
 * The MOST-RESTRICTIVE VALID default. Returned on missing / corrupt /
 * none-status `gtmPlanJson`. The founder can still research + draft (these are
 * NEVER paywalled), attribution + ban-safety stay const-true, but every cap = 0
 * so nothing auto-posts. This is a safe floor, not a paywall.
 */
const FAIL_CLOSED_DEFAULT: GtmPlanFeatures = {
  plan: "gtm99",
  status: "none",
  connectedChannelCap: 0,
  autoPostChannelCap: 0,
  videoCreditsMonth: 0,
  xUrlPostsSoftCapMonth: 0,
  banSafetyManualGate: true,
  attributionEnabled: true,
  canAutoPost: false,
  canResearch: true,
  canDraft: true,
  canRead: true,
  canMonitor: false,
  canVideo: false,
};

/**
 * The shape we expect inside the parsed `gtmPlanJson` string. Every field is
 * optional/unknown at the type level — we validate defensively at runtime
 * because the JSON is operator/Stripe-webhook-sourced and may be partial or
 * corrupt.
 */
interface ParsedGtmPlan {
  tier?: unknown;
  status?: unknown;
  connectedChannelCap?: unknown;
  autoPostChannelCap?: unknown;
  videoCreditsMonth?: unknown;
  xUrlPostsSoftCapMonth?: unknown;
  periodStart?: unknown;
  usage?: {
    autoPostsThisPeriod?: unknown;
    xUrlPostsThisPeriod?: unknown;
    videosThisPeriod?: unknown;
  };
}

/** A non-negative finite integer cap, or the supplied fallback. */
function coerceCap(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

/**
 * Plan-feature resolver for a GTM agent row.
 *
 * Fail-closed semantics: an unset, unknown, corrupt, or none/past_due-status
 * `gtmPlanJson` returns `FAIL_CLOSED_DEFAULT` (research/draft only, caps = 0,
 * ban-safety + attribution const-true). An `active`, `past_due`, or `trialing`
 * plan returns the full gtm99 feature set with caps drawn from the JSON (or the
 * fair-use defaults). Trial = FULL access (operator decision 2026-06-07) so the
 * founder sees the core value; on trial expiry without payment the subscription
 * lapses to status:"none" → FAIL_CLOSED_DEFAULT.
 *
 * This intentionally does NOT throw because reads against this helper happen
 * all over the codebase and we want consistent gating semantics rather than
 * crashing the request. Mutations that need to ENFORCE a feature should use
 * `requireFeatureGtm(...)` which throws.
 */
export function planFeaturesGtm(agent: {
  gtmPlanJson?: string | null;
}): GtmPlanFeatures {
  const raw = agent.gtmPlanJson;
  if (typeof raw !== "string" || raw.trim() === "") {
    return FAIL_CLOSED_DEFAULT;
  }

  let parsed: ParsedGtmPlan;
  try {
    const candidate = JSON.parse(raw);
    if (candidate === null || typeof candidate !== "object") {
      return FAIL_CLOSED_DEFAULT;
    }
    parsed = candidate as ParsedGtmPlan;
  } catch {
    // Corrupt JSON — fail closed.
    return FAIL_CLOSED_DEFAULT;
  }

  // Two valid tiers: gtm99 ($99, no video) + studio ($149, +video). Anything
  // else (missing/unknown) → fail closed. The tier-base carries the right
  // canVideo + videoCreditsMonth, so video gating is just the tier boundary.
  const tier: GtmPlan | null =
    parsed.tier === "studio" ? "studio" : parsed.tier === "gtm99" ? "gtm99" : null;
  if (!tier) {
    return FAIL_CLOSED_DEFAULT;
  }
  const base = tierBase(tier);
  const status = parsed.status;

  // `active`/`past_due`/`trialing` all return the tier's full feature set with
  // caps drawn from the JSON (or the tier's fair-use defaults):
  //   - past_due keeps the active set — we never cut research/draft/attribution/
  //     ban-safety for a payment hiccup (billing recovery, not a gate).
  //   - trialing → FULL access (operator decision 2026-06-07): the founder must
  //     experience the core value or won't convert; margin is protected by the
  //     short trial window + spend kill-switch + fair-use caps, NOT by
  //     withholding the product. On expiry without payment → status:"none" →
  //     FAIL_CLOSED_DEFAULT.
  if (status === "active" || status === "past_due" || status === "trialing") {
    return {
      ...base,
      status,
      connectedChannelCap: coerceCap(
        parsed.connectedChannelCap,
        base.connectedChannelCap
      ),
      autoPostChannelCap: coerceCap(
        parsed.autoPostChannelCap,
        base.autoPostChannelCap
      ),
      videoCreditsMonth: coerceCap(parsed.videoCreditsMonth, base.videoCreditsMonth),
      xUrlPostsSoftCapMonth: coerceCap(
        parsed.xUrlPostsSoftCapMonth,
        base.xUrlPostsSoftCapMonth
      ),
    };
  }

  // status === 'none', missing, or any unexpected value → fail closed.
  return FAIL_CLOSED_DEFAULT;
}

export class GtmPlanGateError extends Error {
  constructor(
    public plan: GtmPlan,
    public status: GtmPlanStatus,
    public attemptedFeature: string
  ) {
    super(
      `GTM plan '${plan}' (status '${status}') cannot access '${attemptedFeature}'.`
    );
    this.name = "GtmPlanGateError";
  }
}

/**
 * Throwing-form feature gate. Mutations that must ENFORCE a feature wrap their
 * entry point in this helper so a missed-gate mistake fails loud. The
 * `predicate` is a function over the resolved features matrix so callers can
 * express arbitrary gate logic (e.g. `f => f.canAutoPost`).
 */
export function requireFeatureGtm(
  features: GtmPlanFeatures,
  predicate: (f: GtmPlanFeatures) => boolean,
  attemptedFeature: string
): void {
  if (!predicate(features)) {
    throw new GtmPlanGateError(features.plan, features.status, attemptedFeature);
  }
}

/**
 * Throwing-form cap gate. Throws `GtmPlanGateError` when current usage has met
 * or exceeded the named cap. Fail-closed: a cap of 0 (the fail-closed default)
 * blocks the FIRST attempt.
 */
export function requireUnderCapGtm(
  features: GtmPlanFeatures,
  capName:
    | "connectedChannelCap"
    | "autoPostChannelCap"
    | "videoCreditsMonth"
    | "xUrlPostsSoftCapMonth",
  currentUsage: number
): void {
  const cap = features[capName];
  if (!(currentUsage < cap)) {
    throw new GtmPlanGateError(
      features.plan,
      features.status,
      `${capName} (usage ${currentUsage} >= cap ${cap})`
    );
  }
}

/**
 * Non-throwing predicate for the X URL/link-post soft cap. Returns true iff
 * another X url-post is allowed given the current-period usage. Fail-closed:
 * a 0 cap (fail-closed default / trial) returns false on the first post.
 */
export function canPostXUrlGtm(
  features: GtmPlanFeatures,
  currentPeriodXUrlPosts: number
): boolean {
  return currentPeriodXUrlPosts < features.xUrlPostsSoftCapMonth;
}

/**
 * Free-trial length in days. Operator decision 2026-06-07: short trial (the
 * program is expensive — always-on agent + research + video). 7 shows a week of
 * real posting + early conversion signal while halving the 14-day COGS; drop to
 * 3 by changing this one constant. Env-overridable via GTM_TRIAL_DAYS.
 */
export function gtmTrialDays(): number {
  const env = Number(process.env.GTM_TRIAL_DAYS);
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : 7;
}

/**
 * Build the `gtmPlanJson` string written onto gtmAgents by the Stripe webhook
 * (and the operator comp path). The resolver `planFeaturesGtm` parses exactly
 * this shape. `periodStart` lets usage counters reset per billing period.
 */
export function buildGtmPlanJson(input: {
  status: GtmPlanStatus;
  /** Which tier was purchased/comped. Default 'gtm99' (the $99 core). */
  tier?: GtmPlan;
  periodStartMs?: number;
  /** Optional cap overrides; omit for the tier's fair-use ceilings. */
  caps?: Partial<{
    connectedChannelCap: number;
    autoPostChannelCap: number;
    videoCreditsMonth: number;
    xUrlPostsSoftCapMonth: number;
  }>;
}): string {
  return JSON.stringify({
    tier: input.tier ?? "gtm99",
    status: input.status,
    ...(input.caps ?? {}),
    periodStart: input.periodStartMs ?? null,
    usage: { autoPostsThisPeriod: 0, xUrlPostsThisPeriod: 0, videosThisPeriod: 0 },
  });
}
