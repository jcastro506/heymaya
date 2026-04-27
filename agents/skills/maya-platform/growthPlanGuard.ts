/**
 * maya-platform/growthPlanGuard — shared stage-aware skill-prompt helper.
 *
 * Added 2026-04-26 by Agent B (stage-aware adaptive product).
 *
 * The product positioning is stage-adaptive: every recommending skill must
 * respect the creator's current stage. A `just-starting` creator should NOT
 * receive brand-pitch recommendations; a `scaling` creator should NOT
 * receive "post more consistently" recommendations.
 *
 * The synthesis pipeline writes a `growthPlan` blob onto `creatorPicture`
 * with `focusAreas` (what to prioritize NOW) and `antiPatterns` (what NOT
 * to do yet). Skill scripts:
 *   1. Accept the (optional) `growthPlan` as input.
 *   2. Call `assertSkillRespectsGrowthPlan` BEFORE drafting the prompt — if
 *      the skill's domain matches an antiPattern, return a stage-appropriate
 *      "deferred" result instead of running the LLM.
 *   3. Optionally call `growthPlanPromptSuffix` to append a short stage-aware
 *      reminder to the LLM prompt for the cases that DO run.
 *
 * Pure TypeScript. No Convex, no network. Imported by `convex/agents/skills/*`
 * orchestrator actions which compose the per-skill pure logic.
 */

export type CareerStage =
  | "just-starting"
  | "building"
  | "monetizing"
  | "scaling";

/**
 * Skill-domain identifier used for antiPattern matching. Each enum value maps
 * to a recognizable theme the synthesis emits in `growthPlan.antiPatterns`.
 * Keep this list in sync with the synthesis system prompt's stage-rule
 * vocabulary in `convex/onboarding/maya/synthesizeCreatorPicture.ts` —
 * sibling-file scan asserts both directions in tests.
 */
export type SkillDomain =
  | "brand-outreach"
  | "brand-pitch-strategy"
  | "monetization-diversifier"
  | "collab-matchmaker"
  | "opportunity-scout"
  | "rate-calculator"
  | "growth-coach"
  | "content-arc-planner";

/**
 * The synthesis-emitted growth plan, narrowed to the fields skills consume.
 * `currentStage` denormalizes `creatorPicture.careerStage` so the skill
 * doesn't have to re-read the picture row.
 *
 * Wave 2 (2026-04-26) — `smartAlternatives` is the route-to-instead list. Each
 * entry pairs an antiPattern with a concrete `insteadDoThis` / `exampleAction`
 * the skill can return as its output rather than refusing the original ask.
 */
export interface SmartAlternative {
  readonly antiPattern: string;
  readonly insteadDoThis: string;
  readonly exampleAction: string;
  readonly reasoning: string;
}

export interface GrowthPlanForSkill {
  readonly currentStage: CareerStage;
  readonly nextMilestoneText: string;
  readonly focusAreas: ReadonlyArray<string>;
  readonly antiPatterns: ReadonlyArray<string>;
  /** Wave 2 — paired alternatives. Optional for backwards compat with old plans. */
  readonly smartAlternatives?: ReadonlyArray<SmartAlternative>;
  readonly horizonWeeks: number;
}

/**
 * Per-domain antiPattern keyword catalog. If any of the creator's
 * `antiPatterns` strings (lowercased) contains ANY of these keywords for the
 * skill's domain, the skill defers. This is intentionally permissive — the
 * synthesis emits free-form bullets, so we match on the keyword vocabulary
 * the synthesis prompt explicitly uses (e.g. "pitching brands cold",
 * "diversifying monetization", "scaling tactics").
 */
