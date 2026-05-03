/**
 * maya-rate-calculator — heuristic baseline computation.
 *
 * Sprint 3.5. Pure-logic baseline; the LLM reasoning step is handled by the
 * caller (a Convex action that invokes the Maya model router with the
 * `rate_suggestion` task tag at medium thinking). This file stays
 * deterministic so tests can pin numeric expectations.
 *
 * Math:
 *   baseRate = (followerCount / 1000) * NICHE_CPM[niche] * FORMAT_MULT[format]
 *   adjusted = baseRate * (1 + exclusivityPremium) * (1 + usageRightsPremium)
 *   total    = sum over deliverables, then split into low/mid/high (-15% / 0 / +20%)
 *
 * All outputs rounded to nearest $50. See SKILL.md for the full contract.
 *
 * Stage-aware adaptive product (Agent B, 2026-04-26): this is a deterministic
 * pricing helper — no LLM prompt to suffix. The orchestrator
 * (convex/agents/skills/rateCalculator.ts) MUST call
 * `assertSkillRespectsGrowthPlan("rate-calculator", growthPlan)` BEFORE
 * invoking this skill. just-starting creators with "set rates" in
 * antiPatterns get the deferral message ("setting rates before your first
 * deal sets them artificially") instead of a fabricated number.
 */

export type DeliverableFormat =
  | "tiktok-video"
  | "ig-reel"
  | "ig-carousel"
  | "ig-story"
  | "yt-short"
  | "yt-long"
  | "linkedin-post"
  | "x-thread"
  | "x-post";

export type ExclusivityScope = "category" | "brand-list" | "none";

export type UsageRightsKind =
  | "organic-only"
  | "paid-amplification"
  | "whitelisting"
  | "full-buyout";

export interface Deliverable {
  readonly format: DeliverableFormat;
  readonly count: number;
  readonly exclusivity?: { scope: ExclusivityScope; durationDays: number };
  readonly usageRights?: { kind: UsageRightsKind; durationDays: number };
}

export interface PriorDeal {
  readonly brand: string;
  readonly amount: number;
  readonly format: string;
}

export interface RateCalculatorInput {
  readonly followerCount: number;
  readonly niche: string;
  readonly deliverables: ReadonlyArray<Deliverable>;
  readonly priorDeals?: ReadonlyArray<PriorDeal>;
}

export interface RateRange {
  readonly low: number;
  readonly mid: number;
  readonly high: number;
}

export interface RateCitation {
  readonly kind: "deliverable" | "comparable" | "prior-deal" | "heuristic-table";
  readonly id: string;
  readonly fact: string;
}

export interface RateCalculatorResult {
  readonly suggestedRate: RateRange;
  readonly reasoning: string;
  readonly citations: ReadonlyArray<RateCitation>;
  readonly confidence: "low" | "medium" | "high";
}

// $/1000 followers — rough industry guidance, not a contract. Treat as "as of
// 2026-04, calibrated to mid-tier creator deals." Re-tune from telemetry.
const NICHE_CPM: Record<string, number> = {
  beauty: 22,
  fashion: 20,
  fitness: 18,
  food: 16,
  lifestyle: 14,
  travel: 16,
  tech: 26,
  finance: 30,
  business: 28,
  education: 14,
  gaming: 12,
  parenting: 18,
  general: 12,
};

const FORMAT_MULT: Record<DeliverableFormat, number> = {
  "tiktok-video": 1.0,
  "ig-reel": 1.1,
  "ig-carousel": 0.7,
  "ig-story": 0.4,
  "yt-short": 1.2,
  "yt-long": 2.5,
  "linkedin-post": 1.3,
  "x-thread": 0.9,
  "x-post": 0.5,
};

function exclusivityPremium(ex?: Deliverable["exclusivity"]): number {
  if (!ex || ex.scope === "none") return 0.05;
  if (ex.scope === "brand-list") {
    return ex.durationDays > 60 ? 0.15 : 0.1;
  }
  // category
  if (ex.durationDays >= 90) return 0.3;
  if (ex.durationDays >= 30) return 0.2;
  return 0.15;
}

function usageRightsPremium(ur?: Deliverable["usageRights"]): number {
  if (!ur || ur.kind === "organic-only") return 0.1;
  if (ur.kind === "paid-amplification") return 0.25;
  if (ur.kind === "whitelisting") return 0.4;
  return 0.5; // full-buyout
}

function roundToFifty(n: number): number {
  return Math.round(n / 50) * 50;
}

