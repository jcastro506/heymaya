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
 * LOCKED PRODUCT DECISIONS encoded here (3-tier, channel-gated — see
 * `docs/SPRINT_PLAN_REALTIME_OPERATOR_V1.md` §15.1/§16):
 *   - THREE TIERS. `GtmPlan = 'starter' | 'growth' | 'studio'`. The axis is
 *     ACTIVE CHANNEL COUNT (the #1 COGS lever) + video on the top tier:
 *       starter ($99)  — up to 3 active channels, no video.
 *       growth  ($149) — up to 6 active channels, no video.
 *       studio  ($199) — up to 6 active channels + Creatify video.
 *     `maxActiveChannels` (3 / 6 / 6) is the load-bearing gate — enforced
 *     server-side by `selectActiveChannels` so a tier can NEVER run more
 *     channels than it paid for. Channel gating doubles as pulse-cost
 *     governance. Video stays Studio-only (`canVideo` + `videoCreditsMonth`).
 *   - BACK-COMPAT: a legacy `gtmPlanJson` with `tier:"gtm99"` (the prior $99
 *     single tier) resolves to `starter`; the prior `studio` ($149+video)
 *     keeps mapping to `studio`. No stranded comped agents.
 *   - For an ACTIVE founder, every NON-VIDEO feature is true: research,
 *     drafts, autoPost, reads, monitoring, banSafety, attribution. `canVideo`
 *     is FALSE on starter/growth (they fall back to slideshow/text) and TRUE
 *     on studio with the monthly video ceiling.
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

export type GtmPlan = "starter" | "growth" | "studio";

/**
 * Legacy tier name from the prior single-$99 era. Accepted on READ (back-compat
 * for already-written gtmPlanJson) and mapped to `starter`. Never emitted.
 */
type LegacyGtmPlan = "gtm99";

/** Lifecycle status of the founder's GTM subscription. */
export type GtmPlanStatus = "active" | "past_due" | "trialing" | "none";

export interface GtmPlanFeatures {
  plan: GtmPlan;
  status: GtmPlanStatus;

  // ── Fair-use cost circuit-breakers (NOT paywalls) ──────────────────────
  /**
   * TIER GATE — max channels Maya may keep ACTIVE (running + posting) at once.
   * starter 3 / growth 6 / studio 6. Enforced server-side by
   * `selectActiveChannels`. This is the #1 COGS lever and the primary paid
   * differentiator; fail-closed default is 0 (paused). Distinct from
   * `connectedChannelCap` (how many a founder may link).
   */
  maxActiveChannels: number;
  /** Max channels the founder may CONNECT. 6 = all offered channels. */
  connectedChannelCap: number;
  /** Max channels that may AUTO-POST. */
  autoPostChannelCap: number;
  /** Monthly fair-use video-generation ceiling. */
  videoCreditsMonth: number;
  /**
   * Monthly creative-CREDIT budget for Aurora UGC avatar video (distinct from
   * `videoCreditsMonth`, which is the standard/ad-clone ceiling). Billed in
   * Creatify credits, NOT a video count, so a 15s fast clip (~7.5cr) is cheaper
   * than a 30s realistic one — Maya is incentivized to pick the cheap format.
   * Paced across the billing month by `creativeBudgetGate`. 0 on starter/growth,
   * 60 on studio (~$9 COGS on the $199 line). Gates `canUgc`.
   */
  ugcCreditsMonth: number;
  /**
   * Monthly fair-use static-image / ad-creative generation ceiling (Creatify
   * IAB Images / Asset Generator). 0 on starter, 50 on growth, 100 on studio.
   * Gates `canImage` the same way `videoCreditsMonth` gates `canVideo`.
   */
  assetCreditsMonth: number;
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
  /**
   * Whether Maya may generate Aurora UGC avatar video (subject to the paced
   * `ugcCreditsMonth` credit budget). Studio-only — FALSE on starter + growth.
   */
  canUgc: boolean;
  /**
   * Whether Maya may generate static images / ad creative via Creatify
   * (subject to assetCreditsMonth cap). FALSE on starter (text + her own
   * Gemini slideshow only), TRUE on growth + studio.
   */
  canImage: boolean;
}

/**
 * The ACTIVE $99 `starter` feature set: full real-time operator on up to 3
 * channels, no video. Caps are fair-use ceilings; `maxActiveChannels: 3` is the
 * paid gate. Video is the studio upsell → `canVideo: false`.
 */
const GTM_STARTER_ACTIVE: GtmPlanFeatures = {
  plan: "starter",
  status: "active",
  maxActiveChannels: 3,
  connectedChannelCap: 6,
  autoPostChannelCap: 3,
  videoCreditsMonth: 0,
  ugcCreditsMonth: 0,
  assetCreditsMonth: 0,
  xUrlPostsSoftCapMonth: 30,
  banSafetyManualGate: true,
  attributionEnabled: true,
  canAutoPost: true,
  canResearch: true,
  canDraft: true,
  canRead: true,
  canMonitor: true,
  canVideo: false,
  canUgc: false,
  canImage: false,
};

/**
 * The ACTIVE $149 `growth` feature set: everything in starter but on up to 6
 * channels (the breadth upgrade). Still no video.
 */
const GTM_GROWTH_ACTIVE: GtmPlanFeatures = {
  ...GTM_STARTER_ACTIVE,
  plan: "growth",
  maxActiveChannels: 6,
  autoPostChannelCap: 6,
  // The breadth upgrade also unlocks Creatify static image / ad creative
  // (still no video — that's the Studio line).
  canImage: true,
  assetCreditsMonth: 50,
};

/**
 * The ACTIVE $199 `studio` feature set: 6 channels (like growth) PLUS Creatify
 * video generation, bounded by the monthly video ceiling.
 */
const GTM_STUDIO_ACTIVE: GtmPlanFeatures = {
  ...GTM_GROWTH_ACTIVE,
  plan: "studio",
  videoCreditsMonth: 15,
  canVideo: true,
  // Aurora UGC avatar video — Studio-only, paced credit budget (~$9 COGS/mo at
  // 60 cr on the $199 line). Distinct from the standard video ceiling above.
  ugcCreditsMonth: 60,
  canUgc: true,
  // Studio gets a higher static-image ceiling on top of video (inherits
  // canImage:true from growth).
  assetCreditsMonth: 100,
};

/** Resolve the base ACTIVE feature set for a tier. */
function tierBase(tier: GtmPlan): GtmPlanFeatures {
  if (tier === "studio") return GTM_STUDIO_ACTIVE;
  if (tier === "growth") return GTM_GROWTH_ACTIVE;
  return GTM_STARTER_ACTIVE;
}

/**
 * The MOST-RESTRICTIVE VALID default. Returned on missing / corrupt /
 * none-status `gtmPlanJson`. The founder can still research + draft (these are
 * NEVER paywalled), attribution + ban-safety stay const-true, but every cap = 0
 * so nothing auto-posts. This is a safe floor, not a paywall.
 */
const FAIL_CLOSED_DEFAULT: GtmPlanFeatures = {
  plan: "starter",
  status: "none",
  maxActiveChannels: 0,
  connectedChannelCap: 0,
  autoPostChannelCap: 0,
  videoCreditsMonth: 0,
  ugcCreditsMonth: 0,
  assetCreditsMonth: 0,
  xUrlPostsSoftCapMonth: 0,
  banSafetyManualGate: true,
  attributionEnabled: true,
  canAutoPost: false,
  canResearch: true,
  canDraft: true,
  canRead: true,
  canMonitor: false,
  canVideo: false,
  canUgc: false,
  canImage: false,
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
  ugcCreditsMonth?: unknown;
  assetCreditsMonth?: unknown;
  xUrlPostsSoftCapMonth?: unknown;
  periodStart?: unknown;
  usage?: {
    autoPostsThisPeriod?: unknown;
    xUrlPostsThisPeriod?: unknown;
    videosThisPeriod?: unknown;
    imagesThisPeriod?: unknown;
  };
}

/**
 * Resolve a raw `tier` value (from gtmPlanJson) to a valid GtmPlan, or null if
 * unrecognized. Accepts the three live tiers plus the legacy `gtm99` alias,
 * which maps to `starter` so pre-3-tier plan JSON keeps working.
 */
function resolveTier(raw: unknown): GtmPlan | null {
  if (raw === "starter" || raw === "growth" || raw === "studio") return raw;
  if (raw === ("gtm99" satisfies LegacyGtmPlan)) return "starter";
  return null;
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

  // Three valid tiers: starter ($99/3ch) · growth ($149/6ch) · studio
  // ($199/6ch+video). The legacy `gtm99` tier maps to `starter` (back-compat
  // for already-written plan JSON). Anything else (missing/unknown) → fail
  // closed. The tier-base carries the right maxActiveChannels + canVideo +
  // videoCreditsMonth, so both channel- and video-gating are the tier boundary.
  const tier: GtmPlan | null = resolveTier(parsed.tier);
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
      // UGC credit budget can be overridden per-plan but never widens canUgc
      // (which stays the tier boundary above) — fail-closed if base is 0.
      ugcCreditsMonth: coerceCap(parsed.ugcCreditsMonth, base.ugcCreditsMonth),
      assetCreditsMonth: coerceCap(
        parsed.assetCreditsMonth,
        base.assetCreditsMonth
      ),
      xUrlPostsSoftCapMonth: coerceCap(
        parsed.xUrlPostsSoftCapMonth,
        base.xUrlPostsSoftCapMonth
      ),
    };
  }

  // status === 'none', missing, or any unexpected value → fail closed.
  return FAIL_CLOSED_DEFAULT;
}