const ANTI_PATTERN_KEYWORDS: Record<SkillDomain, ReadonlyArray<string>> = {
  "brand-outreach": [
    "pitch brands",
    "pitching brands",
    "brand pitch",
    "outreach",
    "cold outreach",
    "outbound pitch",
  ],
  "brand-pitch-strategy": [
    "pitch brands",
    "pitching brands",
    "brand pitch",
    "outbound",
  ],
  "monetization-diversifier": [
    "diversify",
    "diversifying monetization",
    "monetization diversification",
    "diversifying revenue",
    "additional revenue",
    "additional monetization",
    "additional streams",
    "new stream",
    "new monetization",
    "premature monetization",
  ],
  "collab-matchmaker": [
    "collab",
    "collabs",
    "collaboration",
  ],
  "opportunity-scout": [
    "scout",
    "scouting",
    "marketplace",
    "ugc marketplace",
    "outbound prospect",
    "opportunity",
  ],
  "rate-calculator": [
    "set rates",
    "setting rates",
    "rate setting",
    "negotiate rates",
    "raise rates",
    // Hobbyist-stage anti-pattern: don't price-shop until you have a deal.
  ],
  "growth-coach": [
    // The growth-coach itself is universally enabled. The anti-pattern
    // matchers here are intentionally empty so the coach NEVER defers — its
    // job is to surface stage-appropriate moves, including the move of
    // doing less.
  ],
  "content-arc-planner": [
    "complex content arc",
    "complex arcs",
    "multi-platform launch",
    "platform launch",
    "themed week",
    // just-starting anti-patterns include "complex content arcs" — defer to a
    // simpler 1-3 day suggestion instead of a full 7-day arc.
  ],
};

/**
 * Returns true if the growthPlan's antiPatterns explicitly forbid this skill
 * at this stage. Case-insensitive substring match against the per-domain
 * keyword catalog above.
 */
export function isSkillBlockedByAntiPatterns(
  domain: SkillDomain,
  growthPlan: GrowthPlanForSkill | null | undefined
): boolean {
  if (!growthPlan) return false;
  const keywords = ANTI_PATTERN_KEYWORDS[domain];
  if (keywords.length === 0) return false;
  for (const ap of growthPlan.antiPatterns) {
    const apLower = ap.toLowerCase();
    for (const kw of keywords) {
      if (apLower.includes(kw)) return true;
    }
  }
  return false;
}

/**
 * Per-domain default deferral message keyed by stage. Returned by
 * `assertSkillRespectsGrowthPlan` when the skill is blocked. The message is
 * a 1–2 sentence anti-sycophantic deferral the orchestrator surfaces to the
 * creator (or quietly logs in `mayaActionLog` if the skill was triggered by
 * a cron, not a chat).
 */
const DEFERRAL_MESSAGE: Record<
  SkillDomain,
  Record<CareerStage, string>