export function computeBaselineRate(
  input: RateCalculatorInput
): RateCalculatorResult {
  if (input.followerCount < 0) {
    throw new Error("followerCount must be >= 0");
  }
  if (input.deliverables.length === 0) {
    throw new Error("deliverables must be non-empty");
  }

  const nicheKey = input.niche.toLowerCase().trim();
  const cpm = NICHE_CPM[nicheKey] ?? NICHE_CPM.general;
  const nicheCited = nicheKey in NICHE_CPM;

  const citations: RateCitation[] = [
    {
      kind: "heuristic-table",
      id: `cpm:${nicheCited ? nicheKey : "general"}`,
      fact: `Niche CPM for ${nicheCited ? nicheKey : "general"} is $${cpm} per 1000 followers (Maya internal table v0.1.0).`,
    },
  ];

  let total = 0;
  for (let i = 0; i < input.deliverables.length; i++) {
    const d = input.deliverables[i];
    if (d.count <= 0) {
      throw new Error(`deliverable[${i}].count must be > 0`);
    }
    const formatMult = FORMAT_MULT[d.format];
    const base = (input.followerCount / 1000) * cpm * formatMult;
    const exPremium = exclusivityPremium(d.exclusivity);
    const urPremium = usageRightsPremium(d.usageRights);
    const adjusted = base * (1 + exPremium) * (1 + urPremium) * d.count;
    total += adjusted;

    citations.push({
      kind: "deliverable",
      id: `deliverable:${i}:${d.format}`,
      fact: `${d.count}× ${d.format} at ${input.followerCount.toLocaleString()} followers in ${nicheCited ? nicheKey : "general"} niche: base $${roundToFifty(base * d.count)}, +${Math.round(exPremium * 100)}% exclusivity, +${Math.round(urPremium * 100)}% usage rights.`,
    });
  }

  // Anchor against prior deals if any.
  let confidence: "low" | "medium" | "high" = "medium";
  if (input.priorDeals && input.priorDeals.length > 0) {
    confidence = "high";
    const avgPrior =
      input.priorDeals.reduce((s, p) => s + p.amount, 0) /
      input.priorDeals.length;
    citations.push({
      kind: "prior-deal",
      id: "prior-deals-anchor",
      fact: `${input.priorDeals.length} prior deal(s) averaging $${roundToFifty(avgPrior)}; used as anchor.`,
    });
    // Pull the heuristic toward the prior-deal average if heuristic is wildly off.
    const ratio = total / Math.max(avgPrior, 1);
    if (ratio > 3 || ratio < 0.33) {
      // Heuristic is suspect — geometric mean toward prior-deal anchor.
      total = Math.sqrt(total * avgPrior);
      confidence = "medium";
    }
  } else if (!nicheCited) {
    confidence = "low";
  }

  const range: RateRange = {
    low: roundToFifty(total * 0.85),
    mid: roundToFifty(total),
    high: roundToFifty(total * 1.2),
  };

  // Citation that backs the final range numbers verbatim — required so the
  // reasoning string can pass `maya-citation-firewall` (any number Maya
  // surfaces must appear in a citation fact, per CLAUDE.md § 3).
  citations.push({
    kind: "heuristic-table",
    id: "computed-range",
    fact: `Heuristic computed range: low ${range.low}, mid ${range.mid}, high ${range.high} (USD).`,
  });

  const reasoning = buildReasoning(input, range, nicheCited, confidence);

  return {
    suggestedRate: range,
    reasoning,
    citations,
    confidence,
  };
}

function buildReasoning(
  input: RateCalculatorInput,
  range: RateRange,
  nicheCited: boolean,
  confidence: "low" | "medium" | "high"
): string {
  const parts: string[] = [];
  parts.push(
    `For ${input.deliverables
      .map((d) => `${d.count}× ${d.format}`)
      .join(" + ")} at ${input.followerCount.toLocaleString()} followers in ${input.niche}, suggested range is $${range.low}–$${range.high} (target $${range.mid}).`
  );
  if (input.priorDeals && input.priorDeals.length > 0) {
    parts.push(
      `Anchored against ${input.priorDeals.length} prior deal(s) on file.`
    );
  }
  if (!nicheCited) {
    parts.push(
      `Note: '${input.niche}' isn't in the CPM table; fell back to 'general' baseline. Confidence: ${confidence}.`
    );
  } else {
    parts.push(`Confidence: ${confidence}.`);
  }
  return parts.join(" ");
}