/**
 * Per-tier headline price (USD/mo), for Maya's plan-awareness summary. Source of
 * truth is the locked 3-tier pricing (planGtm header / SPRINT_PLAN_REALTIME_
 * OPERATOR_V1 §15.1): starter $99 / growth $149 / studio $199. Used ONLY for the
 * human-readable summary — never for gating.
 */
const GTM_TIER_PRICE_USD: Record<GtmPlan, number> = {
  starter: 99,
  growth: 149,
  studio: 199,
};

/** Title-case tier label for operator-facing copy. */
function tierLabel(plan: GtmPlan): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/**
 * Pure, side-effect-free human-readable summary of a resolved feature set, for
 * Maya to read (rendered into PLAN.md + returned by `get_my_plan`). This is
 * AWARENESS ONLY — the server-side gate (`planFeaturesGtm` + `requireFeatureGtm`)
 * stays the sole authority; this string just lets Maya tell the founder their
 * tier, explain her limits, and nudge upgrades honestly.
 *
 * Output shape (newline-joined):
 *   - line 1: tier + price + status (e.g. "Growth plan ($149/mo) — active.")
 *   - line 2: active-channel allowance ("Up to 6 active channels.")
 *   - line 3: video capability ("Video: yes, ~15/mo." | "Video: not on this
 *             tier (Studio only).")
 *   - final note: the single most-relevant call to action —
 *       · fail-closed (status "none") → "NOT ACTIVE — tell the founder to start
 *         their plan so you can post."
 *       · starter at/near the 3-channel cap → "Growth unlocks 6 channels."
 *       · non-Studio (no video) → "Studio unlocks video."
 *       · otherwise (active Studio) → a steady "You're on the top tier." note.
 */