> = {
  "brand-outreach": {
    "just-starting":
      "Not yet — you're in growth phase, not pitch phase. Maya will surface brand outreach when your niche is clear and posting cadence is locked.",
    building:
      "Outreach is on the table at your stage — but your growth plan flagged it as something to defer right now (likely because deals are already in flight or you're rebuilding cadence).",
    monetizing:
      "Outreach typically helps at your stage — but your growth plan currently flags it as a deferred move. Check Profile → Growth Plan to revisit.",
    scaling:
      "Selectivity over volume at your stage. Your growth plan flagged broad outreach as the wrong move — focus on inbound triage and the few warm targets you already have.",
  },
  "brand-pitch-strategy": {
    "just-starting":
      "Pitch strategy waits until you're at the building stage. Maya is tracking your milestone — when you cross it she'll surface this skill.",
    building:
      "Your growth plan currently defers proactive pitching — Maya will revisit when the next milestone lands.",
    monetizing:
      "Your growth plan currently defers proactive pitching — likely because inbound is already at capacity.",
    scaling:
      "Your growth plan defers proactive pitching at your stage — focus on inbound selectivity instead.",
  },
  "monetization-diversifier": {
    "just-starting":
      "Diversifying monetization streams before your first one is consistent will spread you thin. Maya is tracking your milestone — diversification surfaces once one stream is locked.",
    building:
      "Your growth plan defers monetization diversification right now — first lock the primary revenue stream.",
    monetizing:
      "Diversification is normally on at your stage, but your growth plan currently flags it as a deferred move (likely because the existing streams aren't yet at floor).",
    scaling:
      "Your growth plan currently defers further diversification — focus on the existing streams' margin instead.",
  },
  "collab-matchmaker": {
    "just-starting":
      "Collabs need a clear niche to land — Maya is tracking that milestone first. Once your niche is locked she'll surface peer matches.",
    building:
      "Your growth plan currently defers collab matchmaking — likely because cadence isn't yet consistent.",
    monetizing:
      "Your growth plan currently defers collab matchmaking — likely because deal flow is already at capacity.",
    scaling:
      "Your growth plan currently defers broad collab matchmaking — focus on the few high-value partnerships you already have.",
  },
  "opportunity-scout": {
    "just-starting":
      "Most UGC marketplaces have follower minimums. Maya turns the scout on once you cross the milestone — until then she's watching local-brand signal instead.",
    building:
      "Your growth plan currently defers the marketplace scout — likely because you've got existing inbound to work through first.",
    monetizing:
      "Your growth plan currently defers the marketplace scout — focus on inbound triage first.",
    scaling:
      "Your growth plan currently defers the marketplace scout — selectivity over volume at your stage.",
  },
  "rate-calculator": {
    "just-starting":
      "Setting rates before your first deal sets them artificially. Maya will help calibrate once you have a real offer to compare against.",
    building:
      "Your growth plan defers rate-setting work right now.",
    monetizing:
      "Your growth plan defers rate-setting right now.",
    scaling:
      "Your growth plan defers proactive rate-setting at your stage — let inbound demand price you instead.",
  },
  "growth-coach": {
    // growth-coach never defers — its job is stage-aware itself.
    "just-starting": "",
    building: "",
    monetizing: "",
    scaling: "",
  },
  "content-arc-planner": {
    "just-starting":
      "Multi-day content arcs are too much load at your stage. Maya is suggesting a simpler day-by-day plan instead — focus on consistency, not arc complexity.",
    building:
      "Your growth plan defers complex multi-day arcs right now — Maya will draft a leaner per-day plan instead.",
    monetizing:
      "Your growth plan defers complex multi-day arcs right now.",
    scaling:
      "Your growth plan defers complex multi-day arcs right now — focus on the higher-altitude themes instead.",
  },
};

/**
 * Result of asserting a skill against the growth plan. When `blocked` is true,
 * the orchestrator MUST NOT call the LLM and SHOULD return the
 * `deferralMessage` to the creator (or log it via `mayaActionLog` if the
 * call was cron-triggered, not chat-triggered).
 */
export interface GrowthPlanGuardResult {
  readonly blocked: boolean;
  readonly deferralMessage: string | null;
  readonly stage: CareerStage | null;
}

/**
 * Wave 2 — when a paired smartAlternative is available, the guard returns
 * `blocked=false` and the orchestrator runs the skill in route-to-alternative
 * mode (see `routeViaGrowthPlan`). The legacy "blocked + deferral message"
 * path only fires for plans without smartAlternatives (pre-Wave-2 picture
 * rows), and it's deprecated — Maya should never hard-refuse a creator's ask
 * once those plans are migrated.
 */