export function describePlanForMaya(features: GtmPlanFeatures): string {
  const lines: string[] = [];
  const price = GTM_TIER_PRICE_USD[features.plan];
  const label = tierLabel(features.plan);

  // Line 1 — tier + price + lifecycle status, in plain words.
  const statusWord =
    features.status === "active"
      ? "active"
      : features.status === "trialing"
        ? "on a free trial (full access)"
        : features.status === "past_due"
          ? "past due (still active — a payment needs updating)"
          : "NOT active";
  lines.push(`${label} plan ($${price}/mo) — ${statusWord}.`);

  // Line 2 — active-channel allowance (the load-bearing paid gate).
  if (features.maxActiveChannels <= 0) {
    lines.push(
      "Active channels: 0 right now (the plan isn't running — see the note below)."
    );
  } else {
    lines.push(`Up to ${features.maxActiveChannels} active channels.`);
  }

  // Line 3 — static image / ad-creative capability (Growth + Studio).
  if (features.canImage) {
    lines.push(`Static images: yes, ~${features.assetCreditsMonth}/mo.`);
  } else {
    lines.push("Static images: not on this tier (Growth+).");
  }

  // Line 4 — video capability (Studio-only).
  if (features.canVideo) {
    lines.push(`Video: yes, ~${features.videoCreditsMonth}/mo.`);
  } else {
    lines.push("Video: not on this tier (Studio only).");
  }

  // Line 5 — UGC avatar video (Studio-only, paced credit budget). Check the
  // live remaining budget with check_creative_budget before any render.
  if (features.canUgc) {
    lines.push(
      `UGC avatar video: yes, ~${features.ugcCreditsMonth} credits/mo (paced across the month — check_creative_budget before each render).`
    );
  } else {
    lines.push("UGC avatar video: not on this tier (Studio only).");
  }

  // Final note — the single most-relevant call to action.
  if (features.status === "none" || features.maxActiveChannels <= 0) {
    lines.push(
      "NOT ACTIVE — tell the founder to start their plan so you can post. Don't go silent; ask them to start/renew it."
    );
  } else if (features.plan === "starter") {
    // Starter is at/near the 3-channel cap relative to Growth's 6, and has
    // neither static-image creative nor video — surface the breadth + image
    // upgrade first, then video.
    lines.push(
      "Growth unlocks 6 channels + designed image creative; Studio adds video. Only nudge when they're actually hitting the limit."
    );
  } else if (!features.canVideo) {
    // Growth — full breadth, but no video.
    lines.push(
      "Studio unlocks video. Only nudge it if they actually want video."
    );
  } else {
    lines.push("You're on the top tier — no upgrade to push.");
  }

  return lines.join("\n");
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
    | "assetCreditsMonth"
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
  /** Which tier was purchased/comped. Default 'starter' (the $99 core). */
  tier?: GtmPlan;
  periodStartMs?: number;
  /** Optional cap overrides; omit for the tier's fair-use ceilings. */
  caps?: Partial<{
    connectedChannelCap: number;
    autoPostChannelCap: number;
    videoCreditsMonth: number;
    assetCreditsMonth: number;
    xUrlPostsSoftCapMonth: number;
  }>;
}): string {
  return JSON.stringify({
    tier: input.tier ?? "starter",
    status: input.status,
    ...(input.caps ?? {}),
    periodStart: input.periodStartMs ?? null,
    usage: {
      autoPostsThisPeriod: 0,
      xUrlPostsThisPeriod: 0,
      videosThisPeriod: 0,
      imagesThisPeriod: 0,
    },
  });
}