export function assertSkillRespectsGrowthPlan(
  domain: SkillDomain,
  growthPlan: GrowthPlanForSkill | null | undefined
): GrowthPlanGuardResult {
  if (!growthPlan) {
    return { blocked: false, deferralMessage: null, stage: null };
  }
  if (!isSkillBlockedByAntiPatterns(domain, growthPlan)) {
    return {
      blocked: false,
      deferralMessage: null,
      stage: growthPlan.currentStage,
    };
  }
  // Wave 2: if a smartAlternative is paired, NEVER hard-block. The router
  // (`routeViaGrowthPlan`) handles routing; the guard only blocks when the
  // plan is legacy (no smartAlternatives at all).
  const route = routeViaGrowthPlan(domain, growthPlan);
  if (route.mode === "smartAlternative") {
    return {
      blocked: false,
      deferralMessage: null,
      stage: growthPlan.currentStage,
    };
  }
  // Legacy plan with no smartAlternative for this antiPattern — fall back to
  // the deprecated deferral path so old call sites don't break. Logged so we
  // can prioritize the migration if this fires often.
  const message =
    DEFERRAL_MESSAGE[domain][growthPlan.currentStage] ??
    `This skill is currently deferred per your growth plan (stage: ${growthPlan.currentStage}).`;
  return {
    blocked: true,
    deferralMessage: message,
    stage: growthPlan.currentStage,
  };
}

/**
 * Wave 2 — smart-alternative routing. Replaces the binary "blocked / proceed"
 * gate with a 3-mode router: proceed | smartAlternative | proceed-cited.
 *
 *  - `proceed`           — no antiPattern hit; run the skill as normal.
 *  - `smartAlternative`  — antiPattern hit AND a paired smartAlternative is
 *                          available; the skill should ROUTE TO the alternative
 *                          (return `exampleAction` framing) rather than refuse.
 *  - `proceed`           — antiPattern hit but no paired alternative (legacy
 *                          plans pre-Wave-2): the skill proceeds with the
 *                          legacy `growthPlanPromptSuffix` defer-instruction.
 *                          (Returning `proceed` here, not blocked, encodes the
 *                          "Maya is opinionated, never refusing" principle.)
 *
 * The orchestrator's job is to either:
 *   - mode==="proceed" → call the LLM with the standard prompt
 *   - mode==="smartAlternative" → call the LLM with a prompt that ROUTES the
 *     skill output toward `smartAlternative.exampleAction` (the prompt-suffix
 *     calibration on each skill handles this — see the 5 calibrated skills).
 */
export interface RouteViaGrowthPlanResult {
  readonly mode: "proceed" | "smartAlternative";
  readonly smartAlternative: SmartAlternative | null;
  readonly stage: CareerStage | null;
  /** The matched antiPattern string when mode==="smartAlternative", else null. */
  readonly matchedAntiPattern: string | null;
}

export function routeViaGrowthPlan(
  domain: SkillDomain,
  growthPlan: GrowthPlanForSkill | null | undefined
): RouteViaGrowthPlanResult {
  if (!growthPlan) {
    return {
      mode: "proceed",
      smartAlternative: null,
      stage: null,
      matchedAntiPattern: null,
    };
  }
  const matchedAnti = matchAntiPatternForDomain(domain, growthPlan);
  if (!matchedAnti) {
    return {
      mode: "proceed",
      smartAlternative: null,
      stage: growthPlan.currentStage,
      matchedAntiPattern: null,
    };
  }
  // Find the paired alternative by exact-string match (synthesis enforces this).
  const alt = growthPlan.smartAlternatives?.find(
    (s) => s.antiPattern === matchedAnti
  );
  if (!alt) {
    // Legacy plan with no alternatives — proceed with the suffix-driven
    // "explain WHY you'd defer" prompt. Maya never hard-refuses now.
    return {
      mode: "proceed",
      smartAlternative: null,
      stage: growthPlan.currentStage,
      matchedAntiPattern: matchedAnti,
    };
  }
  return {
    mode: "smartAlternative",
    smartAlternative: alt,
    stage: growthPlan.currentStage,
    matchedAntiPattern: matchedAnti,
  };
}

/**
 * Returns the FIRST antiPattern entry whose string contains a domain keyword,
 * or null if no entry matches. Same semantics as `isSkillBlockedByAntiPatterns`
 * but returns the matched string so the caller can pair it with a
 * smartAlternative entry.
 */
function matchAntiPatternForDomain(
  domain: SkillDomain,
  growthPlan: GrowthPlanForSkill
): string | null {
  const keywords = ANTI_PATTERN_KEYWORDS[domain];
  if (keywords.length === 0) return null;
  for (const ap of growthPlan.antiPatterns) {
    const apLower = ap.toLowerCase();
    for (const kw of keywords) {
      if (apLower.includes(kw)) return ap;
    }
  }
  return null;
}

/**
 * Wave 2 prompt suffix — the recommending skill appends this to its LLM
 * prompt. When a smartAlternative is matched, the suffix tells the LLM to
 * ROUTE its output toward the alternative (`exampleAction` framing) and
 * cite the antiPattern + alternative in its reasoning.
 *
 * Skills that don't run an LLM (deterministic pricing) skip this and use the
 * router alone — see `convex/agents/skills/*` for orchestrator wiring.
 */
export function growthPlanPromptSuffix(
  growthPlan: GrowthPlanForSkill | null | undefined,
  options?: {
    /** When set, the suffix instructs the LLM to route to this alternative. */
    smartAlternative?: SmartAlternative | null;
  }
): string {
  if (!growthPlan) return "";
  const lines: string[] = [];
  lines.push("");
  lines.push("=== STAGE-AWARE GROWTH PLAN (respect when generating) ===");
  lines.push(`Creator current stage: ${growthPlan.currentStage}`);
  lines.push(`Next milestone: ${growthPlan.nextMilestoneText}`);
  lines.push(`Plan horizon: ${growthPlan.horizonWeeks} weeks`);
  if (growthPlan.focusAreas.length > 0) {
    lines.push("Focus areas RIGHT NOW (align recommendations with these):");
    for (const f of growthPlan.focusAreas) lines.push(`  - ${f}`);
  }
  if (growthPlan.antiPatterns.length > 0) {
    lines.push("Anti-patterns at this stage (each is paired with a smartAlternative below — DO NOT REFUSE; route to the alternative):");
    for (const a of growthPlan.antiPatterns) lines.push(`  - ${a}`);
  }
  if (
    growthPlan.smartAlternatives &&
    growthPlan.smartAlternatives.length > 0
  ) {
    lines.push("Smart alternatives (route here when an antiPattern is matched):");
    for (const s of growthPlan.smartAlternatives) {
      lines.push(`  - ANTI: ${s.antiPattern}`);
      lines.push(`    INSTEAD: ${s.insteadDoThis}`);
      lines.push(`    EXAMPLE: ${s.exampleAction}`);
      lines.push(`    WHY: ${s.reasoning}`);
    }
  }
  // Wave 2 — explicit routing block when a specific smartAlternative was
  // selected by the router. The skill uses this to rephrase its output as
  // the smartAlternative's exampleAction, NOT as a refusal of the original
  // ask. Maya is opinionated, never refusing.
  if (options?.smartAlternative) {
    const sa = options.smartAlternative;
    lines.push("");
    lines.push("=== ROUTE TO THIS SMART ALTERNATIVE ===");
    lines.push(
      `Your requested action matches the antiPattern: "${sa.antiPattern}".`
    );
    lines.push(
      "DO NOT REFUSE. INSTEAD, execute the matched smartAlternative — that's Maya's calibrated way to give the creator what they asked for at their stage."
    );
    lines.push(`INSTEAD DO THIS: ${sa.insteadDoThis}`);
    lines.push(`EXAMPLE ACTION (this is your output framing): ${sa.exampleAction}`);
    lines.push(`REASONING: ${sa.reasoning}`);
    lines.push(
      "Frame your output as the smartAlternative's exampleAction. Cite the antiPattern + smartAlternative in your reasoning."
    );
  } else {
    lines.push(
      "Maya is opinionated, never refusing. If your recommendation would violate an anti-pattern, route to the paired smartAlternative — be explicit about WHY (cite the stage)."
    );
  }
  return lines.join("\n");
}
